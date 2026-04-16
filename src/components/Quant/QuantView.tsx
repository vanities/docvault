import { useState, useEffect, useMemo, type ReactNode } from 'react';
import {
  LineChart,
  Bitcoin,
  Landmark,
  Building2,
  RefreshCw,
  Grid3x3,
  CalendarClock,
} from 'lucide-react';
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
import { AltcoinSeasonChart } from './AltcoinSeasonChart';
import { OverviewPanel } from './OverviewPanel';
import { CowenCorridorChart } from './CowenCorridorChart';
import { SectorRotationChart } from './SectorRotationChart';
import { ShillerValuationChart } from './ShillerValuationChart';
import { SP500RiskMetricChart } from './SP500RiskMetricChart';
import { MidtermDrawdownChart } from './MidtermDrawdownChart';
import { YieldCurveChart } from './YieldCurveChart';
import { MacroDashboardChart } from './MacroDashboardChart';
import { JobsDashboardChart } from './JobsDashboardChart';
import { FedPolicyChart } from './FedPolicyChart';
import { BusinessCycleChart } from './BusinessCycleChart';
import { InflationDashboardChart } from './InflationDashboardChart';
import { FinancialConditionsChart } from './FinancialConditionsChart';
import { BtcDrawdownChart } from './BtcDrawdownChart';
import { FearGreedChart } from './FearGreedChart';
import { FlippeningChart } from './FlippeningChart';
import { RealRatesChart } from './RealRatesChart';
import { HashRateChart } from './HashRateChart';
import { RunningRoiChart } from './RunningRoiChart';
import { HousingDashboardChart } from './HousingDashboardChart';
import { GdpGrowthChart } from './GdpGrowthChart';
import { CommoditiesChart } from './CommoditiesChart';
import { VixTermStructureChart } from './VixTermStructureChart';
import { GlobalMarketsChart } from './GlobalMarketsChart';
import { useQuantRefresh } from './useQuantData';

/** Four top-level tabs — an overview snapshot plus Cowen's 3 categories. */
type QuantCategory = 'overview' | 'crypto' | 'macro' | 'tradfi';

const STORAGE_KEY = 'docvault.quant.category';

const CATEGORY_META: Record<
  QuantCategory,
  { label: string; accent: string; icon: typeof LineChart; description: string }
