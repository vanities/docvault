import { useState, useEffect, useCallback, useMemo } from 'react';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import {
  Plus,
  Trash2,
  Edit3,
  Loader2,
  CreditCard,
  X,
  Check,
  Calculator,
  AlertTriangle,
} from 'lucide-react';
import { API_BASE } from '../../constants';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Money } from '../common/Money';

type LiabilityType =
  | 'equipment-loan'
  | 'auto-loan'
  | 'personal-loan'
  | 'student-loan'
  | 'mortgage'
  | 'construction-loan'
  | 'credit-line'
  | 'other';

interface Liability {
  id: string;
  name: string;
  lender?: string;
  type: LiabilityType;
  originalBalance?: number;
  balance: number;
  rate: number;
  monthlyPayment: number;
  termMonths?: number;
  startDate?: string;
  payoffDate?: string;
  entity?: string;
  notes?: string;
  createdAt: string;
}

interface SnapshotPortfolioSummary {
  bankMonthlyDebtService?: number;
  manualLiabilityMonthlyPayment?: number;
  mortgageMonthlyPayment?: number;
  monthlyDebtService?: number;
  qualifyingMonthlyIncome?: number;
  dtiRatio?: number | null;
}

const TYPE_OPTIONS: { value: LiabilityType; label: string }[] = [
  { value: 'equipment-loan', label: 'Equipment Loan' },
  { value: 'auto-loan', label: 'Auto Loan' },
  { value: 'personal-loan', label: 'Personal Loan' },
  { value: 'student-loan', label: 'Student Loan' },
  { value: 'mortgage', label: 'Mortgage' },
  { value: 'construction-loan', label: 'Construction Loan' },
  { value: 'credit-line', label: 'Credit Line' },
  { value: 'other', label: 'Other' },
];

function formatUsd(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  });
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function monthlyPI(principal: number, annualRate: number, termMonths: number): number {
  if (principal <= 0 || termMonths <= 0) return 0;
  const r = annualRate / 12;
  if (r === 0) return principal / termMonths;
  return (principal * r) / (1 - Math.pow(1 + r, -termMonths));
}

