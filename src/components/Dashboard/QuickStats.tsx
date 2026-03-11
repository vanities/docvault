import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  FileText,
  Receipt,
  Landmark,
  BarChart3,
  Building2,
} from 'lucide-react';
import type {
  IncomeSummary,
  ExpenseSummary,
  InvoiceSummaryData,
  RetirementSummary,
  BankDepositSummary,
} from '../../types';

interface QuickStatsProps {
  incomeSummary: IncomeSummary;
  expenseSummary: ExpenseSummary;
  invoiceSummary: InvoiceSummaryData;
  documentCount: number;
  allIncomeSummary?: IncomeSummary;
  allExpenseSummary?: ExpenseSummary;
  allInvoiceSummary?: InvoiceSummaryData;
  allDocumentCount?: number;
  retirementSummary?: RetirementSummary | null;
  allRetirementSummary?: RetirementSummary | null;
  bankDepositSummary?: BankDepositSummary | null;
  allBankDepositSummary?: BankDepositSummary | null;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

interface StatCardProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  altValue?: string;
  subtext?: string;
  color: 'green' | 'red' | 'blue' | 'gray';
}

function StatCard({ icon: Icon, label, value, altValue, subtext, color }: StatCardProps) {
  const colorConfig = {
    green: { icon: 'text-emerald-400', bg: 'bg-emerald-500/10', glow: 'glow-emerald' },
    red: { icon: 'text-red-400', bg: 'bg-red-500/10', glow: 'glow-red' },
    blue: { icon: 'text-blue-400', bg: 'bg-blue-500/10', glow: 'glow-blue' },
    gray: { icon: 'text-surface-700', bg: 'bg-surface-400/10', glow: '' },
  };

  const c = colorConfig[color];

  return (
    <div className={`glass-card rounded-xl p-4 hover:${c.glow} transition-all duration-200`}>
      <div className="flex items-center gap-2 mb-2">
        <div className={`p-1.5 rounded-lg ${c.bg} flex-shrink-0`}>
          <Icon className={`w-4 h-4 ${c.icon}`} />
        </div>
        <p className="text-[11px] text-surface-700 font-medium uppercase tracking-wider truncate">
          {label}
        </p>
      </div>
      <p className="text-xl font-bold text-surface-950 font-mono tracking-tight truncate">
        {value}
      </p>
      {altValue && altValue !== value && (
        <p className="text-[10px] text-surface-500 mt-0.5 font-mono truncate">
          {altValue} w/ hidden
        </p>
      )}
      {subtext && <p className="text-[10px] text-surface-600 mt-1 truncate">{subtext}</p>}
    </div>
  );
}

