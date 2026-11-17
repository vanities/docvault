// Gemini retries, against a faked Gemini API with fabricated balances and keys, in an isolated
// data directory.
import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const mocks = vi.hoisted(() => ({ quotes: vi.fn(), dataDir: '' }));
vi.mock('./ticker-prices.js', () => ({ fetchTickerPrices: mocks.quotes }));
vi.mock('./data.js', () => ({
  get DATA_DIR() {
    return mocks.dataDir;
  },
  get CRYPTO_CACHE_FILE() {
    return path.join(mocks.dataDir, '.docvault-crypto-cache.json');
  },
}));
mocks.dataDir = await mkdtemp(path.join(tmpdir(), 'docvault-crypto-gemini-'));
// Captured before fake timers replace it: the read does real file I/O (the price cache) before
// it schedules a retry, so the fake clock can only move after that I/O has landed.
const realSetTimeout = globalThis.setTimeout;

const GEMINI = {
  id: 'gemini' as const,
  enabled: true,
  apiKey: 'example-key',
  apiSecret: 'example-secret',
};
// The page Gemini's gateway sends after holding a request for 60s.
const GATEWAY_PAGE =
  '<html>\r\n<head><title>504 Gateway Time-out</title></head>\r\n<body>\r\n<center><h1>504 Gateway Time-out</h1></center>\r\n</body>\r\n</html>\r\n';

type Reply = () => Response;
let replies: Reply[];
let geminiCalls: RequestInit[];

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  mocks.quotes.mockReset().mockResolvedValue({
    quotes: [{ symbol: 'BTC-USD', price: 100, currency: 'USD', error: null }],
  });
  geminiCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      if (!String(url).startsWith('https://api.gemini.com/'))
        return new Response('', { status: 403 });
      geminiCalls.push(init);
      const next = replies.shift();
      if (!next) throw new Error('unexpected Gemini call');
      return next();
    })
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
afterAll(() => rm(mocks.dataDir, { force: true, recursive: true }));

const gatewayTimeout: Reply = () => new Response(GATEWAY_PAGE, { status: 504 });
const balances: Reply = () => Response.json([{ currency: 'btc', amount: '2' }]);
const nonceOf = (init: RequestInit) =>
  JSON.parse(
    Buffer.from((init.headers as Record<string, string>)['X-GEMINI-PAYLOAD'], 'base64').toString()
  ).nonce;

async function readGemini() {
  const { fetchAllBalances } = await import('./crypto');
  const answered: string[] = [];
  const failed: Array<{ sourceId: string; error?: string }> = [];
  const run = fetchAllBalances(
    [GEMINI],
    [],
    undefined,
    [],
    undefined,
    (source) => answered.push(source.sourceId),
    (source) => failed.push({ sourceId: source.sourceId, error: source.error })
  );
  let done = false;
  const settled = run.then(
    (value) => ({ value, error: null }),
    (error: Error) => ({ value: null, error })
  );
  void settled.finally(() => (done = true));
  for (let i = 0; i < 100 && !done; i++) {
    await new Promise((resolve) => realSetTimeout(resolve, 1));
    await vi.advanceTimersByTimeAsync(1_000);
  }
  return { ...(await settled), answered, failed };
}

test('a Gemini gateway timeout is retried with a fresh nonce and the read succeeds', async () => {
  replies = [gatewayTimeout, balances];
  const read = await readGemini();
  expect(read.error).toBeNull();
  expect(read.value?.totalUsdValue).toBe(200);
  expect(read.answered).toEqual(['gemini']);
  expect(geminiCalls).toHaveLength(2);
  expect(nonceOf(geminiCalls[1]), 'Gemini refuses a nonce it has already seen').not.toBe(
    nonceOf(geminiCalls[0])
  );
});

test('three gateway timeouts fail the source with readable text, not the HTML page', async () => {
  replies = [gatewayTimeout, gatewayTimeout, gatewayTimeout];
  const read = await readGemini();
  const reason = 'Gemini API error 504: 504 Gateway Time-out 504 Gateway Time-out';
  expect(geminiCalls).toHaveLength(3);
  expect(read.failed, 'the stream names the failed source').toEqual([
    { sourceId: 'gemini', error: reason },
  ]);
  expect(read.error?.message, 'a total with a hole in it is still refused').toBe(
    `Crypto source unavailable: ${reason}`
  );
});

test('a refused request is not retried', async () => {
  replies = [() => Response.json({ result: 'error', reason: 'InvalidSignature' }, { status: 400 })];
  const read = await readGemini();
  expect(geminiCalls).toHaveLength(1);
  expect(read.failed[0].error).toMatch(/^Gemini API error 400: /);
});
