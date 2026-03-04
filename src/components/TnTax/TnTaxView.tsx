import { useMemo, useState, useEffect } from 'react';
import { Info, Plus, Trash2, ExternalLink } from 'lucide-react';
import { useAppContext } from '../../contexts/AppContext';
import { EXPENSE_CATEGORIES } from '../../config';
import type { ExpenseCategory } from '../../types';

// ─── Constants ───────────────────────────────────────────────────────────────

const TN_EXCISE_RATE = 0.065;
const TN_EXCISE_DEDUCTION = 50000;
const TN_FRANCHISE_RATE = 0.0025;
const TN_FRANCHISE_EXEMPTION = 500000;
const TN_FRANCHISE_MIN = 100;
const TN_SOS_FEE = 300;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function parseNum(raw: string) {
  return parseFloat(raw.replace(/[^0-9.]/g, '')) || 0;
}

interface BusinessAsset {
  id: string;
  name: string;
  value: number;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

interface FieldProps {
  line?: string;
  label: string;
  value?: string;
  editable?: boolean;
  inputValue?: string;
  onInputChange?: (v: string) => void;
  onInputBlur?: (v: string) => void;
  highlight?: 'green' | 'amber' | 'blue' | 'red';
  indent?: boolean;
  tooltip?: string;
  copyable?: boolean;
}

function Field({
  line,
  label,
  value,
  editable,
  inputValue,
  onInputChange,
  onInputBlur,
  highlight,
  indent,
  tooltip,
}: FieldProps) {
  const [showTip, setShowTip] = useState(false);
  const colorClass =
    highlight === 'green'
      ? 'text-emerald-500'
      : highlight === 'amber'
        ? 'text-amber-500'
        : highlight === 'blue'
          ? 'text-blue-400'
          : highlight === 'red'
            ? 'text-red-400'
            : 'text-surface-900';

  return (
    <div
      className={`flex items-center gap-3 py-2 ${indent ? 'pl-6' : ''} border-b border-border/30 last:border-0`}
    >
      {line && (
        <span className="text-[10px] font-semibold text-surface-500 w-5 flex-shrink-0 tabular-nums">
          {line}.
        </span>
      )}
      <div className="flex-1 flex items-center gap-1.5">
        <span className="text-[13px] text-surface-700">{label}</span>
        {tooltip && (
          <div className="relative">
            <button
              onMouseEnter={() => setShowTip(true)}
              onMouseLeave={() => setShowTip(false)}
              className="text-surface-400 hover:text-surface-600"
            >
              <Info className="w-3 h-3" />
            </button>
            {showTip && (
              <div className="absolute left-0 bottom-5 z-20 w-64 p-2 text-[11px] text-surface-800 bg-surface-100 border border-border rounded-lg shadow-lg">
                {tooltip}
              </div>
            )}
          </div>
        )}
      </div>
      {editable && onInputChange ? (
        <div className="relative w-36">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-500 text-sm">
            $
          </span>
          <input
            type="text"
            inputMode="numeric"
            value={inputValue ?? ''}
            onChange={(e) => onInputChange(e.target.value)}
            onBlur={(e) => onInputBlur?.(e.target.value)}
            className="w-full pl-6 pr-2 py-1 text-[13px] font-mono text-right bg-surface-200/60 border border-border rounded-lg focus:outline-none focus:border-accent-400 text-surface-900"
          />
        </div>
      ) : (
        <span className={`text-[13px] font-mono font-semibold ${colorClass} w-36 text-right`}>
          {value}
        </span>
      )}
    </div>
  );
}

function ScheduleCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="glass-card rounded-xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-border/50 bg-surface-100/30">
        <p className="text-[13px] font-semibold text-surface-900">{title}</p>
        {subtitle && <p className="text-[11px] text-surface-500 mt-0.5">{subtitle}</p>}
      </div>
      <div className="px-5 py-3">{children}</div>
    </div>
  );
}

// ─── Main View ────────────────────────────────────────────────────────────────

