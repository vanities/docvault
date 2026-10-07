// Pure data shaping for HistoryChart, split out so the missing-vs-zero rule is
// testable without a DOM.
//
// The rule: a snapshot field that is absent means "not observed that day" — the
// banks could not be read, say — and must reach the chart as null so the line
// breaks into a gap. Coercing it with `|| 0` renders an outage as the balance
// crashing to zero and back, which is indistinguishable from a real loss.
//
// `|| 0` was doubly wrong here because a real bankValue can be legitimately
// NEGATIVE (it nets card balances against cash), so falsiness cannot be used
// to detect missing data at all.

export interface HistoryPoint {
  date: string;
  fullDate: string;
  [key: string]: string | number | null;
}

/** Value for one series on one day: a number, or null when not observed. */
export function seriesValue(snapshot: Record<string, unknown>, key: string): number | null {
  const raw = snapshot[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

/**
 * First and last OBSERVED values for a series, ignoring gap days. Anchoring the
 * change calculation on a gap would compare against a missing reading and
 * report a fictional swing.
 */
export function observedEndpoints(
  points: HistoryPoint[],
  key: string
): { first: number; last: number; count: number } {
  const observed = points.filter((p) => p[key] !== null && p[key] !== undefined);
  if (observed.length === 0) return { first: 0, last: 0, count: 0 };
  return {
    first: Number(observed[0][key]),
    last: Number(observed[observed.length - 1][key]),
    count: observed.length,
  };
}