> = {
  overview: {
    label: 'Overview',
    accent: 'text-cyan-300',
    icon: Grid3x3,
    description:
      'Every signal in one view. Click any card to jump into the detailed chart for that category.',
  },
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
        <h3 className="text-[11px] font-semibold text-surface-700 uppercase tracking-[0.15em]">
          {title}
        </h3>
        {subtitle && <span className="text-[11px] text-surface-700/70">{subtitle}</span>}
      </div>
      <div className="space-y-6">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Upcoming macro events — FOMC + key releases. FOMC schedule is published
// by the Fed a year in advance; we hard-code 2025-2027 and roll forward.
// CPI and NFP follow a fixed cadence (BLS publishes the full-year schedule).
// ---------------------------------------------------------------------------

interface MacroEvent {
  date: string; // YYYY-MM-DD
  label: string;
  type: 'fomc' | 'cpi' | 'nfp' | 'gdp' | 'pce';
  /** Optional link to the release page. */
  url?: string;
}

const MACRO_EVENTS: MacroEvent[] = [
  // 2026 FOMC meetings (2-day meetings end on these dates)
  {
    date: '2026-01-28',
    label: 'FOMC Decision',
    type: 'fomc',
    url: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
  },
  {
    date: '2026-03-18',
    label: 'FOMC Decision',
    type: 'fomc',
    url: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
  },
  {
    date: '2026-05-06',
    label: 'FOMC Decision',
    type: 'fomc',
    url: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
  },
  {
    date: '2026-06-17',
    label: 'FOMC Decision',
    type: 'fomc',
    url: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
  },
  {
    date: '2026-07-29',
    label: 'FOMC Decision',
    type: 'fomc',
    url: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
  },
  {
    date: '2026-09-16',
    label: 'FOMC Decision',
    type: 'fomc',
    url: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
  },
  {
    date: '2026-10-28',
    label: 'FOMC Decision',
    type: 'fomc',
    url: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
  },
  {
    date: '2026-12-16',
    label: 'FOMC Decision',
    type: 'fomc',
    url: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
  },
  // 2026 CPI releases (typically 2nd or 3rd week of the month for prior month)
  { date: '2026-01-14', label: 'CPI (Dec)', type: 'cpi', url: 'https://www.bls.gov/cpi/' },
  { date: '2026-02-11', label: 'CPI (Jan)', type: 'cpi', url: 'https://www.bls.gov/cpi/' },
  { date: '2026-03-11', label: 'CPI (Feb)', type: 'cpi', url: 'https://www.bls.gov/cpi/' },
  { date: '2026-04-14', label: 'CPI (Mar)', type: 'cpi', url: 'https://www.bls.gov/cpi/' },
  { date: '2026-05-12', label: 'CPI (Apr)', type: 'cpi', url: 'https://www.bls.gov/cpi/' },
  { date: '2026-06-10', label: 'CPI (May)', type: 'cpi', url: 'https://www.bls.gov/cpi/' },
  { date: '2026-07-14', label: 'CPI (Jun)', type: 'cpi', url: 'https://www.bls.gov/cpi/' },
  { date: '2026-08-12', label: 'CPI (Jul)', type: 'cpi', url: 'https://www.bls.gov/cpi/' },
  { date: '2026-09-15', label: 'CPI (Aug)', type: 'cpi', url: 'https://www.bls.gov/cpi/' },
  { date: '2026-10-13', label: 'CPI (Sep)', type: 'cpi', url: 'https://www.bls.gov/cpi/' },
  { date: '2026-11-12', label: 'CPI (Oct)', type: 'cpi', url: 'https://www.bls.gov/cpi/' },
  { date: '2026-12-10', label: 'CPI (Nov)', type: 'cpi', url: 'https://www.bls.gov/cpi/' },
  // 2026 NFP (first Friday of each month)
  {
    date: '2026-01-02',
    label: 'NFP (Dec)',
    type: 'nfp',
    url: 'https://www.bls.gov/news.release/empsit.nr0.htm',
  },
  {
    date: '2026-02-06',
    label: 'NFP (Jan)',
    type: 'nfp',
    url: 'https://www.bls.gov/news.release/empsit.nr0.htm',
  },
  {
    date: '2026-03-06',
    label: 'NFP (Feb)',
    type: 'nfp',
    url: 'https://www.bls.gov/news.release/empsit.nr0.htm',
  },
  {
    date: '2026-04-03',
    label: 'NFP (Mar)',
    type: 'nfp',
    url: 'https://www.bls.gov/news.release/empsit.nr0.htm',
  },
  {
    date: '2026-05-01',
    label: 'NFP (Apr)',
    type: 'nfp',
    url: 'https://www.bls.gov/news.release/empsit.nr0.htm',
  },
  {
    date: '2026-06-05',
    label: 'NFP (May)',
    type: 'nfp',
    url: 'https://www.bls.gov/news.release/empsit.nr0.htm',
  },
  {
    date: '2026-07-02',
    label: 'NFP (Jun)',
    type: 'nfp',
    url: 'https://www.bls.gov/news.release/empsit.nr0.htm',
  },
  {
    date: '2026-08-07',
    label: 'NFP (Jul)',
    type: 'nfp',
    url: 'https://www.bls.gov/news.release/empsit.nr0.htm',
  },
  {
    date: '2026-09-04',
    label: 'NFP (Aug)',
    type: 'nfp',
    url: 'https://www.bls.gov/news.release/empsit.nr0.htm',
  },
  {
    date: '2026-10-02',
    label: 'NFP (Sep)',
    type: 'nfp',
    url: 'https://www.bls.gov/news.release/empsit.nr0.htm',
  },
  {
    date: '2026-11-06',
    label: 'NFP (Oct)',
    type: 'nfp',
    url: 'https://www.bls.gov/news.release/empsit.nr0.htm',
  },
  {
    date: '2026-12-04',
    label: 'NFP (Nov)',
    type: 'nfp',
    url: 'https://www.bls.gov/news.release/empsit.nr0.htm',
  },
];

const EVENT_STYLE: Record<string, { color: string; label: string }> = {
  fomc: { color: 'text-cyan-400', label: 'FOMC' },
  cpi: { color: 'text-amber-400', label: 'CPI' },
  nfp: { color: 'text-emerald-400', label: 'NFP' },
  gdp: { color: 'text-purple-400', label: 'GDP' },
  pce: { color: 'text-rose-400', label: 'PCE' },
};

function UpcomingEventsBanner() {
  const upcoming = useMemo(() => {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    return MACRO_EVENTS.filter((e) => e.date >= todayStr)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 5)
      .map((e) => {
        const eventDate = new Date(e.date + 'T00:00:00');
        const diffMs = eventDate.getTime() - now.getTime();
        const daysAway = Math.ceil(diffMs / 86_400_000);
        return { ...e, daysAway };
      });
  }, []);

  if (upcoming.length === 0) return null;

  return (
    <div className="mb-4 p-3 rounded-xl border border-border/40 bg-surface-100/20 flex items-center gap-4 overflow-x-auto">
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <CalendarClock className="w-4 h-4 text-surface-700" />
        <span className="text-[10px] text-surface-700 uppercase tracking-wider font-semibold">
          Upcoming
        </span>
      </div>
      {upcoming.map((e, i) => {
        const style = EVENT_STYLE[e.type] ?? { color: 'text-surface-800', label: '?' };
        const isImminent = e.daysAway <= 3;
        return (
          <a
            key={`${e.date}-${i}`}
            href={e.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex-shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-lg border transition-all hover:bg-surface-100/40 ${
              isImminent ? 'border-amber-500/40 bg-amber-500/5' : 'border-border/30'
            }`}
          >
            <span className={`text-[10px] font-bold ${style.color}`}>{style.label}</span>
            <span className="text-[11px] text-surface-950 font-medium">{e.label}</span>
            <span
              className={`text-[10px] font-mono ${isImminent ? 'text-amber-400 font-bold' : 'text-surface-700'}`}
            >
              {e.daysAway === 0 ? 'TODAY' : e.daysAway === 1 ? 'tmw' : `${e.daysAway}d`}
            </span>
          </a>
        );
      })}
    </div>
  );
}

export function QuantView() {
  const [category, setCategory] = useState<QuantCategory>(() => {
    if (typeof window === 'undefined') return 'overview';
    const stored = localStorage.getItem(STORAGE_KEY);
    const valid: QuantCategory[] = ['overview', 'crypto', 'macro', 'tradfi'];
    return valid.includes(stored as QuantCategory) ? (stored as QuantCategory) : 'overview';
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
          <p className="text-[13px] text-surface-800 mt-1">
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
            <span className="text-[10px] text-surface-700">
              Refreshed {new Date(lastRefresh).toLocaleTimeString()}
            </span>
          )}
          {refreshError && (
            <span className="text-[10px] text-danger-400 max-w-xs text-right">{refreshError}</span>
          )}
          {!lastRefresh && !refreshError && (
            <span className="text-[10px] text-surface-700">Auto-refreshes daily</span>
          )}
        </div>
      </div>

      <UpcomingEventsBanner />

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

        {/* ── Overview ───────────────────────────────────── */}
        <TabsContent value="overview">
          <p className="text-[12px] text-surface-800 mb-6 leading-relaxed">
            {CATEGORY_META.overview.description}
          </p>
          <OverviewPanel onJumpTo={(cat) => setCategory(cat)} />
        </TabsContent>

        {/* ── Crypto ─────────────────────────────────────── */}
        <TabsContent value="crypto">
          <p className="text-[12px] text-surface-800 mb-6 leading-relaxed">
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

          <ChartGroup
            title="Altcoin Season Index"
            subtitle="top 50 alts outperforming BTC over 90d"
          >
            <AltcoinSeasonChart />
          </ChartGroup>

          <ChartGroup title="BTC Drawdown from ATH" subtitle="running DD + cycle episodes">
            <BtcDrawdownChart />
          </ChartGroup>

          <ChartGroup title="Fear & Greed Index" subtitle="alternative.me 0-100 sentiment">
            <FearGreedChart />
          </ChartGroup>

          <ChartGroup title="Flippening Index" subtitle="ETH / BTC ratio + progress-to-flip">
            <FlippeningChart />
          </ChartGroup>

          <ChartGroup title="Hash Rate + Hash Ribbons" subtitle="30d × 60d SMA crossovers">
            <HashRateChart />
          </ChartGroup>

          <ChartGroup title="Running ROI" subtitle="1y / 2y / 4y rolling hold returns">
            <RunningRoiChart asset="btc" />
          </ChartGroup>
        </TabsContent>

        {/* ── Macro ──────────────────────────────────────── */}
        <TabsContent value="macro">
          <p className="text-[12px] text-surface-800 mb-6 leading-relaxed">
            {CATEGORY_META.macro.description}
          </p>

          <ChartGroup title="Business Cycle" subtitle="recession probability + leading indicators">
            <BusinessCycleChart />
          </ChartGroup>

          <ChartGroup title="Macro regime" subtitle="5 key FRED series">
            <MacroDashboardChart />
          </ChartGroup>

          <ChartGroup
            title="Inflation & Fed Balance Sheet"
            subtitle="CPI, PCE, PPI, breakevens, WALCL, WTI"
          >
            <InflationDashboardChart />
          </ChartGroup>

          <ChartGroup title="Fed Policy" subtitle="effective + target range + rate change events">
            <FedPolicyChart />
          </ChartGroup>

          <ChartGroup title="Jobs Dashboard" subtitle="6 FRED labor series">
            <JobsDashboardChart />
          </ChartGroup>

          <ChartGroup title="Yield curve" subtitle="FRED T10Y2Y + T10Y3M">
            <YieldCurveChart />
          </ChartGroup>

          <ChartGroup title="Financial Conditions" subtitle="NFCI + ANFCI + STLFSI4 + KCFSI">
            <FinancialConditionsChart />
          </ChartGroup>

          <ChartGroup title="Real Interest Rates" subtitle="DGS10 − T10YIE and DGS5 − T5YIE">
            <RealRatesChart />
          </ChartGroup>

          <ChartGroup
            title="GDP & Growth"
            subtitle="Real GDP + industrial production + leading index"
          >
            <GdpGrowthChart />
          </ChartGroup>

          <ChartGroup title="Housing Market" subtitle="Case-Shiller + mortgage rates + starts">
            <HousingDashboardChart />
          </ChartGroup>
        </TabsContent>

        {/* ── TradFi ─────────────────────────────────────── */}
        <TabsContent value="tradfi">
          <p className="text-[12px] text-surface-800 mb-6 leading-relaxed">
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

          <ChartGroup
            title="S&P 500 Running ROI"
            subtitle="1y / 3y / 5y / 10y rolling holds, 1871+"
          >
            <RunningRoiChart asset="spx" />
          </ChartGroup>

          <ChartGroup title="VIX Term Structure" subtitle="30d / 3mo / 6mo + VXN">
            <VixTermStructureChart />
          </ChartGroup>

          <ChartGroup title="Commodities" subtitle="Gold, Silver, Oil, Copper, Nat Gas, Platinum">
            <CommoditiesChart />
          </ChartGroup>

          <ChartGroup
            title="Global Markets"
            subtitle="FTSE, DAX, Nikkei, Hang Seng, Shanghai + EM/EAFE/FXI"
          >
            <GlobalMarketsChart />
          </ChartGroup>
        </TabsContent>
      </Tabs>
    </div>
  );
}
