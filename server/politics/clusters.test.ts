// Cross-member trade clustering — pure-logic tests. Synthetic trades only, no
// real names or personal data.

import { describe, expect, test } from 'vite-plus/test';
import { detectTradeClusters } from './clusters.js';
import type { TradeRecord } from './types.js';

let seq = 0;
function trade(
  p: Partial<TradeRecord> & { politicianName: string; ticker: string; tradeDate: string }
): TradeRecord {
  seq += 1;
  const category = p.category ?? 'buy';
  return {
    externalId: p.externalId ?? `t-${seq}`,
    source: 'house-ptr',
    chamber: 'house',
    politicianName: p.politicianName,
    filerName: p.politicianName,
    owner: null,
    assetName: p.assetName ?? `${p.ticker} Inc`,
    ticker: p.ticker,
    assetType: 'ST',
    transactionType: category === 'buy' ? 'P' : 'S',
    transactionDescription: category === 'buy' ? 'Purchase' : 'Sale',
    category,
    tradeDate: p.tradeDate,
    filingDate: p.tradeDate,
    amount: p.amount ?? null,
    amountRange: p.amountRange ?? null,
    amountMin: p.amountMin ?? null,
    amountMax: p.amountMax ?? null,
    filingDocId: null,
    filingYear: 2026,
    filingUrl: null,
    sourceUrl: null,
  };
}

describe('detectTradeClusters', () => {
  test('groups same-ticker same-direction trades by distinct politicians in a window', () => {
    const clusters = detectTradeClusters([
      trade({ politicianName: 'Rep A', ticker: 'NVDA', tradeDate: '2026-04-01' }),
      trade({ politicianName: 'Rep B', ticker: 'NVDA', tradeDate: '2026-04-10' }),
      trade({ politicianName: 'Rep C', ticker: 'NVDA', tradeDate: '2026-04-20' }),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].ticker).toBe('NVDA');
    expect(clusters[0].direction).toBe('buy');
    expect(clusters[0].politicianCount).toBe(3);
    expect(clusters[0].tradeCount).toBe(3);
    expect(clusters[0].firstDate).toBe('2026-04-01');
    expect(clusters[0].lastDate).toBe('2026-04-20');
    expect(clusters[0].spanDays).toBe(19);
  });

  test('a single politician trading repeatedly is NOT a cluster', () => {
    const clusters = detectTradeClusters([
      trade({ politicianName: 'Rep A', ticker: 'AAPL', tradeDate: '2026-04-01' }),
      trade({ politicianName: 'Rep A', ticker: 'AAPL', tradeDate: '2026-04-05' }),
      trade({ politicianName: 'Rep A', ticker: 'AAPL', tradeDate: '2026-04-09' }),
    ]);
    expect(clusters).toHaveLength(0);
  });

  test('trades too far apart in time do not cluster', () => {
    const clusters = detectTradeClusters([
      trade({ politicianName: 'Rep A', ticker: 'TSLA', tradeDate: '2026-01-01' }),
      trade({ politicianName: 'Rep B', ticker: 'TSLA', tradeDate: '2026-09-01' }),
    ]);
    expect(clusters).toHaveLength(0);
  });

  test('buys and sells of the same ticker are separate clusters', () => {
    const clusters = detectTradeClusters([
      trade({ politicianName: 'Rep A', ticker: 'MSFT', tradeDate: '2026-04-01', category: 'buy' }),
      trade({ politicianName: 'Rep B', ticker: 'MSFT', tradeDate: '2026-04-05', category: 'buy' }),
      trade({ politicianName: 'Rep C', ticker: 'MSFT', tradeDate: '2026-04-02', category: 'sell' }),
      trade({ politicianName: 'Rep D', ticker: 'MSFT', tradeDate: '2026-04-06', category: 'sell' }),
    ]);
    expect(clusters).toHaveLength(2);
    expect(clusters.map((c) => c.direction).sort()).toEqual(['buy', 'sell']);
  });

  test('ignores trades without a ticker or a directional category', () => {
    const clusters = detectTradeClusters([
      trade({ politicianName: 'Rep A', ticker: 'GME', tradeDate: '2026-04-01' }),
      trade({
        politicianName: 'Rep B',
        ticker: 'GME',
        tradeDate: '2026-04-05',
        category: 'exchange',
      }),
      { ...trade({ politicianName: 'Rep C', ticker: 'X', tradeDate: '2026-04-03' }), ticker: null },
    ]);
    expect(clusters).toHaveLength(0); // only one real buy with a ticker → no consensus
  });

  test('ranks broader clusters first and sums disclosed dollar bounds', () => {
    const clusters = detectTradeClusters([
      // Wide consensus on PLTR (3 members)
      trade({
        politicianName: 'Rep A',
        ticker: 'PLTR',
        tradeDate: '2026-03-01',
        amountMin: 1001,
        amountMax: 15000,
      }),
      trade({
        politicianName: 'Rep B',
        ticker: 'PLTR',
        tradeDate: '2026-03-10',
        amountMin: 15001,
        amountMax: 50000,
      }),
      trade({
        politicianName: 'Rep C',
        ticker: 'PLTR',
        tradeDate: '2026-03-15',
        amountMin: 1001,
        amountMax: 15000,
      }),
      // Narrower consensus on AMD (2 members)
      trade({ politicianName: 'Rep D', ticker: 'AMD', tradeDate: '2026-03-02' }),
      trade({ politicianName: 'Rep E', ticker: 'AMD', tradeDate: '2026-03-12' }),
    ]);
    expect(clusters.map((c) => c.ticker)).toEqual(['PLTR', 'AMD']);
    expect(clusters[0].amountMin).toBe(17003);
    expect(clusters[0].amountMax).toBe(80000);
    expect(clusters[1].amountMin).toBeNull();
  });

  test('orders politicians by who traded first (the lead)', () => {
    const clusters = detectTradeClusters([
      trade({ politicianName: 'Late Rep', ticker: 'COIN', tradeDate: '2026-04-20' }),
      trade({ politicianName: 'Early Rep', ticker: 'COIN', tradeDate: '2026-04-01' }),
      trade({ politicianName: 'Mid Rep', ticker: 'COIN', tradeDate: '2026-04-10' }),
    ]);
    expect(clusters[0].politicians).toEqual(['Early Rep', 'Mid Rep', 'Late Rep']);
  });

  test('a sustained streak chains into one cluster; trades returned newest first', () => {
    const clusters = detectTradeClusters([
      trade({ politicianName: 'Rep A', ticker: 'SOFI', tradeDate: '2026-01-01' }),
      trade({ politicianName: 'Rep B', ticker: 'SOFI', tradeDate: '2026-02-15' }), // 45d gap
      trade({ politicianName: 'Rep C', ticker: 'SOFI', tradeDate: '2026-03-30' }), // 43d gap
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].politicianCount).toBe(3);
    expect(clusters[0].trades[0].tradeDate).toBe('2026-03-30'); // newest first
  });

  test('respects a custom minPoliticians threshold', () => {
    const trades = [
      trade({ politicianName: 'Rep A', ticker: 'HOOD', tradeDate: '2026-04-01' }),
      trade({ politicianName: 'Rep B', ticker: 'HOOD', tradeDate: '2026-04-05' }),
    ];
    expect(detectTradeClusters(trades, { minPoliticians: 3 })).toHaveLength(0);
    expect(detectTradeClusters(trades, { minPoliticians: 2 })).toHaveLength(1);
  });
});
