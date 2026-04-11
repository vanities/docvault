import { useState, useMemo, useEffect, useRef } from 'react';
import { Landmark, ChevronDown, ChevronUp, Info, Plus, Trash2 } from 'lucide-react';
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

interface Solo401kCalculatorProps {
  defaultGross: number;
  defaultExpenses: number;
  k1SEEarnings?: number;
  taxYear: number;
  entity: string;
}

interface Contribution {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number;
  type: 'employee' | 'employer';
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

import { computeSolo401k } from './solo401k-calc';
import { Money } from '../common/Money';

interface RowProps {
  label: string;
  value: string;
  indent?: boolean;
  bold?: boolean;
  color?: string;
  tooltip?: string;
}

function Row({ label, value, indent, bold, color, tooltip }: RowProps) {
  const [showTip, setShowTip] = useState(false);
  return (
    <div className={`flex items-center justify-between py-1.5 ${indent ? 'pl-4' : ''}`}>
      <div className="flex items-center gap-1.5">
        <span
          className={`text-[13px] ${bold ? 'font-semibold text-surface-900' : 'text-surface-700'}`}
        >
          {label}
        </span>
        {tooltip && (
          <div className="relative">
            <button
              onMouseEnter={() => setShowTip(true)}
              onMouseLeave={() => setShowTip(false)}
              className="text-surface-500 hover:text-surface-700"
            >
              <Info className="w-3 h-3" />
            </button>
            {showTip && (
              <div className="absolute left-0 bottom-5 z-10 w-64 p-2 text-[11px] text-surface-800 bg-surface-100 border border-border rounded-lg shadow-lg">
                {tooltip}
              </div>
            )}
          </div>
        )}
      </div>
      <span
        className={`text-[13px] font-mono font-semibold ${color || (bold ? 'text-surface-950' : 'text-surface-800')}`}
      >
        <Money>{value}</Money>
      </span>
    </div>
  );
}

function CurrencyInput({
  label,
  value,
  onChange,
  onBlur,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur: (v: string) => void;
  hint?: string;
}) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-surface-600 uppercase tracking-wider mb-1.5">
        {label}
      </label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500 text-sm">$</span>
        <Input
          type="text"
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => {
            const val = parseCurrencyInput(e.target.value);
            onBlur(val.toFixed(0));
          }}
          className="pl-7 h-9 rounded-lg text-sm font-mono bg-surface-200/50"
        />
      </div>
      {hint && <p className="text-[10px] text-surface-500 mt-1">{hint}</p>}
    </div>
  );
}

