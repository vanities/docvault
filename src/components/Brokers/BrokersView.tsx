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
  Link,
  ExternalLink,
  Unlink,
} from 'lucide-react';
import type { BrokerAccount, BrokerPortfolio, BrokerId, PortfolioSnapshot } from '../../types';
import { API_BASE } from '../../constants';
import { HistoryChart } from '../common/HistoryChart';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const BROKER_LABELS: Record<BrokerId, string> = {
  vanguard: 'Vanguard',
  fidelity: 'Fidelity',
  robinhood: 'Robinhood',
  'navy-federal': 'Navy Federal',
  chase: 'Chase',
  altoira: 'Alto IRA',
  other: 'Other',
};

const BROKER_COLORS: Record<BrokerId, string> = {
  vanguard: 'text-red-500 bg-red-500/10',
  fidelity: 'text-green-500 bg-green-500/10',
  robinhood: 'text-emerald-400 bg-emerald-400/10',
  'navy-federal': 'text-blue-600 bg-blue-600/10',
  chase: 'text-sky-500 bg-sky-500/10',
  altoira: 'text-orange-500 bg-orange-500/10',
  other: 'text-purple-500 bg-purple-500/10',
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
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] font-medium ${colorClass}`}
    >
      <Icon className="w-3 h-3" />
      {formatUsd(Math.abs(value))}
      {percent !== undefined && (
        <span className="text-[11px] opacity-80">({formatPercent(percent)})</span>
      )}
    </span>
  );
}

// Add Manual Holding Modal
function AddHoldingModal({
  open,
  onAdd,
  onOpenChange,
}: {
  open: boolean;
  onAdd: (holding: {
    ticker: string;
    shares: number;
    costBasis?: number;
    purchaseDate?: string;
  }) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [ticker, setTicker] = useState('');
  const [shares, setShares] = useState('');
  const [costBasis, setCostBasis] = useState('');
  const [purchaseDate, setPurchaseDate] = useState('');

  const handleSubmit = () => {
    if (!ticker || !shares) return;
    onAdd({
      ticker: ticker.toUpperCase().trim(),
      shares: parseFloat(shares),
      costBasis: costBasis ? parseFloat(costBasis) : undefined,
      purchaseDate: purchaseDate || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Manual Holding</DialogTitle>
          <DialogDescription>
            Add a holding with ticker, shares, and optional cost basis.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-[12px] font-medium text-surface-700 mb-1 block">
              Ticker Symbol
            </label>
            <Input
              value={ticker}
              onChange={(e) => setTicker(e.target.value)}
              placeholder="e.g. VTI, AAPL, FXAIX"
              className="text-[13px]"
              autoFocus
            />
          </div>
          <div>
            <label className="text-[12px] font-medium text-surface-700 mb-1 block">Shares</label>
            <Input
              type="number"
              step="any"
              value={shares}
              onChange={(e) => setShares(e.target.value)}
              placeholder="e.g. 100"
              className="text-[13px]"
            />
          </div>
          <div>
            <label className="text-[12px] font-medium text-surface-700 mb-1 block">
              Cost Basis (total, optional)
            </label>
            <Input
              type="number"
              step="any"
              value={costBasis}
              onChange={(e) => setCostBasis(e.target.value)}
              placeholder="e.g. 25000"
              className="text-[13px]"
            />
          </div>
          <div>
            <label className="text-[12px] font-medium text-surface-700 mb-1 block">
              Purchase Date (optional, for gain type)
            </label>
            <Input
              type="date"
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
              className="text-[13px]"
            />
          </div>
        </div>
        <div className="flex gap-2 mt-1">
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="flex-1">
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!ticker || !shares} className="flex-1">
            Add
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Add Manual Account Modal
function AddAccountModal({
  open,
  onAdd,
  onOpenChange,
}: {
  open: boolean;
  onAdd: (broker: BrokerId, name: string, url?: string, overrideValue?: number) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [broker, setBroker] = useState<BrokerId>('vanguard');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [overrideValue, setOverrideValue] = useState('');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Manual Account</DialogTitle>
          <DialogDescription>
            Add a brokerage account to track holdings and balances.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-[12px] font-medium text-surface-700 mb-1 block">
              Institution
            </label>
            <Select value={broker} onValueChange={(val) => setBroker(val as BrokerId)}>
              <SelectTrigger className="w-full text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="vanguard">Vanguard</SelectItem>
                <SelectItem value="fidelity">Fidelity</SelectItem>
                <SelectItem value="robinhood">Robinhood</SelectItem>
                <SelectItem value="navy-federal">Navy Federal</SelectItem>
                <SelectItem value="chase">Chase</SelectItem>
                <SelectItem value="altoira">Alto IRA</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[12px] font-medium text-surface-700 mb-1 block">
              Account Name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Roth IRA, Brokerage, 401k"
              className="text-[13px]"
              autoFocus
            />
          </div>
          <div>
            <label className="text-[12px] font-medium text-surface-700 mb-1 block">
              Website URL (optional)
            </label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="e.g. https://app.altoira.com"
              className="text-[13px]"
            />
          </div>
          <div>
            <label className="text-[12px] font-medium text-surface-700 mb-1 block">
              Override Value (optional)
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-surface-500">
                $
              </span>
              <Input
                type="number"
                value={overrideValue}
                onChange={(e) => setOverrideValue(e.target.value)}
                placeholder="e.g. 39436"
                className="pl-7 text-[13px]"
              />
            </div>
            <p className="text-[11px] text-surface-500 mt-1">
              Set a fixed balance instead of tracking individual holdings
            </p>
          </div>
        </div>
        <div className="flex gap-2 mt-1">
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="flex-1">
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (name.trim()) {
                const ov = overrideValue.trim() ? Number(overrideValue) : undefined;
                onAdd(broker, name.trim(), url.trim() || undefined, ov);
              }
            }}
            disabled={!name.trim()}
            className="flex-1"
          >
            Add Account
          </Button>
        </div>
      </DialogContent>
    </Dialog>
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
  onAddHolding: (
    accountId: string,
    holding: { ticker: string; shares: number; costBasis?: number }
  ) => void;
  onRemoveHolding: (accountId: string, ticker: string) => void;
  onDeleteAccount: (accountId: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [showAddHolding, setShowAddHolding] = useState(false);
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const brokerColor = BROKER_COLORS[account.broker] || 'text-surface-600 bg-surface-200/50';
  const sortedHoldings = [...account.holdings].sort(
    (a, b) => (b.marketValue || 0) - (a.marketValue || 0)
  );

  return (
    <Card variant="glass" className="overflow-hidden">
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
              {account.url && (
                <a
                  href={account.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="p-0.5 text-surface-400 hover:text-accent-500 transition-colors"
                  title={account.url}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
              <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium ${brokerColor}`}>
                {BROKER_LABELS[account.broker]}
              </span>
            </div>
            <p className="text-[11px] text-surface-600">
              {account.overrideValue !== undefined
                ? 'Fixed balance'
                : `${account.holdings.length} holding${account.holdings.length !== 1 ? 's' : ''}`}
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
                percent={
                  account.totalCostBasis > 0
                    ? (account.totalGainLoss / account.totalCostBasis) * 100
                    : 0
                }
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

      {/* Holdings Table / Override Info */}
      {expanded && (
        <div className="border-t border-border">
          {account.overrideValue !== undefined ? (
            <div className="px-4 py-4">
              <p className="text-[12px] text-surface-500">
                Manual balance:{' '}
                <span className="font-medium text-surface-950">
                  {formatUsd(account.overrideValue)}
                </span>
              </p>
            </div>
          ) : (
            sortedHoldings.length > 0 && (
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
                        <p className="text-[13px] font-mono font-bold text-surface-950">
                          {h.ticker}
                        </p>
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
                        <div className="text-right">
                          <span
                            className={`text-[12px] font-medium ${h.gainLoss >= 0 ? 'text-green-500' : 'text-red-500'}`}
                          >
                            {formatUsd(h.gainLoss)}
                          </span>
                          {h.gainType && h.gainType !== 'unknown' && (
                            <span
                              className={`ml-1 text-[9px] px-1 py-0.5 rounded font-medium ${h.gainType === 'long-term' ? 'text-green-600 bg-green-500/10' : 'text-amber-600 bg-amber-500/10'}`}
                            >
                              {h.gainType === 'short-term' ? 'ST' : 'LT'}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-[12px] text-surface-500">--</span>
                      )}
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (
                            await confirm({
                              description: `Remove ${h.ticker}?`,
                              confirmLabel: 'Remove',
                              destructive: true,
                            })
                          )
                            onRemoveHolding(account.id, h.ticker);
                        }}
                        className="p-1 opacity-0 group-hover:opacity-100 text-surface-400 hover:text-danger-400 transition-all"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {/* Action Bar */}
          <div className="flex items-center justify-between px-4 py-3 bg-surface-200/20">
            {account.overrideValue === undefined ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAddHolding(true)}
                className="text-accent-500 hover:bg-accent-500/10"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Manual Holding
              </Button>
            ) : (
              <div />
            )}
            <Button
              variant="ghost-danger"
              size="sm"
              onClick={async () => {
                if (
                  await confirm({
                    description: `Delete "${account.name}" account and all holdings?`,
                    confirmLabel: 'Delete',
                    destructive: true,
                  })
                )
                  onDeleteAccount(account.id);
              }}
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete Account
            </Button>
          </div>
        </div>
      )}

      <AddHoldingModal
        open={showAddHolding}
        onAdd={(holding) => {
          onAddHolding(account.id, holding);
          setShowAddHolding(false);
        }}
        onOpenChange={setShowAddHolding}
      />
      <ConfirmDialog />
    </Card>
  );
}

