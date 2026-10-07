import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import type { PortfolioSnapshot } from '../../types';
import { Card } from '@/components/ui/card';
import { Money } from './Money';
import {
  CHANGE_PERIODS,
  comparisonDay,
  latestSnapshot,
  portfolioChange,
  snapshotValue,
  type PortfolioValueKey,
} from '../../../server/portfolio-changes';

function formatUsd(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function ChangeNumber({
  value,
  percent = false,
}: {
  value: number | null;
  percent?: boolean;
}) {
  if (value === null) {
    return (
      <span className="text-surface-500" title="No comparable history">
        —
      </span>
    );
  }
  // Avoid displaying a negative zero after rounding tiny movements to cents.
  const rounded = Number(value.toFixed(2));
  const Direction = rounded > 0 ? ArrowUp : rounded < 0 ? ArrowDown : Minus;
  const color = rounded > 0 ? 'text-green-500' : rounded < 0 ? 'text-red-500' : 'text-surface-500';
  return (
    <Money className={`inline-flex items-center justify-end gap-1 whitespace-nowrap ${color}`}>
      {!percent && <Direction className="size-3 shrink-0" aria-hidden="true" />}
      {rounded > 0 ? '+' : ''}
      {percent ? `${rounded.toFixed(2)}%` : formatUsd(rounded)}
    </Money>
  );
}

export function PortfolioChanges({
  snapshots,
  rows,
  className,
}: {
  snapshots: PortfolioSnapshot[];
  rows: { key: PortfolioValueKey; label: string }[];
  className?: string;
}) {
  const latest = latestSnapshot(snapshots);
  return (
    <Card variant="glass" className={`overflow-hidden ${className ?? ''}`}>
      <div className="px-5 pt-4 pb-2">
        <h3 className="text-[14px] font-semibold text-surface-950">Balance changes</h3>
        <p className="text-[11px] text-surface-500 mt-1">
          {latest ? `Daily snapshots · As of ${latest.date}` : 'No snapshot history available yet.'}
          {' · Includes deposits, withdrawals, and purchases.'}
        </p>
      </div>
      <div className="overflow-x-auto px-5">
        <table className="w-full min-w-[760px] text-right text-[12px] tabular-nums">
          <caption className="sr-only">
            Balance changes in dollars and percent over one day, seven days, and one calendar month
          </caption>
          <thead className="text-[11px] text-surface-500">
            <tr className="border-b border-border/50">
              <th scope="col" className="py-2 pr-4 text-left font-medium whitespace-nowrap">
                Portfolio
              </th>
              <th scope="col" className="py-2 px-3 font-medium whitespace-nowrap">
                Snapshot value
              </th>
              {CHANGE_PERIODS.map((period) => (
                <PeriodHeadings
                  key={period}
                  period={period}
                  title={latest ? `Compared with ${comparisonDay(latest.date, period)}` : undefined}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, label }) => {
              const value = snapshotValue(latest, key);
              return (
                <tr key={key} className="border-b border-border/30 last:border-0">
                  <th
                    scope="row"
                    className="py-3 pr-4 text-left font-medium text-surface-950 whitespace-nowrap"
                  >
                    {label}
                  </th>
                  <td className="py-3 px-3 text-surface-950 whitespace-nowrap">
                    {value === null ? '—' : <Money>{formatUsd(value)}</Money>}
                  </td>
                  {CHANGE_PERIODS.map((period) => {
                    const change = latest
                      ? portfolioChange(snapshots, key, latest.date, period)
                      : null;
                    return (
                      <ChangeCells
                        key={period}
                        amount={change?.amount ?? null}
                        percent={change?.percent ?? null}
                      />
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="px-5 pb-4 pt-2 text-[11px] text-surface-500">
        1M = one calendar month. — = unavailable; % is unavailable when the starting value is $0.
      </p>
    </Card>
  );
}

function PeriodHeadings({ period, title }: { period: string; title?: string }) {
  return (
    <>
      <th
        scope="col"
        title={title}
        className="py-2 px-3 font-medium whitespace-nowrap border-l border-border/30"
      >
        {period} $
      </th>
      <th scope="col" title={title} className="py-2 px-3 font-medium whitespace-nowrap">
        {period} %
      </th>
    </>
  );
}

function ChangeCells({ amount, percent }: { amount: number | null; percent: number | null }) {
  return (
    <>
      <td className="py-3 px-3 border-l border-border/30">
        <ChangeNumber value={amount} />
      </td>
      <td className="py-3 px-3">
        <ChangeNumber value={percent} percent />
      </td>
    </>
  );
}
