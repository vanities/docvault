import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw,
  Clock,
  Bitcoin,
  Landmark,
  PieChart,
  TrendingUp,
  TrendingDown,
  ChevronDown,
  ChevronUp,
  Camera,
  Calendar,
  Building2,
} from 'lucide-react';
import type {
  CryptoPortfolio,
  BrokerPortfolio,
  PortfolioSnapshot,
  CryptoGainsSummary,
} from '../../types';
import { API_BASE } from '../../constants';
import { useAppContext } from '../../contexts/AppContext';
import { DonutChart } from './DonutChart';
import { HistoryChart } from '../common/HistoryChart';
import { getDonutColor } from './donutColors';

function formatUsd(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  });
}

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

const SLICE_COLORS = [
  'bg-amber-500',
  'bg-accent-500',
  'bg-emerald-500',
  'bg-violet-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-orange-500',
  'bg-indigo-500',
];

interface PortfolioSlice {
  label: string;
  value: number;
  type: 'crypto' | 'broker' | 'gold' | 'property';
  detail?: string;
  gainType?: 'short-term' | 'long-term' | 'unknown';
  gainLoss?: number;
}

export function PortfolioView() {
  const { setActiveView } = useAppContext();
  const [crypto, setCrypto] = useState<CryptoPortfolio | null>(null);
  const [brokers, setBrokers] = useState<BrokerPortfolio | null>(null);
  const [bankTotal, setBankTotal] = useState(0);
  const [goldTotal, setGoldTotal] = useState(0);
  const [propertyTotal, setPropertyTotal] = useState(0);
  const [cryptoGains, setCryptoGains] = useState<CryptoGainsSummary | null>(null);
  const [snapshots, setSnapshots] = useState<PortfolioSnapshot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isTakingSnapshot, setIsTakingSnapshot] = useState(false);
  const [showAllSlices, setShowAllSlices] = useState(false);

  const loadAll = useCallback(async (refresh = false) => {
    if (refresh) setIsRefreshing(true);
    else setIsLoading(true);

    try {
      const [cryptoRes, brokerRes, snapshotRes, gainsRes, bankRes, goldRes, propertyRes] =
        await Promise.all([
          fetch(`${API_BASE}/crypto/balances?cached=1`),
          fetch(`${API_BASE}/brokers/portfolio`),
          fetch(`${API_BASE}/portfolio/snapshots`),
          fetch(`${API_BASE}/crypto/gains?cached=1`),
          fetch(`${API_BASE}/simplefin/balances?cached=1`),
          fetch(`${API_BASE}/gold`),
          fetch(`${API_BASE}/property`),
        ]);

      if (cryptoRes.ok) {
        const data = await cryptoRes.json();
        if (data.sources?.length > 0) setCrypto(data);
      }
      if (brokerRes.ok) {
        const data = await brokerRes.json();
        if (data.accounts?.length > 0) setBrokers(data);
      }
      if (snapshotRes.ok) {
        const data = await snapshotRes.json();
        if (Array.isArray(data)) setSnapshots(data);
      }
      if (gainsRes.ok) {
        const data = await gainsRes.json();
        if (data.assets?.length > 0) setCryptoGains(data);
      }
      if (bankRes.ok) {
        const data = await bankRes.json();
        const total = (data.accounts || []).reduce(
          (sum: number, a: { balance: number }) => sum + (a.balance || 0),
          0
        );
        setBankTotal(total);
      }
      if (goldRes.ok) {
        const data = await goldRes.json();
        const spots = data.spotPrices || {};
        let total = 0;
        for (const entry of data.entries || []) {
          const spotPrice = spots[entry.metal] || 0;
          total += entry.weightOz * entry.quantity * spotPrice;
        }
        setGoldTotal(total);
      }
      if (propertyRes.ok) {
        const data = await propertyRes.json();
        let total = 0;
        for (const entry of data.entries || []) {
          const equity = (entry.currentValue || 0) - (entry.mortgage?.balance || 0);
          total += equity;
        }
        setPropertyTotal(total);
      }
    } catch {
      // Non-critical
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const takeSnapshot = async () => {
    setIsTakingSnapshot(true);
    try {
      const res = await fetch(`${API_BASE}/portfolio/snapshot`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.snapshot) {
          setSnapshots((prev) => {
            const filtered = prev.filter((s) => s.date !== data.snapshot.date);
            return [...filtered, data.snapshot];
          });
        }
      }
    } catch {
      // Non-critical
    } finally {
      setIsTakingSnapshot(false);
    }
  };

  const cryptoTotal = crypto?.totalUsdValue || 0;
  const brokerTotal = brokers?.totalValue || 0;
  const grandTotal = cryptoTotal + brokerTotal + bankTotal + goldTotal + propertyTotal;

  // Build slices for the allocation breakdown
  const slices: PortfolioSlice[] = [];

  if (crypto?.byAsset) {
    for (const asset of crypto.byAsset.filter((a) => (a.usdValue || 0) > 0.01)) {
      slices.push({
        label: asset.asset,
        value: asset.usdValue || 0,
        type: 'crypto',
      });
    }
  }

  if (brokers?.accounts) {
    for (const account of brokers.accounts) {
      for (const holding of account.holdings) {
        slices.push({
          label: holding.ticker,
          value: holding.marketValue || 0,
          type: 'broker',
          detail: account.name,
          gainType: holding.gainType,
          gainLoss: holding.gainLoss,
        });
      }
    }
  }

  if (goldTotal > 0) {
    slices.push({
      label: 'Gold',
      value: goldTotal,
      type: 'gold',
      detail: 'Physical precious metals',
    });
  }

  if (propertyTotal > 0) {
    slices.push({
      label: 'Property',
      value: propertyTotal,
      type: 'property',
      detail: 'Real estate equity',
    });
  }

  slices.sort((a, b) => b.value - a.value);
  const topSlices = showAllSlices ? slices : slices.slice(0, 10);
  const hiddenCount = slices.length - 10;

  // Donut chart slices (top 8 + "Other")
  const donutSlices = slices.slice(0, 8).map((s, i) => ({
    label: s.label,
    value: s.value,
    color: getDonutColor(i),
  }));
  const otherValue = slices.slice(8).reduce((sum, s) => sum + s.value, 0);
  if (otherValue > 0) {
    donutSlices.push({ label: 'Other', value: otherValue, color: '#94a3b8' });
  }

  // Gains summary (combine broker + crypto)
  const brokerST = brokers?.shortTermGains || 0;
  const brokerLT = brokers?.longTermGains || 0;
  const cryptoST = cryptoGains?.totalShortTermGain || 0;
  const cryptoLT = cryptoGains?.totalLongTermGain || 0;
  const shortTermGains = brokerST + cryptoST;
  const longTermGains = brokerLT + cryptoLT;
  const totalGainLoss = (brokers?.totalGainLoss || 0) + (cryptoGains?.totalUnrealizedGain || 0);
  const hasGains = totalGainLoss !== 0 || shortTermGains !== 0 || longTermGains !== 0;

  const lastUpdated =
    crypto?.lastUpdated && brokers?.lastUpdated
      ? new Date(crypto.lastUpdated) > new Date(brokers.lastUpdated)
        ? crypto.lastUpdated
        : brokers.lastUpdated
      : crypto?.lastUpdated || brokers?.lastUpdated;

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto px-4 md:px-6 py-8">
        <h2 className="text-2xl font-bold text-surface-950 mb-6">Portfolio Overview</h2>
        <div className="text-center py-20 text-surface-600">Loading portfolio data...</div>
      </div>
    );
  }

  const hasAnything = cryptoTotal > 0 || brokerTotal > 0 || goldTotal > 0 || propertyTotal > 0;

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-surface-950">Portfolio Overview</h2>
          {lastUpdated && (
            <p className="text-[12px] text-surface-600 mt-1 flex items-center gap-1.5">
              <Clock className="w-3 h-3" />
              Updated {timeAgo(lastUpdated)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={takeSnapshot}
            disabled={isTakingSnapshot || !hasAnything}
            className="flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-medium text-surface-700 hover:bg-surface-200/50 rounded-xl transition-colors disabled:opacity-50 border border-border"
            title="Save today's portfolio value as a snapshot"
          >
            <Camera className={`w-4 h-4 ${isTakingSnapshot ? 'animate-pulse' : ''}`} />
            Snapshot
          </button>
          <button
            onClick={() => loadAll(true)}
            disabled={isRefreshing}
            className="flex items-center gap-2 px-5 py-2.5 bg-violet-500 text-surface-0 rounded-xl hover:bg-violet-400 transition-colors disabled:opacity-50 text-[14px] font-medium shadow-sm"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? 'Refreshing...' : 'Refresh All'}
          </button>
        </div>
      </div>

      {!hasAnything ? (
        <div className="glass-card rounded-xl p-10 text-center">
          <div className="p-4 bg-violet-500/10 rounded-2xl w-fit mx-auto mb-5">
            <PieChart className="w-8 h-8 text-violet-500" />
          </div>
          <h3 className="text-lg font-semibold text-surface-950 mb-2">No Portfolio Data</h3>
          <p className="text-[13px] text-surface-600 max-w-sm mx-auto">
            Add crypto exchanges/wallets or brokerage accounts to see your combined portfolio.
          </p>
        </div>
      ) : (
        <>
          {/* Grand Total */}
          <div className="glass-card rounded-xl p-6 mb-6">
            <p className="text-[12px] text-surface-600 uppercase tracking-wider mb-1">
              Total Net Worth
            </p>
            <p className="text-4xl font-bold text-surface-950">{formatUsd(grandTotal)}</p>

            {/* Allocation bar */}
            {grandTotal > 0 && (
              <div className="mt-4">
                <div className="flex h-3 rounded-full overflow-hidden">
                  {brokerTotal > 0 && (
                    <div
                      className="bg-violet-500 transition-all duration-500"
                      style={{ width: `${(brokerTotal / grandTotal) * 100}%` }}
                      title={`Brokers: ${((brokerTotal / grandTotal) * 100).toFixed(1)}%`}
                    />
                  )}
                  {cryptoTotal > 0 && (
                    <div
                      className="bg-amber-500 transition-all duration-500"
                      style={{ width: `${(cryptoTotal / grandTotal) * 100}%` }}
                      title={`Crypto: ${((cryptoTotal / grandTotal) * 100).toFixed(1)}%`}
                    />
                  )}
                  {bankTotal > 0 && (
                    <div
                      className="bg-blue-500 transition-all duration-500"
                      style={{ width: `${(bankTotal / grandTotal) * 100}%` }}
                      title={`Banks: ${((bankTotal / grandTotal) * 100).toFixed(1)}%`}
                    />
                  )}
                  {goldTotal > 0 && (
                    <div
                      className="bg-yellow-500 transition-all duration-500"
                      style={{ width: `${(goldTotal / grandTotal) * 100}%` }}
                      title={`Gold: ${((goldTotal / grandTotal) * 100).toFixed(1)}%`}
                    />
                  )}
                  {propertyTotal > 0 && (
                    <div
                      className="bg-emerald-500 transition-all duration-500"
                      style={{ width: `${(propertyTotal / grandTotal) * 100}%` }}
                      title={`Property: ${((propertyTotal / grandTotal) * 100).toFixed(1)}%`}
                    />
                  )}
                </div>
                <div className="flex items-center gap-4 mt-2 flex-wrap">
                  {brokerTotal > 0 && (
                    <div className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full bg-violet-500" />
                      <span className="text-[11px] text-surface-600">
                        Brokers {((brokerTotal / grandTotal) * 100).toFixed(1)}%
                      </span>
                    </div>
                  )}
                  {cryptoTotal > 0 && (
                    <div className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                      <span className="text-[11px] text-surface-600">
                        Crypto {((cryptoTotal / grandTotal) * 100).toFixed(1)}%
                      </span>
                    </div>
                  )}
                  {bankTotal > 0 && (
                    <div className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                      <span className="text-[11px] text-surface-600">
                        Banks {((bankTotal / grandTotal) * 100).toFixed(1)}%
                      </span>
                    </div>
                  )}
                  {goldTotal > 0 && (
                    <div className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
                      <span className="text-[11px] text-surface-600">
                        Gold {((goldTotal / grandTotal) * 100).toFixed(1)}%
                      </span>
                    </div>
                  )}
                  {propertyTotal > 0 && (
                    <div className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                      <span className="text-[11px] text-surface-600">
                        Property {((propertyTotal / grandTotal) * 100).toFixed(1)}%
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Portfolio History — full width */}
          <div className="glass-card rounded-xl p-5 mb-6">
            <h3 className="text-[14px] font-semibold text-surface-950 mb-3 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-violet-500" />
              Portfolio History
            </h3>
            {snapshots.length >= 2 ? (
              <HistoryChart
                snapshots={snapshots}
                lines={[
                  { key: 'brokerValue', label: 'Brokers', color: '#8b5cf6' },
                  { key: 'cryptoValue', label: 'Crypto', color: '#f59e0b' },
                  { key: 'bankValue', label: 'Banks', color: '#3b82f6' },
                  { key: 'goldValue', label: 'Gold', color: '#eab308' },
                  { key: 'propertyValue', label: 'Property', color: '#10b981' },
                ]}
                stacked
                height={220}
              />
            ) : (
              <p className="text-[12px] text-surface-500 py-6 text-center">
                Need at least 2 snapshots. Click &ldquo;Snapshot&rdquo; to start tracking.
              </p>
            )}
          </div>

          {/* Category charts + Donut */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            {/* Donut Chart */}
            {donutSlices.length > 0 && (
              <div className="glass-card rounded-xl p-5">
                <h3 className="text-[14px] font-semibold text-surface-950 mb-4 flex items-center gap-2">
                  <PieChart className="w-4 h-4 text-violet-500" />
                  Asset Allocation
                </h3>
                <DonutChart slices={donutSlices} />
              </div>
            )}

            {/* Category breakdown — individual lines */}
            {snapshots.length >= 2 && (
              <div className="glass-card rounded-xl p-5">
                <h3 className="text-[14px] font-semibold text-surface-950 mb-3 flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-violet-500" />
                  By Category
                </h3>
                <HistoryChart
                  snapshots={snapshots}
                  lines={[
                    { key: 'brokerValue', label: 'Brokers', color: '#8b5cf6' },
                    { key: 'cryptoValue', label: 'Crypto', color: '#f59e0b' },
                    { key: 'bankValue', label: 'Banks', color: '#3b82f6' },
                  ]}
                  stacked={false}
                  height={180}
                  showModeToggle={false}
                  defaultRange="3M"
                />
              </div>
            )}
          </div>

          {/* Gains Summary */}
          {hasGains && (
            <div className="glass-card rounded-xl p-5 mb-6">
              <h3 className="text-[14px] font-semibold text-surface-950 mb-4">
                Capital Gains Summary
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-3 bg-surface-200/30 rounded-lg">
                  <p className="text-[11px] text-surface-600 uppercase tracking-wider mb-1">
                    Total Gain/Loss
                  </p>
                  <p
                    className={`text-xl font-bold ${
                      totalGainLoss >= 0 ? 'text-green-500' : 'text-red-500'
                    }`}
                  >
                    <span className="inline-flex items-center gap-1">
                      {totalGainLoss >= 0 ? (
                        <TrendingUp className="w-4 h-4" />
                      ) : (
                        <TrendingDown className="w-4 h-4" />
                      )}
                      {formatUsd(Math.abs(totalGainLoss))}
                    </span>
                  </p>
                </div>
                <div className="p-3 bg-surface-200/30 rounded-lg">
                  <p className="text-[11px] text-surface-600 uppercase tracking-wider mb-1">
                    Short-Term Gains
                  </p>
                  <p className="text-xl font-bold text-amber-500">{formatUsd(shortTermGains)}</p>
                  <p className="text-[10px] text-surface-500 mt-0.5">
                    Held &lt; 1 year &middot; taxed as income
                  </p>
                </div>
                <div className="p-3 bg-surface-200/30 rounded-lg">
                  <p className="text-[11px] text-surface-600 uppercase tracking-wider mb-1">
                    Long-Term Gains
                  </p>
                  <p className="text-xl font-bold text-green-500">{formatUsd(longTermGains)}</p>
                  <p className="text-[10px] text-surface-500 mt-0.5">
                    Held &gt; 1 year &middot; lower tax rate
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Category Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {/* Crypto Card */}
            <button
              onClick={() => setActiveView('crypto')}
              className="glass-card rounded-xl p-5 text-left hover:ring-2 hover:ring-amber-500/30 transition-all group"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-amber-500/10">
                    <Bitcoin className="w-5 h-5 text-amber-500" />
                  </div>
                  <div>
                    <p className="font-semibold text-surface-950 text-[15px]">Crypto</p>
                    <p className="text-[11px] text-surface-600">
                      {crypto?.sources.length || 0} source
                      {(crypto?.sources.length || 0) !== 1 ? 's' : ''} &middot;{' '}
                      {crypto?.byAsset.filter((a) => (a.usdValue || 0) > 0.01).length || 0} assets
                    </p>
                  </div>
                </div>
                <p className="text-xl font-bold text-surface-950">{formatUsd(cryptoTotal)}</p>
              </div>
              {grandTotal > 0 && (
                <div className="w-full h-1.5 bg-surface-200/50 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-500 rounded-full transition-all duration-500"
                    style={{ width: `${(cryptoTotal / grandTotal) * 100}%` }}
                  />
                </div>
              )}
            </button>

            {/* Brokers Card */}
            <button
              onClick={() => setActiveView('brokers')}
              className="glass-card rounded-xl p-5 text-left hover:ring-2 hover:ring-accent-500/30 transition-all group"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-accent-500/10">
                    <Landmark className="w-5 h-5 text-accent-400" />
                  </div>
                  <div>
                    <p className="font-semibold text-surface-950 text-[15px]">Brokerages</p>
                    <p className="text-[11px] text-surface-600">
                      {brokers?.accounts.length || 0} account
                      {(brokers?.accounts.length || 0) !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
                <p className="text-xl font-bold text-surface-950">{formatUsd(brokerTotal)}</p>
              </div>
              {grandTotal > 0 && (
                <div className="w-full h-1.5 bg-surface-200/50 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent-500 rounded-full transition-all duration-500"
                    style={{ width: `${(brokerTotal / grandTotal) * 100}%` }}
                  />
                </div>
              )}
            </button>

            {/* Banks Card */}
            <button
              onClick={() => setActiveView('banks')}
              className="glass-card rounded-xl p-5 text-left hover:ring-2 hover:ring-blue-500/30 transition-all group"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-blue-500/10">
                    <Building2 className="w-5 h-5 text-blue-500" />
                  </div>
                  <div>
                    <p className="font-semibold text-surface-950 text-[15px]">Banks</p>
                    <p className="text-[11px] text-surface-600">SimpleFIN</p>
                  </div>
                </div>
                <p
                  className={`text-xl font-bold ${bankTotal < 0 ? 'text-red-400' : 'text-surface-950'}`}
                >
                  {formatUsd(bankTotal)}
                </p>
              </div>
              {grandTotal > 0 && bankTotal > 0 && (
                <div className="w-full h-1.5 bg-surface-200/50 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all duration-500"
                    style={{ width: `${(bankTotal / grandTotal) * 100}%` }}
                  />
                </div>
              )}
            </button>
          </div>

          {/* Combined Holdings */}
          {slices.length > 0 && (
            <div className="glass-card rounded-xl overflow-hidden">
              <div className="px-5 pt-5 pb-2">
                <h3 className="text-[14px] font-semibold text-surface-950">All Holdings</h3>
              </div>

              {/* Table header */}
              <div className="px-5">
                <div className="grid grid-cols-12 gap-2 py-2 text-[11px] font-medium text-surface-500 uppercase tracking-wider border-b border-border/50">
                  <div className="col-span-4">Asset</div>
                  <div className="col-span-2 text-right">Value</div>
                  <div className="col-span-2 text-right">Gain/Loss</div>
                  <div className="col-span-2 text-right">Allocation</div>
                  <div className="col-span-2 text-right">Type</div>
                </div>

                {topSlices.map((slice, i) => {
                  const pct = grandTotal > 0 ? (slice.value / grandTotal) * 100 : 0;
                  const barColor = SLICE_COLORS[i % SLICE_COLORS.length];
                  return (
                    <div
                      key={`${slice.label}-${slice.detail || i}`}
                      className="grid grid-cols-12 gap-2 py-3 border-b border-border/30 last:border-0 items-center"
                    >
                      <div className="col-span-4">
                        <p className="text-[13px] font-mono font-bold text-surface-950">
                          {slice.label}
                        </p>
                        {slice.detail && (
                          <p className="text-[11px] text-surface-500">{slice.detail}</p>
                        )}
                      </div>
                      <div className="col-span-2 text-right">
                        <span className="text-[13px] font-medium text-surface-950">
                          {formatUsd(slice.value)}
                        </span>
                      </div>
                      <div className="col-span-2 text-right">
                        {slice.gainLoss != null && slice.gainLoss !== 0 ? (
                          <div>
                            <span
                              className={`text-[12px] font-medium ${
                                slice.gainLoss >= 0 ? 'text-green-500' : 'text-red-500'
                              }`}
                            >
                              {slice.gainLoss >= 0 ? '+' : ''}
                              {formatUsd(slice.gainLoss)}
                            </span>
                            {slice.gainType && slice.gainType !== 'unknown' && (
                              <p className="text-[9px] text-surface-500 uppercase">
                                {slice.gainType === 'short-term' ? 'ST' : 'LT'}
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-[11px] text-surface-500">—</span>
                        )}
                      </div>
                      <div className="col-span-2">
                        <div className="flex items-center gap-2 justify-end">
                          <div className="w-16 h-1.5 bg-surface-200/50 rounded-full overflow-hidden">
                            <div
                              className={`h-full ${barColor} rounded-full`}
                              style={{ width: `${Math.max(pct, 0.5)}%` }}
                            />
                          </div>
                          <span className="text-[11px] text-surface-500 tabular-nums w-10 text-right">
                            {pct.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                      <div className="col-span-2 text-right">
                        <span
                          className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium ${
                            slice.type === 'crypto'
                              ? 'text-amber-500 bg-amber-500/10'
                              : 'text-accent-400 bg-accent-500/10'
                          }`}
                        >
                          {slice.type === 'crypto' ? 'Crypto' : 'Stock'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {hiddenCount > 0 && (
                <button
                  onClick={() => setShowAllSlices(!showAllSlices)}
                  className="w-full flex items-center justify-center gap-1.5 py-3 text-[12px] font-medium text-violet-500 hover:bg-violet-500/5 transition-colors border-t border-border/30"
                >
                  {showAllSlices ? (
                    <>
                      <ChevronUp className="w-3.5 h-3.5" />
                      Show top 10 only
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-3.5 h-3.5" />
                      Show all {slices.length} holdings ({hiddenCount} more)
                    </>
                  )}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