// SnapTrade Banner
function SnapTradeBanner({
  onConnect,
  onSync,
  onDisconnect,
  status,
  isSyncing,
}: {
  onConnect: () => void;
  onSync: () => void;
  onDisconnect: () => void;
  status: { configured: boolean; registered: boolean } | null;
  isSyncing: boolean;
}) {
  if (!status) return null;

  if (!status.configured) {
    return (
      <Card variant="glass" className="p-4 mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-violet-500/10 shrink-0">
            <Link className="w-4 h-4 text-violet-500" />
          </div>
          <div>
            <p className="text-[13px] font-medium text-surface-950">Auto-sync with SnapTrade</p>
            <p className="text-[11px] text-surface-600">
              Connect Vanguard, Fidelity, Robinhood, Chase &amp; more. Free for 5 accounts.
            </p>
          </div>
        </div>
        <Button
          onClick={() => window.dispatchEvent(new CustomEvent('navigate-to-settings'))}
          className="bg-violet-500 hover:bg-violet-400 ml-auto"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Set Up in Settings
        </Button>
      </Card>
    );
  }

  return (
    <Card variant="glass" className="p-4 mb-6">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-green-500/10 shrink-0 self-start mt-0.5">
          <Link className="w-4 h-4 text-green-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-medium text-surface-950">SnapTrade Connected</p>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={onConnect}
                className="text-violet-500 hover:bg-violet-500/10"
              >
                <Plus className="w-3.5 h-3.5" />
                Link Brokerage
              </Button>
              <Button
                variant="ghost-danger"
                size="icon-sm"
                onClick={onDisconnect}
                title="Disconnect SnapTrade"
              >
                <Unlink className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-surface-600">
              Auto-sync enabled. Connect additional brokerages or sync now.
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={onSync}
              disabled={isSyncing}
              className="text-accent-500 hover:bg-accent-500/10 shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              {isSyncing ? 'Syncing...' : 'Sync'}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

// Module-level cache
let cachedPortfolio: BrokerPortfolio | null = null;

export function BrokersView() {
  const [portfolio, setPortfolio] = useState<BrokerPortfolio | null>(cachedPortfolio);
  const [isLoading, setIsLoading] = useState(!cachedPortfolio);
  const { confirm, ConfirmDialog: BrokersConfirmDialog } = useConfirmDialog();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<PortfolioSnapshot[]>([]);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [snapTradeStatus, setSnapTradeStatus] = useState<{
    configured: boolean;
    registered: boolean;
  } | null>(null);
  const [isSnapSyncing, setIsSnapSyncing] = useState(false);
  const [progress, setProgress] = useState<{
    current: number;
    total: number;
    label: string;
  } | null>(null);

  const loadPortfolio = useCallback(async (showRefresh = false) => {
    if (showRefresh) setIsRefreshing(true);
    else if (!cachedPortfolio) setIsLoading(true);
    setError(null);
    setProgress(null);

    try {
      const res = await fetch(`${API_BASE}/brokers/portfolio?stream=1`);
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
              cachedPortfolio = msg as BrokerPortfolio;
              setPortfolio(msg as BrokerPortfolio);
            }
          } catch {
            // Skip malformed lines
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load portfolio');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
      setProgress(null);
    }
  }, []);

  // On mount: load from server cache first, then full sync if empty
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
        const res = await fetch(`${API_BASE}/brokers/portfolio?cached=1`);
        if (!res.ok) throw new Error('No cache');
        const data = await res.json();
        if (data.accounts?.length > 0) {
          cachedPortfolio = data;
          setPortfolio(data);
          setIsLoading(false);
        } else {
          void loadPortfolio();
        }
      } catch {
        void loadPortfolio();
      }
    })();
  }, [loadPortfolio]);

  // Load SnapTrade status on mount
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/snaptrade/status`);
        if (res.ok) setSnapTradeStatus(await res.json());
      } catch {
        // SnapTrade status check is non-critical
      }
    })();
  }, []);

  const handleSnapTradeConnect = async () => {
    try {
      const res = await fetch(`${API_BASE}/snaptrade/connect`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to get connect URL');
      // Open SnapTrade connection portal in new window
      window.open(data.redirectUrl, 'snaptrade-connect', 'width=500,height=700');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
    }
  };

  const handleSnapTradeSync = async () => {
    setIsSnapSyncing(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/snaptrade/sync`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync failed');
      // Refresh portfolio to show new data
      void loadPortfolio(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'SnapTrade sync failed');
    } finally {
      setIsSnapSyncing(false);
    }
  };

  const handleSnapTradeDisconnect = async () => {
    if (
      !(await confirm({
        description: 'Disconnect SnapTrade? This will remove all synced accounts.',
        confirmLabel: 'Disconnect',
        destructive: true,
      }))
    )
      return;
    try {
      await fetch(`${API_BASE}/snaptrade`, { method: 'DELETE' });
      setSnapTradeStatus({ configured: false, registered: false });
      void loadPortfolio(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    }
  };

  const handleAddAccount = async (
    broker: BrokerId,
    name: string,
    url?: string,
    overrideValue?: number
  ) => {
    try {
      const res = await fetch(`${API_BASE}/brokers/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          broker,
          name,
          ...(url ? { url } : {}),
          ...(overrideValue !== undefined ? { overrideValue } : {}),
        }),
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
    const updatedHoldings = [
      ...account.holdings.map((h) => ({
        ticker: h.ticker,
        shares: h.shares,
        costBasis: h.costBasis,
        label: h.label,
      })),
      holding,
    ];

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

  const progressBar = progress && (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[12px] text-surface-600">
          Fetching prices: <span className="font-medium text-surface-800">{progress.label}</span>
        </p>
        <p className="text-[12px] text-surface-600 tabular-nums">
          {progress.current}/{progress.total}
        </p>
      </div>
      <div className="w-full h-2 bg-surface-200/50 rounded-full overflow-hidden">
        <div
          className="h-full bg-accent-500 rounded-full transition-all duration-300 ease-out"
          style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
        />
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto px-4 md:px-6 py-8">
        <h2 className="text-2xl font-bold text-surface-950 mb-6">Brokerage Portfolio</h2>
        {progressBar || (
          <div className="text-center py-20 text-surface-600">Loading portfolio...</div>
        )}
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
          <Button variant="outline" onClick={() => setShowAddAccount(true)}>
            <Plus className="w-4 h-4" />
            Add Manual Account
          </Button>
          {hasAccounts && (
            <Button onClick={() => loadPortfolio(true)} disabled={isRefreshing}>
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              {isRefreshing ? 'Refreshing...' : 'Refresh Prices'}
            </Button>
          )}
        </div>
      </div>

      {/* SnapTrade Banner */}
      <SnapTradeBanner
        status={snapTradeStatus}
        onConnect={handleSnapTradeConnect}
        onSync={handleSnapTradeSync}
        onDisconnect={handleSnapTradeDisconnect}
        isSyncing={isSnapSyncing}
      />

      {isRefreshing && progressBar}

      {error && (
        <div className="flex items-center gap-2 p-4 bg-danger-500/10 border border-danger-500/20 rounded-xl mb-6">
          <AlertCircle className="w-5 h-5 text-danger-400" />
          <span className="text-[13px] text-danger-400">{error}</span>
        </div>
      )}

      {!hasAccounts ? (
        <Card variant="glass" className="p-10 text-center">
          <div className="p-4 bg-accent-500/10 rounded-2xl w-fit mx-auto mb-5">
            <PiggyBank className="w-8 h-8 text-accent-400" />
          </div>
          <h3 className="text-lg font-semibold text-surface-950 mb-2">No Brokerage Accounts</h3>
          <p className="text-[13px] text-surface-600 max-w-sm mx-auto mb-5">
            Add your Vanguard, Fidelity, Robinhood, Navy Federal, or Chase accounts to track your
            investment holdings with live prices.
          </p>
          <p className="text-[11px] text-surface-500 max-w-sm mx-auto mb-5">
            Note: These brokerages don't offer public APIs for retail investors, so holdings are
            entered manually. Prices are fetched automatically.
          </p>
          <Button onClick={() => setShowAddAccount(true)}>Add Your First Account</Button>
        </Card>
      ) : (
        <>
          {/* Portfolio Summary */}
          <Card variant="glass" className="p-6 mb-6">
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
          </Card>

          {/* History Chart */}
          {snapshots.length >= 2 && (
            <Card variant="glass" className="p-5 mb-6">
              <h3 className="text-[14px] font-semibold text-surface-950 mb-3 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-violet-500" />
                Broker History
              </h3>
              <HistoryChart
                snapshots={snapshots}
                lines={[{ key: 'brokerValue', label: 'Brokers', color: '#8b5cf6' }]}
                height={180}
              />
            </Card>
          )}

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

      <AddAccountModal
        open={showAddAccount}
        onAdd={handleAddAccount}
        onOpenChange={setShowAddAccount}
      />
      <BrokersConfirmDialog />
    </div>
  );
}