export function TnTaxView() {
  const { selectedEntity, selectedYear, scannedDocuments, entities } = useAppContext();

  const entityConfig = entities.find((e) => e.id === selectedEntity);

  // ── Derive base numbers from scanned docs ──────────────────────────────────

  const derived = useMemo(() => {
    const invoiceDocs = scannedDocuments.filter(
      (d) => d.type === 'invoice' && d.entity === selectedEntity
    );
    const invoiceTotal = invoiceDocs.reduce((sum, doc) => {
      const data = doc.parsedData as Record<string, unknown> | undefined;
      return sum + Number(data?.amount || data?.totalAmount || data?.total || 0);
    }, 0);

    const bankDocs = scannedDocuments.filter(
      (d) => d.type === 'bank-statement' && d.entity === selectedEntity
    );
    const bankDepositsTotal = bankDocs.reduce((sum, doc) => {
      const data = doc.parsedData as Record<string, unknown> | undefined;
      return sum + Number(data?.totalDeposits || 0);
    }, 0);

    const expenseDocs = scannedDocuments.filter(
      (d) =>
        (d.type === 'receipt' || d.filePath?.toLowerCase().includes('/expenses/')) &&
        d.entity === selectedEntity &&
        d.tracked
    );
    let totalDeductible = 0;
    expenseDocs.forEach((doc) => {
      const data = doc.parsedData as Record<string, unknown> | undefined;
      if (!data) return;
      let cat = data.category as ExpenseCategory | undefined;
      if (!cat && doc.filePath) {
        const lp = doc.filePath.toLowerCase();
        if (lp.includes('/equipment/')) cat = 'equipment';
        else if (lp.includes('/software/')) cat = 'software';
        else if (lp.includes('/meals/')) cat = 'meals';
        else if (lp.includes('/childcare/')) cat = 'childcare';
        else if (lp.includes('/medical/')) cat = 'medical';
        else if (lp.includes('/travel/')) cat = 'travel';
      }
      const catConfig = EXPENSE_CATEGORIES.find((c) => c.id === cat);
      if (!catConfig) return;
      let amount = 0;
      if (typeof data.amount === 'number') amount = data.amount;
      else if (typeof data.totalAmount === 'number') amount = data.totalAmount;
      else if (typeof data.total === 'number') amount = data.total;
      totalDeductible += amount * catConfig.deductionRate;
    });

    const decMonth = `${selectedYear}-12`;
    let decBankBalance = 0;
    let decCcBalance = 0;
    scannedDocuments.forEach((doc) => {
      if (doc.entity !== selectedEntity) return;
      const data = doc.parsedData as Record<string, unknown> | undefined;
      if (!data) return;
      const endDate = (data.endDate as string) || '';
      const periodLabel = ((data.periodLabel as string) || '').toLowerCase();
      const isDec = endDate.startsWith(decMonth) || periodLabel.includes('december');
      if (!isDec) return;
      const ending = Number(data.endingBalance || 0);
      if (doc.type === 'bank-statement') decBankBalance += ending;
      else if (doc.type === 'credit-card-statement') decCcBalance += ending;
    });

    const gross = bankDepositsTotal > 0 ? bankDepositsTotal : invoiceTotal;

    return { gross, totalDeductible, decBankBalance, decCcBalance };
  }, [scannedDocuments, selectedEntity, selectedYear]);

  // ── Editable inputs ────────────────────────────────────────────────────────
  // User overrides take precedence; derived values flow through until user edits

  const [userEdits, setUserEdits] = useState<Record<string, string>>({});
  const [affiliatedDebtInput, setAffiliatedDebtInput] = useState('0.00');

  const grossInput = userEdits.gross ?? derived.gross.toFixed(2);
  const expensesInput = userEdits.expenses ?? derived.totalDeductible.toFixed(2);
  const bankInput =
    userEdits.bank ?? (derived.decBankBalance > 0 ? derived.decBankBalance.toFixed(2) : '0.00');
  const ccInput =
    userEdits.cc ?? (derived.decCcBalance > 0 ? derived.decCcBalance.toFixed(2) : '0.00');

  const setGrossInput = (v: string) => setUserEdits((p) => ({ ...p, gross: v }));
  const setExpensesInput = (v: string) => setUserEdits((p) => ({ ...p, expenses: v }));
  const setBankInput = (v: string) => setUserEdits((p) => ({ ...p, bank: v }));
  const setCcInput = (v: string) => setUserEdits((p) => ({ ...p, cc: v }));

  // ── Business assets ────────────────────────────────────────────────────────

  const assetsKey = `docvault-biz-assets-${selectedEntity}-${selectedYear}`;
  const [bizAssets, setBizAssets] = useState<BusinessAsset[]>(() => {
    try {
      const s = localStorage.getItem(assetsKey);
      return s ? (JSON.parse(s) as BusinessAsset[]) : [];
    } catch {
      return [];
    }
  });
  const [addAssetName, setAddAssetName] = useState('');
  const [addAssetValue, setAddAssetValue] = useState('');

  useEffect(() => {
    localStorage.setItem(assetsKey, JSON.stringify(bizAssets));
  }, [bizAssets, assetsKey]);

  // ── Calculations ───────────────────────────────────────────────────────────

  const calc = useMemo(() => {
    const gross = parseNum(grossInput);
    const expenses = parseNum(expensesInput);
    const netProfit = Math.max(0, gross - expenses);

    // Schedule H
    const schH1 = gross;

    // Schedule J (Excise)
    const exciseTaxable = Math.max(0, netProfit - TN_EXCISE_DEDUCTION);
    const exciseTax = exciseTaxable * TN_EXCISE_RATE;

    // Schedule F1 (Franchise / Net Worth)
    const bankBalance = parseNum(bankInput);
    const ccBalance = parseNum(ccInput);
    const totalAssets = bizAssets.reduce((s, a) => s + a.value, 0);
    const netWorth = Math.max(0, bankBalance - ccBalance + totalAssets);
    const affiliatedDebt = parseNum(affiliatedDebtInput);
    const f1Line1 = netWorth;
    const f1Line2 = affiliatedDebt;
    const f1Line3 = f1Line1 + f1Line2;
    const f1Line4 = 1.0; // 100% TN apportionment
    const f1Line5 = f1Line3 * f1Line4;

    const franchiseTaxBase = Math.max(0, f1Line5 - TN_FRANCHISE_EXEMPTION);
    const franchiseTax = Math.max(TN_FRANCHISE_MIN, franchiseTaxBase * TN_FRANCHISE_RATE);

    const totalTax = exciseTax + franchiseTax;
    const totalOwed = totalTax + TN_SOS_FEE;

    return {
      gross,
      expenses,
      netProfit,
      schH1,
      exciseTaxable,
      exciseTax,
      bankBalance,
      ccBalance,
      totalAssets,
      netWorth,
      f1Line1,
      f1Line2,
      f1Line3,
      f1Line5,
      franchiseTaxBase,
      franchiseTax,
      totalTax,
      totalOwed,
    };
  }, [grossInput, expensesInput, bankInput, ccInput, affiliatedDebtInput, bizAssets]);

  // ── Guard: not a TN tax entity ─────────────────────────────────────────────

  if (entityConfig?.type !== 'tax' || selectedEntity === 'all' || selectedEntity === 'personal') {
    return (
      <div className="max-w-3xl mx-auto px-4 md:px-6 py-12 text-center">
        <p className="text-surface-600 text-sm">
          TN F&amp;E Tax Planner is only available for LLC tax entities.
        </p>
      </div>
    );
  }

  const blurFmt = (setter: (v: string) => void) => (v: string) => setter(parseNum(v).toFixed(2));

  function addAsset() {
    if (!addAssetName || !addAssetValue) return;
    setBizAssets((prev) => [
      ...prev,
      { id: crypto.randomUUID(), name: addAssetName, value: parseNum(addAssetValue) },
    ]);
    setAddAssetName('');
    setAddAssetValue('');
  }

  return (
    <div className="max-w-4xl mx-auto px-4 md:px-6 py-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-surface-950">TN Franchise &amp; Excise Tax</h1>
          <p className="text-[12px] text-surface-600 mt-0.5">
            {entityConfig?.name} · {selectedYear} · FAE170 Return
          </p>
        </div>
        <a
          href="https://tntap.tn.gov"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-surface-700 hover:text-surface-950 bg-surface-200/50 hover:bg-surface-200 border border-border rounded-lg transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Open TNTAP
        </a>
      </div>

      {/* Data notice if December statement not parsed */}
      {derived.decBankBalance === 0 && (
        <div className="text-[11px] text-amber-600 bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-2.5">
          December bank/CC statement not yet parsed — bank balance and CC balance defaulting to $0.
          Re-parse your December statements to auto-populate.
        </div>
      )}

      {/* Schedule H */}
      <ScheduleCard
        title="Schedule H — Gross Receipts"
        subtitle="From federal income tax return (Schedule C, Line 1)"
      >
        <Field
          line="1"
          label="Gross receipts or sales"
          editable
          inputValue={grossInput}
          onInputChange={setGrossInput}
          onInputBlur={blurFmt(setGrossInput)}
          tooltip="Total gross receipts or sales per federal income tax return. Use bank deposits (cash basis) or invoice total."
        />
      </ScheduleCard>

      {/* Schedule J — Excise Tax */}
      <ScheduleCard
        title="Schedule J — Excise Tax"
        subtitle="Net earnings × 6.5% (after $50k standard deduction, TY2024+)"
      >
        <Field
          line="1"
          label="Net earnings (gross − expenses)"
          editable
          inputValue={expensesInput}
          onInputChange={setExpensesInput}
          onInputBlur={blurFmt(setExpensesInput)}
          tooltip="Business expenses (Schedule C deductions). Net earnings = gross − expenses."
        />
        <Field label="Gross receipts" value={fmt(calc.gross)} indent />
        <Field label="Less: expenses" value={`− ${fmt(calc.expenses)}`} indent highlight="red" />
        <Field label="Net earnings" value={fmt(calc.netProfit)} highlight="blue" />
        <Field
          label="Less: standard deduction (TY2024+)"
          value={`− ${fmt(TN_EXCISE_DEDUCTION)}`}
          indent
          highlight="green"
          tooltip="TN Works Tax Act: $50,000 standard deduction from net earnings before computing excise tax"
        />
        <Field label="Taxable net earnings" value={fmt(calc.exciseTaxable)} />
        <Field label="Excise Tax (6.5%)" value={fmt(calc.exciseTax)} highlight="amber" />
      </ScheduleCard>

      {/* Schedule F1 — Franchise Tax */}
      <ScheduleCard
        title="Schedule F1 — Non-consolidated Net Worth"
        subtitle="Franchise tax basis — enter ending balance inputs below"
      >
        {/* Net worth build-up */}
        <div className="mb-3 pb-3 border-b border-border/50">
          <p className="text-[10px] font-semibold text-surface-500 uppercase tracking-wider mb-2">
            Net Worth Components (Dec 31)
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] text-surface-500 mb-1">
                Bank Balance{derived.decBankBalance > 0 ? ' ↑ from Dec statement' : ''}
              </label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-500 text-sm">
                  $
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={bankInput}
                  onChange={(e) => setBankInput(e.target.value)}
                  onBlur={(e) => setBankInput(parseNum(e.target.value).toFixed(2))}
                  className="w-full pl-6 pr-2 py-1.5 text-[13px] font-mono bg-surface-200/50 border border-border rounded-lg focus:outline-none focus:border-accent-400 text-surface-900"
                />
              </div>
            </div>
            <div>
              <label className="block text-[10px] text-surface-500 mb-1">
                CC Balance Owed{derived.decCcBalance > 0 ? ' ↑ from Dec statement' : ''}
              </label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-500 text-sm">
                  $
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={ccInput}
                  onChange={(e) => setCcInput(e.target.value)}
                  onBlur={(e) => setCcInput(parseNum(e.target.value).toFixed(2))}
                  className="w-full pl-6 pr-2 py-1.5 text-[13px] font-mono bg-surface-200/50 border border-border rounded-lg focus:outline-none focus:border-accent-400 text-surface-900"
                />
              </div>
            </div>
          </div>

          {/* Business assets */}
          <div className="mt-3">
            <p className="text-[10px] text-surface-500 mb-1.5">Business Assets (FMV)</p>
            {bizAssets.length > 0 && (
              <div className="space-y-1 mb-2">
                {bizAssets.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between py-1 px-2 rounded-lg hover:bg-surface-300/20 group"
                  >
                    <span className="text-[12px] text-surface-700">{a.name}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-[12px] font-mono text-surface-900">{fmt(a.value)}</span>
                      <button
                        onClick={() => setBizAssets((prev) => prev.filter((x) => x.id !== a.id))}
                        className="opacity-0 group-hover:opacity-100 text-surface-500 hover:text-red-400 transition-all"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                value={addAssetName}
                onChange={(e) => setAddAssetName(e.target.value)}
                placeholder="e.g. MacBook Pro, Test Phone"
                className="flex-1 px-2.5 py-1.5 text-[12px] bg-surface-200/50 border border-border rounded-lg focus:outline-none focus:border-accent-400 text-surface-900"
              />
              <div className="relative w-28">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-500 text-sm">
                  $
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={addAssetValue}
                  onChange={(e) => setAddAssetValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addAsset();
                  }}
                  placeholder="0"
                  className="w-full pl-6 pr-2 py-1.5 text-[12px] font-mono bg-surface-200/50 border border-border rounded-lg focus:outline-none focus:border-accent-400 text-surface-900"
                />
              </div>
              <button
                onClick={addAsset}
                disabled={!addAssetName || !addAssetValue}
                className="flex items-center gap-1 px-2.5 py-1.5 text-[12px] font-medium bg-accent-500 hover:bg-accent-600 disabled:opacity-40 text-white rounded-lg transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </button>
            </div>
          </div>
        </div>

        {/* Schedule F1 lines */}
        <Field
          line="1"
          label="Net Worth (assets − liabilities)"
          value={fmt(calc.f1Line1)}
          highlight="blue"
          tooltip="Bank balance + business assets − CC balance. Total assets less total liabilities per books."
        />
        <div className={`flex items-center gap-3 py-2 border-b border-border/30`}>
          <span className="text-[10px] font-semibold text-surface-500 w-5 flex-shrink-0">2.</span>
          <div className="flex-1 flex items-center gap-1.5">
            <span className="text-[13px] text-surface-700">Indebtedness to parent/affiliated</span>
            <div className="relative group">
              <Info className="w-3 h-3 text-surface-400" />
              <div className="absolute left-0 bottom-5 z-20 w-64 p-2 text-[11px] text-surface-800 bg-surface-100 border border-border rounded-lg shadow-lg hidden group-hover:block">
                Indebtedness to or guaranteed by parent or affiliated corporation. $0 for a
                standalone LLC.
              </div>
            </div>
          </div>
          <div className="relative w-36">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-500 text-sm">
              $
            </span>
            <input
              type="text"
              inputMode="numeric"
              value={affiliatedDebtInput}
              onChange={(e) => setAffiliatedDebtInput(e.target.value)}
              onBlur={(e) => setAffiliatedDebtInput(parseNum(e.target.value).toFixed(2))}
              className="w-full pl-6 pr-2 py-1 text-[13px] font-mono text-right bg-surface-200/60 border border-border rounded-lg focus:outline-none focus:border-accent-400 text-surface-900"
            />
          </div>
        </div>
        <Field line="3" label="Total (Line 1 + Line 2)" value={fmt(calc.f1Line3)} />
        <Field
          line="4"
          label="Ratio"
          value="100%"
          highlight="green"
          tooltip="Apportionment ratio. 100% for a Tennessee-only business."
        />
        <Field
          line="5"
          label="Taxable base → Schedule A, Line 1"
          value={fmt(calc.f1Line5)}
          highlight="blue"
          tooltip="Enter this amount on Schedule A, Line 1."
        />
        <Field
          label="Less: $500k exemption (TY2024+)"
          value={`− ${fmt(TN_FRANCHISE_EXEMPTION)}`}
          indent
          highlight="green"
          tooltip="TN Works Tax Act: $500,000 standard exemption against franchise tax base"
        />
        <Field
          label="Franchise Tax (0.25%, min $100)"
          value={fmt(calc.franchiseTax)}
          highlight="amber"
        />
      </ScheduleCard>

      {/* Summary */}
      <ScheduleCard title="Total Owed" subtitle={`${selectedYear} TN F&E Filing (FAE170)`}>
        <Field label="Excise Tax (Schedule J)" value={fmt(calc.exciseTax)} highlight="amber" />
        <Field
          label="Franchise Tax (Schedule F1)"
          value={fmt(calc.franchiseTax)}
          highlight="amber"
        />
        <Field
          label="SOS Annual Report Fee"
          value={fmt(TN_SOS_FEE)}
          indent
          tooltip="Tennessee Secretary of State annual report filing fee for domestic LLCs. Due April 1."
        />
        <Field label="Total Owed" value={fmt(calc.totalOwed)} highlight="amber" />
        <div className="mt-3 text-[11px] text-surface-500">
          Due: 15th day of 4th month after fiscal year end (April 15 for calendar-year filers)
        </div>
      </ScheduleCard>
    </div>
  );
}
