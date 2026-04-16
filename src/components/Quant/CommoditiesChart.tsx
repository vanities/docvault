import { Coins } from 'lucide-react';
import { SeriesDashboardCard } from './SeriesDashboardCard';
import { useCommodities, type MacroSeriesData } from './useQuantData';

const COLORS: Record<string, string> = {
  'GC=F': '#eab308', // Gold — yellow
  'SI=F': '#94a3b8', // Silver — slate
  'CL=F': '#f59e0b', // WTI Crude — amber
  'HG=F': '#f97316', // Copper — orange
  'NG=F': '#06b6d4', // Nat Gas — cyan
  'PL=F': '#a855f7', // Platinum — purple
};

const fmtValue = (_s: MacroSeriesData, v: number) => {
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
};

/** Commodities Dashboard — 6 front-month futures tickers from yahoo-finance2.
 *  Gold and platinum for precious metals, WTI crude and nat gas for energy,
 *  copper for industrial demand ("Dr. Copper"), silver as the precious/
 *  industrial hybrid. Rising copper with flat/falling gold is a classic
 *  risk-on signal; rising gold with falling copper is risk-off. */
export function CommoditiesChart() {
  const { data, loading, error } = useCommodities();
  return (
    <SeriesDashboardCard
      title="Commodities"
      titleIcon={Coins}
      titleIconClass="text-amber-400"
      description={
        <>
          Front-month futures for Gold, Silver, WTI Crude, Copper, Natural Gas, and Platinum.{' '}
          <strong className="text-orange-400">&quot;Dr. Copper&quot;</strong> is the classic
          industrial-demand gauge — rising copper alongside flat/falling gold is a risk-on signal
          for cyclicals. Rising gold with falling copper is risk-off. Oil feeds directly into
          headline inflation.
        </>
      }
      loading={loading}
      error={error}
      data={data}
      colors={COLORS}
      formatValue={fmtValue}
      footer="Source: yahoo-finance2 front-month futures (GC=F / SI=F / CL=F / HG=F / NG=F / PL=F) · End-of-day"
    />
  );
}
