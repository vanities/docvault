// Overlapping balance reads share one sweep. Fabricated holdings and keys, a faked Gemini API
// that answers only when a test releases it, and an isolated data directory.
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
mocks.dataDir = await mkdtemp(path.join(tmpdir(), 'docvault-crypto-sweep-'));

const GEMINI = {
  id: 'gemini' as const,
  enabled: true,
  apiKey: 'example-key',
  apiSecret: 'example-secret',
};
const HELD = { id: 'example-cold-wallet', asset: 'BTC', amount: 1, label: 'Example cold wallet' };

let geminiCalls = 0;
let geminiReply: () => Response;
let release: () => void;

beforeEach(() => {
  vi.resetModules();
  mocks.quotes.mockReset().mockResolvedValue({
    quotes: [{ symbol: 'BTC-USD', price: 100, currency: 'USD', error: null }],
  });
  geminiCalls = 0;
  geminiReply = () => Response.json([{ currency: 'btc', amount: '2' }]);
  const gate = new Promise<void>((resolve) => (release = resolve));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (!String(url).startsWith('https://api.gemini.com/'))
        return new Response('', { status: 403 });
      geminiCalls++;
      await gate;
      return geminiReply();
    })
  );
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => rm(mocks.dataDir, { force: true, recursive: true }));

const geminiAsked = (n: number) => vi.waitFor(() => expect(geminiCalls).toBe(n));

test('a read that starts while another is running joins it instead of starting a second', async () => {
  const { fetchAllBalances } = await import('./crypto');
  const late: string[] = [];
  const first = fetchAllBalances([GEMINI], [], undefined, [HELD]);
  await geminiAsked(1);
  const second = fetchAllBalances([GEMINI], [], undefined, [HELD], undefined, (source) =>
    late.push(source.sourceId)
  );
  release();
  const [a, b] = await Promise.all([first, second]);
  expect(geminiCalls, 'one sweep reads Gemini once').toBe(1);
  expect(b).toEqual(a);
  expect(b, 'each caller gets its own copy').not.toBe(a);
  expect(a.totalUsdValue).toBe(300);
  expect(late, 'the joiner gets the source it missed, then the live one').toEqual([
    'example-cold-wallet',
    'gemini',
  ]);
});

test('a read with a different config runs its own sweep', async () => {
  const { fetchAllBalances } = await import('./crypto');
  const withHolding = fetchAllBalances([GEMINI], [], undefined, [HELD]);
  await geminiAsked(1);
  const without = fetchAllBalances([GEMINI], [], undefined, []);
  await geminiAsked(2);
  release();
  const [a, b] = await Promise.all([withHolding, without]);
  expect([a.totalUsdValue, b.totalUsdValue]).toEqual([300, 200]);
});

test('a read after the sweep finished starts a fresh one', async () => {
  const { fetchAllBalances } = await import('./crypto');
  release();
  await fetchAllBalances([GEMINI], [], undefined, [HELD]);
  await fetchAllBalances([GEMINI], [], undefined, [HELD]);
  expect(geminiCalls).toBe(2);
});

test('a failed sweep fails every caller that shared it', async () => {
  const { fetchAllBalances } = await import('./crypto');
  geminiReply = () =>
    Response.json({ result: 'error', reason: 'InvalidSignature' }, { status: 400 });
  const first = fetchAllBalances([GEMINI], [], undefined, [HELD]);
  await geminiAsked(1);
  const second = fetchAllBalances([GEMINI], [], undefined, [HELD]);
  release();
  await expect(first).rejects.toThrow(/^Crypto source unavailable: Gemini API error 400/);
  await expect(second).rejects.toThrow(/^Crypto source unavailable: Gemini API error 400/);
});

test("one caller's failing callback doesn't end the read for the others", async () => {
  const { fetchAllBalances } = await import('./crypto');
  const first = fetchAllBalances([GEMINI], [], undefined, [HELD], undefined, () => {
    throw new Error('client went away');
  });
  await geminiAsked(1);
  const second = fetchAllBalances([GEMINI], [], undefined, [HELD]);
  release();
  await expect(second).resolves.toMatchObject({ totalUsdValue: 300 });
  await expect(first).resolves.toMatchObject({ totalUsdValue: 300 });
});

test('hand-entered holdings are sent before any exchange answers, and stay last in the result', async () => {
  const { fetchAllBalances } = await import('./crypto');
  const seen: string[] = [];
  const read = fetchAllBalances([GEMINI], [], undefined, [HELD], undefined, (source) =>
    seen.push(source.sourceId)
  );
  await geminiAsked(1);
  expect(seen, 'sent while Gemini is still pending').toEqual(['example-cold-wallet']);
  release();
  const result = await read;
  expect(result.sources.map((source) => source.sourceId)).toEqual([
    'gemini',
    'example-cold-wallet',
  ]);
});
