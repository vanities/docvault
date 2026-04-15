// Quant route handlers — market cycle analysis, risk metrics, sector rotation.
// Data sources: yahoo-finance2 (equities/ETFs), CoinGecko (crypto), FRED (macro).
// Cached to DATA_DIR/.docvault-quant-cache.json with per-endpoint TTLs.

import { promises as fs } from 'fs';
import path from 'path';
import { gzipSync } from 'fflate';
import YahooFinance from 'yahoo-finance2';
import { DATA_DIR, jsonResponse, loadSettings, QUANT_SNAPSHOTS_FILE } from '../data.js';
import { createLogger } from '../logger.js';

const yahooFinance = new YahooFinance();
const logQuant = createLogger('Quant');

const QUANT_CACHE_FILE = path.join(DATA_DIR, '.docvault-quant-cache.json');

const DAY_MS = 86_400_000;
const TTL = {
  presidentialCycle: 7 * DAY_MS, // monthly data — weekly refresh is plenty
  btcLogRegression: DAY_MS, // daily refresh
  sectorRotation: DAY_MS, // daily refresh (sector ETFs are end-of-day)
  shillerValuation: 7 * DAY_MS, // Shiller updates monthly; weekly refresh is plenty
  yieldCurve: DAY_MS, // FRED updates daily on business days
  btcDominance: 6 * 60 * 60 * 1000, // 6h — dominance changes slowly
  macroDashboard: DAY_MS, // FRED updates once per business day
  midtermDrawdowns: 7 * DAY_MS, // Shiller monthly — weekly refresh
  sp500RiskMetric: 7 * DAY_MS, // Shiller monthly — weekly refresh
  btcDerivatives: 30 * 60 * 1000, // 30 min — funding rate updates 3x/day
  altcoinSeason: 6 * 60 * 60 * 1000, // 6h — 90d return doesn't shift much hour-to-hour
  jobsDashboard: DAY_MS, // FRED labor data updates monthly
  fedPolicy: DAY_MS, // target range only moves on FOMC meetings
  businessCycle: DAY_MS, // monthly business cycle data
};

interface CacheEntry<T> {
  fetchedAt: number;
  data: T;
}

type QuantCache = {
  presidentialCycle?: CacheEntry<PresidentialCycleResponse>;
  btcLogRegression?: CacheEntry<BtcLogRegressionResponse>;
  sectorRotation?: CacheEntry<SectorRotationResponse>;
  shillerValuation?: CacheEntry<ShillerValuationResponse>;
  yieldCurve?: CacheEntry<YieldCurveResponse>;
  btcDominance?: CacheEntry<DominanceSnapshot>;
  macroDashboard?: CacheEntry<MacroDashboardResponse>;
  midtermDrawdowns?: CacheEntry<MidtermDrawdownResponse>;
  sp500RiskMetric?: CacheEntry<SP500RiskResponse>;
  btcDerivatives?: CacheEntry<BtcDerivativesResponse>;
  altcoinSeason?: CacheEntry<AltcoinSeasonResponse>;
  jobsDashboard?: CacheEntry<MacroDashboardResponse>;
  fedPolicy?: CacheEntry<FedPolicyResponse>;
  businessCycle?: CacheEntry<MacroDashboardResponse>;
};

async function loadCache(): Promise<QuantCache> {
  try {
    const raw = await fs.readFile(QUANT_CACHE_FILE, 'utf8');
    return JSON.parse(raw) as QuantCache;
  } catch {
    return {};
  }
}

async function saveCache(cache: QuantCache): Promise<void> {
  await fs.writeFile(QUANT_CACHE_FILE, JSON.stringify(cache, null, 2));
}

function isFresh(entry: CacheEntry<unknown> | undefined, ttl: number): boolean {
  return !!entry && Date.now() - entry.fetchedAt < ttl;
}

/** Run `fn` on every item in `items` with at most `concurrency` calls in
 *  flight at once. Respects upstream rate limits (yahoo-finance2, CoinGecko,
 *  etc.) and avoids tripping WAFs with burst traffic. Order of results
 *  matches input order. */
export async function batchWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (concurrency <= 0) throw new Error('concurrency must be positive');
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** gzip + Cache-Control wrapper for quant GET responses. Browsers will serve
 *  subsequent tab-switches from their own cache (no network, no re-parse) for
 *  `maxAge` seconds, and serve stale data while revalidating in the background
 *  for up to `swr` seconds. The manual Refresh button appends a ?_=bump query
 *  param which creates a unique URL, so it always bypasses the browser cache.
 *
 *  We only gzip when the client sent `Accept-Encoding: gzip` (all modern
 *  browsers do, but scripts without the header get uncompressed JSON). */
function cachedJsonResponse(
  req: Request,
  data: object,
  opts: { maxAge: number; swr: number }
): Response {
  const body = JSON.stringify(data);
  const acceptsGzip = (req.headers.get('accept-encoding') || '').includes('gzip');

  const commonHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    Vary: 'Accept-Encoding',
    'Cache-Control': `public, max-age=${opts.maxAge}, stale-while-revalidate=${opts.swr}`,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (acceptsGzip) {
    const gzipped = gzipSync(new TextEncoder().encode(body));
    return new Response(gzipped, {
      headers: { ...commonHeaders, 'Content-Encoding': 'gzip' },
    });
  }

  return new Response(body, { headers: commonHeaders });
}

const CACHE = {
  // Presidential cycle data only changes monthly; browser can hold it for 6h.
  presidentialCycle: { maxAge: 6 * 3600, swr: 24 * 3600 },
  // BTC regression updates daily at the server; browser 1h + SWR 12h is snappy.
  btcLogRegression: { maxAge: 3600, swr: 12 * 3600 },
  // Sector rotation uses EOD data — 1h browser cache + 12h SWR.
  sectorRotation: { maxAge: 3600, swr: 12 * 3600 },
  // Shiller valuation is monthly data — 6h cache + 24h SWR.
  shillerValuation: { maxAge: 6 * 3600, swr: 24 * 3600 },
  // Yield curve FRED data updates daily on business days — 1h cache + 12h SWR.
  yieldCurve: { maxAge: 3600, swr: 12 * 3600 },
  // BTC dominance is low-frequency — 30min cache + 6h SWR.
  btcDominance: { maxAge: 30 * 60, swr: 6 * 3600 },
  // Macro dashboard = aggregated FRED series — 1h + 12h SWR.
  macroDashboard: { maxAge: 3600, swr: 12 * 3600 },
  // Midterm drawdowns = monthly Shiller data — 6h + 24h SWR.
  midtermDrawdowns: { maxAge: 6 * 3600, swr: 24 * 3600 },
  // SP500 risk metric = monthly composite — 6h + 24h SWR.
  sp500RiskMetric: { maxAge: 6 * 3600, swr: 24 * 3600 },
  // BTC derivatives = OKX funding/OI — 10 min + 2h SWR.
  btcDerivatives: { maxAge: 600, swr: 2 * 3600 },
  // Altcoin season = 90d returns via yahoo — 2h + 12h SWR.
  altcoinSeason: { maxAge: 2 * 3600, swr: 12 * 3600 },
  // Jobs dashboard — 2h + 12h SWR.
  jobsDashboard: { maxAge: 2 * 3600, swr: 12 * 3600 },
  // Fed policy — 2h + 24h SWR (target moves only on FOMC meetings).
  fedPolicy: { maxAge: 2 * 3600, swr: 24 * 3600 },
  // Business cycle — 2h + 12h SWR (monthly releases, staggered).
  businessCycle: { maxAge: 2 * 3600, swr: 12 * 3600 },
  // Snapshots grow one row per day; short cache so new snapshots appear fast.
  snapshots: { maxAge: 300, swr: 3600 },
};

// ---------------------------------------------------------------------------
// Snapshot history — a per-day append-only log of key metrics, used to plot
// trend sparklines on each chart (e.g. "how has BTC residual sigma moved over
// the last year"). Written once per day by the scheduler.
// ---------------------------------------------------------------------------

export interface QuantSnapshot {
  /** YYYY-MM-DD */
  date: string;
  /** Unix ms when the snapshot was taken */
  takenAt: number;
  btc?: {
    price: number;
    fitted: number;
    residualSigma: number;
    slope: number;
    stdev: number;
    /** Composite 0-1 risk metric (null if insufficient history) */
    riskMetric: number | null;
  };
  spxCycle?: {
    currentYear: number;
    currentYearOfCycle: number;
    /** Expected return for the current (year-of-cycle, month) cell */
    currentExpectedReturn: number;
    /** Annual sum for the current year-of-cycle row */
    currentYearAnnualAvg: number;
  };
  sectorRotation?: {
    /** Top-ranked sector by RS ratio */
    topRS: { ticker: string; rsRatio: number };
    /** Top-ranked sector by 3M momentum */
    topMomentum: { ticker: string; momentum: number };
    /** Count of sectors in each quadrant */
    quadrantCounts: { leading: number; improving: number; weakening: number; lagging: number };
  };
  shillerValuation?: {
    /** Latest CAPE (PE10) */
    cape: number;
    /** CAPE percentile vs full history (0-100; higher = more expensive) */
    capePercentile: number;
    /** Latest SP500 dividend yield in % */
    divYield: number;
  };
  yieldCurve?: {
    /** Latest 10Y-2Y spread in percentage points */
    t10y2y: number;
    /** Latest 10Y-3M spread in percentage points */
    t10y3m: number | null;
    /** Inversion streak in days (positive = currently inverted, negative = normal) */
    inversionStreak: number;
    /** Regime classification */
    regime: string;
  };
  btcDominance?: {
    btcDominance: number;
    ethDominance: number;
    stableDominance: number;
    flightToSafety: number;
    totalMarketCapUsd: number;
  };
}

interface QuantSnapshotsFile {
  snapshots: QuantSnapshot[];
}

async function readSnapshots(): Promise<QuantSnapshotsFile> {
  try {
    const raw = await fs.readFile(QUANT_SNAPSHOTS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as QuantSnapshotsFile;
    return parsed.snapshots ? parsed : { snapshots: [] };
  } catch {
    return { snapshots: [] };
  }
}

async function writeSnapshots(file: QuantSnapshotsFile): Promise<void> {
  await fs.writeFile(QUANT_SNAPSHOTS_FILE, JSON.stringify(file, null, 2));
}

/** Append today's snapshot, overwriting if one for today already exists (so
 *  multiple intraday runs are idempotent — last one wins). */
async function appendSnapshot(snap: QuantSnapshot): Promise<void> {
  const file = await readSnapshots();
  const idx = file.snapshots.findIndex((s) => s.date === snap.date);
  if (idx >= 0) {
    file.snapshots[idx] = snap;
  } else {
    file.snapshots.push(snap);
    // Keep chronological order
    file.snapshots.sort((a, b) => a.date.localeCompare(b.date));
  }
  await writeSnapshots(file);
}

// ---------------------------------------------------------------------------
// Presidential / 4-year cycle
// ---------------------------------------------------------------------------
//
// Convention: Year-of-Cycle 1 = first year after a presidential election.
// For 2024 election → 2025 = Y1 (post-election), 2026 = Y2 (midterm), etc.
// Formula: yearOfCycle = ((year - 1) % 4) + 1 where year 1953 = Y1 (Eisenhower
// post-1952-election). This mapping is consistent for every year from 1789 on.

export interface PresidentialCycleResponse {
  /** 4×12 matrix: matrix[yearOfCycle-1][month-1] = avg % return since start */
  matrix: number[][];
  /** Count of data points per cell — useful for showing confidence */
  counts: number[][];
  /** Current calendar year */
  currentYear: number;
  /** Year of the 4-year presidential cycle (1-4) the current year sits in */
  currentYearOfCycle: number;
  /** Range of SPX data used */
  dataRange: { from: string; to: string };
  /** Row labels */
  yearLabels: string[];
  /** Column labels */
  monthLabels: string[];
  /** Which data source served the request */
  source: 'shiller' | 'yahoo-fallback';
}

export function yearOfCycle(year: number): number {
  // 1-indexed 1..4
  return ((year - 1) % 4) + 1;
}

/** Fetch monthly S&P 500 history from the Shiller dataset mirrored on GitHub.
 *  Monthly back to 1871 — ~155 years, ~38 data points per cycle cell. Free,
 *  no key, cached by GitHub's CDN. Maintained by the `datasets` org.
 *  https://github.com/datasets/s-and-p-500 */
const SHILLER_SP500_URL =
  'https://raw.githubusercontent.com/datasets/s-and-p-500/master/data/data.csv';

/** Full Shiller row — includes the valuation columns we use for CAPE and
 *  dividend yield charts in addition to the SP500 close. */
export interface ShillerRow {
  date: Date;
  sp500: number;
  /** Trailing 12-month dividends per share (Shiller's annualized figure) */
  dividend: number | null;
  /** Trailing 12-month earnings per share */
  earnings: number | null;
  /** CPI (inflation index) */
  cpi: number | null;
  /** 10-year average of real earnings — the denominator of CAPE */
  pe10: number | null;
}

/** Parse a line of the Shiller CSV into a ShillerRow. Returns null if the row
 *  is missing a valid date or SP500 price. */
export function parseShillerLine(line: string): ShillerRow | null {
  // Header: Date,SP500,Dividend,Earnings,Consumer Price Index,Long Interest Rate,Real Price,Real Dividend,Real Earnings,PE10
  const cols = line.split(',');
  if (cols.length < 10) return null;
  const dateStr = cols[0];
  const date = new Date(dateStr + 'T00:00:00Z');
  if (Number.isNaN(date.getTime())) return null;
  const sp500 = Number(cols[1]);
  if (!Number.isFinite(sp500) || sp500 <= 0) return null;

  const num = (s: string): number | null => {
    const v = Number(s);
    if (!Number.isFinite(v) || v <= 0) return null;
    return v;
  };

  return {
    date,
    sp500,
    dividend: num(cols[2]),
    earnings: num(cols[3]),
    cpi: num(cols[4]),
    pe10: num(cols[9]),
  };
}

async function fetchShillerFull(): Promise<ShillerRow[]> {
  const res = await fetch(SHILLER_SP500_URL, {
    headers: { Accept: 'text/csv', 'User-Agent': 'docvault/1.0' },
  });
  if (!res.ok) {
    throw new Error(`Shiller CSV ${res.status}: ${await res.text()}`);
  }
  const csv = await res.text();
  const lines = csv.trim().split('\n');
  const rows: ShillerRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const row = parseShillerLine(lines[i]);
    if (row) rows.push(row);
  }
  return rows;
}

async function fetchShillerSp500Monthly(): Promise<{ date: Date; close: number }[]> {
  const rows = await fetchShillerFull();
  return rows.map((r) => ({ date: r.date, close: r.sp500 }));
}

