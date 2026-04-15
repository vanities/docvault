import { useState, useEffect, type ReactNode } from 'react';
import { LineChart, Bitcoin, Landmark, Building2, RefreshCw } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { PresidentialCycleChart } from './PresidentialCycleChart';
import { BtcLogRegressionChart } from './BtcLogRegressionChart';
import { BtcRiskMetricChart } from './BtcRiskMetricChart';
import { BtcMovingAveragesChart } from './BtcMovingAveragesChart';
import { BmsbChart } from './BmsbChart';
import { PiCycleChart } from './PiCycleChart';
import { GoldenDeathCrossChart } from './GoldenDeathCrossChart';
import { BtcDominanceChart } from './BtcDominanceChart';
import { BtcDerivativesChart } from './BtcDerivativesChart';
import { CowenCorridorChart } from './CowenCorridorChart';
import { SectorRotationChart } from './SectorRotationChart';
import { ShillerValuationChart } from './ShillerValuationChart';
import { SP500RiskMetricChart } from './SP500RiskMetricChart';
import { MidtermDrawdownChart } from './MidtermDrawdownChart';
import { YieldCurveChart } from './YieldCurveChart';
import { MacroDashboardChart } from './MacroDashboardChart';
import { useQuantRefresh } from './useQuantData';

/** Three top-level categories inspired by Into The Cryptoverse's own layout. */
type QuantCategory = 'crypto' | 'macro' | 'tradfi';

const STORAGE_KEY = 'docvault.quant.category';

const CATEGORY_META: Record<
  QuantCategory,
  { label: string; accent: string; icon: typeof LineChart; description: string }
> = {
  crypto: {
    label: 'Crypto',
    accent: 'text-amber-400',
    icon: Bitcoin,
    description:
      'Bitcoin, Ethereum, and altcoin cycle analysis — log regressions, risk metrics, dominance, and on-chain signals.',
  },
  macro: {
    label: 'Macro',
    accent: 'text-cyan-400',
    icon: Landmark,
    description:
      'Federal Reserve and macroeconomic overlays — yields, dollar index, M2, inflation, employment. Powered by FRED.',
  },
  tradfi: {
    label: 'TradFi',
    accent: 'text-emerald-400',
    icon: Building2,
    description:
      'Equity markets and traditional finance — S&P 500 cycles, sector rotation, valuation ratios, and commodity trends.',
  },
};

/** A stacked section of one or more charts that share a theme within a
 *  category. Keeps the page scannable when we have many charts. */
function ChartGroup({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-8">
      <div className="mb-3 flex items-baseline gap-3">
        <h3 className="text-[11px] font-semibold text-surface-500 uppercase tracking-[0.15em]">
          {title}
        </h3>
        {subtitle && <span className="text-[11px] text-surface-500/70">{subtitle}</span>}
      </div>
      <div className="space-y-6">{children}</div>
    </div>
  );
}

/** Card shown when a category has nothing built yet — prompts the user on
 *  what's coming and points to the plan doc. */
function EmptyCategoryCard({
  category,
  comingSoon,
}: {
  category: QuantCategory;
  comingSoon: string[];
}) {
  const meta = CATEGORY_META[category];
  const Icon = meta.icon;
  return (
    <Card variant="glass" className="p-8">
      <div className="flex flex-col items-center text-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-surface-200/30 flex items-center justify-center">
          <Icon className={`w-6 h-6 ${meta.accent}`} />
        </div>
        <h3 className="text-lg font-semibold text-surface-950">No {meta.label} charts yet</h3>
        <p className="text-[13px] text-surface-600 max-w-xl leading-relaxed">{meta.description}</p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {comingSoon.map((name) => (
            <span
              key={name}
              className="px-2 py-1 rounded-lg border border-border/50 bg-surface-100/40 text-[11px] text-surface-700 font-medium"
            >
              {name}
            </span>
          ))}
        </div>
        <div className="text-[11px] text-surface-500 mt-1">
          Roadmap: see <code className="text-cyan-400 font-mono">docs/quant-charts-plan.md</code>
        </div>
      </div>
    </Card>
  );
}

