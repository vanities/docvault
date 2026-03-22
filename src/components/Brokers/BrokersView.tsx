import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  Plus,
  Trash2,
  Clock,
  ChevronDown,
  ChevronUp,
  Landmark,
  PiggyBank,
  X,
} from 'lucide-react';
import type { BrokerAccount, BrokerPortfolio, BrokerId } from '../../types';
import { API_BASE } from '../../constants';

const BROKER_LABELS: Record<BrokerId, string> = {
  vanguard: 'Vanguard',
  fidelity: 'Fidelity',
  robinhood: 'Robinhood',
  'navy-federal': 'Navy Federal',
};

const BROKER_COLORS: Record<BrokerId, string> = {
  vanguard: 'text-red-500 bg-red-500/10',
  fidelity: 'text-green-500 bg-green-500/10',
  robinhood: 'text-emerald-400 bg-emerald-400/10',
  'navy-federal': 'text-blue-600 bg-blue-600/10',
};

function formatUsd(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  });
}

function formatPercent(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
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

function GainLossBadge({ value, percent }: { value: number; percent?: number }) {
  const isPositive = value >= 0;
  const Icon = isPositive ? TrendingUp : TrendingDown;
  const colorClass = isPositive ? 'text-green-500 bg-green-500/10' : 'text-red-500 bg-red-500/10';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] font-medium ${colorClass}`}>
      <Icon className="w-3 h-3" />
      {formatUsd(Math.abs(value))}
      {percent !== undefined && <span className="text-[11px] opacity-80">({formatPercent(percent)})</span>}
    </span>
  );
}

// Add Holding Modal
function AddHoldingModal({
  onAdd,
  onClose,
}: {
  onAdd: (holding: { ticker: string; shares: number; costBasis?: number }) => void;
  onClose: () => void;
}) {
  const [ticker, setTicker] = useState('');
  const [shares, setShares] = useState('');
  const [costBasis, setCostBasis] = useState('');

  const handleSubmit = () => {
    if (!ticker || !shares) return;
    onAdd({
      ticker: ticker.toUpperCase().trim(),
      shares: parseFloat(shares),
      costBasis: costBasis ? parseFloat(costBasis) : undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative glass-card rounded-2xl p-6 w-full max-w-sm animate-scale-in">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[16px] font-semibold text-surface-950">Add Holding</h3>
          <button onClick={onClose} className="p-1 hover:bg-surface-200/50 rounded-lg">
            <X className="w-4 h-4 text-surface-600" />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-[12px] font-medium text-surface-700 mb-1 block">Ticker Symbol</label>
            <input
              value={ticker}
              onChange={(e) => setTicker(e.target.value)}
              placeholder="e.g. VTI, AAPL, FXAIX"
              className="w-full px-3 py-2 bg-surface-200/30 border border-border rounded-lg text-[13px] text-surface-950 placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30"
              autoFocus
            />
          </div>
          <div>
            <label className="text-[12px] font-medium text-surface-700 mb-1 block">Shares</label>
            <input
              type="number"
              step="any"
              value={shares}
              onChange={(e) => setShares(e.target.value)}
              placeholder="e.g. 100"
              className="w-full px-3 py-2 bg-surface-200/30 border border-border rounded-lg text-[13px] text-surface-950 placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30"
            />
          </div>
          <div>
            <label className="text-[12px] font-medium text-surface-700 mb-1 block">
              Cost Basis (total, optional)
            </label>
            <input
              type="number"
              step="any"
              value={costBasis}
              onChange={(e) => setCostBasis(e.target.value)}
              placeholder="e.g. 25000"
              className="w-full px-3 py-2 bg-surface-200/30 border border-border rounded-lg text-[13px] text-surface-950 placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30"
            />
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 text-[13px] font-medium text-surface-700 hover:bg-surface-200/50 rounded-xl transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!ticker || !shares}
            className="flex-1 px-4 py-2.5 text-[13px] font-medium bg-accent-500 text-surface-0 rounded-xl hover:bg-accent-400 transition-colors disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

// Add Account Modal
function AddAccountModal({
  onAdd,
  onClose,
}: {
  onAdd: (broker: BrokerId, name: string) => void;
  onClose: () => void;
}) {
  const [broker, setBroker] = useState<BrokerId>('vanguard');
  const [name, setName] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative glass-card rounded-2xl p-6 w-full max-w-sm animate-scale-in">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[16px] font-semibold text-surface-950">Add Account</h3>
          <button onClick={onClose} className="p-1 hover:bg-surface-200/50 rounded-lg">
            <X className="w-4 h-4 text-surface-600" />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-[12px] font-medium text-surface-700 mb-1 block">Brokerage</label>
            <select
              value={broker}
              onChange={(e) => setBroker(e.target.value as BrokerId)}
              className="w-full px-3 py-2 bg-surface-200/30 border border-border rounded-lg text-[13px] text-surface-950 focus:outline-none focus:ring-2 focus:ring-accent-500/30"
            >
              <option value="vanguard">Vanguard</option>
              <option value="fidelity">Fidelity</option>
              <option value="robinhood">Robinhood</option>
              <option value="navy-federal">Navy Federal</option>
            </select>
          </div>
          <div>
            <label className="text-[12px] font-medium text-surface-700 mb-1 block">Account Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Roth IRA, Brokerage, 401k"
              className="w-full px-3 py-2 bg-surface-200/30 border border-border rounded-lg text-[13px] text-surface-950 placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30"
              autoFocus
            />
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 text-[13px] font-medium text-surface-700 hover:bg-surface-200/50 rounded-xl transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => { if (name.trim()) onAdd(broker, name.trim()); }}
            disabled={!name.trim()}
            className="flex-1 px-4 py-2.5 text-[13px] font-medium bg-accent-500 text-surface-0 rounded-xl hover:bg-accent-400 transition-colors disabled:opacity-50"
          >
            Add Account
          </button>
        </div>
      </div>
    </div>
  );
}

// Account Card
function AccountCard({
  account,
  onAddHolding,
  onRemoveHolding,
  onDeleteAccount,
}: {
  account: BrokerAccount;
  onAddHolding: (accountId: string, holding: { ticker: string; shares: number; costBasis?: number }) => void;
  onRemoveHolding: (accountId: string, ticker: string) => void;
  onDeleteAccount: (accountId: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [showAddHolding, setShowAddHolding] = useState(false);
  const brokerColor = BROKER_COLORS[account.broker] || 'text-surface-600 bg-surface-200/50';
  const sortedHoldings = [...account.holdings].sort(
    (a, b) => (b.marketValue || 0) - (a.marketValue || 0)
  );

  return (
    <div className="glass-card rounded-xl overflow-hidden">
      {/* Account Header */}
      <div
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-surface-200/20 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${brokerColor.split(' ').slice(1).join(' ')}`}>
            <Landmark className={`w-4 h-4 ${brokerColor.split(' ')[0]}`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="font-semibold text-surface-950 text-[14px]">{account.name}</p>
              <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium ${brokerColor}`}>
                {BROKER_LABELS[account.broker]}
              </span>
            </div>
            <p className="text-[11px] text-surface-600">
              {account.holdings.length} holding{account.holdings.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="font-bold text-surface-950 text-[16px]">
              {formatUsd(account.totalValue)}
            </p>
            {account.totalCostBasis > 0 && (
              <GainLossBadge
                value={account.totalGainLoss}
                percent={account.totalCostBasis > 0 ? (account.totalGainLoss / account.totalCostBasis) * 100 : 0}
              />
            )}
          </div>
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-surface-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-surface-500" />
          )}
        </div>
      </div>

      {/* Holdings Table */}
      {expanded && (
        <div className="border-t border-border">
          {sortedHoldings.length > 0 && (
            <div className="px-4">
              {/* Table Header */}
              <div className="grid grid-cols-12 gap-2 py-2.5 text-[11px] font-medium text-surface-500 uppercase tracking-wider border-b border-border/50">
                <div className="col-span-4">Holding</div>
                <div className="col-span-2 text-right">Shares</div>
                <div className="col-span-2 text-right">Price</div>
                <div className="col-span-2 text-right">Value</div>
                <div className="col-span-2 text-right">Gain/Loss</div>
              </div>

              {/* Holdings Rows */}
              {sortedHoldings.map((h) => (
                <div
                  key={h.ticker}
                  className="grid grid-cols-12 gap-2 py-3 border-b border-border/30 last:border-0 items-center group"
                >
                  <div className="col-span-4 flex items-center gap-2">
                    <div className="min-w-0">
                      <p className="text-[13px] font-mono font-bold text-surface-950">{h.ticker}</p>
                      {h.label && (
                        <p className="text-[11px] text-surface-500 truncate">{h.label}</p>
                      )}
                    </div>
                  </div>
                  <div className="col-span-2 text-right">
                    <span className="text-[13px] text-surface-800 font-mono">
                      {h.shares.toLocaleString('en-US', { maximumFractionDigits: 4 })}
                    </span>
                  </div>
                  <div className="col-span-2 text-right">
                    <span className="text-[13px] text-surface-700">
                      {h.price ? formatUsd(h.price) : '--'}
                    </span>
                  </div>
                  <div className="col-span-2 text-right">
                    <span className="text-[13px] font-medium text-surface-950">
                      {h.marketValue ? formatUsd(h.marketValue) : '--'}
                    </span>
                  </div>
                  <div className="col-span-2 text-right flex items-center justify-end gap-1">
                    {h.costBasis && h.gainLoss !== undefined ? (
                      <span
                        className={`text-[12px] font-medium ${h.gainLoss >= 0 ? 'text-green-500' : 'text-red-500'}`}
                      >
                        {formatUsd(h.gainLoss)}
                      </span>
                    ) : (
                      <span className="text-[12px] text-surface-500">--</span>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Remove ${h.ticker}?`)) onRemoveHolding(account.id, h.ticker);
                      }}
                      className="p-1 opacity-0 group-hover:opacity-100 text-surface-400 hover:text-danger-400 transition-all"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Action Bar */}
          <div className="flex items-center justify-between px-4 py-3 bg-surface-200/20">
            <button
              onClick={() => setShowAddHolding(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-accent-500 hover:bg-accent-500/10 rounded-lg transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Holding
            </button>
            <button
              onClick={() => {
                if (confirm(`Delete "${account.name}" account and all holdings?`))
                  onDeleteAccount(account.id);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-danger-400 hover:bg-danger-500/10 rounded-lg transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete Account
            </button>
          </div>
        </div>
      )}

      {showAddHolding && (
        <AddHoldingModal
          onAdd={(holding) => {
            onAddHolding(account.id, holding);
            setShowAddHolding(false);
          }}
          onClose={() => setShowAddHolding(false)}
        />
      )}
    </div>
  );
}

