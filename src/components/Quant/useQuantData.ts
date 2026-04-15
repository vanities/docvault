import { useCallback, useEffect, useState } from 'react';
import { API_BASE } from '../../constants';

export interface PresidentialCycleData {
  matrix: number[][];
  counts: number[][];
  currentYear: number;
  currentYearOfCycle: number;
  dataRange: { from: string; to: string };
  yearLabels: string[];
  monthLabels: string[];
  source: 'shiller' | 'yahoo-fallback';
  cached?: boolean;
  stale?: boolean;
  fetchedAt?: number;
  fetchError?: string;
}

export interface AltCoinEntryData {
  symbol: string;
  name: string;
  price: number;
  return90d: number;
  outperformance: number;
  beatsBtc: boolean;
}

export interface AltcoinSeasonData {
  indexValue: number;
  regime: 'bitcoin-season' | 'neutral' | 'altcoin-season';
  btcReturn90d: number;
  coins: AltCoinEntryData[];
  outperformerCount: number;
  totalCounted: number;
  skipped: string[];
  fetchedAt: number;
  source: 'yahoo';
  cached?: boolean;
  stale?: boolean;
}

export interface BtcDerivativesData {
  currentFundingRate: number;
  annualizedFundingRate: number;
  currentOpenInterestUsd: number;
  currentLongShortRatio: number | null;
  fundingHistory: { t: number; rate: number }[];
  openInterestHistory: { t: number; oiUsd: number }[];
  longShortHistory: { t: number; ratio: number }[];
  fetchedAt: number;
  source: 'okx';
  cached?: boolean;
  stale?: boolean;
}

export interface BtcDominanceData {
  btcDominance: number;
  ethDominance: number;
  stableDominance: number;
  flightToSafety: number;
  totalMarketCapUsd: number;
  totalMarketCapChange24h: number;
  ssr: number;
  fetchedAt: number;
  source: 'coingecko';
  cached?: boolean;
  stale?: boolean;
}

export interface MacroSeriesData {
  id: string;
  label: string;
  description: string;
  unit: string;
  decimals: number;
  points: { t: number; value: number }[];
  latest: { date: string; value: number } | null;
  yoyChange: number | null;
}

export interface MacroDashboardData {
  series: MacroSeriesData[];
  fetchedAt: number;
  source: 'fred';
  cached?: boolean;
  stale?: boolean;
}

export interface YieldCurvePoint {
  date: string;
  t: number;
  t10y2y: number | null;
  t10y3m: number | null;
}

export interface YieldCurveData {
  points: YieldCurvePoint[];
  latest: {
    date: string;
    t10y2y: number | null;
    t10y3m: number | null;
    regime: 'deeply-inverted' | 'inverted' | 'flattening' | 'normal' | 'steepening';
  };
  inversionStreak: number;
  lastInversionStart: string | null;
  recessions: { start: number; end: number }[];
  dataRange: { from: string; to: string };
  source: 'fred';
  cached?: boolean;
  stale?: boolean;
  fetchedAt?: number;
}

export interface SP500RiskData {
  points: { date: string; t: number; price: number }[];
  metric: (number | null)[];
  components: {
    mayerLike12m: (number | null)[];
    sma24mDistance: (number | null)[];
    regressionSigma: (number | null)[];
    rsi14m: (number | null)[];
    drawdownFromAth: (number | null)[];
  };
  normalized: {
    mayerLike12m: (number | null)[];
    sma24mDistance: (number | null)[];
    regressionSigma: (number | null)[];
    rsi14m: (number | null)[];
    drawdownFromAth: (number | null)[];
  };
  latest: {
    date: string;
    price: number;
    metric: number | null;
    components: {
      mayerLike12m: number | null;
      sma24mDistance: number | null;
      regressionSigma: number | null;
      rsi14m: number | null;
      drawdownFromAth: number | null;
    };
    normalized: {
      mayerLike12m: number | null;
      sma24mDistance: number | null;
      regressionSigma: number | null;
      rsi14m: number | null;
      drawdownFromAth: number | null;
    };
  };
  dataRange: { from: string; to: string };
  source: 'shiller';
  cached?: boolean;
  stale?: boolean;
}

export interface MidtermCurvePoint {
  offsetMonths: number;
  drawdown: number;
}

export interface MidtermCurveData {
  midtermYear: number;
  label: string;
  isCurrent: boolean;
  points: MidtermCurvePoint[];
  peakClose: number;
  peakDate: string;
}

export interface MidtermDrawdownData {
  curves: MidtermCurveData[];
  averageCurve: MidtermCurvePoint[];
  dataRange: { from: string; to: string };
  source: 'shiller';
  cached?: boolean;
  stale?: boolean;
}

