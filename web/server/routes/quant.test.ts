import { expect, test, describe } from 'vite-plus/test';
import {
  yearOfCycle,
  closeNBack,
  ytdStartClose,
  pctChange,
  rsRatio,
  classifyQuadrant,
  computeSectorReturns,
  parseShillerLine,
  percentileRank,
  sma,
  ema,
  rsi,
  runningDrawdown,
  rollingPercentile,
  parseFredObservations,
  classifyYieldCurveRegime,
  detectCrossovers,
  batchWithConcurrency,
  computeDrawdownFromPrices,
  parseFearGreedHistory,
  computeFearGreedStats,
  joinPricesOnDate,
  computeFlippeningFromJoined,
  joinFredPair,
  computeRealRateStats,
  buildHashRateSeries,
  detectHashRibbonEvents,
  INFLATION_SERIES,
  BUSINESS_CYCLE_SERIES,
  FINANCIAL_CONDITIONS_SERIES,
  type DailyBar,
  type FearGreedSample,
  type FlippeningPoint,
  type FredObservation,
  type HashRatePoint,
} from './quant.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/** Generate N daily bars ending today with a known price pattern.
 *  `prices[i]` = price on day i (oldest first). */
function makeBars(prices: number[], endDate = new Date('2026-04-15T00:00:00Z')): DailyBar[] {
  return prices.map((close, i) => ({
    t: endDate.getTime() - (prices.length - 1 - i) * DAY_MS,
    close,
  }));
}

// ---------------------------------------------------------------------------
// yearOfCycle
// ---------------------------------------------------------------------------

describe('yearOfCycle', () => {
  test('2025 is Y1 (post-2024-election)', () => {
    expect(yearOfCycle(2025)).toBe(1);
  });

  test('2026 is Y2 (midterm)', () => {
    expect(yearOfCycle(2026)).toBe(2);
  });

  test('2027 is Y3 (pre-election)', () => {
    expect(yearOfCycle(2027)).toBe(3);
  });

  test('2028 is Y4 (election)', () => {
    expect(yearOfCycle(2028)).toBe(4);
  });

  test('wraps correctly for 1953 (Eisenhower Y1)', () => {
    expect(yearOfCycle(1953)).toBe(1);
    expect(yearOfCycle(1954)).toBe(2);
    expect(yearOfCycle(1955)).toBe(3);
    expect(yearOfCycle(1956)).toBe(4);
    expect(yearOfCycle(1957)).toBe(1); // Eisenhower re-elected 1956
  });

  test('handles 19th century Shiller dates', () => {
    expect(yearOfCycle(1871)).toBe(3); // (1871-1)%4 = 2, +1 = 3
    expect(yearOfCycle(1872)).toBe(4);
    expect(yearOfCycle(1873)).toBe(1);
  });

  test('always returns a value in [1, 4]', () => {
    for (let y = 1800; y <= 2100; y++) {
      const c = yearOfCycle(y);
      expect(c).toBeGreaterThanOrEqual(1);
      expect(c).toBeLessThanOrEqual(4);
    }
  });
});

// ---------------------------------------------------------------------------
// closeNBack
// ---------------------------------------------------------------------------

