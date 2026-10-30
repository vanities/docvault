// finish_check_in validation and how its result is applied within the limits. Pure; fabricated values.
import { describe, expect, test } from 'vite-plus/test';
import { applyFinish, finishProblems, type FinishInput } from './finish.js';
import { LIMITS } from './types.js';

const NOW = new Date('2030-01-02T15:00:00.000Z');
const base: FinishInput = { headline: 'Rates unchanged', notes: 'Acme Bank 4.1%', reason: 'quiet' };
const minutesAfterNow = (iso: string) => (Date.parse(iso) - NOW.getTime()) / 60_000;

describe('finishProblems', () => {
  test('accepts a plain finish and an offset timestamp in the future', () => {
    expect(finishProblems(base, NOW)).toEqual([]);
    expect(finishProblems({ ...base, next_check_at: '2030-01-02T12:00:00-06:00' }, NOW)).toEqual(
      []
    );
  });

  test('rejects what the model can fix by calling again', () => {
    expect(finishProblems({ ...base, headline: '  ' }, NOW)).toEqual([
      'headline must not be empty',
    ]);
    expect(finishProblems({ ...base, next_check_at: '2030-01-02T18:00:00' }, NOW)[0]).toMatch(
      /UTC offset/
    );
    expect(finishProblems({ ...base, next_check_at: '2030-01-02T08:00:00-06:00' }, NOW)).toEqual([
      'next_check_at must be in the future',
    ]);
    expect(finishProblems({ ...base, notify: { subject: 'x', body: ' ' } }, NOW)).toEqual([
      'notify.body must not be empty',
    ]);
  });
});

describe('applyFinish', () => {
  const assignment = { cadenceMinutes: 180 };

  test('defaults to the cadence and keeps the notes and headline', () => {
    const out = applyFinish(assignment, base, { now: NOW, trigger: 'scheduled' });
    expect(minutesAfterNow(out.nextCheckAt)).toBe(180);
    expect(out.notes).toBe('Acme Bank 4.1%');
    expect(out.headline).toBe('Rates unchanged');
    expect(out.notify).toBeNull();
    expect(out.closeOutcome).toBeNull();
    expect(out.warnings).toEqual([]);
  });

  test('clamps the next check and the cadence to 1 hour through 7 days', () => {
    const soon = applyFinish(
      assignment,
      { ...base, next_check_in_minutes: 5 },
      {
        now: NOW,
        trigger: 'scheduled',
      }
    );
    expect(minutesAfterNow(soon.nextCheckAt)).toBe(LIMITS.minIntervalMinutes);
    expect(soon.warnings).toEqual(['next check 5m clamped to 60m']);

    const far = applyFinish(
      assignment,
      { ...base, cadence_minutes: 100_000 },
      {
        now: NOW,
        trigger: 'scheduled',
      }
    );
    expect(far.cadenceMinutes).toBe(LIMITS.maxIntervalMinutes);
    expect(minutesAfterNow(far.nextCheckAt)).toBe(LIMITS.maxIntervalMinutes);
  });

  test('an explicit time wins over minutes, and a new cadence sets the default', () => {
    const at = applyFinish(
      assignment,
      { ...base, next_check_at: '2030-01-02T13:00:00-06:00', next_check_in_minutes: 999 },
      { now: NOW, trigger: 'scheduled' }
    );
    expect(minutesAfterNow(at.nextCheckAt)).toBe(240);
    const hourly = applyFinish(
      assignment,
      { ...base, cadence_minutes: 60 },
      {
        now: NOW,
        trigger: 'message',
      }
    );
    expect(hourly.cadenceMinutes).toBe(60);
    expect(minutesAfterNow(hourly.nextCheckAt)).toBe(60);
  });

  test('a reply run never emails, but a check-in does; close carries its outcome', () => {
    const notify = { subject: 'Rate moved', body: 'Acme Bank cut to 3.9%.' };
    expect(
      applyFinish(assignment, { ...base, notify }, { now: NOW, trigger: 'scheduled' }).notify
    ).toEqual(notify);
    const reply = applyFinish(assignment, { ...base, notify }, { now: NOW, trigger: 'message' });
    expect(reply.notify).toBeNull();
    expect(reply.warnings).toEqual(['notify ignored: the owner triggered this run']);
    expect(
      applyFinish(
        assignment,
        { ...base, close: { outcome: ' Moved the money. ' } },
        {
          now: NOW,
          trigger: 'scheduled',
        }
      ).closeOutcome
    ).toBe('Moved the money.');
  });

  test('notes and headline are trimmed to their limits', () => {
    const out = applyFinish(
      assignment,
      { ...base, headline: 'h'.repeat(500), notes: 'n'.repeat(10_000) },
      { now: NOW, trigger: 'scheduled' }
    );
    expect(out.headline).toHaveLength(LIMITS.headlineMaxChars);
    expect(out.notes).toHaveLength(LIMITS.notesMaxChars);
  });
});
