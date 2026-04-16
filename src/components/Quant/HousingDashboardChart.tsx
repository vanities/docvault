import { Home } from 'lucide-react';
import { SeriesDashboardCard } from './SeriesDashboardCard';
import { useHousingDashboard, type MacroSeriesData } from './useQuantData';

const COLORS: Record<string, string> = {
  CSUSHPISA: '#06b6d4',
  MORTGAGE30US: '#f43f5e',
  HOUST: '#10b981',
  HSN1F: '#a855f7',
  MSPUS: '#f59e0b',
  RRVRUSQ156N: '#eab308',
};

// Higher mortgage rates and vacancy = bad for housing bulls. Everything else
// rising = good (home prices, starts, sales, median price).
const GOOD_DIRECTION: Record<string, 'up' | 'down'> = {
  CSUSHPISA: 'up',
  MORTGAGE30US: 'down',
  HOUST: 'up',
  HSN1F: 'up',
  MSPUS: 'up',
  RRVRUSQ156N: 'down',
};

const fmtValue = (s: MacroSeriesData, v: number) => {
  if (s.id === 'MSPUS') return `$${(v / 1000).toFixed(0)}k`;
  if (s.id === 'MORTGAGE30US' || s.id === 'RRVRUSQ156N') return `${v.toFixed(s.decimals)}%`;
  return `${v.toLocaleString(undefined, { maximumFractionDigits: s.decimals })}${s.unit}`;
};

/** Housing Dashboard — 6 FRED series covering price, financing, supply, and
 *  vacancy. Case-Shiller is the canonical home-price gauge; housing starts
 *  and new home sales are leading indicators for the broader economy. */
export function HousingDashboardChart() {
  const { data, loading, error } = useHousingDashboard();
  return (
    <SeriesDashboardCard
      title="Housing Market"
      titleIcon={Home}
      titleIconClass="text-cyan-400"
      description={
        <>
          Six housing series from FRED: Case-Shiller national home price index, 30Y fixed mortgage
          rate, housing starts, new home sales, median new home price, and rental vacancy rate.
          Housing is one of the earliest leading indicators for the economy — construction spending
          and starts slow before broader recessions, and median price + vacancy reveal supply/demand
          balance.
        </>
      }
      loading={loading}
      error={error}
      data={data}
      colors={COLORS}
      goodDirection={GOOD_DIRECTION}
      formatValue={fmtValue}
      footer={
        <>
          Source:{' '}
          <a
            href="https://fred.stlouisfed.org/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-cyan-400 hover:underline"
          >
            FRED
          </a>
          {
            ' · Case-Shiller monthly (2mo lag) · Mortgage weekly · Starts/sales monthly · MSPUS quarterly'
          }
        </>
      }
      missingKeyHint
    />
  );
}
