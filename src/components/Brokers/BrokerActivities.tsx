import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, AlertCircle, Search } from 'lucide-react';
import type { BrokerActivity, BrokerAccount } from '../../types';
import { API_BASE } from '../../constants';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Money } from '../common/Money';

interface ActivityResponse {
  activities: BrokerActivity[];
  total: number;
  truncated: boolean;
  updatedAt: string;
}

interface TypesResponse {
  types: Array<{ type: string; count: number }>;
}

const ALL_VALUE = '__all__';

// Color hint for the type badge — keeps the activity table scannable. Unknown
// types fall through to the default gray, which is intentional: the server
// surfaces undocumented types (REI, etc.) without us having to enumerate.
function badgeClassFor(type: string): string {
  switch (type) {
    case 'BUY':
      return 'text-green-600 bg-green-500/10';
    case 'SELL':
      return 'text-red-500 bg-red-500/10';
    case 'DIVIDEND':
    case 'INTEREST':
      return 'text-blue-500 bg-blue-500/10';
    case 'WITHDRAWAL':
    case 'TRANSFER':
      return 'text-orange-500 bg-orange-500/10';
    case 'SWEEP IN':
    case 'SWEEP OUT':
      return 'text-purple-500 bg-purple-500/10';
    default:
      return 'text-surface-700 bg-surface-200/50';
  }
}

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

function formatUsd(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  });
}

function formatUnits(units: number): string {
  return Math.abs(units).toLocaleString('en-US', { maximumFractionDigits: 6 });
}

interface BrokerActivitiesProps {
  accounts: BrokerAccount[];
}

