// Timesheet — Kimai-style time tracking: tabbed layout over one store.
//   Timesheet  — filterable/sortable entry table + log form
//   Invoices   — create-from-open-entries flow + persisted invoice history
//   Customers  — clients & projects management (rates live on projects)
//   Templates  — reusable invoice layouts (sender identity, terms, VAT)
// Entries are manual start/end wall times (no running timer, by design).

import { useState, useEffect, useCallback } from 'react';
import { Clock, Loader2 } from 'lucide-react';
import { tsJson, type TimesheetStore } from './types';
import { TimesheetTab } from './TimesheetTab';
import { InvoicesTab } from './InvoicesTab';
import { AnalyticsTab } from './AnalyticsTab';
import { CustomersTab } from './CustomersTab';
import { TemplatesTab } from './TemplatesTab';

type Tab = 'timesheet' | 'invoices' | 'analytics' | 'customers' | 'templates';

const TABS: { value: Tab; label: string }[] = [
  { value: 'timesheet', label: 'Timesheet' },
  { value: 'invoices', label: 'Invoices' },
  { value: 'analytics', label: 'Analytics' },
  { value: 'customers', label: 'Customers & Projects' },
  { value: 'templates', label: 'Templates' },
];

export function TimesheetView() {
  const [store, setStore] = useState<TimesheetStore | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('timesheet');

  const refresh = useCallback(async () => {
    try {
      setStore(await tsJson<TimesheetStore>('', 'GET'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading || !store) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-surface-500" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-semibold text-surface-950 flex items-center gap-2">
            <Clock className="w-5 h-5 text-lime-400" />
            Timesheet
          </h2>
          <p className="text-[13px] text-surface-600 mt-0.5">
            Billable hours, clients, and invoicing
          </p>
        </div>
      </div>

      {/* Tabs — horizontally scrollable on narrow screens */}
      <div className="flex items-center gap-1 border-b border-border mb-5 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`shrink-0 whitespace-nowrap px-3.5 py-2 text-[13px] font-medium border-b-2 -mb-px transition-colors ${
              tab === t.value
                ? 'border-lime-400 text-surface-950'
                : 'border-transparent text-surface-600 hover:text-surface-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'timesheet' && <TimesheetTab store={store} refresh={refresh} />}
      {tab === 'invoices' && <InvoicesTab store={store} refresh={refresh} />}
      {tab === 'analytics' && <AnalyticsTab store={store} />}
      {tab === 'customers' && <CustomersTab store={store} refresh={refresh} />}
      {tab === 'templates' && <TemplatesTab store={store} refresh={refresh} />}
    </div>
  );
}
