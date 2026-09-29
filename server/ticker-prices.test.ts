// Synthetic chart responses and an isolated cache; never touches NAS data.
import { afterAll, beforeEach, expect, test, vi } from 'vite-plus/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const mocks = vi.hoisted(() => ({ chart: vi.fn(), dataDir: '' }));
vi.mock('yahoo-finance2', () => ({
  default: class {
    chart = mocks.chart;
  },
}));
vi.mock('./data.js', () => ({
  get DATA_DIR() {
    return mocks.dataDir;
  },
  ensureDir: vi.fn(),
}));

mocks.dataDir = await mkdtemp(path.join(tmpdir(), 'docvault-quote-test-'));
const cacheFile = path.join(mocks.dataDir, '.docvault-ticker-cache.json');
const { fetchTickerPrices } = await import('./ticker-prices');

beforeEach(async () => {
  await rm(cacheFile, { force: true });
  mocks.chart.mockReset();
});
afterAll(async () => {
  await rm(mocks.dataDir, { force: true, recursive: true });
});

test('returns historical changes from the same chart request and reuses the cached quote', async () => {
  mocks.chart.mockResolvedValue({
    meta: {
      currency: 'USD',
      regularMarketPrice: 120,
      regularMarketTime: new Date('2025-03-31T19:00:00Z'),
      exchangeTimezoneName: 'America/New_York',
    },
    quotes: [{ date: new Date('2025-03-28T20:00:00Z'), close: 100 }],
  });
  const first = await fetchTickerPrices(['ACME']);
  expect(first.quotes[0].performance?.changes['1D']?.percent).toBe(20);
  expect(first.fetched).toBe(1);
  const second = await fetchTickerPrices(['ACME']);
  expect(second.cached).toBe(1);
  expect(mocks.chart).toHaveBeenCalledTimes(1);
  expect(JSON.parse(await readFile(cacheFile, 'utf8')).quotes.ACME.performance).toEqual(
    first.quotes[0].performance
  );
});

test('refreshes legacy cache entries without performance, even inside their TTL', async () => {
  await writeFile(
    cacheFile,
    JSON.stringify({
      version: 1,
      quotes: {
        ACME: { symbol: 'ACME', price: 100, fetchedAt: new Date().toISOString(), error: null },
      },
    })
  );
  mocks.chart.mockRejectedValue(new Error('Quote unavailable'));
  const result = await fetchTickerPrices(['ACME']);
  expect(mocks.chart).toHaveBeenCalledTimes(1);
  expect(result.quotes[0].performance).toBeNull();
  expect(result.quotes[0].error).toBe('Quote unavailable');
});