/** Fallback: yahoo-finance2 monthly ^GSPC (1985+). Used only if the Shiller
 *  CSV is unreachable. */
async function fetchYahooSp500Monthly(): Promise<{ date: Date; close: number }[]> {
  const result = await yahooFinance.chart('^GSPC', {
    period1: new Date('1950-01-01'),
    period2: new Date(),
    interval: '1mo',
  });
  const quotes = result.quotes ?? [];
  return quotes
    .filter((q) => q.close != null && q.date != null)
    .map((q) => ({ date: new Date(q.date as Date), close: q.close as number }));
}

async function computePresidentialCycle(): Promise<PresidentialCycleResponse> {
  // Primary: Shiller (1871+). Fallback: yahoo-finance2 (1985+).
  let bars: { date: Date; close: number }[];
  let source: 'shiller' | 'yahoo-fallback';
  try {
    bars = await fetchShillerSp500Monthly();
    source = 'shiller';
  } catch (err) {
    console.warn(
      `[quant] Shiller fetch failed, falling back to yahoo-finance2: ${
        err instanceof Error ? err.message : err
      }`
    );
    bars = await fetchYahooSp500Monthly();
    source = 'yahoo-fallback';
  }

  if (bars.length < 24) {
    throw new Error(`Insufficient SPX history (got ${bars.length} bars)`);
  }

  // Monthly % returns on the *closing month* — matrix cell is "what did cycle year
  // Y in month M return on average?"
  const matrix: number[][] = Array.from({ length: 4 }, () => Array(12).fill(0));
  const counts: number[][] = Array.from({ length: 4 }, () => Array(12).fill(0));

  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1].close;
    const curr = bars[i].close;
    if (!prev || !curr) continue;
    const ret = ((curr - prev) / prev) * 100;
    const d = bars[i].date;
    const yoc = yearOfCycle(d.getFullYear()) - 1; // 0-indexed row
    const m = d.getMonth(); // 0-indexed col (0 = Jan)
    matrix[yoc][m] += ret;
    counts[yoc][m] += 1;
  }

  for (let y = 0; y < 4; y++) {
    for (let m = 0; m < 12; m++) {
      matrix[y][m] = counts[y][m] > 0 ? matrix[y][m] / counts[y][m] : 0;
    }
  }

  const currentYear = new Date().getFullYear();
  return {
    matrix,
    counts,
    currentYear,
    currentYearOfCycle: yearOfCycle(currentYear),
    dataRange: {
      from: bars[0].date.toISOString().slice(0, 7),
      to: bars[bars.length - 1].date.toISOString().slice(0, 7),
    },
    yearLabels: ['Y1 (Post-election)', 'Y2 (Midterm)', 'Y3 (Pre-election)', 'Y4 (Election)'],
    monthLabels: [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ],
    source,
  };
}

// ---------------------------------------------------------------------------
// BTC log regression bands
// ---------------------------------------------------------------------------

export interface BtcLogRegressionResponse {
  /** Daily price series in ascending order */
  prices: { t: number; price: number }[];
  /** Regression line + ±1/±2 stdev bands, same length as prices */
  fit: {
    line: number[];
    upper1: number[];
    lower1: number[];
    upper2: number[];
    lower2: number[];
  };
  /** OLS coefficients: log10(price) = slope * log10(days) + intercept */
  slope: number;
  intercept: number;
  stdev: number;
  /** Most recent price and its position in the bands */
  latest: {
    price: number;
    fitted: number;
    residualSigma: number;
  };
  /** Long-term moving averages — 200-day (Mayer) and 200-week (Cowen cycle). */
  movingAverages: {
    /** 50-day SMA — used for Golden/Death Cross detection */
    sma50d: (number | null)[];
    /** 200-day SMA aligned with `prices` (Trace Mayer's denominator) */
    sma200d: (number | null)[];
    /** 200-week SMA = 1000 daily bars (Cowen's cycle trend line) */
    sma200w: (number | null)[];
    /** Mayer band multipliers applied to 200d SMA */
    mayerBandMultipliers: number[];
    latest: {
      sma50d: number | null;
      sma200d: number | null;
      sma200w: number | null;
      /** price / 200w — how far BTC is from the Cowen cycle line */
      priceVs200w: number | null;
    };
  };
  /** Golden/Death Cross events on the 50D × 200D pair. */
  goldenDeathCrosses: {
    /** Historical events: date + type */
    events: { t: number; type: 'golden' | 'death' }[];
    /** Current regime: 'bullish' when 50D > 200D, 'bearish' otherwise */
    currentRegime: 'bullish' | 'bearish' | 'unknown';
    /** Most recent cross event */
    latestEvent: { t: number; type: 'golden' | 'death' } | null;
  };
  /** Cowen Corridor data — 20-week SMA (100 daily bars) + the multipliers
   *  we render as corridor bands on the frontend. Null entries early in the
   *  series where the rolling window hasn't filled yet. */
  corridor: {
    /** 20W SMA aligned with `prices` */
    sma20w: (number | null)[];
    /** Multipliers applied to the SMA to form corridor levels */
    multipliers: number[];
    /** Current SMA value and where BTC sits in the corridor */
    latest: {
      sma20w: number | null;
      /** price / sma20w — the "corridor multiple" of current BTC */
      currentMultiple: number | null;
    };
  };
  /** Bull Market Support Band — 20W SMA + 21W EMA pair. Tests in Jan/Feb
   *  of halving years are Cowen's key signal. Arrays aligned with `prices`. */
  bmsb: {
    sma20w: (number | null)[];
    ema21w: (number | null)[];
    latest: {
      sma20w: number | null;
      ema21w: number | null;
      /** "above" when price is above both, "below" when below both, "inside" when between */
      state: 'above' | 'inside' | 'below' | 'unknown';
    };
  };
  /** Pi Cycle Top — 111D SMA vs 350D SMA × 2. When the faster crosses above
   *  the slower, it's called a cycle top (2013, 2017, 2021 all hit). */
  piCycle: {
    sma111d: (number | null)[];
    sma350dDouble: (number | null)[];
    /** True when 111D SMA > 350D SMA × 2 (top signal active) */
    signal: (boolean | null)[];
    latest: {
      sma111d: number | null;
      sma350dDouble: number | null;
      /** Ratio sma111d / sma350dDouble — 1.0 = crossover */
      ratio: number | null;
      signalActive: boolean;
    };
  };
  /** BTC Risk Metric — composite 0-1 Cowen-style score blended from 5 inputs.
   *  0 = deep value / accumulation, 1 = euphoria / distribution. Each input
   *  is percentile-ranked over a 5-year rolling window then averaged. */
  risk: {
    /** 0-1 composite aligned with `prices` */
    metric: (number | null)[];
    /** Raw inputs aligned with `prices` */
    components: {
      mayerMultiple: (number | null)[];
      sma20wDistance: (number | null)[];
      regressionSigma: (number | null)[];
      rsi14: (number | null)[];
      drawdownFromAth: (number | null)[];
    };
    /** Normalized (0-1) inputs aligned with `prices` — what actually gets averaged */
    normalized: {
      mayerMultiple: (number | null)[];
      sma20wDistance: (number | null)[];
      regressionSigma: (number | null)[];
      rsi14: (number | null)[];
      drawdownFromAth: (number | null)[];
    };
    latest: {
      metric: number | null;
      components: {
        mayerMultiple: number | null;
        sma20wDistance: number | null;
        regressionSigma: number | null;
        rsi14: number | null;
        drawdownFromAth: number | null;
      };
      normalized: {
        mayerMultiple: number | null;
        sma20wDistance: number | null;
        regressionSigma: number | null;
        rsi14: number | null;
        drawdownFromAth: number | null;
      };
    };
  };
}

/** Fetch daily BTC-USD history from yahoo-finance2. Has data back to
 *  2014-09-17 (~4000 daily bars) — enough for a solid log-regression fit.
 *  CoinGecko's free tier was restricted to 365 days in early 2024; yahoo is
 *  the most reliable free long-history source for crypto now. */
async function fetchBtcHistory(): Promise<{ t: number; price: number }[]> {
  const result = await yahooFinance.chart('BTC-USD', {
    period1: new Date('2014-01-01'),
    period2: new Date(),
    interval: '1d',
  });
  const quotes = result.quotes ?? [];
  return quotes
    .filter((q) => q.close != null && q.date != null)
    .map((q) => ({
      t: new Date(q.date as Date).getTime(),
      price: q.close as number,
    }))
    .filter((p) => p.price > 0);
}

