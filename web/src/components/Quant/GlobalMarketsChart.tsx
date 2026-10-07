import { Globe } from 'lucide-react';
import { SeriesDashboardCard } from './SeriesDashboardCard';
import { useGlobalMarkets, type MacroSeriesData } from './useQuantData';

const COLORS: Record<string, string> = {
  '^FTSE': '#06b6d4', // UK — cyan
  '^GDAXI': '#f59e0b', // Germany — amber
  '^N225': '#f43f5e', // Japan — rose
  '^HSI': '#a855f7', // Hong Kong — purple
  '^SSEC': '#ef4444', // China — red
  EEM: '#10b981', // EM — emerald
  EFA: '#3b82f6', // Developed — blue
  FXI: '#fb923c', // China ETF — orange
};

const fmtValue = (s: MacroSeriesData, v: number) => {
  // ETFs are USD-priced, indices are in local currency
  if (['EEM', 'EFA', 'FXI'].includes(s.id)) return `$${v.toFixed(2)}`;
  return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
};

/** Global Markets — 5 major international stock indices + 3 ETFs that give
 *  broad exposure to developed, emerging, and China markets. Cowen watches
 *  these for global liquidity divergences — when the DAX and Nikkei run while
 *  Shanghai lags, capital is flowing to developed ex-US; when EM leads, risk
 *  appetite is broadening. */
export function GlobalMarketsChart() {
  const { data, loading, error } = useGlobalMarkets();
  return (
    <SeriesDashboardCard
      title="Global Markets"
      titleIcon={Globe}
      titleIconClass="text-blue-400"
      description={
        <>
          Five major international indices — FTSE 100 (UK), DAX (Germany), Nikkei 225 (Japan), Hang
          Seng (Hong Kong), Shanghai Composite (China) — plus three ETFs: EEM (emerging markets),
          EFA (developed ex US/Canada), and FXI (China large-cap). Watch for divergences: when
          developed markets lead while EM lags, capital is consolidating into quality; when EM
          leads, global risk appetite is broadening.
        </>
      }
      loading={loading}
      error={error}
      data={data}
      colors={COLORS}
      formatValue={fmtValue}
      gridCols="md:grid-cols-2 lg:grid-cols-4"
      footer="Source: yahoo-finance2 · Indices in local currency; ETFs in USD · End-of-day"
    />
  );
}
