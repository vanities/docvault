import { expect, test, describe } from 'vite-plus/test';
import {
  matchesWatchlist,
  parsePolymarketOutcomePrices,
  normalizeKalshiEvent,
  normalizePolymarketEvent,
  dedupeMarkets,
  kalshiMarketUrl,
  polymarketUrl,
  type PredictionMarket,
} from './prediction-markets.js';

// All fixtures below are fabricated — real API shapes, fake questions.

describe('matchesWatchlist', () => {
  test('matches a finance topic', () => {
    expect(matchesWatchlist('Will the Fed cut rates in July?')).toEqual({
      domain: 'finance',
      topic: 'Fed & rates',
    });
  });

  test('matches a politics topic', () => {
    expect(matchesWatchlist('Will Republicans win control of the House?')).toEqual({
      domain: 'politics',
      topic: 'Congress & control',
    });
  });

  test('EXCLUDE wins over a watchlist hit', () => {
    // "presidential" would match Elections, but this is an excluded novelty.
    expect(matchesWatchlist('Will MrBeast win the 2028 presidential election?')).toBeNull();
  });

  test('drops sports', () => {
    expect(matchesWatchlist('Will the Lakers win the NBA Finals?')).toBeNull();
  });

  test('word-boundary: "fed" does not match "federal"', () => {
    // No watchlist phrase is present; "federal" must not trip the bare "fed" token.
    expect(matchesWatchlist('Will federal employees return to the office?')).toBeNull();
  });

  test('no match returns null', () => {
    expect(matchesWatchlist('Will it rain on Tuesday?')).toBeNull();
  });
});

describe('parsePolymarketOutcomePrices', () => {
  test('[Yes, No] ordering', () => {
    expect(parsePolymarketOutcomePrices('["Yes", "No"]', '["0.62", "0.38"]')).toBe(0.62);
  });

  test('[No, Yes] ordering locates Yes by label', () => {
    expect(parsePolymarketOutcomePrices('["No", "Yes"]', '["0.38", "0.62"]')).toBe(0.62);
  });

  test('rejects non-binary (>2 outcomes)', () => {
    expect(parsePolymarketOutcomePrices('["A","B","C"]', '["0.2","0.3","0.5"]')).toBeNull();
  });

  test('rejects when there is no Yes outcome', () => {
    expect(parsePolymarketOutcomePrices('["Up","Down"]', '["0.5","0.5"]')).toBeNull();
  });

  test('rejects malformed JSON', () => {
    expect(parsePolymarketOutcomePrices('not json', '[]')).toBeNull();
  });

  test('rejects out-of-range prices', () => {
    expect(parsePolymarketOutcomePrices('["Yes","No"]', '["1.5","-0.5"]')).toBeNull();
  });
});

describe('normalizeKalshiEvent', () => {
  test('binary event: price, volume, change, url', () => {
    const ev = {
      event_ticker: 'KXFED-26JUN',
      category: 'Economics',
      title: 'Will the Fed cut in June?',
      markets: [
        {
          status: 'active',
          yes_sub_title: 'Yes',
          last_price_dollars: '0.62',
          yes_bid_dollars: '0.60',
          yes_ask_dollars: '0.64',
          previous_yes_bid_dollars: '0.58',
          volume_24h_fp: '1000',
          open_interest_fp: '2000',
          close_time: '2026-06-30T00:00:00Z',
        },
      ],
    };
    expect(normalizeKalshiEvent(ev)).toMatchObject({
      id: 'KXFED-26JUN',
      source: 'kalshi',
      question: 'Will the Fed cut in June?', // single market → no favorite suffix
      probability: 62,
      volumeUsd: 1240, // max(1000, 2000) * 0.62
      change24h: 4, // (0.62 - 0.58) * 100
      closeTime: '2026-06-30T00:00:00Z',
      url: 'https://kalshi.com/markets/kxfed',
    });
  });

  test('multi-outcome: picks the favorite and labels the question', () => {
    const ev = {
      event_ticker: 'KXNOM-28',
      category: 'Politics',
      title: '2028 nominee',
      markets: [
        {
          status: 'active',
          yes_sub_title: 'Alice',
          last_price_dollars: '0.20',
          open_interest_fp: '100',
        },
        {
          status: 'active',
          yes_sub_title: 'Bob',
          last_price_dollars: '0.35',
          open_interest_fp: '200',
        },
      ],
    };
    const n = normalizeKalshiEvent(ev);
    expect(n?.question).toBe('2028 nominee — Bob');
    expect(n?.probability).toBe(35);
  });

  test('returns null when no active market has a usable price', () => {
    const ev = {
      event_ticker: 'X-1',
      category: 'Economics',
      title: 'Illiquid',
      markets: [
        { status: 'active', last_price_dollars: '', yes_bid_dollars: '', yes_ask_dollars: '' },
      ],
    };
    expect(normalizeKalshiEvent(ev)).toBeNull();
  });
});

