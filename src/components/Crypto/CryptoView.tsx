import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw,
  Wallet,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  Bitcoin,
  Clock,
  ChevronDown,
  ChevronUp,
  BarChart3,
} from 'lucide-react';
import type {
  CryptoPortfolio,
  CryptoSourceBalance,
  CryptoBalance,
  CryptoGainsSummary,
} from '../../types';
import type { PortfolioSnapshot } from '../../types';
import { API_BASE } from '../../constants';
import { HistoryChart } from '../common/HistoryChart';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAppContext } from '../../contexts/AppContext';

const TOP_N = 5;

function timeAgo(isoStr: string): string {
  const diffSec = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return new Date(isoStr).toLocaleDateString();
}

function formatUsd(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  });
}

function formatAmount(amount: number, asset: string): string {
  const decimals = ['BTC', 'ETH'].includes(asset) ? 6 : 2;
  return amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals,
  });
}

// Color palette for allocation bars
const ASSET_COLORS = [
  'bg-amber-500',
  'bg-accent-500',
  'bg-emerald-500',
  'bg-violet-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-orange-500',
  'bg-indigo-500',
  'bg-lime-500',
  'bg-pink-500',
];

const ASSET_TEXT_COLORS = [
  'text-amber-500',
  'text-accent-500',
  'text-emerald-500',
  'text-violet-500',
  'text-rose-500',
  'text-cyan-500',
  'text-orange-500',
  'text-indigo-500',
  'text-lime-500',
  'text-pink-500',
];

const DEAD_TOKENS = new Set(['MIR', 'RAD', 'SOS', 'AIDOGE', 'DOS', 'ICE', 'POLY']);

function SourceCard({
  source,
  onRefresh,
}: {
  source: CryptoSourceBalance;
  onRefresh: (sourceId: string) => void;
}) {
  const isExchange = source.sourceType === 'exchange';
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const sortedBalances = [...source.balances].sort((a, b) => (b.usdValue || 0) - (a.usdValue || 0));
  const visibleBalances = expanded ? sortedBalances : sortedBalances.slice(0, TOP_N);
  const hasMore = sortedBalances.length > TOP_N;

  const handleRefresh = () => {
    setRefreshing(true);
    void Promise.resolve(onRefresh(source.sourceId)).finally(() => setRefreshing(false));
  };

  return (
    <Card variant="glass" className="overflow-hidden">
      {/* Header */}
      <div className="p-5 pb-3">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2.5">
            <div
              className={`p-2 rounded-lg ${isExchange ? 'bg-accent-500/10' : 'bg-amber-500/10'}`}
            >
              {isExchange ? (
                <TrendingUp className="w-4 h-4 text-accent-400" />
              ) : (
                <Wallet className="w-4 h-4 text-amber-500" />
              )}
            </div>
            <div>
              <p className="font-semibold text-surface-950 text-[14px]">{source.label}</p>
              <p className="text-[11px] text-surface-600">{isExchange ? 'Exchange' : 'Wallet'}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="font-bold text-surface-950 text-[18px]">
              {formatUsd(source.totalUsdValue)}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <p className="text-[11px] text-surface-500 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {timeAgo(source.lastUpdated)}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Syncing' : 'Refresh'}
          </Button>
        </div>
      </div>

      {source.error && (
        <div className="mx-5 mb-3 flex items-center gap-2 p-3 bg-danger-500/10 border border-danger-500/20 rounded-lg">
          <AlertCircle className="w-4 h-4 text-danger-400 flex-shrink-0" />
          <p className="text-[12px] text-danger-400 truncate">{source.error}</p>
        </div>
      )}

      {source.balances.length > 0 && (
        <div className="border-t border-border">
          <div className="px-5">
            {visibleBalances.map((balance) => (
              <div
                key={balance.asset}
                className="flex items-center justify-between py-2.5 border-b border-border/30 last:border-0"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-mono font-bold text-surface-800">
                    {balance.asset}
                  </span>
                  {DEAD_TOKENS.has(balance.asset) && (
                    <span className="text-[9px] px-1 py-0.5 rounded bg-red-500/10 text-red-400 font-medium">
                      defunct
                    </span>
                  )}
                  <span className="text-[11px] text-surface-500 font-mono">
                    {formatAmount(balance.amount, balance.asset)}
                  </span>
                </div>
                <span className="text-[13px] text-surface-950 font-medium">
                  {balance.usdValue ? formatUsd(balance.usdValue) : '--'}
                </span>
              </div>
            ))}
          </div>
          {hasMore && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setExpanded(!expanded)}
              className="w-full rounded-none py-2.5 text-[12px] text-accent-500 hover:bg-accent-500/5 hover:text-accent-500"
            >
              {expanded ? (
                <>
                  <ChevronUp className="w-3.5 h-3.5" />
                  Show less
                </>
              ) : (
                <>
                  <ChevronDown className="w-3.5 h-3.5" />
                  Show {sortedBalances.length - TOP_N} more
                </>
              )}
            </Button>
          )}
        </div>
      )}

      {source.balances.length === 0 && !source.error && (
        <div className="border-t border-border px-5 py-4">
          <p className="text-[12px] text-surface-500 text-center">No balances found</p>
        </div>
      )}
    </Card>
  );
}

