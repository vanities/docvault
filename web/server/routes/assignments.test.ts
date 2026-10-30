// /api/assignments against an isolated data directory, with a scripted agent turn standing in for
// Claude. Fabricated assignment content only; no email leaves (the mailer is a stub).
import { afterAll, describe, expect, test, vi } from 'vite-plus/test';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';

const dataDir = vi.hoisted(() => {
  const os = require('node:os') as typeof import('node:os');
  const p = require('node:path') as typeof import('node:path');
  const dir = p.join(os.tmpdir(), `docvault-assignments-routes-${Date.now()}`);
  process.env.DOCVAULT_DATA_DIR = dir;
  return dir;
});
vi.mock('../ai/usage-log.js', () => ({ logAiCall: vi.fn(async () => {}) }));

import type { SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import type { RunnerDeps } from '../assignments/runner.js';
import { loadIndex, updateIndex } from '../assignments/store.js';
import type { Assignment, TranscriptEntry } from '../assignments/types.js';
import type { ClaudeTurnOptions } from './chat.js';
import { handleAssignmentsRoutes } from './assignments.js';

const NOW = Date.parse('2030-01-02T15:00:00.000Z');
const prompts: string[] = [];

const deps: RunnerDeps = {
  dataDir,
  now: () => new Date(NOW),
  runTurn: async (opts: ClaudeTurnOptions) => {
    prompts.push(String(opts.prompt));
    opts.send({ type: 'text', text: 'Checked Acme Bank.' });
    const finish = opts.extraTools!.find((t) => t.name === 'finish_check_in')!;
    await finish.handler({ headline: 'Acme at 4.1%', notes: 'n', reason: 'quiet' }, {});
    return {
      result: {
        type: 'result',
        subtype: 'success',
        is_error: false,
      } as unknown as SDKResultMessage,
      error: null,
      aborted: false,
    };
  },
  resolveAgent: async () => ({ model: 'claude-test', effort: undefined, usingSub: true, env: {} }),
  loadContext: async () => ({
    brain: '',
    skillsPlugin: null,
    config: { entities: [] },
    timeZone: 'America/Chicago',
  }),
  recipient: async () => 'owner@example.com',
  sendEmail: (async () => ({ ok: true })) as unknown as RunnerDeps['sendEmail'],
};

async function call(method: string, route: string, body?: unknown): Promise<Response | null> {
  return handleAssignmentsRoutes(
    new Request(`http://localhost${route}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    }),
    new URL(`http://localhost${route}`),
    route,
    deps
  );
}
async function json(method: string, route: string, body?: unknown) {
  const res = await call(method, route, body);
  if (!res) throw new Error(`${method} ${route} did not match`);
  return { status: res.status, data: (await res.json()) as Record<string, unknown> };
}
const get = async (id: string) => (await loadIndex(dataDir)).assignments[id];

/** Runs started over HTTP are fire-and-forget; wait for the index to show it finished. */
async function settled(id: string, runs: number) {
  for (let i = 0; i < 200; i += 1) {
    const a = await get(id);
    if (a && !a.running && !a.pendingRun && a.counters.runs >= runs) return a;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('run did not finish');
}

async function create(startNow = false): Promise<Assignment> {
  const { status, data } = await json('POST', '/api/assignments', {
    title: 'Watch Acme Bank rates',
    brief: 'Tell me if Acme Bank savings drops below 4%.',
    startNow,
  });
  expect(status).toBe(201);
  return data.assignment as Assignment;
}

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('creating and listing', () => {
  test('a new assignment starts with a first check-in by default', async () => {
    const { status, data } = await json('POST', '/api/assignments', {
      title: '  Watch Acme Bank rates ',
      brief: 'Tell me if Acme Bank savings drops below 4%.',
      cadenceMinutes: 120,
    });
    expect(status).toBe(201);
    const a = data.assignment as Assignment;
    expect(a).toMatchObject({
      title: 'Watch Acme Bank rates',
      status: 'active',
      cadenceMinutes: 120,
    });
    const after = await settled(a.id, 1);
    expect(after.lastRun).toMatchObject({ ok: true, trigger: 'manual', headline: 'Acme at 4.1%' });
  });

  test('startNow: false waits for the first scheduled check', async () => {
    const a = await create(false);
    expect((await get(a.id)).counters.runs).toBe(0);
    expect((await get(a.id)).nextCheckAt).toBe(new Date(NOW).toISOString());
  });

  test('bad input is a 400 with the reason', async () => {
    expect((await json('POST', '/api/assignments', { brief: 'b' })).data.error).toBe(
      'title is required'
    );
    expect(
      (await json('POST', '/api/assignments', { title: 't', brief: 'b', cadenceMinutes: 30 })).data
        .error
    ).toBe('cadenceMinutes must be between 60 and 10080');
    expect((await json('POST', '/api/assignments', '{not json')).status).toBe(400);
  });

  test('the list carries every assignment, and the summary totals unread', async () => {
    const a = await create(false);
    await updateIndex((index) => {
      index.assignments[a.id].unread = 2;
    }, dataDir);
    const list = await json('GET', '/api/assignments');
    expect((list.data.assignments as Assignment[]).map((x) => x.id)).toContain(a.id);
    expect(list.data.pausedAll).toBe(false);
    const summary = await json('GET', '/api/assignments/summary');
    expect(summary.data.unread).toBe(2);
    await json('POST', `/api/assignments/${a.id}/read`);
    expect((await get(a.id)).unread).toBe(0);
  });
});

describe('changing an assignment', () => {
  test('pause, resume, close and reopen move the schedule with the status', async () => {
    const a = await create(false);
    const route = `/api/assignments/${a.id}`;
    await json('PATCH', route, { status: 'paused' });
    expect((await get(a.id)).nextCheckAt).toBeNull();
    await json('PATCH', route, { status: 'active' });
    expect((await get(a.id)).nextCheckAt).toBe(new Date(NOW).toISOString());
    await json('PATCH', route, { status: 'closed' });
    expect(await get(a.id)).toMatchObject({
      status: 'closed',
      outcome: 'Closed by you',
      nextCheckAt: null,
    });
    await json('PATCH', route, { status: 'active' });
    expect(await get(a.id)).toMatchObject({ status: 'active', outcome: null, closedAt: null });
  });

  test('edits the brief, cadence and tool allow-list, and rejects bad values', async () => {
    const a = await create(false);
    const route = `/api/assignments/${a.id}`;
    const { data } = await json('PATCH', route, {
      brief: 'Tell me if Acme drops below 3.5%.',
      cadenceMinutes: 60,
      toolAllowlist: ['get_alerts', 'WebSearch', 'get_alerts'],
    });
    expect(data.assignment).toMatchObject({
      brief: 'Tell me if Acme drops below 3.5%.',
      cadenceMinutes: 60,
      toolAllowlist: ['get_alerts', 'WebSearch'],
    });
    await json('PATCH', route, { toolAllowlist: null });
    expect((await get(a.id)).toolAllowlist).toBeNull();
    expect((await json('PATCH', route, { status: 'done' })).status).toBe(400);
    expect((await json('PATCH', route, { cadenceMinutes: 1.5 })).status).toBe(400);
    expect(
      (await json('PATCH', '/api/assignments/00000000-0000-4000-8000-000000000000', { title: 'x' }))
        .status
    ).toBe(404);
  });

  test('delete removes the assignment and its files, but not while a run is going', async () => {
    const a = await create(true);
    await settled(a.id, 1);
    const transcript = path.join(dataDir, 'assignments', `${a.id}.json`);
    expect(existsSync(transcript)).toBe(true);
    await updateIndex((index) => {
      index.assignments[a.id].running = {
        runId: 'r',
        trigger: 'scheduled',
        startedAt: new Date(NOW).toISOString(),
      };
    }, dataDir);
    expect((await json('DELETE', `/api/assignments/${a.id}`)).status).toBe(409);
    await updateIndex((index) => {
      index.assignments[a.id].running = null;
    }, dataDir);
    expect((await json('DELETE', `/api/assignments/${a.id}`)).data).toEqual({ ok: true });
    expect(await get(a.id)).toBeUndefined();
    expect(existsSync(transcript)).toBe(false);
  });
});

describe('runs the owner starts', () => {
  test('Run now queues a check-in and refuses a second one while it is queued', async () => {
    const a = await create(false);
    await updateIndex((index) => {
      index.assignments[a.id].pendingRun = 'manual';
    }, dataDir);
    expect((await json('POST', `/api/assignments/${a.id}/run`)).status).toBe(409);
    await updateIndex((index) => {
      index.assignments[a.id].pendingRun = null;
    }, dataDir);
    expect((await json('POST', `/api/assignments/${a.id}/run`)).status).toBe(202);
    expect((await settled(a.id, 1)).lastRun?.trigger).toBe('manual');
  });

  test('a message is added to the thread and gets a reply run that sees it', async () => {
    const a = await create(false);
    const res = await json('POST', `/api/assignments/${a.id}/messages`, {
      text: 'Check hourly until Friday.',
    });
    expect(res.status).toBe(202);
    const after = await settled(a.id, 1);
    expect(after.lastRun?.trigger).toBe('message');
    expect(prompts.at(-1)).toContain('Check hourly until Friday.');
    const { data } = await json('GET', `/api/assignments/${a.id}`);
    const kinds = (data.entries as TranscriptEntry[]).map((e) => e.kind);
    expect(kinds).toEqual(['you', 'reply']);
    expect((data.runs as { outcome: string }[])[0].outcome).toBe('ok');
    expect((await json('POST', `/api/assignments/${a.id}/messages`, { text: ' ' })).status).toBe(
      400
    );
  });

  test('pause-all stops everything and resuming clears the reason', async () => {
    await updateIndex((index) => {
      index.pausedAllReason = 'Claude account problem: billing_error';
    }, dataDir);
    await json('POST', '/api/assignments/pause-all', { paused: true });
    expect((await loadIndex(dataDir)).pausedAll).toBe(true);
    await json('POST', '/api/assignments/pause-all', { paused: false });
    const index = await loadIndex(dataDir);
    expect(index.pausedAll).toBe(false);
    expect(index.pausedAllReason).toBeNull();
  });

  test('other paths fall through to the next route', async () => {
    expect(await call('GET', '/api/alerts')).toBeNull();
    expect(await call('GET', '/api/assignments/not-an-id')).toBeNull();
  });
});
