// Regression test for the Sunday $0 gold craters in the portfolio history.
//
// Metals futures (GC=F et al) are closed all weekend. Yahoo's spark endpoint
// then returns `close: null, timestamp: []` while still carrying
// `chartPreviousClose`. The old parser read only the intraday series, came back
// with an empty price map, and every holding priced at $0 — which wrote a
// zeroed goldValue (and a dented totalValue) into that day's snapshot forever.
//
// All prices here are fabricated round numbers, not real quotes.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test';

// data.ts resolves DOCVAULT_DATA_DIR at import time, so it has to be redirected
// before any import of ./data.js is evaluated — hence vi.hoisted, which runs
// ahead of the import graph (and therefore cannot use imported helpers).
// The path deliberately does not exist: nothing in this file should write, and
// a stray write should fail loudly rather than land in the real data dir.
vi.hoisted(() => {
  process.env.DOCVAULT_DATA_DIR = `/tmp/docvault-metal-test-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
});

/** Fresh module instance per call so the in-process price cache starts empty. */
async function freshFetchSpot() {
  vi.resetModules();
  const mod = await import('./data.js');
  return mod.fetchMetalSpotPrices;
}

const realFetch = globalThis.fetch;

function stubYahoo(payload: unknown, ok = true) {
  globalThis.fetch = vi.fn(async () =>
    ok
      ? new Response(JSON.stringify(payload), { status: 200 })
      : new Response('nope', { status: 503 })
  ) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('fetchMetalSpotPrices', () => {
  test('market closed (weekend): falls back to chartPreviousClose instead of $0', async () => {
    // Exactly the shape Yahoo serves on a Sunday.
    stubYahoo({
      'GC=F': { symbol: 'GC=F', timestamp: [], close: null, chartPreviousClose: 4000 },
      'SI=F': { symbol: 'SI=F', timestamp: [], close: null, chartPreviousClose: 70 },
      'PL=F': { symbol: 'PL=F', timestamp: [], close: null, chartPreviousClose: 1800 },
      'PA=F': { symbol: 'PA=F', timestamp: [], close: null, chartPreviousClose: 1300 },
    });

    const fetchMetalSpotPrices = await freshFetchSpot();
    const prices = await fetchMetalSpotPrices();

    expect(prices.gold).toBe(4000);
    expect(prices.silver).toBe(70);
    expect(prices.platinum).toBe(1800);
    expect(prices.palladium).toBe(1300);
  });

  test('market open: the intraday close wins over the previous settle', async () => {
    stubYahoo({
      'GC=F': { symbol: 'GC=F', close: [3990, 4010], chartPreviousClose: 4000 },
    });

    const fetchMetalSpotPrices = await freshFetchSpot();
    const prices = await fetchMetalSpotPrices();

    expect(prices.gold).toBe(4010);
  });

  test('previousClose is accepted when chartPreviousClose is absent', async () => {
    stubYahoo({ 'GC=F': { symbol: 'GC=F', close: null, previousClose: 3950 } });

    const fetchMetalSpotPrices = await freshFetchSpot();
    expect((await fetchMetalSpotPrices()).gold).toBe(3950);
  });

  test('an unusable payload yields an empty map, never a map of zeros', async () => {
    // The dangerous case: a price of 0 must never reach a caller doing
    // `spotPrices[metal] || 0`, because it is indistinguishable from "free".
    stubYahoo({ 'GC=F': { symbol: 'GC=F', close: null, chartPreviousClose: null } });

    const fetchMetalSpotPrices = await freshFetchSpot();
    const prices = await fetchMetalSpotPrices();

    expect(prices).toEqual({});
    expect(Object.values(prices).some((p) => p === 0)).toBe(false);
  });

  test('an HTTP error yields an empty map rather than zeroed prices', async () => {
    stubYahoo(null, false);

    const fetchMetalSpotPrices = await freshFetchSpot();
    expect(await fetchMetalSpotPrices()).toEqual({});
  });
});
