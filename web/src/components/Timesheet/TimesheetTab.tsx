// Timesheet tab — Kimai-style entry table: date-range presets + custom
// window, client/project/status filters, description search, sortable
// columns, totals for the current filter. Log/edit happens in a modal.
// Phones use readable entry cards; larger screens keep the sortable table.

import { useState, useMemo } from 'react';
import {
  Plus,
  Trash2,
  Edit3,
  Loader2,
  ChevronDown,
  ArrowUp,
  ArrowDown,
  MoreHorizontal,
  Lock,
  SlidersHorizontal,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DialogBody,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { Money } from '../common/Money';
import { TimeSlotPicker } from './TimeSlotPicker';
import {
  tsJson,
  formatUsd,
  formatHours,
  todayYMD,
  spanMinutes,
  presetRange,
  formatClock,
  nowRounded15,
  addMinutes,
  buildClientColorMap,
  projectDisplayColor,
  RANGE_PRESETS,
  type RangePreset,
  type TimesheetStore,
  type TimesheetEntry,
} from './types';
import { billedOn } from './billing';

const PAGE_SIZE = 50;
const FILTER_CLASS =
  'min-h-11 sm:min-h-9 w-full min-w-0 rounded-lg text-base sm:text-sm text-surface-900 bg-surface-100 border border-border px-2';

type SortKey = 'date' | 'duration' | 'rate' | 'amount';

export function TimesheetTab({
  store,
  refresh,
  hour24,
  onManageProjects,
}: {
  store: TimesheetStore;
  refresh: () => Promise<void>;
  hour24: boolean;
  onManageProjects: () => void;
}) {
  const { confirm, confirmDialog } = useConfirmDialog();

  // Filters
  const [preset, setPreset] = useState<RangePreset>('this-month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [filterClient, setFilterClient] = useState('all');
  const [filterProject, setFilterProject] = useState('all');
  const [filterSubClient, setFilterSubClient] = useState('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'open' | 'invoiced' | 'non-billable'>(
    'all'
  );
  const [search, setSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
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
  const [formSubClientId, setFormSubClientId] = useState('');
  // Quick mode logs a duration ("3h doing X") with no clock position; timed
  // mode keeps the original start/end span. Both write the same entry record.
  const [formQuick, setFormQuick] = useState(false);
  const [formHours, setFormHours] = useState('');
  const [formError, setFormError] = useState('');
  const [actionError, setActionError] = useState('');

  const clientById = useMemo(() => new Map(store.clients.map((c) => [c.id, c] as const)), [store]);
  const projectById = useMemo(
    () => new Map(store.projects.map((p) => [p.id, p] as const)),
    [store]
  );
  const invoiceById = useMemo(
    () => new Map(store.invoices.map((i) => [i.id, i] as const)),
    [store.invoices]
  );
  const clientColors = useMemo(() => buildClientColorMap(store.clients), [store.clients]);
  // Sub-clients on the projects the customer/project filters currently allow,
  // deduped by id so the same name on two projects lists once (and matches
  // both, since ids are slugged from the name).
  const subClientOptions = useMemo(() => {
    const seen = new Map<string, { id: string; name: string }>();
    for (const p of store.projects) {
      if (filterClient !== 'all' && p.clientId !== filterClient) continue;
      if (filterProject !== 'all' && p.id !== filterProject) continue;
      for (const s of p.subClients ?? []) {
        if (!s.archived && !seen.has(s.id)) seen.set(s.id, { id: s.id, name: s.name });
      }
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [store.projects, filterClient, filterProject]);

  // Narrowing the customer/project filter can hide the sub-client dropdown
  // entirely. Fall back to 'all' when the current pick is no longer offered —
  // otherwise a filter the user can't see would silently empty the table.
  const activeSubClient =
    subClientOptions.length === 0 ||
    (filterSubClient !== 'all' &&
      filterSubClient !== 'none' &&
      !subClientOptions.some((s) => s.id === filterSubClient))
      ? 'all'
      : filterSubClient;

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
      if (activeSubClient === 'none' && e.subClientId) return false;
      if (activeSubClient !== 'all' && activeSubClient !== 'none') {
        if (e.subClientId !== activeSubClient) return false;
      }
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
            ? dir * (a.start ?? '99:99').localeCompare(b.start ?? '99:99')
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
    activeSubClient,
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
      billed: filtered.filter((e) => e.invoiced).length,
      open: filtered.filter((e) => !e.invoiced && e.billable).length,
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
    if (projectGroups.length === 0) {
      onManageProjects();
      return;
    }
    setEditingId(null);
    setFormDate(todayYMD());
    // Default to right now; picking a start auto-advances end to +30min.
    const now = nowRounded15();
    setFormStart(now);
    setFormEnd(addMinutes(now, 30));
    setFormDescription('');
    setFormRate('');
    setFormBillable(true);
    setFormSubClientId('');
    setFormQuick(false);
    setFormHours('');
    setFormError('');
    setFormOpen(true);
  };

  const handleStartChange = (time: string) => {
    setFormStart(time);
    // When logging a new entry, follow the start with a 30-minute block —
    // the end stays freely editable afterwards. Edits never auto-move.
    if (!editingId) setFormEnd(addMinutes(time, 30));
  };

  const openEdit = (entry: TimesheetEntry) => {
    const quick = !entry.start || !entry.end;
    setEditingId(entry.id);
    setFormProjectId(entry.projectId);
    setFormDate(entry.date);
    setFormStart(entry.start ?? nowRounded15());
    setFormEnd(entry.end ?? addMinutes(entry.start ?? nowRounded15(), 30));
    setFormDescription(entry.description);
    setFormRate(String(entry.hourlyRate));
    setFormBillable(entry.billable);
    setFormSubClientId(entry.subClientId ?? '');
    setFormQuick(quick);
    setFormHours(quick ? (entry.durationMinutes / 60).toFixed(2) : '');
    setFormError('');
    setFormOpen(true);
  };

  const formMinutes = formQuick
    ? Math.round((Number(formHours) || 0) * 60)
    : spanMinutes(formStart, formEnd);
  const formProject = projectById.get(formProjectId);
  // Only offer sub-clients that are still active, plus whichever one this
  // entry already points at (so editing an old entry can't silently drop it).
  const formSubClients = (formProject?.subClients ?? []).filter(
    (s) => !s.archived || s.id === formSubClientId
  );
  const effectiveRate = formRate !== '' ? Number(formRate) : (formProject?.hourlyRate ?? 0);
  const formAmount = formBillable ? (formMinutes / 60) * effectiveRate : 0;

  // The invoice a billed entry is locked to. Its billed values render
  // read-only and only the notes are sent — the server enforces the same.
  const editingEntry = editingId ? store.entries.find((e) => e.id === editingId) : undefined;
  const editLock = editingEntry ? billedOn(invoiceById, editingEntry) : undefined;

  const handleSubmit = async () => {
    if (!formProjectId || !formDate || formMinutes === 0) return;
    if (!formQuick && (!formStart || !formEnd)) return;
    setSubmitting(true);
    setFormError('');
    try {
      if (editingId && editLock) {
        await tsJson(`/entries/${editingId}`, 'PUT', {
          description: formDescription,
          subClientId: formSubClientId || null,
        });
      } else {
        // Switching an existing entry between modes must CLEAR the other
        // shape's fields, so an edit sends null ("remove this"). A create just
        // omits them — the POST route rejects a null start as a malformed span.
        const span = formQuick
          ? editingId
            ? { start: null, end: null, durationMinutes: formMinutes }
            : { durationMinutes: formMinutes }
          : { start: formStart, end: formEnd };
        const body = {
          projectId: formProjectId,
          date: formDate,
          ...span,
          ...(editingId ? { subClientId: formSubClientId || null } : {}),
          ...(!editingId && formSubClientId ? { subClientId: formSubClientId } : {}),
          description: formDescription,
          billable: formBillable,
          ...(formRate !== '' ? { hourlyRate: Number(formRate) } : {}),
        };
        if (editingId) await tsJson(`/entries/${editingId}`, 'PUT', body);
        else await tsJson('/entries', 'POST', body);
      }
      setFormOpen(false);
      await refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Save failed');
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
    setActionError('');
    try {
      await tsJson(`/entries/${entry.id}`, 'DELETE');
    } catch (err) {
      // e.g. 409: the entry was billed since this table last loaded.
      setActionError(err instanceof Error ? err.message : 'Delete failed');
    }
    await refresh();
  };

  const resetPage = () => setVisibleCount(PAGE_SIZE);
  const filterCount = [
    preset !== 'all',
    filterClient !== 'all',
    filterProject !== 'all',
    activeSubClient !== 'all',
    filterStatus !== 'all',
    search.trim() !== '',
  ].filter(Boolean).length;
  const clearFilters = () => {
    setPreset('all');
    setCustomFrom('');
    setCustomTo('');
    setFilterClient('all');
    setFilterProject('all');
    setFilterSubClient('all');
    setFilterStatus('all');
    setSearch('');
    resetPage();
  };
  const entryActions = (entry: TimesheetEntry, lock: ReturnType<typeof billedOn>) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          className="size-11 sm:size-7 shrink-0"
          aria-label="Entry actions"
          title={`Actions for ${entry.date}: ${entry.description || 'No description'}`}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => openEdit(entry)} className="min-h-11 sm:min-h-8">
          <Edit3 className="size-4" />
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          disabled={!!lock}
          onClick={() => void handleDelete(entry)}
          className="min-h-11 sm:min-h-8"
        >
          <Trash2 className="size-4" />
          {lock ? `Delete — locked by ${lock.number}` : 'Delete'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div>
      {confirmDialog}

      <div className="space-y-3 mb-4">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[11rem_minmax(0,1fr)_auto] items-end gap-3">
          <label className="min-w-0 text-xs text-surface-600 space-y-1">
            <span>Date range</span>
            <select
              aria-label="Date range"
              value={preset}
              onChange={(e) => {
                setPreset(e.target.value as RangePreset);
                resetPage();
              }}
              className={FILTER_CLASS}
            >
              {RANGE_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <Button
            onClick={openNew}
            className="min-h-11 sm:min-h-9 col-start-2 sm:col-start-3 row-start-1"
          >
            <Plus className="w-4 h-4" />
            {projectGroups.length === 0 ? 'Set up project' : 'Log Time'}
          </Button>
          <div className="flex items-center gap-2 col-span-2 sm:col-span-1 sm:col-start-2 sm:row-start-1">
            <Input
              aria-label="Search time entry descriptions"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                resetPage();
              }}
              placeholder="Search descriptions…"
              className="flex-1 min-w-0 h-11 sm:h-9 text-base sm:text-sm"
            />
            <Button
              variant="outline"
              onClick={() => setFiltersOpen(!filtersOpen)}
              aria-expanded={filtersOpen}
              aria-controls="timesheet-filters"
              className="min-h-11 sm:hidden"
            >
              <SlidersHorizontal className="size-4" />
              Filters{filterCount > 0 ? ` (${filterCount})` : ''}
            </Button>
          </div>
        </div>
        {preset === 'custom' && (
          <div className="grid grid-cols-2 gap-3">
            <label className="min-w-0 text-xs text-surface-600 space-y-1">
              <span>From date</span>
              <Input
                type="date"
                value={customFrom}
                onChange={(e) => {
                  setCustomFrom(e.target.value);
                  resetPage();
                }}
                className="min-w-0 h-11 sm:h-9 text-base sm:text-sm"
              />
            </label>
            <label className="min-w-0 text-xs text-surface-600 space-y-1">
              <span>To date</span>
              <Input
                type="date"
                value={customTo}
                onChange={(e) => {
                  setCustomTo(e.target.value);
                  resetPage();
                }}
                className="min-w-0 h-11 sm:h-9 text-base sm:text-sm"
              />
            </label>
            {customFrom && customTo && customTo < customFrom && (
              <p role="alert" className="col-span-2 text-xs text-danger-400">
                The end date must be on or after the start date.
              </p>
            )}
          </div>
        )}
        <div id="timesheet-filters" className={filtersOpen ? 'block' : 'hidden sm:block'}>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="min-w-0 text-xs text-surface-600 space-y-1">
              <span>Customer</span>
              <select
                aria-label="Customer"
                value={filterClient}
                onChange={(e) => {
                  setFilterClient(e.target.value);
                  setFilterProject('all');
                  resetPage();
                }}
                className={FILTER_CLASS}
              >
                <option value="all">All customers</option>
                {store.clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-0 text-xs text-surface-600 space-y-1">
              <span>Project</span>
              <select
                aria-label="Project"
                value={filterProject}
                onChange={(e) => {
                  setFilterProject(e.target.value);
                  resetPage();
                }}
                className={FILTER_CLASS}
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
            </label>
            {subClientOptions.length > 0 && (
              <label className="min-w-0 text-xs text-surface-600 space-y-1">
                <span>Sub-client</span>
                <select
                  aria-label="Sub-client"
                  value={activeSubClient}
                  onChange={(e) => {
                    setFilterSubClient(e.target.value);
                    resetPage();
                  }}
                  className={FILTER_CLASS}
                >
                  <option value="all">All sub-clients</option>
                  <option value="none">Untagged</option>
                  {subClientOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="min-w-0 text-xs text-surface-600 space-y-1">
              <span>Status</span>
              <select
                aria-label="Status"
                value={filterStatus}
                onChange={(e) => {
                  setFilterStatus(e.target.value as typeof filterStatus);
                  resetPage();
                }}
                className={FILTER_CLASS}
              >
                <option value="all">All statuses</option>
                <option value="open">Open (uninvoiced)</option>
                <option value="invoiced">Invoiced</option>
                <option value="non-billable">Non-billable</option>
              </select>
            </label>
          </div>
          <div className="mt-3 sm:hidden">
            <label className="flex-1 min-w-0 text-xs text-surface-600 space-y-1">
              <span>Sort entries</span>
              <select
                aria-label="Sort entries"
                value={`${sortKey}:${sortDesc ? 'desc' : 'asc'}`}
                onChange={(e) => {
                  const [key, direction] = e.target.value.split(':');
                  setSortKey(key as SortKey);
                  setSortDesc(direction === 'desc');
                  resetPage();
                }}
                className={FILTER_CLASS}
              >
                <option value="date:desc">Newest first</option>
                <option value="date:asc">Oldest first</option>
                <option value="duration:desc">Most hours first</option>
                <option value="duration:asc">Fewest hours first</option>
                <option value="amount:desc">Highest amount first</option>
                <option value="amount:asc">Lowest amount first</option>
                <option value="rate:desc">Highest rate first</option>
                <option value="rate:asc">Lowest rate first</option>
              </select>
            </label>
          </div>
        </div>
        {filterCount > 0 && (
          <Button
            variant="ghost"
            onClick={clearFilters}
            className={`min-h-11 sm:min-h-8 -ml-2 ${filtersOpen ? '' : 'hidden sm:inline-flex'}`}
          >
            Clear filters · show all time
          </Button>
        )}
      </div>

      {/* Log / edit modal */}
      <Dialog open={formOpen} onOpenChange={(open) => !open && !submitting && setFormOpen(false)}>
        <DialogContent closeDisabled={submitting} className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Entry' : 'Log Time'}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            {editLock && (
              <div className="flex gap-2 rounded-lg border border-border bg-surface-100/60 px-3 py-2 text-[12px] text-surface-700">
                <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0 text-surface-500" aria-hidden />
                <p>
                  Billed on invoice <span className="font-mono">{editLock.number}</span> (
                  {editLock.status}, issued {editLock.issueDate}). Hours, times, date, project, rate
                  and billable are locked to what that invoice charged, so this work can't be billed
                  twice. The description and sub-client can still change. To change billed values,
                  delete the invoice (it releases its entries) and invoice again.
                </p>
              </div>
            )}
            <div className="flex items-center gap-1 mb-1">
              {[
                { quick: false, label: 'Start / end' },
                { quick: true, label: 'Just hours' },
              ].map((mode) => (
                <button
                  key={mode.label}
                  type="button"
                  disabled={!!editLock}
                  onClick={() => {
                    // Carry the duration across so switching modes never loses it.
                    if (mode.quick && !formQuick) setFormHours((formMinutes / 60).toFixed(2));
                    setFormQuick(mode.quick);
                  }}
                  aria-pressed={formQuick === mode.quick}
                  className={`min-h-11 px-3 rounded-lg text-[12px] border disabled:opacity-50 disabled:cursor-not-allowed ${
                    formQuick === mode.quick
                      ? 'bg-surface-200 border-border text-surface-900'
                      : 'bg-transparent border-transparent text-surface-500 hover:text-surface-700'
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label
                  htmlFor="timesheettab-field-1"
                  className="text-[12px] text-surface-600 block mb-1"
                >
                  Project
                </label>
                <select
                  id="timesheettab-field-1"
                  value={formProjectId}
                  disabled={!!editLock}
                  onChange={(e) => {
                    setFormProjectId(e.target.value);
                    setFormRate('');
                  }}
                  className="w-full h-9 rounded-lg text-sm bg-surface-100 border border-border px-3 disabled:opacity-60"
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
                <label
                  htmlFor="timesheettab-field-2"
                  className="text-[12px] text-surface-600 block mb-1"
                >
                  Date
                </label>
                <Input
                  id="timesheettab-field-2"
                  type="date"
                  value={formDate}
                  disabled={!!editLock}
                  onChange={(e) => setFormDate(e.target.value)}
                  className="h-9 rounded-lg text-sm"
                />
              </div>
              {formQuick ? (
                <div className="col-span-2 sm:col-span-1">
                  <label className="text-[12px] text-surface-600 block mb-1">Hours</label>
                  <Input
                    type="number"
                    step="0.25"
                    min="0"
                    inputMode="decimal"
                    disabled={!!editLock}
                    value={formHours}
                    onChange={(e) => setFormHours(e.target.value)}
                    placeholder="e.g. 2.5"
                    className="h-9 rounded-lg text-sm"
                    aria-label="Hours worked"
                  />
                </div>
              ) : (
                <div className="col-span-2 sm:col-span-1 flex gap-2">
                  <div className="flex-1 min-w-0">
                    <label className="text-[12px] text-surface-600 block mb-1">Start</label>
                    <TimeSlotPicker
                      value={formStart}
                      onChange={handleStartChange}
                      ariaLabel="Start time"
                      hour24={hour24}
                      disabled={!!editLock}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <label className="text-[12px] text-surface-600 block mb-1">End</label>
                    <TimeSlotPicker
                      value={formEnd}
                      onChange={setFormEnd}
                      ariaLabel="End time"
                      hour24={hour24}
                      disabled={!!editLock}
                    />
                  </div>
                </div>
              )}
              {formSubClients.length > 0 && (
                <div className="col-span-2">
                  <label
                    htmlFor="timesheettab-field-3"
                    className="text-[12px] text-surface-600 block mb-1"
                  >
                    Sub-client <span className="text-surface-500">(optional)</span>
                  </label>
                  <select
                    id="timesheettab-field-3"
                    value={formSubClientId}
                    onChange={(e) => setFormSubClientId(e.target.value)}
                    className="w-full h-9 rounded-lg text-sm bg-surface-100 border border-border px-3"
                  >
                    <option value="">None</option>
                    {formSubClients.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="col-span-2">
                <label
                  htmlFor="timesheettab-field-4"
                  className="text-[12px] text-surface-600 block mb-1"
                >
                  Description
                </label>
                <textarea
                  id="timesheettab-field-4"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="What did you work on?"
                  rows={3}
                  className="w-full rounded-lg text-sm bg-surface-100 border border-border px-3 py-2"
                />
              </div>
              <div>
                <label className="text-[12px] text-surface-600 block mb-1">
                  Rate ($/h{formProject && formRate === '' ? ' · project default' : ''})
                </label>
                <Input
                  type="number"
                  aria-label="Hourly rate"
                  value={formRate}
                  disabled={!!editLock}
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
                    disabled={!!editLock}
                    onChange={(e) => setFormBillable(e.target.checked)}
                  />
                  Billable
                </label>
              </div>
            </div>
          </DialogBody>
          <DialogFooter className="items-center gap-3 sm:justify-between">
            <span className="text-[13px] text-surface-600 tabular-nums">
              {formatHours(formMinutes)}
              {formBillable && formMinutes > 0 && (
                <>
                  {' · '}
                  <Money>{formatUsd(formAmount)}</Money>
                </>
              )}
              {formError && <span className="block text-[12px] text-danger-400">{formError}</span>}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={submitting}
                onClick={() => setFormOpen(false)}
              >
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
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2 text-[12px] text-surface-600 tabular-nums">
        <span>
          {filtered.length} entries · {formatHours(totals.minutes)}
        </span>
        <span className="font-mono font-semibold text-surface-900">
          <Money>{formatUsd(totals.amount)}</Money>
        </span>
        {(totals.billed > 0 || totals.open > 0) && (
          <span>
            {totals.billed} billed · <span className="text-lime-400">{totals.open} open</span>
          </span>
        )}
        {actionError && (
          <span role="alert" className="text-danger-400">
            {actionError}
          </span>
        )}
      </div>

      {filtered.length === 0 && (
        <Card className="p-6 text-center space-y-3">
          <p className="text-sm font-medium text-surface-900">
            {store.entries.length === 0
              ? projectGroups.length === 0
                ? 'Set up your first project'
                : 'No time logged yet'
              : 'No entries match these filters'}
          </p>
          <p className="text-sm text-surface-600">
            {store.entries.length === 0
              ? projectGroups.length === 0
                ? 'Add a customer and project before logging time. Set the hourly rate on the project.'
                : 'Log a start/end time or just the hours worked.'
              : 'Change the date range or clear filters to see your other entries.'}
          </p>
          <Button
            variant="outline"
            onClick={store.entries.length === 0 ? openNew : clearFilters}
            className="min-h-11"
          >
            {store.entries.length === 0
              ? projectGroups.length === 0
                ? 'Create your first project'
                : 'Log your first entry'
              : 'Show all entries'}
          </Button>
        </Card>
      )}
      <div className="space-y-3 sm:hidden" aria-label="Time entries">
        {filtered.slice(0, visibleCount).map((entry) => {
          const project = projectById.get(entry.projectId);
          const client = project ? clientById.get(project.clientId) : undefined;
          const subClient = project?.subClients?.find((sub) => sub.id === entry.subClientId);
          const lock = billedOn(invoiceById, entry);
          return (
            <Card key={entry.id} variant="glass" className="p-3" data-entry-id={entry.id}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-surface-900 tabular-nums">{entry.date}</p>
                  <p className="text-xs text-surface-600 tabular-nums">
                    {entry.start && entry.end
                      ? `${formatClock(entry.start, hour24)}–${formatClock(entry.end, hour24)}`
                      : 'Hours only'}
                  </p>
                </div>
                {entryActions(entry, lock)}
              </div>
              <p className="text-xs text-surface-600 mt-2 break-words">
                <span
                  className="inline-block size-2 rounded-full mr-1.5"
                  style={{ backgroundColor: projectDisplayColor(project, clientColors) }}
                />
                {client?.name ?? 'Unknown customer'} / {project?.name ?? 'Unknown project'}
                {subClient && <span className="block mt-1">{subClient.name}</span>}
              </p>
              <p className="text-sm text-surface-950 mt-3 whitespace-pre-wrap break-words">
                {entry.description || <i className="text-surface-500">No description</i>}
              </p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 pt-3 border-t border-border text-sm tabular-nums">
                <span className="font-medium">{formatHours(entry.durationMinutes)}</span>
                {entry.billable && (
                  <span className="font-mono text-surface-900">
                    <Money>{formatUsd(entry.amount)}</Money>
                  </span>
                )}
                <span
                  className={`text-xs ${!lock && entry.billable && !entry.invoiced ? 'text-lime-400' : 'text-surface-600'}`}
                >
                  {lock ? (
                    <span className="inline-flex gap-1 items-center">
                      <Lock className="size-3" aria-hidden />
                      Billed · {lock.number}
                    </span>
                  ) : !entry.billable ? (
                    'Non-billable'
                  ) : entry.invoiced ? (
                    'Invoiced'
                  ) : (
                    'Open'
                  )}
                </span>
              </div>
            </Card>
          );
        })}
      </div>
      {/* Larger screens retain the sortable table. */}
      <Card
        variant="glass"
        className={filtered.length === 0 ? 'hidden' : 'hidden sm:block overflow-x-auto'}
      >
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
                const dotColor = projectDisplayColor(project, clientColors);
                const subClientName = e.subClientId
                  ? project?.subClients?.find((s) => s.id === e.subClientId)?.name
                  : undefined;
                const lock = billedOn(invoiceById, e);
                return (
                  <tr key={e.id} className="group hover:bg-surface-100/50">
                    <td className="px-3 sm:px-4 py-2 text-surface-700 tabular-nums whitespace-nowrap">
                      {e.date}
                    </td>
                    <td className="px-2 py-2 text-surface-500 tabular-nums text-[12px] whitespace-nowrap hidden md:table-cell">
                      {e.start && e.end ? (
                        `${formatClock(e.start, hour24)}–${formatClock(e.end, hour24)}`
                      ) : (
                        <span title="Logged as a duration, not a clock span">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-surface-600 text-[12px] whitespace-nowrap hidden sm:table-cell">
                      <span
                        className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
                        style={{ backgroundColor: dotColor }}
                      />
                      {client?.name} / {project?.name}
                      {subClientName && (
                        <span className="block ml-3.5 text-[11px] text-surface-500">
                          ↳ {subClientName}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-surface-900 max-w-[9rem] sm:max-w-[26rem]">
                      <span className="line-clamp-2">
                        {e.description || <i className="text-surface-500">no description</i>}
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
                      {lock ? (
                        <span
                          className="inline-flex items-center gap-1 text-[11px] text-surface-500"
                          title={`Billed on invoice ${lock.number} (${lock.status}, issued ${lock.issueDate}) — locked until that invoice is deleted`}
                        >
                          <Lock className="w-3 h-3" aria-hidden />
                          <span className="font-mono tabular-nums">{lock.number}</span>
                        </span>
                      ) : !e.billable ? (
                        <span className="text-[11px] text-surface-500">non-billable</span>
                      ) : e.invoiced ? (
                        <span className="text-[11px] text-surface-500">invoiced</span>
                      ) : (
                        <span className="text-[11px] text-lime-400">open</span>
                      )}
                    </td>
                    <td className="px-2 py-2">{entryActions(e, lock)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </Card>
      {filtered.length > visibleCount && (
        <button
          className="w-full min-h-11 mt-3 py-2.5 text-[12px] text-surface-600 hover:text-surface-900 flex items-center justify-center gap-1 border-t border-border/50"
          onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
        >
          <ChevronDown className="w-3.5 h-3.5" />
          Show more ({filtered.length - visibleCount} remaining)
        </button>
      )}
    </div>
  );
}
