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
