// The assignment runner end to end, with a scripted agent turn, a fake clock and a fake mailer in an
// isolated data directory. Fabricated assignment and addresses only; nothing reaches Anthropic.
import { afterAll, beforeEach, describe, expect, test, vi } from 'vite-plus/test';
import { rmSync } from 'node:fs';

const dataDir = vi.hoisted(() => {
  const os = require('node:os') as typeof import('node:os');
  const p = require('node:path') as typeof import('node:path');
  const dir = p.join(os.tmpdir(), `docvault-assignments-runner-${Date.now()}`);
  process.env.DOCVAULT_DATA_DIR = dir;
  return dir;
});
vi.mock('../ai/usage-log.js', () => ({ logAiCall: vi.fn(async () => {}) }));

import type { SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ClaudeTurnOptions, ClaudeTurnResult } from '../routes/chat.js';
import { localDate } from './prompt.js';
import { recoverInterruptedRuns, runAssignment, type RunnerDeps } from './runner.js';
import {
  appendRunLog,
  blankAssignment,
  loadIndex,
  loadTranscript,
  newId,
  readRunLog,
  updateIndex,
} from './store.js';
import { LIMITS, type Assignment } from './types.js';

const TZ = 'America/Chicago';
const START = Date.parse('2030-01-02T15:00:00.000Z');
const clock = { now: START };
const minutesLater = (m: number) => new Date(clock.now + m * 60_000).toISOString();

type SentEmail = {
  purpose: string;
  to?: string;
  cc?: string;
  subject: string;
  html: string;
  ref?: string;
};
const sent: SentEmail[] = [];
const sendEmail = vi.fn(async (input: SentEmail) => {
  sent.push(input);
  return { ok: true };
});

type Turn = (opts: ClaudeTurnOptions) => Promise<ClaudeTurnResult>;

function deps(runTurn: Turn, over: Partial<RunnerDeps> = {}): RunnerDeps {
  return {
    dataDir,
    now: () => new Date(clock.now),
    runTurn,
    resolveAgent: async () => ({
      model: 'claude-test',
      effort: undefined,
      usingSub: true,
      env: {},
    }),
    loadContext: async () => ({
      brain: '',
      skillsPlugin: null,
      config: { entities: [] },
      timeZone: TZ,
    }),
    recipient: async () => 'owner@example.com',
    sendEmail: sendEmail as unknown as RunnerDeps['sendEmail'],
    ...over,
  };
}

const success = (): ClaudeTurnResult => ({
  result: {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'done',
    total_cost_usd: 0.25,
  } as unknown as SDKResultMessage,
  error: null,
  aborted: false,
});

async function finish(opts: ClaudeTurnOptions, input: Record<string, unknown>) {
  const tool = opts.extraTools!.find((t) => t.name === 'finish_check_in')!;
  return tool.handler({ headline: 'Checked', notes: 'notes', reason: 'quiet', ...input }, {});
}

async function create(over: Partial<Assignment> = {}): Promise<string> {
  const id = newId();
  await updateIndex((index) => {
    index.assignments[id] = {
      ...blankAssignment(
        {
          id,
          title: 'Watch Acme Bank rates',
          brief: 'Tell me if Acme Bank savings drops below 4%.',
          cadenceMinutes: 180,
        },
        new Date(clock.now).toISOString()
      ),
      ...over,
    };
  }, dataDir);
  return id;
}
const get = async (id: string) => (await loadIndex(dataDir)).assignments[id];

