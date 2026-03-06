import { useMemo, useState, useEffect, useRef } from 'react';
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
  prefix?: string;
  suffix?: string;
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
  prefix = '$',
  suffix,
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
        <span className="text-[10px] font-semibold text-surface-500 w-7 flex-shrink-0 tabular-nums">
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
          {prefix && (
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-500 text-sm">
              {prefix}
            </span>
          )}
          <input
            type="text"
            inputMode="numeric"
            value={inputValue ?? ''}
            onChange={(e) => onInputChange(e.target.value)}
            onBlur={(e) => onInputBlur?.(e.target.value)}
            className={`w-full ${prefix ? 'pl-6' : 'pl-2'} ${suffix ? 'pr-6' : 'pr-2'} py-1 text-[13px] font-mono text-right bg-surface-200/60 border border-border rounded-lg focus:outline-none focus:border-accent-400 text-surface-900`}
          />
          {suffix && (
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-surface-500 text-sm">
              {suffix}
            </span>
          )}
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

  // Schedule J-2 inputs (Net Earnings for SMLLC filing as individual)
  const [j2Line2, setJ2Line2] = useState('0.00'); // Schedule D
  const [j2Line3, setJ2Line3] = useState('0.00'); // Schedule E
  const [j2Line4, setJ2Line4] = useState('0.00'); // Schedule F
  const [j2Line5, setJ2Line5] = useState('0.00'); // Form 4797
  const [j2Line6, setJ2Line6] = useState('0.00'); // Other
  const [j2Line6Form, setJ2Line6Form] = useState('');
  const [j2Line6Schedule, setJ2Line6Schedule] = useState('');
  const [j2Line8Override, setJ2Line8Override] = useState<string | null>(null); // null = auto-calc

  // Schedule J inputs (full 39-line form) — record-based to avoid 30+ useState calls
  const [schJ, setSchJ] = useState<Record<string, string>>({});
  const jVal = (line: string) => schJ[line] ?? '0.00';
  const setJVal = (line: string) => (v: string) => setSchJ((p) => ({ ...p, [line]: v }));

  // Schedule D — Credits (lines 1-9 editable, 10 computed)
  const [schDCredits, setSchDCredits] = useState<Record<string, string>>({});
  const dVal = (line: string) => schDCredits[line] ?? '0.00';
  const setDVal = (line: string) => (v: string) => setSchDCredits((p) => ({ ...p, [line]: v }));

  // Schedule E — Payments (lines 1, 2a-5b, 6 editable, 7 computed)
  const [schEPay, setSchEPay] = useState<Record<string, string>>({});
  const eVal = (line: string) => schEPay[line] ?? '0.00';
  const setEVal = (line: string) => (v: string) => setSchEPay((p) => ({ ...p, [line]: v }));

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

  // ── Business assets (server-persisted, entity-scoped) ─────────────────────

  const [bizAssets, setBizAssets] = useState<BusinessAsset[]>([]);
  const assetsLoadedRef = useRef(false);
  const [addAssetName, setAddAssetName] = useState('');
  const [addAssetValue, setAddAssetValue] = useState('');

  // Load assets from server when entity changes
  useEffect(() => {
    if (selectedEntity === 'all' || selectedEntity === 'personal') return;
    assetsLoadedRef.current = false;
    fetch(`/api/assets/${selectedEntity}`)
      .then((r) => r.json())
      .then((data) => {
        setBizAssets(data.assets || []);
        assetsLoadedRef.current = true;
      })
      .catch(() => {
        assetsLoadedRef.current = true;
      });
  }, [selectedEntity]);

  // Save assets to server when they change (skip initial load)
  useEffect(() => {
    if (!assetsLoadedRef.current) return;
    fetch(`/api/assets/${selectedEntity}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assets: bizAssets }),
    }).catch(() => {});
  }, [bizAssets, selectedEntity]);

  // ── Calculations ───────────────────────────────────────────────────────────

  const calc = useMemo(() => {
    const gross = parseNum(grossInput);
    const expenses = parseNum(expensesInput);
    const netProfit = Math.max(0, gross - expenses);
    const p = (line: string, src: Record<string, string>) => parseNum(src[line] ?? '0');

    // Schedule H
    const schH1 = gross;

    // Schedule J-2 (Net Earnings for SMLLC)
    const j2L1 = netProfit;
    const j2L2 = parseNum(j2Line2);
    const j2L3 = parseNum(j2Line3);
    const j2L4 = parseNum(j2Line4);
    const j2L5 = parseNum(j2Line5);
    const j2L6 = parseNum(j2Line6);
    const j2L7 = j2L1 + j2L2 + j2L3 + j2L4 + j2L5 + j2L6;
    const j2L8 = j2Line8Override !== null ? parseNum(j2Line8Override) : Math.max(0, j2L7);
    const j2L9 = Math.max(0, j2L7 - j2L8);

    // ── Schedule J (full 39-line) ──────────────────────────────────────────────
    const jL1 = j2L9; // from J-2 Line 9
    // Additions (lines 2-14)
    const jL2 = p('2', schJ);
    const jL3 = p('3', schJ);
    const jL4 = p('4', schJ);
    const jL5 = p('5', schJ);
    const jL6 = p('6', schJ);
    const jL7 = p('7', schJ);
    const jL8 = p('8', schJ);
    const jL9 = p('9', schJ);
    const jL10 = p('10', schJ);
    const jL11 = p('11', schJ);
    const jL12 = p('12', schJ);
    const jL13 = p('13', schJ);
    const jL14 = p('14', schJ);
    const jL15 = jL2 + jL3 + jL4 + jL5 + jL6 + jL7 + jL8 + jL9 + jL10 + jL11 + jL12 + jL13 + jL14;
    // Deductions (lines 16-29)
    const jL16 = p('16', schJ);
    const jL17 = p('17', schJ);
    const jL18 = p('18', schJ);
    const jL19 = p('19', schJ);
    const jL20 = p('20', schJ);
    const jL21 = p('21', schJ);
    const jL22 = p('22', schJ);
    const jL23 = p('23', schJ);
    const jL24 = p('24', schJ);
    const jL25 = p('25', schJ);
    const jL26 = p('26', schJ);
    const jL27 = p('27', schJ);
    const jL28a = p('28a', schJ);
    const jL28b = p('28b', schJ);
    const jL29 = p('29', schJ);
    const jL30 =
      jL16 +
      jL17 +
      jL18 +
      jL19 +
      jL20 +
      jL21 +
      jL22 +
      jL23 +
      jL24 +
      jL25 +
      jL26 +
      jL27 +
      jL28a +
      jL29; // excludes 28b
    // Computation
    const jL31 = jL1 + jL15 - jL30;
    const jL32 = jL31 > 0 ? Math.min(jL31, TN_EXCISE_DEDUCTION) : 0;
    const jL33 = p('33', schJ);
    const jL34 = jL31 - jL32 + jL33;
    const jL35 = schJ['35'] ? parseNum(schJ['35']) / 100 : 1.0; // entered as percentage
    const jL36 = jL34 * jL35;
    const jL37 = p('37', schJ);
    const jL38 = p('38', schJ);
    const jL39 = jL36 + jL37 - jL38;

    const exciseTax = Math.max(0, jL39) * TN_EXCISE_RATE;

    // ── Schedule D — Credits ───────────────────────────────────────────────────
    const dLines = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => p(String(n), schDCredits));
    const dL10 = dLines.reduce((s, v) => s + v, 0);

    // ── Schedule E — Payments ──────────────────────────────────────────────────
    const eL1 = p('1', schEPay);
    const eL2b = p('2b', schEPay);
    const eL3b = p('3b', schEPay);
    const eL4b = p('4b', schEPay);
    const eL5b = p('5b', schEPay);
    const eL6 = p('6', schEPay);
    const eL7 = eL1 + eL2b + eL3b + eL4b + eL5b + eL6;

    // ── Schedule F1 (Franchise / Net Worth) ────────────────────────────────────
    const bankBalance = parseNum(bankInput);
    const ccBalance = parseNum(ccInput);
    const totalAssets = bizAssets.reduce((s, a) => s + a.value, 0);
    const netWorth = Math.max(0, bankBalance - ccBalance + totalAssets);
    const affiliatedDebt = parseNum(affiliatedDebtInput);
    const f1Line1 = netWorth;
    const f1Line2 = affiliatedDebt;
    const f1Line3 = f1Line1 + f1Line2;
    const f1Line5 = f1Line3 * 1.0; // 100% TN apportionment
    const franchiseTaxBase = Math.max(0, f1Line5 - TN_FRANCHISE_EXEMPTION);
    const franchiseTax = Math.max(TN_FRANCHISE_MIN, franchiseTaxBase * TN_FRANCHISE_RATE);

    // ── Totals ─────────────────────────────────────────────────────────────────
    const totalTax = exciseTax + franchiseTax;
    const totalCredits = dL10;
    const netTax = Math.max(0, totalTax - totalCredits);
    const totalOwed = netTax + TN_SOS_FEE;
    const totalPayments = eL7;
    const balanceDue = Math.max(0, totalOwed - totalPayments);
    const overpayment = Math.max(0, totalPayments - totalOwed);

    return {
      gross,
      expenses,
      netProfit,
      schH1,
      j2L1,
      j2L2,
      j2L3,
      j2L4,
      j2L5,
      j2L6,
      j2L7,
      j2L8,
      j2L9,
      // Schedule J
      jL1,
      jL2,
      jL3,
      jL4,
      jL5,
      jL6,
      jL7,
      jL8,
      jL9,
      jL10,
      jL11,
      jL12,
      jL13,
      jL14,
      jL15,
      jL16,
      jL17,
      jL18,
      jL19,
      jL20,
      jL21,
      jL22,
      jL23,
      jL24,
      jL25,
      jL26,
      jL27,
      jL28a,
      jL28b,
      jL29,
      jL30,
      jL31,
      jL32,
      jL33,
      jL34,
      jL35,
      jL36,
      jL37,
      jL38,
      jL39,
      exciseTax,
      // Schedule D
      dLines,
      dL10,
      // Schedule E
      eL1,
      eL2b,
      eL3b,
      eL4b,
      eL5b,
      eL6,
      eL7,
      // Franchise
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
      // Summary
      totalTax,
      totalCredits,
      netTax,
      totalOwed,
      totalPayments,
      balanceDue,
      overpayment,
    };
  }, [
    grossInput,
    expensesInput,
    bankInput,
    ccInput,
    affiliatedDebtInput,
    bizAssets,
    j2Line2,
    j2Line3,
    j2Line4,
    j2Line5,
    j2Line6,
    j2Line8Override,
    schJ,
    schDCredits,
    schEPay,
  ]);

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
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: addAssetName,
        value: parseNum(addAssetValue),
      },
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

      {/* Schedule C Summary — feeds J-2 Line 1 */}
      <ScheduleCard
        title="Schedule C — Net Profit"
        subtitle="Federal Schedule C summary (feeds Schedule J-2, Line 1)"
      >
        <Field label="Gross receipts (Schedule H)" value={fmt(calc.gross)} />
        <Field
          label="Total expenses"
          editable
          inputValue={expensesInput}
          onInputChange={setExpensesInput}
          onInputBlur={blurFmt(setExpensesInput)}
          tooltip="Business expenses (Schedule C deductions). Includes all deductible business expenses."
        />
        <Field label="Net profit (Line 31)" value={fmt(calc.netProfit)} highlight="blue" />
      </ScheduleCard>

      {/* Schedule J-2 — Net Earnings for SMLLC */}
      <ScheduleCard
        title="Schedule J-2 — Net Earnings (SMLLC)"
        subtitle="Computation of Net Earnings for a Single Member LLC Filing as an Individual"
      >
        <p className="text-[10px] font-semibold text-surface-500 uppercase tracking-wider mb-1">
          Additions
        </p>
        <Field
          line="1"
          label="Business Income from Schedule C"
          value={fmt(calc.j2L1)}
          highlight="blue"
          tooltip="Net profit from Form 1040 Schedule C (gross receipts − business expenses). Auto-calculated from gross receipts and expenses above."
        />
        <Field
          line="2"
          label="Business Income from Schedule D"
          editable
          inputValue={j2Line2}
          onInputChange={setJ2Line2}
          onInputBlur={blurFmt(setJ2Line2)}
          tooltip="Capital gains/losses from Form 1040, Schedule D attributable to the LLC."
        />
        <Field
          line="3"
          label="Business Income from Schedule E"
          editable
          inputValue={j2Line3}
          onInputChange={setJ2Line3}
          onInputBlur={blurFmt(setJ2Line3)}
          tooltip="Rental, royalty, partnership, or S-corp income from Form 1040, Schedule E."
        />
        <Field
          line="4"
          label="Business Income from Schedule F"
          editable
          inputValue={j2Line4}
          onInputChange={setJ2Line4}
          onInputBlur={blurFmt(setJ2Line4)}
          tooltip="Farm income from Form 1040, Schedule F."
        />
        <Field
          line="5"
          label="Business Income from Form 4797"
          editable
          inputValue={j2Line5}
          onInputChange={setJ2Line5}
          onInputBlur={blurFmt(setJ2Line5)}
          tooltip="Sales of business property (Form 4797)."
        />
        <div className="flex items-center gap-3 py-2 border-b border-border/30">
          <span className="text-[10px] font-semibold text-surface-500 w-5 flex-shrink-0 tabular-nums">
            6.
          </span>
          <div className="flex-1 flex flex-col gap-1">
            <span className="text-[13px] text-surface-700">Other Business Income</span>
            <div className="flex gap-2">
              <input
                type="text"
                value={j2Line6Form}
                onChange={(e) => setJ2Line6Form(e.target.value)}
                placeholder="Form #"
                className="w-20 px-2 py-1 text-[11px] bg-surface-200/50 border border-border rounded-lg focus:outline-none focus:border-accent-400 text-surface-900"
              />
              <input
                type="text"
                value={j2Line6Schedule}
                onChange={(e) => setJ2Line6Schedule(e.target.value)}
                placeholder="Schedule"
                className="w-20 px-2 py-1 text-[11px] bg-surface-200/50 border border-border rounded-lg focus:outline-none focus:border-accent-400 text-surface-900"
              />
            </div>
          </div>
          <div className="relative w-36">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-500 text-sm">
              $
            </span>
            <input
              type="text"
              inputMode="numeric"
              value={j2Line6}
              onChange={(e) => setJ2Line6(e.target.value)}
              onBlur={(e) => setJ2Line6(parseNum(e.target.value).toFixed(2))}
              className="w-full pl-6 pr-2 py-1 text-[13px] font-mono text-right bg-surface-200/60 border border-border rounded-lg focus:outline-none focus:border-accent-400 text-surface-900"
            />
          </div>
        </div>
        <Field line="7" label="Total (Lines 1 through 6)" value={fmt(calc.j2L7)} highlight="blue" />

        <div className="mt-2 mb-1">
          <p className="text-[10px] font-semibold text-surface-500 uppercase tracking-wider">
            Deductions
          </p>
        </div>
        <div className="flex items-center gap-3 py-2 border-b border-border/30">
          <span className="text-[10px] font-semibold text-surface-500 w-5 flex-shrink-0 tabular-nums">
            8.
          </span>
          <div className="flex-1 flex items-center gap-1.5">
            <span className="text-[13px] text-surface-700">
              Amount subject to SE taxes distributable to member
            </span>
            <div className="relative group">
              <Info className="w-3 h-3 text-surface-400" />
              <div className="absolute left-0 bottom-5 z-20 w-72 p-2 text-[11px] text-surface-800 bg-surface-100 border border-border rounded-lg shadow-lg hidden group-hover:block">
                Amount subject to self-employment taxes distributable or paid to the single member.
                If negative, enter zero. Default is Line 7 (full pass-through for SMLLC). Also
                include on Schedule K, Line 3.
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
              value={j2Line8Override ?? calc.j2L8.toFixed(2)}
              onChange={(e) => setJ2Line8Override(e.target.value)}
              onBlur={(e) => {
                const v = parseNum(e.target.value);
                if (Math.abs(v - calc.j2L7) < 0.01) {
                  setJ2Line8Override(null); // reset to auto
                } else {
                  setJ2Line8Override(v.toFixed(2));
                }
              }}
              className="w-full pl-6 pr-2 py-1 text-[13px] font-mono text-right bg-surface-200/60 border border-border rounded-lg focus:outline-none focus:border-accent-400 text-surface-900"
            />
          </div>
        </div>
        <Field
          line="9"
          label="Net Earnings → Schedule J, Line 1"
          value={fmt(calc.j2L9)}
          highlight={calc.j2L9 === 0 ? 'green' : 'amber'}
          tooltip="Line 7 less Line 8. This flows to Schedule J, Line 1 as the excise tax base."
        />
      </ScheduleCard>

      {/* Schedule J — Computation of Net Earnings Subject to Excise Tax */}
      <ScheduleCard
        title="Schedule J — Net Earnings Subject to Excise Tax"
        subtitle="Full computation (39 lines) — most lines $0 for a simple SMLLC"
      >
        <Field
          line="1"
          label="Federal income or loss (from Schedule J-2)"
          value={fmt(calc.jL1)}
          highlight="blue"
          tooltip="Enter amount from Schedule J-1, J-2, J-3, or J-4. For SMLLCs, this comes from J-2 Line 9."
        />

        <div className="mt-2 mb-1">
          <p className="text-[10px] font-semibold text-surface-500 uppercase tracking-wider">
            Additions
          </p>
        </div>
        <Field
          line="2"
          label="Intangible expenses to affiliated entity"
          editable
          inputValue={jVal('2')}
          onInputChange={setJVal('2')}
          onInputBlur={blurFmt(setJVal('2'))}
          tooltip="Intangible expenses paid, accrued or incurred to an affiliated business entity deducted for federal purposes."
        />
        <Field
          line="3"
          label="Depreciation (TN decoupled bonus, assets ≤ 12/31/2022)"
          editable
          inputValue={jVal('3')}
          onInputChange={setJVal('3')}
          onInputBlur={blurFmt(setJVal('3'))}
          tooltip="IRC §168 depreciation not permitted for excise tax due to TN decoupling from federal bonus depreciation for assets purchased on or before 12/31/2022."
        />
        <Field
          line="4"
          label="Gain on sale of asset within 12mo of distribution"
          editable
          inputValue={jVal('4')}
          onInputChange={setJVal('4')}
          onInputBlur={blurFmt(setJVal('4'))}
          tooltip="Gain on sale of asset sold within 12 months after distribution to a nontaxable entity."
        />
        <Field
          line="5"
          label="TN excise tax expense (federal)"
          editable
          inputValue={jVal('5')}
          onInputChange={setJVal('5')}
          onInputBlur={blurFmt(setJVal('5'))}
          tooltip="Tennessee excise tax expense to the extent reported for federal purposes."
        />
        <Field
          line="6"
          label="Gross premiums tax deducted federally"
          editable
          inputValue={jVal('6')}
          onInputChange={setJVal('6')}
          onInputBlur={blurFmt(setJVal('6'))}
          tooltip="Gross premiums tax deducted in determining federal income and used as an excise tax credit."
        />
        <Field
          line="7"
          label="Interest on state/local obligations"
          editable
          inputValue={jVal('7')}
          onInputChange={setJVal('7')}
          onInputBlur={blurFmt(setJVal('7'))}
          tooltip="Interest income on obligations of states and their political subdivisions, less allowable amortization."
        />
        <Field
          line="8"
          label="Depletion not based on cost recovery"
          editable
          inputValue={jVal('8')}
          onInputChange={setJVal('8')}
          onInputBlur={blurFmt(setJVal('8'))}
        />
        <Field
          line="9"
          label="Excess FMV over book value of donated property"
          editable
          inputValue={jVal('9')}
          onInputChange={setJVal('9')}
          onInputBlur={blurFmt(setJVal('9'))}
        />
        <Field
          line="10"
          label="Excess rent to/from affiliate"
          editable
          inputValue={jVal('10')}
          onInputChange={setJVal('10')}
          onInputBlur={blurFmt(setJVal('10'))}
          tooltip="Paying excess rent → positive. Receiving excess rent (added back by affiliate) → negative."
        />
        <Field
          line="11"
          label="Net loss/expense from pass-through entity"
          editable
          inputValue={jVal('11')}
          onInputChange={setJVal('11')}
          onInputBlur={blurFmt(setJVal('11'))}
          tooltip="Net loss or expense received from a pass-through entity subject to excise tax."
        />
        <Field
          line="12"
          label="5% of IRC §951A GILTI deducted on Line 27"
          editable
          inputValue={jVal('12')}
          onInputChange={setJVal('12')}
          onInputBlur={blurFmt(setJVal('12'))}
          tooltip="Amount equal to 5% of IRC §951A global intangible low-taxed income deducted on Line 27."
        />
        <Field
          line="13"
          label="Business interest expense deducted"
          editable
          inputValue={jVal('13')}
          onInputChange={setJVal('13')}
          onInputBlur={blurFmt(setJVal('13'))}
          tooltip="Business interest expense deducted in arriving at the amount reported on Schedule J, Line 1."
        />
        <Field
          line="14"
          label="R&E expenditures deducted (IRC §174)"
          editable
          inputValue={jVal('14')}
          onInputChange={setJVal('14')}
          onInputBlur={blurFmt(setJVal('14'))}
          tooltip="Research and experimental expenditures deducted under IRC §174 in arriving at Schedule J, Line 1."
        />
        <Field
          line="15"
          label="Total additions (Lines 2–14)"
          value={fmt(calc.jL15)}
          highlight="blue"
        />

        <div className="mt-2 mb-1">
          <p className="text-[10px] font-semibold text-surface-500 uppercase tracking-wider">
            Deductions
          </p>
        </div>
        <Field
          line="16"
          label="Depreciation (TN decoupled, permitted)"
          editable
          inputValue={jVal('16')}
          onInputChange={setJVal('16')}
          onInputBlur={blurFmt(setJVal('16'))}
          tooltip="IRC §168 depreciation permitted for excise tax due to TN decoupling from federal bonus depreciation for assets purchased on or before 12/31/2022."
        />
        <Field
          line="17"
          label="Excess gain/loss from TN basis difference"
          editable
          inputValue={jVal('17')}
          onInputChange={setJVal('17')}
          onInputBlur={blurFmt(setJVal('17'))}
          tooltip="Excess gain (or loss) from basis adjustment resulting from TN decoupling from federal bonus depreciation for assets ≤ 12/31/2022."
        />
        <Field
          line="18"
          label="Dividends from 80%+ owned corporations"
          editable
          inputValue={jVal('18')}
          onInputChange={setJVal('18')}
          onInputBlur={blurFmt(setJVal('18'))}
        />
        <Field
          line="19"
          label="Donations to qualified school/nonprofit groups"
          editable
          inputValue={jVal('19')}
          onInputChange={setJVal('19')}
          onInputBlur={blurFmt(setJVal('19'))}
        />
        <Field
          line="20"
          label="Expenses not deducted federally (credit taken)"
          editable
          inputValue={jVal('20')}
          onInputChange={setJVal('20')}
          onInputBlur={blurFmt(setJVal('20'))}
          tooltip="Any expense other than income taxes, not deducted federally, for which a federal income tax credit was allowed."
        />
        <Field
          line="21"
          label="Safe harbor lease adjustments"
          editable
          inputValue={jVal('21')}
          onInputChange={setJVal('21')}
          onInputBlur={blurFmt(setJVal('21'))}
        />
        <Field
          line="22"
          label="Nonbusiness earnings (Schedule M, Line 8)"
          editable
          inputValue={jVal('22')}
          onInputChange={setJVal('22')}
          onInputBlur={blurFmt(setJVal('22'))}
        />
        <Field
          line="23"
          label="Intangible expenses to affiliated entity"
          editable
          inputValue={jVal('23')}
          onInputChange={setJVal('23')}
          onInputBlur={blurFmt(setJVal('23'))}
          tooltip="Intangible expenses paid, accrued or incurred to an affiliated entity (Form IE)."
        />
        <Field
          line="24"
          label="Intangible income from affiliate (not deducted)"
          editable
          inputValue={jVal('24')}
          onInputChange={setJVal('24')}
          onInputBlur={blurFmt(setJVal('24'))}
          tooltip="Intangible income from affiliated entity if the corresponding expenses have not been deducted by the affiliate under TCA §67-4-2006(b)(2)(N)."
        />
        <Field
          line="25"
          label="Net gain/income from pass-through entity"
          editable
          inputValue={jVal('25')}
          onInputChange={setJVal('25')}
          onInputBlur={blurFmt(setJVal('25'))}
          tooltip="Net gain or income received from a pass-through entity subject to excise tax."
        />
        <Field
          line="26"
          label="Deductible grants from governmental units"
          editable
          inputValue={jVal('26')}
          onInputChange={setJVal('26')}
          onInputBlur={blurFmt(setJVal('26'))}
        />
        <Field
          line="27"
          label="IRC §951A GILTI"
          editable
          inputValue={jVal('27')}
          onInputChange={setJVal('27')}
          onInputBlur={blurFmt(setJVal('27'))}
        />
        <Field
          line="28a"
          label="Business interest expense currently deductible"
          editable
          inputValue={jVal('28a')}
          onInputChange={setJVal('28a')}
          onInputBlur={blurFmt(setJVal('28a'))}
        />
        <Field
          line="28b"
          label="Business interest carryforward (future years)"
          editable
          inputValue={jVal('28b')}
          onInputChange={setJVal('28b')}
          onInputBlur={blurFmt(setJVal('28b'))}
          tooltip="Not included in Line 30 total — informational only for future year deductions."
        />
        <Field
          line="29"
          label="R&E expenditures currently deductible"
          editable
          inputValue={jVal('29')}
          onInputChange={setJVal('29')}
          onInputBlur={blurFmt(setJVal('29'))}
        />
        <Field
          line="30"
          label="Total deductions (Lines 16–29, excl. 28b)"
          value={fmt(calc.jL30)}
          highlight="blue"
        />

        <div className="mt-2 mb-1">
          <p className="text-[10px] font-semibold text-surface-500 uppercase tracking-wider">
            Computation of Taxable Income
          </p>
        </div>
        <Field
          line="31"
          label="Total business income (loss)"
          value={fmt(calc.jL31)}
          highlight={calc.jL31 < 0 ? 'red' : 'blue'}
          tooltip="Lines 1 + 15 − 30. If loss, enter on Schedule K, Line 1."
        />
        <Field
          line="32"
          label="Excise tax standard deduction"
          value={fmt(calc.jL32)}
          highlight="green"
          tooltip={`Lesser of Line 31 or $${TN_EXCISE_DEDUCTION.toLocaleString()}. If negative, enter zero. TN Works Tax Act standard deduction.`}
        />
        <Field
          line="33"
          label="Optional deduction addback"
          editable
          inputValue={jVal('33')}
          onInputChange={setJVal('33')}
          onInputBlur={blurFmt(setJVal('33'))}
          tooltip="Excise tax optional deduction addback (see instructions; attach schedule)."
        />
        <Field
          line="34"
          label="Adjusted total business income"
          value={fmt(calc.jL34)}
          tooltip="Line 31 − Line 32 + Line 33."
        />
        <Field
          line="35"
          label="Apportionment ratio"
          editable
          inputValue={schJ['35'] ?? '100'}
          onInputChange={setJVal('35')}
          prefix=""
          suffix="%"
          tooltip="From Schedules N, N1, O, P, or R. 100% for Tennessee-only business."
        />
        <Field
          line="36"
          label="Apportioned business income"
          value={fmt(calc.jL36)}
          tooltip="Line 34 × Line 35."
        />
        <Field
          line="37"
          label="Nonbusiness earnings allocated to TN"
          editable
          inputValue={jVal('37')}
          onInputChange={setJVal('37')}
          onInputBlur={blurFmt(setJVal('37'))}
          tooltip="From Schedule M, Line 11."
        />
        <Field
          line="38"
          label="Loss carryover from prior years"
          editable
          inputValue={jVal('38')}
          onInputChange={setJVal('38')}
          onInputBlur={blurFmt(setJVal('38'))}
          tooltip="From Schedule U."
        />
        <Field
          line="39"
          label="Subject to excise tax → Schedule B, Line 4"
          value={fmt(calc.jL39)}
          highlight={calc.jL39 <= 0 ? 'green' : 'amber'}
          tooltip="Line 36 + Line 37 − Line 38. This is the amount subject to 6.5% excise tax."
        />
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

      {/* Schedule D — Credits */}
      <ScheduleCard
        title="Schedule D — Schedule of Credits"
        subtitle="Credits against excise and franchise tax"
      >
        <Field
          line="1"
          label="Gross Premiums Tax Credit"
          editable
          inputValue={dVal('1')}
          onInputChange={setDVal('1')}
          onInputBlur={blurFmt(setDVal('1'))}
        />
        <Field
          line="2"
          label="Green Energy Tax Credit"
          editable
          inputValue={dVal('2')}
          onInputChange={setDVal('2')}
          onInputBlur={blurFmt(setDVal('2'))}
        />
        <Field
          line="3"
          label="Brownfield Property Credits"
          editable
          inputValue={dVal('3')}
          onInputChange={setDVal('3')}
          onInputBlur={blurFmt(setDVal('3'))}
        />
        <Field
          line="4"
          label="Broadband Internet Access Tax Credit"
          editable
          inputValue={dVal('4')}
          onInputChange={setDVal('4')}
          onInputBlur={blurFmt(setDVal('4'))}
        />
        <Field
          line="5"
          label="Industrial Machinery Credit (Schedule T)"
          editable
          inputValue={dVal('5')}
          onInputChange={setDVal('5')}
          onInputBlur={blurFmt(setDVal('5'))}
        />
        <Field
          line="6"
          label="Job Tax Credit (Schedule X)"
          editable
          inputValue={dVal('6')}
          onInputChange={setDVal('6')}
          onInputBlur={blurFmt(setDVal('6'))}
        />
        <Field
          line="7"
          label="Additional Annual Job Tax Credit (Schedule X, Line 38)"
          editable
          inputValue={dVal('7')}
          onInputChange={setDVal('7')}
          onInputBlur={blurFmt(setDVal('7'))}
        />
        <Field
          line="8"
          label="Qualified Production Credit"
          editable
          inputValue={dVal('8')}
          onInputChange={setDVal('8')}
          onInputBlur={blurFmt(setDVal('8'))}
        />
        <Field
          line="9"
          label="Employer Credit for Paid Family & Medical Leave"
          editable
          inputValue={dVal('9')}
          onInputChange={setDVal('9')}
          onInputBlur={blurFmt(setDVal('9'))}
        />
        <Field
          line="10"
          label="Total Credit → Schedule C, Line 9"
          value={fmt(calc.dL10)}
          highlight="green"
        />
      </ScheduleCard>

      {/* Schedule E — Payments */}
      <ScheduleCard
        title="Schedule E — Schedule of Payments"
        subtitle="Estimated payments and credits applied"
      >
        <Field
          line="1"
          label="Overpayment from previous year"
          editable
          inputValue={eVal('1')}
          onInputChange={setEVal('1')}
          onInputBlur={blurFmt(setEVal('1'))}
        />
        <div className="mt-1 mb-1">
          <p className="text-[10px] font-semibold text-surface-500 uppercase tracking-wider">
            Quarterly Estimates
          </p>
        </div>
        <Field
          line="2a"
          label="Q1 required installment"
          editable
          inputValue={eVal('2a')}
          onInputChange={setEVal('2a')}
          onInputBlur={blurFmt(setEVal('2a'))}
        />
        <Field
          line="2b"
          label="Q1 amount paid"
          editable
          inputValue={eVal('2b')}
          onInputChange={setEVal('2b')}
          onInputBlur={blurFmt(setEVal('2b'))}
        />
        <Field
          line="3a"
          label="Q2 required installment"
          editable
          inputValue={eVal('3a')}
          onInputChange={setEVal('3a')}
          onInputBlur={blurFmt(setEVal('3a'))}
        />
        <Field
          line="3b"
          label="Q2 amount paid"
          editable
          inputValue={eVal('3b')}
          onInputChange={setEVal('3b')}
          onInputBlur={blurFmt(setEVal('3b'))}
        />
        <Field
          line="4a"
          label="Q3 required installment"
          editable
          inputValue={eVal('4a')}
          onInputChange={setEVal('4a')}
          onInputBlur={blurFmt(setEVal('4a'))}
        />
        <Field
          line="4b"
          label="Q3 amount paid"
          editable
          inputValue={eVal('4b')}
          onInputChange={setEVal('4b')}
          onInputBlur={blurFmt(setEVal('4b'))}
        />
        <Field
          line="5a"
          label="Q4 required installment"
          editable
          inputValue={eVal('5a')}
          onInputChange={setEVal('5a')}
          onInputBlur={blurFmt(setEVal('5a'))}
        />
        <Field
          line="5b"
          label="Q4 amount paid"
          editable
          inputValue={eVal('5b')}
          onInputChange={setEVal('5b')}
          onInputBlur={blurFmt(setEVal('5b'))}
        />
        <Field
          line="6"
          label="Extension payment"
          editable
          inputValue={eVal('6')}
          onInputChange={setEVal('6')}
          onInputBlur={blurFmt(setEVal('6'))}
        />
        <Field
          line="7"
          label="Total payments → Schedule C, Line 11"
          value={fmt(calc.eL7)}
          highlight="green"
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
        <Field label="Gross Tax + Fee" value={fmt(calc.totalTax + TN_SOS_FEE)} />
        {calc.totalCredits > 0 && (
          <Field
            label="Less: Credits (Schedule D)"
            value={`− ${fmt(calc.totalCredits)}`}
            highlight="green"
          />
        )}
        <Field label="Total Owed" value={fmt(calc.totalOwed)} highlight="amber" />
        {calc.totalPayments > 0 && (
          <>
            <Field
              label="Less: Payments (Schedule E)"
              value={`− ${fmt(calc.totalPayments)}`}
              highlight="green"
            />
            {calc.balanceDue > 0 ? (
              <Field label="Balance Due" value={fmt(calc.balanceDue)} highlight="red" />
            ) : (
              <Field label="Overpayment" value={fmt(calc.overpayment)} highlight="green" />
            )}
          </>
        )}
        <div className="mt-3 text-[11px] text-surface-500">
          Due: 15th day of 4th month after fiscal year end (April 15 for calendar-year filers)
        </div>
      </ScheduleCard>
    </div>
  );
}