async function computeBtcLogRegression(): Promise<BtcLogRegressionResponse> {
  const prices = await fetchBtcHistory();
  if (prices.length < 30) {
    throw new Error(`Insufficient BTC history (got ${prices.length} points)`);
  }

  // Bitcoin genesis block: 2009-01-03
  const GENESIS = Date.UTC(2009, 0, 3);
  const points = prices
    .filter((p) => p.price > 0 && p.t > GENESIS)
    .map((p) => ({
      t: p.t,
      price: p.price,
      daysSinceGenesis: (p.t - GENESIS) / DAY_MS,
    }));

  // OLS on log10(price) vs log10(days)
  const xs = points.map((p) => Math.log10(p.daysSinceGenesis));
  const ys = points.map((p) => Math.log10(p.price));
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  const slope = num / den;
  const intercept = meanY - slope * meanX;

  // Residual stdev (in log-space)
  let sqSum = 0;
  for (let i = 0; i < n; i++) {
    const fittedLog = slope * xs[i] + intercept;
    sqSum += (ys[i] - fittedLog) ** 2;
  }
  const stdev = Math.sqrt(sqSum / n);

  // Generate fit + bands back in price space
  const line: number[] = [];
  const upper1: number[] = [];
  const lower1: number[] = [];
  const upper2: number[] = [];
  const lower2: number[] = [];
  for (let i = 0; i < n; i++) {
    const fittedLog = slope * xs[i] + intercept;
    line.push(10 ** fittedLog);
    upper1.push(10 ** (fittedLog + stdev));
    lower1.push(10 ** (fittedLog - stdev));
    upper2.push(10 ** (fittedLog + 2 * stdev));
    lower2.push(10 ** (fittedLog - 2 * stdev));
  }

  const latestIdx = n - 1;
  const latestPrice = points[latestIdx].price;
  const latestFitted = line[latestIdx];
  const latestResidualSigma =
    (Math.log10(latestPrice) - (slope * xs[latestIdx] + intercept)) / stdev;

  // Cowen Corridor — 20-week SMA (100 daily bars) with empirically-chosen
  // multipliers that historically acted as BTC support/resistance levels.
  // The actual ITC multipliers are proprietary; these are reasonable picks.
  const priceArr = points.map((p) => p.price);
  const sma20w = sma(priceArr, 100);
  const sma50d = sma(priceArr, 50);
  const sma200d = sma(priceArr, 200);
  const sma200w = sma(priceArr, 1000); // 200 weeks × 5 trading days
  const latestSma = sma20w[sma20w.length - 1];
  const currentMultiple = latestSma != null ? latestPrice / latestSma : null;
  const CORRIDOR_MULTIPLIERS = [0.4, 0.6, 1.0, 1.6, 2.5, 4.0];
  // Mayer bands — classic reference levels at 0.8× (capitulation), 1× (the SMA
  // itself, fair value), 2.4× (historical top zone per Trace Mayer)
  const MAYER_BAND_MULTIPLIERS = [0.8, 1.0, 2.4];
  const latestSma50d = sma50d[sma50d.length - 1];
  const latestSma200d = sma200d[sma200d.length - 1];
  const latestSma200w = sma200w[sma200w.length - 1];
  const priceVs200w =
    latestSma200w != null && latestSma200w > 0 ? latestPrice / latestSma200w : null;

  // Golden/Death Crosses — 50D × 200D
  const crossSignals = detectCrossovers(sma50d, sma200d);
  const crossEvents: { t: number; type: 'golden' | 'death' }[] = [];
  for (let i = 0; i < crossSignals.length; i++) {
    const s = crossSignals[i];
    if (s === 'golden' || s === 'death') {
      crossEvents.push({ t: points[i].t, type: s });
    }
  }
  const currentRegime: 'bullish' | 'bearish' | 'unknown' =
    latestSma50d != null && latestSma200d != null
      ? latestSma50d >= latestSma200d
        ? 'bullish'
        : 'bearish'
      : 'unknown';
  const latestCrossEvent = crossEvents.length > 0 ? crossEvents[crossEvents.length - 1] : null;

  // ---- BMSB — Bull Market Support Band (20W SMA + 21W EMA) ----
  // 20W SMA = already computed as sma20w (100 daily bars)
  // 21W EMA = 105 daily bars
  const ema21w = ema(priceArr, 105);
  const latestEma21w = ema21w[ema21w.length - 1];
  let bmsbState: 'above' | 'inside' | 'below' | 'unknown' = 'unknown';
  if (latestSma != null && latestEma21w != null) {
    const upper = Math.max(latestSma, latestEma21w);
    const lower = Math.min(latestSma, latestEma21w);
    if (latestPrice > upper) bmsbState = 'above';
    else if (latestPrice < lower) bmsbState = 'below';
    else bmsbState = 'inside';
  }

  // ---- Pi Cycle Top — 111D SMA vs 350D SMA × 2 ----
  const sma111d = sma(priceArr, 111);
  const sma350d = sma(priceArr, 350);
  const sma350dDouble: (number | null)[] = sma350d.map((v) => (v != null ? v * 2 : null));
  const piCycleSignal: (boolean | null)[] = sma111d.map((s, i) => {
    const d = sma350dDouble[i];
    if (s == null || d == null) return null;
    return s > d;
  });
  const latestSma111d = sma111d[sma111d.length - 1];
  const latestSma350dDouble = sma350dDouble[sma350dDouble.length - 1];
  const piRatio =
    latestSma111d != null && latestSma350dDouble != null && latestSma350dDouble > 0
      ? latestSma111d / latestSma350dDouble
      : null;
  const piSignalActive = piRatio != null && piRatio > 1;

  // ---- Risk Metric components ----
  // 1. Mayer multiple: price / 200d SMA (Trace Mayer's classic indicator)
  const mayerMultiple: (number | null)[] = priceArr.map((p, i) => {
    const s = sma200d[i];
    return s != null && s > 0 ? p / s : null;
  });
  // 2. 20W SMA distance (relative deviation from 20WMA)
  const sma20wDistance: (number | null)[] = priceArr.map((p, i) => {
    const s = sma20w[i];
    return s != null && s > 0 ? (p - s) / s : null;
  });
  // 3. Log-regression residual σ (reuse xs/ys from earlier OLS fit)
  const regressionSigma: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const expectedLog = slope * xs[i] + intercept;
    regressionSigma[i] = (ys[i] - expectedLog) / stdev;
  }
  // 4. RSI-14 on daily closes
  const rsi14 = rsi(priceArr, 14);
  // 5. Drawdown from ATH (always ≤ 0, so we negate so "deeper drawdown" = lower 0-1 score)
  const drawdownFromAth = runningDrawdown(priceArr);
  // For drawdown we want "near ATH = high risk", so the raw value (0 near ATH, -0.8 deep)
  // already orders higher → more risk. Percentile rank will handle it.

  // ---- Normalize each component via rolling 5-year percentile (1260 daily bars) ----
  const PERCENTILE_WINDOW = 1260;
  const mayerPct = rollingPercentile(mayerMultiple, PERCENTILE_WINDOW);
  const sma20wDistPct = rollingPercentile(sma20wDistance, PERCENTILE_WINDOW);
  const regressionPct = rollingPercentile(regressionSigma, PERCENTILE_WINDOW);
  const rsi14Pct = rollingPercentile(rsi14, PERCENTILE_WINDOW);
  const drawdownPct = rollingPercentile(drawdownFromAth as (number | null)[], PERCENTILE_WINDOW);

  // ---- Composite: average of all non-null normalized inputs ----
  const riskMetric: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const inputs = [
      mayerPct[i],
      sma20wDistPct[i],
      regressionPct[i],
      rsi14Pct[i],
      drawdownPct[i],
    ].filter((v): v is number => v != null);
    if (inputs.length >= 3) {
      riskMetric[i] = inputs.reduce((a, b) => a + b, 0) / inputs.length;
    }
  }
  const latestDrawdownRaw = drawdownFromAth[n - 1];

  return {
    prices: points.map((p) => ({ t: p.t, price: p.price })),
    fit: { line, upper1, lower1, upper2, lower2 },
    slope,
    intercept,
    stdev,
    latest: {
      price: latestPrice,
      fitted: latestFitted,
      residualSigma: latestResidualSigma,
    },
    movingAverages: {
      sma50d,
      sma200d,
      sma200w,
      mayerBandMultipliers: MAYER_BAND_MULTIPLIERS,
      latest: {
        sma50d: latestSma50d,
        sma200d: latestSma200d,
        sma200w: latestSma200w,
        priceVs200w,
      },
    },
    goldenDeathCrosses: {
      events: crossEvents,
      currentRegime,
      latestEvent: latestCrossEvent,
    },
    corridor: {
      sma20w,
      multipliers: CORRIDOR_MULTIPLIERS,
      latest: {
        sma20w: latestSma,
        currentMultiple,
      },
    },
    bmsb: {
      sma20w,
      ema21w,
      latest: {
        sma20w: latestSma,
        ema21w: latestEma21w,
        state: bmsbState,
      },
    },
    piCycle: {
      sma111d,
      sma350dDouble,
      signal: piCycleSignal,
      latest: {
        sma111d: latestSma111d,
        sma350dDouble: latestSma350dDouble,
        ratio: piRatio,
        signalActive: piSignalActive,
      },
    },
    risk: {
      metric: riskMetric,
      components: {
        mayerMultiple,
        sma20wDistance,
        regressionSigma,
        rsi14,
        drawdownFromAth,
      },
      normalized: {
        mayerMultiple: mayerPct,
        sma20wDistance: sma20wDistPct,
        regressionSigma: regressionPct,
        rsi14: rsi14Pct,
        drawdownFromAth: drawdownPct,
      },
      latest: {
        metric: riskMetric[n - 1],
        components: {
          mayerMultiple: mayerMultiple[n - 1],
          sma20wDistance: sma20wDistance[n - 1],
          regressionSigma: regressionSigma[n - 1],
          rsi14: rsi14[n - 1],
          drawdownFromAth: latestDrawdownRaw,
        },
        normalized: {
          mayerMultiple: mayerPct[n - 1],
          sma20wDistance: sma20wDistPct[n - 1],
          regressionSigma: regressionPct[n - 1],
          rsi14: rsi14Pct[n - 1],
          drawdownFromAth: drawdownPct[n - 1],
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Altcoin Season Index (Crypto) — how many of the top 50 alts have
// outperformed BTC over the past 90 days.
// ---------------------------------------------------------------------------
//
// Per ITC: "If the Altcoin Season Index is larger than 75 then it is altcoin
// season. Lower than 25 it is Bitcoin season." We hardcode a list of major
// non-stablecoin crypto tickers on Yahoo Finance and fetch 90d price history
// for each. CoinGecko's free tier dropped 90d returns in early 2024, so
// Yahoo is the reliable free source.

export interface AltCoinEntry {
  symbol: string;
  name: string;
  price: number;
  return90d: number;
  /** Outperformance vs BTC in percentage points */
  outperformance: number;
  beatsBtc: boolean;
}

export interface AltcoinSeasonResponse {
  /** Index value 0-100. Per ITC: >75 = altseason, <25 = bitcoin season */
  indexValue: number;
  regime: 'bitcoin-season' | 'neutral' | 'altcoin-season';
  /** BTC's own 90d return as a decimal (e.g. -0.20 = -20%) */
  btcReturn90d: number;
  /** Per-coin breakdown, sorted by outperformance descending */
  coins: AltCoinEntry[];
  outperformerCount: number;
  totalCounted: number;
  /** Tickers we couldn't fetch (for diagnostics) */
  skipped: string[];
  fetchedAt: number;
  source: 'yahoo';
}

/** Major non-stablecoin crypto tickers on Yahoo Finance. Curated by market
 *  cap with wrapped/staked/stablecoin variants filtered out. Tickers with
 *  numeric suffixes (e.g. `TON11419-USD`) are Yahoo's way of disambiguating
 *  coins that share a symbol with older/different assets. */
const ALT_TICKERS: { yahoo: string; symbol: string; name: string }[] = [
  { yahoo: 'ETH-USD', symbol: 'ETH', name: 'Ethereum' },
  { yahoo: 'XRP-USD', symbol: 'XRP', name: 'XRP' },
  { yahoo: 'BNB-USD', symbol: 'BNB', name: 'BNB' },
  { yahoo: 'SOL-USD', symbol: 'SOL', name: 'Solana' },
  { yahoo: 'DOGE-USD', symbol: 'DOGE', name: 'Dogecoin' },
  { yahoo: 'ADA-USD', symbol: 'ADA', name: 'Cardano' },
  { yahoo: 'TRX-USD', symbol: 'TRX', name: 'TRON' },
  { yahoo: 'LINK-USD', symbol: 'LINK', name: 'Chainlink' },
  { yahoo: 'AVAX-USD', symbol: 'AVAX', name: 'Avalanche' },
  { yahoo: 'SHIB-USD', symbol: 'SHIB', name: 'Shiba Inu' },
  { yahoo: 'DOT-USD', symbol: 'DOT', name: 'Polkadot' },
  { yahoo: 'HBAR-USD', symbol: 'HBAR', name: 'Hedera' },
  { yahoo: 'TON11419-USD', symbol: 'TON', name: 'Toncoin' },
  { yahoo: 'BCH-USD', symbol: 'BCH', name: 'Bitcoin Cash' },
  { yahoo: 'LTC-USD', symbol: 'LTC', name: 'Litecoin' },
  { yahoo: 'NEAR-USD', symbol: 'NEAR', name: 'NEAR Protocol' },
  { yahoo: 'SUI20947-USD', symbol: 'SUI', name: 'Sui' },
  { yahoo: 'XLM-USD', symbol: 'XLM', name: 'Stellar' },
  { yahoo: 'APT21794-USD', symbol: 'APT', name: 'Aptos' },
  { yahoo: 'ATOM-USD', symbol: 'ATOM', name: 'Cosmos' },
  { yahoo: 'ICP-USD', symbol: 'ICP', name: 'Internet Computer' },
  { yahoo: 'FIL-USD', symbol: 'FIL', name: 'Filecoin' },
  { yahoo: 'XMR-USD', symbol: 'XMR', name: 'Monero' },
  { yahoo: 'IMX10603-USD', symbol: 'IMX', name: 'Immutable' },
  { yahoo: 'KAS-USD', symbol: 'KAS', name: 'Kaspa' },
  { yahoo: 'ARB11841-USD', symbol: 'ARB', name: 'Arbitrum' },
  { yahoo: 'OP-USD', symbol: 'OP', name: 'Optimism' },
  { yahoo: 'VET-USD', symbol: 'VET', name: 'VeChain' },
  { yahoo: 'MKR-USD', symbol: 'MKR', name: 'Maker' },
  { yahoo: 'STX4847-USD', symbol: 'STX', name: 'Stacks' },
  { yahoo: 'INJ-USD', symbol: 'INJ', name: 'Injective' },
  { yahoo: 'TIA22861-USD', symbol: 'TIA', name: 'Celestia' },
  { yahoo: 'RNDR-USD', symbol: 'RNDR', name: 'Render' },
  { yahoo: 'LDO-USD', symbol: 'LDO', name: 'Lido DAO' },
  { yahoo: 'GRT6719-USD', symbol: 'GRT', name: 'The Graph' },
  { yahoo: 'AAVE-USD', symbol: 'AAVE', name: 'Aave' },
  { yahoo: 'FTM-USD', symbol: 'FTM', name: 'Fantom' },
  { yahoo: 'ALGO-USD', symbol: 'ALGO', name: 'Algorand' },
  { yahoo: 'FLOW-USD', symbol: 'FLOW', name: 'Flow' },
  { yahoo: 'EGLD-USD', symbol: 'EGLD', name: 'MultiversX' },
  { yahoo: 'MATIC-USD', symbol: 'MATIC', name: 'Polygon' },
  { yahoo: 'THETA-USD', symbol: 'THETA', name: 'Theta' },
  { yahoo: 'SAND-USD', symbol: 'SAND', name: 'The Sandbox' },
  { yahoo: 'AXS-USD', symbol: 'AXS', name: 'Axie Infinity' },
  { yahoo: 'XTZ-USD', symbol: 'XTZ', name: 'Tezos' },
  { yahoo: 'SEI-USD', symbol: 'SEI', name: 'Sei' },
  { yahoo: 'ETC-USD', symbol: 'ETC', name: 'Ethereum Classic' },
  { yahoo: 'MANA-USD', symbol: 'MANA', name: 'Decentraland' },
  { yahoo: 'CHZ-USD', symbol: 'CHZ', name: 'Chiliz' },
  { yahoo: 'SNX-USD', symbol: 'SNX', name: 'Synthetix' },
];

async function fetchYahoo90dReturn(yahooSym: string): Promise<{
  return90d: number | null;
  currentPrice: number;
}> {
  const period2 = new Date();
  const period1 = new Date(period2.getTime() - 130 * DAY_MS);
  try {
    const result = await yahooFinance.chart(yahooSym, {
      period1,
      period2,
      interval: '1d',
    });
    const quotes = result.quotes ?? [];
    const closes = quotes
      .filter((q) => q.close != null && (q.close as number) > 0)
      .map((q) => q.close as number);
    if (closes.length < 60) return { return90d: null, currentPrice: 0 };
    const current = closes[closes.length - 1];
    // 90 calendar days for crypto (trades 7 days/week) → 90 bars
    const ago = closes.length >= 90 ? closes[closes.length - 90] : closes[0];
    if (!ago || ago <= 0) return { return90d: null, currentPrice: current };
    return { return90d: (current - ago) / ago, currentPrice: current };
  } catch {
    return { return90d: null, currentPrice: 0 };
  }
}

async function computeAltcoinSeasonIndex(): Promise<AltcoinSeasonResponse> {
  // Fetch BTC baseline first — single request
  const btcResult = await fetchYahoo90dReturn('BTC-USD');
  if (btcResult.return90d == null) {
    throw new Error('Failed to fetch BTC 90d baseline');
  }
  const btcReturn90d = btcResult.return90d;

  // Then fetch the 50 alts with a concurrency cap to respect yahoo-finance2
  // rate limits. Total is 50 fetches across ~6 waves of 8 ≈ 3-5 seconds.
  const altResults = await batchWithConcurrency(ALT_TICKERS, 8, async (t) =>
    fetchYahoo90dReturn(t.yahoo)
  );

  const coins: AltCoinEntry[] = [];
  const skipped: string[] = [];
  altResults.forEach((r, i) => {
    const t = ALT_TICKERS[i];
    if (r.return90d == null) {
      skipped.push(t.symbol);
      return;
    }
    const outperformance = (r.return90d - btcReturn90d) * 100;
    coins.push({
      symbol: t.symbol,
      name: t.name,
      price: r.currentPrice,
      return90d: r.return90d,
      outperformance,
      beatsBtc: r.return90d > btcReturn90d,
    });
  });

  coins.sort((a, b) => b.outperformance - a.outperformance);
  const outperformerCount = coins.filter((c) => c.beatsBtc).length;
  const totalCounted = coins.length;
  const indexValue = totalCounted > 0 ? (outperformerCount / totalCounted) * 100 : 0;

  const regime: AltcoinSeasonResponse['regime'] =
    indexValue >= 75 ? 'altcoin-season' : indexValue <= 25 ? 'bitcoin-season' : 'neutral';

  return {
    indexValue,
    regime,
    btcReturn90d,
    coins,
    outperformerCount,
    totalCounted,
    skipped,
    fetchedAt: Date.now(),
    source: 'yahoo',
  };
}

// ---------------------------------------------------------------------------
// BTC Derivatives (Crypto) — funding rate, open interest, long/short ratio
// ---------------------------------------------------------------------------
//
// Sourced from OKX's free public API. Binance futures is US-blocked, Bybit
// is also US-blocked (403 from their edge); OKX remains accessible and
// serves aggregate BTC derivatives data with no auth required.

export interface FundingRatePoint {
  /** Unix ms */
  t: number;
  /** Funding rate in decimal (e.g. 0.0001 = 0.01%) */
  rate: number;
}

export interface OpenInterestPoint {
  /** Unix ms */
  t: number;
  /** Open interest in USD notional */
  oiUsd: number;
}

export interface LongShortPoint {
  /** Unix ms */
  t: number;
  /** Long / short account ratio (1.0 = balanced, > 1 = more longs) */
  ratio: number;
}

export interface BtcDerivativesResponse {
  currentFundingRate: number;
  /** Annualized funding rate ≈ rate × 3 × 365 (BTC funds 3x/day on OKX) */
  annualizedFundingRate: number;
  currentOpenInterestUsd: number;
  currentLongShortRatio: number | null;
  fundingHistory: FundingRatePoint[];
  openInterestHistory: OpenInterestPoint[];
  longShortHistory: LongShortPoint[];
  fetchedAt: number;
  source: 'okx';
}

interface OkxFundingHistoryRaw {
  code: string;
  msg: string;
  data?: { fundingTime: string; fundingRate: string; realizedRate?: string }[];
}
interface OkxOiCurrentRaw {
  code: string;
  msg: string;
  data?: { oiUsd: string; ts: string }[];
}
interface OkxOiHistoryRaw {
  code: string;
  msg: string;
  data?: string[][];
}
interface OkxLongShortRaw {
  code: string;
  msg: string;
  data?: string[][];
}

async function fetchOkxJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'docvault/1.0' },
  });
  if (!res.ok) {
    throw new Error(`OKX ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

async function computeBtcDerivatives(): Promise<BtcDerivativesResponse> {
  const [fundingHistRaw, oiCurrentRaw, oiHistRaw, lsRaw] = await Promise.all([
    fetchOkxJson<OkxFundingHistoryRaw>(
      'https://www.okx.com/api/v5/public/funding-rate-history?instId=BTC-USDT-SWAP&limit=100'
    ),
    fetchOkxJson<OkxOiCurrentRaw>(
      'https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=BTC-USDT-SWAP'
    ),
    fetchOkxJson<OkxOiHistoryRaw>(
      'https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-volume?ccy=BTC&period=1D'
    ),
    fetchOkxJson<OkxLongShortRaw>(
      'https://www.okx.com/api/v5/rubik/stat/contracts/long-short-account-ratio?ccy=BTC&period=1D'
    ),
  ]);

  const fundingHistory: FundingRatePoint[] = (fundingHistRaw.data ?? [])
    .map((row) => ({
      t: Number(row.fundingTime),
      rate: Number(row.realizedRate ?? row.fundingRate),
    }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.rate))
    .sort((a, b) => a.t - b.t);

  const currentOiRow = oiCurrentRaw.data?.[0];
  const currentOpenInterestUsd = currentOiRow ? Number(currentOiRow.oiUsd) : 0;

  const openInterestHistory: OpenInterestPoint[] = (oiHistRaw.data ?? [])
    .map((row) => ({ t: Number(row[0]), oiUsd: Number(row[1]) }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.oiUsd) && p.oiUsd > 0)
    .sort((a, b) => a.t - b.t);

  const longShortHistory: LongShortPoint[] = (lsRaw.data ?? [])
    .map((row) => ({ t: Number(row[0]), ratio: Number(row[1]) }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.ratio))
    .sort((a, b) => a.t - b.t);

  const currentFundingRate =
    fundingHistory.length > 0 ? fundingHistory[fundingHistory.length - 1].rate : 0;
  // BTC funds 3x/day on OKX → annualized ≈ rate × 3 × 365
  const annualizedFundingRate = currentFundingRate * 3 * 365;
  const currentLongShortRatio =
    longShortHistory.length > 0 ? longShortHistory[longShortHistory.length - 1].ratio : null;

  return {
    currentFundingRate,
    annualizedFundingRate,
    currentOpenInterestUsd,
    currentLongShortRatio,
    fundingHistory,
    openInterestHistory,
    longShortHistory,
    fetchedAt: Date.now(),
    source: 'okx',
  };
}

// ---------------------------------------------------------------------------
// Bitcoin Dominance (Crypto)
// ---------------------------------------------------------------------------
//
// CoinGecko's /global endpoint is free and returns current dominance for
// all major coins. No key required. We cache aggressively since the value
// only needs daily precision for macro charts.

export interface DominanceSnapshot {
  /** Current BTC dominance in percent (0-100) */
  btcDominance: number;
  /** ETH dominance in percent */
  ethDominance: number;
  /** Stablecoin dominance approximation (USDT, USDC, DAI, BUSD summed) */
  stableDominance: number;
  /** Cowen's "flight to safety" = BTC + stablecoins */
  flightToSafety: number;
  /** Total crypto market cap in USD */
  totalMarketCapUsd: number;
  /** 24h change in total market cap */
  totalMarketCapChange24h: number;
  /** Stablecoin Supply Ratio = BTC market cap / stablecoin market cap.
   *  Low SSR = lots of dry powder on the sidelines. High SSR = money already
   *  deployed into BTC. Per ITC: "The Stablecoin Supply Ratio is equal to
   *  the Bitcoin market cap divided by the stablecoin market cap." */
  ssr: number;
  /** When the snapshot was captured */
  fetchedAt: number;
  source: 'coingecko';
}

interface CoinGeckoGlobalResponse {
  data: {
    total_market_cap: Record<string, number>;
    total_volume: Record<string, number>;
    market_cap_percentage: Record<string, number>;
    market_cap_change_percentage_24h_usd: number;
  };
}

async function fetchBtcDominance(): Promise<DominanceSnapshot> {
  const res = await fetch('https://api.coingecko.com/api/v3/global', {
    headers: { Accept: 'application/json', 'User-Agent': 'docvault/1.0' },
  });
  if (!res.ok) {
    throw new Error(`CoinGecko /global ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as CoinGeckoGlobalResponse;
  const pct = json.data.market_cap_percentage;
  const btc = pct.btc ?? 0;
  const eth = pct.eth ?? 0;
  // CoinGecko doesn't return every stablecoin individually; sum the big ones
  const stable =
    (pct.usdt ?? 0) + (pct.usdc ?? 0) + (pct.dai ?? 0) + (pct.busd ?? 0) + (pct.tusd ?? 0);
  // SSR = BTC mcap / stablecoin mcap = btc dominance / stable dominance
  const ssr = stable > 0 ? btc / stable : 0;
  return {
    btcDominance: btc,
    ethDominance: eth,
    stableDominance: stable,
    flightToSafety: btc + stable,
    totalMarketCapUsd: json.data.total_market_cap.usd ?? 0,
    totalMarketCapChange24h: json.data.market_cap_change_percentage_24h_usd ?? 0,
    ssr,
    fetchedAt: Date.now(),
    source: 'coingecko',
  };
}

// ---------------------------------------------------------------------------
// Sector Rotation (TradFi)
// ---------------------------------------------------------------------------
//
// Rank the 11 S&P sector SPDR ETFs by their Relative Strength vs SPY and
// Momentum, then classify each into one of 4 quadrants (Relative Rotation
// Graph style — Leading / Improving / Weakening / Lagging).
//
// Metrics computed per sector:
//   RS Ratio  = 100 × (sector/sector_Nd_ago) ÷ (spy/spy_Nd_ago)  using N=252
//   Momentum  = 100 × (sector/sector_Md_ago) ÷ (spy/spy_Md_ago)  using M=63
//
// - RS > 100: sector has outperformed SPY over the past year
// - Mom > 100: sector has outperformed SPY over the past quarter
//
// The cross classifies:
//   (RS > 100, Mom > 100) → Leading       — already winning, trend-follow
//   (RS < 100, Mom > 100) → Improving     — turning up, best risk-reward
//   (RS > 100, Mom < 100) → Weakening     — rolling over, take profits
//   (RS < 100, Mom < 100) → Lagging       — broken, avoid until improving
//
// We also report raw period returns (1w, 1m, 3m, 6m, YTD) so the user can
// sort by any metric they care about.

export interface SectorReturn {
  /** ETF ticker symbol */
  ticker: string;
  /** Human-readable sector name */
  name: string;
  /** Latest close */
  price: number;
  /** Raw period returns in % */
  returns: {
    d1: number | null;
    w1: number | null;
    m1: number | null;
    m3: number | null;
    m6: number | null;
    ytd: number | null;
  };
  /** RS ratio vs SPY on a 1-year window. 100 = matching SPY */
  rsRatio: number | null;
  /** Momentum vs SPY on a 3-month window. 100 = matching SPY */
  momentum: number | null;
  /** Quadrant classification based on rsRatio and momentum */
  quadrant: 'leading' | 'improving' | 'weakening' | 'lagging' | 'unknown';
}

export interface SectorRotationResponse {
  /** SPY baseline itself (useful for sorting display) */
  benchmark: SectorReturn;
  /** The 11 sectors */
  sectors: SectorReturn[];
  /** Range of data used */
  dataRange: { from: string; to: string };
  /** Data source identifier */
  source: 'yahoo';
}

const SECTOR_ETFS: Array<{ ticker: string; name: string }> = [
  { ticker: 'XLE', name: 'Energy' },
  { ticker: 'XLB', name: 'Materials' },
  { ticker: 'XLI', name: 'Industrials' },
  { ticker: 'XLY', name: 'Consumer Discretionary' },
  { ticker: 'XLF', name: 'Financials' },
  { ticker: 'XLK', name: 'Technology' },
  { ticker: 'XLC', name: 'Communication Services' },
  { ticker: 'XLU', name: 'Utilities' },
  { ticker: 'XLP', name: 'Consumer Staples' },
  { ticker: 'XLV', name: 'Healthcare' },
  { ticker: 'XLRE', name: 'Real Estate' },
];

export interface DailyBar {
  t: number; // ms
  close: number;
}

async function fetchYahooDaily(symbol: string, period1: Date, period2: Date): Promise<DailyBar[]> {
  const result = await yahooFinance.chart(symbol, {
    period1,
    period2,
    interval: '1d',
  });
  const quotes = result.quotes ?? [];
  return quotes
    .filter((q) => q.close != null && q.date != null)
    .map((q) => ({
      t: new Date(q.date as Date).getTime(),
      close: q.close as number,
    }))
    .filter((b) => b.close > 0);
}

/** Get the close N trading days ago (not calendar days). Returns null if
 *  the history is too short. */
export function closeNBack(bars: DailyBar[], n: number): number | null {
  if (bars.length <= n) return null;
  return bars[bars.length - 1 - n].close;
}

/** Get the close at the latest bar on or before YYYY-01-01 of the current
 *  year. Used for YTD returns. */
export function ytdStartClose(bars: DailyBar[], asOf: Date = new Date()): number | null {
  const thisYear = asOf.getFullYear();
  const yearStart = new Date(Date.UTC(thisYear, 0, 1)).getTime();
  // First bar on or after year start = YTD baseline
  const idx = bars.findIndex((b) => b.t >= yearStart);
  if (idx < 0) return null;
  // Use the bar BEFORE year start (last close of prior year) if available
  const baseIdx = idx > 0 ? idx - 1 : idx;
  return bars[baseIdx].close;
}

export function pctChange(current: number, base: number | null): number | null {
  if (base == null || base === 0) return null;
  return ((current - base) / base) * 100;
}

/** Compute RS ratio = 100 × (sector return) / (benchmark return) over N
 *  trading days. Returns null if not enough history. */
export function rsRatio(sector: DailyBar[], benchmark: DailyBar[], nDays: number): number | null {
  const sectorNow = sector[sector.length - 1]?.close;
  const sectorThen = closeNBack(sector, nDays);
  const spyNow = benchmark[benchmark.length - 1]?.close;
  const spyThen = closeNBack(benchmark, nDays);
  if (!sectorNow || !sectorThen || !spyNow || !spyThen) return null;
  const sectorGrowth = sectorNow / sectorThen;
  const spyGrowth = spyNow / spyThen;
  return (sectorGrowth / spyGrowth) * 100;
}

/** Classify a sector into one of the 4 Relative Rotation Graph quadrants
 *  based on RS ratio and momentum (both relative to a baseline of 100). */
export function classifyQuadrant(rs: number | null, mom: number | null): SectorReturn['quadrant'] {
  if (rs == null || mom == null) return 'unknown';
  if (rs >= 100 && mom >= 100) return 'leading';
  if (rs < 100 && mom >= 100) return 'improving';
  if (rs >= 100 && mom < 100) return 'weakening';
  return 'lagging';
}

export function computeSectorReturns(
  ticker: string,
  name: string,
  bars: DailyBar[],
  spy: DailyBar[],
  asOf: Date = new Date()
): SectorReturn {
  const last = bars[bars.length - 1];
  if (!last) {
    return {
      ticker,
      name,
      price: 0,
      returns: { d1: null, w1: null, m1: null, m3: null, m6: null, ytd: null },
      rsRatio: null,
      momentum: null,
      quadrant: 'unknown',
    };
  }
  const price = last.close;
  const rs = rsRatio(bars, spy, 252); // ~1 year of trading days
  const mom = rsRatio(bars, spy, 63); // ~3 months of trading days
  const quadrant = classifyQuadrant(rs, mom);

  return {
    ticker,
    name,
    price,
    returns: {
      d1: pctChange(price, closeNBack(bars, 1)),
      w1: pctChange(price, closeNBack(bars, 5)),
      m1: pctChange(price, closeNBack(bars, 21)),
      m3: pctChange(price, closeNBack(bars, 63)),
      m6: pctChange(price, closeNBack(bars, 126)),
      ytd: pctChange(price, ytdStartClose(bars, asOf)),
    },
    rsRatio: rs,
    momentum: mom,
    quadrant,
  };
}

async function computeSectorRotation(): Promise<SectorRotationResponse> {
  // Fetch 2 years of daily bars (need 252 bars + some slack for 1-year RS).
  const period2 = new Date();
  const period1 = new Date(period2.getTime() - 730 * DAY_MS);

  // Parallel fetch: SPY + 11 sectors
  const [spyBars, ...sectorResults] = await Promise.all([
    fetchYahooDaily('SPY', period1, period2),
    ...SECTOR_ETFS.map((s) => fetchYahooDaily(s.ticker, period1, period2)),
  ]);

  if (spyBars.length < 30) {
    throw new Error(`Insufficient SPY history (got ${spyBars.length} bars)`);
  }

  const benchmark = computeSectorReturns('SPY', 'S&P 500', spyBars, spyBars);
  // SPY vs itself is always 100 — force quadrant to unknown for clarity
  benchmark.quadrant = 'unknown';

  const sectors = SECTOR_ETFS.map((meta, i) =>
    computeSectorReturns(meta.ticker, meta.name, sectorResults[i], spyBars)
  );

  return {
    benchmark,
    sectors,
    dataRange: {
      from: new Date(spyBars[0].t).toISOString().slice(0, 10),
      to: new Date(spyBars[spyBars.length - 1].t).toISOString().slice(0, 10),
    },
    source: 'yahoo',
  };
}

// ---------------------------------------------------------------------------
// SP500 Risk Metric — Cowen-style 0-1 composite adapted for monthly SPX data
// from the Shiller cache. Same five-input blend as the BTC risk metric, but
// the inputs use monthly periods (12m SMA instead of 200d, 14m RSI, etc.)
// and the rolling percentile window is 50 years (600 months).
// ---------------------------------------------------------------------------

export interface SP500RiskResponse {
  /** Monthly time series in ascending order */
  points: { date: string; t: number; price: number }[];
  /** Composite 0-1 risk aligned with `points` */
  metric: (number | null)[];
  /** Raw input values aligned with `points` */
  components: {
    mayerLike12m: (number | null)[];
    sma24mDistance: (number | null)[];
    regressionSigma: (number | null)[];
    rsi14m: (number | null)[];
    drawdownFromAth: (number | null)[];
  };
  /** Percentile-ranked 0-1 inputs aligned with `points` */
  normalized: {
    mayerLike12m: (number | null)[];
    sma24mDistance: (number | null)[];
    regressionSigma: (number | null)[];
    rsi14m: (number | null)[];
    drawdownFromAth: (number | null)[];
  };
  latest: {
    date: string;
    price: number;
    metric: number | null;
    components: {
      mayerLike12m: number | null;
      sma24mDistance: number | null;
      regressionSigma: number | null;
      rsi14m: number | null;
      drawdownFromAth: number | null;
    };
    normalized: {
      mayerLike12m: number | null;
      sma24mDistance: number | null;
      regressionSigma: number | null;
      rsi14m: number | null;
      drawdownFromAth: number | null;
    };
  };
  dataRange: { from: string; to: string };
  source: 'shiller';
}

async function computeSP500RiskMetric(): Promise<SP500RiskResponse> {
  const rows = await fetchShillerFull();
  if (rows.length < 240) {
    throw new Error(`Insufficient Shiller history (got ${rows.length} rows)`);
  }

  const priceArr = rows.map((r) => r.sp500);
  const points = rows.map((r) => ({
    date: r.date.toISOString().slice(0, 7),
    t: r.date.getTime(),
    price: r.sp500,
  }));
  const n = points.length;

  // ---- Components (adapted to monthly timeframe) ----
  // 1. Mayer-like: price / 12-month SMA (equivalent of 200D on daily)
  const sma12m = sma(priceArr, 12);
  const mayerLike12m: (number | null)[] = priceArr.map((p, i) => {
    const s = sma12m[i];
    return s != null && s > 0 ? p / s : null;
  });
  // 2. 24-month SMA distance (stable medium-term distance metric)
  const sma24m = sma(priceArr, 24);
  const sma24mDistance: (number | null)[] = priceArr.map((p, i) => {
    const s = sma24m[i];
    return s != null && s > 0 ? (p - s) / s : null;
  });
  // 3. Log-regression residual σ — fit log10(price) vs month index
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < n; i++) {
    xs.push(Math.log10(i + 1));
    ys.push(Math.log10(priceArr[i]));
  }
  let meanX = 0;
  let meanY = 0;
  for (let i = 0; i < n; i++) {
    meanX += xs[i];
    meanY += ys[i];
  }
  meanX /= n;
  meanY /= n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  const slope = num / den;
  const intercept = meanY - slope * meanX;
  let sqSum = 0;
  for (let i = 0; i < n; i++) {
    const fitted = slope * xs[i] + intercept;
    sqSum += (ys[i] - fitted) ** 2;
  }
  const stdev = Math.sqrt(sqSum / n);
  const regressionSigma: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const fitted = slope * xs[i] + intercept;
    regressionSigma[i] = (ys[i] - fitted) / stdev;
  }
  // 4. 14-month RSI
  const rsi14m = rsi(priceArr, 14);
  // 5. Drawdown from ATH
  const drawdownFromAth = runningDrawdown(priceArr);

  // ---- Normalize via rolling 50-year (600 month) percentile ----
  const WINDOW = 600;
  const mayerPct = rollingPercentile(mayerLike12m, WINDOW);
  const sma24mDistPct = rollingPercentile(sma24mDistance, WINDOW);
  const regressionPct = rollingPercentile(regressionSigma, WINDOW);
  const rsi14mPct = rollingPercentile(rsi14m, WINDOW);
  const drawdownPct = rollingPercentile(drawdownFromAth as (number | null)[], WINDOW);

  // ---- Composite ----
  const metric: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const inputs = [
      mayerPct[i],
      sma24mDistPct[i],
      regressionPct[i],
      rsi14mPct[i],
      drawdownPct[i],
    ].filter((v): v is number => v != null);
    if (inputs.length >= 3) {
      metric[i] = inputs.reduce((a, b) => a + b, 0) / inputs.length;
    }
  }

  const last = points[n - 1];
  return {
    points,
    metric,
    components: {
      mayerLike12m,
      sma24mDistance,
      regressionSigma,
      rsi14m,
      drawdownFromAth: drawdownFromAth as (number | null)[],
    },
    normalized: {
      mayerLike12m: mayerPct,
      sma24mDistance: sma24mDistPct,
      regressionSigma: regressionPct,
      rsi14m: rsi14mPct,
      drawdownFromAth: drawdownPct,
    },
    latest: {
      date: last.date,
      price: last.price,
      metric: metric[n - 1],
      components: {
        mayerLike12m: mayerLike12m[n - 1],
        sma24mDistance: sma24mDistance[n - 1],
        regressionSigma: regressionSigma[n - 1],
        rsi14m: rsi14m[n - 1],
        drawdownFromAth: drawdownFromAth[n - 1],
      },
      normalized: {
        mayerLike12m: mayerPct[n - 1],
        sma24mDistance: sma24mDistPct[n - 1],
        regressionSigma: regressionPct[n - 1],
        rsi14m: rsi14mPct[n - 1],
        drawdownFromAth: drawdownPct[n - 1],
      },
    },
    dataRange: { from: points[0].date, to: last.date },
    source: 'shiller',
  };
}

