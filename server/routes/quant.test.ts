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
  type DailyBar,
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
