import { useState, useMemo } from 'react';
import { Landmark, ChevronDown, ChevronUp, Info } from 'lucide-react';

interface Solo401kCalculatorProps {
  defaultGross: number; // Bank deposits (most accurate) or invoice total
  defaultExpenses: number; // Deductible expenses from receipts
  taxYear: number;
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

// Employee deferral limits by year
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
              <div className="absolute left-0 bottom-5 z-10 w-56 p-2 text-[11px] text-surface-800 bg-surface-100 border border-border rounded-lg shadow-lg">
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

export function Solo401kCalculator({
  defaultGross,
  defaultExpenses,
  taxYear,
}: Solo401kCalculatorProps) {
  const [expanded, setExpanded] = useState(true);
  const [grossInput, setGrossInput] = useState(defaultGross.toFixed(0));
  const [expensesInput, setExpensesInput] = useState(defaultExpenses.toFixed(0));

  const employeeLimit = EMPLOYEE_LIMIT[taxYear] ?? 23500;
  const combinedCap = COMBINED_CAP[taxYear] ?? 70000;

  const calc = useMemo(() => {
    const gross = parseCurrencyInput(grossInput);
    const expenses = parseCurrencyInput(expensesInput);
    const netProfit = Math.max(0, gross - expenses);

    // Self-employment tax: 15.3% on 92.35% of net profit
    const seTaxBase = netProfit * 0.9235;
    const seTax = seTaxBase * 0.153;
    const halfSeTax = seTax / 2;

    // Plan compensation = net profit − half SE tax deduction
    const planComp = Math.max(0, netProfit - halfSeTax);

    // Employer contribution: IRS reduced rate = 25% ÷ (1 + 25%) = 20% of plan comp
    // The contribution itself reduces plan compensation (circular), so the IRS-approved
    // effective rate for a 25% profit-sharing plan is 20%. (Publication 560, Worksheet 1)
    const employerContrib = planComp * 0.2;

    // Total before cap
    const rawTotal = employerContrib + employeeLimit;
    const totalContrib = Math.min(rawTotal, combinedCap);
    const actualEmployer = Math.min(employerContrib, combinedCap - employeeLimit);
    const remainingCapacity = Math.max(0, combinedCap - totalContrib);

    // TN excise tax (6.5% on net earnings, $100 min, + $300 annual report)
    const tnExciseTax = Math.max(100, netProfit * 0.065);
    const tnTotal = tnExciseTax + 300;

    return {
      gross,
      expenses,
      netProfit,
      seTax,
      halfSeTax,
      planComp,
      employerContrib: actualEmployer,
      employeeLimit,
      totalContrib,
      remainingCapacity,
      tnExciseTax,
      tnTotal,
    };
  }, [grossInput, expensesInput, employeeLimit, combinedCap]);

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
            <p className="text-[13px] font-semibold text-surface-900">Solo 401(k) Calculator</p>
            <p className="text-[11px] text-surface-600">
              {taxYear} · Self-employment income only · not W-2 or other LLCs
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {!expanded && (
            <span className="text-sm font-mono font-bold text-blue-400">
              {formatCurrency(calc.totalContrib)} max contribution
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
        <div className="px-5 pb-5">
          {/* Inputs */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="block text-[11px] font-medium text-surface-600 uppercase tracking-wider mb-1.5">
                Gross Revenue
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500 text-sm">
                  $
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={grossInput}
                  onChange={(e) => setGrossInput(e.target.value)}
                  onBlur={(e) => {
                    const val = parseCurrencyInput(e.target.value);
                    setGrossInput(val.toFixed(0));
                  }}
                  className="w-full pl-7 pr-3 py-2 text-sm font-mono bg-surface-200/50 border border-border rounded-lg focus:outline-none focus:border-accent-400 text-surface-900"
                />
              </div>
              <p className="text-[10px] text-surface-500 mt-1">From bank deposits or invoices</p>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-surface-600 uppercase tracking-wider mb-1.5">
                Business Expenses
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500 text-sm">
                  $
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={expensesInput}
                  onChange={(e) => setExpensesInput(e.target.value)}
                  onBlur={(e) => {
                    const val = parseCurrencyInput(e.target.value);
                    setExpensesInput(val.toFixed(0));
                  }}
                  className="w-full pl-7 pr-3 py-2 text-sm font-mono bg-surface-200/50 border border-border rounded-lg focus:outline-none focus:border-accent-400 text-surface-900"
                />
              </div>
              <p className="text-[10px] text-surface-500 mt-1">Schedule C deductible expenses</p>
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-border mb-3" />

          {/* Calculation breakdown */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
            {/* Left: SE tax chain */}
            <div>
              <p className="text-[10px] font-semibold text-surface-500 uppercase tracking-wider mb-1">
                Net Profit Calculation
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
                value={formatCurrency(calc.seTax)}
                indent
                color="text-red-400"
                tooltip="Self-employment tax: 12.4% Social Security + 2.9% Medicare, applied to 92.35% of net profit"
              />
              <Row
                label="½ SE Tax Deduction"
                value={`− ${formatCurrency(calc.halfSeTax)}`}
                indent
                color="text-emerald-400"
                tooltip="IRS allows deducting half of SE tax from gross income before calculating plan compensation"
              />
              <Row label="Plan Compensation" value={formatCurrency(calc.planComp)} bold />
            </div>

            {/* Right: 401k limits */}
            <div>
              <p className="text-[10px] font-semibold text-surface-500 uppercase tracking-wider mb-1">
                Solo 401(k) Contribution Limit
              </p>
              <Row
                label="Employee Deferral"
                value={formatCurrency(calc.employeeLimit)}
                tooltip={`${taxYear} IRS elective deferral limit. You can contribute up to this as the "employee" of your own business.`}
              />
              <Row
                label="Employer Profit-Sharing (20%)"
                value={formatCurrency(calc.employerContrib)}
                tooltip="IRS reduced rate: 25% ÷ 125% = 20% of plan compensation. Because your own contribution reduces your plan compensation (circular), Publication 560 specifies 20% as the effective rate for a 25% profit-sharing plan."
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
                  label={`Remaining to $${(combinedCap / 1000).toFixed(0)}K cap`}
                  value={formatCurrency(calc.remainingCapacity)}
                  indent
                  color="text-surface-500"
                  tooltip={`IRS combined limit for ${taxYear} is $${combinedCap.toLocaleString()}`}
                />
              )}

              {/* TN Excise Tax */}
              <div className="border-t border-border/50 mt-3 mb-2" />
              <p className="text-[10px] font-semibold text-surface-500 uppercase tracking-wider mb-1">
                TN Business Tax (AM2 LLC)
              </p>
              <Row
                label="TN Excise Tax (6.5%)"
                value={formatCurrency(calc.tnExciseTax)}
                color="text-amber-400"
                tooltip="Tennessee excise tax: 6.5% on net earnings, $100 minimum"
              />
              <Row
                label="Annual Report Fee"
                value={formatCurrency(300)}
                indent
                color="text-amber-400"
              />
              <Row
                label="TN Total Owed"
                value={formatCurrency(calc.tnTotal)}
                bold
                color="text-amber-400"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