// ---------------------------------------------------------------------------
// Midterm Drawdown Overlay — every midterm year since 1871 as a normalized
// drawdown curve from the pre-midterm peak through end of Y3. Shows whether
// 2026 is tracking ahead or behind the historical midterm-then-recovery
// pattern. Uses the Shiller CSV we already cache.
// ---------------------------------------------------------------------------

export interface MidtermCurvePoint {
  /** Offset in months from the pre-midterm peak (0 = peak) */
  offsetMonths: number;
  /** Drawdown from the peak expressed as a decimal (0 = at peak, -0.3 = -30%) */
  drawdown: number;
}

export interface MidtermCurve {
  midtermYear: number;
  label: string;
  isCurrent: boolean;
  points: MidtermCurvePoint[];
  peakClose: number;
  peakDate: string;
}

export interface MidtermDrawdownResponse {
  curves: MidtermCurve[];
  averageCurve: MidtermCurvePoint[];
  dataRange: { from: string; to: string };
  source: 'shiller';
}

async function computeMidtermDrawdowns(): Promise<MidtermDrawdownResponse> {
  const rows = await fetchShillerFull();
  if (rows.length < 240) {
    throw new Error(`Insufficient Shiller history (got ${rows.length} rows)`);
  }

  const byYear = new Map<number, ShillerRow[]>();
  for (const r of rows) {
    const y = r.date.getUTCFullYear();
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y)!.push(r);
  }

  const curves: MidtermCurve[] = [];
  const currentYear = new Date().getUTCFullYear();
  const currentYoC = yearOfCycle(currentYear);

  for (let y = 1871; y <= currentYear; y++) {
    if (yearOfCycle(y) !== 2) continue;

    const y1Rows = byYear.get(y - 1);
    const y2Rows = byYear.get(y);
    const y3Rows = byYear.get(y + 1);
    if (!y1Rows || !y2Rows) continue;

    const window: ShillerRow[] = [...y1Rows, ...y2Rows, ...(y3Rows ?? [])];
    if (window.length < 12) continue;

    // Running max to find the peak
    let peak = window[0].sp500;
    let peakIdx = 0;
    for (let i = 0; i < window.length; i++) {
      if (window[i].sp500 > peak) {
        peak = window[i].sp500;
        peakIdx = i;
      }
    }

    // Only include windows where the peak occurs in the first half — otherwise
    // the "drawdown from peak" framing doesn't apply. Exception: the current
    // live midterm year is always included.
    const isCurrent = y === currentYear && currentYoC === 2;
    if (!isCurrent && peakIdx > window.length / 2) continue;

    const peakRow = window[peakIdx];
    const points: MidtermCurvePoint[] = [];
    for (let i = peakIdx; i < window.length; i++) {
      const row = window[i];
      const dd = (row.sp500 - peakRow.sp500) / peakRow.sp500;
      points.push({ offsetMonths: i - peakIdx, drawdown: dd });
    }

    curves.push({
      midtermYear: y,
      label: isCurrent ? `${y} (live)` : String(y),
      isCurrent,
      points,
      peakClose: peakRow.sp500,
      peakDate: peakRow.date.toISOString().slice(0, 7),
    });
  }

  // Average across all non-live curves at each offset
  const maxOffset = Math.max(
    ...curves.filter((c) => !c.isCurrent).map((c) => c.points.length - 1),
    0
  );
  const averageCurve: MidtermCurvePoint[] = [];
  for (let off = 0; off <= maxOffset; off++) {
    let sum = 0;
    let count = 0;
    for (const c of curves) {
      if (c.isCurrent) continue;
      const pt = c.points.find((p) => p.offsetMonths === off);
      if (pt) {
        sum += pt.drawdown;
        count++;
      }
    }
    if (count > 0) averageCurve.push({ offsetMonths: off, drawdown: sum / count });
  }

  return {
    curves,
    averageCurve,
    dataRange: {
      from: rows[0].date.toISOString().slice(0, 7),
      to: rows[rows.length - 1].date.toISOString().slice(0, 7),
    },
    source: 'shiller',
  };
}

