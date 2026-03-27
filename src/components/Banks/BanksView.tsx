import { useState, useEffect, useCallback } from 'react';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import {
  Building2,
  RefreshCw,
  Loader2,
  CreditCard,
  PiggyBank,
  Landmark,
  AlertCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  Car,
  DollarSign,
  BarChart3,
  Link,
  Unlink,
  ExternalLink,
} from 'lucide-react';
import type { PortfolioSnapshot } from '../../types';
import { API_BASE } from '../../constants';
import { HistoryChart } from '../common/HistoryChart';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

// Types

interface SimplefinAccount {
  id: string;
  name: string;
  connId: string;
  currency: string;
  balance: number;
  availableBalance: number | null;
  balanceDate: number | null;
  connectionName?: string;
}

interface SimplefinBalanceCache {
  accounts: SimplefinAccount[];
  lastUpdated: string;
}

// Institution colors
const INST_COLORS = [
  { bg: 'bg-blue-500/10', text: 'text-blue-500', bar: 'bg-blue-500' },
  { bg: 'bg-emerald-500/10', text: 'text-emerald-500', bar: 'bg-emerald-500' },
  { bg: 'bg-violet-500/10', text: 'text-violet-500', bar: 'bg-violet-500' },
  { bg: 'bg-amber-500/10', text: 'text-amber-500', bar: 'bg-amber-500' },
  { bg: 'bg-rose-500/10', text: 'text-rose-500', bar: 'bg-rose-500' },
  { bg: 'bg-cyan-500/10', text: 'text-cyan-500', bar: 'bg-cyan-500' },
  { bg: 'bg-orange-500/10', text: 'text-orange-500', bar: 'bg-orange-500' },
  { bg: 'bg-indigo-500/10', text: 'text-indigo-500', bar: 'bg-indigo-500' },
];

// Helpers

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

function accountIcon(name: string) {
  const lower = name.toLowerCase();
  if (
    lower.includes('credit') ||
    lower.includes('card') ||
    lower.includes('visa') ||
    lower.includes('amex') ||
    lower.includes('mastercard')
  )
    return <CreditCard className="w-3.5 h-3.5" />;
  if (lower.includes('saving') || lower.includes('money market'))
    return <PiggyBank className="w-3.5 h-3.5" />;
  if (
    lower.includes('loan') ||
    lower.includes('vehicle') ||
    lower.includes('auto') ||
    lower.includes('mortgage')
  )
    return <Car className="w-3.5 h-3.5" />;
  if (lower.includes('checking') || lower.includes('chk'))
    return <DollarSign className="w-3.5 h-3.5" />;
  return <Landmark className="w-3.5 h-3.5" />;
}

function accountType(name: string): string {
  const lower = name.toLowerCase();
  if (
    lower.includes('credit') ||
    lower.includes('visa') ||
    lower.includes('amex') ||
    lower.includes('mastercard') ||
    lower.includes('rewards')
  )
    return 'Credit Card';
  if (lower.includes('saving')) return 'Savings';
  if (lower.includes('money market')) return 'Money Market';
  if (lower.includes('vehicle') || lower.includes('auto')) return 'Auto Loan';
  if (lower.includes('mortgage')) return 'Mortgage';
  if (lower.includes('loan') || lower.includes('line of credit')) return 'Loan';
  if (lower.includes('checking') || lower.includes('chk')) return 'Checking';
  return 'Account';
}

// Extract mask (last 4 digits) from account name like "Account Name (1234)"
function extractMask(name: string): { displayName: string; mask: string | null } {
  const match = name.match(/^(.+?)\s*[(-]\s*(\d{4})\s*\)?$/);
  if (match) return { displayName: match[1].replace(/\s*-\s*$/, '').trim(), mask: match[2] };
  return { displayName: name, mask: null };
}

// Module-level cache
let cachedData: SimplefinBalanceCache | null = null;

