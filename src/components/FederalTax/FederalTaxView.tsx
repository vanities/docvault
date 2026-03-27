import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Scale,
  ChevronDown,
  ChevronRight,
  Pencil,
  RotateCcw,
  Check,
  ChevronLeft,
  Settings2,
} from 'lucide-react';
import { useAppContext } from '../../contexts/AppContext';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FederalTaxFiled {
  filed: boolean;
  filedDate?: string;
  income: {
    wages: number;
    interestIncome: number;
    dividendIncome: number;
    businessIncome: number;
    rentalK1Income: number;
    capitalGains: number;
    taxableIRA: number;
    taxablePension: number;
    taxableSS: number;
    unemployment: number;
    otherIncome: number;
    totalIncome: number;
  };
  adjustments: {
    iraDeduction: number;
    educatorExpenses: number;
    hsaDeduction: number;
    studentLoanInterest: number;
    seTaxDeduction: number;
    sepDeduction: number;
    otherAdjustments: number;
    totalAdjustments: number;
  };
  agi: number;
  deductions: {
    standardOrItemized: number;
    qbiDeduction: number;
    totalDeductions: number;
  };
  taxableIncome: number;
  tax: {
    incomeTax: number;
    amt: number;
    seTax: number;
    additionalTaxQualifiedPlans: number;
    niit: number;
    totalTax: number;
  };
  credits: {
    foreignTaxCredit: number;
    childCareCredit: number;
    elderlyCredit: number;
    educationCredit: number;
    retirementSavingsCredit: number;
    childTaxCredit: number;
    totalCredits: number;
  };
  payments: {
    incomeTaxWithheld: number;
    eic: number;
    additionalChildTaxCredit: number;
    excessSocialSecurity: number;
    estimatedPayments: number;
    totalPayments: number;
  };
  balance: {
    amountOwed: number;
    underpaymentPenalty: number;
    totalOwed: number;
  };
}

interface ComputedData {
  wages: number;
  federalWithheld: number;
  businessIncome: number;
  capitalGains: number;
  dividendIncome: number;
  interestIncome: number;
  taxablePension: number;
  taxableIRA: number;
  k1Income: number;
  miscIncome: number;
  stakingIncome: number;
  otherIncome: number;
  totalIncome: number;
  seTax: number;
  seTaxDeduction: number;
  educatorExpenses: number;
  retirementDeduction: number;
  totalAdjustments: number;
  agi: number;
  totalCapitalGains: number; // Vanguard + crypto combined (matches filed Schedule D Line 16)
  standardDeduction: number;
  qbiDeduction: number;
  estimatedTaxableIncome: number;
  estimatedIncomeTax: number;
  niit: number;
  estimatedTotalTax: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(amount: number): string {
  const neg = amount < 0;
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.abs(amount));
  return neg ? `-${formatted}` : formatted;
}

function emptyFiled(): FederalTaxFiled {
  return {
    filed: false,
    income: {
      wages: 0,
      interestIncome: 0,
      dividendIncome: 0,
      businessIncome: 0,
      rentalK1Income: 0,
      capitalGains: 0,
      taxableIRA: 0,
      taxablePension: 0,
      taxableSS: 0,
      unemployment: 0,
      otherIncome: 0,
      totalIncome: 0,
    },
    adjustments: {
      iraDeduction: 0,
      educatorExpenses: 0,
      hsaDeduction: 0,
      studentLoanInterest: 0,
      seTaxDeduction: 0,
      sepDeduction: 0,
      otherAdjustments: 0,
      totalAdjustments: 0,
    },
    agi: 0,
    deductions: { standardOrItemized: 0, qbiDeduction: 0, totalDeductions: 0 },
    taxableIncome: 0,
    tax: { incomeTax: 0, amt: 0, seTax: 0, additionalTaxQualifiedPlans: 0, niit: 0, totalTax: 0 },
    credits: {
      foreignTaxCredit: 0,
      childCareCredit: 0,
      elderlyCredit: 0,
      educationCredit: 0,
      retirementSavingsCredit: 0,
      childTaxCredit: 0,
      totalCredits: 0,
    },
    payments: {
      incomeTaxWithheld: 0,
      eic: 0,
      additionalChildTaxCredit: 0,
      excessSocialSecurity: 0,
      estimatedPayments: 0,
      totalPayments: 0,
    },
    balance: { amountOwed: 0, underpaymentPenalty: 0, totalOwed: 0 },
  };
}

function getNestedValue(obj: FederalTaxFiled, path: string): number {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    cur = (cur as Record<string, unknown>)?.[p];
  }
  return (cur as number) ?? 0;
}

