// Trade backtest — pure P&L math. Deterministic (prices injected), no I/O.

import { describe, expect, test } from 'vite-plus/test';
import {
  aggregatePerformance,
  amountMidpoint,
  sharesFromDescription,
  simInputFromTrade,
  simulateTrade,
  type SimInput,
} from './backtest.js';

const buy = (p: Partial<SimInput> = {}): SimInput => ({
  ticker: 'NVDA',
  category: 'buy',
  tradeDate: '2026-01-15',
  amountMin: null,
  amountMax: null,
  knownShares: null,
  isOption: false,
  ...p,
});

describe('amountMidpoint', () => {
  test('midpoint of a band', () => {
    expect(amountMidpoint(1001, 15000)).toBe(8000.5);
  });
  test('open-ended "Over $X" uses the lower bound', () => {
    expect(amountMidpoint(50_000_000, null)).toBe(50_000_000);
  });
  test('no minimum → null', () => {
    expect(amountMidpoint(null, 15000)).toBeNull();
  });
});

describe('sharesFromDescription', () => {
  test('extracts a disclosed share count', () => {
    expect(sharesFromDescription('Purchased 25,000 shares.')).toBe(25000);
    expect(sharesFromDescription('Sold 5,000 shares of Apple')).toBe(5000);
    // Pulls the "N shares" figure (5,000), not the 50 contracts.
    expect(sharesFromDescription('Exercised 50 call options (5,000 shares) ...')).toBe(5000);
  });
  test('null when there is no share count', () => {
    expect(sharesFromDescription('Purchased 20 call options, strike $150.')).toBeNull();
    expect(sharesFromDescription(null)).toBeNull();
  });
});

describe('simulateTrade — stock buy with a KNOWN share count (real P&L)', () => {
  const sim = simulateTrade(buy({ knownShares: 1000 }), { entryPrice: 100, currentPrice: 150 });
  test('exact cost basis, value, gain', () => {
    expect(sim.shares).toBe(1000);
    expect(sim.sharesKnown).toBe(true);
    expect(sim.costBasis).toBe(100_000);
    expect(sim.currentValue).toBe(150_000);
    expect(sim.gainAbs).toBe(50_000);
    expect(sim.gainPct).toBeCloseTo(0.5);
    expect(sim.approximate).toBe(false);
    expect(sim.note).toBeNull();
  });
});

describe('simulateTrade — stock buy with ESTIMATED shares (amount range)', () => {
  const sim = simulateTrade(buy({ amountMin: 1001, amountMax: 15000 }), {
    entryPrice: 100,
    currentPrice: 150,
  });
  test('shares estimated from the midpoint, flagged approximate', () => {
    expect(sim.shares).toBeCloseTo(80.005); // 8000.5 / 100
    expect(sim.sharesKnown).toBe(false);
    expect(sim.costBasis).toBeCloseTo(8000.5);
    expect(sim.currentValue).toBeCloseTo(12000.75);
    expect(sim.gainAbs).toBeCloseTo(4000.25);
    expect(sim.approximate).toBe(true);
    expect(sim.note).toMatch(/estimated/i);
  });
});

describe('simulateTrade — OPTIONS report only the underlying move (no fake P&L)', () => {
  const sim = simulateTrade(buy({ isOption: true, knownShares: 5000 }), {
    entryPrice: 100,
    currentPrice: 150,
  });
  test('no position economics; underlying % only, labeled', () => {
    expect(sim.isOption).toBe(true);
    expect(sim.shares).toBeNull();
    expect(sim.costBasis).toBeNull();
    expect(sim.currentValue).toBeNull();
    expect(sim.gainAbs).toBeNull();
    expect(sim.gainPct).toBeNull();
    expect(sim.underlyingPct).toBeCloseTo(0.5);
    expect(sim.approximate).toBe(true);
    expect(sim.note).toMatch(/option contract P&L not modeled/i);
  });
});

