import { useState, useEffect, useCallback } from 'react';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { Plus, Trash2, Edit3, Loader2, DollarSign, X, Check } from 'lucide-react';
import { API_BASE } from '../../constants';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Money } from '../common/Money';

interface IncomeSource {
  id: string;
  name: string;
  amount: number;
  frequency: 'monthly' | 'biweekly' | 'weekly' | 'quarterly' | 'annually';
  taxable: boolean;
  entity?: string;
  notes?: string;
  createdAt: string;
}

const FREQUENCY_OPTIONS = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Bi-weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annually', label: 'Annually' },
] as const;

function formatUsd(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  });
}

function toMonthly(amount: number, frequency: string): number {
  switch (frequency) {
    case 'weekly':
      return (amount * 52) / 12;
    case 'biweekly':
      return (amount * 26) / 12;
    case 'monthly':
      return amount;
    case 'quarterly':
      return amount / 3;
    case 'annually':
      return amount / 12;
    default:
      return amount;
  }
}

export function IncomeView() {
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const [sources, setSources] = useState<IncomeSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState<string>('monthly');
  const [taxable, setTaxable] = useState(true);
  const [entity, setEntity] = useState('');
  const [notes, setNotes] = useState('');

  const resetForm = () => {
    setName('');
    setAmount('');
    setFrequency('monthly');
    setTaxable(true);
    setEntity('');
    setNotes('');
    setEditingId(null);
  };

  const fetchSources = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/income`);
      const data = await res.json();
      setSources(data.sources || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSources();
  }, [fetchSources]);

  const handleSubmit = async () => {
    if (!name.trim() || !amount) return;
    setSubmitting(true);
    try {
      const body = {
        name: name.trim(),
        amount: parseFloat(amount),
        frequency,
        taxable,
        entity: entity.trim() || undefined,
        notes: notes.trim() || undefined,
      };

      if (editingId) {
        const res = await fetch(`${API_BASE}/income/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        setSources((prev) => prev.map((s) => (s.id === editingId ? data.source : s)));
      } else {
        const res = await fetch(`${API_BASE}/income`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        setSources((prev) => [...prev, data.source]);
      }

      resetForm();
      setShowForm(false);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (source: IncomeSource) => {
    setName(source.name);
    setAmount(String(source.amount));
    setFrequency(source.frequency);
    setTaxable(source.taxable);
    setEntity(source.entity || '');
    setNotes(source.notes || '');
    setEditingId(source.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (
      !(await confirm({
        description: 'Delete this income source?',
        confirmLabel: 'Delete',
        destructive: true,
      }))
    )
      return;
    await fetch(`${API_BASE}/income/${id}`, { method: 'DELETE' });
    setSources((prev) => prev.filter((s) => s.id !== id));
  };

  // Calculate totals
  const monthlyTotal = sources.reduce((sum, s) => sum + toMonthly(s.amount, s.frequency), 0);
  const annualTotal = monthlyTotal * 12;
  const taxableMonthly = sources
    .filter((s) => s.taxable)
    .reduce((sum, s) => sum + toMonthly(s.amount, s.frequency), 0);
  const nonTaxableMonthly = monthlyTotal - taxableMonthly;

  if (loading) {
    return (
      <div className="p-6 max-w-3xl mx-auto flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-6 h-6 text-accent-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-display text-2xl text-surface-950 mb-1 italic">Additional Income</h2>
          <p className="text-[13px] text-surface-600">
            Recurring income not captured by tax documents or bank statements
          </p>
        </div>
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
          {showForm && !editingId ? 'Cancel' : 'Add Income'}
        </Button>
      </div>

      {/* Summary cards */}
      {sources.length > 0 && (
        <Card variant="glass" className="p-5 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <p className="text-[11px] text-surface-500 uppercase tracking-wider mb-1">
                Monthly Total
              </p>
              <p className="text-2xl font-mono font-bold tabular-nums text-surface-950">
                <Money>{formatUsd(monthlyTotal)}</Money>
              </p>
            </div>
            <div>
              <p className="text-[11px] text-surface-500 uppercase tracking-wider mb-1">
                Annual Total
              </p>
              <p className="text-lg font-mono font-semibold text-surface-700 tabular-nums">
                <Money>{formatUsd(annualTotal)}</Money>
              </p>
            </div>
            <div>
              <p className="text-[11px] text-surface-500 uppercase tracking-wider mb-1">
                Non-Taxable
              </p>
              <p className="text-lg font-mono font-semibold text-emerald-400 tabular-nums">
                <Money>{formatUsd(nonTaxableMonthly)}</Money>
                <span className="text-[11px] text-surface-500 font-normal">/mo</span>
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Add/Edit Form */}
      {showForm && (
        <Card variant="glass" className="p-5 mb-6">
          <h3 className="text-[14px] font-semibold text-surface-950 mb-4">
            {editingId ? 'Edit Income Source' : 'Add Income Source'}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-[12px] text-surface-600 block mb-1">Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Rental Income"
                className="h-9 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="text-[12px] text-surface-600 block mb-1">Amount ($)</label>
              <Input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="1000"
                className="h-9 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="text-[12px] text-surface-600 block mb-1">Frequency</label>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
                className="w-full h-9 rounded-lg text-sm bg-surface-100 border border-border px-3"
              >
                {FREQUENCY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[12px] text-surface-600 block mb-1">Entity (optional)</label>
              <Input
                value={entity}
                onChange={(e) => setEntity(e.target.value)}
                placeholder="e.g., personal"
                className="h-9 rounded-lg text-sm"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-[12px] text-surface-600 block mb-1">Notes (optional)</label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g., Monthly benefit payment"
                className="h-9 rounded-lg text-sm"
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-[13px] text-surface-700 cursor-pointer">
              <input
                type="checkbox"
                checked={taxable}
                onChange={(e) => setTaxable(e.target.checked)}
                className="rounded"
              />
              Taxable income
            </label>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowForm(false);
                  resetForm();
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSubmit}
                disabled={!name.trim() || !amount || submitting}
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                {editingId ? 'Save' : 'Add'}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Income list */}
      {sources.length === 0 && !showForm ? (
        <Card variant="glass" className="rounded-2xl p-10 text-center">
          <div className="p-4 bg-emerald-500/10 rounded-2xl w-fit mx-auto mb-5">
            <DollarSign className="w-8 h-8 text-emerald-500" />
          </div>
          <h3 className="text-lg font-semibold text-surface-950 mb-2">No Income Sources</h3>
          <p className="text-[13px] text-surface-600 max-w-sm mx-auto">
            Add recurring income that isn&apos;t captured by tax documents or bank statements, like
            Rental income, disability benefits, or other recurring payments.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {sources.map((source) => {
            const monthly = toMonthly(source.amount, source.frequency);
            return (
              <Card key={source.id} variant="glass" className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={`p-2 rounded-lg ${source.taxable ? 'bg-amber-500/10' : 'bg-emerald-500/10'}`}
                    >
                      <DollarSign
                        className={`w-4 h-4 ${source.taxable ? 'text-amber-500' : 'text-emerald-500'}`}
                      />
                    </div>
                    <div>
                      <p className="text-[14px] font-medium text-surface-950">{source.name}</p>
                      <div className="flex items-center gap-2 text-[11px] text-surface-500">
                        <span>
                          {formatUsd(source.amount)}/{source.frequency}
                        </span>
                        {source.frequency !== 'monthly' && (
                          <span className="text-surface-400">({formatUsd(monthly)}/mo)</span>
                        )}
                        <span
                          className={`px-1.5 py-0.5 rounded-md text-[10px] font-medium ${source.taxable ? 'bg-amber-500/10 text-amber-600' : 'bg-emerald-500/10 text-emerald-600'}`}
                        >
                          {source.taxable ? 'Taxable' : 'Non-taxable'}
                        </span>
                        {source.entity && <span className="text-surface-400">{source.entity}</span>}
                      </div>
                      {source.notes && (
                        <p className="text-[11px] text-surface-400 mt-0.5">{source.notes}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <p className="text-[16px] font-mono font-semibold text-surface-950 tabular-nums">
                      <Money>{formatUsd(monthly)}</Money>
                      <span className="text-[11px] text-surface-500 font-normal">/mo</span>
                    </p>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleEdit(source)}
                        title="Edit"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost-danger"
                        size="icon-sm"
                        onClick={() => void handleDelete(source.id)}
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <ConfirmDialog />
    </div>
  );
}