function setNestedValue(obj: FederalTaxFiled, path: string, value: number): FederalTaxFiled {
  const clone = JSON.parse(JSON.stringify(obj)) as FederalTaxFiled;
  const parts = path.split('.');
  let cur: Record<string, unknown> = clone as unknown as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    cur = cur[parts[i]] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
  return clone;
}

// Map financial-snapshot taxSummary to our computed fields
function mapSnapshotToComputed(snapshot: Record<string, unknown>): ComputedData | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const ts = snapshot.taxSummary as Record<string, unknown> | undefined;
  if (!ts) return null;

  const wages = (ts.wages as number) || 0;
  const businessIncome = (ts.scheduleCIncome as number) || 0;
  const capGains = ts.capitalGains as Record<string, number> | undefined;
  const capitalGains = capGains ? capGains.total || 0 : 0;
  const divs = ts.dividends as Record<string, number> | undefined;
  const dividendIncome = divs ? divs.ordinary || 0 : 0;
  const interestIncome = (ts.interestIncome as number) || 0;
  const taxablePension = (ts.taxablePension as number) || 0;
  const taxableIRA = (ts.taxableIRA as number) || 0;
  const k1Income = (ts.k1Income as number) || 0;
  const miscIncome = (ts.miscIncome as number) || 0;
  const stakingIncome = (ts.stakingIncome as number) || 0;
  const otherIncome = (ts.otherIncome as number) || 0;
  const totalIncome = (ts.estimatedTotalIncome as number) || 0;
  const seTax = (ts.seTax as number) || 0;
  const seTaxDeduction = (ts.seTaxDeduction as number) || 0;
  const educatorExpenses = (ts.educatorExpenses as number) || 0;
  const retirementDeduction = (ts.retirementDeduction as number) || 0;
  const totalAdjustments = (ts.estimatedAdjustments as number) || 0;
  const agi = (ts.estimatedAGI as number) || 0;
  const federalWithheld = (ts.federalWithheld as number) || 0;
  const cryptoGains = ts.cryptoCapitalGains as Record<string, number> | undefined;
  const totalCapitalGains = capitalGains + (cryptoGains ? cryptoGains.total || 0 : 0);
  const standardDeduction = (ts.standardDeduction as number) || 0;
  const qbiDeduction = (ts.qbiDeduction as number) || 0;
  const estimatedTaxableIncome = (ts.estimatedTaxableIncome as number) || 0;
  const estimatedIncomeTax = (ts.estimatedIncomeTax as number) || 0;
  const niit = (ts.niit as number) || 0;
  const estimatedTotalTax = (ts.estimatedTotalTax as number) || 0;

  // If no meaningful data, return null
  if (wages === 0 && businessIncome === 0 && capitalGains === 0 && totalIncome === 0) return null;

  return {
    wages,
    federalWithheld,
    businessIncome,
    capitalGains,
    dividendIncome,
    interestIncome,
    taxablePension,
    taxableIRA,
    k1Income,
    miscIncome,
    stakingIncome,
    otherIncome,
    totalIncome,
    seTax,
    seTaxDeduction,
    educatorExpenses,
    retirementDeduction,
    totalAdjustments,
    agi,
    totalCapitalGains,
    standardDeduction,
    qbiDeduction,
    estimatedTaxableIncome,
    estimatedIncomeTax,
    niit,
    estimatedTotalTax,
  };
}

// Which filed fields map to which computed fields (from financial-snapshot taxSummary)
const COMPUTED_FIELD_MAP: Record<string, keyof ComputedData> = {
  // Income
  'income.wages': 'wages',
  'income.interestIncome': 'interestIncome',
  'income.dividendIncome': 'dividendIncome',
  'income.businessIncome': 'businessIncome',
  'income.rentalK1Income': 'k1Income',
  'income.capitalGains': 'totalCapitalGains',
  'income.taxableIRA': 'taxableIRA',
  'income.taxablePension': 'taxablePension',
  'income.otherIncome': 'stakingIncome',
  'income.totalIncome': 'totalIncome',
  // Adjustments
  'adjustments.educatorExpenses': 'educatorExpenses',
  'adjustments.seTaxDeduction': 'seTaxDeduction',
  'adjustments.sepDeduction': 'retirementDeduction',
  'adjustments.totalAdjustments': 'totalAdjustments',
  // AGI
  agi: 'agi',
  // Deductions
  'deductions.standardOrItemized': 'standardDeduction',
  'deductions.qbiDeduction': 'qbiDeduction',
  // Taxable income
  taxableIncome: 'estimatedTaxableIncome',
  // Tax
  'tax.incomeTax': 'estimatedIncomeTax',
  'tax.seTax': 'seTax',
  'tax.niit': 'niit',
  'tax.totalTax': 'estimatedTotalTax',
  // Payments
  'payments.incomeTaxWithheld': 'federalWithheld',
};

