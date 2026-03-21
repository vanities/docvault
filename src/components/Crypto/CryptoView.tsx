import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Wallet, TrendingUp, AlertCircle, Bitcoin } from 'lucide-react';
import type { CryptoPortfolio, CryptoSourceBalance, CryptoBalance } from '../../types';
import { API_BASE } from '../../constants';

function formatUsd(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  });
}

function formatAmount(amount: number, asset: string): string {
  // More decimals for smaller-value assets
  const decimals = ['BTC', 'ETH'].includes(asset) ? 6 : 2;
  return amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals,
  });
}

function SourceCard({ source }: { source: CryptoSourceBalance }) {
  const isExchange = source.sourceType === 'exchange';

  return (
    <div className="glass-card rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className={`p-2 rounded-lg ${isExchange ? 'bg-accent-500/10' : 'bg-amber-500/10'}`}>
            {isExchange ? (
              <TrendingUp
                className={`w-4 h-4 ${isExchange ? 'text-accent-400' : 'text-amber-500'}`}
              />
            ) : (
              <Wallet className="w-4 h-4 text-amber-500" />
            )}
          </div>
          <div>
            <p className="font-medium text-surface-950 text-[14px]">{source.label}</p>
            <p className="text-[11px] text-surface-600">{isExchange ? 'Exchange' : 'Wallet'}</p>
          </div>
        </div>
        <p className="font-semibold text-surface-950 text-[16px]">
          {formatUsd(source.totalUsdValue)}
        </p>
      </div>

      {source.error && (
        <div className="flex items-center gap-2 p-3 bg-danger-500/10 border border-danger-500/20 rounded-lg mb-3">
          <AlertCircle className="w-4 h-4 text-danger-400 flex-shrink-0" />
          <p className="text-[12px] text-danger-400 truncate">{source.error}</p>
        </div>
      )}

      {source.balances.length > 0 && (
        <div className="space-y-2">
          {source.balances
            .sort((a, b) => (b.usdValue || 0) - (a.usdValue || 0))
            .map((balance) => (
              <div
                key={balance.asset}
                className="flex items-center justify-between py-1.5 border-b border-border last:border-0"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-mono font-medium text-surface-800">
                    {balance.asset}
                  </span>
                  <span className="text-[12px] text-surface-600">
                    {formatAmount(balance.amount, balance.asset)}
                  </span>
                </div>
                <span className="text-[13px] text-surface-800 font-medium">
                  {balance.usdValue ? formatUsd(balance.usdValue) : '--'}
                </span>
              </div>
            ))}
        </div>
      )}

      {source.balances.length === 0 && !source.error && (
        <p className="text-[12px] text-surface-500 text-center py-2">No balances found</p>
      )}
    </div>
  );
}

function AssetRow({ balance }: { balance: CryptoBalance }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-surface-200/50 flex items-center justify-center">
          <span className="text-[11px] font-mono font-bold text-surface-700">
            {balance.asset.slice(0, 3)}
          </span>
        </div>
        <div>
          <p className="text-[13px] font-medium text-surface-950">{balance.asset}</p>
          <p className="text-[11px] text-surface-600 font-mono">
            {formatAmount(balance.amount, balance.asset)}
          </p>
        </div>
      </div>
      <p className="text-[14px] font-semibold text-surface-950">
        {balance.usdValue ? formatUsd(balance.usdValue) : '--'}
      </p>
    </div>
  );
}

export function CryptoView() {
  const [portfolio, setPortfolio] = useState<CryptoPortfolio | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadBalances = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setIsRefreshing(true);
    else setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/crypto/balances`);
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      setPortfolio(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load balances');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadBalances();
  }, [loadBalances]);

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto px-4 md:px-6 py-8">
        <div className="text-center py-20 text-surface-600">Loading crypto balances...</div>
      </div>
    );
  }

  const hasNoSources =
    !portfolio || (portfolio.sources.length === 0 && portfolio.byAsset.length === 0);

  return (
    <div className="max-w-4xl mx-auto px-4 md:px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-surface-950">Crypto Portfolio</h2>
          {portfolio?.lastUpdated && (
            <p className="text-[12px] text-surface-600 mt-1">
              Last updated: {new Date(portfolio.lastUpdated).toLocaleTimeString()}
            </p>
          )}
        </div>
        <button
          onClick={() => loadBalances(true)}
          disabled={isRefreshing}
          className="flex items-center gap-2 px-4 py-2.5 bg-accent-500 text-surface-0 rounded-xl hover:bg-accent-400 transition-colors disabled:opacity-50 text-[13px] font-medium"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          {isRefreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

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
            <p className="text-[12px] text-surface-600 uppercase tracking-wider mb-1">
              Total Portfolio Value
            </p>
            <p className="text-3xl font-bold text-surface-950">
              {formatUsd(portfolio?.totalUsdValue || 0)}
            </p>
            <p className="text-[12px] text-surface-600 mt-1">
              {portfolio?.sources.length || 0} source
              {(portfolio?.sources.length || 0) !== 1 ? 's' : ''} &middot;{' '}
              {portfolio?.byAsset.length || 0} asset
              {(portfolio?.byAsset.length || 0) !== 1 ? 's' : ''}
            </p>
          </div>

          {/* By Asset (aggregated) */}
          {portfolio && portfolio.byAsset.length > 0 && (
            <div className="glass-card rounded-xl p-5 mb-6">
              <h3 className="text-[14px] font-semibold text-surface-950 mb-3">By Asset</h3>
              <div>
                {portfolio.byAsset.map((balance) => (
                  <AssetRow key={balance.asset} balance={balance} />
                ))}
              </div>
            </div>
          )}

          {/* Source Cards */}
          <h3 className="text-[14px] font-semibold text-surface-950 mb-3">By Source</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {portfolio?.sources.map((source) => (
              <SourceCard key={source.sourceId} source={source} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
