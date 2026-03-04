import { useState, useMemo, useEffect } from 'react';
import { Landmark, ChevronDown, ChevronUp, Info, Plus, Trash2 } from 'lucide-react';

interface Solo401kCalculatorProps {
  defaultGross: number;
  defaultExpenses: number;
  taxYear: number;
  entity: string;
  defaultBankBalance?: number; // from December bank statement ending balance
  defaultCcBalance?: number; // from December credit card statement ending balance
}

interface BusinessAsset {
  id: string;
  name: string;
  value: number;
}

interface Contribution {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number;
  type: 'employee' | 'employer';
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

// IRS limits by year
const EMPLOYEE_LIMIT: Record<number, number> = {
  2024: 23000,
  2025: 23500,
  2026: 23500,
};
const COMBINED_CAP: Record<number, number> = {
  2024: 69000,
  2025: 70000,
  2026: 70000,
};

// TN F&E constants (TY2024+)
const TN_EXCISE_RATE = 0.065;
const TN_EXCISE_DEDUCTION = 50000; // Standard deduction from net earnings (TN Works Tax Act)
const TN_FRANCHISE_RATE = 0.0025;
const TN_FRANCHISE_EXEMPTION = 500000; // Base exemption against net worth
const TN_FRANCHISE_MIN = 100;
const TN_SOS_ANNUAL_REPORT = 300; // TN SOS annual report fee (domestic LLC)

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
        {value}
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
        <input
          type="text"
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => {
            const val = parseCurrencyInput(e.target.value);
            onBlur(val.toFixed(0));
          }}
          className="w-full pl-7 pr-3 py-2 text-sm font-mono bg-surface-200/50 border border-border rounded-lg focus:outline-none focus:border-accent-400 text-surface-900"
        />
      </div>
      {hint && <p className="text-[10px] text-surface-500 mt-1">{hint}</p>}
    </div>
  );
}