describe('simulateTrade — SELLS report the move since exit, no position', () => {
  const sim = simulateTrade(buy({ category: 'sell' }), { entryPrice: 100, currentPrice: 80 });
  test('underlying down 20% since sale', () => {
    expect(sim.underlyingPct).toBeCloseTo(-0.2);
    expect(sim.gainPct).toBeCloseTo(-0.2);
    expect(sim.shares).toBeNull();
    expect(sim.note).toMatch(/since sale/i);
  });
});

describe('simulateTrade — missing prices degrade gracefully', () => {
  test('null prices → null figures, no throw', () => {
    const sim = simulateTrade(buy({ knownShares: 1000 }), { entryPrice: null, currentPrice: null });
    expect(sim.underlyingPct).toBeNull();
    expect(sim.currentValue).toBeNull();
    expect(sim.gainAbs).toBeNull();
  });
  test('entry price but no current → cost basis known, value null', () => {
    const sim = simulateTrade(buy({ knownShares: 100 }), { entryPrice: 50, currentPrice: null });
    expect(sim.costBasis).toBe(5000);
    expect(sim.currentValue).toBeNull();
    expect(sim.gainAbs).toBeNull();
  });
});

describe('simInputFromTrade — finds the share count where it hides', () => {
  test('uses an option exercise share count', () => {
    const input = simInputFromTrade({
      ticker: 'GOOGL',
      category: 'buy',
      tradeDate: '2026-01-16',
      amountMin: 1000001,
      amountMax: 5000000,
      option: { shares: 5000 },
    });
    expect(input).toMatchObject({ knownShares: 5000, isOption: true });
  });
  test('falls back to the description share count for a plain stock buy', () => {
    const input = simInputFromTrade({
      ticker: 'AB',
      category: 'buy',
      tradeDate: '2026-01-16',
      amountMin: 1000001,
      amountMax: 5000000,
      description: 'Purchased 25,000 shares.',
      option: null,
    });
    expect(input).toMatchObject({ knownShares: 25000, isOption: false });
  });
});

describe('aggregatePerformance — leaderboard roll-up', () => {
  const sims = [
    simulateTrade(buy({ ticker: 'NVDA', knownShares: 1000 }), {
      entryPrice: 100,
      currentPrice: 150,
    }), // +50k
    simulateTrade(buy({ ticker: 'AAPL', knownShares: 1000 }), {
      entryPrice: 200,
      currentPrice: 100,
    }), // -100k
    simulateTrade(buy({ ticker: 'GOOGL', isOption: true }), { entryPrice: 100, currentPrice: 130 }), // option, +30% underlying
    simulateTrade(buy({ ticker: 'MSFT', category: 'sell', knownShares: 500 }), {
      entryPrice: 100,
      currentPrice: 90,
    }), // sell → excluded from the position totals
  ];
  const perf = aggregatePerformance('Rep X', sims);

  test('blended return over stock buys only', () => {
    expect(perf.buyCount).toBe(2);
    expect(perf.totalCostBasis).toBe(300_000);
    expect(perf.totalCurrentValue).toBe(250_000);
    expect(perf.totalGainAbs).toBe(-50_000);
    expect(perf.returnPct).toBeCloseTo(-50_000 / 300_000);
    expect(perf.winRate).toBe(0.5); // 1 of 2 priced buys up
  });

  test('options counted separately via the underlying proxy', () => {
    expect(perf.optionBuyCount).toBe(1);
    expect(perf.optionUnderlyingAvgPct).toBeCloseTo(0.3);
  });

  test('share-quality signal: 0 when all share counts are disclosed', () => {
    expect(perf.estimatedShareFraction).toBe(0);
  });

  test('a politician with no stock buys yields null returns (not NaN)', () => {
    const empty = aggregatePerformance('Rep Y', [
      simulateTrade(buy({ category: 'sell', knownShares: 100 }), {
        entryPrice: 10,
        currentPrice: 12,
      }),
    ]);
    expect(empty.buyCount).toBe(0);
    expect(empty.returnPct).toBeNull();
    expect(empty.winRate).toBeNull();
  });
});
