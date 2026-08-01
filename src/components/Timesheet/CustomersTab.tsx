// Customers & Projects tab — proper management tables (Kimai's admin pages
// collapsed into one). Rates live on projects; changing a rate only affects
// future entries (existing entries keep their snapshot).

import { useState, useMemo } from 'react';
import { Plus } from 'lucide-react';
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
import { Money } from '../common/Money';
import { tsJson, formatHours, formatUsd, type TimesheetStore } from './types';

export function CustomersTab({
  store,
  refresh,
}: {
  store: TimesheetStore;
  refresh: () => Promise<void>;
}) {
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

  // Per-client and per-project lifetime totals give the tables some context.
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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
              <th className="py-2 font-semibold">Name</th>
              <th className="py-2 font-semibold text-right">Lifetime</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {store.clients.map((c) => {
              const totals = clientTotals.get(c.id);
              return (
                <tr key={c.id} className={c.archived ? 'opacity-50' : ''}>
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
                    <button
                      className="text-[11px] text-surface-500 hover:text-surface-800"
                      onClick={() =>
                        void call(() =>
                          tsJson(`/clients/${c.id}`, 'PUT', { archived: !c.archived })
                        )
                      }
                    >
                      {c.archived ? 'unarchive' : 'archive'}
                    </button>
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
              <th className="py-2 font-semibold">Project</th>
              <th className="py-2 font-semibold">Customer</th>
              <th className="py-2 font-semibold text-right">Rate $/h</th>
              <th className="py-2 font-semibold text-right">Entries</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {store.projects.map((p) => {
              const totals = projectTotals.get(p.id);
              return (
                <tr key={p.id} className={p.archived ? 'opacity-50' : ''}>
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
                  <td className="py-1.5 text-right text-[12px] text-surface-600 tabular-nums whitespace-nowrap">
                    {totals ? `${totals.entries} · ${formatHours(totals.minutes)}` : '—'}
                  </td>
                  <td className="py-1.5 pl-2 text-right whitespace-nowrap">
                    <button
                      className="text-[11px] text-surface-500 hover:text-surface-800"
                      onClick={() =>
                        void call(() =>
                          tsJson(`/projects/${p.id}`, 'PUT', { archived: !p.archived })
                        )
                      }
                    >
                      {p.archived ? 'unarchive' : 'archive'}
                    </button>
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