export interface ShillerValuationPoint {
  date: string;
  t: number;
  sp500: number;
  cape: number | null;
  divYield: number | null;
}

export interface ShillerValuationData {
  points: ShillerValuationPoint[];
  latest: {
    date: string;
    sp500: number;
    cape: number | null;
    divYield: number | null;
  };
  medians: {
    cape: number;
    divYield: number;
  };
  capePercentile: number | null;
  dataRange: { from: string; to: string };
  source: 'shiller';
  cached?: boolean;
  stale?: boolean;
  fetchedAt?: number;
}

export interface SectorReturnData {
  ticker: string;
  name: string;
  price: number;
  returns: {
    d1: number | null;
    w1: number | null;
    m1: number | null;
    m3: number | null;
    m6: number | null;
    ytd: number | null;
  };
  rsRatio: number | null;
  momentum: number | null;
  quadrant: 'leading' | 'improving' | 'weakening' | 'lagging' | 'unknown';
}

export interface SectorRotationData {
  benchmark: SectorReturnData;
  sectors: SectorReturnData[];
  dataRange: { from: string; to: string };
  source: 'yahoo';
  cached?: boolean;
  stale?: boolean;
  fetchedAt?: number;
  fetchError?: string;
}

export interface BtcLogRegressionData {
  prices: { t: number; price: number }[];
  fit: {
    line: number[];
    upper1: number[];
    lower1: number[];
    upper2: number[];
    lower2: number[];
  };
  slope: number;
  intercept: number;
  stdev: number;
  latest: {
    price: number;
    fitted: number;
    residualSigma: number;
  };
  movingAverages: {
    sma50d: (number | null)[];
    sma200d: (number | null)[];
    sma200w: (number | null)[];
    mayerBandMultipliers: number[];
    latest: {
      sma50d: number | null;
      sma200d: number | null;
      sma200w: number | null;
      priceVs200w: number | null;
    };
  };
  goldenDeathCrosses: {
    events: { t: number; type: 'golden' | 'death' }[];
    currentRegime: 'bullish' | 'bearish' | 'unknown';
    latestEvent: { t: number; type: 'golden' | 'death' } | null;
  };
  corridor: {
    sma20w: (number | null)[];
    multipliers: number[];
    latest: {
      sma20w: number | null;
      currentMultiple: number | null;
    };
  };
  bmsb: {
    sma20w: (number | null)[];
    ema21w: (number | null)[];
    latest: {
      sma20w: number | null;
      ema21w: number | null;
      state: 'above' | 'inside' | 'below' | 'unknown';
    };
  };
  piCycle: {
    sma111d: (number | null)[];
    sma350dDouble: (number | null)[];
    signal: (boolean | null)[];
    latest: {
      sma111d: number | null;
      sma350dDouble: number | null;
      ratio: number | null;
      signalActive: boolean;
    };
  };
  risk: {
    metric: (number | null)[];
    components: {
      mayerMultiple: (number | null)[];
      sma20wDistance: (number | null)[];
      regressionSigma: (number | null)[];
      rsi14: (number | null)[];
      drawdownFromAth: (number | null)[];
    };
    normalized: {
      mayerMultiple: (number | null)[];
      sma20wDistance: (number | null)[];
      regressionSigma: (number | null)[];
      rsi14: (number | null)[];
      drawdownFromAth: (number | null)[];
    };
    latest: {
      metric: number | null;
      components: {
        mayerMultiple: number | null;
        sma20wDistance: number | null;
        regressionSigma: number | null;
        rsi14: number | null;
        drawdownFromAth: number | null;
      };
      normalized: {
        mayerMultiple: number | null;
        sma20wDistance: number | null;
        regressionSigma: number | null;
        rsi14: number | null;
        drawdownFromAth: number | null;
      };
    };
  };
  cached?: boolean;
  stale?: boolean;
  fetchedAt?: number;
  fetchError?: string;
}

interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

function useQuantFetch<T>(url: string): FetchState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(url)
      .then(async (res) => {
        const json = (await res.json()) as T & { error?: string };
        if (cancelled) return;
        if (!res.ok || ('error' in json && json.error)) {
          setError((json as { error?: string }).error || `HTTP ${res.status}`);
          setData(null);
        } else {
          setData(json);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return { data, loading, error };
}

export interface QuantSnapshot {
  date: string;
  takenAt: number;
  btc?: {
    price: number;
    fitted: number;
    residualSigma: number;
    slope: number;
    stdev: number;
  };
  spxCycle?: {
    currentYear: number;
    currentYearOfCycle: number;
    currentExpectedReturn: number;
    currentYearAnnualAvg: number;
  };
}

export interface SnapshotsResponse {
  snapshots: QuantSnapshot[];
  totalAll: number;
  returned: number;
  days: number;
}

/** Bumping this value causes every quant hook to re-fetch. The manual refresh
 *  button calls `bumpQuantRefresh` to get live data without a page reload. */
let quantRefreshBump = 0;
const refreshListeners = new Set<() => void>();

function bumpQuantRefresh() {
  quantRefreshBump++;
  refreshListeners.forEach((fn) => fn());
}

function useQuantRefreshBump() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const listener = () => setTick((t) => t + 1);
    refreshListeners.add(listener);
    return () => {
      refreshListeners.delete(listener);
    };
  }, []);
  return quantRefreshBump;
}

