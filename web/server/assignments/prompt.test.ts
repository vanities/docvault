// The check-in prompt and the scheduler's due test. Pure; a fabricated assignment.
import { describe, expect, test } from 'vite-plus/test';
import { buildCheckInPrompt, formatLocal, localDate } from './prompt.js';
import { isAssignmentDue } from './scheduler.js';
import { blankAssignment } from './store.js';
import type { TranscriptEntry } from './types.js';

const NOW = new Date('2030-01-02T15:00:00.000Z');
const TZ = 'America/Chicago';
const assignment = {
  title: 'Watch Acme Bank rates',
  brief: 'Tell me if Acme Bank savings drops below 4%.',
  notes: 'Last seen 4.1% on Jan 1.',
  cadenceMinutes: 180,
};
const entry = (at: string, kind: TranscriptEntry['kind'], markdown: string, headline?: string) =>
  ({ id: at, at, kind, markdown, headline }) as TranscriptEntry;

describe('buildCheckInPrompt', () => {
  test('carries the brief, notes, local time, recent headlines and the finish instructions', () => {
    const prompt = buildCheckInPrompt({
      assignment,
      trigger: 'scheduled',
      now: NOW,
      timeZone: TZ,
      transcript: [
        entry('2030-01-01T15:00:00.000Z', 'check-in', 'long text', 'Still 4.1%'),
        entry('2030-01-01T16:00:00.000Z', 'system', 'Check-in failed'),
      ],
      lastRunAt: '2030-01-01T15:00:00.000Z',
      interruptedWrites: [],
    });
    expect(prompt).toContain('# Assignment: Watch Acme Bank rates');
    expect(prompt).toContain('Local time: Wed, Jan 2, 9:00 AM (America/Chicago)');
    expect(prompt).toContain('This is a scheduled check-in.');
    expect(prompt).toContain('Tell me if Acme Bank savings drops below 4%.');
    expect(prompt).toContain('Last seen 4.1% on Jan 1.');
    expect(prompt).toContain('- Tue, Jan 1, 9:00 AM: Still 4.1%');
    expect(prompt).not.toContain('Check-in failed');
    expect(prompt).toContain('call finish_check_in exactly once');
    expect(prompt).not.toContain('Messages from the owner');
    expect(prompt).not.toContain('interrupted');
  });

  test('a reply run lists only messages newer than the last run and says not to notify', () => {
    const prompt = buildCheckInPrompt({
      assignment: { ...assignment, notes: '' },
      trigger: 'message',
      now: NOW,
      timeZone: TZ,
      transcript: [
        entry('2030-01-01T14:00:00.000Z', 'you', 'old question'),
        entry('2030-01-02T14:30:00.000Z', 'you', 'check every hour please'),
      ],
      lastRunAt: '2030-01-01T15:00:00.000Z',
      interruptedWrites: [],
    });
    expect(prompt).toContain('(none yet: this is the first check-in)');
    expect(prompt).toContain('check every hour please');
    expect(prompt).not.toContain('old question');
    expect(prompt).toContain('notify: leave it out; the owner is here');
  });

  test('an interrupted run lists the writes not to repeat', () => {
    const prompt = buildCheckInPrompt({
      assignment,
      trigger: 'scheduled',
      now: NOW,
      timeZone: TZ,
      transcript: [],
      lastRunAt: null,
      interruptedWrites: ['add_calendar_event {"title":"Recheck Acme"}'],
    });
    expect(prompt).toContain('Do not repeat them:\n- add_calendar_event {"title":"Recheck Acme"}');
  });

  test('local date and time follow the configured zone', () => {
    expect(localDate(new Date('2030-01-02T03:00:00.000Z'), TZ)).toBe('2030-01-01');
    expect(formatLocal('2030-01-02T03:00:00.000Z', TZ)).toBe('Tue, Jan 1, 9:00 PM');
  });
});

describe('isAssignmentDue', () => {
  const now = NOW.getTime();
  const a = (over: Partial<ReturnType<typeof blankAssignment>> = {}) => ({
    ...blankAssignment(
      { id: '00000000-0000-0000-0000-000000000001', title: 't', brief: 'b', cadenceMinutes: 60 },
      '2030-01-02T14:00:00.000Z'
    ),
    ...over,
  });

  test('due once the next check time has passed', () => {
    expect(isAssignmentDue(a(), now, false)).toBe(true);
    expect(isAssignmentDue(a({ nextCheckAt: '2030-01-02T16:00:00.000Z' }), now, false)).toBe(false);
  });

  test('never due while paused, closed, running, queued, or all paused', () => {
    expect(isAssignmentDue(a({ status: 'paused' }), now, false)).toBe(false);
    expect(isAssignmentDue(a({ status: 'closed' }), now, false)).toBe(false);
    expect(
      isAssignmentDue(
        a({ running: { runId: 'r', trigger: 'scheduled', startedAt: '2030-01-02T14:59:00.000Z' } }),
        now,
        false
      )
    ).toBe(false);
    expect(isAssignmentDue(a({ pendingRun: 'manual' }), now, false)).toBe(false);
    expect(isAssignmentDue(a(), now, true)).toBe(false);
    expect(isAssignmentDue(a({ nextCheckAt: null }), now, false)).toBe(false);
  });
});