export function DebtsView() {
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const [entries, setEntries] = useState<Liability[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [snapshotSummary, setSnapshotSummary] = useState<SnapshotPortfolioSummary | null>(null);

  // DTI calculator inputs
  const [proposedLoan, setProposedLoan] = useState('815000');
  const [proposedRate, setProposedRate] = useState('7.0');
  const [proposedTermYears, setProposedTermYears] = useState('30');
  const [excludeRentalOffset, setExcludeRentalOffset] = useState('0');

  // Form state
  const [name, setName] = useState('');
  const [lender, setLender] = useState('');
  const [type, setType] = useState<LiabilityType>('equipment-loan');
  const [originalBalance, setOriginalBalance] = useState('');
  const [balance, setBalance] = useState('');
  const [rate, setRate] = useState('0');
  const [monthlyPayment, setMonthlyPayment] = useState('');
  const [termMonths, setTermMonths] = useState('');
  const [startDate, setStartDate] = useState('');
  const [payoffDate, setPayoffDate] = useState('');
  const [entity, setEntity] = useState('');
  const [notes, setNotes] = useState('');

  const resetForm = () => {
    setName('');
    setLender('');
    setType('equipment-loan');
    setOriginalBalance('');
    setBalance('');
    setRate('0');
    setMonthlyPayment('');
    setTermMonths('');
    setStartDate('');
    setPayoffDate('');
    setEntity('');
    setNotes('');
    setEditingId(null);
  };

  const fetchEntries = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/liabilities`);
      const data = await res.json();
      setEntries(data.entries || []);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSnapshot = useCallback(async () => {
    try {
      const year = new Date().getFullYear();
      const res = await fetch(`${API_BASE}/financial-snapshot/${year}?format=json`);
      if (!res.ok) return;
      const data = await res.json();
      setSnapshotSummary(data?.portfolioSummary || null);
    } catch {
      /* non-critical */
    }
  }, []);

  useEffect(() => {
    void fetchEntries();
    void fetchSnapshot();
  }, [fetchEntries, fetchSnapshot]);

  const handleSubmit = async () => {
    if (!name.trim() || !balance || !monthlyPayment) return;
    setSubmitting(true);
    try {
      const body = {
        name: name.trim(),
        lender: lender.trim() || undefined,
        type,
        originalBalance: originalBalance ? parseFloat(originalBalance) : undefined,
        balance: parseFloat(balance),
        rate: parseFloat(rate) / 100, // UI percent → decimal
        monthlyPayment: parseFloat(monthlyPayment),
        termMonths: termMonths ? parseInt(termMonths, 10) : undefined,
        startDate: startDate || undefined,
        payoffDate: payoffDate || undefined,
        entity: entity.trim() || undefined,
        notes: notes.trim() || undefined,
      };

      if (editingId) {
        const res = await fetch(`${API_BASE}/liabilities/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        setEntries((prev) => prev.map((e) => (e.id === editingId ? data.entry : e)));
      } else {
        const res = await fetch(`${API_BASE}/liabilities`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        setEntries((prev) => [...prev, data.entry]);
      }

      resetForm();
      setShowForm(false);
      void fetchSnapshot();
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (entry: Liability) => {
    setName(entry.name);
    setLender(entry.lender || '');
    setType(entry.type);
    setOriginalBalance(entry.originalBalance ? String(entry.originalBalance) : '');
    setBalance(String(entry.balance));
    setRate(String(entry.rate * 100));
    setMonthlyPayment(String(entry.monthlyPayment));
    setTermMonths(entry.termMonths ? String(entry.termMonths) : '');
    setStartDate(entry.startDate || '');
    setPayoffDate(entry.payoffDate || '');
    setEntity(entry.entity || '');
    setNotes(entry.notes || '');
    setEditingId(entry.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (
      !(await confirm({
        description: 'Delete this debt entry?',
        confirmLabel: 'Delete',
        destructive: true,
      }))
    )
      return;
    await fetch(`${API_BASE}/liabilities/${id}`, { method: 'DELETE' });
    setEntries((prev) => prev.filter((e) => e.id !== id));
    void fetchSnapshot();
  };

  const totals = useMemo(() => {
    const balance = entries.reduce((s, e) => s + e.balance, 0);
    const monthly = entries.reduce((s, e) => s + e.monthlyPayment, 0);
    return { balance, monthly };
  }, [entries]);

  const dti = useMemo(() => {
    const principal = parseFloat(proposedLoan) || 0;
    const apr = (parseFloat(proposedRate) || 0) / 100;
    const term = (parseInt(proposedTermYears, 10) || 0) * 12;
    const proposedPI = monthlyPI(principal, apr, term);
    const offset = parseFloat(excludeRentalOffset) || 0;

    const existingDebtService = snapshotSummary?.monthlyDebtService ?? 0;
    const income = snapshotSummary?.qualifyingMonthlyIncome ?? 0;

    const preConstructionDTI = income > 0 ? existingDebtService / income : null;
    const postConstructionDebtService = existingDebtService + proposedPI - offset;
    const postConstructionDTI = income > 0 ? postConstructionDebtService / income : null;

    return {
      proposedPI,
      existingDebtService,
      income,
      preConstructionDTI,
      postConstructionDebtService,
      postConstructionDTI,
    };
  }, [proposedLoan, proposedRate, proposedTermYears, excludeRentalOffset, snapshotSummary]);

  if (loading) {
    return (
      <div className="p-6 max-w-3xl mx-auto flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-6 h-6 text-accent-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h2 className="font-display text-2xl text-surface-950 mb-1 italic">Debts</h2>
        <p className="text-[13px] text-surface-600">
          Manual liabilities not tracked by bank sync, plus DTI projection for new loans.
        </p>
      </div>

      <Tabs defaultValue="list" className="gap-6">
        <TabsList>
          <TabsTrigger value="list">
            <CreditCard className="w-3.5 h-3.5" />
            Debts
          </TabsTrigger>
          <TabsTrigger value="dti">
            <Calculator className="w-3.5 h-3.5" />
            DTI Calculator
          </TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-4">
          <div className="flex items-center justify-end">
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
              {showForm && !editingId ? 'Cancel' : 'Add Debt'}
            </Button>
          </div>

          {entries.length > 0 && (
            <Card variant="glass" className="p-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-[11px] text-surface-500 uppercase tracking-wider mb-1">
                    Total Balance
                  </p>
                  <p className="text-2xl font-mono font-bold tabular-nums text-surface-950">
                    <Money>{formatUsd(totals.balance)}</Money>
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-surface-500 uppercase tracking-wider mb-1">
                    Monthly Payments
                  </p>
                  <p className="text-2xl font-mono font-bold tabular-nums text-rose-400">
                    <Money>{formatUsd(totals.monthly)}</Money>
                    <span className="text-[11px] text-surface-500 font-normal">/mo</span>
                  </p>
                </div>
              </div>
            </Card>
          )}

          {showForm && (
            <Card variant="glass" className="p-5">
              <h3 className="text-[14px] font-semibold text-surface-950 mb-4">
                {editingId ? 'Edit Debt' : 'Add Debt'}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="text-[12px] text-surface-600 block mb-1">Name</label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., Tractor loan"
                    className="h-9 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="text-[12px] text-surface-600 block mb-1">Lender</label>
                  <Input
                    value={lender}
                    onChange={(e) => setLender(e.target.value)}
                    placeholder="e.g., Acme Credit Corp"
                    className="h-9 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="text-[12px] text-surface-600 block mb-1">Type</label>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value as LiabilityType)}
                    className="w-full h-9 rounded-lg text-sm bg-surface-100 border border-border px-3"
                  >
                    {TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[12px] text-surface-600 block mb-1">Rate (%)</label>
                  <Input
                    type="number"
                    step="0.01"
                    value={rate}
                    onChange={(e) => setRate(e.target.value)}
                    placeholder="0"
                    className="h-9 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="text-[12px] text-surface-600 block mb-1">
                    Current Balance ($)
                  </label>
                  <Input
                    type="number"
                    value={balance}
                    onChange={(e) => setBalance(e.target.value)}
                    placeholder="50000"
                    className="h-9 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="text-[12px] text-surface-600 block mb-1">
                    Monthly Payment ($)
                  </label>
                  <Input
                    type="number"
                    value={monthlyPayment}
                    onChange={(e) => setMonthlyPayment(e.target.value)}
                    placeholder="1200"
                    className="h-9 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="text-[12px] text-surface-600 block mb-1">
                    Original Balance ($) — optional
                  </label>
                  <Input
                    type="number"
                    value={originalBalance}
                    onChange={(e) => setOriginalBalance(e.target.value)}
                    placeholder="60000"
                    className="h-9 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="text-[12px] text-surface-600 block mb-1">
                    Term (months) — optional
                  </label>
                  <Input
                    type="number"
                    value={termMonths}
                    onChange={(e) => setTermMonths(e.target.value)}
                    placeholder="36"
                    className="h-9 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="text-[12px] text-surface-600 block mb-1">
                    Start Date — optional
                  </label>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="h-9 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="text-[12px] text-surface-600 block mb-1">
                    Payoff Date — optional
                  </label>
                  <Input
                    type="date"
                    value={payoffDate}
                    onChange={(e) => setPayoffDate(e.target.value)}
                    className="h-9 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="text-[12px] text-surface-600 block mb-1">
                    Entity — optional
                  </label>
                  <Input
                    value={entity}
                    onChange={(e) => setEntity(e.target.value)}
                    placeholder="e.g., farm"
                    className="h-9 rounded-lg text-sm"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-[12px] text-surface-600 block mb-1">
                    Notes — optional
                  </label>
                  <Input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g., Section 179 eligible"
                    className="h-9 rounded-lg text-sm"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2">
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
                  disabled={!name.trim() || !balance || !monthlyPayment || submitting}
                >
                  {submitting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  {editingId ? 'Save' : 'Add'}
                </Button>
              </div>
            </Card>
          )}

          {entries.length === 0 && !showForm ? (
            <Card variant="glass" className="rounded-2xl p-10 text-center">
              <div className="p-4 bg-rose-500/10 rounded-2xl w-fit mx-auto mb-5">
                <CreditCard className="w-8 h-8 text-rose-500" />
              </div>
              <h3 className="text-lg font-semibold text-surface-950 mb-2">No Debts Tracked</h3>
              <p className="text-[13px] text-surface-600 max-w-sm mx-auto">
                Add loans and liabilities that aren&apos;t visible to your bank sync, like equipment
                financing, private notes, or future construction loans.
              </p>
            </Card>
          ) : (
            <div className="space-y-3">
              {entries.map((e) => {
                const typeLabel = TYPE_OPTIONS.find((t) => t.value === e.type)?.label || e.type;
                return (
                  <Card key={e.id} variant="glass" className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-rose-500/10">
                          <CreditCard className="w-4 h-4 text-rose-500" />
                        </div>
                        <div>
                          <p className="text-[14px] font-medium text-surface-950">
                            {e.name}
                            {e.lender && (
                              <span className="text-surface-500 font-normal"> · {e.lender}</span>
                            )}
                          </p>
                          <div className="flex items-center gap-2 text-[11px] text-surface-500">
                            <span className="px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-surface-200 text-surface-700">
                              {typeLabel}
                            </span>
                            <span>{formatPct(e.rate)} APR</span>
                            {e.payoffDate && (
                              <span className="text-surface-400">ends {e.payoffDate}</span>
                            )}
                            {e.entity && <span className="text-surface-400">{e.entity}</span>}
                          </div>
                          {e.notes && (
                            <p className="text-[11px] text-surface-400 mt-0.5">{e.notes}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <p className="text-[16px] font-mono font-semibold text-surface-950 tabular-nums">
                            <Money>{formatUsd(e.balance)}</Money>
                          </p>
                          <p className="text-[11px] text-surface-500 font-mono tabular-nums">
                            <Money>{formatUsd(e.monthlyPayment)}</Money>/mo
                          </p>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => handleEdit(e)}
                            title="Edit"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost-danger"
                            size="icon-sm"
                            onClick={() => void handleDelete(e.id)}
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
        </TabsContent>

        <TabsContent value="dti" className="space-y-4">
          <Card variant="glass" className="p-5">
            <h3 className="text-[14px] font-semibold text-surface-950 mb-4">Current snapshot</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-[12px]">
              <div>
                <p className="text-surface-500 uppercase tracking-wider text-[10px] mb-1">
                  Existing debt service
                </p>
                <p className="font-mono text-xl text-surface-950 tabular-nums">
                  <Money>{formatUsd(dti.existingDebtService)}</Money>
                  <span className="text-[11px] text-surface-500 font-normal">/mo</span>
                </p>
              </div>
              <div>
                <p className="text-surface-500 uppercase tracking-wider text-[10px] mb-1">
                  Qualifying income
                </p>
                <p className="font-mono text-xl text-surface-950 tabular-nums">
                  <Money>{formatUsd(dti.income)}</Money>
                  <span className="text-[11px] text-surface-500 font-normal">/mo</span>
                </p>
              </div>
              <div>
                <p className="text-surface-500 uppercase tracking-wider text-[10px] mb-1">
                  Current DTI
                </p>
                <p className="font-mono text-xl font-bold tabular-nums text-surface-950">
                  {dti.preConstructionDTI != null
                    ? `${(dti.preConstructionDTI * 100).toFixed(1)}%`
                    : '—'}
                </p>
              </div>
            </div>
          </Card>

          <Card variant="glass" className="p-5">
            <h3 className="text-[14px] font-semibold text-surface-950 mb-4">Project a new loan</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
              <div>
                <label className="text-[12px] text-surface-600 block mb-1">Loan amount ($)</label>
                <Input
                  type="number"
                  value={proposedLoan}
                  onChange={(e) => setProposedLoan(e.target.value)}
                  className="h-9 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="text-[12px] text-surface-600 block mb-1">Rate (%)</label>
                <Input
                  type="number"
                  step="0.01"
                  value={proposedRate}
                  onChange={(e) => setProposedRate(e.target.value)}
                  className="h-9 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="text-[12px] text-surface-600 block mb-1">Term (years)</label>
                <Input
                  type="number"
                  value={proposedTermYears}
                  onChange={(e) => setProposedTermYears(e.target.value)}
                  className="h-9 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="text-[12px] text-surface-600 block mb-1">
                  Rental income offset ($/mo)
                </label>
                <Input
                  type="number"
                  value={excludeRentalOffset}
                  onChange={(e) => setExcludeRentalOffset(e.target.value)}
                  className="h-9 rounded-lg text-sm"
                  placeholder="0"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-border">
              <div>
                <p className="text-[10px] text-surface-500 uppercase tracking-wider mb-1">
                  Proposed P&amp;I
                </p>
                <p className="font-mono text-xl text-surface-950 tabular-nums">
                  <Money>{formatUsd(dti.proposedPI)}</Money>
                  <span className="text-[11px] text-surface-500 font-normal">/mo</span>
                </p>
              </div>
              <div>
                <p className="text-[10px] text-surface-500 uppercase tracking-wider mb-1">
                  Total monthly debt (projected)
                </p>
                <p className="font-mono text-xl text-surface-950 tabular-nums">
                  <Money>{formatUsd(dti.postConstructionDebtService)}</Money>
                  <span className="text-[11px] text-surface-500 font-normal">/mo</span>
                </p>
              </div>
            </div>

            <div className="mt-6 p-4 rounded-xl bg-surface-100 border border-border">
              <p className="text-[10px] text-surface-500 uppercase tracking-wider mb-1">
                Projected DTI
              </p>
              {dti.postConstructionDTI != null ? (
                <div className="flex items-center gap-3">
                  <p
                    className={`font-mono text-3xl font-bold tabular-nums ${
                      dti.postConstructionDTI > 0.43
                        ? 'text-rose-400'
                        : dti.postConstructionDTI > 0.36
                          ? 'text-amber-400'
                          : 'text-emerald-400'
                    }`}
                  >
                    {(dti.postConstructionDTI * 100).toFixed(1)}%
                  </p>
                  {dti.postConstructionDTI > 0.43 && (
                    <div className="flex items-center gap-1.5 text-[12px] text-rose-400">
                      <AlertTriangle className="w-4 h-4" />
                      Above the 43% conventional threshold
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-surface-500">Add income sources to see DTI.</p>
              )}
              <p className="text-[11px] text-surface-500 mt-2">
                Qualifying income grosses up non-taxable sources by 25% per common mortgage
                convention.
              </p>
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      <ConfirmDialog />
    </div>
  );
}