describe('normalizePolymarketEvent', () => {
  test('binary event uses the market question', () => {
    const ev = {
      id: '123',
      title: 'MSTR sells BTC?',
      slug: 'mstr-sells-btc',
      volume: 1_000_000,
      markets: [
        {
          question: 'Will MicroStrategy sell any Bitcoin by 2026?',
          outcomes: '["Yes", "No"]',
          outcomePrices: '["0.05", "0.95"]',
          oneDayPriceChange: 0.01,
          endDate: '2026-12-31T00:00:00Z',
          volumeNum: 1_000_000,
        },
      ],
    };
    expect(normalizePolymarketEvent(ev)).toMatchObject({
      id: '123',
      source: 'polymarket',
      question: 'Will MicroStrategy sell any Bitcoin by 2026?',
      probability: 5,
      volumeUsd: 1_000_000,
      change24h: 1,
      url: 'https://polymarket.com/event/mstr-sells-btc',
    });
  });

  test('multi-outcome: favorite + labeled question', () => {
    const ev = {
      id: '9',
      title: 'Dem Nominee 2028',
      slug: 'dem-2028',
      volume: 5000,
      markets: [
        { groupItemTitle: 'Alice', outcomes: '["Yes","No"]', outcomePrices: '["0.10","0.90"]' },
        { groupItemTitle: 'Bob', outcomes: '["Yes","No"]', outcomePrices: '["0.25","0.75"]' },
      ],
    };
    const n = normalizePolymarketEvent(ev);
    expect(n?.question).toBe('Dem Nominee 2028 — Bob');
    expect(n?.probability).toBe(25);
  });

  test('returns null when no market is a priced binary', () => {
    const ev = {
      id: '5',
      title: 'Three-way',
      slug: 'three-way',
      volume: 100,
      markets: [{ outcomes: '["A","B","C"]', outcomePrices: '["0.2","0.3","0.5"]' }],
    };
    expect(normalizePolymarketEvent(ev)).toBeNull();
  });
});

describe('dedupeMarkets', () => {
  const base: Omit<PredictionMarket, 'id' | 'source'> = {
    question: 'q',
    probability: 50,
    volumeUsd: 1,
    closeTime: null,
    url: 'https://example.com',
    domain: 'finance',
    topic: 't',
  };

  test('drops duplicate source:id, keeps same id across providers', () => {
    const out = dedupeMarkets([
      { ...base, id: 'A', source: 'kalshi' },
      { ...base, id: 'A', source: 'kalshi' }, // dup
      { ...base, id: 'A', source: 'polymarket' }, // same id, different provider — kept
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((m) => m.source)).toEqual(['kalshi', 'polymarket']);
  });
});

describe('url builders', () => {
  test('kalshiMarketUrl lowercases the series ticker', () => {
    expect(kalshiMarketUrl('KXFEDDECISION-26JUN')).toBe('https://kalshi.com/markets/kxfeddecision');
    expect(kalshiMarketUrl('KXFED')).toBe('https://kalshi.com/markets/kxfed');
  });

  test('polymarketUrl prefers the event slug', () => {
    expect(polymarketUrl({ slug: 'abc' })).toBe('https://polymarket.com/event/abc');
    expect(polymarketUrl({ markets: [{ slug: 'm1' }] })).toBe('https://polymarket.com/market/m1');
    expect(polymarketUrl({})).toBe('https://polymarket.com');
  });
});
