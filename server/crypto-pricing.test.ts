// Synthetic balances and provider failures in an isolated data directory.
import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  loadSettings: async () => ({
    crypto: {
      exchanges: [],
      wallets: [],
      manualHoldings: [{ id: 'example', asset: 'BTC', amount: 2 }],
    },
  }),
  saveSettings: vi.fn(),
  jsonResponse: (data: unknown, status = 200) => Response.json(data, { status }),
}));
mocks.dataDir = await mkdtemp(path.join(tmpdir(), 'docvault-crypto-pricing-'));

beforeEach(async () => {
  vi.resetModules();
  mocks.quotes.mockReset().mockResolvedValue({ quotes: [] });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 403 })));
  await rm(path.join(mocks.dataDir, '.docvault-crypto-prices.json'), { force: true });
  await rm(path.join(mocks.dataDir, '.docvault-crypto-cache.json'), { force: true });
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => rm(mocks.dataDir, { force: true, recursive: true }));

test('a cold-start CoinGecko 403 uses USD fallback quotes instead of saving zero valuations', async () => {
  mocks.quotes.mockResolvedValue({
    quotes: [{ symbol: 'BTC-USD', price: 123, currency: 'USD', error: null }],
  });
  const { fetchAllBalances } = await import('./crypto');
  const result = await fetchAllBalances([], [], undefined, [
    { id: 'example', asset: 'BTC', amount: 2 },
  ]);
  expect(result.totalUsdValue).toBe(246);
  expect(result.byAsset[0].usdValue).toBe(246);
});

test('cached prices survive a restart and failed providers', async () => {
  mocks.quotes.mockResolvedValue({
    quotes: [{ symbol: 'BTC-USD', price: 123, currency: 'USD', error: null }],
  });
  let api = await import('./crypto');
  await api.fetchPrices(['BTC']);
  expect(
    JSON.parse(await readFile(path.join(mocks.dataDir, '.docvault-crypto-prices.json'), 'utf8'))
      .prices.BTC
  ).toBe(123);
  vi.resetModules();
  mocks.quotes.mockRejectedValue(new Error('Provider down'));
  api = await import('./crypto');
  const result = await api.fetchAllBalances([], [], undefined, [
    { id: 'example', asset: 'BTC', amount: 2 },
  ]);
  expect(result.totalUsdValue).toBe(246);
});

test('can seed prices from a previously valued portfolio on the first upgrade', async () => {
  await writeFile(
    path.join(mocks.dataDir, '.docvault-crypto-cache.json'),
    JSON.stringify({
      byAsset: [{ asset: 'BTC', amount: 2, usdValue: 246 }],
    })
  );
  const { fetchAllBalances } = await import('./crypto');
  expect(
    (await fetchAllBalances([], [], undefined, [{ id: 'example', asset: 'BTC', amount: 2 }]))
      .totalUsdValue
  ).toBe(246);
});

test('rejects an unpriced known holding when both providers and caches are unavailable', async () => {
  const { fetchAllBalances } = await import('./crypto');
  await expect(
    fetchAllBalances([], [], undefined, [{ id: 'example', asset: 'BTC', amount: 2 }])
  ).rejects.toThrow(/price/i);
});

test('a partial quote response cannot silently value a second known asset at zero', async () => {
  mocks.quotes.mockResolvedValue({
    quotes: [
      { symbol: 'BTC-USD', price: 123, currency: 'USD', error: null },
      { symbol: 'ETH-USD', price: 50, currency: 'EUR', error: null },
    ],
  });
  const { fetchAllBalances } = await import('./crypto');
  await expect(
    fetchAllBalances([], [], undefined, [
      { id: 'example-btc', asset: 'BTC', amount: 2 },
      { id: 'example-eth', asset: 'ETH', amount: 1 },
    ])
  ).rejects.toThrow(/ETH/);
});

test('USD cash remains valued when the price provider is down', async () => {
  const { fetchAllBalances } = await import('./crypto');
  const result = await fetchAllBalances([], [], undefined, [
    { id: 'cash', asset: 'USD', amount: 25 },
  ]);
  expect(result.totalUsdValue).toBe(25);
});

test('Kraken fills a Yahoo coverage gap using the USD last trade, not another quote currency', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.includes('kraken.com')
        ? Response.json({
            error: [],
            result: { 'IMX/USD': { c: ['0.25', '100'] }, 'IMX/EUR': { c: ['999', '100'] } },
          })
        : new Response('', { status: 403 })
    )
  );
  const { fetchAllBalances } = await import('./crypto');
  const result = await fetchAllBalances([], [], undefined, [
    { id: 'example', asset: 'IMX', amount: 4 },
  ]);
  expect(result.totalUsdValue).toBe(1);
});

test('Coinbase rates are inverted to USD per coin and used before extra Yahoo requests', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.includes('api.coinbase.com')
        ? Response.json({ data: { currency: 'USD', rates: { RNDR: '2' } } })
        : new Response('', { status: 403 })
    )
  );
  const { fetchAllBalances } = await import('./crypto');
  const result = await fetchAllBalances([], [], undefined, [
    { id: 'example', asset: 'RNDR', amount: 4 },
  ]);
  expect(result.totalUsdValue).toBe(2);
  expect(mocks.quotes.mock.calls[0][0]).not.toContain('RNDR-USD');
});

test('a genuinely empty balance can still have a zero valuation', async () => {
  const { fetchAllBalances } = await import('./crypto');
  const result = await fetchAllBalances([], [], undefined, [
    { id: 'example', asset: 'BTC', amount: 0 },
  ]);
  expect(result.totalUsdValue).toBe(0);
});

test('an already-corrupted portfolio cache is rejected', async () => {
  const { assertCryptoValued } = await import('./crypto');
  expect(() =>
    assertCryptoValued({
      sources: [
        {
          sourceId: 'example',
          sourceType: 'manual',
          label: 'Example',
          lastUpdated: '',
          balances: [{ asset: 'BTC', amount: 2, usdValue: 0 }],
          totalUsdValue: 0,
        },
      ],
      totalUsdValue: 0,
    })
  ).toThrow(/prices unavailable/i);
});

test('a streaming refresh reports missing prices and leaves the saved portfolio unchanged', async () => {
  const file = path.join(mocks.dataDir, '.docvault-crypto-cache.json');
  const previous = JSON.stringify({
    totalUsdValue: 25,
    byAsset: [{ asset: 'USD', amount: 25, usdValue: 25 }],
  });
  await writeFile(file, previous);
  const { handleCryptoRoutes } = await import('./routes/crypto');
  const url = new URL('http://localhost/api/crypto/balances?stream=1');
  const response = await handleCryptoRoutes(new Request(url), url, url.pathname);
  const messages = (await response!.text())
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  expect(
    messages.some((message) => message.type === 'error' && message.message.includes('BTC'))
  ).toBe(true);
  expect(messages.some((message) => message.type === 'result')).toBe(false);
  expect(await readFile(file, 'utf8')).toBe(previous);
});
