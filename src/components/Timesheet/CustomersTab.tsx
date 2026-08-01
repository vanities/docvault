// Customers & Projects tab — static tables (color dot + text, no inline
// inputs). All changes go through modals: Edit in the row's ellipsis menu
// opens a modal with every field (name, currency/rate, color), and the Add
// buttons open the same modal empty. Archive/delete confirm first.
// Colors flow to entry rows, invoice rows, and every chart.

import { useState, useMemo } from 'react';
import {
  Plus,
  Trash2,
  Archive,
  ArchiveRestore,
  MoreHorizontal,
  Pencil,
  Loader2,
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
  formatHours,
  formatUsd,
  buildClientColorMap,
  projectDisplayColor,
  CLIENT_PALETTE,
  type TimesheetClient,
  type TimesheetProject,
  type TimesheetStore,
} from './types';

// ---------------------------------------------------------------------------
// Color field — palette swatches + custom picker + "default" (clear)
// ---------------------------------------------------------------------------

function ColorField({
  value, // '' = default (inherit / palette slot)
  fallback, // what "default" currently resolves to, for the preview swatch
  onChange,
}: {
  value: string;
  fallback: string;
  onChange: (hex: string) => void;
}) {
  return (
    <div>
      <label className="text-[12px] text-surface-600 block mb-1">Color</label>
      <div className="flex items-center gap-1.5 flex-wrap">
        {/* default = clear the override */}
        <button
          type="button"
          title="Default"
          onClick={() => onChange('')}
          className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-[9px] text-surface-600 ${
            value === '' ? 'border-surface-950' : 'border-border/60'
          }`}
          style={{ backgroundColor: value === '' ? fallback : 'transparent' }}
        >
          {value === '' ? '' : 'A'}
        </button>
        {CLIENT_PALETTE.map((hex) => (
          <button
            key={hex}
            type="button"
            title={hex}
            onClick={() => onChange(hex)}
            className={`w-6 h-6 rounded-full border-2 ${
              value.toLowerCase() === hex.toLowerCase()
                ? 'border-surface-950'
                : 'border-transparent'
            }`}
            style={{ backgroundColor: hex }}
          />
        ))}
        {/* custom */}
        <label
          className={`w-6 h-6 rounded-full border-2 cursor-pointer overflow-hidden ${
            value && !CLIENT_PALETTE.some((h) => h.toLowerCase() === value.toLowerCase())
              ? 'border-surface-950'
              : 'border-border/60'
          }`}
          title="Custom color"
          style={{
            background:
              value && !CLIENT_PALETTE.some((h) => h.toLowerCase() === value.toLowerCase())
                ? value
                : 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)',
          }}
        >
          <input
            type="color"
            value={value || fallback}
            onChange={(e) => onChange(e.target.value)}
            className="sr-only"
            aria-label="Custom color"
          />
        </label>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab
// ---------------------------------------------------------------------------

type ClientForm = {
  name: string;
  currency: string;
  color: string;
  defaultTemplateId: string; // '' = first active template
};
type ProjectForm = {
  name: string;
  clientId: string;
  hourlyRate: string;
  color: string;
  minimumInvoice: string; // '' = none (retainer floor for this engagement)
};

const EMPTY_CLIENT: ClientForm = {
  name: '',
  currency: 'USD',
  color: '',
  defaultTemplateId: '',
};
const EMPTY_PROJECT: ProjectForm = {
  name: '',
  clientId: '',
  hourlyRate: '',
  color: '',
  minimumInvoice: '',
};

export function CustomersTab({
  store,
  refresh,
}: {
  store: TimesheetStore;
  refresh: () => Promise<void>;
}) {
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // null = closed, 'new' = adding, otherwise the id being edited
  const [clientModal, setClientModal] = useState<string | null>(null);
  const [projectModal, setProjectModal] = useState<string | null>(null);
  const [clientForm, setClientForm] = useState<ClientForm>(EMPTY_CLIENT);
  const [projectForm, setProjectForm] = useState<ProjectForm>(EMPTY_PROJECT);

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
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
      return false;
    }
  };

  // ----- modal open/save -----

  const openClientModal = (client?: TimesheetClient) => {
    setError('');
    if (client) {
      setClientForm({
        name: client.name,
        currency: client.currency,
        color: client.color ?? '',
        defaultTemplateId: client.defaultTemplateId ?? '',
      });
      setClientModal(client.id);
    } else {
      setClientForm(EMPTY_CLIENT);
      setClientModal('new');
    }
  };

  const openProjectModal = (project?: TimesheetProject) => {
    setError('');
    if (project) {
      setProjectForm({
        name: project.name,
        clientId: project.clientId,
        hourlyRate: String(project.hourlyRate),
        color: project.color ?? '',
        minimumInvoice: project.minimumInvoice ? String(project.minimumInvoice) : '',
      });
      setProjectModal(project.id);
    } else {
      setProjectForm(EMPTY_PROJECT);
      setProjectModal('new');
    }
  };

  const saveClient = async () => {
    if (!clientForm.name.trim()) return;
    setSaving(true);
    const body = {
      name: clientForm.name.trim(),
      currency: clientForm.currency.trim().toUpperCase() || 'USD',
      color: clientForm.color,
      defaultTemplateId: clientForm.defaultTemplateId,
    };
    const ok = await call(async () => {
      if (clientModal === 'new') {
        const created = await tsJson<{ client: TimesheetClient }>('/clients', 'POST', {
          name: body.name,
          currency: body.currency,
        });
        // detail fields ride a follow-up PUT: the creation route stays minimal
        await tsJson(`/clients/${created.client.id}`, 'PUT', body);
      } else {
        await tsJson(`/clients/${clientModal}`, 'PUT', body);
      }
    });
    setSaving(false);
    if (ok) setClientModal(null);
  };

  const saveProject = async () => {
    if (!projectForm.name.trim() || !projectForm.clientId) return;
    setSaving(true);
    const body = {
      name: projectForm.name.trim(),
      clientId: projectForm.clientId,
      hourlyRate: projectForm.hourlyRate === '' ? 0 : Number(projectForm.hourlyRate),
      color: projectForm.color,
      minimumInvoice: projectForm.minimumInvoice === '' ? null : Number(projectForm.minimumInvoice),
    };
    const ok = await call(async () => {
      if (projectModal === 'new') {
        const created = await tsJson<{ project: TimesheetProject }>('/projects', 'POST', {
          name: body.name,
          clientId: body.clientId,
          hourlyRate: body.hourlyRate,
        });
        // detail fields ride a follow-up PUT: the creation route stays minimal
        await tsJson(`/projects/${created.project.id}`, 'PUT', body);
      } else {
        await tsJson(`/projects/${projectModal}`, 'PUT', body);
      }
    });
    setSaving(false);
    if (ok) setProjectModal(null);
  };

  // ----- archive / delete -----

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
    item: { id: string; name: string; archived: boolean },
    onEdit: () => void
  ) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={`${item.name} actions`}>
          <MoreHorizontal className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onEdit}>
          <Pencil className="w-3.5 h-3.5" />
          Edit
        </DropdownMenuItem>
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

  const editingClientFallback =
    clientModal && clientModal !== 'new'
      ? (clientColors.get(clientModal) ?? CLIENT_PALETTE[0])
      : CLIENT_PALETTE[store.clients.length % CLIENT_PALETTE.length];

  const editingProjectFallback = projectForm.clientId
    ? (clientColors.get(projectForm.clientId) ?? CLIENT_PALETTE[0])
    : CLIENT_PALETTE[0];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <ConfirmDialog />
      {error && !clientModal && !projectModal && (
        <p className="lg:col-span-2 text-[12px] text-danger-400">{error}</p>
      )}

      {/* Customers */}
      <Card variant="glass" className="p-5 overflow-x-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[14px] font-semibold text-surface-950">Customers</h3>
          <Button size="sm" variant="outline" onClick={() => openClientModal()}>
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
                  <td className="py-2.5 pr-2">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle"
                      style={{ backgroundColor: clientColors.get(c.id) ?? '#5b6070' }}
                    />
                    <span className="text-surface-900 font-medium">{c.name}</span>
                    {c.currency !== 'USD' && (
                      <span className="text-[11px] text-surface-500 ml-1.5">{c.currency}</span>
                    )}
                    {c.archived && (
                      <span className="text-[11px] text-surface-500 ml-1.5">archived</span>
                    )}
                  </td>
                  <td className="py-2.5 text-right text-[12px] text-surface-600 tabular-nums whitespace-nowrap">
                    {totals ? (
                      <>
                        {formatHours(totals.minutes)} · <Money>{formatUsd(totals.amount)}</Money>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="py-2.5 pl-2 text-right whitespace-nowrap">
                    {rowMenu('clients', c, () => openClientModal(c))}
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
          <Button size="sm" variant="outline" onClick={() => openProjectModal()}>
            <Plus className="w-3.5 h-3.5" />
            Add
          </Button>
        </div>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-surface-500 border-b border-border">
              <th className="py-2 font-semibold">Project</th>
              <th className="py-2 font-semibold">Customer</th>
              <th className="py-2 font-semibold text-right">Rate</th>
              <th className="py-2 font-semibold text-right hidden xl:table-cell">Entries</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {store.projects.map((p) => {
              const totals = projectTotals.get(p.id);
              return (
                <tr key={p.id} className={p.archived ? 'opacity-50' : ''}>
                  <td className="py-2.5 pr-2 whitespace-nowrap">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle"
                      style={{ backgroundColor: projectDisplayColor(p, clientColors) }}
                    />
                    <span className="text-surface-900 font-medium">{p.name}</span>
                    {p.archived && (
                      <span className="text-[11px] text-surface-500 ml-1.5">archived</span>
                    )}
                  </td>
                  <td className="py-2.5 text-[12px] text-surface-600 whitespace-nowrap">
                    {store.clients.find((c) => c.id === p.clientId)?.name}
                  </td>
                  <td className="py-2.5 pl-2 text-right text-surface-700 tabular-nums whitespace-nowrap">
                    <Money>{formatUsd(p.hourlyRate)}</Money>
                    <span className="text-[11px] text-surface-500">/h</span>
                  </td>
                  <td className="py-2.5 text-right text-[12px] text-surface-600 tabular-nums whitespace-nowrap hidden xl:table-cell">
                    {totals ? `${totals.entries} · ${formatHours(totals.minutes)}` : '—'}
                  </td>
                  <td className="py-2.5 pl-2 text-right whitespace-nowrap">
                    {rowMenu('projects', p, () => openProjectModal(p))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {/* Customer add/edit modal */}
      <Dialog open={clientModal !== null} onOpenChange={(open) => !open && setClientModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{clientModal === 'new' ? 'Add Customer' : 'Edit Customer'}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="text-[12px] text-surface-600 block mb-1">Name</label>
                <Input
                  value={clientForm.name}
                  onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })}
                  placeholder="Customer name"
                  className="h-9 rounded-lg text-sm"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-[12px] text-surface-600 block mb-1">Currency</label>
                <Input
                  value={clientForm.currency}
                  onChange={(e) => setClientForm({ ...clientForm, currency: e.target.value })}
                  placeholder="USD"
                  className="h-9 rounded-lg text-sm"
                />
              </div>
            </div>
            <div>
              <label className="text-[12px] text-surface-600 block mb-1">Default template</label>
              <select
                value={clientForm.defaultTemplateId}
                onChange={(e) =>
                  setClientForm({ ...clientForm, defaultTemplateId: e.target.value })
                }
                className="w-full h-9 rounded-lg text-sm bg-surface-100 border border-border px-3"
              >
                <option value="">First active</option>
                {store.templates
                  .filter((t) => !t.archived)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </div>
            <ColorField
              value={clientForm.color}
              fallback={editingClientFallback}
              onChange={(hex) => setClientForm({ ...clientForm, color: hex })}
            />
            {error && <p className="text-[12px] text-danger-400">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setClientModal(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={saving || !clientForm.name.trim()}
              onClick={() => void saveClient()}
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : clientModal === 'new' ? (
                'Add Customer'
              ) : (
                'Save'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Project add/edit modal */}
      <Dialog open={projectModal !== null} onOpenChange={(open) => !open && setProjectModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{projectModal === 'new' ? 'Add Project' : 'Edit Project'}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="text-[12px] text-surface-600 block mb-1">Customer</label>
              <select
                value={projectForm.clientId}
                onChange={(e) => setProjectForm({ ...projectForm, clientId: e.target.value })}
                className="w-full h-9 rounded-lg text-sm bg-surface-100 border border-border px-3"
              >
                <option value="">Select…</option>
                {store.clients
                  .filter((c) => !c.archived || c.id === projectForm.clientId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="text-[12px] text-surface-600 block mb-1">Project name</label>
                <Input
                  value={projectForm.name}
                  onChange={(e) => setProjectForm({ ...projectForm, name: e.target.value })}
                  placeholder="Project name"
                  className="h-9 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="text-[12px] text-surface-600 block mb-1">Rate ($/h)</label>
                <Input
                  type="number"
                  value={projectForm.hourlyRate}
                  onChange={(e) => setProjectForm({ ...projectForm, hourlyRate: e.target.value })}
                  placeholder="0"
                  className="h-9 rounded-lg text-sm"
                />
              </div>
            </div>
            <div>
              <label className="text-[12px] text-surface-600 block mb-1">Invoice minimum ($)</label>
              <Input
                type="number"
                value={projectForm.minimumInvoice}
                onChange={(e) => setProjectForm({ ...projectForm, minimumInvoice: e.target.value })}
                placeholder="none"
                className="h-9 rounded-lg text-sm"
              />
              <p className="text-[11px] text-surface-500 mt-1">
                Retainer floor — invoices billing this project under it get a labeled top-up line.
              </p>
            </div>
            <ColorField
              value={projectForm.color}
              fallback={editingProjectFallback}
              onChange={(hex) => setProjectForm({ ...projectForm, color: hex })}
            />
            <p className="text-[11px] text-surface-500 -mt-2">
              Default inherits the customer&apos;s color.
            </p>
            {error && <p className="text-[12px] text-danger-400">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setProjectModal(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={saving || !projectForm.name.trim() || !projectForm.clientId}
              onClick={() => void saveProject()}
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : projectModal === 'new' ? (
                'Add Project'
              ) : (
                'Save'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
