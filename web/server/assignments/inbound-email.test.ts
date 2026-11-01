// The inbound reply poller against a faked Resend receiving API, in an isolated data directory.
// Fabricated assignment, addresses and tokens only; no network and nothing reaches Resend.
import { afterAll, beforeEach, describe, expect, test, vi } from 'vite-plus/test';
import { rmSync } from 'node:fs';

const dataDir = vi.hoisted(() => {
  const os = require('node:os') as typeof import('node:os');
  const p = require('node:path') as typeof import('node:path');
  const dir = p.join(os.tmpdir(), `docvault-assignments-inbound-${Date.now()}`);
  process.env.DOCVAULT_DATA_DIR = dir;
  return dir;
});
vi.mock('../ai/usage-log.js', () => ({ logAiCall: vi.fn(async () => {}) }));

import { pollInboundEmails, type InboundDeps } from './inbound-email.js';
import { buildReplyLocalPart } from './reply-address.js';
import { blankAssignment, loadTranscript, newId, updateIndex } from './store.js';
import type { Assignment } from './types.js';

const DOMAIN = 'replies.example.test';
const OWNER = 'owner@example.com';
const NOW = '2030-01-02T15:00:00.000Z';

type Fixture = {
  id: string;
  to: string[];
  from: string;
  text?: string | null;
  html?: string | null;
  headers?: Record<string, string> | { name: string; value: string }[];
  authentication?: Record<string, unknown>;
};

let inbox: Fixture[] = [];
const fetchCalls: string[] = [];
const fetchFn = (async (url: string | URL) => {
  const u = String(url);
  fetchCalls.push(u);
  const byId = /\/emails\/receiving\/([^/?]+)$/.exec(u);
  const body = byId
    ? (inbox.find((e) => e.id === byId[1]) ?? null)
    : { object: 'list', data: inbox.map(({ id, to, from }) => ({ id, to, from })) };
  return {
    ok: body !== null,
    status: body === null ? 404 : 200,
    json: async () => body,
  } as Response;
}) as unknown as typeof fetch;

const requestRun = vi.fn(async () => ({ status: 'ok' }));

function deps(over: Partial<InboundDeps> = {}): InboundDeps {
  return {
    dataDir,
    now: () => new Date(NOW),
    fetchFn,
    apiKey: async () => 're_test_key',
    replyDomain: async () => DOMAIN,
    recipient: async () => OWNER,
    requestRun: requestRun as unknown as InboundDeps['requestRun'],
    ...over,
  };
}

async function createAssignment(over: Partial<Assignment> = {}): Promise<Assignment> {
  const id = newId();
  const a = {
    ...blankAssignment(
      {
        id,
        title: 'Watch Acme Bank rates',
        brief: 'Tell me if Acme Bank savings drops below 4%.',
        cadenceMinutes: 180,
      },
      NOW
    ),
    ...over,
  };
  await updateIndex((index) => {
    index.assignments[id] = a;
  }, dataDir);
  return a;
}

const replyAddress = (a: Assignment) => `${buildReplyLocalPart(a.id, a.replyToken!)}@${DOMAIN}`;