function AssetRow({
  balance,
  totalValue,
  colorIndex,
}: {
  balance: CryptoBalance;
  totalValue: number;
  colorIndex: number;
}) {
  const pct = totalValue > 0 ? ((balance.usdValue || 0) / totalValue) * 100 : 0;
  const barColor = ASSET_COLORS[colorIndex % ASSET_COLORS.length];
  const textColor = ASSET_TEXT_COLORS[colorIndex % ASSET_TEXT_COLORS.length];

  return (
    <div className="flex items-center gap-3 py-3 border-b border-border/30 last:border-0">
      {/* Asset icon */}
      <div className={`w-9 h-9 rounded-full flex items-center justify-center ${barColor}/15`}>
        <span className={`text-[11px] font-mono font-bold ${textColor}`}>
          {balance.asset.slice(0, 3)}
        </span>
      </div>

      {/* Asset info + allocation bar */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <p className="text-[13px] font-semibold text-surface-950">{balance.asset}</p>
            {DEAD_TOKENS.has(balance.asset) && (
              <span className="text-[9px] px-1 py-0.5 rounded bg-red-500/10 text-red-400 font-medium">
                defunct
              </span>
            )}
            <p className="text-[11px] text-surface-500 font-mono">
              {formatAmount(balance.amount, balance.asset)}
            </p>
          </div>
          <div className="text-right flex items-center gap-2">
            <span className="text-[11px] text-surface-500 tabular-nums">{pct.toFixed(1)}%</span>
            <p className="text-[14px] font-semibold text-surface-950 tabular-nums">
              {balance.usdValue ? formatUsd(balance.usdValue) : '--'}
            </p>
          </div>
        </div>
        {/* Allocation bar */}
        <div className="w-full h-1.5 bg-surface-200/50 rounded-full overflow-hidden">
          <div
            className={`h-full ${barColor} rounded-full transition-all duration-500 ease-out`}
            style={{ width: `${Math.max(pct, 0.5)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// Module-level cache for tab switches (server-side cache handles page refreshes)
let cachedPortfolio: CryptoPortfolio | null = null;

export function CryptoView() {
  const { hideQuickStats } = useAppContext();
  const [portfolio, setPortfolio] = useState<CryptoPortfolio | null>(cachedPortfolio);
  const [isLoading, setIsLoading] = useState(!cachedPortfolio);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAllAssets, setShowAllAssets] = useState(false);
  const [progress, setProgress] = useState<{
    current: number;
    total: number;
    label: string;
  } | null>(null);

  // Snapshots for history chart
  const [snapshots, setSnapshots] = useState<PortfolioSnapshot[]>([]);

  // Gains state
  const [gains, setGains] = useState<CryptoGainsSummary | null>(null);
  const [gainsLoading, setGainsLoading] = useState(false);
  const [gainsError, setGainsError] = useState<string | null>(null);
  const [gainsProgress, setGainsProgress] = useState<string | null>(null);

  const loadGains = useCallback(async (forceRefresh = false) => {
    setGainsLoading(true);
    setGainsError(null);
    setGainsProgress(null);

    try {
      // Try cached first unless force refresh
      if (!forceRefresh) {
        const cachedRes = await fetch(`${API_BASE}/crypto/gains?cached=1`);
        if (cachedRes.ok) {
          const data = await cachedRes.json();
          if (data.assets?.length > 0) {
            setGains(data);
            setGainsLoading(false);
            return;
          }
        }
      }

      // Stream fresh gains
      const res = await fetch(`${API_BASE}/crypto/gains?stream=1`);
      if (!res.ok) throw new Error(`Server error ${res.status}`);

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.type === 'progress') {
              setGainsProgress(msg.label);
            } else if (msg.type === 'result') {
              setGains(msg.data);
            } else if (msg.type === 'error') {
              setGainsError(msg.message);
            }
          } catch {
            // skip
          }
        }
      }
    } catch (err) {
      setGainsError(err instanceof Error ? err.message : 'Failed to load gains');
    } finally {
      setGainsLoading(false);
      setGainsProgress(null);
    }
  }, []);

  const loadBalances = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setIsRefreshing(true);
    else if (!cachedPortfolio) setIsLoading(true);
    setError(null);
    setProgress(null);

    try {
      const res = await fetch(`${API_BASE}/crypto/balances?stream=1`);
      if (!res.ok) throw new Error(`Server error ${res.status}`);

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.type === 'progress') {
              setProgress({ current: msg.current, total: msg.total, label: msg.label });
            } else if (msg.type === 'source') {
              // Merge incoming source into portfolio state for live updates
              setPortfolio((prev) => {
                const sources = prev
                  ? prev.sources
                      .filter((s) => s.sourceId !== msg.source.sourceId)
                      .concat(msg.source)
                  : [msg.source];
                const totalUsdValue = sources.reduce((sum, s) => sum + s.totalUsdValue, 0);
                const assetMap = new Map<string, { amount: number; usdValue: number }>();
                for (const s of sources) {
                  for (const b of s.balances) {
                    const cur = assetMap.get(b.asset) ?? { amount: 0, usdValue: 0 };
                    assetMap.set(b.asset, {
                      amount: cur.amount + b.amount,
                      usdValue: cur.usdValue + (b.usdValue ?? 0),
                    });
                  }
                }
                const byAsset = Array.from(assetMap.entries())
                  .map(([asset, { amount, usdValue }]) => ({ asset, amount, usdValue }))
                  .sort((a, b) => b.usdValue - a.usdValue);
                const updated = {
                  sources,
                  totalUsdValue,
                  byAsset,
                  lastUpdated: msg.source.lastUpdated,
                };
                cachedPortfolio = updated;
                return updated;
              });
            } else if (msg.type === 'result') {
              // Final result supersedes incremental state with correct byAsset ordering
              delete msg.type;
              cachedPortfolio = msg as CryptoPortfolio;
              setPortfolio(msg as CryptoPortfolio);
            }
          } catch {
            // Skip malformed lines
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load balances');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
      setProgress(null);
    }
  }, []);

  const refreshSource = useCallback(async (sourceId: string) => {
    try {
      const res = await fetch(`${API_BASE}/crypto/balances/${encodeURIComponent(sourceId)}`);
      if (!res.ok) return;
      const updatedSource = await res.json();

      setPortfolio((prev) => {
        if (!prev) return prev;
        const newSources = prev.sources.map((s) => (s.sourceId === sourceId ? updatedSource : s));
        const totalUsdValue = newSources.reduce((sum, s) => sum + s.totalUsdValue, 0);
        const assetMap = new Map<string, { amount: number; usdValue: number }>();
        for (const s of newSources) {
          for (const b of s.balances) {
            const existing = assetMap.get(b.asset) || { amount: 0, usdValue: 0 };
            existing.amount += b.amount;
            existing.usdValue += b.usdValue || 0;
            assetMap.set(b.asset, existing);
          }
        }
        const byAsset = Array.from(assetMap.entries())
          .map(([asset, { amount, usdValue }]) => ({ asset, amount, usdValue }))
          .sort((a, b) => (b.usdValue || 0) - (a.usdValue || 0));

        const updated = { ...prev, sources: newSources, totalUsdValue, byAsset };
        cachedPortfolio = updated;
        return updated;
      });
    } catch {
      // Silently fail — the source card shows its own error
    }
  }, []);

  // On mount: load from server cache (instant), don't refetch live
  useEffect(() => {
    // Load snapshots for history chart
    void fetch(`${API_BASE}/portfolio/snapshots`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setSnapshots(data);
      })
      .catch(() => {});

    if (cachedPortfolio) return;
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/crypto/balances?cached=1`);
        if (!res.ok) throw new Error('No cache');
        const data = await res.json();
        if (data.sources?.length > 0) {
          cachedPortfolio = data;
          setPortfolio(data);
          setIsLoading(false);
        } else {
          void loadBalances();
        }
      } catch {
        void loadBalances();
      }
    })();
  }, [loadBalances]);

  // Progress bar component
  const progressBar = progress && (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[12px] text-surface-600">
          Syncing: <span className="font-medium text-surface-800">{progress.label}</span>
        </p>
        <p className="text-[12px] text-surface-600 tabular-nums">
          {progress.current}/{progress.total}
        </p>
      </div>
      <div className="w-full h-2 bg-surface-200/50 rounded-full overflow-hidden">
        <div
          className="h-full bg-amber-500 rounded-full transition-all duration-300 ease-out"
          style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
        />
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto px-4 md:px-6 py-8">
        <h2 className="text-2xl font-bold text-surface-950 mb-6">Crypto Portfolio</h2>
        {progressBar || (
          <div className="text-center py-20 text-surface-600">Loading crypto balances...</div>
        )}
      </div>
    );
  }

  const hasNoSources =
    !portfolio || (portfolio.sources.length === 0 && portfolio.byAsset.length === 0);

  const filteredAssets = portfolio?.byAsset.filter((b) => (b.usdValue || 0) > 0.01) || [];
  const visibleAssets = showAllAssets ? filteredAssets : filteredAssets.slice(0, TOP_N);
  const hiddenCount = filteredAssets.length - TOP_N;

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-6 py-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
        <div>
          <h2 className="text-2xl font-bold text-surface-950">Crypto Portfolio</h2>
          {portfolio?.lastUpdated && (
            <p className="text-[12px] text-surface-600 mt-1 flex items-center gap-1.5">
              <Clock className="w-3 h-3" />
              Synced {timeAgo(portfolio.lastUpdated)}
            </p>
          )}
        </div>
        <Button
          type="button"
          onClick={() => loadBalances(true)}
          disabled={isRefreshing}
          className="bg-amber-500 hover:bg-amber-400 shadow-sm"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">{isRefreshing ? 'Syncing...' : 'Sync Balances'}</span>
        </Button>
      </div>

      {isRefreshing && progressBar}

      {error && (
        <div className="flex items-center gap-2 p-4 bg-danger-500/10 border border-danger-500/20 rounded-xl mb-6">
          <AlertCircle className="w-5 h-5 text-danger-400" />
          <span className="text-[13px] text-danger-400">{error}</span>
        </div>
      )}

      {hasNoSources ? (
        <Card variant="glass" className="p-10 text-center">
          <div className="p-4 bg-amber-500/10 rounded-2xl w-fit mx-auto mb-5">
            <Bitcoin className="w-8 h-8 text-amber-500" />
          </div>
          <h3 className="text-lg font-semibold text-surface-950 mb-2">No Crypto Sources</h3>
          <p className="text-[13px] text-surface-600 max-w-sm mx-auto">
            Add exchange API keys or wallet addresses in Settings to start tracking your crypto
            balances.
          </p>
        </Card>
      ) : (
        <>
          {/* Total Portfolio Value */}
          <div className={hideQuickStats ? 'blur-sm select-none' : ''}>
            <Card variant="glass" className="p-6 mb-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[12px] text-surface-600 uppercase tracking-wider mb-1">
                    Total Portfolio Value
                  </p>
                  <p className="text-3xl font-bold text-surface-950">
                    {formatUsd(portfolio?.totalUsdValue || 0)}
                  </p>
                  <p className="text-[12px] text-surface-600 mt-1">
                    {portfolio?.sources.length || 0} source
                    {(portfolio?.sources.length || 0) !== 1 ? 's' : ''} &middot;{' '}
                    {filteredAssets.length} asset
                    {filteredAssets.length !== 1 ? 's' : ''}
                  </p>
                </div>

                {/* Mini allocation bar */}
                {filteredAssets.length > 0 && (
                  <div className="hidden md:block w-48">
                    <div className="flex h-3 rounded-full overflow-hidden">
                      {filteredAssets.slice(0, 6).map((b, i) => {
                        const pct = ((b.usdValue || 0) / (portfolio?.totalUsdValue || 1)) * 100;
                        return (
                          <div
                            key={b.asset}
                            className={`${ASSET_COLORS[i % ASSET_COLORS.length]} transition-all duration-500`}
                            style={{ width: `${pct}%` }}
                            title={`${b.asset}: ${pct.toFixed(1)}%`}
                          />
                        );
                      })}
                      {filteredAssets.length > 6 && (
                        <div
                          className="bg-surface-300"
                          style={{
                            width: `${filteredAssets.slice(6).reduce((sum, b) => sum + ((b.usdValue || 0) / (portfolio?.totalUsdValue || 1)) * 100, 0)}%`,
                          }}
                          title="Other assets"
                        />
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      {filteredAssets.slice(0, 3).map((b, i) => (
                        <div key={b.asset} className="flex items-center gap-1">
                          <div className={`w-2 h-2 rounded-full ${ASSET_COLORS[i]}`} />
                          <span className="text-[10px] text-surface-500">{b.asset}</span>
                        </div>
                      ))}
                      {filteredAssets.length > 3 && (
                        <span className="text-[10px] text-surface-400">
                          +{filteredAssets.length - 3}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </Card>
          </div>

          {/* By Asset (with top-5 collapse) */}
          {filteredAssets.length > 0 && (
            <Card variant="glass" className="overflow-hidden mb-6">
              <div className="px-5 pt-5 pb-2">
                <h3 className="text-[14px] font-semibold text-surface-950">Holdings</h3>
              </div>
              <div className="px-5">
                {visibleAssets.map((balance, i) => (
                  <AssetRow
                    key={balance.asset}
                    balance={balance}
                    totalValue={portfolio?.totalUsdValue || 0}
                    colorIndex={i}
                  />
                ))}
              </div>
              {hiddenCount > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowAllAssets(!showAllAssets)}
                  className="w-full rounded-none py-3 text-[12px] text-accent-500 hover:bg-accent-500/5 hover:text-accent-500 border-t border-border/30"
                >
                  {showAllAssets ? (
                    <>
                      <ChevronUp className="w-3.5 h-3.5" />
                      Show top {TOP_N} only
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-3.5 h-3.5" />
                      Show all {filteredAssets.length} assets ({hiddenCount} more)
                    </>
                  )}
                </Button>
              )}
            </Card>
          )}

          {/* Capital Gains */}
          <Card variant="glass" className="p-5 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[14px] font-semibold text-surface-950 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-amber-500" />
                Capital Gains (Cost Basis)
              </h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => loadGains(!!gains)}
                disabled={gainsLoading}
              >
                <RefreshCw className={`w-3 h-3 ${gainsLoading ? 'animate-spin' : ''}`} />
                {gainsLoading
                  ? gainsProgress || 'Loading trades...'
                  : gains
                    ? 'Refresh Gains'
                    : 'Load Gains'}
              </Button>
            </div>

            {gainsError && (
              <div className="flex items-center gap-2 p-3 bg-danger-500/10 border border-danger-500/20 rounded-lg mb-3">
                <AlertCircle className="w-4 h-4 text-danger-400 flex-shrink-0" />
                <p className="text-[12px] text-danger-400">{gainsError}</p>
              </div>
            )}

            {!gains && !gainsLoading && !gainsError && (
              <p className="text-[12px] text-surface-500">
                Fetches trade history from your exchanges to calculate cost basis and unrealized
                gains. Uses FIFO (first-in, first-out) accounting.
              </p>
            )}

            {gains && (
              <div>
                {/* Summary row */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
                  <div className="p-3 bg-surface-200/30 rounded-lg">
                    <p className="text-[11px] text-surface-600 uppercase tracking-wider mb-0.5">
                      Cost Basis
                    </p>
                    <p className="text-[16px] font-bold text-surface-950">
                      {formatUsd(gains.totalCostBasis)}
                    </p>
                  </div>
                  <div className="p-3 bg-surface-200/30 rounded-lg">
                    <p className="text-[11px] text-surface-600 uppercase tracking-wider mb-0.5">
                      Unrealized P&L
                    </p>
                    <p
                      className={`text-[16px] font-bold flex items-center gap-1 ${gains.totalUnrealizedGain >= 0 ? 'text-green-500' : 'text-red-500'}`}
                    >
                      {gains.totalUnrealizedGain >= 0 ? (
                        <TrendingUp className="w-3.5 h-3.5" />
                      ) : (
                        <TrendingDown className="w-3.5 h-3.5" />
                      )}
                      {formatUsd(Math.abs(gains.totalUnrealizedGain))}
                    </p>
                  </div>
                  <div className="p-3 bg-surface-200/30 rounded-lg">
                    <p className="text-[11px] text-surface-600 uppercase tracking-wider mb-0.5">
                      Short-Term
                    </p>
                    <p className="text-[16px] font-bold text-amber-500">
                      {formatUsd(gains.totalShortTermGain)}
                    </p>
                    <p className="text-[9px] text-surface-500">Held &lt; 1yr</p>
                  </div>
                  <div className="p-3 bg-surface-200/30 rounded-lg">
                    <p className="text-[11px] text-surface-600 uppercase tracking-wider mb-0.5">
                      Long-Term
                    </p>
                    <p className="text-[16px] font-bold text-green-500">
                      {formatUsd(gains.totalLongTermGain)}
                    </p>
                    <p className="text-[9px] text-surface-500">Held &gt; 1yr</p>
                  </div>
                </div>

                {/* Per-asset breakdown */}
                <div className="border-t border-border/30 pt-3 overflow-x-auto scrollbar-hide">
                  <div className="min-w-[520px]">
                    <div className="grid grid-cols-12 gap-2 pb-2 text-[10px] font-medium text-surface-500 uppercase tracking-wider">
                      <div className="col-span-2">Asset</div>
                      <div className="col-span-2 text-right">Amount</div>
                      <div className="col-span-2 text-right">Cost Basis</div>
                      <div className="col-span-2 text-right">Current</div>
                      <div className="col-span-2 text-right">P&L</div>
                      <div className="col-span-2 text-right">Type</div>
                    </div>
                    {gains.assets.slice(0, 10).map((a) => (
                      <div
                        key={a.asset}
                        className="grid grid-cols-12 gap-2 py-2.5 border-b border-border/20 last:border-0 items-center"
                      >
                        <div className="col-span-2">
                          <span className="text-[13px] font-mono font-bold text-surface-950">
                            {a.asset}
                          </span>
                        </div>
                        <div className="col-span-2 text-right text-[12px] text-surface-700 font-mono">
                          {formatAmount(a.totalAmount, a.asset)}
                        </div>
                        <div className="col-span-2 text-right text-[12px] text-surface-700">
                          {formatUsd(a.totalCostBasis)}
                        </div>
                        <div className="col-span-2 text-right text-[12px] text-surface-950 font-medium">
                          {formatUsd(a.currentValue)}
                        </div>
                        <div className="col-span-2 text-right">
                          <span
                            className={`text-[12px] font-medium ${a.unrealizedGain >= 0 ? 'text-green-500' : 'text-red-500'}`}
                          >
                            {a.unrealizedGain >= 0 ? '+' : ''}
                            {formatUsd(a.unrealizedGain)}
                          </span>
                        </div>
                        <div className="col-span-2 text-right">
                          {a.lots.length > 0 && (
                            <div className="flex items-center justify-end gap-1">
                              {a.shortTermGain !== 0 && (
                                <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/10 text-amber-600 font-medium">
                                  ST
                                </span>
                              )}
                              {a.longTermGain !== 0 && (
                                <span className="text-[9px] px-1 py-0.5 rounded bg-green-500/10 text-green-600 font-medium">
                                  LT
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <p className="text-[10px] text-surface-500 mt-2">
                  {gains.tradeCount} trades analyzed &middot; FIFO accounting &middot; Updated{' '}
                  {timeAgo(gains.lastUpdated)}
                </p>
              </div>
            )}
          </Card>

          {/* History Chart */}
          {snapshots.length >= 2 && (
            <Card variant="glass" className="p-5 mb-6">
              <h3 className="text-[14px] font-semibold text-surface-950 mb-3 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-amber-500" />
                Crypto History
              </h3>
              <HistoryChart
                snapshots={snapshots}
                lines={[{ key: 'cryptoValue', label: 'Crypto', color: '#f59e0b' }]}
                height={180}
              />
            </Card>
          )}

          {/* Source Cards */}
          <h3 className="text-[14px] font-semibold text-surface-950 mb-3">By Source</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {portfolio?.sources.map((source) => (
              <SourceCard key={source.sourceId} source={source} onRefresh={refreshSource} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