export function Solo401kCalculator({
  defaultGross,
  defaultExpenses,
  taxYear,
  entity,
  defaultBankBalance = 0,
  defaultCcBalance = 0,
}: Solo401kCalculatorProps) {
  const [expanded, setExpanded] = useState(true);
  const [grossInput, setGrossInput] = useState(defaultGross.toFixed(0));
  const [expensesInput, setExpensesInput] = useState(defaultExpenses.toFixed(0));
  const [bankBalanceInput, setBankBalanceInput] = useState(defaultBankBalance.toFixed(0));
  const [ccBalanceInput, setCcBalanceInput] = useState(defaultCcBalance.toFixed(0));

  const storageKey = `docvault-401k-contributions-${entity}-${taxYear}`;

  const [contributions, setContributions] = useState<Contribution[]>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored ? (JSON.parse(stored) as Contribution[]) : [];
    } catch {
      return [];
    }
  });

  // Business assets (for TN franchise tax net worth)
  const assetsKey = `docvault-biz-assets-${entity}-${taxYear}`;
  const [bizAssets, setBizAssets] = useState<BusinessAsset[]>(() => {
    try {
      const stored = localStorage.getItem(assetsKey);
      return stored ? (JSON.parse(stored) as BusinessAsset[]) : [];
    } catch {
      return [];
    }
  });
  const [addAssetName, setAddAssetName] = useState('');
  const [addAssetValue, setAddAssetValue] = useState('');

  useEffect(() => {
    localStorage.setItem(assetsKey, JSON.stringify(bizAssets));
  }, [bizAssets, assetsKey]);

  // Contribution entry form state
  const [addDate, setAddDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [addAmount, setAddAmount] = useState('');
  const [addType, setAddType] = useState<'employee' | 'employer'>('employee');

  // Persist contributions to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(contributions));
  }, [contributions, storageKey]);

  const employeeLimit = EMPLOYEE_LIMIT[taxYear] ?? 23500;
  const combinedCap = COMBINED_CAP[taxYear] ?? 70000;

  const calc = useMemo(() => {
    const gross = parseCurrencyInput(grossInput);
    const expenses = parseCurrencyInput(expensesInput);
    const netProfit = Math.max(0, gross - expenses);
    const bankBalance = parseCurrencyInput(bankBalanceInput);
    const ccBalance = parseCurrencyInput(ccBalanceInput);
    const totalAssets = bizAssets.reduce((s, a) => s + a.value, 0);
    const netWorth = Math.max(0, bankBalance - ccBalance + totalAssets);
    const tangibleProperty = totalAssets; // for TN franchise tax alternative base

    // Self-employment tax: 15.3% on 92.35% of net profit
    const seTaxBase = netProfit * 0.9235;
    const seTax = seTaxBase * 0.153;
    const halfSeTax = seTax / 2;

    // Plan compensation = net profit − half SE tax deduction
    const planComp = Math.max(0, netProfit - halfSeTax);

    // Employer contribution: IRS reduced rate = 25% ÷ 125% = 20%
    // (Publication 560, Worksheet 1 — accounts for circular deduction)
    const employerContrib = planComp * 0.2;

    const rawTotal = employerContrib + employeeLimit;
    const totalContrib = Math.min(rawTotal, combinedCap);
    const actualEmployer = Math.min(employerContrib, combinedCap - employeeLimit);
    const remainingCapacity = Math.max(0, combinedCap - totalContrib);

    // TN Excise Tax: 6.5% on (net earnings − $50k standard deduction), min $0
    // Standard deduction added by TN Works Tax Act starting TY2024
    const exciseTaxBase = Math.max(0, netProfit - TN_EXCISE_DEDUCTION);
    const tnExciseTax = exciseTaxBase * TN_EXCISE_RATE;

    // TN Franchise Tax: 0.25% on greater of (net worth OR tangible property) − $500k exemption, min $100
    const franchiseTaxBase = Math.max(
      0,
      Math.max(netWorth, tangibleProperty) - TN_FRANCHISE_EXEMPTION
    );
    const tnFranchiseTax = Math.max(TN_FRANCHISE_MIN, franchiseTaxBase * TN_FRANCHISE_RATE);

    const tnTotal = tnExciseTax + tnFranchiseTax + TN_SOS_ANNUAL_REPORT;

    return {
      gross,
      expenses,
      netProfit,
      seTax,
      halfSeTax,
      planComp,
      bankBalance,
      ccBalance,
      totalAssets,
      netWorth,
      employerContrib: actualEmployer,
      employeeLimit,
      totalContrib,
      remainingCapacity,
      tnExciseTax,
      tnFranchiseTax,
      tnTotal,
    };
  }, [
    grossInput,
    expensesInput,
    bankBalanceInput,
    ccBalanceInput,
    bizAssets,
    employeeLimit,
    combinedCap,
  ]);

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
  const barColor =
    contrib401kPct >= 100 ? 'bg-red-400' : contrib401kPct >= 80 ? 'bg-amber-400' : 'bg-blue-400';

  function addContribution() {
    const amount = parseCurrencyInput(addAmount);
    if (!amount || !addDate) return;
    const newContrib: Contribution = {
      id: crypto.randomUUID(),
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
    <div className="glass-card rounded-xl overflow-hidden">
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
            <p className="text-[13px] font-semibold text-surface-900">
              Solo 401(k) & TN Tax Calculator
            </p>
            <p className="text-[11px] text-surface-600">
              {taxYear} · Self-employment income only · not W-2 or other LLCs
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {!expanded && (
            <span className="text-sm font-mono font-bold text-blue-400">
              {formatCurrency(calc.totalContrib)} max · {formatCurrency(remaining401k)} left
            </span>
          )}
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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <CurrencyInput
              label="Gross Revenue"
              value={grossInput}
              onChange={setGrossInput}
              onBlur={setGrossInput}
              hint="From bank deposits or invoices"
            />
            <CurrencyInput
              label="Business Expenses"
              value={expensesInput}
              onChange={setExpensesInput}
              onBlur={setExpensesInput}
              hint="Schedule C deductible expenses"
            />
            <CurrencyInput
              label="Bank Balance (Dec 31)"
              value={bankBalanceInput}
              onChange={setBankBalanceInput}
              onBlur={setBankBalanceInput}
              hint={
                defaultBankBalance > 0 ? '↑ from Dec statement' : 'From December bank statement'
              }
            />
            <CurrencyInput
              label="CC Balance Owed (Dec 31)"
              value={ccBalanceInput}
              onChange={setCcBalanceInput}
              onBlur={setCcBalanceInput}
              hint={defaultCcBalance > 0 ? '↑ from Dec statement' : 'From December CC statement'}
            />
          </div>

          <div className="border-t border-border" />

          {/* Calculation breakdown */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10">
            {/* Left: SE tax + 401k limits */}
            <div>
              <p className="text-[10px] font-semibold text-surface-500 uppercase tracking-wider mb-1">
                Net Profit
              </p>
              <Row label="Gross Revenue" value={formatCurrency(calc.gross)} />
              <Row
                label="Business Expenses"
                value={`− ${formatCurrency(calc.expenses)}`}
                indent
                color="text-red-400"
              />
              <Row label="Net Profit" value={formatCurrency(calc.netProfit)} bold />
              <div className="border-t border-border/50 my-2" />
              <Row
                label="SE Tax (15.3% × 92.35%)"
                value={`− ${formatCurrency(calc.seTax)}`}
                indent
                color="text-red-400"
                tooltip="Self-employment tax: 12.4% SS + 2.9% Medicare on 92.35% of net profit"
              />
              <Row
                label="½ SE Tax Deduction"
                value={`− ${formatCurrency(calc.halfSeTax)}`}
                indent
                color="text-emerald-400"
                tooltip="IRS allows deducting half of SE tax before calculating plan compensation"
              />
              <Row label="Plan Compensation" value={formatCurrency(calc.planComp)} bold />

              <div className="border-t border-border/50 mt-3 mb-2" />
              <p className="text-[10px] font-semibold text-surface-500 uppercase tracking-wider mb-1">
                Solo 401(k) Limit
              </p>
              <Row
                label="Employee Deferral"
                value={formatCurrency(calc.employeeLimit)}
                tooltip={`${taxYear} IRS elective deferral limit.`}
              />
              <Row
                label="Employer Profit-Sharing (20%)"
                value={formatCurrency(calc.employerContrib)}
                tooltip="IRS reduced rate: 25% ÷ 125% = 20% of plan compensation (Publication 560, Worksheet 1). Accounts for the circular self-deduction."
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
                  label={`Headroom to $${(combinedCap / 1000).toFixed(0)}K cap`}
                  value={formatCurrency(calc.remainingCapacity)}
                  indent
                  color="text-surface-500"
                  tooltip={`IRS combined limit for ${taxYear} is $${combinedCap.toLocaleString()}`}
                />
              )}
            </div>

            {/* Right: TN F&E taxes */}
            <div>
              <p className="text-[10px] font-semibold text-surface-500 uppercase tracking-wider mb-1">
                TN Franchise &amp; Excise Tax
              </p>
              <Row label="Excise: Net Earnings" value={formatCurrency(calc.netProfit)} />
              <Row
                label="Standard Deduction (TY2024+)"
                value={`− ${formatCurrency(TN_EXCISE_DEDUCTION)}`}
                indent
                color="text-emerald-400"
                tooltip="TN Works Tax Act: $50,000 standard deduction from net earnings before applying 6.5% excise rate"
              />
              <Row
                label="Excise Tax (6.5%)"
                value={formatCurrency(calc.tnExciseTax)}
                color="text-amber-400"
              />
              <div className="border-t border-border/50 my-2" />
              <Row label="Bank Balance (Dec 31)" value={formatCurrency(calc.bankBalance)} />
              <Row
                label="CC Balance Owed"
                value={`− ${formatCurrency(calc.ccBalance)}`}
                indent
                color="text-red-400"
              />
              {calc.totalAssets > 0 && (
                <Row
                  label="Business Assets"
                  value={`+ ${formatCurrency(calc.totalAssets)}`}
                  indent
                  color="text-emerald-400"
                />
              )}
              <Row
                label="Net Worth (Dec 31)"
                value={formatCurrency(calc.netWorth)}
                bold
                tooltip="Assets − liabilities. For TN franchise tax, the base is the greater of net worth or tangible property."
              />
              <Row
                label="Base Exemption (TY2024+)"
                value={`− ${formatCurrency(TN_FRANCHISE_EXEMPTION)}`}
                indent
                color="text-emerald-400"
                tooltip="TN Works Tax Act: $500,000 exemption against franchise tax base"
              />
              <Row
                label="Franchise Tax (0.25%, min $100)"
                value={formatCurrency(calc.tnFranchiseTax)}
                color="text-amber-400"
                tooltip="0.25% of taxable base after exemption, min $100. Base = greater of net worth or tangible property."
              />
              <div className="border-t border-border/50 my-2" />
              <Row
                label="SOS Annual Report Fee"
                value={formatCurrency(TN_SOS_ANNUAL_REPORT)}
                indent
                tooltip="Tennessee Secretary of State annual report filing fee for domestic LLCs"
              />
              <Row
                label="TN Total Owed"
                value={formatCurrency(calc.tnTotal)}
                bold
                color="text-amber-400"
              />
            </div>
          </div>

          <div className="border-t border-border" />

          {/* Business assets tracker (for TN franchise tax net worth) */}
          <div>
            <p className="text-[10px] font-semibold text-surface-500 uppercase tracking-wider mb-2">
              Business Assets
            </p>
            {bizAssets.length > 0 && (
              <div className="mb-2 space-y-1">
                {bizAssets.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between py-1 px-2 rounded-lg hover:bg-surface-300/20 group"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-[13px] text-surface-700">{a.name}</span>
                      <span className="text-[13px] font-mono text-surface-900">
                        {formatCurrency(a.value)}
                      </span>
                    </div>
                    <button
                      onClick={() => setBizAssets((prev) => prev.filter((x) => x.id !== a.id))}
                      className="opacity-0 group-hover:opacity-100 text-surface-500 hover:text-red-400 transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label className="block text-[10px] text-surface-500 mb-1">Asset Name</label>
                <input
                  type="text"
                  value={addAssetName}
                  onChange={(e) => setAddAssetName(e.target.value)}
                  placeholder="e.g. MacBook Pro, Test Phone"
                  className="w-full px-2.5 py-1.5 text-[12px] bg-surface-200/50 border border-border rounded-lg focus:outline-none focus:border-accent-400 text-surface-900"
                />
              </div>
              <div className="w-28 flex-shrink-0">
                <label className="block text-[10px] text-surface-500 mb-1">FMV</label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-500 text-sm">
                    $
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={addAssetValue}
                    onChange={(e) => setAddAssetValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && addAssetName && addAssetValue) {
                        setBizAssets((prev) => [
                          ...prev,
                          {
                            id: crypto.randomUUID(),
                            name: addAssetName,
                            value: parseCurrencyInput(addAssetValue),
                          },
                        ]);
                        setAddAssetName('');
                        setAddAssetValue('');
                      }
                    }}
                    placeholder="0"
                    className="w-full pl-6 pr-2 py-1.5 text-[12px] font-mono bg-surface-200/50 border border-border rounded-lg focus:outline-none focus:border-accent-400 text-surface-900"
                  />
                </div>
              </div>
              <button
                onClick={() => {
                  if (!addAssetName || !addAssetValue) return;
                  setBizAssets((prev) => [
                    ...prev,
                    {
                      id: crypto.randomUUID(),
                      name: addAssetName,
                      value: parseCurrencyInput(addAssetValue),
                    },
                  ]);
                  setAddAssetName('');
                  setAddAssetValue('');
                }}
                disabled={!addAssetName || !addAssetValue}
                className="flex items-center gap-1 px-3 py-1.5 text-[12px] font-medium bg-accent-500 hover:bg-accent-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex-shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </button>
            </div>
          </div>

          <div className="border-t border-border" />

          {/* Contributions tracker */}
          <div>
            <p className="text-[10px] font-semibold text-surface-500 uppercase tracking-wider mb-3">
              Contributions Made
            </p>

            {/* Progress bar */}
            <div className="mb-3">
              <div className="flex justify-between text-[11px] text-surface-600 mb-1">
                <span>{formatCurrency(totalContributed)} contributed</span>
                <span>
                  {formatCurrency(remaining401k)} remaining of {formatCurrency(calc.totalContrib)}{' '}
                  max
                </span>
              </div>
              <div className="h-2 bg-surface-300/50 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${barColor}`}
                  style={{ width: `${Math.min(100, contrib401kPct).toFixed(1)}%` }}
                />
              </div>
              <div className="flex gap-4 mt-1.5 text-[11px]">
                <span className="text-surface-600">
                  Employee:{' '}
                  <span className="font-mono text-surface-800">
                    {formatCurrency(totalEmployeeContrib)}
                  </span>
                  <span className="text-surface-500"> / {formatCurrency(employeeLimit)}</span>
                </span>
                <span className="text-surface-600">
                  Employer:{' '}
                  <span className="font-mono text-surface-800">
                    {formatCurrency(totalEmployerContrib)}
                  </span>
                  <span className="text-surface-500">
                    {' '}
                    / {formatCurrency(calc.employerContrib)}
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
                    className="flex items-center justify-between py-1 px-2 rounded-lg hover:bg-surface-300/20 group"
                  >
                    <div className="flex items-center gap-3">
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
                        {formatCurrency(c.amount)}
                      </span>
                    </div>
                    <button
                      onClick={() => removeContribution(c.id)}
                      className="opacity-0 group-hover:opacity-100 text-surface-500 hover:text-red-400 transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add contribution form */}
            <div className="flex gap-2 items-end">
              <div className="flex-shrink-0">
                <label className="block text-[10px] text-surface-500 mb-1">Date</label>
                <input
                  type="date"
                  value={addDate}
                  onChange={(e) => setAddDate(e.target.value)}
                  className="px-2 py-1.5 text-[12px] font-mono bg-surface-200/50 border border-border rounded-lg focus:outline-none focus:border-accent-400 text-surface-900"
                />
              </div>
              <div className="flex-shrink-0">
                <label className="block text-[10px] text-surface-500 mb-1">Type</label>
                <select
                  value={addType}
                  onChange={(e) => setAddType(e.target.value as 'employee' | 'employer')}
                  className="px-2 py-1.5 text-[12px] bg-surface-200/50 border border-border rounded-lg focus:outline-none focus:border-accent-400 text-surface-900"
                >
                  <option value="employee">Employee</option>
                  <option value="employer">Employer</option>
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-[10px] text-surface-500 mb-1">Amount</label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-500 text-sm">
                    $
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={addAmount}
                    onChange={(e) => setAddAmount(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') addContribution();
                    }}
                    placeholder="0"
                    className="w-full pl-6 pr-2 py-1.5 text-[12px] font-mono bg-surface-200/50 border border-border rounded-lg focus:outline-none focus:border-accent-400 text-surface-900"
                  />
                </div>
              </div>
              <button
                onClick={addContribution}
                disabled={!addAmount || !addDate}
                className="flex items-center gap-1 px-3 py-1.5 text-[12px] font-medium bg-accent-500 hover:bg-accent-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex-shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
