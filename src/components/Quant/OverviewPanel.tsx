import { Card } from '@/components/ui/card';
import {
  Activity,
  Gauge,
  Shield,
  Target,
  PieChart as PieChartIcon,
  Zap,
  Sparkles,
  TrendingUp,
  Landmark,
  Scale,
  CalendarRange,
  Layers,
  TrendingDown,
  Flame,
  AlertTriangle,
  ShieldAlert,
  Percent,
  Repeat,
  Cpu,
  type LucideIcon,
} from 'lucide-react';
import {
  useBtcLogRegression,
  useBtcDominance,
  useBtcDerivatives,
  useAltcoinSeason,
  useYieldCurve,
  useMacroDashboard,
  useShillerValuation,
  useSectorRotation,
  usePresidentialCycle,
  useMidtermDrawdowns,
  useSP500RiskMetric,
  useBusinessCycle,
  useInflationDashboard,
  useFinancialConditions,
  useBtcDrawdown,
  useFearGreed,
  useFlippening,
  useRealRates,
  useHashRate,
} from './useQuantData';

type Tone = 'emerald' | 'cyan' | 'amber' | 'orange' | 'rose' | 'violet' | 'surface';

const TONE_CLASS: Record<Tone, { text: string; bg: string; border: string }> = {
  emerald: { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
  cyan: { text: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/30' },
  amber: { text: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30' },
  orange: { text: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/30' },
  rose: { text: 'text-rose-400', bg: 'bg-rose-500/10', border: 'border-rose-500/30' },
  violet: { text: 'text-violet-400', bg: 'bg-violet-500/10', border: 'border-violet-500/30' },
  surface: { text: 'text-surface-950', bg: 'bg-surface-100/30', border: 'border-border/40' },
};

function MetricCard({
  label,
  value,
  detail,
  tone = 'surface',
  icon: Icon,
  loading,
  onClick,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: Tone;
  icon: LucideIcon;
  loading?: boolean;
  onClick?: () => void;
}) {
  const t = TONE_CLASS[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`p-3 rounded-xl border text-left transition-all hover:scale-[1.01] hover:shadow-sm ${t.border} ${t.bg}`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[10px] text-surface-700 uppercase tracking-wider font-medium">
          {label}
        </div>
        <Icon className={`w-3.5 h-3.5 ${t.text} opacity-60`} />
      </div>
      {loading ? (
        <div className="h-6 rounded bg-surface-200/20 animate-pulse" />
      ) : (
        <>
          <div className={`text-[16px] font-bold leading-tight ${t.text}`}>{value}</div>
          {detail && (
            <div className="text-[10px] text-surface-700 mt-0.5 leading-tight">{detail}</div>
          )}
        </>
      )}
    </button>
  );
}

/** Single-page snapshot of every key quant signal. Each card reads from an
 *  existing hook (so data is shared with the detailed charts) and clicking a
 *  card jumps to that chart's category tab. */
export function OverviewPanel({
  onJumpTo,
}: {
  onJumpTo: (cat: 'crypto' | 'macro' | 'tradfi') => void;
}) {
  const btc = useBtcLogRegression();
  const dom = useBtcDominance();
  const deriv = useBtcDerivatives();
  const alts = useAltcoinSeason();
  const yc = useYieldCurve();
  const macro = useMacroDashboard();
  const shiller = useShillerValuation();
  const sectors = useSectorRotation();
  const cycle = usePresidentialCycle();
  const midterm = useMidtermDrawdowns();
  const sp500Risk = useSP500RiskMetric();
  const businessCycle = useBusinessCycle();
  const inflation = useInflationDashboard();
  const finConditions = useFinancialConditions();
  const btcDd = useBtcDrawdown();
  const fg = useFearGreed();
  const flip = useFlippening();
  const realRates = useRealRates();
  const hashRate = useHashRate();

  // Helper to pick BTC risk tone
  const btcRisk = btc.data?.risk.latest.metric;
  const btcRiskTone: Tone = !btcRisk
    ? 'surface'
    : btcRisk < 0.3
      ? 'emerald'
      : btcRisk < 0.5
        ? 'cyan'
        : btcRisk < 0.7
          ? 'amber'
          : btcRisk < 0.85
            ? 'orange'
            : 'rose';

  const fundingTone: Tone = !deriv.data
    ? 'surface'
    : deriv.data.currentFundingRate < 0
      ? 'emerald'
      : deriv.data.currentFundingRate < 0.0003
        ? 'cyan'
        : 'amber';

  const altSeasonTone: Tone = !alts.data
    ? 'surface'
    : alts.data.regime === 'bitcoin-season'
      ? 'amber'
      : alts.data.regime === 'altcoin-season'
        ? 'rose'
        : 'cyan';

  const ycTone: Tone = !yc.data
    ? 'surface'
    : yc.data.latest.regime === 'normal' || yc.data.latest.regime === 'steepening'
      ? 'emerald'
      : yc.data.latest.regime === 'flattening'
        ? 'amber'
        : 'rose';

  const capeTone: Tone = !shiller.data?.capePercentile
    ? 'surface'
    : shiller.data.capePercentile < 40
      ? 'emerald'
      : shiller.data.capePercentile < 70
        ? 'cyan'
        : shiller.data.capePercentile < 90
          ? 'amber'
          : 'rose';

  const sp500RiskVal = sp500Risk.data?.latest.metric;
  const sp500RiskTone: Tone = !sp500RiskVal
    ? 'surface'
    : sp500RiskVal < 0.3
      ? 'emerald'
      : sp500RiskVal < 0.5
        ? 'cyan'
        : sp500RiskVal < 0.7
          ? 'amber'
          : 'rose';

  const topSector = sectors.data
    ? [...sectors.data.sectors]
        .filter((s) => s.rsRatio != null)
        .sort((a, b) => (b.rsRatio ?? 0) - (a.rsRatio ?? 0))[0]
    : null;

  const liveMidterm = midterm.data?.curves.find((c) => c.isCurrent);
  const liveMidtermDd = liveMidterm?.points.length
    ? liveMidterm.points[liveMidterm.points.length - 1].drawdown * 100
    : null;

  // Find Fed Funds + Core CPI in the macro dashboard
  const ff = macro.data?.series.find((s) => s.id === 'DFF');
  const cpi = macro.data?.series.find((s) => s.id === 'CPILFESL');
  const m2 = macro.data?.series.find((s) => s.id === 'M2SL');

  // Business cycle pulls
  const sahm = businessCycle.data?.series.find((s) => s.id === 'SAHMREALTIME');
  const recProb = businessCycle.data?.series.find((s) => s.id === 'RECPROUSM156N');

  // Financial conditions — NFCI is the composite
  const nfci = finConditions.data?.series.find((s) => s.id === 'NFCI');

  // Inflation → headline CPI YoY
  const headlineCpi = inflation.data?.series.find((s) => s.id === 'CPIAUCSL');
  const walcl = inflation.data?.series.find((s) => s.id === 'WALCL');

  // Fear & Greed tone
  const fgVal = fg.data?.latest.value;
  const fgTone: Tone = !fgVal
    ? 'surface'
    : fgVal < 25
      ? 'emerald' // extreme fear = buy signal
      : fgVal < 45
        ? 'cyan'
        : fgVal < 55
          ? 'amber'
          : fgVal < 75
            ? 'orange'
            : 'rose';

  // BTC drawdown tone
  const bDd = btcDd.data?.latest.drawdown;
  const btcDdTone: Tone =
    bDd == null
      ? 'surface'
      : bDd <= -0.5
        ? 'rose'
        : bDd <= -0.2
          ? 'orange'
          : bDd <= -0.05
            ? 'amber'
            : 'emerald';

  // Sahm Rule tone (> 0.5 = recession trigger)
  const sahmVal = sahm?.latest?.value;
  const sahmTone: Tone =
    sahmVal == null
      ? 'surface'
      : sahmVal >= 0.5
        ? 'rose'
        : sahmVal >= 0.3
          ? 'orange'
          : sahmVal >= 0.1
            ? 'amber'
            : 'emerald';

  // Recession probability tone
  const recVal = recProb?.latest?.value;
  const recTone: Tone =
    recVal == null
      ? 'surface'
      : recVal >= 0.7
        ? 'rose'
        : recVal >= 0.4
          ? 'orange'
          : recVal >= 0.2
            ? 'amber'
            : 'emerald';

  // 10Y real rate tone (rising = restrictive)
  const real10 = realRates.data?.latest.tenYear.real;
  const real10Tone: Tone =
    real10 == null
      ? 'surface'
      : real10 >= 2
        ? 'rose'
        : real10 >= 1
          ? 'orange'
          : real10 >= 0
            ? 'amber'
            : 'emerald';

  // NFCI tone
  const nfciVal = nfci?.latest?.value;
  const nfciTone: Tone =
    nfciVal == null ? 'surface' : nfciVal >= 0.5 ? 'rose' : nfciVal >= 0 ? 'amber' : 'emerald';

  // Hash rate regime tone
  const hashRegime = hashRate.data?.latest.regime;
  const hashTone: Tone =
    hashRegime === 'bullish' ? 'emerald' : hashRegime === 'bearish' ? 'rose' : 'surface';

  return (
    <div className="space-y-6">
      <Card variant="glass" className="p-6">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-surface-950">Market snapshot</h3>
          <p className="text-[13px] text-surface-800 mt-1">
            Every signal in one view. Click any card to jump to the detailed chart.
          </p>
        </div>

        {/* ── Crypto row ───────────────────────────── */}
        <div className="mb-4">
          <div className="text-[11px] font-semibold text-amber-400 uppercase tracking-[0.15em] mb-2">
            Crypto
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            <MetricCard
              label="BTC Price"
              value={
                btc.data
                  ? `$${btc.data.latest.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                  : '—'
              }
              detail={
                btc.data
                  ? `${btc.data.latest.residualSigma >= 0 ? '+' : ''}${btc.data.latest.residualSigma.toFixed(2)}σ vs trend`
                  : undefined
              }
              tone="amber"
              icon={Activity}
              loading={btc.loading}
              onClick={() => onJumpTo('crypto')}
            />
            <MetricCard
              label="BTC Risk Metric"
              value={btcRisk != null ? btcRisk.toFixed(3) : '—'}
              detail={
                btcRisk != null
                  ? btcRisk < 0.15
                    ? 'Deep Value'
                    : btcRisk < 0.3
                      ? 'Accumulation'
                      : btcRisk < 0.45
                        ? 'Below Fair'
                        : btcRisk < 0.55
                          ? 'Fair Value'
                          : btcRisk < 0.7
                            ? 'Above Fair'
                            : btcRisk < 0.85
                              ? 'Overheated'
                              : 'Euphoria'
                  : undefined
              }
              tone={btcRiskTone}
              icon={Gauge}
              loading={btc.loading}
              onClick={() => onJumpTo('crypto')}
            />
            <MetricCard
              label="BMSB State"
              value={
                btc.data
                  ? btc.data.bmsb.latest.state === 'above'
                    ? 'Above'
                    : btc.data.bmsb.latest.state === 'inside'
                      ? 'Inside'
                      : btc.data.bmsb.latest.state === 'below'
                        ? 'Below'
                        : '—'
                  : '—'
              }
              detail={
                btc.data?.bmsb.latest.sma20w != null
                  ? `20W SMA $${btc.data.bmsb.latest.sma20w.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                  : undefined
              }
              tone={
                btc.data?.bmsb.latest.state === 'above'
                  ? 'emerald'
                  : btc.data?.bmsb.latest.state === 'below'
                    ? 'rose'
                    : 'amber'
              }
              icon={Shield}
              loading={btc.loading}
              onClick={() => onJumpTo('crypto')}
            />
            <MetricCard
              label="Pi Cycle"
              value={btc.data?.piCycle.latest.signalActive ? 'TOP ACTIVE' : 'Inactive'}
              detail={
                btc.data?.piCycle.latest.ratio != null
                  ? `Ratio ${btc.data.piCycle.latest.ratio.toFixed(2)}`
                  : undefined
              }
              tone={btc.data?.piCycle.latest.signalActive ? 'rose' : 'emerald'}
              icon={Target}
              loading={btc.loading}
              onClick={() => onJumpTo('crypto')}
            />
            <MetricCard
              label="BTC Dominance"
              value={dom.data ? `${dom.data.btcDominance.toFixed(1)}%` : '—'}
              detail={
                dom.data
                  ? `${dom.data.btcDominance >= 60 ? 'BTC-led' : 'Alt-rotating'} · SSR ${dom.data.ssr.toFixed(1)}×`
                  : undefined
              }
              tone={dom.data && dom.data.btcDominance >= 60 ? 'amber' : 'rose'}
              icon={PieChartIcon}
              loading={dom.loading}
              onClick={() => onJumpTo('crypto')}
            />
            <MetricCard
              label="Funding Rate"
              value={
                deriv.data
                  ? `${deriv.data.currentFundingRate >= 0 ? '+' : ''}${(deriv.data.currentFundingRate * 100).toFixed(3)}%`
                  : '—'
              }
              detail={
                deriv.data
                  ? `${deriv.data.annualizedFundingRate >= 0 ? '+' : ''}${(deriv.data.annualizedFundingRate * 100).toFixed(1)}% annualized`
                  : undefined
              }
              tone={fundingTone}
              icon={Zap}
              loading={deriv.loading}
              onClick={() => onJumpTo('crypto')}
            />
            <MetricCard
              label="Altcoin Season"
              value={alts.data ? alts.data.indexValue.toFixed(0) : '—'}
              detail={
                alts.data
                  ? alts.data.regime === 'bitcoin-season'
                    ? 'Bitcoin Season'
                    : alts.data.regime === 'altcoin-season'
                      ? 'Altcoin Season'
                      : 'Neutral'
                  : undefined
              }
              tone={altSeasonTone}
              icon={Sparkles}
              loading={alts.loading}
              onClick={() => onJumpTo('crypto')}
            />
            <MetricCard
              label="L/S Ratio"
              value={
                deriv.data?.currentLongShortRatio != null
                  ? deriv.data.currentLongShortRatio.toFixed(2)
                  : '—'
              }
              detail="1.0 = balanced"
              tone={
                deriv.data?.currentLongShortRatio != null && deriv.data.currentLongShortRatio >= 1
                  ? 'emerald'
                  : 'rose'
              }
              icon={Zap}
              loading={deriv.loading}
              onClick={() => onJumpTo('crypto')}
            />
            <MetricCard
              label="BTC Drawdown"
              value={bDd != null ? `${(bDd * 100).toFixed(1)}%` : '—'}
              detail={
                btcDd.data
                  ? `${btcDd.data.latest.daysSinceAth}d since ATH $${(btcDd.data.latest.ath / 1000).toFixed(0)}k`
                  : undefined
              }
              tone={btcDdTone}
              icon={TrendingDown}
              loading={btcDd.loading}
              onClick={() => onJumpTo('crypto')}
            />
            <MetricCard
              label="Fear & Greed"
              value={fgVal != null ? String(fgVal) : '—'}
              detail={fg.data?.latest.classification}
              tone={fgTone}
              icon={Gauge}
              loading={fg.loading}
              onClick={() => onJumpTo('crypto')}
            />
            <MetricCard
              label="Flippening"
              value={
                flip.data ? `${(flip.data.latest.progressToFlippening * 100).toFixed(1)}%` : '—'
              }
              detail={flip.data ? `ETH/BTC ${flip.data.latest.ratio.toFixed(5)}` : undefined}
              tone="violet"
              icon={Repeat}
              loading={flip.loading}
              onClick={() => onJumpTo('crypto')}
            />
            <MetricCard
              label="Hash Ribbons"
              value={
                hashRegime === 'bullish'
                  ? 'Expanding'
                  : hashRegime === 'bearish'
                    ? 'Capitulating'
                    : '—'
              }
              detail={
                hashRate.data
                  ? `${(hashRate.data.latest.hashRate / 1_000_000).toFixed(0)} EH/s`
                  : undefined
              }
              tone={hashTone}
              icon={Cpu}
              loading={hashRate.loading}
              onClick={() => onJumpTo('crypto')}
            />
          </div>
        </div>

        {/* ── Macro row ───────────────────────────── */}
        <div className="mb-4">
          <div className="text-[11px] font-semibold text-cyan-400 uppercase tracking-[0.15em] mb-2">
            Macro
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            <MetricCard
              label="Yield Curve (10Y-2Y)"
              value={
                yc.data?.latest.t10y2y != null
                  ? `${yc.data.latest.t10y2y >= 0 ? '+' : ''}${yc.data.latest.t10y2y.toFixed(2)}%`
                  : '—'
              }
              detail={
                yc.data
                  ? `${yc.data.latest.regime}${yc.data.inversionStreak != null ? ` · ${Math.abs(yc.data.inversionStreak)}d` : ''}`
                  : undefined
              }
              tone={ycTone}
              icon={TrendingUp}
              loading={yc.loading}
              onClick={() => onJumpTo('macro')}
            />
            <MetricCard
              label="Fed Funds Rate"
              value={ff?.latest ? `${ff.latest.value.toFixed(2)}%` : '—'}
              detail={
                ff?.yoyChange != null
                  ? `${ff.yoyChange >= 0 ? '+' : ''}${ff.yoyChange.toFixed(1)}% YoY`
                  : undefined
              }
              tone={ff?.yoyChange != null && ff.yoyChange < 0 ? 'emerald' : 'amber'}
              icon={Landmark}
              loading={macro.loading}
              onClick={() => onJumpTo('macro')}
            />
            <MetricCard
              label="Core CPI YoY"
              value={cpi?.yoyChange != null ? `${cpi.yoyChange.toFixed(2)}%` : '—'}
              detail="Inflation ex food/energy"
              tone={
                cpi?.yoyChange != null && cpi.yoyChange < 2.5
                  ? 'emerald'
                  : cpi?.yoyChange != null && cpi.yoyChange < 4
                    ? 'cyan'
                    : 'amber'
              }
              icon={Landmark}
              loading={macro.loading}
              onClick={() => onJumpTo('macro')}
            />
            <MetricCard
              label="M2 Money Supply"
              value={m2?.latest ? `$${(m2.latest.value / 1000).toFixed(2)}T` : '—'}
              detail={
                m2?.yoyChange != null
                  ? `${m2.yoyChange >= 0 ? '+' : ''}${m2.yoyChange.toFixed(2)}% YoY`
                  : undefined
              }
              tone={m2?.yoyChange != null && m2.yoyChange > 3 ? 'emerald' : 'cyan'}
              icon={Landmark}
              loading={macro.loading}
              onClick={() => onJumpTo('macro')}
            />
            <MetricCard
              label="Sahm Rule"
              value={sahmVal != null ? sahmVal.toFixed(2) : '—'}
              detail={
                sahmVal != null
                  ? sahmVal >= 0.5
                    ? 'Recession signal'
                    : sahmVal >= 0.3
                      ? 'Warning'
                      : sahmVal >= 0.1
                        ? 'Elevated'
                        : 'Calm'
                  : undefined
              }
              tone={sahmTone}
              icon={AlertTriangle}
              loading={businessCycle.loading}
              onClick={() => onJumpTo('macro')}
            />
            <MetricCard
              label="Recession Prob"
              value={recVal != null ? `${(recVal * 100).toFixed(0)}%` : '—'}
              detail="Chauvet-Piger 12mo"
              tone={recTone}
              icon={AlertTriangle}
              loading={businessCycle.loading}
              onClick={() => onJumpTo('macro')}
            />
            <MetricCard
              label="10Y Real Rate"
              value={real10 != null ? `${real10.toFixed(2)}%` : '—'}
              detail={
                real10 != null
                  ? real10 >= 2
                    ? 'Restrictive'
                    : real10 >= 1
                      ? 'Tight'
                      : real10 >= 0
                        ? 'Neutral'
                        : 'Accommodative'
                  : undefined
              }
              tone={real10Tone}
              icon={Percent}
              loading={realRates.loading}
              onClick={() => onJumpTo('macro')}
            />
            <MetricCard
              label="NFCI"
              value={nfciVal != null ? nfciVal.toFixed(2) : '—'}
              detail={
                nfciVal != null
                  ? nfciVal >= 0.5
                    ? 'Stressed'
                    : nfciVal >= 0
                      ? 'Tight'
                      : 'Loose'
                  : undefined
              }
              tone={nfciTone}
              icon={ShieldAlert}
              loading={finConditions.loading}
              onClick={() => onJumpTo('macro')}
            />
            <MetricCard
              label="Headline CPI YoY"
              value={headlineCpi?.yoyChange != null ? `${headlineCpi.yoyChange.toFixed(2)}%` : '—'}
              detail="All urban consumers"
              tone={
                headlineCpi?.yoyChange != null && headlineCpi.yoyChange < 2.5
                  ? 'emerald'
                  : headlineCpi?.yoyChange != null && headlineCpi.yoyChange < 4
                    ? 'cyan'
                    : 'amber'
              }
              icon={Flame}
              loading={inflation.loading}
              onClick={() => onJumpTo('macro')}
            />
            <MetricCard
              label="Fed Balance Sheet"
              value={walcl?.latest ? `$${(walcl.latest.value / 1_000_000).toFixed(2)}T` : '—'}
              detail={
                walcl?.yoyChange != null
                  ? `${walcl.yoyChange >= 0 ? '+' : ''}${walcl.yoyChange.toFixed(2)}% YoY`
                  : undefined
              }
              tone={walcl?.yoyChange != null && walcl.yoyChange >= 0 ? 'emerald' : 'amber'}
              icon={Landmark}
              loading={inflation.loading}
              onClick={() => onJumpTo('macro')}
            />
          </div>
        </div>

        {/* ── TradFi row ───────────────────────────── */}
        <div>
          <div className="text-[11px] font-semibold text-emerald-400 uppercase tracking-[0.15em] mb-2">
            TradFi
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            <MetricCard
              label="SP500 Risk Metric"
              value={sp500RiskVal != null ? sp500RiskVal.toFixed(3) : '—'}
              detail={sp500Risk.data ? `Date ${sp500Risk.data.latest.date}` : undefined}
              tone={sp500RiskTone}
              icon={Gauge}
              loading={sp500Risk.loading}
              onClick={() => onJumpTo('tradfi')}
            />
            <MetricCard
              label="Shiller CAPE"
              value={shiller.data?.latest.cape != null ? shiller.data.latest.cape.toFixed(1) : '—'}
              detail={
                shiller.data?.capePercentile != null
                  ? `${shiller.data.capePercentile.toFixed(0)}th percentile (155yr)`
                  : undefined
              }
              tone={capeTone}
              icon={Scale}
              loading={shiller.loading}
              onClick={() => onJumpTo('tradfi')}
            />
            <MetricCard
              label="Presidential Cycle"
              value={cycle.data ? `Y${cycle.data.currentYearOfCycle}` : '—'}
              detail={
                cycle.data
                  ? cycle.data.currentYearOfCycle === 1
                    ? 'Post-election'
                    : cycle.data.currentYearOfCycle === 2
                      ? 'Midterm (weakest)'
                      : cycle.data.currentYearOfCycle === 3
                        ? 'Pre-election (strongest)'
                        : 'Election year'
                  : undefined
              }
              tone="cyan"
              icon={CalendarRange}
              loading={cycle.loading}
              onClick={() => onJumpTo('tradfi')}
            />
            <MetricCard
              label="Top Sector"
              value={topSector?.ticker ?? '—'}
              detail={
                topSector
                  ? `${topSector.name} · RS ${topSector.rsRatio?.toFixed(1) ?? '—'}`
                  : undefined
              }
              tone="emerald"
              icon={Layers}
              loading={sectors.loading}
              onClick={() => onJumpTo('tradfi')}
            />
            <MetricCard
              label="Midterm Drawdown"
              value={liveMidtermDd != null ? `${liveMidtermDd.toFixed(2)}%` : '—'}
              detail="2026 vs prior-peak · live"
              tone={
                liveMidtermDd != null && liveMidtermDd > -5
                  ? 'emerald'
                  : liveMidtermDd != null && liveMidtermDd > -15
                    ? 'cyan'
                    : 'rose'
              }
              icon={TrendingDown}
              loading={midterm.loading}
              onClick={() => onJumpTo('tradfi')}
            />
            <MetricCard
              label="SPX YTD (SPY)"
              value={
                sectors.data?.benchmark.returns.ytd != null
                  ? `${sectors.data.benchmark.returns.ytd >= 0 ? '+' : ''}${sectors.data.benchmark.returns.ytd.toFixed(2)}%`
                  : '—'
              }
              detail={sectors.data ? `SPY $${sectors.data.benchmark.price.toFixed(2)}` : undefined}
              tone={
                sectors.data?.benchmark.returns.ytd != null &&
                sectors.data.benchmark.returns.ytd >= 0
                  ? 'emerald'
                  : 'rose'
              }
              icon={TrendingUp}
              loading={sectors.loading}
              onClick={() => onJumpTo('tradfi')}
            />
          </div>
        </div>
      </Card>
    </div>
  );
}
