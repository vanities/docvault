// Timesheet tab — Kimai-style entry table: date-range presets + custom
// window, client/project/status filters, description search, sortable
// columns, totals for the current filter. Log/edit happens in a modal.
// Mobile: row actions stay visible (no hover on touch), secondary columns
// collapse, and the table scrolls horizontally inside its card.

import { useState, useMemo } from 'react';
import { Plus, Trash2, Edit3, Loader2, ChevronDown, ArrowUp, ArrowDown } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { Money } from '../common/Money';
import {
  tsJson,
  formatUsd,
  formatHours,
  todayYMD,
  spanMinutes,
  presetRange,
  RANGE_PRESETS,
  type RangePreset,
  type TimesheetStore,
  type TimesheetEntry,
} from './types';

const PAGE_SIZE = 50;

type SortKey = 'date' | 'duration' | 'rate' | 'amount';

export function TimesheetTab({
  store,
  refresh,
}: {
  store: TimesheetStore;
  refresh: () => Promise<void>;
}) {
  const { confirm, ConfirmDialog } = useConfirmDialog();

  // Filters
  const [preset, setPreset] = useState<RangePreset>('this-month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [filterClient, setFilterClient] = useState('all');
  const [filterProject, setFilterProject] = useState('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'open' | 'invoiced' | 'non-billable'>(
    'all'
  );
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Sorting
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDesc, setSortDesc] = useState(true);

  // Entry modal
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formProjectId, setFormProjectId] = useState('');
  const [formDate, setFormDate] = useState(todayYMD());
  const [formStart, setFormStart] = useState('09:00');
  const [formEnd, setFormEnd] = useState('17:00');
  const [formDescription, setFormDescription] = useState('');
  const [formRate, setFormRate] = useState('');
  const [formBillable, setFormBillable] = useState(true);

  const clientById = useMemo(() => new Map(store.clients.map((c) => [c.id, c] as const)), [store]);
  const projectById = useMemo(
    () => new Map(store.projects.map((p) => [p.id, p] as const)),
    [store]
  );

  const range = preset === 'custom' ? { from: customFrom, to: customTo } : presetRange(preset);

  const projectGroups = useMemo(
    () =>
      store.clients
        .filter((c) => !c.archived)
        .map((c) => ({
          client: c,
          projects: store.projects.filter((p) => p.clientId === c.id && !p.archived),
        }))
        .filter((g) => g.projects.length > 0),
    [store]
  );

  const filtered = useMemo(() => {
    const text = search.trim().toLowerCase();
    const rows = store.entries.filter((e) => {
      if (range.from && e.date < range.from) return false;
      if (range.to && e.date > range.to) return false;
      const clientId = projectById.get(e.projectId)?.clientId;
      if (filterClient !== 'all' && clientId !== filterClient) return false;
      if (filterProject !== 'all' && e.projectId !== filterProject) return false;
      if (filterStatus === 'open' && (e.invoiced || !e.billable)) return false;
      if (filterStatus === 'invoiced' && !e.invoiced) return false;
      if (filterStatus === 'non-billable' && e.billable) return false;
      if (text && !e.description.toLowerCase().includes(text)) return false;
      return true;
    });
    const dir = sortDesc ? -1 : 1;
    rows.sort((a, b) => {
      switch (sortKey) {
        case 'duration':
          return dir * (a.durationMinutes - b.durationMinutes);
        case 'rate':
          return dir * (a.hourlyRate - b.hourlyRate);
        case 'amount':
          return dir * (a.amount - b.amount);
        default:
          return a.date === b.date
            ? dir * a.start.localeCompare(b.start)
            : dir * a.date.localeCompare(b.date);
      }
    });
    return rows;
  }, [
    store,
    range.from,
    range.to,
    filterClient,
    filterProject,
    filterStatus,
    search,
    sortKey,
    sortDesc,
    projectById,
  ]);

  const totals = useMemo(
    () => ({
      minutes: filtered.reduce((s, e) => s + e.durationMinutes, 0),
      amount: filtered.reduce((s, e) => s + e.amount, 0),
    }),
    [filtered]
  );

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDesc(!sortDesc);
    else {
      setSortKey(key);
      setSortDesc(true);
    }
  };

  const SortHeader = ({ label, k }: { label: string; k: SortKey }) => (
    <button
      onClick={() => toggleSort(k)}
      className="inline-flex items-center gap-0.5 hover:text-surface-900"
    >
      {label}
      {sortKey === k &&
        (sortDesc ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />)}
    </button>
  );

  // ----- Entry modal -----
  const openNew = () => {
    setEditingId(null);
    setFormDate(todayYMD());
    setFormStart('09:00');
    setFormEnd('17:00');
    setFormDescription('');
    setFormRate('');
    setFormBillable(true);
    setFormOpen(true);
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
    setFormOpen(true);
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
      if (editingId) await tsJson(`/entries/${editingId}`, 'PUT', body);
      else await tsJson('/entries', 'POST', body);
      setFormOpen(false);
      await refresh();
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
    await tsJson(`/entries/${entry.id}`, 'DELETE');
    await refresh();
  };

  const resetPage = () => setVisibleCount(PAGE_SIZE);

  return (
    <div>
      <ConfirmDialog />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select
          value={preset}
          onChange={(e) => {
            setPreset(e.target.value as RangePreset);
            resetPage();
          }}
          className="h-8 rounded-lg text-[12px] bg-surface-100 border border-border px-2"
        >
          {RANGE_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        {preset === 'custom' && (
          <>
            <Input
              type="date"
              value={customFrom}
              onChange={(e) => {
                setCustomFrom(e.target.value);
                resetPage();
              }}
              className="h-8 rounded-lg text-[12px] w-36"
            />
            <span className="text-[12px] text-surface-500">to</span>
            <Input
              type="date"
              value={customTo}
              onChange={(e) => {
                setCustomTo(e.target.value);
                resetPage();
              }}
              className="h-8 rounded-lg text-[12px] w-36"
            />
          </>
        )}
        <select
          value={filterClient}
          onChange={(e) => {
            setFilterClient(e.target.value);
            setFilterProject('all');
            resetPage();
          }}
          className="h-8 rounded-lg text-[12px] bg-surface-100 border border-border px-2"
        >
          <option value="all">All customers</option>
          {store.clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={filterProject}
          onChange={(e) => {
            setFilterProject(e.target.value);
            resetPage();
          }}
          className="h-8 rounded-lg text-[12px] bg-surface-100 border border-border px-2"
        >
          <option value="all">All projects</option>
          {store.projects
            .filter((p) => filterClient === 'all' || p.clientId === filterClient)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => {
            setFilterStatus(e.target.value as typeof filterStatus);
            resetPage();
          }}
          className="h-8 rounded-lg text-[12px] bg-surface-100 border border-border px-2"
        >
          <option value="all">All statuses</option>
          <option value="open">Open (uninvoiced)</option>
          <option value="invoiced">Invoiced</option>
          <option value="non-billable">Non-billable</option>
        </select>
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            resetPage();
          }}
          placeholder="Search descriptions…"
          className="h-8 rounded-lg text-[12px] w-full sm:w-48"
        />
        <div className="ml-auto">
          <Button size="sm" onClick={openNew}>
            <Plus className="w-4 h-4" />
            Log Time
          </Button>
        </div>
      </div>

      {/* Log / edit modal */}
      <Dialog open={formOpen} onOpenChange={(open) => !open && setFormOpen(false)}>
        <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Entry' : 'Log Time'}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
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
            <div className="col-span-2 sm:col-span-1">
              <label className="text-[12px] text-surface-600 block mb-1">Date</label>
              <Input
                type="date"
                value={formDate}
                onChange={(e) => setFormDate(e.target.value)}
                className="h-9 rounded-lg text-sm"
              />
            </div>
            <div className="col-span-2 sm:col-span-1 flex gap-2">
              <div className="flex-1 min-w-0">
                <label className="text-[12px] text-surface-600 block mb-1">Start</label>
                <Input
                  type="time"
                  step={900}
                  value={formStart}
                  onChange={(e) => setFormStart(e.target.value)}
                  className="h-9 rounded-lg text-sm"
                />
              </div>
              <div className="flex-1 min-w-0">
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
            <div className="col-span-2">
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
            <div className="flex items-end pb-1.5">
              <label className="flex items-center gap-2 text-[13px] text-surface-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formBillable}
                  onChange={(e) => setFormBillable(e.target.checked)}
                />
                Billable
              </label>
            </div>
          </div>
          <DialogFooter className="items-center gap-3 sm:justify-between">
            <span className="text-[13px] text-surface-600 tabular-nums">
              {formatHours(formMinutes)}
              {formBillable && formMinutes > 0 && (
                <>
                  {' · '}
                  <Money>{formatUsd(formAmount)}</Money>
                </>
              )}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setFormOpen(false)}>
                Cancel
              </Button>
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
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Totals strip for the current filter */}
      <div className="flex items-center gap-4 mb-2 text-[12px] text-surface-600 tabular-nums">
        <span>
          {filtered.length} entries · {formatHours(totals.minutes)}
        </span>
        <span className="font-mono font-semibold text-surface-900">
          <Money>{formatUsd(totals.amount)}</Money>
        </span>
      </div>

      {/* Entry table */}
      <Card variant="glass" className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-surface-500 border-b border-border">
              <th className="px-3 sm:px-4 py-2.5 font-semibold">
                <SortHeader label="Date" k="date" />
              </th>
              <th className="px-2 py-2.5 font-semibold hidden md:table-cell">Time</th>
              <th className="px-2 py-2.5 font-semibold hidden sm:table-cell">Customer / Project</th>
              <th className="px-2 py-2.5 font-semibold">Description</th>
              <th className="px-2 py-2.5 font-semibold text-right">
                <SortHeader label="Hours" k="duration" />
              </th>
              <th className="px-2 py-2.5 font-semibold text-right hidden md:table-cell">
                <SortHeader label="Rate" k="rate" />
              </th>
              <th className="px-2 py-2.5 font-semibold text-right">
                <SortHeader label="Amount" k="amount" />
              </th>
              <th className="px-2 py-2.5 font-semibold hidden sm:table-cell">Status</th>
              <th className="px-2 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-surface-500">
                  No entries match the current filter.
                </td>
              </tr>
            ) : (
              filtered.slice(0, visibleCount).map((e) => {
                const project = projectById.get(e.projectId);
                const client = project ? clientById.get(project.clientId) : undefined;
                return (
                  <tr key={e.id} className="group hover:bg-surface-100/50">
                    <td className="px-3 sm:px-4 py-2 text-surface-700 tabular-nums whitespace-nowrap">
                      {/* full date from sm up; MM-DD on phones to keep Amount on-screen */}
                      <span className="hidden sm:inline">{e.date}</span>
                      <span className="sm:hidden">{e.date.slice(5)}</span>
                    </td>
                    <td className="px-2 py-2 text-surface-500 tabular-nums text-[12px] whitespace-nowrap hidden md:table-cell">
                      {e.start}–{e.end}
                    </td>
                    <td className="px-2 py-2 text-surface-600 text-[12px] whitespace-nowrap hidden sm:table-cell">
                      {client?.name} / {project?.name}
                    </td>
                    <td className="px-2 py-2 text-surface-900 max-w-[10.5rem] sm:max-w-[26rem]">
                      <span className="line-clamp-2">
                        {e.description || <i className="text-surface-500">no description</i>}
                      </span>
                      <span className="block text-[11px] text-surface-500 sm:hidden">
                        {client?.name} / {project?.name}
                        {!e.billable ? ' · non-billable' : e.invoiced ? ' · invoiced' : ' · open'}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right text-surface-700 tabular-nums whitespace-nowrap">
                      {formatHours(e.durationMinutes)}
                    </td>
                    <td className="px-2 py-2 text-right text-surface-600 tabular-nums whitespace-nowrap hidden md:table-cell">
                      {e.billable ? <Money>{formatUsd(e.hourlyRate)}</Money> : '—'}
                    </td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums text-surface-800 whitespace-nowrap">
                      {e.billable ? <Money>{formatUsd(e.amount)}</Money> : '—'}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap hidden sm:table-cell">
                      {!e.billable ? (
                        <span className="text-[11px] text-surface-500">non-billable</span>
                      ) : e.invoiced ? (
                        <span className="text-[11px] text-surface-500">invoiced</span>
                      ) : (
                        <span className="text-[11px] text-lime-400">open</span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex gap-1 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
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
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        {filtered.length > visibleCount && (
          <button
            className="w-full py-2.5 text-[12px] text-surface-600 hover:text-surface-900 flex items-center justify-center gap-1 border-t border-border/50"
            onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
          >
            <ChevronDown className="w-3.5 h-3.5" />
            Show more ({filtered.length - visibleCount} remaining)
          </button>
        )}
      </Card>
    </div>
  );
}