// Institution Card Component
function InstitutionCard({
  name,
  accounts,
  totalBalance,
  colorIndex,
  grandTotal,
}: {
  name: string;
  accounts: SimplefinAccount[];
  totalBalance: number;
  colorIndex: number;
  grandTotal: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const colors = INST_COLORS[colorIndex % INST_COLORS.length];
  const pct = grandTotal !== 0 ? Math.abs(totalBalance / grandTotal) * 100 : 0;

  // Sort: checking first, then savings, then credit cards, then loans
  const sorted = [...accounts].sort((a, b) => {
    const order = (n: string) => {
      const l = n.toLowerCase();
      if (l.includes('checking') || l.includes('chk')) return 0;
      if (l.includes('saving') || l.includes('money market')) return 1;
      if (l.includes('credit') || l.includes('visa') || l.includes('amex') || l.includes('rewards'))
        return 2;
      if (l.includes('loan') || l.includes('vehicle')) return 3;
      return 4;
    };
    return order(a.name) - order(b.name);
  });

  return (
    <Card variant="glass" className="overflow-hidden">
      {/* Header */}
      <button className="w-full p-5 pb-3 text-left" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2.5">
            <div className={`p-2 rounded-lg ${colors.bg}`}>
              <Building2 className={`w-4 h-4 ${colors.text}`} />
            </div>
            <div>
              <p className="font-semibold text-surface-950 text-[14px]">{name}</p>
              <p className="text-[11px] text-surface-600">
                {accounts.length} account{accounts.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <div className="text-right flex items-center gap-2">
            <div>
              <p
                className={`font-bold text-[18px] ${totalBalance < 0 ? 'text-red-400' : 'text-surface-950'}`}
              >
                {formatUsd(totalBalance)}
              </p>
              <p className="text-[11px] text-surface-500 tabular-nums text-right">
                {pct.toFixed(1)}%
              </p>
            </div>
            {expanded ? (
              <ChevronUp className="w-4 h-4 text-surface-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-surface-400" />
            )}
          </div>
        </div>

        {/* Allocation bar */}
        <div className="w-full h-1.5 bg-surface-200/50 rounded-full overflow-hidden">
          <div
            className={`h-full ${colors.bar} rounded-full transition-all duration-500 ease-out`}
            style={{ width: `${Math.max(pct, 0.5)}%` }}
          />
        </div>
      </button>

      {/* Account rows */}
      {expanded && (
        <div className="border-t border-border">
          <div className="px-5">
            {sorted.map((acct) => {
              const { displayName, mask } = extractMask(acct.name);
              const type = accountType(acct.name);
              const isNegative = acct.balance < 0;

              return (
                <div
                  key={acct.id}
                  className="flex items-center justify-between py-3 border-b border-border/30 last:border-0"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-surface-500">{accountIcon(acct.name)}</span>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <p className="text-[13px] font-medium text-surface-900">{displayName}</p>
                        {mask && (
                          <span className="text-[11px] text-surface-500 font-mono">····{mask}</span>
                        )}
                      </div>
                      <p className="text-[11px] text-surface-500">{type}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p
                      className={`text-[14px] font-mono font-semibold tabular-nums ${isNegative ? 'text-red-400' : 'text-surface-950'}`}
                    >
                      {formatUsd(acct.balance)}
                    </p>
                    {acct.availableBalance !== null && acct.availableBalance !== acct.balance && (
                      <p className="text-[11px] text-surface-500 font-mono tabular-nums">
                        {formatUsd(acct.availableBalance)} avail.
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

// SimpleFIN Connection Banner
function SimplefinBanner({
  configured,
  onRefresh,
  onDisconnect,
  isRefreshing,
}: {
  configured: boolean | null;
  onRefresh: () => void;
  onDisconnect: () => void;
  isRefreshing: boolean;
}) {
  if (configured === null) return null;

  if (!configured) {
    return (
      <Card variant="glass" className="p-4 mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-500/10 shrink-0">
            <Link className="w-4 h-4 text-blue-500" />
          </div>
          <div>
            <p className="text-[13px] font-medium text-surface-950">Connect with SimpleFIN</p>
            <p className="text-[11px] text-surface-600">
              Link 16,000+ US bank accounts. $15/year via SimpleFIN Bridge.
            </p>
          </div>
        </div>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            // Navigate to settings - dispatch a custom event
            window.dispatchEvent(new CustomEvent('navigate-to-settings'));
          }}
          className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium bg-blue-500 text-surface-0 rounded-xl hover:bg-blue-400 transition-colors ml-auto"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Set Up in Settings
        </a>
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
            <p className="text-[13px] font-medium text-surface-950">SimpleFIN Connected</p>
            <Button
              type="button"
              variant="ghost-danger"
              size="icon-sm"
              onClick={onDisconnect}
              title="Disconnect SimpleFIN"
            >
              <Unlink className="w-3.5 h-3.5" />
            </Button>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-surface-600">
              Bank accounts synced via SimpleFIN Bridge. Refresh to fetch latest balances.
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onRefresh}
              disabled={isRefreshing}
              className="text-accent-500 hover:bg-accent-500/10 hover:text-accent-500 shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              {isRefreshing ? 'Syncing...' : 'Sync'}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

// Main Component

export function BanksView() {
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const [data, setData] = useState<SimplefinBalanceCache | null>(cachedData);
  const [isLoading, setIsLoading] = useState(!cachedData);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [snapshots, setSnapshots] = useState<PortfolioSnapshot[]>([]);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/simplefin/status`);
      const status = await res.json();
      setConfigured(status.configured);
    } catch {
      setConfigured(false);
    }
  }, []);

  const loadBalances = useCallback(async (live = false) => {
    if (live) setIsRefreshing(true);
    else setIsLoading(true);
    setError(null);

    try {
      const url = live
        ? `${API_BASE}/simplefin/balances`
        : `${API_BASE}/simplefin/balances?cached=1`;
      const res = await fetch(url);
      const result = (await res.json()) as SimplefinBalanceCache & { error?: string };
      if (result.error) throw new Error(result.error);

      // If cached returned empty, try live
      if (!live && (!result.accounts || result.accounts.length === 0) && !result.lastUpdated) {
        const liveRes = await fetch(`${API_BASE}/simplefin/balances`);
        const liveResult = (await liveRes.json()) as SimplefinBalanceCache & { error?: string };
        if (liveResult.error) throw new Error(liveResult.error);
        cachedData = liveResult;
        setData(liveResult);
      } else {
        cachedData = result;
        setData(result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load balances');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  const handleDisconnect = async () => {
    if (
      !(await confirm({
        description: 'Disconnect SimpleFIN? This will remove your bank account connection.',
        confirmLabel: 'Disconnect',
        destructive: true,
      }))
    )
      return;
    try {
      await fetch(`${API_BASE}/simplefin`, { method: 'DELETE' });
      setConfigured(false);
      setData(null);
      cachedData = null;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    }
  };

  useEffect(() => {
    void loadStatus();
    void loadBalances();
    void fetch(`${API_BASE}/portfolio/snapshots`)
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d)) setSnapshots(d);
      })
      .catch(() => {});
  }, [loadStatus, loadBalances]);

  // Group accounts by connection (institution)
  const accountsByConnection = (data?.accounts || []).reduce(
    (acc, acct) => {
      const key = acct.connectionName || 'Unknown';
      if (!acc[key]) acc[key] = [];
      acc[key].push(acct);
      return acc;
    },
    {} as Record<string, SimplefinAccount[]>
  );

  // Calculate totals
  const totalBalance = (data?.accounts || []).reduce((sum, a) => sum + (a.balance || 0), 0);
  const positiveBalance = (data?.accounts || [])
    .filter((a) => a.balance >= 0)
    .reduce((sum, a) => sum + a.balance, 0);
  const negativeBalance = (data?.accounts || [])
    .filter((a) => a.balance < 0)
    .reduce((sum, a) => sum + a.balance, 0);
  const hasAccounts = (data?.accounts?.length || 0) > 0;

  // Sort institutions by total balance descending
  const sortedInstitutions = Object.entries(accountsByConnection)
    .map(([name, accounts]) => ({
      name,
      accounts,
      total: accounts.reduce((sum, a) => sum + a.balance, 0),
    }))
    .sort((a, b) => b.total - a.total);

  // Not configured — prompt to set up
  if (configured === false) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <h2 className="font-display text-2xl text-surface-950 mb-1 italic">Banks</h2>
        <p className="text-[14px] text-surface-600 mb-8">Connect bank accounts via SimpleFIN</p>

        <Card variant="glass" className="rounded-2xl p-10 text-center">
          <div className="p-4 bg-blue-500/10 rounded-2xl w-fit mx-auto mb-5">
            <Building2 className="w-8 h-8 text-blue-500" />
          </div>
          <h3 className="text-lg font-semibold text-surface-950 mb-2">Set Up SimpleFIN</h3>
          <p className="text-[13px] text-surface-600 mb-6 max-w-sm mx-auto">
            Connect your bank accounts via SimpleFIN Bridge ($15/year). Supports 16,000+ US
            institutions including Navy Federal & Chase.
          </p>
          <p className="text-[12px] text-surface-500">
            Go to <span className="font-medium text-accent-400">Settings</span> &rarr;{' '}
            <span className="font-medium text-accent-400">Bank Accounts (SimpleFIN)</span>
          </p>
        </Card>
      </div>
    );
  }

  // Loading
  if (isLoading && configured === null) {
    return (
      <div className="p-6 max-w-3xl mx-auto flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-6 h-6 text-accent-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-display text-2xl text-surface-950 mb-1 italic">Banks</h2>
          {data?.lastUpdated && (
            <p className="text-[13px] text-surface-500 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              Updated {timeAgo(data.lastUpdated)}
            </p>
          )}
        </div>
        {hasAccounts && (
          <Button
            type="button"
            variant="outline"
            onClick={() => loadBalances(true)}
            disabled={isRefreshing}
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </Button>
        )}
      </div>

      {/* SimpleFIN Banner */}
      <SimplefinBanner
        configured={configured}
        onRefresh={() => loadBalances(true)}
        onDisconnect={handleDisconnect}
        isRefreshing={isRefreshing}
      />

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-3 mb-6 bg-danger-500/10 border border-danger-500/20 rounded-xl">
          <AlertCircle className="w-4 h-4 text-danger-400 flex-shrink-0" />
          <p className="text-[13px] text-danger-400">{error}</p>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <Card variant="glass" className="p-10 text-center">
          <Loader2 className="w-6 h-6 text-accent-400 animate-spin mx-auto mb-3" />
          <p className="text-[13px] text-surface-600">Loading bank accounts...</p>
        </Card>
      )}

      {/* Empty state */}
      {!isLoading && !hasAccounts && configured && (
        <Card variant="glass" className="rounded-2xl p-10 text-center">
          <div className="p-4 bg-blue-500/10 rounded-2xl w-fit mx-auto mb-5">
            <Building2 className="w-8 h-8 text-blue-500" />
          </div>
          <h3 className="text-lg font-semibold text-surface-950 mb-2">No Bank Accounts</h3>
          <p className="text-[13px] text-surface-600 mb-6 max-w-sm mx-auto">
            SimpleFIN is connected but no accounts found yet. Make sure you&apos;ve linked your
            banks at{' '}
            <a
              href="https://beta-bridge.simplefin.org"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-400 hover:underline"
            >
              beta-bridge.simplefin.org
            </a>
          </p>
        </Card>
      )}

      {/* Content */}
      {hasAccounts && !isLoading && (
        <>
          {/* Summary card */}
          <Card variant="glass" className="p-5 mb-6">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-[11px] text-surface-500 uppercase tracking-wider mb-1">
                  Net Balance
                </p>
                <p
                  className={`text-2xl font-mono font-bold tabular-nums ${totalBalance < 0 ? 'text-red-400' : 'text-surface-950'}`}
                >
                  {formatUsd(totalBalance)}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-surface-500 uppercase tracking-wider mb-1">Assets</p>
                <p className="text-lg font-mono font-semibold text-emerald-400 tabular-nums">
                  {formatUsd(positiveBalance)}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-surface-500 uppercase tracking-wider mb-1">
                  Liabilities
                </p>
                <p className="text-lg font-mono font-semibold text-red-400 tabular-nums">
                  {formatUsd(negativeBalance)}
                </p>
              </div>
            </div>

            {/* Allocation bar showing all institutions */}
            <div className="mt-4 flex items-center gap-3">
              <div className="flex-1 h-2.5 bg-surface-200/50 rounded-full overflow-hidden flex">
                {sortedInstitutions
                  .filter((i) => i.total > 0)
                  .map((inst, idx) => {
                    const pct = positiveBalance > 0 ? (inst.total / positiveBalance) * 100 : 0;
                    const colors = INST_COLORS[idx % INST_COLORS.length];
                    return (
                      <div
                        key={inst.name}
                        className={`h-full ${colors.bar} first:rounded-l-full last:rounded-r-full transition-all duration-500`}
                        style={{ width: `${Math.max(pct, 1)}%` }}
                        title={`${inst.name}: ${formatUsd(inst.total)}`}
                      />
                    );
                  })}
              </div>
              <span className="text-[11px] text-surface-500 flex-shrink-0">
                {sortedInstitutions.length} institution{sortedInstitutions.length !== 1 ? 's' : ''}
              </span>
            </div>
          </Card>

          {/* History Chart */}
          {snapshots.filter((s) => (s.bankValue || 0) !== 0).length >= 2 && (
            <Card variant="glass" className="p-5 mb-6">
              <h3 className="text-[14px] font-semibold text-surface-950 mb-3 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-blue-500" />
                Bank History
              </h3>
              <HistoryChart
                snapshots={snapshots}
                lines={[{ key: 'bankValue', label: 'Banks', color: '#3b82f6' }]}
                height={180}
              />
            </Card>
          )}

          {/* Institution cards */}
          <div className="space-y-4">
            {sortedInstitutions.map((inst, idx) => (
              <InstitutionCard
                key={inst.name}
                name={inst.name}
                accounts={inst.accounts}
                totalBalance={inst.total}
                colorIndex={idx}
                grandTotal={positiveBalance || Math.abs(totalBalance)}
              />
            ))}
          </div>
        </>
      )}
      <ConfirmDialog />
    </div>
  );
}
