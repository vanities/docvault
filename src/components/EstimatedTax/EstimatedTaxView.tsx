import { useState, useEffect, useRef } from 'react';
import { Receipt, Plus, Trash2, Info } from 'lucide-react';
import { useAppContext } from '../../contexts/AppContext';
import { useToast } from '../../hooks/useToast';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface EstimatedTaxPayment {
  id: string;
  date: string;
  quarter: 1 | 2 | 3 | 4;
  amount: number;
}

interface EstimatedTaxConfig {
  annualTarget: number;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function parseCurrencyInput(raw: string): number {
  return parseFloat(raw.replace(/[^0-9.]/g, '')) || 0;
}

const QUARTER_DUE_DATES: Record<number, { month: number; day: number; label: string }> = {
  1: { month: 4, day: 15, label: 'Q1 — Apr 15' },
  2: { month: 6, day: 15, label: 'Q2 — Jun 15' },
  3: { month: 9, day: 15, label: 'Q3 — Sep 15' },
  4: { month: 1, day: 15, label: 'Q4 — Jan 15 (next year)' },
};

function getDueDate(quarter: number, taxYear: number): string {
  const dd = QUARTER_DUE_DATES[quarter];
  const y = quarter === 4 ? taxYear + 1 : taxYear;
  return `${y}-${String(dd.month).padStart(2, '0')}-${String(dd.day).padStart(2, '0')}`;
}

function getQuarterStatus(
  quarter: number,
  taxYear: number,
  paid: number,
  due: number
): { status: 'paid' | 'partial' | 'upcoming' | 'overdue'; label: string } {
  const dueDate = getDueDate(quarter, taxYear);
  const today = new Date().toISOString().split('T')[0];
  const isPast = today > dueDate;

  if (paid >= due && due > 0) return { status: 'paid', label: 'Paid' };
  if (paid > 0 && paid < due)
    return { status: 'partial', label: `${formatCurrency(due - paid)} remaining` };
  if (isPast && due > 0) return { status: 'overdue', label: 'Overdue' };
  return { status: 'upcoming', label: `Due ${dueDate}` };
}

const STATUS_COLORS = {
  paid: 'text-emerald-400 bg-emerald-500/10',
  partial: 'text-amber-400 bg-amber-500/10',
  overdue: 'text-red-400 bg-red-500/10',
  upcoming: 'text-surface-500 bg-surface-200/50',
};

export function EstimatedTaxView() {
  const { selectedEntity, selectedYear, reminders, updateReminder } = useAppContext();
  const { addToast } = useToast();

  const [payments, setPayments] = useState<EstimatedTaxPayment[]>([]);
  const [config, setConfig] = useState<EstimatedTaxConfig>({ annualTarget: 0 });
  const loadedRef = useRef(false);

  // Form state
  const [addDate, setAddDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [addAmount, setAddAmount] = useState('');
  const [addQuarter, setAddQuarter] = useState<1 | 2 | 3 | 4>(() => {
    const m = new Date().getMonth() + 1;
    if (m <= 4) return 1;
    if (m <= 6) return 2;
    if (m <= 9) return 3;
    return 4;
  });

  // Annual target input
  const [targetInput, setTargetInput] = useState('');

  // Load data
  useEffect(() => {
    loadedRef.current = false;
    fetch(`/api/estimated-taxes/${selectedEntity}/${selectedYear}`)
      .then((r) => r.json())
      .then((data) => {
        setPayments(data.payments || []);
        setConfig(data.config || { annualTarget: 0 });
        setTargetInput(String(data.config?.annualTarget || 0));
        loadedRef.current = true;
      })
      .catch(() => {
        loadedRef.current = true;
      });
  }, [selectedEntity, selectedYear]);

  // Save data when payments or config change
  useEffect(() => {
    if (!loadedRef.current) return;
    fetch(`/api/estimated-taxes/${selectedEntity}/${selectedYear}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payments, config }),
    }).catch(() => {});
  }, [payments, config, selectedEntity, selectedYear]);

  const quarterlyTarget = config.annualTarget / 4;

  const paymentsByQuarter = (q: number) => payments.filter((p) => p.quarter === q);

  const quarterPaid = (q: number) => paymentsByQuarter(q).reduce((sum, p) => sum + p.amount, 0);

  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
  const totalRemaining = Math.max(0, config.annualTarget - totalPaid);
  const overallPct = config.annualTarget > 0 ? (totalPaid / config.annualTarget) * 100 : 0;

  function addPayment() {
    const amount = parseCurrencyInput(addAmount);
    if (!amount || !addDate) return;
    const newPayment: EstimatedTaxPayment = {
      id: generateId(),
      date: addDate,
      quarter: addQuarter,
      amount,
    };
    setPayments((prev) => [...prev, newPayment].sort((a, b) => a.date.localeCompare(b.date)));
    setAddAmount('');
    addToast('Payment recorded', 'success');
  }

  function removePayment(id: string) {
    setPayments((prev) => prev.filter((p) => p.id !== id));
  }

  function handleTargetBlur() {
    const val = parseCurrencyInput(targetInput);
    setTargetInput(String(val));
    setConfig((prev) => ({ ...prev, annualTarget: val }));

    // Sync reminder notes for estimated tax reminders tied to this entity/year
    if (val > 0) {
      const quarterly = val / 4;
      const newNotes = `${formatCurrency(quarterly)} due · 110% safe harbor (${selectedEntity}/${selectedYear})`;
      reminders
        .filter(
          (r) =>
            r.entityId === selectedEntity &&
            r.title.includes('Estimated Tax Payment') &&
            r.notes?.includes(`(${selectedEntity}/${selectedYear})`)
        )
        .forEach((r) => {
          void updateReminder(r.id, { notes: newNotes });
        });
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-red-500/10 rounded-xl">
          <Receipt className="w-6 h-6 text-red-400" />
        </div>
        <div>
          <h1 className="font-display text-xl text-surface-950">Estimated Tax Payments</h1>
          <p className="text-[12px] text-surface-600">
            {selectedYear} · 1040-ES quarterly payments
          </p>
        </div>
      </div>

      {/* Annual Target */}
      <Card variant="glass" className="p-5">
        <div className="flex items-end gap-4">
          <div className="flex-1">
            <label className="block text-[11px] font-medium text-surface-600 uppercase tracking-wider mb-1.5">
              Annual Target (Safe Harbor)
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500 text-sm">
                $
              </span>
              <Input
                type="text"
                inputMode="numeric"
                value={targetInput}
                onChange={(e) => setTargetInput(e.target.value)}
                onBlur={handleTargetBlur}
                className="pl-7 h-9 rounded-lg text-sm font-mono bg-surface-200/50"
                placeholder="e.g. 39000"
              />
            </div>
            <p className="text-[10px] text-surface-500 mt-1 flex items-center gap-1">
              <Info className="w-3 h-3" />
              110% of prior year tax liability for safe harbor
            </p>
          </div>
          <div className="text-right pb-5">
            <p className="text-[11px] text-surface-500">Per Quarter</p>
            <p className="text-lg font-bold font-mono text-surface-950">
              {formatCurrency(quarterlyTarget)}
            </p>
          </div>
        </div>
      </Card>

      {/* Overall Progress */}
      <Card variant="glass" className="p-5">
        <div className="flex justify-between text-[12px] text-surface-600 mb-2">
          <span>
            <span className="font-semibold text-surface-900">{formatCurrency(totalPaid)}</span> paid
          </span>
          <span>
            <span className="font-semibold text-surface-900">{formatCurrency(totalRemaining)}</span>{' '}
            remaining of {formatCurrency(config.annualTarget)}
          </span>
        </div>
        <div className="h-3 bg-surface-300/50 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              overallPct >= 100 ? 'bg-emerald-400' : overallPct >= 75 ? 'bg-blue-400' : 'bg-red-400'
            }`}
            style={{ width: `${Math.min(100, overallPct).toFixed(1)}%` }}
          />
        </div>
      </Card>

      {/* Quarterly Breakdown */}
      <div className="space-y-3">
        {([1, 2, 3, 4] as const).map((q) => {
          const paid = quarterPaid(q);
          const qPayments = paymentsByQuarter(q);
          const { status, label } = getQuarterStatus(q, selectedYear, paid, quarterlyTarget);
          const pct = quarterlyTarget > 0 ? (paid / quarterlyTarget) * 100 : 0;

          return (
            <Card variant="glass" key={q} className="overflow-hidden">
              <div className="px-5 py-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2.5">
                    <span className="text-[13px] font-semibold text-surface-900">
                      {QUARTER_DUE_DATES[q].label}
                    </span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[status]}`}
                    >
                      {label}
                    </span>
                  </div>
                  <span className="text-[13px] font-mono font-bold text-surface-900">
                    {formatCurrency(paid)}
                    <span className="text-surface-500 font-normal">
                      {' '}
                      / {formatCurrency(quarterlyTarget)}
                    </span>
                  </span>
                </div>

                {/* Quarter progress bar */}
                <div className="h-1.5 bg-surface-300/50 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      pct >= 100 ? 'bg-emerald-400' : pct > 0 ? 'bg-amber-400' : 'bg-surface-300'
                    }`}
                    style={{ width: `${Math.min(100, pct).toFixed(1)}%` }}
                  />
                </div>

                {/* Payment list */}
                {qPayments.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {qPayments.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between py-1 px-2 rounded-lg hover:bg-surface-300/20 group"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-[11px] text-surface-500 font-mono">{p.date}</span>
                          <span className="text-[13px] font-mono text-surface-900">
                            {formatCurrency(p.amount)}
                          </span>
                        </div>
                        <Button
                          type="button"
                          variant="ghost-danger"
                          size="icon-xs"
                          onClick={() => removePayment(p.id)}
                          className="opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {/* Add Payment Form */}
      <Card variant="glass" className="p-5">
        <p className="text-[10px] font-semibold text-surface-500 uppercase tracking-wider mb-3">
          Record Payment
        </p>
        <div className="flex gap-2 items-end">
          <div className="flex-shrink-0">
            <label className="block text-[10px] text-surface-500 mb-1">Date</label>
            <Input
              type="date"
              value={addDate}
              onChange={(e) => setAddDate(e.target.value)}
              className="px-2 py-1.5 h-auto text-[12px] font-mono bg-surface-200/50 rounded-lg"
            />
          </div>
          <div className="flex-shrink-0">
            <label className="block text-[10px] text-surface-500 mb-1">Quarter</label>
            <Select
              value={String(addQuarter)}
              onValueChange={(val) => setAddQuarter(parseInt(val) as 1 | 2 | 3 | 4)}
            >
              <SelectTrigger className="text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Q1</SelectItem>
                <SelectItem value="2">Q2</SelectItem>
                <SelectItem value="3">Q3</SelectItem>
                <SelectItem value="4">Q4</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1">
            <label className="block text-[10px] text-surface-500 mb-1">Amount</label>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-500 text-sm">
                $
              </span>
              <Input
                type="text"
                inputMode="numeric"
                value={addAmount}
                onChange={(e) => setAddAmount(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addPayment();
                }}
                placeholder="0"
                className="w-full pl-6 pr-2 py-1.5 h-auto text-[12px] font-mono bg-surface-200/50 rounded-lg"
              />
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={addPayment}
            disabled={!addAmount || !addDate}
            className="flex-shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            Add
          </Button>
        </div>
      </Card>
    </div>
  );
}