export function usePresidentialCycle() {
  const bump = useQuantRefreshBump();
  return useQuantFetch<PresidentialCycleData>(`${API_BASE}/quant/cycle/presidential?_=${bump}`);
}

export function useBtcLogRegression() {
  const bump = useQuantRefreshBump();
  return useQuantFetch<BtcLogRegressionData>(`${API_BASE}/quant/btc/log-regression?_=${bump}`);
}

export function useSectorRotation() {
  const bump = useQuantRefreshBump();
  return useQuantFetch<SectorRotationData>(`${API_BASE}/quant/tradfi/sectors/rotation?_=${bump}`);
}

export function useShillerValuation() {
  const bump = useQuantRefreshBump();
  return useQuantFetch<ShillerValuationData>(
    `${API_BASE}/quant/tradfi/shiller-valuation?_=${bump}`
  );
}

export function useYieldCurve() {
  const bump = useQuantRefreshBump();
  return useQuantFetch<YieldCurveData>(`${API_BASE}/quant/macro/yield-curve?_=${bump}`);
}

export function useBtcDominance() {
  const bump = useQuantRefreshBump();
  return useQuantFetch<BtcDominanceData>(`${API_BASE}/quant/btc/dominance?_=${bump}`);
}

export function useBtcDerivatives() {
  const bump = useQuantRefreshBump();
  return useQuantFetch<BtcDerivativesData>(`${API_BASE}/quant/btc/derivatives?_=${bump}`);
}

export function useAltcoinSeason() {
  const bump = useQuantRefreshBump();
  return useQuantFetch<AltcoinSeasonData>(`${API_BASE}/quant/btc/altcoin-season?_=${bump}`);
}

export function useMacroDashboard() {
  const bump = useQuantRefreshBump();
  return useQuantFetch<MacroDashboardData>(`${API_BASE}/quant/macro/dashboard?_=${bump}`);
}

export function useJobsDashboard() {
  const bump = useQuantRefreshBump();
  return useQuantFetch<MacroDashboardData>(`${API_BASE}/quant/macro/jobs?_=${bump}`);
}

export function useBusinessCycle() {
  const bump = useQuantRefreshBump();
  return useQuantFetch<MacroDashboardData>(`${API_BASE}/quant/macro/business-cycle?_=${bump}`);
}

export function useInflationDashboard() {
  const bump = useQuantRefreshBump();
  return useQuantFetch<MacroDashboardData>(`${API_BASE}/quant/macro/inflation?_=${bump}`);
}

export function useFinancialConditions() {
  const bump = useQuantRefreshBump();
  return useQuantFetch<MacroDashboardData>(
    `${API_BASE}/quant/macro/financial-conditions?_=${bump}`
  );
}

export interface DrawdownPointData {
  t: number;
  price: number;
  ath: number;
  drawdown: number;
}

export interface DrawdownEpisodeData {
  athDate: string;
  athPrice: number;
  troughDate: string;
  troughPrice: number;
  maxDrawdown: number;
  daysToTrough: number;
  daysToRecovery: number | null;
}

export interface BtcDrawdownData {
  series: DrawdownPointData[];
  latest: {
    date: string;
    price: number;
    ath: number;
    drawdown: number;
    daysSinceAth: number;
  };
  episodes: DrawdownEpisodeData[];
  stats: {
    pctDaysInBearZone: number;
    worstDrawdown: number;
    avgBearDrawdown: number;
    avgDaysToTrough: number;
  };
  fetchedAt: number;
  source: 'yahoo';
  cached?: boolean;
  stale?: boolean;
}

export function useBtcDrawdown() {
  const bump = useQuantRefreshBump();
  return useQuantFetch<BtcDrawdownData>(`${API_BASE}/quant/btc/drawdown?_=${bump}`);
}

export interface FearGreedSampleData {
  t: number;
  value: number;
  classification: string;
}

export interface FearGreedData {
  history: FearGreedSampleData[];
  latest: FearGreedSampleData;
  ma30: number;
  ma90: number;
  highest365: FearGreedSampleData | null;
  lowest365: FearGreedSampleData | null;
  fetchedAt: number;
  source: 'alternative.me';
  cached?: boolean;
  stale?: boolean;
}