// ---------------------------------------------------------------------------
// Section configuration
// ---------------------------------------------------------------------------

interface LineItem {
  label: string;
  path: string;
  isTotal?: boolean;
  isHighlight?: boolean;
}

interface Section {
  title: string;
  totalLabel: string;
  totalPath: string;
  lines: LineItem[];
  color: string;
}

const SECTIONS: Section[] = [
  {
    title: 'TOTAL INCOME',
    totalLabel: 'Total Income',
    totalPath: 'income.totalIncome',
    color: 'emerald',
    lines: [
      { label: 'Wages', path: 'income.wages' },
      { label: 'Interest Income', path: 'income.interestIncome' },
      { label: 'Dividend Income', path: 'income.dividendIncome' },
      { label: 'Business Income (Loss)', path: 'income.businessIncome' },
      { label: 'Rental, Royalty, and K-1 Income (Loss)', path: 'income.rentalK1Income' },
      { label: 'Capital Gains (Losses)', path: 'income.capitalGains' },
      { label: 'Taxable IRA Distributions', path: 'income.taxableIRA' },
      { label: 'Taxable Pension Distributions', path: 'income.taxablePension' },
      { label: 'Taxable Social Security Benefits', path: 'income.taxableSS' },
      { label: 'Unemployment Compensation', path: 'income.unemployment' },
      { label: 'Other Income', path: 'income.otherIncome' },
    ],
  },
  {
    title: 'TOTAL ADJUSTMENTS',
    totalLabel: 'Total Adjustments',
    totalPath: 'adjustments.totalAdjustments',
    color: 'amber',
    lines: [
      { label: 'IRA Deduction', path: 'adjustments.iraDeduction' },
      { label: 'Educator Expenses', path: 'adjustments.educatorExpenses' },
      { label: 'HSA Deduction', path: 'adjustments.hsaDeduction' },
      { label: 'Student Loan Interest', path: 'adjustments.studentLoanInterest' },
      { label: 'Self-Employment Tax Deduction', path: 'adjustments.seTaxDeduction' },
      { label: 'Self-Employed SEP Deduction', path: 'adjustments.sepDeduction' },
      { label: 'Other Adjustments', path: 'adjustments.otherAdjustments' },
    ],
  },
  {
    title: 'DEDUCTIONS',
    totalLabel: 'Total Deductions',
    totalPath: 'deductions.totalDeductions',
    color: 'blue',
    lines: [
      { label: 'Standard or Itemized Deductions', path: 'deductions.standardOrItemized' },
      { label: 'Qualified Business Income Deduction', path: 'deductions.qbiDeduction' },
    ],
  },
  {
    title: 'TOTAL TAX',
    totalLabel: 'Total Tax',
    totalPath: 'tax.totalTax',
    color: 'red',
    lines: [
      { label: 'Tax', path: 'tax.incomeTax' },
      { label: 'Alternative Minimum Tax', path: 'tax.amt' },
      { label: 'Self-Employment Tax', path: 'tax.seTax' },
      { label: 'Additional Tax on Qualified Plans', path: 'tax.additionalTaxQualifiedPlans' },
      { label: 'Net Investment Income Tax', path: 'tax.niit' },
    ],
  },
  {
    title: 'TOTAL CREDITS',
    totalLabel: 'Total Credits',
    totalPath: 'credits.totalCredits',
    color: 'teal',
    lines: [
      { label: 'Foreign Tax Credit', path: 'credits.foreignTaxCredit' },
      { label: 'Child Care Credit', path: 'credits.childCareCredit' },
      { label: 'Elderly Credit', path: 'credits.elderlyCredit' },
      { label: 'Education Credit', path: 'credits.educationCredit' },
      { label: 'Retirement Savings Credit', path: 'credits.retirementSavingsCredit' },
      { label: 'Child Tax Credit / Credit for Other Dependents', path: 'credits.childTaxCredit' },
    ],
  },
  {
    title: 'TOTAL PAYMENTS',
    totalLabel: 'Total Payments',
    totalPath: 'payments.totalPayments',
    color: 'sky',
    lines: [
      { label: 'Income Tax Withheld', path: 'payments.incomeTaxWithheld' },
      { label: 'Earned Income Credit', path: 'payments.eic' },
      { label: 'Additional Child Tax Credit', path: 'payments.additionalChildTaxCredit' },
      { label: 'Excess Social Security', path: 'payments.excessSocialSecurity' },
      { label: 'Estimated Tax Payments', path: 'payments.estimatedPayments' },
    ],
  },
  {
    title: 'TOTAL AMOUNT OWED',
    totalLabel: 'Total Owed',
    totalPath: 'balance.totalOwed',
    color: 'rose',
    lines: [
      { label: 'Amount Owed', path: 'balance.amountOwed' },
      { label: 'Underpayment Penalty', path: 'balance.underpaymentPenalty' },
    ],
  },
];

