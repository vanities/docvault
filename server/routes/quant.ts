// Quant route handlers — market cycle analysis, risk metrics, sector rotation.
// Data sources: yahoo-finance2 (equities/ETFs), CoinGecko (crypto), FRED (macro).
// Cached to DATA_DIR/.docvault-quant-cache.json with per-endpoint TTLs.

import { promises as fs } from 'fs';
import path from 'path';
import YahooFinance from 'yahoo-finance2';
import { DATA_DIR, jsonResponse, QUANT_SNAPSHOTS_FILE } from '../data.js';
import { createLogger } from '../logger.js';

const yahooFinance = new YahooFinance();
const logQuant = createLogger('Quant');

const QUANT_CACHE_FILE = path.join(DATA_DIR, '.docvault-quant-cache.json');

const DAY_MS = 86_400_000;
const TTL = {
  presidentialCycle: 7 * DAY_MS, // monthly data — weekly refresh is plenty
  btcLogRegression: DAY_MS, // daily refresh
};

interface CacheEntry<T> {
  fetchedAt: number;
  data: T;
}

type QuantCache = {
  presidentialCycle?: CacheEntry<PresidentialCycleResponse>;
  btcLogRegression?: CacheEntry<BtcLogRegressionResponse>;
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
  };
  spxCycle?: {
    currentYear: number;
    currentYearOfCycle: number;
    /** Expected return for the current (year-of-cycle, month) cell */
    currentExpectedReturn: number;
    /** Annual sum for the current year-of-cycle row */
    currentYearAnnualAvg: number;
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

function yearOfCycle(year: number): number {
  // 1-indexed 1..4
  return ((year - 1) % 4) + 1;
}

/** Fetch monthly S&P 500 history from the Shiller dataset mirrored on GitHub.
 *  Monthly back to 1871 — ~155 years, ~38 data points per cycle cell. Free,
 *  no key, cached by GitHub's CDN. Maintained by the `datasets` org.
 *  https://github.com/datasets/s-and-p-500 */
const SHILLER_SP500_URL =
  'https://raw.githubusercontent.com/datasets/s-and-p-500/master/data/data.csv';

async function fetchShillerSp500Monthly(): Promise<{ date: Date; close: number }[]> {
  const res = await fetch(SHILLER_SP500_URL, {
    headers: { Accept: 'text/csv', 'User-Agent': 'docvault/1.0' },
  });
  if (!res.ok) {
    throw new Error(`Shiller CSV ${res.status}: ${await res.text()}`);
  }
  const csv = await res.text();
  const lines = csv.trim().split('\n');
  // Header: Date,SP500,Dividend,Earnings,...
  const bars: { date: Date; close: number }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < 2) continue;
    const dateStr = cols[0];
    const sp500 = Number(cols[1]);
    if (!Number.isFinite(sp500) || sp500 <= 0) continue;
    const date = new Date(dateStr + 'T00:00:00Z');
    if (Number.isNaN(date.getTime())) continue;
    bars.push({ date, close: sp500 });
  }
  return bars;
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

  await saveCache(cache);

  // Only write a snapshot if at least one metric refreshed successfully
  if (spxCycleOk || btcOk) {
    try {
      await appendSnapshot(snap);
    } catch (err) {
      logQuant.warn(`Snapshot write failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  return { btc: btcOk, spxCycle: spxCycleOk, errors };
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
      ok: result.btc || result.spxCycle,
      btcRefreshed: result.btc,
      spxCycleRefreshed: result.spxCycle,
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
    return jsonResponse({
      snapshots: filtered,
      totalAll: file.snapshots.length,
      returned: filtered.length,
      days,
    });
  }

  // GET /api/quant/cycle/presidential
  if (pathname === '/api/quant/cycle/presidential' && req.method === 'GET') {
    const cache = await loadCache();
    if (isFresh(cache.presidentialCycle, TTL.presidentialCycle)) {
      return jsonResponse({
        ...cache.presidentialCycle!.data,
        cached: true,
        fetchedAt: cache.presidentialCycle!.fetchedAt,
      });
    }
    try {
      const data = await computePresidentialCycle();
      cache.presidentialCycle = { fetchedAt: Date.now(), data };
      await saveCache(cache);
      return jsonResponse({ ...data, cached: false, fetchedAt: cache.presidentialCycle.fetchedAt });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Fall back to stale cache if a fetch fails
      if (cache.presidentialCycle) {
        return jsonResponse({
          ...cache.presidentialCycle.data,
          cached: true,
          stale: true,
          fetchedAt: cache.presidentialCycle.fetchedAt,
          fetchError: msg,
        });
      }
      return jsonResponse({ error: `Presidential cycle fetch failed: ${msg}` }, 502);
    }
  }

  // GET /api/quant/btc/log-regression
  if (pathname === '/api/quant/btc/log-regression' && req.method === 'GET') {
    const cache = await loadCache();
    if (isFresh(cache.btcLogRegression, TTL.btcLogRegression)) {
      return jsonResponse({
        ...cache.btcLogRegression!.data,
        cached: true,
        fetchedAt: cache.btcLogRegression!.fetchedAt,
      });
    }
    try {
      const data = await computeBtcLogRegression();
      cache.btcLogRegression = { fetchedAt: Date.now(), data };
      await saveCache(cache);
      return jsonResponse({
        ...data,
        cached: false,
        fetchedAt: cache.btcLogRegression.fetchedAt,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (cache.btcLogRegression) {
        return jsonResponse({
          ...cache.btcLogRegression.data,
          cached: true,
          stale: true,
          fetchedAt: cache.btcLogRegression.fetchedAt,
          fetchError: msg,
        });
      }
      return jsonResponse({ error: `BTC log regression fetch failed: ${msg}` }, 502);
    }
  }

  return null;
}
