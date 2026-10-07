// Timesheet — Kimai-style time tracking: tabbed layout over one store.
//   Timesheet  — filterable/sortable entry table + log form
//   Invoices   — create-from-open-entries flow + persisted invoice history
//   Customers  — clients & projects management (rates live on projects)
//   Templates  — reusable invoice layouts (sender identity, terms, VAT)
// Entries are manual start/end wall times (no running timer, by design).

import { useState, useEffect, useCallback, useRef } from 'react';
import { Clock, Loader2, AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { tsJson, type TimesheetStore } from './types';
import { TimesheetTab } from './TimesheetTab';
import { InvoicesTab } from './InvoicesTab';
import { AnalyticsTab } from './AnalyticsTab';
import { CustomersTab } from './CustomersTab';
import { TemplatesTab } from './TemplatesTab';
import { WeeklyReportTab } from './WeeklyReportTab';

type Tab = 'timesheet' | 'invoices' | 'analytics' | 'customers' | 'templates' | 'weekly-report';

const TABS: { value: Tab; label: string }[] = [
  { value: 'timesheet', label: 'Timesheet' },
  { value: 'invoices', label: 'Invoices' },
  { value: 'analytics', label: 'Analytics' },
  { value: 'customers', label: 'Customers & Projects' },
  { value: 'templates', label: 'Templates' },
  { value: 'weekly-report', label: 'Weekly Report' },
];

const HOUR24_KEY = 'docvault-timesheet-24h';

export function TimesheetView() {
  const [store, setStore] = useState<TimesheetStore | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadSequence = useRef({ sequence: 0 });
  const [tab, setTab] = useState<Tab>('timesheet');
  const [hour24, setHour24] = useState(() => localStorage.getItem(HOUR24_KEY) !== '12');

  const toggleHour24 = (value: boolean) => {
    setHour24(value);
    localStorage.setItem(HOUR24_KEY, value ? '24' : '12');
  };

  const refresh = useCallback(async () => {
    const sequence = ++loadSequence.current.sequence;
    setLoading(true);
    setLoadError(null);
    try {
      const nextStore = await tsJson<TimesheetStore>('', 'GET');
      if (sequence === loadSequence.current.sequence) setStore(nextStore);
    } catch (error) {
      if (sequence === loadSequence.current.sequence)
        setLoadError(error instanceof Error ? error.message : 'Could not load the timesheet');
    } finally {
      if (sequence === loadSequence.current.sequence) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const loadState = loadSequence.current;
    void refresh();
    return () => {
      loadState.sequence++;
    };
  }, [refresh]);

  if (!store) {
    return (
      <div className="p-4 sm:p-6 max-w-6xl mx-auto">
        {loadError ? (
          <Card className="p-6 space-y-3">
            <h2 className="text-lg font-semibold text-surface-950">Timesheet could not load</h2>
            <p role="alert" className="text-sm text-danger-400">
              {loadError}
            </p>
            <Button onClick={() => void refresh()} className="min-h-11">
              Try again
            </Button>
          </Card>
        ) : (
          <div
            role="status"
            className="flex items-center justify-center gap-2 h-64 text-surface-600"
          >
            <Loader2 className="w-6 h-6 animate-spin" aria-hidden />
            <span className="text-sm">Loading timesheet…</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold text-surface-950 flex items-center gap-2">
            <Clock className="w-5 h-5 text-lime-400" />
            Timesheet
          </h2>
          <p className="text-[13px] text-surface-600 mt-0.5">
            Billable hours, clients, and invoicing
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void refresh()}
            disabled={loading}
            aria-label="Refresh timesheet"
            className="size-11"
          >
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
          </Button>
          <div
            className="flex items-center rounded-lg border border-border overflow-hidden text-xs"
            role="group"
            aria-label="Clock format"
          >
            <button
              onClick={() => toggleHour24(true)}
              aria-pressed={hour24}
              className={`min-h-11 min-w-11 px-2 ${hour24 ? 'bg-surface-200/60 text-surface-950' : 'text-surface-600 hover:text-surface-900'}`}
            >
              24h
            </button>
            <button
              onClick={() => toggleHour24(false)}
              aria-pressed={!hour24}
              className={`min-h-11 min-w-11 px-2 ${!hour24 ? 'bg-surface-200/60 text-surface-950' : 'text-surface-600 hover:text-surface-900'}`}
            >
              12h
            </button>
          </div>
        </div>
      </div>

      {loadError && (
        <div className="flex flex-wrap items-center gap-3 mb-4 rounded-xl border border-danger-400/30 p-3">
          <p role="alert" className="flex-1 min-w-0 text-sm text-danger-400 flex items-start gap-2">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" aria-hidden />
            <span>Could not refresh. The displayed data may be out of date. {loadError}</span>
          </p>
          <Button variant="outline" onClick={() => void refresh()} className="min-h-11">
            Try again
          </Button>
        </div>
      )}

      <label className="block mb-5 sm:hidden">
        <span className="block mb-1 text-xs font-medium text-surface-600">Timesheet section</span>
        <select
          aria-label="Timesheet section"
          value={tab}
          onChange={(event) => setTab(event.target.value as Tab)}
          className="w-full min-h-11 rounded-xl border border-border bg-surface-100 px-3 text-base text-surface-950"
        >
          {TABS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <nav
        aria-label="Timesheet sections"
        className="hidden sm:flex items-center gap-1 border-b border-border mb-5 overflow-x-auto overflow-y-hidden"
      >
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            aria-current={tab === t.value ? 'page' : undefined}
            className={`min-h-11 shrink-0 whitespace-nowrap px-3.5 py-2 text-[13px] font-medium border-b-2 -mb-px transition-colors ${
              tab === t.value
                ? 'border-lime-400 text-surface-950'
                : 'border-transparent text-surface-600 hover:text-surface-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'timesheet' && (
        <TimesheetTab
          store={store}
          refresh={refresh}
          hour24={hour24}
          onManageProjects={() => setTab('customers')}
        />
      )}
      {tab === 'invoices' && <InvoicesTab store={store} refresh={refresh} />}
      {tab === 'analytics' && <AnalyticsTab store={store} />}
      {tab === 'customers' && <CustomersTab store={store} refresh={refresh} />}
      {tab === 'templates' && <TemplatesTab store={store} refresh={refresh} />}
      {tab === 'weekly-report' && <WeeklyReportTab store={store} />}
    </div>
  );
}