// ---------------------------------------------------------------------------
// Shiller Valuation — CAPE (PE10) and SP500 Dividend Yield
// ---------------------------------------------------------------------------
//
// Both metrics are computed directly from the Shiller dataset we already
// cache for the Presidential Cycle chart. No new network fetch needed if the
// cache is warm — we just re-read the full CSV with richer parsing.
//
// - CAPE (Shiller PE) = price / 10-year average of inflation-adjusted earnings.
//   Comes pre-computed in the CSV as `PE10`. High CAPE = historically
//   expensive.
// - SP500 Dividend Yield = (trailing 12m dividends / price) × 100.

export interface ShillerValuationPoint {
  /** YYYY-MM */
  date: string;
  /** Unix ms */
  t: number;
  /** SP500 price used for the ratio */
  sp500: number;
  /** CAPE / Shiller PE (= PE10 column) */
  cape: number | null;
  /** Dividend yield as percent (dividend / sp500 × 100) */
  divYield: number | null;
}

export interface ShillerValuationResponse {
  points: ShillerValuationPoint[];
  latest: {
    date: string;
    sp500: number;
    cape: number | null;
    divYield: number | null;
  };
  /** Historical medians for anchoring chart bands */
  medians: {
    cape: number;
    divYield: number;
  };
  /** Percentile of latest CAPE vs. full history (0–100; higher = more expensive) */
  capePercentile: number | null;
  /** Range of data used */
  dataRange: { from: string; to: string };
  source: 'shiller';
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Percentile rank of `value` within `arr` (0–100). */
/** Simple moving average on a number array. Returns an array of the same
 *  length where entries before the window has filled are null. */
export function sma(values: number[], window: number): (number | null)[] {
  if (window <= 0) throw new Error('SMA window must be positive');
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    if (i >= window - 1) out[i] = sum / window;
  }
  return out;
}

/** Exponential moving average. The first EMA value is seeded with the SMA of
 *  the first `window` points so early bars aren't biased by a zero start. */
export function ema(values: number[], window: number): (number | null)[] {
  if (window <= 0) throw new Error('EMA window must be positive');
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < window) return out;
  const k = 2 / (window + 1);
  // Seed with SMA of first `window` bars
  let sum = 0;
  for (let i = 0; i < window; i++) sum += values[i];
  let prev = sum / window;
  out[window - 1] = prev;
  for (let i = window; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Detect crossover events between a fast and slow series.
 *  Returns `'golden'` when fast crosses above slow, `'death'` when below.
 *  Output aligned with input length; entries are null where either series is
 *  null, 'none' for days without a crossover, or the event type otherwise. */
export function detectCrossovers(
  fast: (number | null)[],
  slow: (number | null)[]
): ('golden' | 'death' | 'none' | null)[] {
  if (fast.length !== slow.length) {
    throw new Error('detectCrossovers: fast and slow must have equal length');
  }
  const out: ('golden' | 'death' | 'none' | null)[] = new Array(fast.length).fill(null);
  for (let i = 1; i < fast.length; i++) {
    const f0 = fast[i - 1];
    const f1 = fast[i];
    const s0 = slow[i - 1];
    const s1 = slow[i];
    if (f0 == null || f1 == null || s0 == null || s1 == null) continue;
    if (f0 <= s0 && f1 > s1) out[i] = 'golden';
    else if (f0 >= s0 && f1 < s1) out[i] = 'death';
    else out[i] = 'none';
  }
  return out;
}

/** Wilder's RSI (Relative Strength Index) — the standard used in most TA
 *  tools. `period` defaults to 14 (Wilder's original). Values before the
 *  window has filled are null. Output is in the range [0, 100]. */
export function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length <= period) return out;

  // Initial average gain/loss over first `period` bars (excluding the seed)
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) avgGain += diff;
    else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  // Subsequent values use Wilder smoothing (EMA-like with α = 1/period)
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/** Running drawdown from all-time high — returns values in [-1, 0] where 0
 *  means "at a new ATH" and -0.5 means "50% off ATH". */
export function runningDrawdown(values: number[]): number[] {
  const out: number[] = new Array(values.length).fill(0);
  let peak = -Infinity;
  for (let i = 0; i < values.length; i++) {
    if (values[i] > peak) peak = values[i];
    out[i] = peak > 0 ? (values[i] - peak) / peak : 0;
  }
  return out;
}

/** Normalize `values` to [0, 1] where each point's position is its percentile
 *  rank within a trailing rolling window. Earlier points (before window is
 *  filled) use the smaller available window. Higher value → higher 0-1 score. */
export function rollingPercentile(values: (number | null)[], window: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  for (let i = 0; i < values.length; i++) {
    if (values[i] == null) continue;
    const start = Math.max(0, i - window + 1);
    const slice: number[] = [];
    for (let j = start; j <= i; j++) {
      if (values[j] != null) slice.push(values[j] as number);
    }
    if (slice.length < 2) continue;
    out[i] = percentileRank(slice, values[i] as number) / 100;
  }
  return out;
}

export function percentileRank(arr: number[], value: number): number {
  if (arr.length === 0) return 0;
  let below = 0;
  for (const v of arr) {
    if (v < value) below++;
    else if (v === value) below += 0.5;
  }
  return (below / arr.length) * 100;
}