export function Solo401kCalculator({
  defaultGross,
  defaultExpenses,
  k1SEEarnings = 0,
  taxYear,
  entity,
}: Solo401kCalculatorProps) {
  const [expanded, setExpanded] = useState(true);
  const [grossInput, setGrossInput] = useState(defaultGross.toFixed(0));
  const [expensesInput, setExpensesInput] = useState(defaultExpenses.toFixed(0));
  const [grossEdited, setGrossEdited] = useState(false);
  const [expensesEdited, setExpensesEdited] = useState(false);

  // Sync inputs from analytics defaults unless the user has manually edited them
  useEffect(() => {
    if (!grossEdited && defaultGross > 0) setGrossInput(defaultGross.toFixed(0));
  }, [defaultGross, grossEdited]);
  useEffect(() => {
    if (!expensesEdited && defaultExpenses > 0) setExpensesInput(defaultExpenses.toFixed(0));
  }, [defaultExpenses, expensesEdited]);

  const [contributions, setContributions] = useState<Contribution[]>([]);
  const contribLoadedRef = useRef(false);

  // Contribution entry form state
  const [addDate, setAddDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [addAmount, setAddAmount] = useState('');
  const [addType, setAddType] = useState<'employee' | 'employer'>('employee');

  // Load contributions from server
  useEffect(() => {
    contribLoadedRef.current = false;
    fetch(`/api/contributions/${entity}/${taxYear}`)
      .then((r) => r.json())
      .then((data) => {
        setContributions(data.contributions || []);
        contribLoadedRef.current = true;
      })
      .catch(() => {
        contribLoadedRef.current = true;
      });
  }, [entity, taxYear]);

  // Save contributions to server when they change (skip initial load)
  useEffect(() => {
    if (!contribLoadedRef.current) return;
    fetch(`/api/contributions/${entity}/${taxYear}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contributions }),
    }).catch(() => {});
  }, [contributions, entity, taxYear]);

  const calc = useMemo(
    () =>
      computeSolo401k(
        parseCurrencyInput(grossInput),
        parseCurrencyInput(expensesInput),
        k1SEEarnings,
        taxYear
      ),
    [grossInput, expensesInput, k1SEEarnings, taxYear]
  );

  // Contribution totals
  const totalEmployeeContrib = contributions
    .filter((c) => c.type === 'employee')
    .reduce((s, c) => s + c.amount, 0);
  const totalEmployerContrib = contributions
    .filter((c) => c.type === 'employer')
    .reduce((s, c) => s + c.amount, 0);
  const totalContributed = totalEmployeeContrib + totalEmployerContrib;
  const remaining401k = Math.max(0, calc.totalContrib - totalContributed);

  const contrib401kPct = calc.totalContrib > 0 ? (totalContributed / calc.totalContrib) * 100 : 0;
  const isMaxed = contrib401kPct >= 100;
  const barColor = isMaxed
    ? 'bg-emerald-400'
    : contrib401kPct >= 80
      ? 'bg-amber-400'
      : 'bg-blue-400';

  function addContribution() {
    const amount = parseCurrencyInput(addAmount);
    if (!amount || !addDate) return;
    const newContrib: Contribution = {
      id: generateId(),
      date: addDate,
      amount,
      type: addType,
    };
    setContributions((prev) => [...prev, newContrib].sort((a, b) => a.date.localeCompare(b.date)));
    setAddAmount('');
  }

  function removeContribution(id: string) {
    setContributions((prev) => prev.filter((c) => c.id !== id));
  }

  return (
    <Card variant="glass" className="overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-surface-300/10 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-blue-500/10">
            <Landmark className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-left">
            <p className="text-[13px] font-semibold text-surface-900">Solo 401(k) Calculator</p>
            <p className="text-[11px] text-surface-600">
              {taxYear} · IRS Pub 560 Worksheet · All SE income combined
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {!expanded &&
            (isMaxed ? (
              <span className="text-sm font-mono font-bold text-emerald-400 hidden sm:inline">
                Maxed <Money>{formatCurrency(totalContributed)}</Money>
              </span>
            ) : (
              <span className="text-sm font-mono font-bold text-blue-400 hidden sm:inline">
                <Money>{formatCurrency(calc.totalContrib)}</Money> max ·{' '}
                <Money>{formatCurrency(remaining401k)}</Money> left
              </span>
            ))}
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-surface-600" />
          ) : (
            <ChevronDown className="w-4 h-4 text-surface-600" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-5 space-y-5">
          {/* Inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <CurrencyInput
              label="Gross Revenue"
              value={grossInput}
              onChange={(v) => {
                setGrossInput(v);
                setGrossEdited(true);
              }}
              onBlur={(v) => {
                setGrossInput(v);
                setGrossEdited(true);
              }}
              hint="From bank deposits or invoices"
            />
            <CurrencyInput
              label="Business Expenses"
              value={expensesInput}
              onChange={(v) => {
                setExpensesInput(v);
                setExpensesEdited(true);
              }}
              onBlur={(v) => {
                setExpensesInput(v);
                setExpensesEdited(true);
              }}
              hint="Schedule C deductible expenses"
            />
          </div>

          <div className="border-t border-border" />

          {/* Calculation breakdown — IRS Pub 560 Worksheet */}
          <div>
            <p className="text-[10px] font-semibold text-surface-500 uppercase tracking-wider mb-1">
              Pub 560 Worksheet
            </p>
            <Row label="Gross Revenue (deposits)" value={formatCurrency(calc.gross)} />
            <Row
              label="Business Expenses"
              value={`− ${formatCurrency(calc.expenses)}`}
              indent
              color="text-red-400"
            />
            <Row label="Schedule C Net Profit" value={formatCurrency(calc.netProfit)} bold />
            {calc.k1SEEarnings !== 0 && (
              <>
                <Row
                  label="K-1 SE Earnings"
                  value={formatCurrency(calc.k1SEEarnings)}
                  indent
                  color={calc.k1SEEarnings < 0 ? 'text-red-400' : 'text-emerald-400'}
                  tooltip="Partnership K-1 self-employment earnings. IRS Pub 560 Step 1 combines all SE income."
                />
                <Row
                  label="Combined SE Income (Step 1)"
                  value={formatCurrency(calc.combinedSEIncome)}
                  bold
                />
              </>
            )}
            <div className="border-t border-border/50 my-2" />
            <Row
              label="SE Tax (15.3% × 92.35%)"
              value={`− ${formatCurrency(calc.seTax)}`}
              indent
              color="text-red-400"
              tooltip="Self-employment tax: 12.4% SS + 2.9% Medicare on 92.35% of combined SE income"
            />
            <Row
              label="½ SE Tax Deduction (Step 2)"
              value={`− ${formatCurrency(calc.halfSeTax)}`}
              indent
              color="text-emerald-400"
              tooltip="IRS allows deducting half of SE tax before calculating net earnings"
            />
            <Row label="Net Earnings (Step 3)" value={formatCurrency(calc.netEarnings)} bold />

            <div className="border-t border-border/50 mt-3 mb-2" />
            <p className="text-[10px] font-semibold text-surface-500 uppercase tracking-wider mb-1">
              Solo 401(k) Limit
            </p>
            <Row
              label="Employee Deferral (Step 9)"
              value={formatCurrency(calc.employeeLimit)}
              tooltip={`${taxYear} IRS elective deferral limit.`}
            />
            <Row
              label="Employer Profit-Sharing (Step 5)"
              value={formatCurrency(calc.employerContrib)}
              tooltip="IRS reduced rate: 25% ÷ 125% = 20% of net earnings (Publication 560, Worksheet Step 5). Accounts for the circular self-deduction."
            />
            <div className="border-t border-border/50 my-2" />
            <Row
              label={`Max Contribution (${taxYear})`}
              value={formatCurrency(calc.totalContrib)}
              bold
              color="text-blue-400"
            />
            {calc.remainingCapacity > 0 && (
              <Row
                label={`Headroom to $${(calc.combinedCap / 1000).toFixed(0)}K cap`}
                value={formatCurrency(calc.remainingCapacity)}
                indent
                color="text-surface-500"
                tooltip={`IRS combined limit for ${taxYear} is $${calc.combinedCap.toLocaleString()}`}
              />
            )}
          </div>

          <div className="border-t border-border" />

          {/* Contributions tracker */}
          <div>
            <p className="text-[10px] font-semibold text-surface-500 uppercase tracking-wider mb-3">
              Contributions Made
            </p>

            {/* Maxed out banner */}
            {isMaxed && (
              <div className="mb-3 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <p className="text-[13px] font-semibold text-emerald-400">
                  Maxed out for {taxYear}!
                </p>
                <p className="text-[11px] text-emerald-400/70">
                  <Money>{formatCurrency(totalContributed)}</Money> contributed — IRS Pub 560
                  maximum reached.
                </p>
              </div>
            )}

            {/* Progress bar */}
            <div className="mb-3">
              <div className="flex justify-between text-[11px] text-surface-600 mb-1">
                <span>
                  <Money>{formatCurrency(totalContributed)}</Money> contributed
                </span>
                <span>
                  {isMaxed ? (
                    <span className="text-emerald-400 font-medium">Maxed</span>
                  ) : (
                    <>
                      <Money>{formatCurrency(remaining401k)}</Money> remaining of{' '}
                      <Money>{formatCurrency(calc.totalContrib)}</Money> max
                    </>
                  )}
                </span>
              </div>
              <div className="h-2 bg-surface-300/50 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${barColor}`}
                  style={{ width: `${Math.min(100, contrib401kPct).toFixed(1)}%` }}
                />
              </div>
              <div className="flex flex-col sm:flex-row gap-1 sm:gap-4 mt-1.5 text-[11px]">
                <span className="text-surface-600">
                  Employee:{' '}
                  <span className="font-mono text-surface-800">
                    <Money>{formatCurrency(totalEmployeeContrib)}</Money>
                  </span>
                  <span className="text-surface-500">
                    {' '}
                    / <Money>{formatCurrency(calc.employeeLimit)}</Money>
                  </span>
                </span>
                <span className="text-surface-600">
                  Employer:{' '}
                  <span className="font-mono text-surface-800">
                    <Money>{formatCurrency(totalEmployerContrib)}</Money>
                  </span>
                  <span className="text-surface-500">
                    {' '}
                    / <Money>{formatCurrency(calc.employerContrib)}</Money>
                  </span>
                </span>
              </div>
            </div>

            {/* Contribution list */}
            {contributions.length > 0 && (
              <div className="mb-3 space-y-1">
                {contributions.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-surface-300/20 group gap-2"
                  >
                    <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-wrap">
                      <span className="text-[11px] text-surface-500 font-mono">{c.date}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          c.type === 'employee'
                            ? 'bg-blue-500/10 text-blue-400'
                            : 'bg-emerald-500/10 text-emerald-400'
                        }`}
                      >
                        {c.type}
                      </span>
                      <span className="text-[13px] font-mono text-surface-900">
                        <Money>{formatCurrency(c.amount)}</Money>
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost-danger"
                      size="icon-xs"
                      onClick={() => removeContribution(c.id)}
                      className="opacity-0 group-hover:opacity-100 flex-shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {/* Add contribution form (hidden in "all" aggregate view) */}
            <div className="grid grid-cols-2 sm:flex gap-2 items-end">
              <div className="sm:flex-shrink-0">
                <label className="block text-[10px] text-surface-500 mb-1">Date</label>
                <Input
                  type="date"
                  value={addDate}
                  onChange={(e) => setAddDate(e.target.value)}
                  className="px-2 py-1.5 h-auto text-[12px] font-mono bg-surface-200/50 rounded-lg"
                />
              </div>
              <div className="sm:flex-shrink-0">
                <label className="block text-[10px] text-surface-500 mb-1">Type</label>
                <Select
                  value={addType}
                  onValueChange={(val) => setAddType(val as 'employee' | 'employer')}
                >
                  <SelectTrigger className="text-[12px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="employee">Employee</SelectItem>
                    <SelectItem value="employer">Employer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:flex-1">
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
                      if (e.key === 'Enter') addContribution();
                    }}
                    placeholder="0"
                    className="w-full pl-6 pr-2 py-1.5 h-auto text-[12px] font-mono bg-surface-200/50 rounded-lg"
                  />
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                onClick={addContribution}
                disabled={!addAmount || !addDate}
                className="col-span-2 sm:col-span-1 sm:flex-shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
