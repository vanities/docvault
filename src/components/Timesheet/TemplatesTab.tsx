// Templates tab — reusable invoice layouts: sender identity (company,
// address, contact), payment terms + details, due days, VAT. The PDF renderer
// is row-work style (one row per time entry); templates supply everything
// around the rows so nothing is retyped per invoice.

import { useState } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { tsJson, type InvoiceTemplate, type TimesheetStore } from './types';

const EMPTY_FORM = {
  name: '',
  title: 'Invoice',
  company: '',
  address: '',
  contact: '',
  paymentTerms: '',
  paymentDetails: '',
  dueDays: '14',
  vat: '0',
};

type FormState = typeof EMPTY_FORM;

function toForm(t: InvoiceTemplate): FormState {
  return {
    name: t.name,
    title: t.title,
    company: t.company,
    address: t.address.join('\n'),
    contact: t.contact.join('\n'),
    paymentTerms: t.paymentTerms,
    paymentDetails: t.paymentDetails.join('\n'),
    dueDays: String(t.dueDays),
    vat: String(t.vat),
  };
}

function toBody(f: FormState) {
  const lines = (s: string) =>
    s
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  return {
    name: f.name.trim(),
    title: f.title.trim() || 'Invoice',
    company: f.company.trim(),
    address: lines(f.address),
    contact: lines(f.contact),
    paymentTerms: f.paymentTerms.trim(),
    paymentDetails: lines(f.paymentDetails),
    dueDays: Number(f.dueDays) || 14,
    vat: Number(f.vat) || 0,
  };
}

export function TemplatesTab({
  store,
  refresh,
}: {
  store: TimesheetStore;
  refresh: () => Promise<void>;
}) {
  const { confirm, ConfirmDialog } = useConfirmDialog();
  // editingId: null = closed, 'new' = creating, otherwise the template id
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const startNew = () => {
    setForm(EMPTY_FORM);
    setEditingId('new');
  };

  const startEdit = (t: InvoiceTemplate) => {
    setForm(toForm(t));
    setEditingId(t.id);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    setError('');
    try {
      if (editingId === 'new') await tsJson('/templates', 'POST', toBody(form));
      else await tsJson(`/templates/${editingId}`, 'PUT', toBody(form));
      setEditingId(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (t: InvoiceTemplate) => {
    const ok = await confirm({
      title: `Delete template "${t.name}"?`,
      description: 'Templates referenced by invoices can only be archived.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    setError('');
    try {
      await tsJson(`/templates/${t.id}`, 'DELETE');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const field = (key: keyof FormState, label: string, props: Record<string, unknown> = {}) => (
    <div>
      <label className="text-[12px] text-surface-600 block mb-1">{label}</label>
      <Input
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className="h-9 rounded-lg text-sm"
        {...props}
      />
    </div>
  );

  const area = (key: keyof FormState, label: string, placeholder: string) => (
    <div>
      <label className="text-[12px] text-surface-600 block mb-1">{label}</label>
      <textarea
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        placeholder={placeholder}
        rows={3}
        className="w-full rounded-lg text-sm bg-surface-100 border border-border px-3 py-2"
      />
    </div>
  );

  return (
    <div>
      <ConfirmDialog />

      <div className="flex items-center justify-between mb-4">
        <p className="text-[13px] text-surface-600">
          Templates carry the sender block, payment terms, and tax settings for generated PDFs.
        </p>
        <Button size="sm" onClick={startNew}>
          <Plus className="w-4 h-4" />
          New Template
        </Button>
      </div>

      {error && <p className="text-[12px] text-danger-400 mb-3">{error}</p>}

      {/* Editor */}
      {editingId !== null && (
        <Card variant="glass" className="p-5 mb-6">
          <h3 className="text-[14px] font-semibold text-surface-950 mb-4">
            {editingId === 'new' ? 'New Template' : 'Edit Template'}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            {field('name', 'Name', { placeholder: 'e.g. Row Work' })}
            {field('title', 'PDF title')}
            {field('company', 'Company', { placeholder: 'Sender company name' })}
            <div className="grid grid-cols-2 gap-3">
              {field('dueDays', 'Due days', { type: 'number' })}
              {field('vat', 'VAT %', { type: 'number' })}
            </div>
            {area('address', 'Address (one line each)', 'Street\nCity, State ZIP')}
            {area('contact', 'Contact (one line each)', 'Name\nemail@example.com')}
            {field('paymentTerms', 'Payment terms', { placeholder: 'e.g. Net 14' })}
            {area('paymentDetails', 'Payment details (one line each)', 'Bank routing / account')}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditingId(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={saving || !form.name.trim()}
              onClick={() => void handleSave()}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Template'}
            </Button>
          </div>
        </Card>
      )}

      {/* List */}
      <Card variant="glass" className="divide-y divide-border/50">
        {store.templates.length === 0 ? (
          <div className="p-8 text-center text-[13px] text-surface-500">
            No templates yet — create one to carry your sender details onto invoices.
          </div>
        ) : (
          store.templates.map((t) => (
            <div
              key={t.id}
              className={`flex items-center gap-3 px-4 py-3 text-[13px] ${t.archived ? 'opacity-50' : ''}`}
            >
              <div className="flex-1 min-w-0">
                <span className="font-medium text-surface-900">{t.name}</span>
                <span className="text-surface-500 text-[12px]">
                  {' · '}
                  {t.company || 'no company'} · due {t.dueDays}d
                  {t.vat > 0 ? ` · VAT ${t.vat}%` : ''}
                </span>
              </div>
              <button
                className="text-[11px] text-surface-600 hover:text-surface-900"
                onClick={() => startEdit(t)}
              >
                edit
              </button>
              <button
                className="text-[11px] text-surface-500 hover:text-surface-800"
                onClick={() =>
                  void tsJson(`/templates/${t.id}`, 'PUT', { archived: !t.archived }).then(refresh)
                }
              >
                {t.archived ? 'unarchive' : 'archive'}
              </button>
              <button
                className="text-[11px] text-danger-400 hover:underline"
                onClick={() => void handleDelete(t)}
              >
                delete
              </button>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