async function computeShillerValuation(): Promise<ShillerValuationResponse> {
  const rows = await fetchShillerFull();
  if (rows.length < 120) {
    throw new Error(`Insufficient Shiller history (got ${rows.length} rows)`);
  }

  const points: ShillerValuationPoint[] = rows.map((r) => ({
    date: r.date.toISOString().slice(0, 7),
    t: r.date.getTime(),
    sp500: r.sp500,
    cape: r.pe10,
    divYield: r.dividend != null ? (r.dividend / r.sp500) * 100 : null,
  }));

  const capeValues = points.map((p) => p.cape).filter((v): v is number => v != null);
  const dyValues = points.map((p) => p.divYield).filter((v): v is number => v != null);

  // Shiller's dataset usually lags 1–3 months on the valuation columns (they
  // wait for official earnings/dividend reports). CAPE and dividend yield
  // are reported independently, so we walk backwards for each separately
  // to find the most recent populated value.
  const lastRow = points[points.length - 1];
  const findLatest = (field: 'cape' | 'divYield'): ShillerValuationPoint => {
    for (let i = points.length - 1; i >= 0; i--) {
      if (points[i][field] != null) return points[i];
    }
    return lastRow;
  };
  const latestCape = findLatest('cape');
  const latestDiv = findLatest('divYield');

  const capePercentile =
    latestCape.cape != null && capeValues.length > 0
      ? percentileRank(capeValues, latestCape.cape)
      : null;

  return {
    points,
    latest: {
      // Report the date from whichever is fresher
      date: latestCape.t >= latestDiv.t ? latestCape.date : latestDiv.date,
      sp500: (latestCape.t >= latestDiv.t ? latestCape : latestDiv).sp500,
      cape: latestCape.cape,
      divYield: latestDiv.divYield,
    },
    medians: {
      cape: median(capeValues),
      divYield: median(dyValues),
    },
    capePercentile,
    dataRange: {
      from: points[0].date,
      to: lastRow.date,
    },
    source: 'shiller',
  };
}

// ---------------------------------------------------------------------------
// FRED (Federal Reserve Economic Data) helpers
// ---------------------------------------------------------------------------
//
// Shared fetcher for FRED time-series endpoints. Used by the Yield Curve
// chart and future macro charts. Requires the user to have configured a
// FRED API key in Settings → Quant. Free 120 req/min tier is plenty since
// we cache server-side.

export interface FredObservation {
  /** YYYY-MM-DD */
  date: string;
  t: number; // unix ms
  value: number;
}

interface FredRawResponse {
  observations: { date: string; value: string }[];
  error_code?: number;
  error_message?: string;
}

/** Parse FRED's JSON observations format into clean points. Filters out the
 *  "." missing-value marker FRED uses. Exported for tests. */
export function parseFredObservations(json: FredRawResponse): FredObservation[] {
  if (json.error_message) {
    throw new Error(`FRED API error ${json.error_code ?? '?'}: ${json.error_message}`);
  }
  if (!Array.isArray(json.observations)) {
    throw new Error('FRED response missing observations array');
  }
  const out: FredObservation[] = [];
  for (const obs of json.observations) {
    if (!obs.value || obs.value === '.') continue;
    const v = Number(obs.value);
    if (!Number.isFinite(v)) continue;
    const date = new Date(obs.date + 'T00:00:00Z');
    if (Number.isNaN(date.getTime())) continue;
    out.push({ date: obs.date, t: date.getTime(), value: v });
  }
  return out;
}

async function fetchFredSeries(
  seriesId: string,
  apiKey: string,
  observationStart = '1970-01-01'
): Promise<FredObservation[]> {
  const url =
    `https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(seriesId)}` +
    `&api_key=${encodeURIComponent(apiKey)}&file_type=json&observation_start=${observationStart}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'docvault/1.0' },
  });
  if (!res.ok) {
    throw new Error(`FRED ${seriesId} ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as FredRawResponse;
  return parseFredObservations(json);
}

// ---------------------------------------------------------------------------
// Macro Dashboard (FRED) — 10Y, DFF, M2, DXY, Core CPI YoY
// ---------------------------------------------------------------------------
//
// A single endpoint that fetches a handful of FRED series in parallel and
// returns them together. The frontend renders 5 mini-charts on one card.

export interface MacroSeries {
  /** FRED series ID */
  id: string;
  /** Human label */
  label: string;
  /** Short description */
  description: string;
  /** Unit suffix for display */
  unit: string;
  /** Number of decimal places for display */
  decimals: number;
  /** Downsampled points for the mini-chart */
  points: { t: number; value: number }[];
  /** Latest value */
  latest: { date: string; value: number } | null;
  /** YoY change (%) if there's enough history */
  yoyChange: number | null;
}

export interface MacroDashboardResponse {
  series: MacroSeries[];
  fetchedAt: number;
  source: 'fred';
}

type MacroSeriesSpec = Omit<MacroSeries, 'points' | 'latest' | 'yoyChange'> & {
  start: string;
};

const MACRO_SERIES: MacroSeriesSpec[] = [
  {
    id: 'DGS10',
    label: '10Y Treasury',
    description: '10-year constant-maturity Treasury yield',
    unit: '%',
    decimals: 2,
    start: '1990-01-01',
  },
  {
    id: 'DFF',
    label: 'Fed Funds Rate',
    description: 'Effective federal funds rate',
    unit: '%',
    decimals: 2,
    start: '1990-01-01',
  },
  {
    id: 'M2SL',
    label: 'M2 Money Supply',
    description: 'M2 money stock (billions USD)',
    unit: 'B',
    decimals: 0,
    start: '1990-01-01',
  },
  {
    id: 'DTWEXBGS',
    label: 'Dollar Index',
    description: 'Broad Trade-Weighted US Dollar Index',
    unit: '',
    decimals: 2,
    start: '2006-01-01',
  },
  {
    id: 'CPILFESL',
    label: 'Core CPI',
    description: 'Core Consumer Price Index (ex food & energy)',
    unit: '',
    decimals: 1,
    start: '1990-01-01',
  },
];

const BUSINESS_CYCLE_SERIES: MacroSeriesSpec[] = [
  {
    id: 'SAHMREALTIME',
    label: 'Sahm Rule Indicator',
    description: '3-month avg unemployment minus 12-month min. ≥ 0.5 signals recession has begun.',
    unit: '',
    decimals: 2,
    start: '1990-01-01',
  },
  {
    id: 'RECPROUSM156N',
    label: 'Recession Probability',
    description: 'Smoothed Chauvet-Piger 12-month recession probability (0-1).',
    unit: '',
    decimals: 3,
    start: '1990-01-01',
  },
  {
    id: 'INDPRO',
    label: 'Industrial Production',
    description: 'Total industrial production index (2017 = 100). Coincident indicator.',
    unit: '',
    decimals: 1,
    start: '1990-01-01',
  },
  {
    id: 'DGORDER',
    label: 'Durable Goods Orders',
    description: 'New orders for durable goods (millions USD). Leading indicator.',
    unit: 'M',
    decimals: 0,
    start: '1992-01-01',
  },
  {
    id: 'PERMIT',
    label: 'Building Permits',
    description: 'New private housing units authorized (thousands). Classic leading indicator.',
    unit: 'k',
    decimals: 0,
    start: '1990-01-01',
  },
  {
    id: 'UMCSENT',
    label: 'Consumer Sentiment',
    description: 'University of Michigan Consumer Sentiment Index.',
    unit: '',
    decimals: 1,
    start: '1990-01-01',
  },
];

const JOBS_SERIES: MacroSeriesSpec[] = [
  {
    id: 'UNRATE',
    label: 'Unemployment Rate',
    description: 'Headline U-3 unemployment rate',
    unit: '%',
    decimals: 1,
    start: '1990-01-01',
  },
  {
    id: 'PAYEMS',
    label: 'Nonfarm Payrolls',
    description: 'Total nonfarm employment (thousands)',
    unit: 'k',
    decimals: 0,
    start: '1990-01-01',
  },
  {
    id: 'ICSA',
    label: 'Initial Claims',
    description: 'Weekly initial jobless claims',
    unit: '',
    decimals: 0,
    start: '1990-01-01',
  },
  {
    id: 'JTSJOL',
    label: 'Job Openings (JOLTS)',
    description: 'Total nonfarm job openings (thousands)',
    unit: 'k',
    decimals: 0,
    start: '2000-12-01',
  },
  {
    id: 'CES0500000003',
    label: 'Avg Hourly Earnings',
    description: 'Avg hourly earnings of all private employees (USD)',
    unit: '',
    decimals: 2,
    start: '2006-03-01',
  },
  {
    id: 'CIVPART',
    label: 'Labor Force Participation',
    description: 'Civilian labor force participation rate',
    unit: '%',
    decimals: 1,
    start: '1990-01-01',
  },
];

/** Downsample a points array to ~N points using uniform stride selection. */
function downsample<T>(arr: T[], maxPoints: number): T[] {
  if (arr.length <= maxPoints) return arr;
  const step = Math.ceil(arr.length / maxPoints);
  const out: T[] = [];
  for (let i = 0; i < arr.length; i += step) out.push(arr[i]);
  // Always include the last point for fresh data visibility
  if (out[out.length - 1] !== arr[arr.length - 1]) out.push(arr[arr.length - 1]);
  return out;
}

async function computeMacroSeriesList(
  apiKey: string,
  specs: MacroSeriesSpec[]
): Promise<MacroDashboardResponse> {
  const results = await Promise.all(
    specs.map(async (meta) => {
      try {
        const obs = await fetchFredSeries(meta.id, apiKey, meta.start);
        // YoY change: find the observation closest to exactly 1 year before
        // the latest point. This works for both daily and monthly series.
        const last = obs[obs.length - 1];
        let yearAgo: FredObservation | undefined;
        if (last) {
          const targetTime = last.t - 365 * DAY_MS;
          // Binary search / linear walk for the closest observation at or
          // before the target time
          for (let i = obs.length - 1; i >= 0; i--) {
            if (obs[i].t <= targetTime) {
              yearAgo = obs[i];
              break;
            }
          }
        }
        const yoyChange =
          last && yearAgo && yearAgo.value !== 0
            ? ((last.value - yearAgo.value) / yearAgo.value) * 100
            : null;
        const points = downsample(
          obs.map((o) => ({ t: o.t, value: o.value })),
          1500
        );
        return {
          id: meta.id,
          label: meta.label,
          description: meta.description,
          unit: meta.unit,
          decimals: meta.decimals,
          points,
          latest: last ? { date: last.date, value: last.value } : null,
          yoyChange,
        } satisfies MacroSeries;
      } catch (err) {
        logQuant.warn(`Macro ${meta.id} failed: ${err instanceof Error ? err.message : err}`);
        return {
          id: meta.id,
          label: meta.label,
          description: meta.description,
          unit: meta.unit,
          decimals: meta.decimals,
          points: [],
          latest: null,
          yoyChange: null,
        } satisfies MacroSeries;
      }
    })
  );
  return {
    series: results,
    fetchedAt: Date.now(),
    source: 'fred',
  };
}

async function computeMacroDashboard(apiKey: string): Promise<MacroDashboardResponse> {
  return computeMacroSeriesList(apiKey, MACRO_SERIES);
}

async function computeJobsDashboard(apiKey: string): Promise<MacroDashboardResponse> {
  return computeMacroSeriesList(apiKey, JOBS_SERIES);
}

async function computeBusinessCycle(apiKey: string): Promise<MacroDashboardResponse> {
  return computeMacroSeriesList(apiKey, BUSINESS_CYCLE_SERIES);
}

// ---------------------------------------------------------------------------
// Fed Policy — effective fed funds rate + target range with rate change
// events. Uses DFEDTARU + DFEDTARL (target upper/lower, 2008+) or DFEDTAR
// (pre-2008 point target). Detects rate changes by walking the history.
// ---------------------------------------------------------------------------

export interface FedRateChange {
  /** Unix ms */
  t: number;
  /** New rate after the change */
  newRate: number;
  /** Change in basis points (positive = hike, negative = cut) */
  changeBps: number;
  /** 'hike' | 'cut' | 'hold-change' for edge cases */
  type: 'hike' | 'cut';
}

export interface FedPolicyResponse {
  /** Effective federal funds rate history */
  effectiveRate: { t: number; rate: number }[];
  /** Target range upper bound (2008+) */
  targetUpper: { t: number; rate: number }[];
  /** Target range lower bound (2008+) */
  targetLower: { t: number; rate: number }[];
  /** Detected rate change events from the target range */
  rateChanges: FedRateChange[];
  latest: {
    date: string;
    effectiveRate: number;
    targetUpper: number;
    targetLower: number;
    /** Classification: 'cutting' if recent trend is cuts, 'hiking' if hikes, 'hold' if flat */
    stance: 'cutting' | 'hiking' | 'hold';
    /** Days since last rate change */
    daysSinceLastChange: number;
  };
  dataRange: { from: string; to: string };
  source: 'fred';
}

async function computeFedPolicy(apiKey: string): Promise<FedPolicyResponse> {
  const [dff, upper, lower] = await Promise.all([
    fetchFredSeries('DFF', apiKey, '2008-01-01'),
    fetchFredSeries('DFEDTARU', apiKey, '2008-01-01'),
    fetchFredSeries('DFEDTARL', apiKey, '2008-01-01'),
  ]);

  if (upper.length < 10) {
    throw new Error(`Insufficient Fed target history (got ${upper.length})`);
  }

  // Detect rate changes by walking the upper target. Any day where upper
  // differs from the prior non-null upper is a rate change event.
  const rateChanges: FedRateChange[] = [];
  let lastUpper: number | null = null;
  for (const obs of upper) {
    if (lastUpper != null && obs.value !== lastUpper) {
      const changeBps = Math.round((obs.value - lastUpper) * 100);
      rateChanges.push({
        t: obs.t,
        newRate: obs.value,
        changeBps,
        type: changeBps > 0 ? 'hike' : 'cut',
      });
    }
    lastUpper = obs.value;
  }

  // Determine current stance: look at last 5 rate changes
  const recent = rateChanges.slice(-5);
  const hikes = recent.filter((c) => c.type === 'hike').length;
  const cuts = recent.filter((c) => c.type === 'cut').length;
  let stance: 'cutting' | 'hiking' | 'hold' = 'hold';
  if (cuts > hikes && cuts >= 2) stance = 'cutting';
  else if (hikes > cuts && hikes >= 2) stance = 'hiking';

  const lastChange = rateChanges[rateChanges.length - 1];
  const daysSinceLastChange = lastChange ? Math.floor((Date.now() - lastChange.t) / DAY_MS) : 0;

  const lastUpperObs = upper[upper.length - 1];
  const lastLowerObs = lower[lower.length - 1];
  const lastDff = dff[dff.length - 1];

  return {
    effectiveRate: dff.map((o) => ({ t: o.t, rate: o.value })),
    targetUpper: upper.map((o) => ({ t: o.t, rate: o.value })),
    targetLower: lower.map((o) => ({ t: o.t, rate: o.value })),
    rateChanges,
    latest: {
      date: lastUpperObs.date,
      effectiveRate: lastDff?.value ?? 0,
      targetUpper: lastUpperObs.value,
      targetLower: lastLowerObs.value,
      stance,
      daysSinceLastChange,
    },
    dataRange: {
      from: upper[0].date,
      to: lastUpperObs.date,
    },
    source: 'fred',
  };
}

// ---------------------------------------------------------------------------
// Yield Curve (Macro) — T10Y2Y and T10Y3M spreads
// ---------------------------------------------------------------------------