beforeEach(async () => {
  clock.now = START;
  sent.length = 0;
  sendEmail.mockClear();
  await updateIndex((index) => {
    index.pausedAll = false;
    index.pausedAllReason = null;
  }, dataDir);
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('a successful check-in', () => {
  test('records the reply, tools, notes and next check, logging tool calls as they happen', async () => {
    const id = await create();
    let seen: ClaudeTurnOptions | null = null;
    const out = await runAssignment(
      id,
      'scheduled',
      deps(async (opts) => {
        seen = opts;
        opts.send({ type: 'text', text: 'Acme still pays 4.1%. ' });
        opts.send({ type: 'tool_call', id: 't1', toolName: 'log_time', input: { hours: 1 } });
        opts.send({ type: 'tool_result', toolUseId: 't1', result: {}, isError: false });
        opts.send({ type: 'tool_call', id: 't2', toolName: 'get_alerts', input: {} });
        await finish(opts, {
          headline: 'Still 4.1%',
          notes: 'Acme 4.1% on Jan 2',
          next_check_in_minutes: 240,
        });
        return success();
      })
    );
    expect(out).toMatchObject({ status: 'ok', error: null });

    const opts = seen as unknown as ClaudeTurnOptions;
    expect(opts.policy).toBe('unattended');
    expect(opts.persistSession).toBe(false);
    expect(opts.maxTurns).toBe(LIMITS.maxTurns);
    expect(opts.maxBudgetUsd).toBe(LIMITS.maxBudgetUsd);
    expect(opts.toolContext.assignment).toEqual({
      id,
      title: 'Watch Acme Bank rates',
      deepResearchStarts: 0,
    });
    expect(opts.systemPrompt).toContain('UNATTENDED RUN');
    expect(opts.prompt).toContain('Tell me if Acme Bank savings drops below 4%.');

    const a = await get(id);
    expect(a.running).toBeNull();
    expect(a.notes).toBe('Acme 4.1% on Jan 2');
    expect(a.nextCheckAt).toBe(minutesLater(240));
    expect(a.lastRun).toMatchObject({ ok: true, headline: 'Still 4.1%', emailed: false });
    expect(a.unread).toBe(0);
    expect(a.counters).toEqual({ day: localDate(new Date(clock.now), TZ), runs: 1, emails: 0 });

    const [entry] = await loadTranscript(id, dataDir);
    expect(entry).toMatchObject({
      kind: 'check-in',
      markdown: 'Acme still pays 4.1%.',
      headline: 'Still 4.1%',
      emailed: false,
      nextCheckAt: minutesLater(240),
    });
    expect(entry.tools).toEqual([
      { name: 'log_time', write: true, ok: true },
      { name: 'get_alerts', write: false, ok: null },
    ]);
    const runLog = await readRunLog(id, dataDir);
    expect(runLog.map((l) => l.event)).toEqual(['start', 'tool', 'tool', 'end']);
    expect(runLog[1]).toMatchObject({ name: 'log_time', write: true, input: '{"hours":1}' });
    expect(runLog[3]).toMatchObject({ outcome: 'ok', costUsd: 0.25, emailed: false });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test('a tool allow-list narrows the turn but always keeps finish_check_in', async () => {
    const id = await create({ toolAllowlist: ['get_alerts', 'WebSearch'] });
    let allowed: ((n: string) => boolean) | undefined;
    await runAssignment(
      id,
      'manual',
      deps(async (opts) => {
        allowed = opts.isToolAllowed;
        await finish(opts, {});
        return success();
      })
    );
    expect(allowed!('mcp__docvault__get_alerts')).toBe(true);
    expect(allowed!('WebSearch')).toBe(true);
    expect(allowed!('mcp__docvault__finish_check_in')).toBe(true);
    expect(allowed!('mcp__docvault__log_time')).toBe(false);
  });
});

describe('notifications', () => {
  test('notify emails the owner once, the way alerts do, with the changes made', async () => {
    const id = await create();
    await runAssignment(
      id,
      'scheduled',
      deps(async (opts) => {
        opts.send({ type: 'tool_call', id: 't1', toolName: 'add_calendar_event', input: {} });
        opts.send({ type: 'tool_result', toolUseId: 't1', result: {}, isError: false });
        await finish(opts, {
          notify: { subject: 'Rate moved', body: 'Acme Bank cut savings to **3.9%**.' },
        });
        return success();
      })
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      purpose: 'news',
      to: 'owner@example.com',
      cc: '',
      subject: 'Watch Acme Bank rates: Rate moved',
      ref: `assignment:${id}`,
    });
    expect(sent[0].html).toContain('<strong>3.9%</strong>');
    expect(sent[0].html).toContain('Changes made');
    expect(sent[0].html).toContain('add_calendar_event');
    const a = await get(id);
    expect(a.unread).toBe(1);
    expect(a.lastRun?.emailed).toBe(true);
  });

  test('the run stays marked running until its thread and log are written', async () => {
    const id = await create();
    let runningWhileEmailing: unknown = 'not called';
    await runAssignment(
      id,
      'scheduled',
      deps(
        async (opts) => {
          await finish(opts, { notify: { subject: 'Rate moved', body: 'Acme cut to 3.9%.' } });
          return success();
        },
        {
          sendEmail: (async () => {
            runningWhileEmailing = (await get(id)).running;
            return { ok: true };
          }) as unknown as RunnerDeps['sendEmail'],
        }
      )
    );
    expect(runningWhileEmailing).not.toBeNull();
    expect(runningWhileEmailing).not.toBe('not called');
    expect((await get(id)).running).toBeNull();
    expect(await loadTranscript(id, dataDir)).toHaveLength(1);
    expect((await readRunLog(id, dataDir)).at(-1)?.event).toBe('end');
  });

  test('an email that could not be sent is never shown as emailed', async () => {
    const id = await create();
    await runAssignment(
      id,
      'scheduled',
      deps(
        async (opts) => {
          await finish(opts, { notify: { subject: 'Rate moved', body: 'Acme cut to 3.9%.' } });
          return success();
        },
        { recipient: async () => null }
      )
    );
    expect(sent).toHaveLength(0);
    expect((await get(id)).lastRun?.emailed).toBe(false);
    const [entry] = await loadTranscript(id, dataDir);
    expect(entry.emailed).toBe(false);
    const end = (await readRunLog(id, dataDir)).at(-1);
    expect(end).toMatchObject({ event: 'end', emailed: false });
    expect(end && 'warnings' in end ? end.warnings : []).toContain(
      'email failed: No email recipient configured'
    );
  });

  test('the daily email cap holds back further notifications', async () => {
    const id = await create({
      counters: {
        day: localDate(new Date(clock.now), TZ),
        runs: 0,
        emails: LIMITS.emailsPerDay,
      },
    });
    await runAssignment(
      id,
      'scheduled',
      deps(async (opts) => {
        await finish(opts, { notify: { subject: 'Again', body: 'Still moving.' } });
        return success();
      })
    );
    expect(sent).toHaveLength(0);
    const end = (await readRunLog(id, dataDir)).at(-1);
    expect(end).toMatchObject({ event: 'end', outcome: 'ok' });
    expect(end && 'warnings' in end ? end.warnings : []).toContain(
      `email skipped: daily limit of ${LIMITS.emailsPerDay}`
    );
  });

  test('a reply run answers in the thread and never emails', async () => {
    const id = await create();
    await runAssignment(
      id,
      'message',
      deps(async (opts) => {
        opts.send({ type: 'text', text: 'Switched to hourly checks.' });
        await finish(opts, { cadence_minutes: 60, notify: { subject: 'x', body: 'y' } });
        return success();
      })
    );
    expect(sent).toHaveLength(0);
    const a = await get(id);
    expect(a.cadenceMinutes).toBe(60);
    expect(a.nextCheckAt).toBe(minutesLater(60));
    const [entry] = await loadTranscript(id, dataDir);
    expect(entry).toMatchObject({ kind: 'reply', markdown: 'Switched to hourly checks.' });
  });

  test('closing records the outcome and always emails', async () => {
    const id = await create();
    await runAssignment(
      id,
      'scheduled',
      deps(async (opts) => {
        opts.send({ type: 'text', text: 'All signals green for a day.' });
        await finish(opts, { close: { outcome: 'Safe to move the money back.' } });
        return success();
      })
    );
    const a = await get(id);
    expect(a.status).toBe('closed');
    expect(a.outcome).toBe('Safe to move the money back.');
    expect(a.closedAt).toBe(new Date(clock.now).toISOString());
    expect(a.nextCheckAt).toBeNull();
    expect(sent.map((e) => e.subject)).toEqual(['Watch Acme Bank rates: closed']);
  });
});

describe('when finish_check_in is missing', () => {
  test('one repair turn, limited to finish_check_in, asks for it', async () => {
    const id = await create();
    let calls = 0;
    await runAssignment(
      id,
      'scheduled',
      deps(async (opts) => {
        calls += 1;
        if (calls === 1) {
          opts.send({ type: 'text', text: 'Checked the rate.' });
          return success();
        }
        expect(opts.isToolAllowed!('mcp__docvault__finish_check_in')).toBe(true);
        expect(opts.isToolAllowed!('mcp__docvault__log_time')).toBe(false);
        expect(opts.prompt).toContain('Checked the rate.');
        await finish(opts, { notes: 'repaired notes' });
        return success();
      })
    );
    expect(calls).toBe(2);
    expect((await get(id)).notes).toBe('repaired notes');
    const end = (await readRunLog(id, dataDir)).at(-1);
    expect(end && 'warnings' in end ? end.warnings : []).toContain(
      'finish_check_in was not called; ran a repair turn'
    );
  });

  test('without a finish the notes are kept and the default cadence applies', async () => {
    const id = await create({ notes: 'keep me' });
    await runAssignment(
      id,
      'scheduled',
      deps(async () => success())
    );
    const a = await get(id);
    expect(a.notes).toBe('keep me');
    expect(a.nextCheckAt).toBe(minutesLater(180));
    expect(a.lastRun?.ok).toBe(true);
  });
});

describe('failures', () => {
  test('an account problem pauses every assignment and emails once', async () => {
    const first = await create();
    const second = await create();
    const failing = deps(async (opts) => {
      opts.send({ type: 'assistant_error', error: 'authentication_failed' });
      return { result: null, error: 'Claude Code process exited', aborted: false };
    });
    expect(await runAssignment(first, 'scheduled', failing)).toMatchObject({ status: 'account' });
    const index = await loadIndex(dataDir);
    expect(index.pausedAll).toBe(true);
    expect(index.pausedAllReason).toMatch(/authentication_failed/);
    expect(sent.map((e) => e.subject)).toEqual(['Assignments paused: Claude account problem']);

    expect(await runAssignment(second, 'scheduled', failing)).toEqual({
      status: 'skipped',
      reason: 'all assignments are paused',
    });
    await runAssignment(second, 'manual', failing);
    expect(sent).toHaveLength(1);
  });

  test('missing credentials count as an account problem', async () => {
    const id = await create();
    const out = await runAssignment(
      id,
      'manual',
      deps(async () => success(), {
        resolveAgent: async () => ({ error: 'No Claude credentials configured.' }),
      })
    );
    expect(out).toMatchObject({ status: 'account' });
    expect((await loadIndex(dataDir)).pausedAll).toBe(true);
  });

  // The shape a real safeguard refusal arrived in (2026-10-30).
  const refusing = () =>
    deps(async (opts) => {
      opts.send({ type: 'assistant_error', error: 'invalid_request' });
      return {
        result: null,
        error:
          "Claude Code returned an error result: API Error: Claude's safeguards flagged this message.\n\nRequest ID: req_test",
        aborted: false,
      };
    });

  test('a request the API refuses pauses that one assignment and emails once', async () => {
    const id = await create();
    const other = await create();
    expect(await runAssignment(id, 'scheduled', refusing())).toMatchObject({
      status: 'refused',
      error: expect.stringContaining('req_test'),
    });
    expect(await get(id)).toMatchObject({
      status: 'paused',
      nextCheckAt: null,
      consecutiveFailures: 1,
    });
    expect((await loadIndex(dataDir)).pausedAll).toBe(false);
    expect((await get(other)).status).toBe('active');
    expect(sent.map((e) => e.subject)).toEqual([
      'Watch Acme Bank rates: paused, Anthropic refused the check-in',
    ]);
    expect(sent[0].html).toContain('req_test');
    expect((await loadTranscript(id, dataDir)).at(-1)).toMatchObject({
      kind: 'system',
      markdown: expect.stringContaining('refused this check-in'),
    });
    expect((await readRunLog(id, dataDir)).at(-1)).toMatchObject({
      event: 'end',
      outcome: 'refused',
    });

    expect(await runAssignment(id, 'manual', refusing())).toMatchObject({ status: 'refused' });
    expect((await get(id)).status).toBe('paused');
    expect(sent).toHaveLength(1);
  });

  test('a resumed assignment that is refused again is paused and reported again', async () => {
    const id = await create();
    await runAssignment(id, 'scheduled', refusing());
    await updateIndex((index) => {
      index.assignments[id].status = 'active';
      index.assignments[id].nextCheckAt = new Date(clock.now).toISOString();
    }, dataDir);
    await runAssignment(id, 'scheduled', refusing());
    expect(await get(id)).toMatchObject({ status: 'paused', consecutiveFailures: 2 });
    expect(sent).toHaveLength(2);
  });

  test('a usage limit waits for its reset instead of counting as a failure', async () => {
    const id = await create();
    const resetSeconds = Math.floor((clock.now + 90 * 60_000) / 1000);
    await runAssignment(
      id,
      'scheduled',
      deps(async (opts) => {
        opts.send({
          type: 'rate_limit',
          payload: { rate_limit_info: { status: 'rejected', resetsAt: resetSeconds } },
        });
        return { result: null, error: 'rate limited', aborted: false };
      })
    );
    const a = await get(id);
    expect(a.nextCheckAt).toBe(new Date(resetSeconds * 1000).toISOString());
    expect(a.consecutiveFailures).toBe(0);
    const [entry] = await loadTranscript(id, dataDir);
    expect(entry.kind).toBe('system');
    expect(entry.markdown).toMatch(/usage limit was reached/);
  });

  test('a subscription near its limit pushes the next check back', async () => {
    const id = await create();
    await runAssignment(
      id,
      'scheduled',
      deps(async (opts) => {
        opts.send({
          type: 'rate_limit',
          payload: { rate_limit_info: { status: 'allowed_warning' } },
        });
        await finish(opts, { next_check_in_minutes: 60 });
        return success();
      })
    );
    expect((await get(id)).nextCheckAt).toBe(minutesLater(LIMITS.quotaWarningDelayMinutes));
  });

  test('failures back off 1h, 3h, 12h and email once after three in a row', async () => {
    const id = await create();
    const crashing = deps(async () => {
      throw new Error('subprocess crashed');
    });
    const expectedBackoff = [60, 180, 720, 720];
    for (const [i, minutes] of expectedBackoff.entries()) {
      clock.now = START + i * 24 * 3600_000;
      const out = await runAssignment(id, 'scheduled', crashing);
      expect(out).toMatchObject({ status: 'failed', error: 'subprocess crashed' });
      expect((await get(id)).nextCheckAt).toBe(minutesLater(minutes));
    }
    expect(sent.map((e) => e.subject)).toEqual(["Watch Acme Bank rates: can't run"]);
    expect(sent[0].html).toMatch(/<blockquote>\s*<p>subprocess crashed<\/p>/);
    expect((await get(id)).consecutiveFailures).toBe(4);

    await runAssignment(
      id,
      'scheduled',
      deps(async (opts) => {
        await finish(opts, {});
        return success();
      })
    );
    const a = await get(id);
    expect(a.consecutiveFailures).toBe(0);
    expect(a.failureEmailedAt).toBeNull();
  });

  test('a turn stopped by the watchdog is a failure', async () => {
    const id = await create();
    const out = await runAssignment(
      id,
      'scheduled',
      deps(async () => ({ result: null, error: null, aborted: true }))
    );
    expect(out).toMatchObject({ status: 'failed', error: 'Stopped after 10 minutes' });
  });
});

describe('ownership and limits', () => {
  test('a pause made mid-run survives the run', async () => {
    const id = await create();
    await runAssignment(
      id,
      'scheduled',
      deps(async (opts) => {
        await updateIndex((index) => {
          index.assignments[id].status = 'paused';
          index.assignments[id].nextCheckAt = null;
        }, dataDir);
        await finish(opts, { notes: 'new notes', next_check_in_minutes: 60 });
        return success();
      })
    );
    const a = await get(id);
    expect(a.status).toBe('paused');
    expect(a.nextCheckAt).toBeNull();
    expect(a.notes).toBe('new notes');
  });

  test('the daily run cap skips scheduled runs but not runs the owner asks for', async () => {
    const id = await create({
      counters: { day: localDate(new Date(clock.now), TZ), runs: LIMITS.runsPerDay, emails: 0 },
    });
    const turn = deps(async (opts) => {
      await finish(opts, {});
      return success();
    });
    expect(await runAssignment(id, 'scheduled', turn)).toEqual({
      status: 'skipped',
      reason: `daily limit of ${LIMITS.runsPerDay} runs`,
    });
    expect(await runAssignment(id, 'manual', turn)).toMatchObject({ status: 'ok' });
  });
});

describe('interrupted runs', () => {
  test('are recovered at boot, and the next run is told which writes already happened', async () => {
    const id = await create();
    const at = new Date(clock.now).toISOString();
    await updateIndex((index) => {
      index.assignments[id].running = { runId: 'run-x', trigger: 'scheduled', startedAt: at };
    }, dataDir);
    await appendRunLog(id, { runId: 'run-x', at, event: 'start', trigger: 'scheduled' }, dataDir);
    await appendRunLog(
      id,
      {
        runId: 'run-x',
        at,
        event: 'tool',
        name: 'add_calendar_event',
        write: true,
        input: '{"title":"Recheck Acme"}',
      },
      dataDir
    );
    await appendRunLog(
      id,
      { runId: 'run-x', at, event: 'tool', name: 'get_alerts', write: false, input: '{}' },
      dataDir
    );

    expect(await recoverInterruptedRuns({ dataDir, now: () => new Date(clock.now) })).toBe(1);
    const a = await get(id);
    expect(a.running).toBeNull();
    expect(a.nextCheckAt).toBe(minutesLater(LIMITS.retryFloorMinutes));
    expect(a.lastRun?.error).toBe('Interrupted by a server restart');
    expect((await loadTranscript(id, dataDir))[0].kind).toBe('system');

    let prompt = '';
    await runAssignment(
      id,
      'manual',
      deps(async (opts) => {
        prompt = String(opts.prompt);
        await finish(opts, {});
        return success();
      })
    );
    expect(prompt).toContain('add_calendar_event {"title":"Recheck Acme"}');
    expect(prompt).not.toContain('get_alerts {}');
  });
});
