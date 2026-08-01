// Invoices tab — persisted invoice history (sortable, filterable by
// customer/project/status) with a modal create flow: customer + optional
// project + date window over open entries + template, PDF preview before
// committing. Deleting an invoice releases its entries back to open.

import { useState, useMemo } from 'react';
import {
  FileDown,
  Loader2,
  Trash2,
  ArrowUp,
  ArrowDown,
  Plus,
  MoreHorizontal,
  CircleCheck,
  RotateCcw,
} from 'lucide-react';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { Money } from '../common/Money';
import {
  tsJson,
  downloadPdf,
  formatUsd,
  formatHours,
  buildClientColorMap,
  type Invoice,
  type TimesheetStore,
} from './types';

type SortKey = 'number' | 'issueDate' | 'total';

export function InvoicesTab({
  store,
  refresh,
}: {
  store: TimesheetStore;
  refresh: () => Promise<void>;
}) {
  const { confirm, ConfirmDialog } = useConfirmDialog();

  // Create modal
  const [createOpen, setCreateOpen] = useState(false);
  const [clientId, setClientId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<'' | 'preview' | 'create'>('');
  const [error, setError] = useState('');

  // History filters/sort
  const [filterClient, setFilterClient] = useState('all');
  const [filterProject, setFilterProject] = useState('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'new' | 'paid' | 'canceled'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('issueDate');
  const [sortDesc, setSortDesc] = useState(true);

  const clientById = useMemo(() => new Map(store.clients.map((c) => [c.id, c] as const)), [store]);
  const projectById = useMemo(
    () => new Map(store.projects.map((p) => [p.id, p] as const)),
    [store]
  );
  const clientColors = useMemo(() => buildClientColorMap(store.clients), [store.clients]);

  // Open (billable, uninvoiced) counts per client — shown in the picker.
  const openByClient = useMemo(() => {
    const agg = new Map<string, number>();
    for (const e of store.entries) {
      if (e.invoiced || !e.billable) continue;
      const cid = projectById.get(e.projectId)?.clientId;
      if (!cid) continue;
      agg.set(cid, (agg.get(cid) ?? 0) + 1);
    }
    return agg;
  }, [store, projectById]);

  // What the current create-modal selection would bill.
  const selection = useMemo(() => {
    if (!clientId) return null;
    const entries = store.entries.filter((e) => {
      if (e.invoiced || !e.billable) return false;
      if (projectById.get(e.projectId)?.clientId !== clientId) return false;
      if (projectId && e.projectId !== projectId) return false;
      if (from && e.date < from) return false;
      if (to && e.date > to) return false;
      return true;
    });
    return {
      count: entries.length,
      minutes: entries.reduce((s, e) => s + e.durationMinutes, 0),
      amount: entries.reduce((s, e) => s + e.amount, 0),
    };
  }, [store, clientId, projectId, from, to, projectById]);

  const createBody = () => ({
    clientId,
    ...(projectId ? { projectId } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(templateId ? { templateId } : {}),
    ...(comment.trim() ? { comment: comment.trim() } : {}),
  });

  const openCreate = () => {
    setError('');
    setComment('');
    setCreateOpen(true);
  };

  const handlePreview = async () => {
    setBusy('preview');
    setError('');
    try {
      await downloadPdf('/invoices/preview', createBody());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed');
    } finally {
      setBusy('');
    }
  };

  const handleCreate = async () => {
    if (!selection || selection.count === 0) return;
    const ok = await confirm({
      title: 'Create invoice?',
      description: `${selection.count} open entries (${formatHours(selection.minutes)}) will be invoiced and marked. Deleting the invoice later releases them.`,
      confirmLabel: 'Create invoice',
    });
    if (!ok) return;
    setBusy('create');
    setError('');
    try {
      const result = await tsJson<{ invoice: Invoice }>('/invoices', 'POST', createBody());
      setCreateOpen(false);
      await refresh();
      await downloadPdf(`/invoices/${result.invoice.id}/pdf`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setBusy('');
    }
  };

  const handleMarkStatus = async (invoice: Invoice, status: Invoice['status']) => {
    if (status === 'paid') {
      const ok = await confirm({
        title: `Mark ${invoice.number} paid?`,
        description: `${invoice.clientName} · ${formatUsd(invoice.total)} will be recorded as paid today.`,
        confirmLabel: 'Mark paid',
      });
      if (!ok) return;
    }
    await tsJson(`/invoices/${invoice.id}`, 'PUT', { status });
    await refresh();
  };

  const handleDelete = async (invoice: Invoice) => {
    const releases = invoice.entryIds.length;
    const ok = await confirm({
      title: `Delete invoice ${invoice.number}?`,
      description:
        releases > 0
          ? `${releases} linked entries will be released back to open.`
          : 'Imported record — no linked entries. This only removes the history row.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    await tsJson(`/invoices/${invoice.id}`, 'DELETE');
    await refresh();
  };

  const filteredInvoices = useMemo(() => {
    const rows = store.invoices.filter((inv) => {
      if (filterClient !== 'all' && inv.clientId !== filterClient) return false;
      if (filterProject !== 'all' && !(inv.projectIds ?? []).includes(filterProject)) return false;
      if (filterStatus !== 'all' && inv.status !== filterStatus) return false;
      return true;
    });
    const dir = sortDesc ? -1 : 1;
    rows.sort((a, b) => {
      switch (sortKey) {
        case 'number':
          return dir * a.number.localeCompare(b.number);
        case 'total':
          return dir * (a.total - b.total);
        default:
          return a.issueDate === b.issueDate
            ? dir * a.createdAt.localeCompare(b.createdAt)
            : dir * a.issueDate.localeCompare(b.issueDate);
      }
    });
    return rows;
  }, [store.invoices, filterClient, filterProject, filterStatus, sortKey, sortDesc]);

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

  const statusBadge = (inv: Invoice) => {
    if (inv.status === 'paid')
      return (
        <span
          className="text-[11px] text-emerald-400"
          title={inv.paymentDate ? `Paid ${inv.paymentDate}` : undefined}
        >
          paid
        </span>
      );
    if (inv.status === 'canceled')
      return <span className="text-[11px] text-surface-500">canceled</span>;
    return <span className="text-[11px] text-amber-400">new</span>;
  };

  return (
    <div>
      <ConfirmDialog />

      {/* Toolbar: filters + create button */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <select
          value={filterClient}
          onChange={(e) => {
            setFilterClient(e.target.value);
            setFilterProject('all');
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
          onChange={(e) => setFilterProject(e.target.value)}
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
          onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
          className="h-8 rounded-lg text-[12px] bg-surface-100 border border-border px-2"
        >
          <option value="all">All statuses</option>
          <option value="new">New</option>
          <option value="paid">Paid</option>
          <option value="canceled">Canceled</option>
        </select>
        <span className="text-[12px] text-surface-500 tabular-nums hidden sm:inline">
          {filteredInvoices.length} invoices ·{' '}
          <Money>{formatUsd(filteredInvoices.reduce((s, i) => s + i.total, 0))}</Money>
        </span>
        <div className="ml-auto">
          <Button size="sm" onClick={openCreate}>
            <Plus className="w-4 h-4" />
            New Invoice
          </Button>
        </div>
      </div>

      {/* Create modal */}
      <Dialog open={createOpen} onOpenChange={(open) => !open && setCreateOpen(false)}>
        <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Invoice</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[12px] text-surface-600 block mb-1">Customer</label>
              <select
                value={clientId}
                onChange={(e) => {
                  setClientId(e.target.value);
                  setProjectId('');
                }}
                className="w-full h-9 rounded-lg text-sm bg-surface-100 border border-border px-3"
              >
                <option value="">Select…</option>
                {store.clients
                  .filter((c) => !c.archived)
                  .map((c) => {
                    const open = openByClient.get(c.id);
                    return (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {open ? ` (${open} open)` : ''}
                      </option>
                    );
                  })}
              </select>
            </div>
            <div>
              <label className="text-[12px] text-surface-600 block mb-1">Project (optional)</label>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full h-9 rounded-lg text-sm bg-surface-100 border border-border px-3"
              >
                <option value="">All projects</option>
                {store.projects
                  .filter((p) => p.clientId === clientId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="text-[12px] text-surface-600 block mb-1">From (optional)</label>
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="h-9 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="text-[12px] text-surface-600 block mb-1">To (optional)</label>
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="h-9 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="text-[12px] text-surface-600 block mb-1">Template</label>
              <select
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                className="w-full h-9 rounded-lg text-sm bg-surface-100 border border-border px-3"
              >
                <option value="">Default</option>
                {store.templates
                  .filter((t) => !t.archived)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="text-[12px] text-surface-600 block mb-1">Comment (optional)</label>
              <Input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Shown on the PDF"
                className="h-9 rounded-lg text-sm"
              />
            </div>
          </div>
          <div className="text-[13px] text-surface-600 tabular-nums">
            {selection ? (
              selection.count > 0 ? (
                <>
                  {selection.count} open entries · {formatHours(selection.minutes)} ·{' '}
                  <Money>{formatUsd(selection.amount)}</Money>
                </>
              ) : (
                'No open entries in this window'
              )
            ) : (
              'Pick a customer to see open entries'
            )}
            {error && <span className="block text-danger-400 mt-1">{error}</span>}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== '' || !selection || selection.count === 0}
              onClick={() => void handlePreview()}
            >
              {busy === 'preview' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Preview PDF'}
            </Button>
            <Button
              size="sm"
              disabled={busy !== '' || !selection || selection.count === 0}
              onClick={() => void handleCreate()}
            >
              {busy === 'create' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create Invoice'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* History table */}
      <Card variant="glass" className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-surface-500 border-b border-border">
              <th className="px-3 sm:px-4 py-2.5 font-semibold">
                <SortHeader label="Number" k="number" />
              </th>
              <th className="px-2 py-2.5 font-semibold hidden sm:table-cell">
                <SortHeader label="Date" k="issueDate" />
              </th>
              <th className="px-2 py-2.5 font-semibold">Customer</th>
              <th className="px-2 py-2.5 font-semibold text-right hidden md:table-cell">Hours</th>
              <th className="px-2 py-2.5 font-semibold text-right">
                <SortHeader label="Total" k="total" />
              </th>
              <th className="px-2 py-2.5 font-semibold hidden sm:table-cell">Status</th>
              <th className="px-2 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {filteredInvoices.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-surface-500">
                  No invoices match the current filter.
                </td>
              </tr>
            ) : (
              filteredInvoices.map((inv) => (
                <tr key={inv.id} className="group hover:bg-surface-100/50">
                  <td className="px-3 sm:px-4 py-2 font-mono tabular-nums whitespace-nowrap text-surface-900">
                    {inv.number}
                  </td>
                  <td className="px-2 py-2 text-surface-700 tabular-nums whitespace-nowrap hidden sm:table-cell">
                    {inv.issueDate}
                  </td>
                  <td className="px-2 py-2 text-surface-800 whitespace-nowrap">
                    <span
                      className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
                      style={{ backgroundColor: clientColors.get(inv.clientId) ?? '#5b6070' }}
                    />
                    {clientById.get(inv.clientId)?.name ?? inv.clientName}
                    <span className="block text-[11px] text-surface-500 sm:hidden pl-3.5">
                      {inv.issueDate} · {inv.status}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right text-surface-600 tabular-nums whitespace-nowrap hidden md:table-cell">
                    {inv.totalMinutes > 0 ? formatHours(inv.totalMinutes) : '—'}
                  </td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums text-surface-900 whitespace-nowrap">
                    <Money>{formatUsd(inv.total)}</Money>
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap hidden sm:table-cell">
                    {statusBadge(inv)}
                  </td>
                  <td className="px-2 py-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-xs" aria-label="Invoice actions">
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {inv.lines.length > 0 && (
                          <DropdownMenuItem
                            onClick={() => void downloadPdf(`/invoices/${inv.id}/pdf`)}
                          >
                            <FileDown className="w-3.5 h-3.5" />
                            Download PDF
                          </DropdownMenuItem>
                        )}
                        {inv.status === 'new' ? (
                          <DropdownMenuItem onClick={() => void handleMarkStatus(inv, 'paid')}>
                            <CircleCheck className="w-3.5 h-3.5" />
                            Mark paid
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => void handleMarkStatus(inv, 'new')}>
                            <RotateCcw className="w-3.5 h-3.5" />
                            Reopen
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => void handleDelete(inv)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