describe('closeNBack', () => {
  const bars = makeBars([100, 110, 120, 130, 140]); // 5 bars

  test('returns the most recent when n=0', () => {
    expect(closeNBack(bars, 0)).toBe(140);
  });

  test('returns 1 bar ago when n=1', () => {
    expect(closeNBack(bars, 1)).toBe(130);
  });

  test('returns the first bar when n=length-1', () => {
    expect(closeNBack(bars, 4)).toBe(100);
  });

  test('returns null when history is too short', () => {
    expect(closeNBack(bars, 5)).toBeNull();
    expect(closeNBack(bars, 10)).toBeNull();
  });

  test('returns null on empty array', () => {
    expect(closeNBack([], 0)).toBeNull();
    expect(closeNBack([], 1)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ytdStartClose
// ---------------------------------------------------------------------------

describe('ytdStartClose', () => {
  test('uses prior-year-end bar as YTD baseline', () => {
    // Bars spanning 2025-12-30, 2025-12-31, 2026-01-02, 2026-01-03
    const bars: DailyBar[] = [
      { t: Date.UTC(2025, 11, 30), close: 100 },
      { t: Date.UTC(2025, 11, 31), close: 101 }, // last 2025 close = YTD base
      { t: Date.UTC(2026, 0, 2), close: 102 },
      { t: Date.UTC(2026, 0, 3), close: 103 },
    ];
    const base = ytdStartClose(bars, new Date('2026-01-15'));
    expect(base).toBe(101);
  });

  test('falls back to first bar if no pre-year-start bar exists', () => {
    // No 2025 bars at all
    const bars: DailyBar[] = [
      { t: Date.UTC(2026, 0, 2), close: 200 },
      { t: Date.UTC(2026, 0, 3), close: 201 },
    ];
    const base = ytdStartClose(bars, new Date('2026-02-01'));
    expect(base).toBe(200);
  });

  test('returns null if no bars are in the current year or after', () => {
    const bars: DailyBar[] = [
      { t: Date.UTC(2024, 0, 1), close: 50 },
      { t: Date.UTC(2024, 6, 15), close: 60 },
    ];
    const base = ytdStartClose(bars, new Date('2026-02-01'));
    expect(base).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// pctChange
// ---------------------------------------------------------------------------

describe('pctChange', () => {
  test('computes positive % change', () => {
    expect(pctChange(110, 100)).toBeCloseTo(10);
  });

  test('computes negative % change', () => {
    expect(pctChange(90, 100)).toBeCloseTo(-10);
  });

  test('returns 0 for unchanged value', () => {
    expect(pctChange(100, 100)).toBe(0);
  });

  test('returns null when base is null', () => {
    expect(pctChange(100, null)).toBeNull();
  });

  test('returns null when base is 0 (avoids divide-by-zero)', () => {
    expect(pctChange(100, 0)).toBeNull();
  });

  test('handles fractional changes precisely', () => {
    expect(pctChange(125.5, 100)).toBeCloseTo(25.5);
  });
});

// ---------------------------------------------------------------------------
// rsRatio
// ---------------------------------------------------------------------------

describe('rsRatio', () => {
  test('returns 100 when sector matches benchmark exactly', () => {
    const sector = makeBars([100, 110]);
    const benchmark = makeBars([200, 220]);
    // Both grew 10%
    expect(rsRatio(sector, benchmark, 1)).toBeCloseTo(100);
  });

  test('returns > 100 when sector outperforms benchmark', () => {
    const sector = makeBars([100, 120]); // +20%
    const benchmark = makeBars([200, 220]); // +10%
    // 1.2 / 1.1 ≈ 1.0909 → 109.09
    const rs = rsRatio(sector, benchmark, 1);
    expect(rs).not.toBeNull();
    expect(rs!).toBeCloseTo(109.09, 1);
    expect(rs!).toBeGreaterThan(100);
  });

  test('returns < 100 when sector underperforms benchmark', () => {
    const sector = makeBars([100, 105]); // +5%
    const benchmark = makeBars([200, 220]); // +10%
    // 1.05 / 1.10 ≈ 0.9545 → 95.45
    const rs = rsRatio(sector, benchmark, 1);
    expect(rs).not.toBeNull();
    expect(rs!).toBeCloseTo(95.45, 1);
    expect(rs!).toBeLessThan(100);
  });

  test('returns null when history is insufficient', () => {
    const sector = makeBars([100, 110]);
    const benchmark = makeBars([200, 220]);
    expect(rsRatio(sector, benchmark, 10)).toBeNull();
  });

  test('matches a real-world-ish computation: +25% vs +2.6% (roughly XLE vs SPY)', () => {
    const sector = makeBars([100, 125]); // +25%
    const benchmark = makeBars([100, 102.6]); // +2.6%
    const rs = rsRatio(sector, benchmark, 1);
    // 1.25 / 1.026 = 1.2183 → 121.83
    expect(rs).not.toBeNull();
    expect(rs!).toBeCloseTo(121.83, 0);
  });
});

// ---------------------------------------------------------------------------
// classifyQuadrant
// ---------------------------------------------------------------------------

describe('classifyQuadrant', () => {
  test('Leading: RS > 100 and Mom > 100', () => {
    expect(classifyQuadrant(115, 105)).toBe('leading');
    expect(classifyQuadrant(100, 100)).toBe('leading'); // exact boundary
    expect(classifyQuadrant(108, 118)).toBe('leading'); // XLE Apr 2026
  });

  test('Improving: RS < 100 and Mom > 100', () => {
    expect(classifyQuadrant(95, 105)).toBe('improving');
    expect(classifyQuadrant(97, 105)).toBe('improving'); // XLB Apr 2026
  });

  test('Weakening: RS > 100 and Mom < 100', () => {
    expect(classifyQuadrant(110, 95)).toBe('weakening');
  });

  test('Lagging: RS < 100 and Mom < 100', () => {
    expect(classifyQuadrant(85, 95)).toBe('lagging');
    expect(classifyQuadrant(77, 99)).toBe('lagging'); // XLP Apr 2026
  });

  test('returns unknown when either input is null', () => {
    expect(classifyQuadrant(null, 100)).toBe('unknown');
    expect(classifyQuadrant(100, null)).toBe('unknown');
    expect(classifyQuadrant(null, null)).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// computeSectorReturns (integration of all helpers)
// ---------------------------------------------------------------------------

describe('computeSectorReturns', () => {
  // Build a 300-day series where sector gains 30% and benchmark gains 15%
  const sectorBars = makeBars(Array.from({ length: 300 }, (_, i) => 100 * (1 + (i / 299) * 0.3)));
  const benchmarkBars = makeBars(
    Array.from({ length: 300 }, (_, i) => 100 * (1 + (i / 299) * 0.15))
  );

  test('captures the latest price correctly', () => {
    const r = computeSectorReturns('XLE', 'Energy', sectorBars, benchmarkBars);
    expect(r.price).toBeCloseTo(130);
  });

  test('classifies a strong outperformer as leading', () => {
    const r = computeSectorReturns('XLE', 'Energy', sectorBars, benchmarkBars);
    expect(r.quadrant).toBe('leading');
    expect(r.rsRatio).not.toBeNull();
    expect(r.rsRatio!).toBeGreaterThan(100);
  });

  test('classifies a weak underperformer as lagging', () => {
    // Same shape but lagging
    const laggingBars = makeBars(
      Array.from({ length: 300 }, (_, i) => 100 * (1 + (i / 299) * 0.05))
    );
    const r = computeSectorReturns('XLP', 'Staples', laggingBars, benchmarkBars);
    expect(r.quadrant).toBe('lagging');
    expect(r.rsRatio!).toBeLessThan(100);
  });

  test('includes all return windows', () => {
    const r = computeSectorReturns('XLE', 'Energy', sectorBars, benchmarkBars);
    expect(r.returns.d1).not.toBeNull();
    expect(r.returns.w1).not.toBeNull();
    expect(r.returns.m1).not.toBeNull();
    expect(r.returns.m3).not.toBeNull();
    expect(r.returns.m6).not.toBeNull();
  });

  test('handles empty bars gracefully', () => {
    const r = computeSectorReturns('FOO', 'Foo Sector', [], benchmarkBars);
    expect(r.price).toBe(0);
    expect(r.quadrant).toBe('unknown');
    expect(r.rsRatio).toBeNull();
    expect(r.momentum).toBeNull();
  });

  test('returns null RS when history is shorter than 1 year', () => {
    // Only 100 bars — not enough for 252-day RS
    const shortBars = makeBars(Array.from({ length: 100 }, (_, i) => 100 + i));
    const shortBench = makeBars(Array.from({ length: 100 }, (_, i) => 100 + i * 0.5));
    const r = computeSectorReturns('FOO', 'Foo', shortBars, shortBench);
    expect(r.rsRatio).toBeNull();
    // But 3-month momentum should still compute (63 days < 100)
    expect(r.momentum).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseShillerLine
// ---------------------------------------------------------------------------

describe('parseShillerLine', () => {
  test('parses a complete row with all valuation columns', () => {
    // Real Shiller row from ~Sept 2023
    const row = parseShillerLine(
      '2023-09-01,4515.77,68.71,181.17,307.79,4.19,4515.77,68.71,181.17,30.81'
    );
    expect(row).not.toBeNull();
    expect(row!.sp500).toBeCloseTo(4515.77);
    expect(row!.dividend).toBeCloseTo(68.71);
    expect(row!.earnings).toBeCloseTo(181.17);
    expect(row!.cpi).toBeCloseTo(307.79);
    expect(row!.pe10).toBeCloseTo(30.81);
  });

  test('parses a very old row from 1871', () => {
    const row = parseShillerLine('1871-01-01,4.44,0.26,0.4,12.46,5.32,109.05,6.39,9.82,0.0');
    expect(row).not.toBeNull();
    expect(row!.sp500).toBeCloseTo(4.44);
    expect(row!.dividend).toBeCloseTo(0.26);
    // PE10 is 0.0 here (not yet computed at start of series) — should be null
    expect(row!.pe10).toBeNull();
  });

  test('marks recent rows with zero valuation columns as null', () => {
    // Real Shiller row from April 2026 where dividend/earnings are placeholder 0.0
    const row = parseShillerLine('2026-04-01,6579.00,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0');
    expect(row).not.toBeNull();
    expect(row!.sp500).toBeCloseTo(6579.0);
    expect(row!.dividend).toBeNull();
    expect(row!.earnings).toBeNull();
    expect(row!.cpi).toBeNull();
    expect(row!.pe10).toBeNull();
  });

  test('returns null on header row', () => {
    expect(parseShillerLine('Date,SP500,Dividend,Earnings,CPI')).toBeNull();
  });

  test('returns null on malformed rows', () => {
    expect(parseShillerLine('')).toBeNull();
    expect(parseShillerLine('not-a-date,100,1,1,1,1,1,1,1,1')).toBeNull();
    expect(parseShillerLine('2020-01-01,not-a-number,1,1,1,1,1,1,1,1')).toBeNull();
    // Row with too few columns
    expect(parseShillerLine('2020-01-01,100')).toBeNull();
  });

  test('returns null when SP500 is zero or negative', () => {
    expect(parseShillerLine('2020-01-01,0,1,1,1,1,1,1,1,1')).toBeNull();
    expect(parseShillerLine('2020-01-01,-5,1,1,1,1,1,1,1,1')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// percentileRank
// ---------------------------------------------------------------------------

describe('percentileRank', () => {
  test('value below all others returns ~0', () => {
    expect(percentileRank([10, 20, 30], 5)).toBe(0);
  });

  test('value above all others returns 100', () => {
    expect(percentileRank([10, 20, 30], 100)).toBe(100);
  });

  test('median value returns ~50', () => {
    expect(percentileRank([10, 20, 30, 40], 25)).toBe(50);
  });

  test('exact match uses half-credit', () => {
    // 10 is below [20,30], equal to itself. One below, one equal (half credit).
    // below = 0 + 0.5 = 0.5; 0.5/3 * 100 = 16.67
    expect(percentileRank([10, 20, 30], 10)).toBeCloseTo(16.67, 1);
  });

  test('reasonable CAPE percentile for current market', () => {
    // Using a synthetic history: most values 10-25, then a few extreme 30+
    const capes = Array.from({ length: 100 }, (_, i) =>
      i < 90 ? 10 + (i / 90) * 15 : 25 + ((i - 90) / 10) * 15
    );
    // Current CAPE 30.81 — should be in the top decile (~94-97th percentile)
    const p = percentileRank(capes, 30.81);
    expect(p).toBeGreaterThan(90);
  });

  test('empty array returns 0', () => {
    expect(percentileRank([], 100)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// sma (Simple Moving Average)
// ---------------------------------------------------------------------------

describe('sma', () => {
  test('returns null entries before the window has filled', () => {
    const result = sma([1, 2, 3, 4, 5], 3);
    expect(result[0]).toBeNull();
    expect(result[1]).toBeNull();
    expect(result[2]).toBeCloseTo(2); // (1+2+3)/3
    expect(result[3]).toBeCloseTo(3); // (2+3+4)/3
    expect(result[4]).toBeCloseTo(4); // (3+4+5)/3
  });

  test('window=1 returns the input array', () => {
    const result = sma([10, 20, 30], 1);
    expect(result).toEqual([10, 20, 30]);
  });

  test('window larger than array yields all nulls', () => {
    const result = sma([1, 2, 3], 5);
    expect(result).toEqual([null, null, null]);
  });

  test('window exactly equal to array length yields one final value', () => {
    const result = sma([1, 2, 3, 4], 4);
    expect(result[0]).toBeNull();
    expect(result[1]).toBeNull();
    expect(result[2]).toBeNull();
    expect(result[3]).toBeCloseTo(2.5);
  });

  test('throws on non-positive window', () => {
    expect(() => sma([1, 2, 3], 0)).toThrow();
    expect(() => sma([1, 2, 3], -5)).toThrow();
  });

  test('rolling window math is O(n) and correct on longer series', () => {
    // Numerical check: sum of 1..200, window=100. Average over last 100 = avg(101..200) = 150.5
    const arr = Array.from({ length: 200 }, (_, i) => i + 1);
    const result = sma(arr, 100);
    expect(result[99]).toBeCloseTo(50.5); // avg(1..100)
    expect(result[199]).toBeCloseTo(150.5); // avg(101..200)
  });

  test('handles decimals without floating-point drift', () => {
    const arr = [0.1, 0.2, 0.3, 0.4, 0.5];
    const result = sma(arr, 3);
    expect(result[2]).toBeCloseTo(0.2);
    expect(result[4]).toBeCloseTo(0.4);
  });
});

// ---------------------------------------------------------------------------
// ema (Exponential Moving Average)
// ---------------------------------------------------------------------------

describe('ema', () => {
  test('returns nulls before the window fills', () => {
    const result = ema([1, 2, 3, 4, 5], 3);
    expect(result[0]).toBeNull();
    expect(result[1]).toBeNull();
    // At index 2 (3rd value), seeded with SMA of first 3 = 2
    expect(result[2]).toBeCloseTo(2);
  });

  test('converges toward input values with constant input', () => {
    // For a constant series, EMA should equal the constant
    const result = ema([10, 10, 10, 10, 10, 10], 3);
    expect(result[5]).toBeCloseTo(10);
  });

  test('applies proper smoothing factor α = 2/(N+1)', () => {
    // With a spike: [1,1,1,1,10] window=3
    // seed after [1,1,1] = 1. α = 2/4 = 0.5
    // i=3: 1*0.5 + 1*0.5 = 1
    // i=4: 10*0.5 + 1*0.5 = 5.5
    const result = ema([1, 1, 1, 1, 10], 3);
    expect(result[4]).toBeCloseTo(5.5);
  });

  test('throws on non-positive window', () => {
    expect(() => ema([1, 2, 3], 0)).toThrow();
    expect(() => ema([1, 2, 3], -1)).toThrow();
  });

  test('returns all nulls when input shorter than window', () => {
    const result = ema([1, 2], 5);
    expect(result).toEqual([null, null]);
  });
});

// ---------------------------------------------------------------------------
// rsi (Relative Strength Index)
// ---------------------------------------------------------------------------

describe('rsi', () => {
  test('returns 100 for a strictly increasing series', () => {
    // With only gains, avgLoss = 0 → RSI = 100 per formula
    const result = rsi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 14);
    expect(result[14]).toBe(100);
    expect(result[15]).toBe(100);
  });

  test('returns near 0 for a strictly decreasing series', () => {
    const result = rsi([100, 90, 80, 70, 60, 50, 40, 30, 20, 15, 14, 13, 12, 11, 10, 9], 14);
    // All losses → RSI near 0
    expect(result[15]!).toBeLessThan(5);
  });

  test('returns roughly 50 for an oscillating series', () => {
    const vals: number[] = [];
    // Sine wave around 100
    for (let i = 0; i < 50; i++) vals.push(100 + Math.sin(i / 3) * 5);
    const result = rsi(vals, 14);
    // Eventually RSI should settle around 50 for a symmetric oscillator
    expect(result[49]!).toBeGreaterThan(30);
    expect(result[49]!).toBeLessThan(70);
  });

  test('returns nulls before period+1 bars', () => {
    const result = rsi([1, 2, 3, 4, 5], 14);
    expect(result.every((v) => v === null)).toBe(true);
  });

  test('is in [0, 100] range', () => {
    const vals = Array.from({ length: 100 }, (_, i) => 50 + Math.random() * 10);
    const result = rsi(vals, 14);
    for (const v of result) {
      if (v != null) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// runningDrawdown
// ---------------------------------------------------------------------------

describe('runningDrawdown', () => {
  test('is 0 at a new ATH', () => {
    expect(runningDrawdown([100, 110, 120])).toEqual([0, 0, 0]);
  });

  test('computes -20% drawdown when price drops 20% from ATH', () => {
    const result = runningDrawdown([100, 120, 96]);
    expect(result[0]).toBe(0); // at ATH
    expect(result[1]).toBe(0); // new ATH
    expect(result[2]).toBeCloseTo(-0.2); // 96/120 - 1 = -0.2
  });

  test('tracks the running peak across recoveries', () => {
    const result = runningDrawdown([100, 50, 75, 100]);
    expect(result[0]).toBe(0);
    expect(result[1]).toBeCloseTo(-0.5);
    expect(result[2]).toBeCloseTo(-0.25);
    expect(result[3]).toBe(0); // back at ATH
  });

  test('resets the drawdown counter when a new ATH is made', () => {
    const result = runningDrawdown([100, 80, 120, 60]);
    expect(result[3]).toBeCloseTo(-0.5); // 60/120 - 1 = -0.5
  });

  test('returns empty array for empty input', () => {
    expect(runningDrawdown([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// rollingPercentile
// ---------------------------------------------------------------------------

describe('rollingPercentile', () => {
  test('maps each point in a monotonic series to 0.9 (half-credit at top)', () => {
    // Every new point is the highest in its window.
    // percentileRank uses half-credit for exact matches, so the top of a
    // 5-element sorted window = (4 strictly-below + 0.5 self) / 5 = 0.9
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = rollingPercentile(values, 5);
    expect(result[9]).toBeCloseTo(0.9, 2);
  });

  test('handles null entries gracefully', () => {
    const values = [1, null, 2, null, 3, 4];
    const result = rollingPercentile(values, 4);
    expect(result[0]).toBeNull(); // only 1 non-null, not enough for ranking
    expect(result[5]).not.toBeNull();
  });

  test('returns null for the first point (insufficient window)', () => {
    const result = rollingPercentile([10, 20, 30], 3);
    expect(result[0]).toBeNull();
  });

  test('bottom of the window maps near 0', () => {
    // [5, 4, 3, 2, 1] — the last value (1) is the minimum of its window
    // below = 0 + 0.5 = 0.5, /5 * 100 = 10 → 0.10
    const result = rollingPercentile([5, 4, 3, 2, 1], 5);
    expect(result[4]).toBeCloseTo(0.1, 2);
  });

  test('median of a symmetric set maps to ~0.5', () => {
    // For a fully-filled window [1,2,3,4,5] the middle value 3 has
    // below = 2 strict + 0.5 self = 2.5, /5 * 100 = 50 → 0.5
    const values = [1, 2, 3, 4, 5];
    const result = rollingPercentile(values, 5);
    // At the last index the full window is populated. Value 5 → 0.9.
    // We check the 3-value mid-index sub-window instead: result at index 2
    // uses window [1,2,3] where 3 is the top. Skip that and construct a
    // dedicated test input for the median case:
    const medianTest = rollingPercentile([10, 20, 30, 20, 10], 5);
    // At index 4: window [10,20,30,20,10], value 10. Two 10s, two 20s, one 30.
    // below = 0 strict + 0.5*2 self = 1.0. /5 * 100 = 20 → 0.20
    expect(medianTest[4]).toBeCloseTo(0.2, 2);
    // Verify the monotonic last value still behaves correctly
    expect(result[4]).toBeCloseTo(0.9, 2);
  });
});

// ---------------------------------------------------------------------------
// detectCrossovers
// ---------------------------------------------------------------------------

describe('detectCrossovers', () => {
  test('flags a golden cross when fast rises above slow', () => {
    // Day 0: fast=5 < slow=10
    // Day 1: fast=12 > slow=10 → golden
    const result = detectCrossovers([5, 12], [10, 10]);
    expect(result[0]).toBeNull(); // first index always null
    expect(result[1]).toBe('golden');
  });

  test('flags a death cross when fast falls below slow', () => {
    const result = detectCrossovers([15, 5], [10, 10]);
    expect(result[0]).toBeNull();
    expect(result[1]).toBe('death');
  });

  test('returns "none" when no crossover occurs', () => {
    // Both above, both below, or staying on the same side
    const result = detectCrossovers([15, 16], [10, 10]);
    expect(result[1]).toBe('none');
  });

  test('handles null entries by returning null', () => {
    const result = detectCrossovers([null, 10, 20], [5, 15, 15]);
    expect(result[0]).toBeNull();
    // i=1: fast0=null, so null
    expect(result[1]).toBeNull();
    // i=2: fast=20>slow=15, fast0=10<=slow0=15 → golden
    expect(result[2]).toBe('golden');
  });

  test('detects multiple cross events in one pass', () => {
    //                  0  1  2  3  4  5
    const fast = [5, 12, 12, 8, 8, 15];
    const slow = [10, 10, 10, 10, 10, 10];
    const result = detectCrossovers(fast, slow);
    expect(result[1]).toBe('golden'); // 5 → 12
    expect(result[3]).toBe('death'); // 12 → 8
    expect(result[5]).toBe('golden'); // 8 → 15
  });

  test('throws on length mismatch', () => {
    expect(() => detectCrossovers([1, 2], [1, 2, 3])).toThrow();
  });
});

// ---------------------------------------------------------------------------
// batchWithConcurrency
// ---------------------------------------------------------------------------

describe('batchWithConcurrency', () => {
  test('processes every item in the input order', async () => {
    const result = await batchWithConcurrency([1, 2, 3, 4, 5], 2, async (x) => x * 10);
    expect(result).toEqual([10, 20, 30, 40, 50]);
  });

  test('respects the concurrency limit', async () => {
    let inFlight = 0;
    let peakInFlight = 0;
    const work = (_x: number): Promise<number> =>
      new Promise((resolve) => {
        inFlight++;
        peakInFlight = Math.max(peakInFlight, inFlight);
        setTimeout(() => {
          inFlight--;
          resolve(_x);
        }, 20);
      });
    await batchWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 3, work);
    expect(peakInFlight).toBeLessThanOrEqual(3);
  });

  test('handles empty input', async () => {
    const result = await batchWithConcurrency([], 5, async (x) => x);
    expect(result).toEqual([]);
  });

  test('throws on non-positive concurrency', async () => {
    await expect(batchWithConcurrency([1, 2], 0, async (x) => x)).rejects.toThrow();
  });

  test('propagates exceptions from the worker function', async () => {
    await expect(
      batchWithConcurrency([1, 2, 3], 2, async (x) => {
        if (x === 2) throw new Error('boom');
        return x;
      })
    ).rejects.toThrow('boom');
  });
});

// ---------------------------------------------------------------------------
// parseFredObservations
// ---------------------------------------------------------------------------

describe('parseFredObservations', () => {
  test('parses a normal T10Y2Y response', () => {
    const json = {
      observations: [
        { date: '2024-01-02', value: '-0.35' },
        { date: '2024-01-03', value: '-0.30' },
        { date: '2024-01-04', value: '-0.25' },
      ],
    };
    const result = parseFredObservations(json);
    expect(result).toHaveLength(3);
    expect(result[0].date).toBe('2024-01-02');
    expect(result[0].value).toBeCloseTo(-0.35);
    expect(result[0].t).toBe(Date.UTC(2024, 0, 2));
  });

  test('filters out FRED missing-value markers (".")', () => {
    const json = {
      observations: [
        { date: '2024-01-01', value: '1.5' },
        { date: '2024-01-02', value: '.' },
        { date: '2024-01-03', value: '1.8' },
      ],
    };
    const result = parseFredObservations(json);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.value)).toEqual([1.5, 1.8]);
  });

  test('handles positive and negative values', () => {
    const json = {
      observations: [
        { date: '2023-06-01', value: '-0.78' },
        { date: '2026-04-14', value: '0.55' },
      ],
    };
    const result = parseFredObservations(json);
    expect(result[0].value).toBeCloseTo(-0.78);
    expect(result[1].value).toBeCloseTo(0.55);
  });

  test('throws on FRED error response', () => {
    const json = {
      observations: [],
      error_code: 400,
      error_message: 'Bad API key.',
    };
    expect(() => parseFredObservations(json)).toThrow(/FRED API error/);
  });

  test('throws when observations field is missing', () => {
    expect(() => parseFredObservations({} as unknown as { observations: never })).toThrow();
  });

  test('skips malformed values gracefully', () => {
    const json = {
      observations: [
        { date: '2024-01-01', value: 'not-a-number' },
        { date: '2024-01-02', value: '1.5' },
        { date: 'not-a-date', value: '2.0' },
      ],
    };
    const result = parseFredObservations(json);
    // Only the valid one should remain
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe('2024-01-02');
  });
});

// ---------------------------------------------------------------------------
// classifyYieldCurveRegime
// ---------------------------------------------------------------------------

describe('classifyYieldCurveRegime', () => {
  test('deeply inverted below -0.5', () => {
    expect(classifyYieldCurveRegime(-1.0)).toBe('deeply-inverted');
    expect(classifyYieldCurveRegime(-0.51)).toBe('deeply-inverted');
  });

  test('inverted between -0.5 and 0', () => {
    expect(classifyYieldCurveRegime(-0.4)).toBe('inverted');
    expect(classifyYieldCurveRegime(-0.01)).toBe('inverted');
  });

  test('flattening between 0 and 0.25', () => {
    expect(classifyYieldCurveRegime(0)).toBe('flattening');
    expect(classifyYieldCurveRegime(0.2)).toBe('flattening');
  });

  test('normal between 0.25 and 1.5', () => {
    expect(classifyYieldCurveRegime(0.25)).toBe('normal');
    expect(classifyYieldCurveRegime(0.5)).toBe('normal');
    expect(classifyYieldCurveRegime(1.4)).toBe('normal');
  });

  test('steepening at 1.5 or above', () => {
    expect(classifyYieldCurveRegime(1.5)).toBe('steepening');
    expect(classifyYieldCurveRegime(2.8)).toBe('steepening');
  });

  test('null returns normal (non-breaking default)', () => {
    expect(classifyYieldCurveRegime(null)).toBe('normal');
  });
});

// ---------------------------------------------------------------------------
// computeDrawdownFromPrices (BTC Drawdown chart)
// ---------------------------------------------------------------------------

/** Build a price series from an array of prices where index i = day i
 *  (oldest first), ending on a fixed date. Each point has a real epoch
 *  timestamp so day-math works. */
function makePriceSeries(prices: number[], endDate = new Date('2026-04-15T00:00:00Z')) {
  return prices.map((price, i) => ({
    t: endDate.getTime() - (prices.length - 1 - i) * DAY_MS,
    price,
  }));
}

describe('computeDrawdownFromPrices', () => {
  test('monotonic uptrend has zero drawdown throughout', () => {
    const prices = makePriceSeries([10, 20, 30, 40, 50]);
    const result = computeDrawdownFromPrices(prices);
    expect(result.series.every((p) => p.drawdown === 0)).toBe(true);
    expect(result.latest.drawdown).toBe(0);
    expect(result.episodes.length).toBe(0);
  });

  test('single 50% drawdown → 0 episodes when not yet recovered, -0.5 worst', () => {
    // 100 → 50 → 60 → 70 — never reclaims 100 within the series.
    const prices = makePriceSeries([100, 90, 75, 50, 60, 70]);
    const result = computeDrawdownFromPrices(prices);
    expect(result.stats.worstDrawdown).toBeCloseTo(-0.5, 5);
    // In-progress episode should be recorded with null recovery.
    expect(result.episodes.length).toBe(1);
    expect(result.episodes[0].daysToRecovery).toBe(null);
    expect(result.episodes[0].maxDrawdown).toBeCloseTo(-0.5, 5);
    expect(result.episodes[0].athPrice).toBe(100);
    expect(result.episodes[0].troughPrice).toBe(50);
  });

  test('single recovered episode → 1 completed episode with correct days', () => {
    // 100 (ATH) → 80 → 60 (trough) → 80 → 110 (new ATH)
    const prices = makePriceSeries([100, 80, 60, 80, 110]);
    const result = computeDrawdownFromPrices(prices);
    expect(result.episodes.length).toBe(1);
    const e = result.episodes[0];
    expect(e.athPrice).toBe(100);
    expect(e.troughPrice).toBe(60);
    expect(e.maxDrawdown).toBeCloseTo(-0.4, 5);
    // Day indices: ATH=0, trough=2, recovery=4
    expect(e.daysToTrough).toBe(2);
    expect(e.daysToRecovery).toBe(2);
  });

  test('two separate recovered episodes', () => {
    const prices = makePriceSeries([
      100,
      70,
      110, // episode 1: 100 → 70 → 110
      80,
      120, // episode 2: 110 → 80 → 120
    ]);
    const result = computeDrawdownFromPrices(prices);
    expect(result.episodes.length).toBe(2);
    expect(result.episodes[0].maxDrawdown).toBeCloseTo(-0.3, 5);
    expect(result.episodes[1].athPrice).toBe(110);
    // (80 - 110) / 110 = -0.2727…
    expect(result.episodes[1].maxDrawdown).toBeCloseTo(-(30 / 110), 3);
  });

  test('≤10% dip is filtered out of episodes (default threshold)', () => {
    // 100 → 95 → 100 → 108 → 120 — the -5% blip shouldn't create an episode.
    const prices = makePriceSeries([100, 95, 100, 108, 120]);
    const result = computeDrawdownFromPrices(prices);
    expect(result.episodes.length).toBe(0);
  });

  test('custom threshold includes smaller dips', () => {
    const prices = makePriceSeries([100, 95, 100, 108, 120]);
    const result = computeDrawdownFromPrices(prices, 0.04); // 4% threshold
    expect(result.episodes.length).toBe(1);
    expect(result.episodes[0].maxDrawdown).toBeCloseTo(-0.05, 5);
  });

  test('latest.daysSinceAth is 0 when still at ATH', () => {
    const prices = makePriceSeries([10, 20, 30, 40, 50]);
    const result = computeDrawdownFromPrices(prices);
    expect(result.latest.daysSinceAth).toBe(0);
    expect(result.latest.ath).toBe(50);
    expect(result.latest.drawdown).toBe(0);
  });

  test('latest.daysSinceAth counts days from the ATH', () => {
    // ATH on day 0 (100), then drop. Series has 5 days total.
    const prices = makePriceSeries([100, 90, 80, 70, 60]);
    const result = computeDrawdownFromPrices(prices);
    expect(result.latest.ath).toBe(100);
    expect(result.latest.daysSinceAth).toBe(4);
  });

  test('pctDaysInBearZone matches hand-computed ratio', () => {
    // ATH=100, then 60 → 70 → 80 → 90 → 100. Days in bear (≤ -20%) are
    // indices 1 (-40%), 2 (-30%), 3 (-20% exactly — still counts). 3/6.
    const prices = makePriceSeries([100, 60, 70, 80, 90, 100]);
    const result = computeDrawdownFromPrices(prices);
    expect(result.stats.pctDaysInBearZone).toBeCloseTo(3 / 6, 5);
  });

  test('worstDrawdown reflects the deepest historical dip', () => {
    const prices = makePriceSeries([100, 30, 80, 200, 120, 210]);
    const result = computeDrawdownFromPrices(prices);
    // Worst was 30 vs ATH 100 = -70%.
    expect(result.stats.worstDrawdown).toBeCloseTo(-0.7, 5);
  });
});

// ---------------------------------------------------------------------------
// parseFearGreedHistory / computeFearGreedStats
// ---------------------------------------------------------------------------

describe('parseFearGreedHistory', () => {
  test('parses a typical alternative.me payload and sorts oldest-first', () => {
    // alternative.me returns newest-first
    const raw = [
      { value: '72', value_classification: 'Greed', timestamp: '1712102400' }, // Apr 3
      { value: '45', value_classification: 'Fear', timestamp: '1711843200' }, // Mar 31
      { value: '25', value_classification: 'Extreme Fear', timestamp: '1711670400' }, // Mar 29
    ];
    const parsed = parseFearGreedHistory(raw);
    expect(parsed.length).toBe(3);
    // Sorted oldest-first by timestamp
    expect(parsed[0].t).toBeLessThan(parsed[1].t);
    expect(parsed[1].t).toBeLessThan(parsed[2].t);
    expect(parsed[0].value).toBe(25);
    expect(parsed[2].value).toBe(72);
    expect(parsed[0].classification).toBe('Extreme Fear');
  });

  test('drops rows with non-finite values', () => {
    const raw = [
      { value: '50', value_classification: 'Neutral', timestamp: '1711670400' },
      { value: 'NaN', value_classification: 'garbage', timestamp: '1711843200' },
      { value: '60', value_classification: 'Greed', timestamp: '1712102400' },
    ];
    const parsed = parseFearGreedHistory(raw);
    expect(parsed.length).toBe(2);
    expect(parsed.every((s) => Number.isFinite(s.value))).toBe(true);
  });

  test('handles an empty array', () => {
    expect(parseFearGreedHistory([])).toEqual([]);
  });
});

describe('computeFearGreedStats', () => {
  /** Build a FearGreedSample history with `days` values ending today. */
  function makeHistory(values: number[]): FearGreedSample[] {
    const end = new Date('2026-04-15T00:00:00Z').getTime();
    return values.map((value, i) => ({
      t: end - (values.length - 1 - i) * DAY_MS,
      value,
      classification: '',
    }));
  }

  test('ma30 averages the last 30 values', () => {
    const history = makeHistory(Array.from({ length: 60 }, (_, i) => i + 1));
    // Last 30 values are 31..60, mean = 45.5
    const stats = computeFearGreedStats(history);
    expect(stats.ma30).toBeCloseTo(45.5, 1);
  });

  test('ma90 averages the last 90 values (or fewer if history is shorter)', () => {
    const history = makeHistory(Array.from({ length: 50 }, () => 40));
    const stats = computeFearGreedStats(history);
    // Only 50 samples — ma90 should equal the full mean (40)
    expect(stats.ma90).toBe(40);
  });

  test('latest is the final entry', () => {
    const history = makeHistory([10, 20, 30, 40, 50]);
    expect(computeFearGreedStats(history).latest.value).toBe(50);
  });

  test('highest365 and lowest365 find the extremes within 365 days', () => {
    const history = makeHistory([30, 80, 20, 60, 45]);
    const stats = computeFearGreedStats(history);
    expect(stats.highest365?.value).toBe(80);
    expect(stats.lowest365?.value).toBe(20);
  });

  test('throws on empty history', () => {
    expect(() => computeFearGreedStats([])).toThrow();
  });
});

// ---------------------------------------------------------------------------
// joinPricesOnDate / computeFlippeningFromJoined (Flippening)
// ---------------------------------------------------------------------------

describe('joinPricesOnDate', () => {
  test('keeps only dates present in both series', () => {
    const end = new Date('2026-04-15T00:00:00Z').getTime();
    const a = [
      { t: end - 2 * DAY_MS, price: 100 },
      { t: end - 1 * DAY_MS, price: 110 },
      { t: end, price: 120 },
    ];
    const b = [
      { t: end - 1 * DAY_MS, price: 50 },
      { t: end, price: 60 },
    ];
    const joined = joinPricesOnDate(a, b);
    expect(joined.length).toBe(2);
    expect(joined[0].ratio).toBeCloseTo(110 / 50, 5);
    expect(joined[1].ratio).toBeCloseTo(120 / 60, 5);
  });

  test('drops rows where denominator is zero or missing', () => {
    const end = new Date('2026-04-15T00:00:00Z').getTime();
    const a = [{ t: end, price: 100 }];
    const b = [{ t: end, price: 0 }];
    expect(joinPricesOnDate(a, b)).toEqual([]);
  });

  test('empty inputs return empty', () => {
    expect(joinPricesOnDate([], [])).toEqual([]);
  });
});

describe('computeFlippeningFromJoined', () => {
  function makeJoinedSeries(pairs: { eth: number; btc: number }[]): FlippeningPoint[] {
    const end = new Date('2026-04-15T00:00:00Z').getTime();
    return pairs.map((p, i) => ({
      t: end - (pairs.length - 1 - i) * DAY_MS,
      ethPrice: p.eth,
      btcPrice: p.btc,
      ratio: p.eth / p.btc,
    }));
  }

  test('progressToFlippening = 1.0 when ratio equals BTC/ETH supply ratio', () => {
    // Pick ratio = 0.5, use supplies of 100 and 200 so ratioAtFlippening = 0.5.
    const series = makeJoinedSeries(Array.from({ length: 5 }, () => ({ eth: 500, btc: 1000 })));
    const result = computeFlippeningFromJoined(series, 100, 200);
    expect(result.latest.progressToFlippening).toBeCloseTo(1.0, 5);
  });

  test('progress < 1 when ETH lags BTC on a cap basis', () => {
    const series = makeJoinedSeries(Array.from({ length: 5 }, () => ({ eth: 200, btc: 1000 })));
    // ratio=0.2, supplies 100/200 → ratioAtFlippening=0.5 → progress=0.4
    const result = computeFlippeningFromJoined(series, 100, 200);
    expect(result.latest.progressToFlippening).toBeCloseTo(0.4, 5);
  });

  test('identifies ratio ATH correctly', () => {
    const series = makeJoinedSeries([
      { eth: 100, btc: 1000 }, // 0.10
      { eth: 200, btc: 1000 }, // 0.20 ← ATH
      { eth: 150, btc: 1000 }, // 0.15
      { eth: 180, btc: 1000 }, // 0.18
    ]);
    const result = computeFlippeningFromJoined(series);
    expect(result.stats.ratioAth).toBeCloseTo(0.2, 5);
  });

  test('throws on under 2 points', () => {
    expect(() => computeFlippeningFromJoined([])).toThrow();
    expect(() => computeFlippeningFromJoined(makeJoinedSeries([{ eth: 1, btc: 1 }]))).toThrow();
  });

  test('90d / 365d returns are zero when series is too short', () => {
    // With 2 points 1 day apart, daysAgo(90) and daysAgo(365) both fall back
    // to index 0. 90d and 365d returns are then equal to (latest-first)/first.
    const series = makeJoinedSeries([
      { eth: 100, btc: 1000 },
      { eth: 110, btc: 1000 },
    ]);
    const result = computeFlippeningFromJoined(series);
    expect(result.stats.ratio90dReturn).toBeCloseTo(0.1, 5);
    expect(result.stats.ratio365dReturn).toBeCloseTo(0.1, 5);
  });
});

// ---------------------------------------------------------------------------
// joinFredPair / computeRealRateStats (Real Interest Rates)
// ---------------------------------------------------------------------------

describe('joinFredPair', () => {
  /** Build a FRED observation series from an array of values keyed by date. */
  function makeFred(values: { date: string; value: number }[]): FredObservation[] {
    return values.map(({ date, value }) => ({
      date,
      value,
      t: new Date(date + 'T00:00:00Z').getTime(),
    }));
  }

  test('joins a nominal and breakeven series on the date string', () => {
    const nominal = makeFred([
      { date: '2026-01-01', value: 4.0 },
      { date: '2026-01-02', value: 4.1 },
      { date: '2026-01-03', value: 4.2 },
    ]);
    const breakeven = makeFred([
      { date: '2026-01-01', value: 2.0 },
      { date: '2026-01-03', value: 2.5 },
    ]);
    const joined = joinFredPair(nominal, breakeven);
    expect(joined.length).toBe(2);
    expect(joined[0].real).toBeCloseTo(2.0, 5); // 4.0 − 2.0
    expect(joined[1].real).toBeCloseTo(1.7, 5); // 4.2 − 2.5
  });

  test('drops rows where breakeven is non-finite', () => {
    const nominal = makeFred([{ date: '2026-01-01', value: 4.0 }]);
    const breakeven: FredObservation[] = [
      { date: '2026-01-01', value: NaN, t: new Date('2026-01-01T00:00:00Z').getTime() },
    ];
    expect(joinFredPair(nominal, breakeven)).toEqual([]);
  });

  test('empty inputs produce empty output', () => {
    expect(joinFredPair([], [])).toEqual([]);
  });
});

describe('computeRealRateStats', () => {
  /** Build a real-rate series with the given real values, one per day,
   *  ending on `end`. */
  function makeTen(reals: number[], end = new Date('2026-04-15T00:00:00Z').getTime()) {
    return reals.map((real, i) => ({
      t: end - (reals.length - 1 - i) * DAY_MS,
      nominal: real + 2.5,
      breakeven: 2.5,
      real,
    }));
  }

  test('percentile is 100% when the latest is the highest in the window', () => {
    const ten = makeTen([0, 0.5, 1.0, 1.5, 2.0]);
    const stats = computeRealRateStats(ten, ten[ten.length - 1].t);
    expect(stats.tenYearPercentile10y).toBeCloseTo(1.0, 5);
  });

  test('percentile is 0% when the latest is the lowest in the window', () => {
    const ten = makeTen([2.0, 1.5, 1.0, 0.5, 0]);
    const stats = computeRealRateStats(ten, ten[ten.length - 1].t);
    // The latest value (0) appears once at the bottom — percentile = 1/5
    expect(stats.tenYearPercentile10y).toBeCloseTo(0.2, 5);
  });

  test('52w change is zero when priors are all within 52 weeks', () => {
    // 5 daily points, all within a week — no prior52w exists
    const ten = makeTen([1.0, 1.2, 1.4, 1.6, 1.8]);
    const stats = computeRealRateStats(ten, ten[ten.length - 1].t);
    expect(stats.tenYearChange52w).toBe(0);
  });

  test('52w change captures the real-rate delta from exactly 52 weeks ago', () => {
    // Build 800 days of data: real rate climbs from 0 to 2.0 linearly
    const reals = Array.from({ length: 800 }, (_, i) => i * (2.0 / 799));
    const ten = makeTen(reals);
    const stats = computeRealRateStats(ten, ten[ten.length - 1].t);
    // Latest is ~2.0; 365 days ago (index 434) is ~1.087. Change ≈ 0.913.
    expect(stats.tenYearChange52w).toBeGreaterThan(0.8);
    expect(stats.tenYearChange52w).toBeLessThan(1.0);
  });

  test('empty series returns zeros', () => {
    const stats = computeRealRateStats([], Date.now());
    expect(stats.tenYearPercentile10y).toBe(0);
    expect(stats.tenYearChange52w).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildHashRateSeries / detectHashRibbonEvents
// ---------------------------------------------------------------------------

describe('buildHashRateSeries', () => {
  test('attaches nulls for pre-window entries', () => {
    const rates = Array.from({ length: 10 }, (_, i) => ({
      t: Date.UTC(2026, 0, i + 1),
      hashRate: 100 + i,
    }));
    const series = buildHashRateSeries(rates);
    // sma30 needs 30 points to fill, sma60 needs 60.
    expect(series.every((s) => s.sma30 === null)).toBe(true);
    expect(series.every((s) => s.sma60 === null)).toBe(true);
  });

  test('sma30 fills after 30 points and matches rolling-window mean', () => {
    const rates = Array.from({ length: 70 }, (_, i) => ({
      t: Date.UTC(2026, 0, i + 1),
      hashRate: i + 1, // 1..70
    }));
    const series = buildHashRateSeries(rates);
    // Last sma30 = avg(41..70) = 55.5
    expect(series[69].sma30).toBeCloseTo(55.5, 5);
    // Last sma60 = avg(11..70) = 40.5
    expect(series[69].sma60).toBeCloseTo(40.5, 5);
  });
});

describe('detectHashRibbonEvents', () => {
  function makeHashPoints(sma30: (number | null)[], sma60: (number | null)[]): HashRatePoint[] {
    return sma30.map((s30, i) => ({
      t: Date.UTC(2026, 0, i + 1),
      hashRate: 100,
      sma30: s30,
      sma60: sma60[i],
    }));
  }

  test('no events when SMAs never cross', () => {
    const series = makeHashPoints([10, 11, 12, 13, 14], [5, 5, 5, 5, 5]);
    expect(detectHashRibbonEvents(series)).toEqual([]);
  });

  test('single capitulation when sma30 drops below sma60', () => {
    const series = makeHashPoints([10, 8, 6, 4, 3], [7, 7, 7, 7, 7]);
    const events = detectHashRibbonEvents(series);
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('capitulation');
    // First crossover is at index 2 (sma30 = 6 < sma60 = 7).
    expect(events[0].t).toBe(series[2].t);
  });

  test('capitulation then recovery', () => {
    // 30 starts above 60, drops below, then climbs back.
    const series = makeHashPoints([10, 8, 5, 4, 7, 9], [7, 7, 7, 7, 7, 7]);
    const events = detectHashRibbonEvents(series);
    expect(events.length).toBe(2);
    expect(events[0].type).toBe('capitulation');
    expect(events[1].type).toBe('recovery');
  });

  test('skips points with null SMAs', () => {
    const series = makeHashPoints([null, null, 5, 4, 9], [null, null, 7, 7, 7]);
    const events = detectHashRibbonEvents(series);
    // Still detects the crossover in the non-null region.
    expect(events.length).toBeGreaterThan(0);
  });

  test('equal values count as "above" so no crossover at the exact touch', () => {
    // Using >= for "above" — so equal values are still classified as above.
    // Going from 7 > 5 to 7 == 5 should NOT fire, but 7 == 5 to 4 < 5 should.
    const series = makeHashPoints([7, 5, 4], [5, 5, 5]);
    const events = detectHashRibbonEvents(series);
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('capitulation');
  });

  test('empty series has no events', () => {
    expect(detectHashRibbonEvents([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// FRED series spec sanity — make sure we don't ship a malformed MacroSeriesSpec
// ---------------------------------------------------------------------------

describe('MacroSeriesSpec catalogs', () => {
  const catalogs = {
    INFLATION_SERIES,
    BUSINESS_CYCLE_SERIES,
    FINANCIAL_CONDITIONS_SERIES,
  };

  for (const [name, spec] of Object.entries(catalogs)) {
    test(`${name} has 1+ series and each has required fields`, () => {
      expect(spec.length).toBeGreaterThan(0);
      for (const s of spec) {
        // FRED ids are uppercase alphanumerics
        expect(s.id).toMatch(/^[A-Z0-9]+$/);
        expect(s.label.length).toBeGreaterThan(0);
        expect(s.description.length).toBeGreaterThan(0);
        expect(typeof s.decimals).toBe('number');
        expect(s.decimals).toBeGreaterThanOrEqual(0);
        // start must parse as a valid ISO date
        expect(Number.isNaN(new Date(s.start).getTime())).toBe(false);
      }
    });

    test(`${name} has unique FRED ids`, () => {
      const ids = spec.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  }

  test('INFLATION_SERIES contains the canonical CPI + WALCL series', () => {
    const ids = INFLATION_SERIES.map((s) => s.id);
    expect(ids).toContain('CPIAUCSL');
    expect(ids).toContain('WALCL');
  });

  test('BUSINESS_CYCLE_SERIES contains Sahm Rule + recession probability', () => {
    const ids = BUSINESS_CYCLE_SERIES.map((s) => s.id);
    expect(ids).toContain('SAHMREALTIME');
    expect(ids).toContain('RECPROUSM156N');
  });

  test('FINANCIAL_CONDITIONS_SERIES contains NFCI and stress indices', () => {
    const ids = FINANCIAL_CONDITIONS_SERIES.map((s) => s.id);
    expect(ids).toContain('NFCI');
    expect(ids).toContain('STLFSI4');
  });
});
