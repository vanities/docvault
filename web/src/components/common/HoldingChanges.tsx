import { CHANGE_PERIODS } from '../../../server/portfolio-changes';
import { positionChange, type PerformanceQuote } from '../../../server/market-changes';
import { ChangeNumber } from './PortfolioChanges';

export function HoldingChangeHeaders() {
  return (
    <>
      {CHANGE_PERIODS.map((period) => (
        <div key={period} className="text-right">
          {period} $ / %
        </div>
      ))}
    </>
  );
}

export function HoldingChanges({
  quote,
  quantity,
}: {
  quote: PerformanceQuote | undefined;
  quantity: number;
}) {
  return (
    <>
      {CHANGE_PERIODS.map((period) => {
        const change = positionChange(quote, quantity, period);
        return (
          <div
            key={period}
            className="text-right text-[11px] tabular-nums"
            title={
              change
                ? `Price change since ${change.baselineDate}; quote as of ${quote?.performance?.asOf}`
                : 'Historical USD price unavailable'
            }
          >
            <div>
              <ChangeNumber value={change?.amount ?? null} />
            </div>
            <div>
              <ChangeNumber value={change?.percent ?? null} percent />
            </div>
          </div>
        );
      })}
    </>
  );
}

export function HoldingChangesNote() {
  return (
    <p className="text-[11px] text-surface-500 py-2">
      1D / 7D / 1M: historical price change; $ uses current shares or coins. Excludes dividends and
      account activity. 1D uses the previous close; 7D and 1M use the close on or before that date.
      — = unavailable.
    </p>
  );
}