export function QuantView() {
  const [category, setCategory] = useState<QuantCategory>(() => {
    if (typeof window === 'undefined') return 'tradfi';
    const stored = localStorage.getItem(STORAGE_KEY);
    const valid: QuantCategory[] = ['crypto', 'macro', 'tradfi'];
    return valid.includes(stored as QuantCategory) ? (stored as QuantCategory) : 'tradfi';
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, category);
  }, [category]);

  const { refresh, refreshing, lastRefresh, error: refreshError } = useQuantRefresh();

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-surface-950 flex items-center gap-2">
            <LineChart className="w-6 h-6 text-cyan-400" />
            Quant
          </h2>
          <p className="text-[13px] text-surface-600 mt-1">
            Market cycle analysis organized into three categories — Crypto, Macro, and TradFi —
            inspired by Benjamin Cowen's Into The Cryptoverse.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={refreshing}>
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Refreshing...' : 'Refresh now'}
          </Button>
          {lastRefresh && (
            <span className="text-[10px] text-surface-500">
              Refreshed {new Date(lastRefresh).toLocaleTimeString()}
            </span>
          )}
          {refreshError && (
            <span className="text-[10px] text-danger-400 max-w-xs text-right">{refreshError}</span>
          )}
          {!lastRefresh && !refreshError && (
            <span className="text-[10px] text-surface-500">Auto-refreshes daily</span>
          )}
        </div>
      </div>

      <Tabs
        value={category}
        onValueChange={(v) => setCategory(v as QuantCategory)}
        className="gap-6"
      >
        <TabsList>
          {(Object.keys(CATEGORY_META) as QuantCategory[]).map((key) => {
            const meta = CATEGORY_META[key];
            const Icon = meta.icon;
            return (
              <TabsTrigger key={key} value={key}>
                <Icon className={`w-3.5 h-3.5 ${category === key ? meta.accent : ''}`} />
                {meta.label}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {/* ── Crypto ─────────────────────────────────────── */}
        <TabsContent value="crypto">
          <p className="text-[12px] text-surface-600 mb-6 leading-relaxed">
            {CATEGORY_META.crypto.description}
          </p>

          <ChartGroup title="BTC Risk Metric" subtitle="composite 0-1 Cowen-style">
            <BtcRiskMetricChart />
          </ChartGroup>

          <ChartGroup title="BTC Log Regression" subtitle="diminishing returns power law">
            <BtcLogRegressionChart />
          </ChartGroup>

          <ChartGroup title="BTC Moving Averages + Mayer" subtitle="200W cycle line + Mayer bands">
            <BtcMovingAveragesChart />
          </ChartGroup>

          <ChartGroup title="Bull Market Support Band" subtitle="20W SMA + 21W EMA">
            <BmsbChart />
          </ChartGroup>

          <ChartGroup title="Cowen Corridor" subtitle="multiples of the 20WMA">
            <CowenCorridorChart />
          </ChartGroup>

          <ChartGroup title="Pi Cycle Top" subtitle="111D SMA vs 350D × 2">
            <PiCycleChart />
          </ChartGroup>

          <ChartGroup title="Golden / Death Cross" subtitle="50D × 200D SMA crossovers">
            <GoldenDeathCrossChart />
          </ChartGroup>

          <ChartGroup
            title="Bitcoin Dominance + SSR"
            subtitle="BTC.D + flight to safety + stablecoin supply ratio"
          >
            <BtcDominanceChart />
          </ChartGroup>

          <ChartGroup title="BTC Derivatives" subtitle="OKX funding rate + OI + long/short">
            <BtcDerivativesChart />
          </ChartGroup>

          <ChartGroup title="Coming next">
            <EmptyCategoryCard
              category="crypto"
              comingSoon={[
                'Altcoin Season Index',
                'Flippening Index',
                'MVRV Z-Score (needs on-chain data)',
              ]}
            />
          </ChartGroup>
        </TabsContent>

        {/* ── Macro ──────────────────────────────────────── */}
        <TabsContent value="macro">
          <p className="text-[12px] text-surface-600 mb-6 leading-relaxed">
            {CATEGORY_META.macro.description}
          </p>

          <ChartGroup title="Macro regime" subtitle="5 key FRED series">
            <MacroDashboardChart />
          </ChartGroup>

          <ChartGroup title="Yield curve" subtitle="FRED T10Y2Y + T10Y3M">
            <YieldCurveChart />
          </ChartGroup>

          <ChartGroup title="Coming next">
            <EmptyCategoryCard
              category="macro"
              comingSoon={[
                'Unemployment Rate (UNRATE)',
                'Fed Balance Sheet (WALCL)',
                'ISM Manufacturing PMI',
                '2Y Treasury (DGS2)',
                'Headline CPI YoY',
              ]}
            />
          </ChartGroup>
        </TabsContent>

        {/* ── TradFi ─────────────────────────────────────── */}
        <TabsContent value="tradfi">
          <p className="text-[12px] text-surface-600 mb-6 leading-relaxed">
            {CATEGORY_META.tradfi.description}
          </p>

          <ChartGroup title="SP500 Risk Metric" subtitle="composite 0-1, Shiller 1871+">
            <SP500RiskMetricChart />
          </ChartGroup>

          <ChartGroup title="Sector rotation" subtitle="11 S&P sectors vs SPY">
            <SectorRotationChart />
          </ChartGroup>

          <ChartGroup title="Valuation" subtitle="Shiller CAPE + Dividend Yield, 1871–present">
            <ShillerValuationChart />
          </ChartGroup>

          <ChartGroup title="Market cycles" subtitle="Presidential cycle heatmap, 1871–present">
            <PresidentialCycleChart />
          </ChartGroup>

          <ChartGroup title="Midterm drawdowns" subtitle="every midterm year overlaid, 2026 live">
            <MidtermDrawdownChart />
          </ChartGroup>

          <ChartGroup title="Coming next">
            <EmptyCategoryCard
              category="tradfi"
              comingSoon={[
                'SPX Monthly Seasonality',
                'Running ROI',
                'Commodity Momentum',
                'Bond / Equity Ratio',
              ]}
            />
          </ChartGroup>
        </TabsContent>
      </Tabs>
    </div>
  );
}
