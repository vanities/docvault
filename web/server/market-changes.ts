import {
  CHANGE_PERIODS,
  comparisonDay,
  type ChangePeriod,
  type ValueChange,
} from './portfolio-changes.js';

export interface MarketChange extends ValueChange {
  baselineDate: string;
}

export interface MarketPerformance {
  asOf: string;
  changes: Record<ChangePeriod, MarketChange | null>;
}

export interface PerformanceQuote {
  symbol: string;
  currency: string | null;
  performance: MarketPerformance | null;
}

/** Price movement, not total return: daily closes are split-adjusted by Yahoo. */
export function marketPerformance(
  price: number,
  asOf: Date,
  timeZone: string,
  history: { date: Date; close: number | null }[]
): MarketPerformance | null {
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(asOf.getTime())) return null;
  const dayFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const formatDay = (date: Date) => dayFormatter.format(date);
  const currentDay = formatDay(asOf);
  const closes = history
    .filter(
      (point) =>
        Number.isFinite(point.date.getTime()) &&
        typeof point.close === 'number' &&
        Number.isFinite(point.close) &&
        point.close > 0
    )
    .map((point) => ({ date: formatDay(point.date), close: point.close! }))
    .sort((a, b) => b.date.localeCompare(a.date));
  const changes = Object.fromEntries(
    CHANGE_PERIODS.map((period) => {
      const target = comparisonDay(currentDay, period)!;
      // Allow weekends and exchange holidays, but not an arbitrarily old quote.
      const baseline = closes.find((point) => point.date <= target);
      if (!baseline || (Date.parse(target) - Date.parse(baseline.date)) / 86_400_000 > 4) {
        return [period, null];
      }
      const amount = price - baseline.close;
      return [
        period,
        { amount, percent: (amount / baseline.close) * 100, baselineDate: baseline.date },
      ];
    })
  ) as MarketPerformance['changes'];
  return { asOf: asOf.toISOString(), changes };
}

/** Only request ordinary symbols; CUSIPs and cash have no Yahoo price history. */
export function performanceSymbol(symbol: string, crypto = false): string | null {
  const normalized = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9.^=-]{1,16}$/.test(normalized) || ['USD', 'CASH'].includes(normalized)) return null;
  if (!crypto && /^[A-Z0-9]{8}\d$/.test(normalized)) return null;
  return crypto ? `${normalized}-USD` : normalized;
}

/** Dollar effect on today's quantity, never a reconstruction of past positions. */
export function positionChange(
  quote: PerformanceQuote | undefined,
  quantity: number,
  period: ChangePeriod
): MarketChange | null {
  const change = quote?.performance?.changes[period];
  if (quote?.currency !== 'USD' || !change || !Number.isFinite(quantity) || quantity < 0)
    return null;
  const amount = change.amount * quantity;
  return Number.isFinite(amount) ? { ...change, amount } : null;
}