export function QuickStats({
  incomeSummary,
  expenseSummary,
  invoiceSummary,
  documentCount,
  allIncomeSummary,
  allExpenseSummary,
  allInvoiceSummary,
  allDocumentCount,
  retirementSummary,
  allRetirementSummary,
  bankDepositSummary,
  allBankDepositSummary,
}: QuickStatsProps) {
  const netIncome =
    incomeSummary.totalIncome + incomeSummary.capitalGainsTotal - expenseSummary.totalDeductible;
  const estimatedTax = netIncome * 0.25; // Rough estimate

  // Compute "all" tax liability when all summaries are provided
  const allEstimatedTax =
    allIncomeSummary && allExpenseSummary
      ? (allIncomeSummary.totalIncome +
          allIncomeSummary.capitalGainsTotal -
          allExpenseSummary.totalDeductible) *
        0.25
      : undefined;
  const allTaxLiability =
    allEstimatedTax !== undefined && allIncomeSummary
      ? formatCurrency(Math.max(0, allEstimatedTax - allIncomeSummary.federalWithheld))
      : undefined;

  // Build subtext parts for Total Income (W-2s + 1099s only)
  const incomeParts: string[] = [];
  if (incomeSummary.w2Count > 0) incomeParts.push(`${incomeSummary.w2Count} W-2s`);
  if (incomeSummary.income1099Count > 0) incomeParts.push(`${incomeSummary.income1099Count} 1099s`);
  if (incomeSummary.k1Count > 0) incomeParts.push(`${incomeSummary.k1Count} K-1s`);

  const hasRetirement = retirementSummary && retirementSummary.totalContributions > 0;
  const hasCapitalGains = incomeSummary.capitalGainsTotal !== 0;
  const hasBankDeposits = bankDepositSummary && bankDepositSummary.totalDeposits > 0;

  // Build retirement subtext (e.g. "$43k employer, $23k employee")
  const retirementSubtext = hasRetirement
    ? [
        retirementSummary.employerContributions > 0
          ? `${formatCurrency(retirementSummary.employerContributions)} employer`
          : null,
        retirementSummary.employeeContributions > 0
          ? `${formatCurrency(retirementSummary.employeeContributions)} employee`
          : null,
      ]
        .filter(Boolean)
        .join(', ') || `${retirementSummary.statementCount} statements`
    : undefined;

  // Build capital gains subtext (short-term / long-term breakdown)
  const capitalGainsSubtext = hasCapitalGains
    ? [
        incomeSummary.capitalGainsShortTerm !== 0
          ? `${formatCurrency(incomeSummary.capitalGainsShortTerm)} short-term`
          : null,
        incomeSummary.capitalGainsLongTerm !== 0
          ? `${formatCurrency(incomeSummary.capitalGainsLongTerm)} long-term`
          : null,
      ]
        .filter(Boolean)
        .join(', ') || 'Schedule D'
    : undefined;

  // Grid columns: 5 base + optional retirement + optional capital gains + optional bank deposits
  // Use complete class names so Tailwind can detect them at build time
  const extraCols = (hasRetirement ? 1 : 0) + (hasCapitalGains ? 1 : 0) + (hasBankDeposits ? 1 : 0);
  const gridCols =
    extraCols === 3
      ? 'lg:grid-cols-8'
      : extraCols === 2
        ? 'lg:grid-cols-7'
        : extraCols === 1
          ? 'lg:grid-cols-6'
          : 'lg:grid-cols-5';

  return (
    <div className={`grid grid-cols-1 md:grid-cols-2 ${gridCols} gap-3 stagger`}>
      <StatCard
        icon={TrendingUp}
        label="Total Income"
        value={formatCurrency(incomeSummary.totalIncome)}
        altValue={allIncomeSummary ? formatCurrency(allIncomeSummary.totalIncome) : undefined}
        subtext={incomeParts.join(', ') || 'No income docs'}
        color="green"
      />
      <StatCard
        icon={Receipt}
        label="Invoiced Revenue"
        value={formatCurrency(invoiceSummary.invoiceTotal)}
        altValue={allInvoiceSummary ? formatCurrency(allInvoiceSummary.invoiceTotal) : undefined}
        subtext={`${invoiceSummary.invoiceCount} invoices, ${invoiceSummary.byCustomer.length} customers`}
        color="green"
      />
      {hasCapitalGains && (
        <StatCard
          icon={BarChart3}
          label="Capital Gains"
          value={formatCurrency(incomeSummary.capitalGainsTotal)}
          altValue={
            allIncomeSummary ? formatCurrency(allIncomeSummary.capitalGainsTotal) : undefined
          }
          subtext={capitalGainsSubtext}
          color={incomeSummary.capitalGainsTotal >= 0 ? 'green' : 'red'}
        />
      )}
      {hasRetirement && (
        <StatCard
          icon={Landmark}
          label="Retirement"
          value={formatCurrency(retirementSummary.totalContributions)}
          altValue={
            allRetirementSummary
              ? formatCurrency(allRetirementSummary.totalContributions)
              : undefined
          }
          subtext={retirementSubtext}
          color="blue"
        />
      )}
      {hasBankDeposits && (
        <StatCard
          icon={Building2}
          label="Bank Deposits"
          value={formatCurrency(bankDepositSummary.totalDeposits)}
          altValue={
            allBankDepositSummary ? formatCurrency(allBankDepositSummary.totalDeposits) : undefined
          }
          subtext={
            bankDepositSummary.depositCount > 0
              ? `${bankDepositSummary.depositCount} deposits, ${bankDepositSummary.statementCount} statements`
              : `${bankDepositSummary.statementCount} statements`
          }
          color="green"
        />
      )}
      <StatCard
        icon={TrendingDown}
        label="Deductible Expenses"
        value={formatCurrency(expenseSummary.totalDeductible)}
        altValue={allExpenseSummary ? formatCurrency(allExpenseSummary.totalDeductible) : undefined}
        subtext={`${expenseSummary.items.reduce((sum, i) => sum + i.count, 0)} receipts`}
        color="red"
      />
      <StatCard
        icon={DollarSign}
        label="Est. Tax Liability"
        value={formatCurrency(Math.max(0, estimatedTax - incomeSummary.federalWithheld))}
        altValue={allTaxLiability}
        subtext={`${formatCurrency(incomeSummary.federalWithheld)} withheld`}
        color="blue"
      />
      <StatCard
        icon={FileText}
        label="Documents"
        value={documentCount.toString()}
        altValue={allDocumentCount !== undefined ? allDocumentCount.toString() : undefined}
        subtext="Total uploaded"
        color="gray"
      />
    </div>
  );
}
