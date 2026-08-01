// Customers & Projects tab — management tables with inline rename, per-row
// color pickers (the color flows to entry rows, invoices, and every chart),
// and an ellipsis menu per row for archive/delete, both behind confirmation.
// Rates live on projects; changing a rate only affects future entries.

import { useState, useMemo } from 'react';
import { Plus, Trash2, Archive, ArchiveRestore, MoreHorizontal } from 'lucide-react';
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
  formatHours,
  formatUsd,
  buildClientColorMap,
  projectDisplayColor,
  type TimesheetStore,
} from './types';

/** Color dot that opens the native color picker; commits on change. */
function ColorDot({
  color,
  label,
  onCommit,
}: {
  color: string;
  label: string;
  onCommit: (hex: string) => void;
}) {
  return (
    <label
      className="inline-block w-4 h-4 rounded-full cursor-pointer border border-border/60 shrink-0"
      style={{ backgroundColor: color }}
      title={`${label} color — click to change`}
    >
      <input
        type="color"
        value={color}
        onChange={(e) => onCommit(e.target.value)}
        className="sr-only"
        aria-label={`${label} color`}
      />
    </label>
  );
}

export function CustomersTab({
  store,
  refresh,
}: {
  store: TimesheetStore;
  refresh: () => Promise<void>;
}) {
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const [addClientOpen, setAddClientOpen] = useState(false);
  const [addProjectOpen, setAddProjectOpen] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectClient, setNewProjectClient] = useState('');
  const [newProjectRate, setNewProjectRate] = useState('');
  const [error, setError] = useState('');

  const projectById = useMemo(
    () => new Map(store.projects.map((p) => [p.id, p] as const)),
    [store]
  );
  const clientColors = useMemo(() => buildClientColorMap(store.clients), [store.clients]);

  const clientTotals = useMemo(() => {
    const agg = new Map<string, { minutes: number; amount: number }>();
    for (const e of store.entries) {
      const cid = projectById.get(e.projectId)?.clientId;
      if (!cid) continue;
      const a = agg.get(cid) ?? { minutes: 0, amount: 0 };
      a.minutes += e.durationMinutes;
      a.amount += e.amount;
      agg.set(cid, a);
    }
    return agg;
  }, [store, projectById]);

  const projectTotals = useMemo(() => {
    const agg = new Map<string, { minutes: number; entries: number }>();
    for (const e of store.entries) {
      const a = agg.get(e.projectId) ?? { minutes: 0, entries: 0 };
      a.minutes += e.durationMinutes;
      a.entries += 1;
      agg.set(e.projectId, a);
    }
    return agg;
  }, [store]);

  const call = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    }
  };

  const renameClient = (id: string, name: string, prev: string) => {
    if (!name.trim() || name.trim() === prev) return;
    void call(() => tsJson(`/clients/${id}`, 'PUT', { name: name.trim() }));
  };

  const renameProject = (id: string, name: string, prev: string) => {
    if (!name.trim() || name.trim() === prev) return;
    void call(() => tsJson(`/projects/${id}`, 'PUT', { name: name.trim() }));
  };

  const setProjectRate = (id: string, rate: string, prev: number) => {
    const value = Number(rate);
    if (Number.isNaN(value) || value === prev) return;
    void call(() => tsJson(`/projects/${id}`, 'PUT', { hourlyRate: value }));
  };

  const toggleArchived = async (
    kind: 'clients' | 'projects',
    id: string,
    name: string,
    archived: boolean
  ) => {
    const ok = await confirm({
      title: `${archived ? 'Archive' : 'Unarchive'} ${name}?`,
      description: archived
        ? 'Archived items are hidden from pickers but keep their history.'
        : 'It will reappear in pickers and forms.',
      confirmLabel: archived ? 'Archive' : 'Unarchive',
    });
    if (!ok) return;
    await call(() => tsJson(`/${kind}/${id}`, 'PUT', { archived }));
  };

  const deleteItem = async (kind: 'clients' | 'projects', id: string, name: string) => {
    const ok = await confirm({
      title: `Delete ${name}?`,
      description:
        kind === 'clients'
          ? 'Only possible when no projects reference this customer.'
          : 'Only possible when no entries reference this project.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    await call(() => tsJson(`/${kind}/${id}`, 'DELETE'));
  };

  const rowMenu = (
    kind: 'clients' | 'projects',
    item: { id: string; name: string; archived: boolean }
  ) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={`${item.name} actions`}>
          <MoreHorizontal className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() => void toggleArchived(kind, item.id, item.name, !item.archived)}
        >
          {item.archived ? (
            <ArchiveRestore className="w-3.5 h-3.5" />
          ) : (
            <Archive className="w-3.5 h-3.5" />
          )}
          {item.archived ? 'Unarchive' : 'Archive'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => void deleteItem(kind, item.id, item.name)}
        >
          <Trash2 className="w-3.5 h-3.5" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <ConfirmDialog />
      {error && <p className="lg:col-span-2 text-[12px] text-danger-400">{error}</p>}

      {/* Customers */}
      <Card variant="glass" className="p-5 overflow-x-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[14px] font-semibold text-surface-950">Customers</h3>
          <Button size="sm" variant="outline" onClick={() => setAddClientOpen(true)}>
            <Plus className="w-3.5 h-3.5" />
            Add
          </Button>
        </div>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-surface-500 border-b border-border">
              <th className="py-2 font-semibold" colSpan={2}>
                Name
              </th>
              <th className="py-2 font-semibold text-right">Lifetime</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {store.clients.map((c) => {
              const totals = clientTotals.get(c.id);
              return (
                <tr key={c.id} className={c.archived ? 'opacity-50' : ''}>
                  <td className="py-1.5 pr-2 w-6">
                    <ColorDot
                      color={clientColors.get(c.id) ?? '#5b6070'}
                      label={c.name}
                      onCommit={(hex) =>
                        void call(() => tsJson(`/clients/${c.id}`, 'PUT', { color: hex }))
                      }
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    <Input
                      defaultValue={c.name}
                      onBlur={(e) => renameClient(c.id, e.target.value, c.name)}
                      className="h-8 rounded-lg text-[13px]"
                    />
                  </td>
                  <td className="py-1.5 text-right text-[12px] text-surface-600 tabular-nums whitespace-nowrap">
                    {totals ? (
                      <>
                        {formatHours(totals.minutes)} · <Money>{formatUsd(totals.amount)}</Money>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="py-1.5 pl-2 text-right whitespace-nowrap">
                    {rowMenu('clients', c)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {/* Projects */}
      <Card variant="glass" className="p-5 overflow-x-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[14px] font-semibold text-surface-950">Projects</h3>
          <Button size="sm" variant="outline" onClick={() => setAddProjectOpen(true)}>
            <Plus className="w-3.5 h-3.5" />
            Add
          </Button>
        </div>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-surface-500 border-b border-border">
              <th className="py-2 font-semibold" colSpan={2}>
                Project
              </th>
              <th className="py-2 font-semibold">Customer</th>
              <th className="py-2 font-semibold text-right">Rate $/h</th>
              <th className="py-2 font-semibold text-right hidden xl:table-cell">Entries</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {store.projects.map((p) => {
              const totals = projectTotals.get(p.id);
              return (
                <tr key={p.id} className={p.archived ? 'opacity-50' : ''}>
                  <td className="py-1.5 pr-2 w-6">
                    {/* falls back to the client color until a custom one is set */}
                    <ColorDot
                      color={projectDisplayColor(p, clientColors)}
                      label={p.name}
                      onCommit={(hex) =>
                        void call(() => tsJson(`/projects/${p.id}`, 'PUT', { color: hex }))
                      }
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    <Input
                      defaultValue={p.name}
                      onBlur={(e) => renameProject(p.id, e.target.value, p.name)}
                      className="h-8 rounded-lg text-[13px]"
                    />
                  </td>
                  <td className="py-1.5 text-[12px] text-surface-600 whitespace-nowrap">
                    {store.clients.find((c) => c.id === p.clientId)?.name}
                  </td>
                  <td className="py-1.5 pl-2 text-right">
                    <Money>
                      <Input
                        type="number"
                        defaultValue={p.hourlyRate}
                        onBlur={(e) => setProjectRate(p.id, e.target.value, p.hourlyRate)}
                        className="h-8 w-20 rounded-lg text-[12px] text-right tabular-nums inline-block"
                      />
                    </Money>
                  </td>
                  <td className="py-1.5 text-right text-[12px] text-surface-600 tabular-nums whitespace-nowrap hidden xl:table-cell">
                    {totals ? `${totals.entries} · ${formatHours(totals.minutes)}` : '—'}
                  </td>
                  <td className="py-1.5 pl-2 text-right whitespace-nowrap">
                    {rowMenu('projects', p)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {/* Add customer modal */}
      <Dialog open={addClientOpen} onOpenChange={(open) => !open && setAddClientOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Customer</DialogTitle>
          </DialogHeader>
          <div>
            <label className="text-[12px] text-surface-600 block mb-1">Name</label>
            <Input
              value={newClientName}
              onChange={(e) => setNewClientName(e.target.value)}
              placeholder="Customer name"
              className="h-9 rounded-lg text-sm"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAddClientOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!newClientName.trim()}
              onClick={() =>
                void call(async () => {
                  await tsJson('/clients', 'POST', { name: newClientName.trim() });
                  setNewClientName('');
                  setAddClientOpen(false);
                })
              }
            >
              <Plus className="w-3.5 h-3.5" />
              Add Customer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add project modal */}
      <Dialog open={addProjectOpen} onOpenChange={(open) => !open && setAddProjectOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Project</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="text-[12px] text-surface-600 block mb-1">Customer</label>
              <select
                value={newProjectClient}
                onChange={(e) => setNewProjectClient(e.target.value)}
                className="w-full h-9 rounded-lg text-sm bg-surface-100 border border-border px-3"
              >
                <option value="">Select…</option>
                {store.clients
                  .filter((c) => !c.archived)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="text-[12px] text-surface-600 block mb-1">Project name</label>
              <Input
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="Project name"
                className="h-9 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="text-[12px] text-surface-600 block mb-1">Hourly rate ($/h)</label>
              <Input
                type="number"
                value={newProjectRate}
                onChange={(e) => setNewProjectRate(e.target.value)}
                placeholder="0"
                className="h-9 rounded-lg text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAddProjectOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!newProjectName.trim() || !newProjectClient}
              onClick={() =>
                void call(async () => {
                  await tsJson('/projects', 'POST', {
                    name: newProjectName.trim(),
                    clientId: newProjectClient,
                    hourlyRate: newProjectRate === '' ? 0 : Number(newProjectRate),
                  });
                  setNewProjectName('');
                  setNewProjectRate('');
                  setAddProjectOpen(false);
                })
              }
            >
              <Plus className="w-3.5 h-3.5" />
              Add Project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