export interface YieldCurvePoint {
  date: string;
  t: number;
  /** 10Y - 2Y in percentage points */
  t10y2y: number | null;
  /** 10Y - 3M in percentage points */
  t10y3m: number | null;
}

export interface YieldCurveResponse {
  points: YieldCurvePoint[];
  latest: {
    date: string;
    t10y2y: number | null;
    t10y3m: number | null;
    /** Regime label based on current T10Y2Y */
    regime: 'deeply-inverted' | 'inverted' | 'flattening' | 'normal' | 'steepening';
  };
  /** How long (in trading days) the curve has been inverted (T10Y2Y < 0).
   *  Negative means "days since last inversion ended" when the curve is normal. */
  inversionStreak: number;
  /** Date of the most recent inversion signal (first day T10Y2Y crossed below 0 in the current streak) */
  lastInversionStart: string | null;
  /** Historical NBER recession periods from FRED USREC. Each pair is
   *  [start_date, end_date] as unix ms. Used to shade recession bands. */
  recessions: { start: number; end: number }[];
  dataRange: { from: string; to: string };
  source: 'fred';
}

/** Classify the current yield curve state based on the 10Y-2Y spread. */
export function classifyYieldCurveRegime(
  t10y2y: number | null
): YieldCurveResponse['latest']['regime'] {
  if (t10y2y == null) return 'normal';
  if (t10y2y < -0.5) return 'deeply-inverted';
  if (t10y2y < 0) return 'inverted';
  if (t10y2y < 0.25) return 'flattening';
  if (t10y2y < 1.5) return 'normal';
  return 'steepening';
}

async function computeYieldCurve(apiKey: string): Promise<YieldCurveResponse> {
  // T10Y2Y daily back to 1976, T10Y3M daily back to 1982, USREC monthly
  // back to 1854 (we'll only use periods that overlap our yield curve range).
  const [t10y2yObs, t10y3mObs, usrecObs] = await Promise.all([
    fetchFredSeries('T10Y2Y', apiKey, '1976-06-01'),
    fetchFredSeries('T10Y3M', apiKey, '1982-01-01'),
    fetchFredSeries('USREC', apiKey, '1970-01-01'),
  ]);

  // Align into a single time-series map keyed by date
  const map = new Map<string, YieldCurvePoint>();
  for (const obs of t10y2yObs) {
    map.set(obs.date, { date: obs.date, t: obs.t, t10y2y: obs.value, t10y3m: null });
  }
  for (const obs of t10y3mObs) {
    const existing = map.get(obs.date);
    if (existing) {
      existing.t10y3m = obs.value;
    } else {
      map.set(obs.date, { date: obs.date, t: obs.t, t10y2y: null, t10y3m: obs.value });
    }
  }
  const points = [...map.values()].sort((a, b) => a.t - b.t);

  if (points.length < 100) {
    throw new Error(`Insufficient FRED yield curve history (got ${points.length} points)`);
  }

  const last = points[points.length - 1];
  const regime = classifyYieldCurveRegime(last.t10y2y);

  // Compute inversion streak: how many days back from the latest point has
  // T10Y2Y been consistently below/above 0.
  const currentlyInverted = last.t10y2y != null && last.t10y2y < 0;
  let streak = 0;
  let lastInversionStart: string | null = null;
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    if (p.t10y2y == null) continue;
    const inv = p.t10y2y < 0;
    if (inv === currentlyInverted) {
      streak++;
      if (currentlyInverted) lastInversionStart = p.date;
    } else {
      break;
    }
  }
  // Convention: positive streak for inverted, negative for normal
  const inversionStreak = currentlyInverted ? streak : -streak;

  // Build recession ranges from USREC (monthly 0/1 indicator).
  // Walk through observations, emit [start, end] ms pairs for contiguous runs
  // of value=1.
  const recessions: { start: number; end: number }[] = [];
  let recStart: number | null = null;
  let prevT = 0;
  for (const obs of usrecObs) {
    if (obs.value > 0) {
      if (recStart == null) recStart = obs.t;
      prevT = obs.t;
    } else if (recStart != null) {
      recessions.push({ start: recStart, end: prevT });
      recStart = null;
    }
  }
  if (recStart != null) {
    // Recession currently in progress
    recessions.push({ start: recStart, end: prevT });
  }

  return {
    points,
    latest: {
      date: last.date,
      t10y2y: last.t10y2y,
      t10y3m: last.t10y3m,
      regime,
    },
    inversionStreak,
    lastInversionStart: currentlyInverted ? lastInversionStart : null,
    recessions,
    dataRange: {
      from: points[0].date,
      to: last.date,
    },
    source: 'fred',
  };
}

// ---------------------------------------------------------------------------
// Daily refresh — called by the scheduler, and by POST /api/quant/refresh.
// Forces a re-fetch of all quant data, writes it to the cache, and appends a
// snapshot row to the history file so we can plot trend sparklines.
// ---------------------------------------------------------------------------

