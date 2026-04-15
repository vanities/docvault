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

export interface BtcDominanceData {
  btcDominance: number;
  ethDominance: number;
  stableDominance: number;
  flightToSafety: number;
  totalMarketCapUsd: number;
  totalMarketCapChange24h: number;
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
  dataRange: { from: string; to: string };
  source: 'fred';
  cached?: boolean;
  stale?: boolean;
  fetchedAt?: number;
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

export function useMacroDashboard() {
  const bump = useQuantRefreshBump();
  return useQuantFetch<MacroDashboardData>(`${API_BASE}/quant/macro/dashboard?_=${bump}`);
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
