// Resend retries, against a faked Resend API with fabricated addresses. Nothing is sent, and
// the sent-mail log is captured in memory instead of written.
import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const mocks = vi.hoisted(() => ({
  dataDir: '',
  entries: [] as Record<string, unknown>[],
  down: vi.fn(async () => false),
}));
vi.mock('./data.js', () => ({
  get DATA_DIR() {
    return mocks.dataDir;
  },
  getEmailConfig: async () => ({
    apiKey: 'example-key',
    fromEmail: 'alerts@example.com',
    fromName: 'Example',
    toEmail: 'owner@example.com',
    cc: {},
  }),
}));
vi.mock('./email-log.js', () => ({
  appendEmailLog: async (entry: Record<string, unknown>) => {
    mocks.entries.push(entry);
  },
}));
vi.mock('./connectivity.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./connectivity.js')>()),
  internetIsDown: mocks.down,
}));
mocks.dataDir = await mkdtemp(path.join(tmpdir(), 'docvault-email-send-'));

const { sendEmail } = await import('./email');

type Reply = () => Response | Promise<Response>;
let replies: Reply[];
let calls: RequestInit[];

beforeEach(() => {
  vi.useFakeTimers();
  mocks.entries.length = 0;
  mocks.down.mockReset().mockResolvedValue(false);
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      calls.push(init);
      const next = replies.shift();
      if (!next) throw new Error('unexpected send');
      return next();
    })
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
afterAll(() => rm(mocks.dataDir, { force: true, recursive: true }));

const dropped: Reply = () => {
  throw new Error('ECONNRESET: The socket connection was closed unexpectedly.');
};
const accepted: Reply = () => Response.json({ id: 'msg_example' });
const unavailable: Reply = () => new Response('{"name":"internal_server_error"}', { status: 503 });
const keyOf = (init: RequestInit) => (init.headers as Record<string, string>)['Idempotency-Key'];

async function send() {
  const run = sendEmail({ purpose: 'test', subject: 'Alert warning: example', html: '<p>hi</p>' });
  await vi.runAllTimersAsync();
  return run;
}

test('a dropped connection is retried under the same idempotency key', async () => {
  replies = [dropped, accepted];
  const result = await send();
  expect(result).toEqual({ ok: true, id: 'msg_example' });
  expect(calls).toHaveLength(2);
  expect(keyOf(calls[0])).toMatch(/^[0-9a-f-]{36}$/);
  expect(keyOf(calls[1]), 'a retry must reuse the key, or Resend could mail it twice').toBe(
    keyOf(calls[0])
  );
  expect(mocks.entries).toEqual([
    expect.objectContaining({ ok: true, providerId: 'msg_example', attempts: 2 }),
  ]);
});

test('a Resend 5xx is retried, up to three requests, and logged once', async () => {
  replies = [unavailable, unavailable, unavailable];
  const result = await send();
  expect(result.ok).toBe(false);
  expect(calls).toHaveLength(3);
  expect(mocks.entries).toEqual([expect.objectContaining({ ok: false, attempts: 3 })]);
});

test('an email Resend rejects is not retried', async () => {
  replies = [
    () =>
      Response.json({ name: 'validation_error', message: 'Invalid `to` field.' }, { status: 422 }),
  ];
  const result = await send();
  expect(result.ok).toBe(false);
  expect(calls).toHaveLength(1);
  expect(mocks.entries[0]).not.toHaveProperty('attempts');
});

test('while the internet is down the failure is left to the outage handling', async () => {
  mocks.down.mockResolvedValue(true);
  replies = [
    () => {
      throw new Error('getaddrinfo EAI_AGAIN api.resend.com');
    },
  ];
  const result = await send();
  expect(result).toEqual(expect.objectContaining({ ok: false, offline: true }));
  expect(calls).toHaveLength(1);
});

test('no retry starts once the time budget is spent', async () => {
  replies = [
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 19_000));
      throw new Error('The operation timed out.');
    },
    accepted,
  ];
  const result = await send();
  expect(result.ok).toBe(false);
  expect(calls, 'the alert job waiting on this send gives up at 30s').toHaveLength(1);
});
