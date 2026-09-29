export const CHANGE_PERIODS = ['1D', '7D', '1M'] as const;
export type ChangePeriod = (typeof CHANGE_PERIODS)[number];
export type PortfolioValueKey =
  | 'totalValue'
  | 'brokerValue'
  | 'cryptoValue'
  | 'bankValue'
  | 'goldValue'
  | 'propertyValue';

type ValueSnapshot = { date: string } & Partial<Record<PortfolioValueKey, number>>;

export interface ValueChange {
  amount: number;
  percent: number | null;
}

function parseDay(day: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day ? date : null;
}

/** Calendar arithmetic in UTC keeps daily snapshot labels independent of DST. */
export function comparisonDay(day: string, period: ChangePeriod): string | null {
  const date = parseDay(day);
  if (!date) return null;
  if (period === '1M') {
    const dayOfMonth = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() - 1);
    const lastDay = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)
    ).getUTCDate();
    date.setUTCDate(Math.min(dayOfMonth, lastDay));
  } else {
    date.setUTCDate(date.getUTCDate() - (period === '1D' ? 1 : 7));
  }
  return date.toISOString().slice(0, 10);
}

export function latestSnapshot(snapshots: ValueSnapshot[]): ValueSnapshot | undefined {
  return snapshots.reduce<ValueSnapshot | undefined>(
    (latest, snapshot) =>
      parseDay(snapshot.date) && (!latest || snapshot.date > latest.date) ? snapshot : latest,
    undefined
  );
}

export function snapshotValue(
  snapshot: ValueSnapshot | undefined,
  key: PortfolioValueKey
): number | null {
  const value = snapshot?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Balance movement, including cash flows. Require the exact comparison day:
 * substituting a nearby observation would silently change the requested period.
 */
export function portfolioChange(
  snapshots: ValueSnapshot[],
  key: PortfolioValueKey,
  asOf: string,
  period: ChangePeriod
): ValueChange | null {
  const baselineDay = comparisonDay(asOf, period);
  if (!baselineDay) return null;
  const current = snapshotValue(
    snapshots.find((snapshot) => snapshot.date === asOf),
    key
  );
  const previous = snapshotValue(
    snapshots.find((snapshot) => snapshot.date === baselineDay),
    key
  );
  if (current === null || previous === null) return null;
  const amount = current - previous;
  // abs keeps improvement in a negative net balance positive. A zero baseline
  // still supports a dollar change, but has no defined percentage change.
  const percent = previous === 0 ? null : (amount / Math.abs(previous)) * 100;
  if (!Number.isFinite(amount)) return null;
  return { amount, percent: percent !== null && Number.isFinite(percent) ? percent : null };
}