// Module-level cache
let cachedPortfolio: BrokerPortfolio | null = null;

export function BrokersView() {
  const [portfolio, setPortfolio] = useState<BrokerPortfolio | null>(cachedPortfolio);
  const [isLoading, setIsLoading] = useState(!cachedPortfolio);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddAccount, setShowAddAccount] = useState(false);

  const loadPortfolio = useCallback(async (showRefresh = false) => {
    if (showRefresh) setIsRefreshing(true);
    else if (!cachedPortfolio) setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/brokers/portfolio`);
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      cachedPortfolio = data;
      setPortfolio(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load portfolio');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!cachedPortfolio) void loadPortfolio();
  }, [loadPortfolio]);

  const handleAddAccount = async (broker: BrokerId, name: string) => {
    try {
      const res = await fetch(`${API_BASE}/brokers/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ broker, name }),
      });
      if (!res.ok) throw new Error('Failed to add account');
      setShowAddAccount(false);
      void loadPortfolio(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add account');
    }
  };

  const handleAddHolding = async (
    accountId: string,
    holding: { ticker: string; shares: number; costBasis?: number }
  ) => {
    // Get current holdings and add the new one
    const account = portfolio?.accounts.find((a) => a.id === accountId);
    if (!account) return;
    const updatedHoldings = [...account.holdings.map((h) => ({
      ticker: h.ticker,
      shares: h.shares,
      costBasis: h.costBasis,
      label: h.label,
    })), holding];

    try {
      const res = await fetch(`${API_BASE}/brokers/accounts/${encodeURIComponent(accountId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ holdings: updatedHoldings }),
      });
      if (!res.ok) throw new Error('Failed to add holding');
      void loadPortfolio(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add holding');
    }
  };

  const handleRemoveHolding = async (accountId: string, ticker: string) => {
    const account = portfolio?.accounts.find((a) => a.id === accountId);
    if (!account) return;
    const updatedHoldings = account.holdings
      .filter((h) => h.ticker !== ticker)
      .map((h) => ({
        ticker: h.ticker,
        shares: h.shares,
        costBasis: h.costBasis,
        label: h.label,
      }));

    try {
      const res = await fetch(`${API_BASE}/brokers/accounts/${encodeURIComponent(accountId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ holdings: updatedHoldings }),
      });
      if (!res.ok) throw new Error('Failed to remove holding');
      void loadPortfolio(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove holding');
    }
  };

  const handleDeleteAccount = async (accountId: string) => {
    try {
      const res = await fetch(`${API_BASE}/brokers/accounts/${encodeURIComponent(accountId)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete account');
      void loadPortfolio(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete account');
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto px-4 md:px-6 py-8">
        <h2 className="text-2xl font-bold text-surface-950 mb-6">Brokerage Portfolio</h2>
        <div className="text-center py-20 text-surface-600">Loading portfolio...</div>
      </div>
    );
  }

  const hasAccounts = portfolio && portfolio.accounts.length > 0;

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-surface-950">Brokerage Portfolio</h2>
          {portfolio?.lastUpdated && (
            <p className="text-[12px] text-surface-600 mt-1 flex items-center gap-1.5">
              <Clock className="w-3 h-3" />
              Prices updated {timeAgo(portfolio.lastUpdated)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAddAccount(true)}
            className="flex items-center gap-2 px-4 py-2.5 text-[14px] font-medium text-surface-800 hover:bg-surface-200/50 rounded-xl transition-colors border border-border"
          >
            <Plus className="w-4 h-4" />
            Add Account
          </button>
          {hasAccounts && (
            <button
              onClick={() => loadPortfolio(true)}
              disabled={isRefreshing}
              className="flex items-center gap-2 px-5 py-2.5 bg-accent-500 text-surface-0 rounded-xl hover:bg-accent-400 transition-colors disabled:opacity-50 text-[14px] font-medium shadow-sm"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              {isRefreshing ? 'Refreshing...' : 'Refresh Prices'}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-4 bg-danger-500/10 border border-danger-500/20 rounded-xl mb-6">
          <AlertCircle className="w-5 h-5 text-danger-400" />
          <span className="text-[13px] text-danger-400">{error}</span>
        </div>
      )}

      {!hasAccounts ? (
        <div className="glass-card rounded-xl p-10 text-center">
          <div className="p-4 bg-accent-500/10 rounded-2xl w-fit mx-auto mb-5">
            <PiggyBank className="w-8 h-8 text-accent-400" />
          </div>
          <h3 className="text-lg font-semibold text-surface-950 mb-2">No Brokerage Accounts</h3>
          <p className="text-[13px] text-surface-600 max-w-sm mx-auto mb-5">
            Add your Vanguard, Fidelity, Robinhood, or Navy Federal accounts to track your investment holdings with live prices.
          </p>
          <p className="text-[11px] text-surface-500 max-w-sm mx-auto mb-5">
            Note: These brokerages don't offer public APIs for retail investors, so holdings are entered manually. Prices are fetched automatically.
          </p>
          <button
            onClick={() => setShowAddAccount(true)}
            className="px-5 py-2.5 bg-accent-500 text-surface-0 rounded-xl hover:bg-accent-400 transition-colors text-[14px] font-medium"
          >
            Add Your First Account
          </button>
        </div>
      ) : (
        <>
          {/* Portfolio Summary */}
          <div className="glass-card rounded-xl p-6 mb-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[12px] text-surface-600 uppercase tracking-wider mb-1">
                  Total Portfolio Value
                </p>
                <p className="text-3xl font-bold text-surface-950">
                  {formatUsd(portfolio?.totalValue || 0)}
                </p>
                <p className="text-[12px] text-surface-600 mt-1">
                  {portfolio?.accounts.length || 0} account
                  {(portfolio?.accounts.length || 0) !== 1 ? 's' : ''}
                </p>
              </div>
              {portfolio && portfolio.totalCostBasis > 0 && (
                <div className="text-right">
                  <p className="text-[11px] text-surface-500 mb-1">Total Gain/Loss</p>
                  <GainLossBadge
                    value={portfolio.totalGainLoss}
                    percent={(portfolio.totalGainLoss / portfolio.totalCostBasis) * 100}
                  />
                  <p className="text-[11px] text-surface-500 mt-1">
                    Cost: {formatUsd(portfolio.totalCostBasis)}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Account Cards */}
          <div className="space-y-4">
            {portfolio?.accounts.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                onAddHolding={handleAddHolding}
                onRemoveHolding={handleRemoveHolding}
                onDeleteAccount={handleDeleteAccount}
              />
            ))}
          </div>
        </>
      )}

      {showAddAccount && (
        <AddAccountModal
          onAdd={handleAddAccount}
          onClose={() => setShowAddAccount(false)}
        />
      )}
    </div>
  );
}