export async function refreshAllQuantData(): Promise<{
  btc: boolean;
  spxCycle: boolean;
  sectorRotation: boolean;
  shillerValuation: boolean;
  yieldCurve: boolean;
  btcDominance: boolean;
  errors: string[];
}> {
  const errors: string[] = [];
  const cache = await loadCache();
  const now = Date.now();
  const date = new Date(now).toISOString().slice(0, 10); // YYYY-MM-DD

  const snap: QuantSnapshot = { date, takenAt: now };

  // Presidential cycle
  let spxCycleOk = false;
  try {
    const data = await computePresidentialCycle();
    cache.presidentialCycle = { fetchedAt: now, data };
    const yoc = data.currentYearOfCycle - 1;
    const month = new Date(now).getMonth();
    snap.spxCycle = {
      currentYear: data.currentYear,
      currentYearOfCycle: data.currentYearOfCycle,
      currentExpectedReturn: data.matrix[yoc][month],
      currentYearAnnualAvg: data.matrix[yoc].reduce((a, b) => a + b, 0),
    };
    spxCycleOk = true;
    logQuant.info(
      `Presidential cycle refreshed (${data.source}, ${data.dataRange.from}→${data.dataRange.to})`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`presidentialCycle: ${msg}`);
    logQuant.warn(`Presidential cycle refresh failed: ${msg}`);
  }

  // BTC log regression
  let btcOk = false;
  try {
    const data = await computeBtcLogRegression();
    cache.btcLogRegression = { fetchedAt: now, data };
    snap.btc = {
      price: data.latest.price,
      fitted: data.latest.fitted,
      residualSigma: data.latest.residualSigma,
      slope: data.slope,
      stdev: data.stdev,
      riskMetric: data.risk.latest.metric,
    };
    btcOk = true;
    logQuant.info(
      `BTC log regression refreshed (${data.prices.length} bars, σ=${data.latest.residualSigma.toFixed(2)})`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`btcLogRegression: ${msg}`);
    logQuant.warn(`BTC log regression refresh failed: ${msg}`);
  }

  // BTC Dominance (CoinGecko /global)
  let dominanceOk = false;
  try {
    const data = await fetchBtcDominance();
    cache.btcDominance = { fetchedAt: now, data };
    snap.btcDominance = {
      btcDominance: data.btcDominance,
      ethDominance: data.ethDominance,
      stableDominance: data.stableDominance,
      flightToSafety: data.flightToSafety,
      totalMarketCapUsd: data.totalMarketCapUsd,
    };
    dominanceOk = true;
    logQuant.info(
      `BTC dominance refreshed (BTC.D=${data.btcDominance.toFixed(1)}%, ETH.D=${data.ethDominance.toFixed(1)}%)`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`btcDominance: ${msg}`);
    logQuant.warn(`BTC dominance refresh failed: ${msg}`);
  }

  // Yield curve (FRED) — requires a FRED API key, silent skip if missing
  let yieldCurveOk = false;
  try {
    const settings = await loadSettings();
    const fredKey = settings.fredApiKey;
    if (!fredKey) {
      logQuant.info('Yield curve refresh skipped — no FRED API key configured');
    } else {
      const data = await computeYieldCurve(fredKey);
      cache.yieldCurve = { fetchedAt: now, data };
      if (data.latest.t10y2y != null) {
        snap.yieldCurve = {
          t10y2y: data.latest.t10y2y,
          t10y3m: data.latest.t10y3m,
          inversionStreak: data.inversionStreak,
          regime: data.latest.regime,
        };
      }
      yieldCurveOk = true;
      logQuant.info(
        `Yield curve refreshed (T10Y2Y=${data.latest.t10y2y?.toFixed(2) ?? '—'}, regime=${data.latest.regime})`
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`yieldCurve: ${msg}`);
    logQuant.warn(`Yield curve refresh failed: ${msg}`);
  }

  // Shiller valuation (CAPE + dividend yield)
  let shillerOk = false;
  try {
    const data = await computeShillerValuation();
    cache.shillerValuation = { fetchedAt: now, data };
    if (data.latest.cape != null && data.capePercentile != null && data.latest.divYield != null) {
      snap.shillerValuation = {
        cape: data.latest.cape,
        capePercentile: data.capePercentile,
        divYield: data.latest.divYield,
      };
    }
    shillerOk = true;
    logQuant.info(
      `Shiller valuation refreshed (CAPE=${data.latest.cape?.toFixed(1) ?? '—'}, DY=${data.latest.divYield?.toFixed(2) ?? '—'}%)`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`shillerValuation: ${msg}`);
    logQuant.warn(`Shiller valuation refresh failed: ${msg}`);
  }

  // Sector rotation
  let sectorOk = false;
  try {
    const data = await computeSectorRotation();
    cache.sectorRotation = { fetchedAt: now, data };

    // Rank and capture summary into the snapshot
    const ranked = [...data.sectors]
      .filter((s) => s.rsRatio != null)
      .sort((a, b) => (b.rsRatio ?? 0) - (a.rsRatio ?? 0));
    const rankedMom = [...data.sectors]
      .filter((s) => s.momentum != null)
      .sort((a, b) => (b.momentum ?? 0) - (a.momentum ?? 0));
    const quadCounts = { leading: 0, improving: 0, weakening: 0, lagging: 0 };
    for (const s of data.sectors) {
      if (s.quadrant === 'leading') quadCounts.leading++;
      else if (s.quadrant === 'improving') quadCounts.improving++;
      else if (s.quadrant === 'weakening') quadCounts.weakening++;
      else if (s.quadrant === 'lagging') quadCounts.lagging++;
    }
    if (ranked[0]?.rsRatio != null && rankedMom[0]?.momentum != null) {
      snap.sectorRotation = {
        topRS: { ticker: ranked[0].ticker, rsRatio: ranked[0].rsRatio },
        topMomentum: { ticker: rankedMom[0].ticker, momentum: rankedMom[0].momentum },
        quadrantCounts: quadCounts,
      };
    }
    sectorOk = true;
    logQuant.info(
      `Sector rotation refreshed (top RS: ${ranked[0]?.ticker ?? '-'}, top Mom: ${rankedMom[0]?.ticker ?? '-'})`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`sectorRotation: ${msg}`);
    logQuant.warn(`Sector rotation refresh failed: ${msg}`);
  }

  await saveCache(cache);

  // Only write a snapshot if at least one metric refreshed successfully
  if (spxCycleOk || btcOk || sectorOk || shillerOk || yieldCurveOk || dominanceOk) {
    try {
      await appendSnapshot(snap);
    } catch (err) {
      logQuant.warn(`Snapshot write failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Only write a snapshot if at least one metric refreshed successfully
  return {
    btc: btcOk,
    spxCycle: spxCycleOk,
    sectorRotation: sectorOk,
    shillerValuation: shillerOk,
    yieldCurve: yieldCurveOk,
    btcDominance: dominanceOk,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Route dispatcher
// ---------------------------------------------------------------------------

export async function handleQuantRoutes(
  req: Request,
  url: URL,
  pathname: string
): Promise<Response | null> {
  // POST /api/quant/refresh — force re-fetch all quant data now
  if (pathname === '/api/quant/refresh' && req.method === 'POST') {
    const result = await refreshAllQuantData();
    return jsonResponse({
      ok:
        result.btc ||
        result.spxCycle ||
        result.sectorRotation ||
        result.shillerValuation ||
        result.yieldCurve ||
        result.btcDominance,
      btcRefreshed: result.btc,
      spxCycleRefreshed: result.spxCycle,
      sectorRotationRefreshed: result.sectorRotation,
      shillerValuationRefreshed: result.shillerValuation,
      yieldCurveRefreshed: result.yieldCurve,
      btcDominanceRefreshed: result.btcDominance,
      errors: result.errors,
      refreshedAt: Date.now(),
    });
  }

  // GET /api/quant/snapshots?days=365 — return the snapshot history
  if (pathname === '/api/quant/snapshots' && req.method === 'GET') {
    const days = Math.max(1, Math.min(Number(url.searchParams.get('days')) || 365, 3650));
    const file = await readSnapshots();
    const cutoff = Date.now() - days * DAY_MS;
    const filtered = file.snapshots.filter((s) => s.takenAt >= cutoff);
    return cachedJsonResponse(
      req,
      {
        snapshots: filtered,
        totalAll: file.snapshots.length,
        returned: filtered.length,
        days,
      },
      CACHE.snapshots
    );
  }

  // GET /api/quant/cycle/presidential
  if (pathname === '/api/quant/cycle/presidential' && req.method === 'GET') {
    const cache = await loadCache();
    if (isFresh(cache.presidentialCycle, TTL.presidentialCycle)) {
      return cachedJsonResponse(
        req,
        {
          ...cache.presidentialCycle!.data,
          cached: true,
          fetchedAt: cache.presidentialCycle!.fetchedAt,
        },
        CACHE.presidentialCycle
      );
    }
    try {
      const data = await computePresidentialCycle();
      cache.presidentialCycle = { fetchedAt: Date.now(), data };
      await saveCache(cache);
      return cachedJsonResponse(
        req,
        { ...data, cached: false, fetchedAt: cache.presidentialCycle.fetchedAt },
        CACHE.presidentialCycle
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Fall back to stale cache if a fetch fails
      if (cache.presidentialCycle) {
        return cachedJsonResponse(
          req,
          {
            ...cache.presidentialCycle.data,
            cached: true,
            stale: true,
            fetchedAt: cache.presidentialCycle.fetchedAt,
            fetchError: msg,
          },
          CACHE.presidentialCycle
        );
      }
      return jsonResponse({ error: `Presidential cycle fetch failed: ${msg}` }, 502);
    }
  }

  // GET /api/quant/macro/business-cycle — recession prob + leading/coincident indicators
  if (pathname === '/api/quant/macro/business-cycle' && req.method === 'GET') {
    const cache = await loadCache();
    if (isFresh(cache.businessCycle, TTL.businessCycle)) {
      return cachedJsonResponse(
        req,
        { ...cache.businessCycle!.data, cached: true },
        CACHE.businessCycle
      );
    }
    try {
      const settings = await loadSettings();
      const fredKey = settings.fredApiKey;
      if (!fredKey) {
        return jsonResponse(
          { error: 'FRED API key not configured. Add one in Settings → Quant.' },
          400
        );
      }
      const data = await computeBusinessCycle(fredKey);
      cache.businessCycle = { fetchedAt: Date.now(), data };
      await saveCache(cache);
      return cachedJsonResponse(req, { ...data, cached: false }, CACHE.businessCycle);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (cache.businessCycle) {
        return cachedJsonResponse(
          req,
          { ...cache.businessCycle.data, cached: true, stale: true, fetchError: msg },
          CACHE.businessCycle
        );
      }
      return jsonResponse({ error: `Business cycle fetch failed: ${msg}` }, 502);
    }
  }

  // GET /api/quant/macro/jobs — labor dashboard from FRED
  if (pathname === '/api/quant/macro/jobs' && req.method === 'GET') {
    const cache = await loadCache();
    if (isFresh(cache.jobsDashboard, TTL.jobsDashboard)) {
      return cachedJsonResponse(
        req,
        { ...cache.jobsDashboard!.data, cached: true },
        CACHE.jobsDashboard
      );
    }
    try {
      const settings = await loadSettings();
      const fredKey = settings.fredApiKey;
      if (!fredKey) {
        return jsonResponse(
          { error: 'FRED API key not configured. Add one in Settings → Quant.' },
          400
        );
      }
      const data = await computeJobsDashboard(fredKey);
      cache.jobsDashboard = { fetchedAt: Date.now(), data };
      await saveCache(cache);
      return cachedJsonResponse(req, { ...data, cached: false }, CACHE.jobsDashboard);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (cache.jobsDashboard) {
        return cachedJsonResponse(
          req,
          { ...cache.jobsDashboard.data, cached: true, stale: true, fetchError: msg },
          CACHE.jobsDashboard
        );
      }
      return jsonResponse({ error: `Jobs dashboard fetch failed: ${msg}` }, 502);
    }
  }

  // GET /api/quant/macro/fed-policy — DFF + target range + rate change events
  if (pathname === '/api/quant/macro/fed-policy' && req.method === 'GET') {
    const cache = await loadCache();
    if (isFresh(cache.fedPolicy, TTL.fedPolicy)) {
      return cachedJsonResponse(req, { ...cache.fedPolicy!.data, cached: true }, CACHE.fedPolicy);
    }
    try {
      const settings = await loadSettings();
      const fredKey = settings.fredApiKey;
      if (!fredKey) {
        return jsonResponse(
          { error: 'FRED API key not configured. Add one in Settings → Quant.' },
          400
        );
      }
      const data = await computeFedPolicy(fredKey);
      cache.fedPolicy = { fetchedAt: Date.now(), data };
      await saveCache(cache);
      return cachedJsonResponse(req, { ...data, cached: false }, CACHE.fedPolicy);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (cache.fedPolicy) {
        return cachedJsonResponse(
          req,
          { ...cache.fedPolicy.data, cached: true, stale: true, fetchError: msg },
          CACHE.fedPolicy
        );
      }
      return jsonResponse({ error: `Fed policy fetch failed: ${msg}` }, 502);
    }
  }

  // GET /api/quant/macro/dashboard — 10Y, DFF, M2, DXY, Core CPI from FRED
  if (pathname === '/api/quant/macro/dashboard' && req.method === 'GET') {
    const cache = await loadCache();
    if (isFresh(cache.macroDashboard, TTL.macroDashboard)) {
      return cachedJsonResponse(
        req,
        { ...cache.macroDashboard!.data, cached: true },
        CACHE.macroDashboard
      );
    }
    try {
      const settings = await loadSettings();
      const fredKey = settings.fredApiKey;
      if (!fredKey) {
        return jsonResponse(
          {
            error:
              'FRED API key not configured. Add one in Settings → Quant (free, 30-second signup).',
          },
          400
        );
      }
      const data = await computeMacroDashboard(fredKey);
      cache.macroDashboard = { fetchedAt: Date.now(), data };
      await saveCache(cache);
      return cachedJsonResponse(req, { ...data, cached: false }, CACHE.macroDashboard);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (cache.macroDashboard) {
        return cachedJsonResponse(
          req,
          { ...cache.macroDashboard.data, cached: true, stale: true, fetchError: msg },
          CACHE.macroDashboard
        );
      }
      return jsonResponse({ error: `Macro dashboard fetch failed: ${msg}` }, 502);
    }
  }

  // GET /api/quant/macro/yield-curve — T10Y2Y and T10Y3M from FRED
  if (pathname === '/api/quant/macro/yield-curve' && req.method === 'GET') {
    const cache = await loadCache();
    if (isFresh(cache.yieldCurve, TTL.yieldCurve)) {
      return cachedJsonResponse(
        req,
        {
          ...cache.yieldCurve!.data,
          cached: true,
          fetchedAt: cache.yieldCurve!.fetchedAt,
        },
        CACHE.yieldCurve
      );
    }
    try {
      const settings = await loadSettings();
      const fredKey = settings.fredApiKey;
      if (!fredKey) {
        return jsonResponse(
          {
            error:
              'FRED API key not configured. Add one in Settings → Quant (free, 30-second signup).',
          },
          400
        );
      }
      const data = await computeYieldCurve(fredKey);
      cache.yieldCurve = { fetchedAt: Date.now(), data };
      await saveCache(cache);
      return cachedJsonResponse(
        req,
        { ...data, cached: false, fetchedAt: cache.yieldCurve.fetchedAt },
        CACHE.yieldCurve
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (cache.yieldCurve) {
        return cachedJsonResponse(
          req,
          {
            ...cache.yieldCurve.data,
            cached: true,
            stale: true,
            fetchedAt: cache.yieldCurve.fetchedAt,
            fetchError: msg,
          },
          CACHE.yieldCurve
        );
      }
      return jsonResponse({ error: `Yield curve fetch failed: ${msg}` }, 502);
    }
  }

  // GET /api/quant/tradfi/sp500-risk-metric — monthly Cowen-style composite
  if (pathname === '/api/quant/tradfi/sp500-risk-metric' && req.method === 'GET') {
    const cache = await loadCache();
    if (isFresh(cache.sp500RiskMetric, TTL.sp500RiskMetric)) {
      return cachedJsonResponse(
        req,
        { ...cache.sp500RiskMetric!.data, cached: true },
        CACHE.sp500RiskMetric
      );
    }
    try {
      const data = await computeSP500RiskMetric();
      cache.sp500RiskMetric = { fetchedAt: Date.now(), data };
      await saveCache(cache);
      return cachedJsonResponse(req, { ...data, cached: false }, CACHE.sp500RiskMetric);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (cache.sp500RiskMetric) {
        return cachedJsonResponse(
          req,
          { ...cache.sp500RiskMetric.data, cached: true, stale: true, fetchError: msg },
          CACHE.sp500RiskMetric
        );
      }
      return jsonResponse({ error: `SP500 risk metric fetch failed: ${msg}` }, 502);
    }
  }

  // GET /api/quant/tradfi/midterm-drawdowns — historical midterm drawdown curves
  if (pathname === '/api/quant/tradfi/midterm-drawdowns' && req.method === 'GET') {
    const cache = await loadCache();
    if (isFresh(cache.midtermDrawdowns, TTL.midtermDrawdowns)) {
      return cachedJsonResponse(
        req,
        { ...cache.midtermDrawdowns!.data, cached: true },
        CACHE.midtermDrawdowns
      );
    }
    try {
      const data = await computeMidtermDrawdowns();
      cache.midtermDrawdowns = { fetchedAt: Date.now(), data };
      await saveCache(cache);
      return cachedJsonResponse(req, { ...data, cached: false }, CACHE.midtermDrawdowns);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (cache.midtermDrawdowns) {
        return cachedJsonResponse(
          req,
          { ...cache.midtermDrawdowns.data, cached: true, stale: true, fetchError: msg },
          CACHE.midtermDrawdowns
        );
      }
      return jsonResponse({ error: `Midterm drawdowns fetch failed: ${msg}` }, 502);
    }
  }

  // GET /api/quant/tradfi/shiller-valuation — CAPE + SP500 dividend yield
  if (pathname === '/api/quant/tradfi/shiller-valuation' && req.method === 'GET') {
    const cache = await loadCache();
    if (isFresh(cache.shillerValuation, TTL.shillerValuation)) {
      return cachedJsonResponse(
        req,
        {
          ...cache.shillerValuation!.data,
          cached: true,
          fetchedAt: cache.shillerValuation!.fetchedAt,
        },
        CACHE.shillerValuation
      );
    }
    try {
      const data = await computeShillerValuation();
      cache.shillerValuation = { fetchedAt: Date.now(), data };
      await saveCache(cache);
      return cachedJsonResponse(
        req,
        { ...data, cached: false, fetchedAt: cache.shillerValuation.fetchedAt },
        CACHE.shillerValuation
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (cache.shillerValuation) {
        return cachedJsonResponse(
          req,
          {
            ...cache.shillerValuation.data,
            cached: true,
            stale: true,
            fetchedAt: cache.shillerValuation.fetchedAt,
            fetchError: msg,
          },
          CACHE.shillerValuation
        );
      }
      return jsonResponse({ error: `Shiller valuation fetch failed: ${msg}` }, 502);
    }
  }

  // GET /api/quant/tradfi/sectors/rotation
  if (pathname === '/api/quant/tradfi/sectors/rotation' && req.method === 'GET') {
    const cache = await loadCache();
    if (isFresh(cache.sectorRotation, TTL.sectorRotation)) {
      return cachedJsonResponse(
        req,
        {
          ...cache.sectorRotation!.data,
          cached: true,
          fetchedAt: cache.sectorRotation!.fetchedAt,
        },
        CACHE.sectorRotation
      );
    }
    try {
      const data = await computeSectorRotation();
      cache.sectorRotation = { fetchedAt: Date.now(), data };
      await saveCache(cache);
      return cachedJsonResponse(
        req,
        { ...data, cached: false, fetchedAt: cache.sectorRotation.fetchedAt },
        CACHE.sectorRotation
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (cache.sectorRotation) {
        return cachedJsonResponse(
          req,
          {
            ...cache.sectorRotation.data,
            cached: true,
            stale: true,
            fetchedAt: cache.sectorRotation.fetchedAt,
            fetchError: msg,
          },
          CACHE.sectorRotation
        );
      }
      return jsonResponse({ error: `Sector rotation fetch failed: ${msg}` }, 502);
    }
  }

  // GET /api/quant/btc/altcoin-season — Altcoin Season Index
  if (pathname === '/api/quant/btc/altcoin-season' && req.method === 'GET') {
    const cache = await loadCache();
    if (isFresh(cache.altcoinSeason, TTL.altcoinSeason)) {
      return cachedJsonResponse(
        req,
        { ...cache.altcoinSeason!.data, cached: true },
        CACHE.altcoinSeason
      );
    }
    try {
      const data = await computeAltcoinSeasonIndex();
      cache.altcoinSeason = { fetchedAt: Date.now(), data };
      await saveCache(cache);
      return cachedJsonResponse(req, { ...data, cached: false }, CACHE.altcoinSeason);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (cache.altcoinSeason) {
        return cachedJsonResponse(
          req,
          { ...cache.altcoinSeason.data, cached: true, stale: true, fetchError: msg },
          CACHE.altcoinSeason
        );
      }
      return jsonResponse({ error: `Altcoin season fetch failed: ${msg}` }, 502);
    }
  }

  // GET /api/quant/btc/derivatives — OKX funding/OI/LS ratio
  if (pathname === '/api/quant/btc/derivatives' && req.method === 'GET') {
    const cache = await loadCache();
    if (isFresh(cache.btcDerivatives, TTL.btcDerivatives)) {
      return cachedJsonResponse(
        req,
        { ...cache.btcDerivatives!.data, cached: true },
        CACHE.btcDerivatives
      );
    }
    try {
      const data = await computeBtcDerivatives();
      cache.btcDerivatives = { fetchedAt: Date.now(), data };
      await saveCache(cache);
      return cachedJsonResponse(req, { ...data, cached: false }, CACHE.btcDerivatives);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (cache.btcDerivatives) {
        return cachedJsonResponse(
          req,
          { ...cache.btcDerivatives.data, cached: true, stale: true, fetchError: msg },
          CACHE.btcDerivatives
        );
      }
      return jsonResponse({ error: `BTC derivatives fetch failed: ${msg}` }, 502);
    }
  }

  // GET /api/quant/btc/dominance — CoinGecko /global
  if (pathname === '/api/quant/btc/dominance' && req.method === 'GET') {
    const cache = await loadCache();
    if (isFresh(cache.btcDominance, TTL.btcDominance)) {
      return cachedJsonResponse(
        req,
        { ...cache.btcDominance!.data, cached: true },
        CACHE.btcDominance
      );
    }
    try {
      const data = await fetchBtcDominance();
      cache.btcDominance = { fetchedAt: Date.now(), data };
      await saveCache(cache);
      return cachedJsonResponse(req, { ...data, cached: false }, CACHE.btcDominance);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (cache.btcDominance) {
        return cachedJsonResponse(
          req,
          { ...cache.btcDominance.data, cached: true, stale: true, fetchError: msg },
          CACHE.btcDominance
        );
      }
      return jsonResponse({ error: `BTC dominance fetch failed: ${msg}` }, 502);
    }
  }

  // GET /api/quant/btc/log-regression
  if (pathname === '/api/quant/btc/log-regression' && req.method === 'GET') {
    const cache = await loadCache();
    if (isFresh(cache.btcLogRegression, TTL.btcLogRegression)) {
      return cachedJsonResponse(
        req,
        {
          ...cache.btcLogRegression!.data,
          cached: true,
          fetchedAt: cache.btcLogRegression!.fetchedAt,
        },
        CACHE.btcLogRegression
      );
    }
    try {
      const data = await computeBtcLogRegression();
      cache.btcLogRegression = { fetchedAt: Date.now(), data };
      await saveCache(cache);
      return cachedJsonResponse(
        req,
        { ...data, cached: false, fetchedAt: cache.btcLogRegression.fetchedAt },
        CACHE.btcLogRegression
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (cache.btcLogRegression) {
        return cachedJsonResponse(
          req,
          {
            ...cache.btcLogRegression.data,
            cached: true,
            stale: true,
            fetchedAt: cache.btcLogRegression.fetchedAt,
            fetchError: msg,
          },
          CACHE.btcLogRegression
        );
      }
      return jsonResponse({ error: `BTC log regression fetch failed: ${msg}` }, 502);
    }
  }

  return null;
}
