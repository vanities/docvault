import { Activity } from 'lucide-react';
import { SeriesDashboardCard } from './SeriesDashboardCard';
import { useVixTermStructure, type MacroSeriesData } from './useQuantData';

const COLORS: Record<string, string> = {
  '^VIX': '#f43f5e',
  '^VIX3M': '#fb923c',
  '^VIX6M': '#f59e0b',
  '^VXN': '#a855f7',
};

// VIX rising is risk-off. Inverted term structure (VIX > VIX3M) is the
// acute-stress tell; normal (VIX < VIX3M < VIX6M) is calm.
const GOOD_DIRECTION: Record<string, 'up' | 'down'> = {
  '^VIX': 'down',
  '^VIX3M': 'down',
  '^VIX6M': 'down',
  '^VXN': 'down',
};

const fmtValue = (_s: MacroSeriesData, v: number) => v.toFixed(2);

/** VIX Term Structure — 30d, 3mo, 6mo SPX implied volatility plus the Nasdaq
 *  VXN. When the front (VIX) trades *above* the back (VIX3M/VIX6M), the
 *  curve is inverted — a classic acute-stress signal. Normal curve is
 *  VIX < VIX3M < VIX6M ("contango"). */
export function VixTermStructureChart() {
  const { data, loading, error } = useVixTermStructure();
  return (
    <SeriesDashboardCard
      title="VIX Term Structure"
      titleIcon={Activity}
      titleIconClass="text-rose-400"
      description={
        <>
          30-day, 3-month, and 6-month S&P 500 implied volatility plus the Nasdaq VXN. Normal regime
          is <strong className="text-emerald-400">VIX &lt; VIX3M &lt; VIX6M</strong> (contango,
          calm). When the front trades <strong className="text-rose-400">above</strong> the back
          (backwardation), markets are pricing acute near-term stress — classic signal around
          rate-hike scares, earnings bombs, and 2020-style cascades.
        </>
      }
      loading={loading}
      error={error}
      data={data}
      colors={COLORS}
      goodDirection={GOOD_DIRECTION}
      formatValue={fmtValue}
      gridCols="md:grid-cols-2 lg:grid-cols-4"
      footer="Source: yahoo-finance2 ^VIX / ^VIX3M / ^VIX6M / ^VXN · End-of-day"
    />
  );
}
