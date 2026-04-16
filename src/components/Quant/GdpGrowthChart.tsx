import { Factory } from 'lucide-react';
import { SeriesDashboardCard } from './SeriesDashboardCard';
import { useGdpGrowthDashboard, type MacroSeriesData } from './useQuantData';

const COLORS: Record<string, string> = {
  GDPC1: '#06b6d4',
  GDP: '#a855f7',
  INDPRO: '#10b981',
  RSAFS: '#f59e0b',
  TCU: '#f43f5e',
  USSLIND: '#eab308',
};

// Everything rising = good for growth.
const fmtValue = (s: MacroSeriesData, v: number) => {
  if (s.id === 'GDPC1' || s.id === 'GDP') return `$${(v / 1000).toFixed(2)}T`;
  if (s.id === 'RSAFS') return `$${(v / 1000).toFixed(1)}B`;
  if (s.id === 'TCU') return `${v.toFixed(1)}%`;
  return `${v.toLocaleString(undefined, { maximumFractionDigits: s.decimals })}${s.unit}`;
};

/** GDP & Growth Dashboard — real GDP, nominal GDP, industrial production,
 *  retail sales, capacity utilization, and the Philly Fed Leading Index.
 *  Together they paint the picture of how fast the real economy is growing. */
export function GdpGrowthChart() {
  const { data, loading, error } = useGdpGrowthDashboard();
  return (
    <SeriesDashboardCard
      title="GDP & Growth"
      titleIcon={Factory}
      titleIconClass="text-cyan-400"
      description={
        <>
          Real GDP (inflation-adjusted), nominal GDP, Industrial Production, Retail Sales, Capacity
          Utilization, and the Philly Fed Leading Index. Together these measure how fast the real
          economy is growing. Real GDP and Leading Index are the two Cowen watches most — positive
          Leading Index + expanding real GDP = growth regime; negative USSLIND + flat GDPC1 = late
          cycle.
        </>
      }
      loading={loading}
      error={error}
      data={data}
      colors={COLORS}
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
          {' · GDP quarterly · INDPRO / RSAFS / TCU monthly · USSLIND monthly'}
        </>
      }
      missingKeyHint
    />
  );
}