export function BrokerActivities({ accounts }: BrokerActivitiesProps) {
  const [activities, setActivities] = useState<BrokerActivity[]>([]);
  const [total, setTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [updatedAt, setUpdatedAt] = useState('');
  const [types, setTypes] = useState<TypesResponse['types']>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{
    current: number;
    total: number;
    label: string;
  } | null>(null);

  const [accountFilter, setAccountFilter] = useState<string>(ALL_VALUE);
  const [typeFilter, setTypeFilter] = useState<string>(ALL_VALUE);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [query, setQuery] = useState<string>('');

  // Map "snap-<uuid>" account IDs (from BrokerAccount) to bare UUIDs that the
  // activities cache is keyed by.
  const accountOptions = useMemo(
    () =>
      accounts
        .filter((a) => a.id.startsWith('snap-'))
        .map((a) => ({ uuid: a.id.slice('snap-'.length), name: a.name })),
    [accounts]
  );

  const accountNameByUuid = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of accountOptions) m.set(a.uuid, a.name);
    return m;
  }, [accountOptions]);

  const buildQueryString = useCallback(() => {
    const params = new URLSearchParams();
    if (accountFilter !== ALL_VALUE) params.set('accountId', accountFilter);
    if (typeFilter !== ALL_VALUE) params.set('type', typeFilter);
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    if (query.trim()) params.set('q', query.trim());
    return params.toString();
  }, [accountFilter, typeFilter, startDate, endDate, query]);

  const loadActivities = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const qs = buildQueryString();
      const res = await fetch(`${API_BASE}/brokers/activities${qs ? `?${qs}` : ''}`);
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = (await res.json()) as ActivityResponse;
      setActivities(data.activities);
      setTotal(data.total);
      setTruncated(data.truncated);
      setUpdatedAt(data.updatedAt || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load activities');
    } finally {
      setIsLoading(false);
    }
  }, [buildQueryString]);

  const loadTypes = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/brokers/activities/types`);
      if (!res.ok) return;
      const data = (await res.json()) as TypesResponse;
      setTypes(data.types);
    } catch {
      // non-critical — filter dropdown just won't populate
    }
  }, []);

  useEffect(() => {
    void loadActivities();
  }, [loadActivities]);

  useEffect(() => {
    void loadTypes();
  }, [loadTypes]);

  const handleSync = useCallback(async () => {
    setIsSyncing(true);
    setError(null);
    setProgress(null);
    try {
      const res = await fetch(`${API_BASE}/brokers/activities/sync?stream=1`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || `Server error ${res.status}`);
      }
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
            } else if (msg.type === 'error') {
              throw new Error(msg.error);
            }
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message) throw parseErr;
          }
        }
      }
      await loadActivities();
      await loadTypes();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setIsSyncing(false);
      setProgress(null);
    }
  }, [loadActivities, loadTypes]);

  const lastUpdatedLabel = updatedAt
    ? `Activities synced ${new Date(updatedAt).toLocaleString()}`
    : 'Not yet synced';

  return (
    <div>
      {/* Toolbar */}
      <Card variant="glass" className="p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="text-[11px] text-surface-600 uppercase tracking-wider block mb-1">
              Account
            </label>
            <Select value={accountFilter} onValueChange={setAccountFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>All accounts</SelectItem>
                {accountOptions.map((a) => (
                  <SelectItem key={a.uuid} value={a.uuid}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[160px]">
            <label className="text-[11px] text-surface-600 uppercase tracking-wider block mb-1">
              Type
            </label>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>All types</SelectItem>
                {types.map((t) => (
                  <SelectItem key={t.type} value={t.type}>
                    {t.type} ({t.count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[11px] text-surface-600 uppercase tracking-wider block mb-1">
              From
            </label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <label className="text-[11px] text-surface-600 uppercase tracking-wider block mb-1">
              To
            </label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="text-[11px] text-surface-600 uppercase tracking-wider block mb-1">
              Search
            </label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-500" />
              <Input
                className="pl-8"
                placeholder="Ticker or description"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
          <Button onClick={handleSync} disabled={isSyncing}>
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{isSyncing ? 'Syncing…' : 'Sync Activities'}</span>
          </Button>
        </div>
        <p className="text-[11px] text-surface-500 mt-3">{lastUpdatedLabel}</p>
        {progress && (
          <div className="mt-3">
            <p className="text-[11px] text-surface-600 mb-1">
              {progress.label} ({progress.current}/{progress.total})
            </p>
            <div className="w-full h-1.5 bg-surface-200/50 rounded-full overflow-hidden">
              <div
                className="h-full bg-accent-500 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
              />
            </div>
          </div>
        )}
      </Card>

      {error && (
        <div className="flex items-center gap-2 p-4 bg-danger-500/10 border border-danger-500/20 rounded-xl mb-4">
          <AlertCircle className="w-5 h-5 text-danger-400" />
          <span className="text-[13px] text-danger-400">{error}</span>
        </div>
      )}

      {/* Result count */}
      <p className="text-[12px] text-surface-600 mb-2">
        {isLoading
          ? 'Loading…'
          : `Showing ${activities.length} of ${total}${truncated ? ' (truncated, narrow your filters)' : ''}`}
      </p>

      {/* Table */}
      {!isLoading && activities.length === 0 ? (
        <Card variant="glass" className="p-10 text-center">
          <p className="text-[13px] text-surface-600 mb-3">No activities found.</p>
          <p className="text-[12px] text-surface-500">
            Click <span className="font-medium">Sync Activities</span> to fetch transaction history
            from SnapTrade-linked accounts.
          </p>
        </Card>
      ) : (
        <Card variant="glass" className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-surface-300/40 bg-surface-100/30 text-[11px] uppercase tracking-wider text-surface-600">
                  <th className="text-left px-3 py-2 font-medium">Date</th>
                  <th className="text-left px-3 py-2 font-medium">Account</th>
                  <th className="text-left px-3 py-2 font-medium">Type</th>
                  <th className="text-left px-3 py-2 font-medium">Ticker / Description</th>
                  <th className="text-right px-3 py-2 font-medium">Units</th>
                  <th className="text-right px-3 py-2 font-medium">Price</th>
                  <th className="text-right px-3 py-2 font-medium">Amount</th>
                  <th className="text-right px-3 py-2 font-medium">Fee</th>
                </tr>
              </thead>
              <tbody>
                {activities.map((a) => (
                  <tr
                    key={`${a.accountId}:${a.id}`}
                    className="border-b border-surface-300/20 hover:bg-surface-100/40"
                  >
                    <td className="px-3 py-2 whitespace-nowrap text-surface-700">
                      {formatDate(a.tradeDate)}
                    </td>
                    <td className="px-3 py-2 text-surface-600 max-w-[180px] truncate">
                      {accountNameByUuid.get(a.accountId) ?? a.accountId.slice(0, 8)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${badgeClassFor(a.type)}`}
                      >
                        {a.type}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {a.ticker ? (
                        <span>
                          <span className="font-medium text-surface-950">{a.ticker}</span>
                          {a.description && a.description !== a.ticker && (
                            <span className="text-surface-500 ml-1.5">— {a.description}</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-surface-700">{a.description || '—'}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-surface-700">
                      {a.units !== 0 ? formatUnits(a.units) : ''}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-surface-700">
                      {a.price !== 0 ? <Money>{formatUsd(a.price)}</Money> : ''}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium text-surface-950">
                      {a.amount !== 0 ? <Money>{formatUsd(a.amount)}</Money> : ''}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-surface-600">
                      {a.fee !== 0 ? <Money>{formatUsd(a.fee)}</Money> : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
