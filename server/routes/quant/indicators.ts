export function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

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