beforeEach(async () => {
  inbox = [];
  fetchCalls.length = 0;
  requestRun.mockClear();
  await updateIndex((index) => {
    index.assignments = {};
  }, dataDir);
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('a reply from the owner', () => {
  test('becomes a thread message with the quoted history stripped, and starts a reply run', async () => {
    const a = await createAssignment();
    inbox = [
      {
        id: 'rcv-1',
        to: [replyAddress(a)],
        from: `Owner <${OWNER}>`,
        text: 'Switch to hourly checks.\n\nOn Sat, Nov 1, 2026 at 9:00 AM DocVault Assignments <x@y> wrote:\n> Not safe yet',
        authentication: { spf: 'pass', dkim: 'pass', dmarc: 'pass' },
      },
    ];
    expect(await pollInboundEmails(deps())).toBe(1);
    const [entry] = await loadTranscript(a.id, dataDir);
    expect(entry).toMatchObject({
      kind: 'you',
      via: 'email',
      markdown: 'Switch to hourly checks.',
    });
    expect(requestRun).toHaveBeenCalledWith(a.id, 'message');

    // The second poll sees the same email and does nothing: it is in the seen ledger.
    expect(await pollInboundEmails(deps())).toBe(0);
    expect(await loadTranscript(a.id, dataDir)).toHaveLength(1);
    expect(requestRun).toHaveBeenCalledTimes(1);
  });

  test('an html-only reply is de-tagged before it is stored', async () => {
    const a = await createAssignment();
    inbox = [
      {
        id: 'rcv-html',
        to: [replyAddress(a)],
        from: OWNER,
        text: null,
        html: '<div dir="ltr"><p>Looks <b>good</b>, keep going.</p></div>',
      },
    ];
    expect(await pollInboundEmails(deps())).toBe(1);
    const [entry] = await loadTranscript(a.id, dataDir);
    expect(entry.markdown).toBe('Looks good , keep going.');
  });

  test('is recorded without starting a second run while one is already queued', async () => {
    const a = await createAssignment({ pendingRun: 'manual' });
    inbox = [{ id: 'rcv-2', to: [replyAddress(a)], from: OWNER, text: 'Also check Base fees.' }];
    expect(await pollInboundEmails(deps())).toBe(1);
    expect(await loadTranscript(a.id, dataDir)).toHaveLength(1);
    expect(requestRun).not.toHaveBeenCalled();
  });
});

describe('what the poller refuses', () => {
  test('an address with the wrong token never reaches a thread', async () => {
    const a = await createAssignment();
    inbox = [
      {
        id: 'rcv-3',
        to: [`a-${a.id.slice(0, 8)}-ffffffffffffffff@${DOMAIN}`],
        from: OWNER,
        text: 'Spoofed.',
      },
    ];
    expect(await pollInboundEmails(deps())).toBe(0);
    expect(await loadTranscript(a.id, dataDir)).toHaveLength(0);
    // No assignment matched, so the full email is never even retrieved.
    expect(fetchCalls.some((u) => u.includes('/receiving/rcv-3'))).toBe(false);
  });

  test('a sender other than the owner, even with a valid token', async () => {
    const a = await createAssignment();
    inbox = [
      { id: 'rcv-4', to: [replyAddress(a)], from: 'attacker@example.net', text: 'Do bad things.' },
    ];
    expect(await pollInboundEmails(deps())).toBe(0);
    expect(await loadTranscript(a.id, dataDir)).toHaveLength(0);
    expect(requestRun).not.toHaveBeenCalled();
  });

  test('auto-generated mail, so an out-of-office cannot start a run loop', async () => {
    const a = await createAssignment();
    inbox = [
      {
        id: 'rcv-5',
        to: [replyAddress(a)],
        from: OWNER,
        text: 'I am out of the office.',
        headers: { 'Auto-Submitted': 'auto-replied' },
      },
    ];
    expect(await pollInboundEmails(deps())).toBe(0);
    expect(await loadTranscript(a.id, dataDir)).toHaveLength(0);
  });

  test('an email whose SPF, DKIM and DMARC all failed; one failed check alone is fine', async () => {
    const a = await createAssignment();
    inbox = [
      {
        id: 'rcv-6',
        to: [replyAddress(a)],
        from: OWNER,
        text: 'Forged.',
        authentication: { spf: 'fail', dkim: { result: 'fail' }, dmarc: 'fail' },
      },
    ];
    expect(await pollInboundEmails(deps())).toBe(0);

    inbox = [
      {
        id: 'rcv-7',
        to: [replyAddress(a)],
        from: OWNER,
        text: 'Forwarded through a relay.',
        authentication: { spf: 'fail', dkim: 'pass', dmarc: 'pass' },
      },
    ];
    expect(await pollInboundEmails(deps())).toBe(1);
    expect(await loadTranscript(a.id, dataDir)).toHaveLength(1);
  });

  test('a reply that is empty once the quoted history is stripped', async () => {
    const a = await createAssignment();
    inbox = [
      {
        id: 'rcv-8',
        to: [replyAddress(a)],
        from: OWNER,
        text: '\nOn Sat, Nov 1, 2026 at 9:00 AM DocVault <x@y> wrote:\n> old text',
      },
    ];
    expect(await pollInboundEmails(deps())).toBe(0);
    expect(await loadTranscript(a.id, dataDir)).toHaveLength(0);
  });
});

describe('configuration', () => {
  test('without a reply domain or API key the poller never calls Resend', async () => {
    await createAssignment();
    expect(await pollInboundEmails(deps({ replyDomain: async () => null }))).toBe(0);
    expect(await pollInboundEmails(deps({ apiKey: async () => null }))).toBe(0);
    expect(fetchCalls).toHaveLength(0);
  });
});