const STANDALONE_LINES: LineItem[] = [
  { label: 'ADJUSTED GROSS INCOME (AGI)', path: 'agi', isHighlight: true },
  { label: 'TAXABLE INCOME', path: 'taxableIncome', isHighlight: true },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FederalTaxView() {
  const { selectedYear, setSelectedYear, availableYears, entities } = useAppContext();

  const [data, setData] = useState<FederalTaxFiled>(emptyFiled());
  const [priorData, setPriorData] = useState<FederalTaxFiled | null>(null);
  const [computed, setComputed] = useState<ComputedData | null>(null);
  const [showComparison, setShowComparison] = useState(false);
  const [editing, setEditing] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const loadedRef = useRef(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load filed data for current year + prior year
  useEffect(() => {
    loadedRef.current = false;

    Promise.all([
      fetch(`/api/federal-tax/${selectedYear}`).then((r) => r.json()),
      fetch(`/api/federal-tax/${selectedYear - 1}`).then((r) => r.json()),
      fetch(`/api/financial-snapshot/${selectedYear}?format=json`)
        .then((r) => r.json())
        .catch(() => null),
    ]).then(([current, prior, snapshot]) => {
      setData(current || emptyFiled());
      setPriorData(prior || null);
      setComputed(mapSnapshotToComputed(snapshot));
      loadedRef.current = true;
    });
  }, [selectedYear]);

  // Auto-save on data changes (debounced)
  const save = useCallback(
    (newData: FederalTaxFiled) => {
      if (!loadedRef.current) return;
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        fetch(`/api/federal-tax/${selectedYear}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newData),
        });
      }, 500);
    },
    [selectedYear]
  );

  const updateField = (path: string, value: number) => {
    const updated = setNestedValue(data, path, value);
    setData(updated);
    save(updated);
  };

  const revertField = (path: string) => {
    const computedKey = COMPUTED_FIELD_MAP[path];
    if (!computedKey || !computed) return;
    updateField(path, computed[computedKey]);
  };

  const revertAll = () => {
    if (!computed) return;
    let updated = { ...data };
    for (const [path, key] of Object.entries(COMPUTED_FIELD_MAP)) {
      updated = setNestedValue(updated, path, computed[key]);
    }
    setData(updated);
    save(updated);
  };

  const toggleSection = (title: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  };

  const startEdit = (path: string, currentValue: number) => {
    setEditingField(path);
    setEditValue(String(currentValue));
  };

  const commitEdit = () => {
    if (editingField) {
      const parsed = parseFloat(editValue.replace(/[^0-9.-]/g, '')) || 0;
      updateField(editingField, parsed);
      setEditingField(null);
    }
  };

  // Computed indicator for a field
  const getComputedIndicator = (path: string): { color: string; tooltip: string } | null => {
    const computedKey = COMPUTED_FIELD_MAP[path];
    if (!computedKey || !computed) return null;
    const filedVal = getNestedValue(data, path);
    const computedVal = computed[computedKey];
    if (computedVal === 0 && filedVal === 0) return null;
    if (computedVal === 0)
      return { color: 'bg-surface-500', tooltip: 'No computed data from parsed docs' };
    if (Math.abs(filedVal - computedVal) <= 2) {
      return {
        color: 'bg-emerald-400',
        tooltip: `Matches parsed docs: ${formatCurrency(computedVal)}`,
      };
    }
    return {
      color: 'bg-amber-400',
      tooltip: `Filed: ${formatCurrency(filedVal)} | Computed: ${formatCurrency(computedVal)} | Delta: ${formatCurrency(filedVal - computedVal)}`,
    };
  };

  // Save entity metadata helper
  const saveEntityMetadata = useCallback(
    async (entityId: string, metadata: Record<string, unknown>) => {
      setSettingsSaving(true);
      try {
        await fetch(`/api/entities/${entityId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ metadata }),
        });
        // Reload snapshot to reflect changes in computed values
        const snapshot = await fetch(`/api/financial-snapshot/${selectedYear}?format=json`)
          .then((r) => r.json())
          .catch(() => null);
        setComputed(mapSnapshotToComputed(snapshot));
      } finally {
        setSettingsSaving(false);
      }
    },
    [selectedYear]
  );

  // Get current metadata values from entities
  const getEntityMeta = (entityId: string): Record<string, unknown> => {
    const entity = entities.find((e) => e.id === entityId);
    return (entity?.metadata as Record<string, unknown>) || {};
  };

  const totalOwed = getNestedValue(data, 'balance.totalOwed');
  const isRefund = totalOwed < 0;

  return (
    <div className="space-y-4 p-4 md:p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-violet-500/10 rounded-lg">
            <Scale className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-surface-950">Federal Taxes</h1>
            <p className="text-xs text-surface-500">
              {data.filed ? `Filed ${data.filedDate || ''}` : 'Not yet filed'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Year navigation */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedYear(selectedYear - 1)}
            disabled={!availableYears.includes(selectedYear - 1) && selectedYear <= 2020}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-lg font-bold font-mono text-surface-950 min-w-[3rem] text-center">
            {selectedYear}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedYear(selectedYear + 1)}
            disabled={selectedYear >= new Date().getFullYear()}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>

          <div className="w-px h-6 bg-surface-200 mx-1" />

          {/* Edit toggle */}
          <Button
            variant={editing ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setEditing(!editing)}
            className="gap-1.5"
          >
            {editing ? <Check className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}
            {editing ? 'Done' : 'Edit'}
          </Button>
        </div>
      </div>

      {/* Due / Refund Banner */}
      <Card variant="glass" className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-surface-600">
              {isRefund ? 'Federal Refund' : 'Federal Due'}
            </p>
            <p
              className={`text-3xl font-bold font-mono tracking-tight ${
                isRefund ? 'text-emerald-500' : 'text-rose-500'
              }`}
            >
              {formatCurrency(Math.abs(totalOwed))}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-surface-500 cursor-pointer">
              <input
                type="checkbox"
                checked={showComparison}
                onChange={(e) => setShowComparison(e.target.checked)}
                className="rounded border-surface-300"
              />
              Show {selectedYear - 1} comparison
            </label>
            {editing && computed && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-1.5 text-amber-500">
                    <RotateCcw className="w-3.5 h-3.5" />
                    Revert all
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Revert to computed values?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will replace all filed values that have matching computed data from
                      parsed documents. Fields without computed data will be unchanged.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={revertAll}>Revert</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>
      </Card>

      {/* Column Headers */}
      <div className="flex items-center px-4 text-[10px] font-medium text-surface-500 uppercase tracking-wider">
        <div className="flex-1" />
        <div className="w-28 text-right">{selectedYear}</div>
        {showComparison && priorData && (
          <>
            <div className="w-28 text-right">{selectedYear - 1}</div>
            <div className="w-20 text-right">Change</div>
          </>
        )}
      </div>

      {/* Sections */}
      {/* Tax Settings Panel */}
      <TaxSettingsPanel
        show={showSettings}
        onToggle={() => setShowSettings(!showSettings)}
        year={selectedYear}
        entities={entities}
        getEntityMeta={getEntityMeta}
        onSave={saveEntityMetadata}
        saving={settingsSaving}
      />

      {SECTIONS.map((section, sectionIdx) => {
        const expanded = expandedSections.has(section.title);
        const totalValue = getNestedValue(data, section.totalPath);
        const priorTotal = priorData ? getNestedValue(priorData, section.totalPath) : null;
        const delta = priorTotal !== null ? totalValue - priorTotal : null;

        return (
          <div key={section.title}>
            {/* Insert AGI line after adjustments section */}
            {sectionIdx === 2 && (
              <StandaloneLine
                item={STANDALONE_LINES[0]}
                data={data}
                priorData={priorData}
                showComparison={showComparison}
                editing={editing}
                editingField={editingField}
                editValue={editValue}
                onStartEdit={startEdit}
                onEditChange={setEditValue}
                onCommitEdit={commitEdit}
                getComputedIndicator={getComputedIndicator}
                onRevert={revertField}
              />
            )}

            {/* Insert Taxable Income line after deductions section */}
            {sectionIdx === 3 && (
              <StandaloneLine
                item={STANDALONE_LINES[1]}
                data={data}
                priorData={priorData}
                showComparison={showComparison}
                editing={editing}
                editingField={editingField}
                editValue={editValue}
                onStartEdit={startEdit}
                onEditChange={setEditValue}
                onCommitEdit={commitEdit}
                getComputedIndicator={getComputedIndicator}
                onRevert={revertField}
              />
            )}

            <Card variant="glass" className="overflow-hidden">
              {/* Section header (clickable) */}
              <button
                onClick={() => toggleSection(section.title)}
                className="flex items-center w-full px-4 py-3 text-left hover:bg-surface-50/50 transition-colors"
              >
                {expanded ? (
                  <ChevronDown className="w-4 h-4 text-surface-400 mr-2 shrink-0" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-surface-400 mr-2 shrink-0" />
                )}
                <span className="text-xs font-semibold text-surface-500 uppercase tracking-wider flex-1">
                  {section.title}
                </span>
                <span className="w-28 text-right font-mono font-bold text-sm text-surface-950">
                  {formatCurrency(totalValue)}
                </span>
                {showComparison && priorData && (
                  <>
                    <span className="w-28 text-right font-mono text-sm text-surface-500">
                      {priorTotal !== null ? formatCurrency(priorTotal) : '—'}
                    </span>
                    <DeltaBadge delta={delta} className="w-20" />
                  </>
                )}
              </button>

              {/* Expanded line items */}
              {expanded && (
                <div className="border-t border-surface-100">
                  {section.lines.map((line) => (
                    <LineRow
                      key={line.path}
                      line={line}
                      data={data}
                      priorData={priorData}
                      showComparison={showComparison}
                      editing={editing}
                      editingField={editingField}
                      editValue={editValue}
                      onStartEdit={startEdit}
                      onEditChange={setEditValue}
                      onCommitEdit={commitEdit}
                      getComputedIndicator={getComputedIndicator}
                      onRevert={revertField}
                    />
                  ))}
                  {/* Total row */}
                  <div className="flex items-center px-4 py-2 bg-surface-50/50 border-t border-surface-100">
                    <div className="flex-1 pl-6 text-xs font-semibold text-surface-700">
                      {section.totalLabel}
                    </div>
                    <div className="w-28 text-right font-mono font-bold text-sm text-surface-950">
                      {formatCurrency(totalValue)}
                    </div>
                    {showComparison && priorData && (
                      <>
                        <div className="w-28 text-right font-mono text-sm text-surface-500">
                          {priorTotal !== null ? formatCurrency(priorTotal) : '—'}
                        </div>
                        <DeltaBadge delta={delta} className="w-20" />
                      </>
                    )}
                  </div>
                </div>
              )}
            </Card>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DeltaBadge({ delta, className }: { delta: number | null; className?: string }) {
  if (delta === null || delta === 0 || Math.abs(delta) <= 2) {
    return <div className={`text-right text-xs text-surface-400 ${className}`}>—</div>;
  }
  const isPositive = delta > 0;
  return (
    <div
      className={`text-right text-xs font-mono font-medium ${
        isPositive ? 'text-rose-400' : 'text-emerald-400'
      } ${className}`}
    >
      {isPositive ? '+' : ''}
      {formatCurrency(delta)}
    </div>
  );
}

interface LineRowProps {
  line: LineItem;
  data: FederalTaxFiled;
  priorData: FederalTaxFiled | null;
  showComparison: boolean;
  editing: boolean;
  editingField: string | null;
  editValue: string;
  onStartEdit: (path: string, value: number) => void;
  onEditChange: (value: string) => void;
  onCommitEdit: () => void;
  getComputedIndicator: (path: string) => { color: string; tooltip: string } | null;
  onRevert: (path: string) => void;
}

function LineRow({
  line,
  data,
  priorData,
  showComparison,
  editing,
  editingField,
  editValue,
  onStartEdit,
  onEditChange,
  onCommitEdit,
  getComputedIndicator,
  onRevert,
}: LineRowProps) {
  const value = getNestedValue(data, line.path);
  const priorValue = priorData ? getNestedValue(priorData, line.path) : null;
  const delta = priorValue !== null ? value - priorValue : null;
  const indicator = getComputedIndicator(line.path);
  const isEditing = editingField === line.path;
  const canRevert = editing && indicator && indicator.color === 'bg-amber-400';

  return (
    <div className="flex items-center px-4 py-1.5 hover:bg-surface-50/30 transition-colors group">
      <div className="flex-1 pl-6 flex items-center gap-2">
        {indicator && (
          <span
            className={`w-1.5 h-1.5 rounded-full ${indicator.color} shrink-0`}
            title={indicator.tooltip}
          />
        )}
        <span className="text-xs text-surface-600">{line.label}</span>
        {canRevert && (
          <button
            onClick={() => onRevert(line.path)}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-amber-500/10"
            title={indicator!.tooltip}
          >
            <RotateCcw className="w-3 h-3 text-amber-400" />
          </button>
        )}
      </div>

      {isEditing ? (
        <input
          type="text"
          value={editValue}
          onChange={(e) => onEditChange(e.target.value)}
          onBlur={onCommitEdit}
          onKeyDown={(e) => e.key === 'Enter' && onCommitEdit()}
          className="w-28 text-right font-mono text-sm bg-surface-100 border border-surface-300 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-violet-400"
          autoFocus
        />
      ) : (
        <div
          className={`w-28 text-right font-mono text-sm ${
            value === 0 ? 'text-surface-400' : 'text-surface-800'
          } ${editing ? 'cursor-pointer hover:bg-surface-100 rounded px-2 py-0.5' : ''}`}
          onClick={editing ? () => onStartEdit(line.path, value) : undefined}
        >
          {formatCurrency(value)}
        </div>
      )}

      {showComparison && priorData && (
        <>
          <div
            className={`w-28 text-right font-mono text-sm ${
              priorValue === 0 ? 'text-surface-400' : 'text-surface-500'
            }`}
          >
            {priorValue !== null ? formatCurrency(priorValue) : '—'}
          </div>
          <DeltaBadge delta={delta} className="w-20" />
        </>
      )}
    </div>
  );
}

interface StandaloneLineProps {
  item: LineItem;
  data: FederalTaxFiled;
  priorData: FederalTaxFiled | null;
  showComparison: boolean;
  editing: boolean;
  editingField: string | null;
  editValue: string;
  onStartEdit: (path: string, value: number) => void;
  onEditChange: (value: string) => void;
  onCommitEdit: () => void;
  getComputedIndicator: (path: string) => { color: string; tooltip: string } | null;
  onRevert: (path: string) => void;
}

function StandaloneLine({
  item,
  data,
  priorData,
  showComparison,
  editing,
  editingField,
  editValue,
  onStartEdit,
  onEditChange,
  onCommitEdit,
  getComputedIndicator,
  onRevert,
}: StandaloneLineProps) {
  const value = getNestedValue(data, item.path);
  const priorValue = priorData ? getNestedValue(priorData, item.path) : null;
  const delta = priorValue !== null ? value - priorValue : null;
  const indicator = getComputedIndicator(item.path);
  const isEditing = editingField === item.path;
  const canRevert = editing && indicator && indicator.color === 'bg-amber-400';

  return (
    <Card variant="glass" className="mb-4">
      <div className="flex items-center px-4 py-3 group">
        <div className="flex-1 flex items-center gap-2">
          {indicator && (
            <span
              className={`w-1.5 h-1.5 rounded-full ${indicator.color} shrink-0`}
              title={indicator.tooltip}
            />
          )}
          <span className="text-xs font-semibold text-surface-700 uppercase tracking-wider">
            {item.label}
          </span>
          {canRevert && (
            <button
              onClick={() => onRevert(item.path)}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-amber-500/10"
              title={indicator!.tooltip}
            >
              <RotateCcw className="w-3 h-3 text-amber-400" />
            </button>
          )}
        </div>

        {isEditing ? (
          <input
            type="text"
            value={editValue}
            onChange={(e) => onEditChange(e.target.value)}
            onBlur={onCommitEdit}
            onKeyDown={(e) => e.key === 'Enter' && onCommitEdit()}
            className="w-28 text-right font-mono text-sm bg-surface-100 border border-surface-300 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-violet-400"
            autoFocus
          />
        ) : (
          <div
            className={`w-28 text-right font-mono font-bold text-sm text-surface-950 ${
              editing ? 'cursor-pointer hover:bg-surface-100 rounded px-2 py-0.5' : ''
            }`}
            onClick={editing ? () => onStartEdit(item.path, value) : undefined}
          >
            {formatCurrency(value)}
          </div>
        )}

        {showComparison && priorData && (
          <>
            <div className="w-28 text-right font-mono text-sm text-surface-500">
              {priorValue !== null ? formatCurrency(priorValue) : '—'}
            </div>
            <DeltaBadge delta={delta} className="w-20" />
          </>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Tax Settings Panel — configures entity metadata used by tax-calc
// ---------------------------------------------------------------------------

interface TaxSettingsPanelProps {
  show: boolean;
  onToggle: () => void;
  year: number;
  entities: { id: string; name: string; metadata?: Record<string, string | string[]> }[];
  getEntityMeta: (entityId: string) => Record<string, unknown>;
  onSave: (entityId: string, metadata: Record<string, unknown>) => Promise<void>;
  saving: boolean;
}

interface SettingField {
  entityId: string;
  key: string;
  label: string;
  description: string;
  type: 'number' | 'yearKeyed';
  placeholder?: string;
  prefix?: string; // defaults to '$'
}

function TaxSettingsPanel({
  show,
  onToggle,
  year,
  entities,
  getEntityMeta,
  onSave,
  saving,
}: TaxSettingsPanelProps) {
  // Build settings fields from entities
  const taxEntities = entities.filter((e) => (e as { type?: string }).type === 'tax');
  const businessEntities = taxEntities.filter((e) => e.id !== 'personal');

  const fields: SettingField[] = [
    // QBI carryforward on personal entity
    {
      entityId: 'personal',
      key: 'qbiCarryforward',
      label: 'QBI Loss Carryforward',
      description: `From ${year - 1} Form 8995 Line 16 — reduces ${year} QBI deduction`,
      type: 'yearKeyed',
      placeholder: '0',
    },
    {
      entityId: 'personal',
      key: 'dependentCount',
      label: 'Qualifying Children (count)',
      description: 'Number of children under 17 with SSN — CTC is $2,200 each',
      type: 'number',
      placeholder: '0',
      prefix: '#',
    },
    {
      entityId: 'personal',
      key: 'educatorExpenseEligible',
      label: 'Eligible Educators (count)',
      description: 'Number of spouses who are K-12 teachers — deduction is $300 each (max 2)',
      type: 'number',
      placeholder: '0',
      prefix: '#',
    },
    // Home office per business entity
    ...businessEntities.map((e) => ({
      entityId: e.id,
      key: 'homeOfficeDeduction',
      label: `Home Office — ${e.name}`,
      description: 'Simplified method: $5/sq ft × sq ft used (max $1,500)',
      type: 'number' as const,
      placeholder: '0',
    })),
  ];

  const getValue = (field: SettingField): string => {
    const meta = getEntityMeta(field.entityId);
    if (field.type === 'yearKeyed') {
      const obj = meta[field.key] as Record<string, unknown> | undefined;
      const priorYear = String(year - 1);
      return obj?.[priorYear] != null ? String(obj[priorYear]) : '';
    }
    return meta[field.key] != null ? String(meta[field.key]) : '';
  };

  const handleSave = async (field: SettingField, value: string) => {
    const numValue = parseFloat(value) || 0;
    if (field.type === 'yearKeyed') {
      const meta = getEntityMeta(field.entityId);
      const existing = (meta[field.key] as Record<string, unknown>) || {};
      const priorYear = String(year - 1);
      await onSave(field.entityId, {
        [field.key]: { ...existing, [priorYear]: numValue },
      });
    } else {
      await onSave(field.entityId, { [field.key]: String(numValue) });
    }
  };

  return (
    <Card variant="glass" className="overflow-hidden">
      <button
        onClick={onToggle}
        className="flex items-center w-full px-4 py-3 text-left hover:bg-surface-50/50 transition-colors"
      >
        {show ? (
          <ChevronDown className="w-4 h-4 text-surface-400 mr-2 shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-surface-400 mr-2 shrink-0" />
        )}
        <Settings2 className="w-4 h-4 text-surface-400 mr-2" />
        <span className="text-xs font-semibold text-surface-500 uppercase tracking-wider flex-1">
          Tax Settings
        </span>
        {saving && <span className="text-[10px] text-amber-500 animate-pulse">Saving...</span>}
      </button>
      {show && (
        <div className="border-t border-surface-100 divide-y divide-surface-100">
          {fields.map((field) => (
            <TaxSettingRow
              key={`${field.entityId}:${field.key}`}
              field={field}
              value={getValue(field)}
              onSave={handleSave}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function TaxSettingRow({
  field,
  value,
  onSave,
}: {
  field: SettingField;
  value: string;
  onSave: (field: SettingField, value: string) => Promise<void>;
}) {
  const [localValue, setLocalValue] = useState(value);
  const [dirty, setDirty] = useState(false);

  // Sync when external value changes
  useEffect(() => {
    setLocalValue(value);
    setDirty(false);
  }, [value]);

  const handleChange = (v: string) => {
    setLocalValue(v);
    setDirty(v !== value);
  };

  const handleBlur = async () => {
    if (dirty) {
      await onSave(field, localValue);
      setDirty(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 group">
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-surface-800">{field.label}</div>
        <div className="text-[10px] text-surface-500 leading-tight">{field.description}</div>
      </div>
      <div className="relative">
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-surface-400 text-xs">
          {field.prefix || '$'}
        </span>
        <input
          type="text"
          inputMode="numeric"
          value={localValue}
          onChange={(e) => handleChange(e.target.value.replace(/[^0-9.]/g, ''))}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder={field.placeholder}
          className={`w-28 text-right font-mono text-sm pl-5 pr-2 py-1 rounded border transition-colors focus:outline-none focus:ring-1 focus:ring-violet-400 ${
            dirty
              ? 'border-amber-400 bg-amber-50'
              : 'border-surface-200 bg-surface-50 hover:border-surface-300'
          }`}
        />
      </div>
    </div>
  );
}