export function useFearGreed() {
  const bump = useQuantRefreshBump();
  return useQuantFetch<FearGreedData>(`${API_BASE}/quant/btc/fear-greed?_=${bump}`);
}

export interface FlippeningPointData {
  t: number;
  ethPrice: number;
  btcPrice: number;
  ratio: number;
}

export interface FlippeningData {
  series: FlippeningPointData[];
  latest: {
    date: string;
    ethPrice: number;
    btcPrice: number;
    ratio: number;
    progressToFlippening: number;
  };
  stats: {
    ratioAth: number;
    ratioAthDate: string;
    ratio90dReturn: number;
    ratio365dReturn: number;
  };
  fetchedAt: number;
  source: 'yahoo';
  cached?: boolean;
  stale?: boolean;
}

export function useFlippening() {
  const bump = useQuantRefreshBump();
  return useQuantFetch<FlippeningData>(`${API_BASE}/quant/btc/flippening?_=${bump}`);
}

export interface RealRatePointData {
  t: number;
  nominal: number;
  breakeven: number;
  real: number;
}

export interface RealRatesData {
  ten: RealRatePointData[];
  five: RealRatePointData[];
  latest: {
    date: string;
    tenYear: { nominal: number; breakeven: number; real: number };
    fiveYear: { nominal: number; breakeven: number; real: number };
  };
  stats: {
    tenYearPercentile10y: number;
    tenYearChange52w: number;
  };
  fetchedAt: number;
  source: 'fred';
  cached?: boolean;
  stale?: boolean;
}

export function useRealRates() {
  const bump = useQuantRefreshBump();
  return useQuantFetch<RealRatesData>(`${API_BASE}/quant/macro/real-rates?_=${bump}`);
}

export interface HashRatePointData {
  t: number;
  hashRate: number;
  sma30: number | null;
  sma60: number | null;
}

export interface HashRibbonEventData {
  t: number;
  date: string;
  type: 'capitulation' | 'recovery';
}

export interface HashRateData {
  series: HashRatePointData[];
  events: HashRibbonEventData[];
  latest: {
    date: string;
    hashRate: number;
    sma30: number | null;
    sma60: number | null;
    regime: 'bullish' | 'bearish' | 'unknown';
    daysSinceRecovery: number | null;
  };
  fetchedAt: number;
  source: 'blockchain.info';
  cached?: boolean;
  stale?: boolean;
}

export function useHashRate() {
  const bump = useQuantRefreshBump();
  return useQuantFetch<HashRateData>(`${API_BASE}/quant/btc/hash-rate?_=${bump}`);
}

export interface FedRateChange {
  t: number;
  newRate: number;
  changeBps: number;
  type: 'hike' | 'cut';
}

export interface FedPolicyData {
  effectiveRate: { t: number; rate: number }[];
  targetUpper: { t: number; rate: number }[];
  targetLower: { t: number; rate: number }[];
  rateChanges: FedRateChange[];
  latest: {
    date: string;
    effectiveRate: number;
    targetUpper: number;
    targetLower: number;
    stance: 'cutting' | 'hiking' | 'hold';
    daysSinceLastChange: number;
  };
  dataRange: { from: string; to: string };
  source: 'fred';
  cached?: boolean;
  stale?: boolean;
}

export function useFedPolicy() {
  const bump = useQuantRefreshBump();
  return useQuantFetch<FedPolicyData>(`${API_BASE}/quant/macro/fed-policy?_=${bump}`);
}

export function useMidtermDrawdowns() {
  const bump = useQuantRefreshBump();
  return useQuantFetch<MidtermDrawdownData>(`${API_BASE}/quant/tradfi/midterm-drawdowns?_=${bump}`);
}

export function useSP500RiskMetric() {
  const bump = useQuantRefreshBump();
  return useQuantFetch<SP500RiskData>(`${API_BASE}/quant/tradfi/sp500-risk-metric?_=${bump}`);
}

export function useQuantSnapshots(days = 365) {
  const bump = useQuantRefreshBump();
  return useQuantFetch<SnapshotsResponse>(`${API_BASE}/quant/snapshots?days=${days}&_=${bump}`);
}

/** Fire a manual refresh — POSTs to the server, then triggers a cache-busted
 *  re-fetch on every hook mounted anywhere in the tree. */
export function useQuantRefresh() {
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/quant/refresh`, { method: 'POST' });
      const json = (await res.json()) as {
        ok?: boolean;
        errors?: string[];
        refreshedAt?: number;
      };
      if (!res.ok || !json.ok) {
        setError(json.errors?.join('; ') || `HTTP ${res.status}`);
      } else {
        setLastRefresh(json.refreshedAt ?? Date.now());
        bumpQuantRefresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }, []);

  return { refresh, refreshing, lastRefresh, error };
}
