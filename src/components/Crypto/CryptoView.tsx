import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw,
  Wallet,
  TrendingUp,
  AlertCircle,
  Bitcoin,
  Clock,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { CryptoPortfolio, CryptoSourceBalance, CryptoBalance } from '../../types';
import { API_BASE } from '../../constants';

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
    <div className="glass-card rounded-xl overflow-hidden">
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
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1 px-2 py-1 text-[11px] text-surface-600 hover:text-surface-900 hover:bg-surface-200/50 rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Syncing' : 'Refresh'}
          </button>
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
            <button
              onClick={() => setExpanded(!expanded)}
              className="w-full flex items-center justify-center gap-1.5 py-2.5 text-[12px] font-medium text-accent-500 hover:bg-accent-500/5 transition-colors"
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
            </button>
          )}
        </div>
      )}

      {source.balances.length === 0 && !source.error && (
        <div className="border-t border-border px-5 py-4">
          <p className="text-[12px] text-surface-500 text-center">No balances found</p>
        </div>
      )}
    </div>
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
      <div
        className={`w-9 h-9 rounded-full flex items-center justify-center ${barColor}/15`}
      >
        <span className={`text-[11px] font-mono font-bold ${textColor}`}>
          {balance.asset.slice(0, 3)}
        </span>
      </div>

      {/* Asset info + allocation bar */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <p className="text-[13px] font-semibold text-surface-950">{balance.asset}</p>
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
            } else if (msg.type === 'result') {
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
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-surface-950">Crypto Portfolio</h2>
          {portfolio?.lastUpdated && (
            <p className="text-[12px] text-surface-600 mt-1 flex items-center gap-1.5">
              <Clock className="w-3 h-3" />
              Synced {timeAgo(portfolio.lastUpdated)}
            </p>
          )}
        </div>
        <button
          onClick={() => loadBalances(true)}
          disabled={isRefreshing}
          className="flex items-center gap-2 px-5 py-2.5 bg-amber-500 text-surface-0 rounded-xl hover:bg-amber-400 transition-colors disabled:opacity-50 text-[14px] font-medium shadow-sm"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          {isRefreshing ? 'Syncing...' : 'Sync Balances'}
        </button>
      </div>

      {isRefreshing && progressBar}

      {error && (
        <div className="flex items-center gap-2 p-4 bg-danger-500/10 border border-danger-500/20 rounded-xl mb-6">
          <AlertCircle className="w-5 h-5 text-danger-400" />
          <span className="text-[13px] text-danger-400">{error}</span>
        </div>
      )}

      {hasNoSources ? (
        <div className="glass-card rounded-xl p-10 text-center">
          <div className="p-4 bg-amber-500/10 rounded-2xl w-fit mx-auto mb-5">
            <Bitcoin className="w-8 h-8 text-amber-500" />
          </div>
          <h3 className="text-lg font-semibold text-surface-950 mb-2">No Crypto Sources</h3>
          <p className="text-[13px] text-surface-600 max-w-sm mx-auto">
            Add exchange API keys or wallet addresses in Settings to start tracking your crypto
            balances.
          </p>
        </div>
      ) : (
        <>
          {/* Total Portfolio Value */}
          <div className="glass-card rounded-xl p-6 mb-6">
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
          </div>

          {/* By Asset (with top-5 collapse) */}
          {filteredAssets.length > 0 && (
            <div className="glass-card rounded-xl overflow-hidden mb-6">
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
                <button
                  onClick={() => setShowAllAssets(!showAllAssets)}
                  className="w-full flex items-center justify-center gap-1.5 py-3 text-[12px] font-medium text-accent-500 hover:bg-accent-500/5 transition-colors border-t border-border/30"
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
                </button>
              )}
            </div>
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
