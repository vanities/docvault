// Timesheet — manual time tracking with a client → project hierarchy.
// Entries are hand-entered start/end wall times (no running timer). The
// primary rollup is "uninvoiced hours per client" (the billing queue), with
// week/month totals as secondary context. Rates live on projects and are
// snapshotted onto entries server-side at logging time.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import {
  Plus,
  Trash2,
  Edit3,
  Loader2,
  Clock,
  X,
  ChevronDown,
  Settings2,
  Receipt,
} from 'lucide-react';
import { API_BASE } from '../../constants';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { requestJson } from '../../api/client';
import { Money } from '../common/Money';

interface TimesheetClient {
  id: string;
  name: string;
  currency: string;
  archived: boolean;
}

interface TimesheetProject {
  id: string;
  clientId: string;
  name: string;
  hourlyRate: number;
  archived: boolean;
}

interface TimesheetEntry {
  id: string;
  projectId: string;
  date: string;
  start: string;
  end: string;
  durationMinutes: number;
  description: string;
  hourlyRate: number;
  amount: number;
  billable: boolean;
  invoiced: boolean;
  invoicedAt?: string;
}

interface TimesheetStore {
  version: 1;
  clients: TimesheetClient[];
  projects: TimesheetProject[];
  entries: TimesheetEntry[];
}

function formatUsd(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  });
}

function formatHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function todayYMD(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Monday-start ISO date of the week containing `ymd`. */
function weekStart(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00`);
  const dow = (d.getDay() + 6) % 7; // Mon=0..Sun=6
  d.setDate(d.getDate() - dow);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Wall-clock span with midnight wrap — mirrors the server derivation. */
function spanMinutes(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let span = eh * 60 + em - (sh * 60 + sm);
  if (span < 0) span += 24 * 60;
  return span;
}

const PAGE_SIZE = 50;

export function TimesheetView() {
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const [store, setStore] = useState<TimesheetStore | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Entry form state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formProjectId, setFormProjectId] = useState('');
  const [formDate, setFormDate] = useState(todayYMD());
  const [formStart, setFormStart] = useState('09:00');
  const [formEnd, setFormEnd] = useState('17:00');
  const [formDescription, setFormDescription] = useState('');
  const [formRate, setFormRate] = useState(''); // '' = use project default
  const [formBillable, setFormBillable] = useState(true);

  // Filters
  const [filterProject, setFilterProject] = useState('all');
  const [filterInvoiced, setFilterInvoiced] = useState<'all' | 'uninvoiced' | 'invoiced'>('all');
  const [filterText, setFilterText] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Manage section
  const [showManage, setShowManage] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectClient, setNewProjectClient] = useState('');
  const [newProjectRate, setNewProjectRate] = useState('');

  const fetchStore = useCallback(async () => {
    try {
      const data = await requestJson<TimesheetStore>(`${API_BASE}/timesheet`);
      setStore(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStore();
  }, [fetchStore]);

  const clientById = useMemo(
    () => new Map((store?.clients ?? []).map((c) => [c.id, c] as const)),
    [store]
  );
  const projectById = useMemo(
    () => new Map((store?.projects ?? []).map((p) => [p.id, p] as const)),
    [store]
  );

  // Active projects grouped by client for the form <select>
  const projectGroups = useMemo(() => {
    if (!store) return [];
    return store.clients
      .filter((c) => !c.archived)
      .map((c) => ({
        client: c,
        projects: store.projects.filter((p) => p.clientId === c.id && !p.archived),
      }))
      .filter((g) => g.projects.length > 0);
  }, [store]);

  // -------------------------------------------------------------------------
  // Rollups (client-side over the full store; ~1.2k entries is trivial)
  // -------------------------------------------------------------------------
  const rollups = useMemo(() => {
    const entries = store?.entries ?? [];
    const today = todayYMD();
    const thisWeek = weekStart(today);
    const thisMonth = today.slice(0, 7);

    let weekMinutes = 0;
    let monthMinutes = 0;
    let monthAmount = 0;
    const uninvoicedByClient = new Map<
      string,
      { minutes: number; amount: number; count: number }
    >();

    for (const e of entries) {
      if (e.date >= thisWeek && e.date <= today) weekMinutes += e.durationMinutes;
      if (e.date.startsWith(thisMonth)) {
        monthMinutes += e.durationMinutes;
        monthAmount += e.amount;
      }
      if (!e.invoiced && e.billable) {
        const clientId = projectById.get(e.projectId)?.clientId ?? 'unknown';
        const agg = uninvoicedByClient.get(clientId) ?? { minutes: 0, amount: 0, count: 0 };
        agg.minutes += e.durationMinutes;
        agg.amount += e.amount;
        agg.count += 1;
        uninvoicedByClient.set(clientId, agg);
      }
    }
    const uninvoicedTotal = [...uninvoicedByClient.values()].reduce(
      (s, a) => ({ minutes: s.minutes + a.minutes, amount: s.amount + a.amount }),
      { minutes: 0, amount: 0 }
    );
    return { weekMinutes, monthMinutes, monthAmount, uninvoicedByClient, uninvoicedTotal };
  }, [store, projectById]);

  const filteredEntries = useMemo(() => {
    const entries = store?.entries ?? [];
    const text = filterText.trim().toLowerCase();
    return entries
      .filter((e) => {
        if (filterProject !== 'all' && e.projectId !== filterProject) return false;
        if (filterInvoiced === 'uninvoiced' && (e.invoiced || !e.billable)) return false;
        if (filterInvoiced === 'invoiced' && !e.invoiced) return false;
        if (text && !e.description.toLowerCase().includes(text)) return false;
        return true;
      })
      .sort((a, b) =>
        a.date === b.date ? b.start.localeCompare(a.start) : b.date.localeCompare(a.date)
      );
  }, [store, filterProject, filterInvoiced, filterText]);

  // -------------------------------------------------------------------------
  // Entry form
  // -------------------------------------------------------------------------
  const resetForm = () => {
    setEditingId(null);
    setFormDate(todayYMD());
    setFormStart('09:00');
    setFormEnd('17:00');
    setFormDescription('');
    setFormRate('');
    setFormBillable(true);
  };

  const openEdit = (entry: TimesheetEntry) => {
    setEditingId(entry.id);
    setFormProjectId(entry.projectId);
    setFormDate(entry.date);
    setFormStart(entry.start);
    setFormEnd(entry.end);
    setFormDescription(entry.description);
    setFormRate(String(entry.hourlyRate));
    setFormBillable(entry.billable);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const formMinutes = spanMinutes(formStart, formEnd);
  const formProject = projectById.get(formProjectId);
  const effectiveRate = formRate !== '' ? Number(formRate) : (formProject?.hourlyRate ?? 0);
  const formAmount = formBillable ? (formMinutes / 60) * effectiveRate : 0;

  const handleSubmit = async () => {
    if (!formProjectId || !formDate || !formStart || !formEnd || formMinutes === 0) return;
    setSubmitting(true);
    try {
      const body = {
        projectId: formProjectId,
        date: formDate,
        start: formStart,
        end: formEnd,
        description: formDescription,
        billable: formBillable,
        ...(formRate !== '' ? { hourlyRate: Number(formRate) } : {}),
      };
      if (editingId) {
        await requestJson(`${API_BASE}/timesheet/entries/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else {
        await requestJson(`${API_BASE}/timesheet/entries`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
      resetForm();
      setShowForm(false);
      await fetchStore();
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (entry: TimesheetEntry) => {
    const ok = await confirm({
      title: 'Delete entry?',
      description: `${entry.date} · ${formatHours(entry.durationMinutes)} — ${entry.description || 'no description'}`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    await requestJson(`${API_BASE}/timesheet/entries/${entry.id}`, { method: 'DELETE' });
    await fetchStore();
  };

  const handleInvoicePdf = async (clientId: string) => {
    const res = await fetch(`${API_BASE}/timesheet/invoice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId }),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download =
      res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] ?? 'invoice.pdf';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleMarkInvoiced = async (clientId: string) => {
    if (!store) return;
    const agg = rollups.uninvoicedByClient.get(clientId);
    const client = clientById.get(clientId);
    if (!agg || !client) return;
    const ok = await confirm({
      title: `Mark ${client.name} invoiced?`,
      description: `${agg.count} entries · ${formatHours(agg.minutes)} will be marked as invoiced.`,
      confirmLabel: 'Mark invoiced',
    });
    if (!ok) return;
    const entryIds = store.entries
      .filter(
        (e) => !e.invoiced && e.billable && projectById.get(e.projectId)?.clientId === clientId
      )
      .map((e) => e.id);
    await requestJson(`${API_BASE}/timesheet/mark-invoiced`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entryIds }),
    });
    await fetchStore();
  };

  // -------------------------------------------------------------------------
  // Manage: clients & projects
  // -------------------------------------------------------------------------
  const handleAddClient = async () => {
    if (!newClientName.trim()) return;
    await requestJson(`${API_BASE}/timesheet/clients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newClientName.trim() }),
    });
    setNewClientName('');
    await fetchStore();
  };

  const handleAddProject = async () => {
    if (!newProjectName.trim() || !newProjectClient) return;
    await requestJson(`${API_BASE}/timesheet/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newProjectName.trim(),
        clientId: newProjectClient,
        hourlyRate: newProjectRate === '' ? 0 : Number(newProjectRate),
      }),
    });
    setNewProjectName('');
    setNewProjectRate('');
    await fetchStore();
  };

  const handleProjectRate = async (project: TimesheetProject, rate: string) => {
    const value = Number(rate);
    if (Number.isNaN(value) || value === project.hourlyRate) return;
    await requestJson(`${API_BASE}/timesheet/projects/${project.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hourlyRate: value }),
    });
    await fetchStore();
  };

  const handleToggleArchived = async (
    kind: 'clients' | 'projects',
    id: string,
    archived: boolean
  ) => {
    await requestJson(`${API_BASE}/timesheet/${kind}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived }),
    });
    await fetchStore();
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-surface-500" />
      </div>
    );
  }

  const uninvoicedClients = [...rollups.uninvoicedByClient.entries()].sort(
    (a, b) => b[1].amount - a[1].amount
  );

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <ConfirmDialog />

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-surface-950 flex items-center gap-2">
            <Clock className="w-5 h-5 text-lime-400" />
            Timesheet
          </h2>
          <p className="text-[13px] text-surface-600 mt-0.5">
            Billable hours by client and project
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowManage(!showManage)}>
            <Settings2 className="w-4 h-4" />
            Manage
          </Button>
          <Button
            onClick={() => {
              if (showForm && !editingId) {
                setShowForm(false);
                resetForm();
              } else {
                resetForm();
                setShowForm(true);
              }
            }}
            variant={showForm && !editingId ? 'outline' : 'default'}
            size="sm"
          >
            {showForm && !editingId ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {showForm && !editingId ? 'Cancel' : 'Log Time'}
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <Card variant="glass" className="p-5 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <p className="text-[11px] text-surface-500 uppercase tracking-wider mb-1">Uninvoiced</p>
            <p className="text-2xl font-mono font-bold tabular-nums text-lime-400">
              <Money>{formatUsd(rollups.uninvoicedTotal.amount)}</Money>
            </p>
            <p className="text-[12px] text-surface-600 tabular-nums">
              {formatHours(rollups.uninvoicedTotal.minutes)} pending
            </p>
          </div>
          <div>
            <p className="text-[11px] text-surface-500 uppercase tracking-wider mb-1">This Week</p>
            <p className="text-lg font-mono font-semibold text-surface-800 tabular-nums">
              {formatHours(rollups.weekMinutes)}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-surface-500 uppercase tracking-wider mb-1">This Month</p>
            <p className="text-lg font-mono font-semibold text-surface-800 tabular-nums">
              {formatHours(rollups.monthMinutes)}
            </p>
            <p className="text-[12px] text-surface-600 tabular-nums">
              <Money>{formatUsd(rollups.monthAmount)}</Money>
            </p>
          </div>
        </div>
      </Card>

      {/* Manage clients & projects */}
      {showManage && store && (
        <Card variant="glass" className="p-5 mb-6">
          <h3 className="text-[14px] font-semibold text-surface-950 mb-4">Clients & Projects</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Clients */}
            <div>
              <p className="text-[11px] text-surface-500 uppercase tracking-wider mb-2">Clients</p>
              <div className="space-y-1.5 mb-3">
                {store.clients.map((c) => (
                  <div
                    key={c.id}
                    className={`flex items-center gap-2 text-[13px] ${c.archived ? 'text-surface-500' : 'text-surface-800'}`}
                  >
                    <span className="flex-1 truncate">{c.name}</span>
                    <button
                      className="text-[11px] text-surface-500 hover:text-surface-800"
                      onClick={() => void handleToggleArchived('clients', c.id, !c.archived)}
                    >
                      {c.archived ? 'unarchive' : 'archive'}
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  placeholder="New client name"
                  className="h-8 rounded-lg text-[13px]"
                />
                <Button size="sm" variant="outline" onClick={() => void handleAddClient()}>
                  <Plus className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
            {/* Projects */}
            <div>
              <p className="text-[11px] text-surface-500 uppercase tracking-wider mb-2">
                Projects · hourly rate
              </p>
              <div className="space-y-1.5 mb-3">
                {store.projects.map((p) => (
                  <div
                    key={p.id}
                    className={`flex items-center gap-2 text-[13px] ${p.archived ? 'text-surface-500' : 'text-surface-800'}`}
                  >
                    <span className="flex-1 truncate">
                      {p.name}
                      <span className="text-surface-500">
                        {' '}
                        · {clientById.get(p.clientId)?.name}
                      </span>
                    </span>
                    <Money>
                      <Input
                        type="number"
                        defaultValue={p.hourlyRate}
                        onBlur={(e) => void handleProjectRate(p, e.target.value)}
                        className="h-7 w-20 rounded text-[12px] text-right tabular-nums"
                      />
                    </Money>
                    <button
                      className="text-[11px] text-surface-500 hover:text-surface-800"
                      onClick={() => void handleToggleArchived('projects', p.id, !p.archived)}
                    >
                      {p.archived ? 'unarchive' : 'archive'}
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <select
                  value={newProjectClient}
                  onChange={(e) => setNewProjectClient(e.target.value)}
                  className="h-8 rounded-lg text-[12px] bg-surface-100 border border-border px-2"
                >
                  <option value="">Client…</option>
                  {store.clients
                    .filter((c) => !c.archived)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
                <Input
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="Project name"
                  className="h-8 rounded-lg text-[13px]"
                />
                <Input
                  type="number"
                  value={newProjectRate}
                  onChange={(e) => setNewProjectRate(e.target.value)}
                  placeholder="$/h"
                  className="h-8 w-20 rounded-lg text-[13px]"
                />
                <Button size="sm" variant="outline" onClick={() => void handleAddProject()}>
                  <Plus className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Log / edit form */}
      {showForm && (
        <Card variant="glass" className="p-5 mb-6">
          <h3 className="text-[14px] font-semibold text-surface-950 mb-4">
            {editingId ? 'Edit Entry' : 'Log Time'}
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            <div className="col-span-2">
              <label className="text-[12px] text-surface-600 block mb-1">Project</label>
              <select
                value={formProjectId}
                onChange={(e) => {
                  setFormProjectId(e.target.value);
                  setFormRate('');
                }}
                className="w-full h-9 rounded-lg text-sm bg-surface-100 border border-border px-3"
              >
                <option value="">Select project…</option>
                {projectGroups.map((g) => (
                  <optgroup key={g.client.id} label={g.client.name}>
                    {g.projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[12px] text-surface-600 block mb-1">Date</label>
              <Input
                type="date"
                value={formDate}
                onChange={(e) => setFormDate(e.target.value)}
                className="h-9 rounded-lg text-sm"
              />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-[12px] text-surface-600 block mb-1">Start</label>
                <Input
                  type="time"
                  step={900}
                  value={formStart}
                  onChange={(e) => setFormStart(e.target.value)}
                  className="h-9 rounded-lg text-sm"
                />
              </div>
              <div className="flex-1">
                <label className="text-[12px] text-surface-600 block mb-1">End</label>
                <Input
                  type="time"
                  step={900}
                  value={formEnd}
                  onChange={(e) => setFormEnd(e.target.value)}
                  className="h-9 rounded-lg text-sm"
                />
              </div>
            </div>
            <div className="col-span-2 sm:col-span-3">
              <label className="text-[12px] text-surface-600 block mb-1">Description</label>
              <Input
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="What did you work on?"
                className="h-9 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="text-[12px] text-surface-600 block mb-1">
                Rate ($/h{formProject && formRate === '' ? ' · project default' : ''})
              </label>
              <Input
                type="number"
                value={formRate}
                onChange={(e) => setFormRate(e.target.value)}
                placeholder={formProject ? String(formProject.hourlyRate) : '0'}
                className="h-9 rounded-lg text-sm"
              />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-[13px] text-surface-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formBillable}
                  onChange={(e) => setFormBillable(e.target.checked)}
                />
                Billable
              </label>
              <span className="text-[13px] text-surface-600 tabular-nums">
                {formatHours(formMinutes)}
                {formBillable && formMinutes > 0 && (
                  <>
                    {' · '}
                    <Money>{formatUsd(formAmount)}</Money>
                  </>
                )}
              </span>
            </div>
            <div className="flex gap-2">
              {editingId && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    resetForm();
                    setShowForm(false);
                  }}
                >
                  Cancel
                </Button>
              )}
              <Button
                size="sm"
                disabled={submitting || !formProjectId || formMinutes === 0}
                onClick={() => void handleSubmit()}
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : editingId ? (
                  'Save'
                ) : (
                  'Log Entry'
                )}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Uninvoiced by client — the billing queue */}
      {uninvoicedClients.length > 0 && (
        <Card variant="glass" className="p-5 mb-6">
          <h3 className="text-[14px] font-semibold text-surface-950 mb-3 flex items-center gap-2">
            <Receipt className="w-4 h-4 text-lime-400" />
            Ready to Invoice
          </h3>
          <div className="space-y-2">
            {uninvoicedClients.map(([clientId, agg]) => (
              <div key={clientId} className="flex items-center gap-3 text-[13px]">
                <span className="flex-1 font-medium text-surface-900 truncate">
                  {clientById.get(clientId)?.name ?? clientId}
                </span>
                <span className="text-surface-600 tabular-nums">
                  {agg.count} entries · {formatHours(agg.minutes)}
                </span>
                <span className="font-mono font-semibold text-surface-950 tabular-nums w-24 text-right">
                  <Money>{formatUsd(agg.amount)}</Money>
                </span>
                <Button variant="outline" size="sm" onClick={() => void handleInvoicePdf(clientId)}>
                  <Receipt className="w-3.5 h-3.5" />
                  PDF
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleMarkInvoiced(clientId)}
                >
                  Mark invoiced
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select
          value={filterProject}
          onChange={(e) => {
            setFilterProject(e.target.value);
            setVisibleCount(PAGE_SIZE);
          }}
          className="h-8 rounded-lg text-[12px] bg-surface-100 border border-border px-2"
        >
          <option value="all">All projects</option>
          {(store?.clients ?? []).map((c) => (
            <optgroup key={c.id} label={c.name}>
              {(store?.projects ?? [])
                .filter((p) => p.clientId === c.id)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        <select
          value={filterInvoiced}
          onChange={(e) => {
            setFilterInvoiced(e.target.value as typeof filterInvoiced);
            setVisibleCount(PAGE_SIZE);
          }}
          className="h-8 rounded-lg text-[12px] bg-surface-100 border border-border px-2"
        >
          <option value="all">All entries</option>
          <option value="uninvoiced">Uninvoiced</option>
          <option value="invoiced">Invoiced</option>
        </select>
        <Input
          value={filterText}
          onChange={(e) => {
            setFilterText(e.target.value);
            setVisibleCount(PAGE_SIZE);
          }}
          placeholder="Search descriptions…"
          className="h-8 rounded-lg text-[12px] w-52"
        />
        <span className="text-[12px] text-surface-500 tabular-nums ml-auto">
          {filteredEntries.length} entries ·{' '}
          {formatHours(filteredEntries.reduce((s, e) => s + e.durationMinutes, 0))}
        </span>
      </div>

      {/* Entries list */}
      <Card variant="glass" className="divide-y divide-border/50">
        {filteredEntries.length === 0 ? (
          <div className="p-8 text-center text-[13px] text-surface-500">
            No entries match. Log your first entry with the button above.
          </div>
        ) : (
          filteredEntries.slice(0, visibleCount).map((e) => {
            const project = projectById.get(e.projectId);
            const client = project ? clientById.get(project.clientId) : undefined;
            return (
              <div key={e.id} className="group flex items-center gap-3 px-4 py-2.5 text-[13px]">
                <div className="w-24 flex-shrink-0 text-surface-600 tabular-nums">{e.date}</div>
                <div className="w-24 flex-shrink-0 text-surface-500 tabular-nums text-[12px]">
                  {e.start}–{e.end}
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-surface-900">{e.description || <i>no description</i>}</span>
                  <span className="text-surface-500 text-[12px]">
                    {' · '}
                    {client?.name} / {project?.name}
                  </span>
                </div>
                <div className="w-16 flex-shrink-0 text-right text-surface-700 tabular-nums">
                  {formatHours(e.durationMinutes)}
                </div>
                <div className="w-20 flex-shrink-0 text-right font-mono tabular-nums text-surface-800">
                  {e.billable ? (
                    <Money>{formatUsd(e.amount)}</Money>
                  ) : (
                    <span className="text-surface-500">—</span>
                  )}
                </div>
                <div className="w-16 flex-shrink-0 text-right">
                  {e.invoiced ? (
                    <span className="text-[11px] text-surface-500">invoiced</span>
                  ) : e.billable ? (
                    <span className="text-[11px] text-lime-400">open</span>
                  ) : null}
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="ghost" size="icon-xs" onClick={() => openEdit(e)}>
                    <Edit3 className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="text-danger-400"
                    onClick={() => void handleDelete(e)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            );
          })
        )}
        {filteredEntries.length > visibleCount && (
          <button
            className="w-full py-2.5 text-[12px] text-surface-600 hover:text-surface-900 flex items-center justify-center gap-1"
            onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
          >
            <ChevronDown className="w-3.5 h-3.5" />
            Show more ({filteredEntries.length - visibleCount} remaining)
          </button>
        )}
      </Card>
    </div>
  );
}
