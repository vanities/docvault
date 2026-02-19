import { DollarSign, TrendingUp, TrendingDown, FileText, Receipt } from 'lucide-react';
import type { IncomeSummary, ExpenseSummary, InvoiceSummaryData } from '../../types';

interface QuickStatsProps {
  incomeSummary: IncomeSummary;
  expenseSummary: ExpenseSummary;
  invoiceSummary: InvoiceSummaryData;
  documentCount: number;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

interface StatCardProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  subtext?: string;
  color: 'green' | 'red' | 'blue' | 'gray';
}

function StatCard({ icon: Icon, label, value, subtext, color }: StatCardProps) {
  const colorConfig = {
    green: { icon: 'text-emerald-400', bg: 'bg-emerald-500/10', glow: 'glow-emerald' },
    red: { icon: 'text-red-400', bg: 'bg-red-500/10', glow: 'glow-red' },
    blue: { icon: 'text-blue-400', bg: 'bg-blue-500/10', glow: 'glow-blue' },
    gray: { icon: 'text-surface-700', bg: 'bg-surface-400/10', glow: '' },
  };

  const c = colorConfig[color];

  return (
    <div className={`glass-card rounded-xl p-5 hover:${c.glow} transition-all duration-200`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] text-surface-700 font-medium uppercase tracking-wider">
            {label}
          </p>
          <p className="text-2xl font-bold text-surface-950 mt-1.5 font-mono tracking-tight">
            {value}
          </p>
          {subtext && <p className="text-[11px] text-surface-600 mt-1">{subtext}</p>}
        </div>
        <div className={`p-2.5 rounded-xl ${c.bg}`}>
          <Icon className={`w-5 h-5 ${c.icon}`} />
        </div>
      </div>
    </div>
  );
}

export function QuickStats({
  incomeSummary,
  expenseSummary,
  invoiceSummary,
  documentCount,
}: QuickStatsProps) {
  const netIncome = incomeSummary.totalIncome - expenseSummary.totalDeductible;
  const estimatedTax = netIncome * 0.25; // Rough estimate

  // Build subtext parts for Total Income (W-2s + 1099s only)
  const incomeParts: string[] = [];
  if (incomeSummary.w2Count > 0) incomeParts.push(`${incomeSummary.w2Count} W-2s`);
  if (incomeSummary.income1099Count > 0) incomeParts.push(`${incomeSummary.income1099Count} 1099s`);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3 stagger">
      <StatCard
        icon={TrendingUp}
        label="Total Income"
        value={formatCurrency(incomeSummary.totalIncome)}
        subtext={incomeParts.join(', ') || 'No income docs'}
        color="green"
      />
      <StatCard
        icon={Receipt}
        label="Invoiced Revenue"
        value={formatCurrency(invoiceSummary.invoiceTotal)}
        subtext={`${invoiceSummary.invoiceCount} invoices, ${invoiceSummary.byCustomer.length} customers`}
        color="green"
      />
      <StatCard
        icon={TrendingDown}
        label="Deductible Expenses"
        value={formatCurrency(expenseSummary.totalDeductible)}
        subtext={`${expenseSummary.items.reduce((sum, i) => sum + i.count, 0)} receipts`}
        color="red"
      />
      <StatCard
        icon={DollarSign}
        label="Est. Tax Liability"
        value={formatCurrency(Math.max(0, estimatedTax - incomeSummary.federalWithheld))}
        subtext={`${formatCurrency(incomeSummary.federalWithheld)} withheld`}
        color="blue"
      />
      <StatCard
        icon={FileText}
        label="Documents"
        value={documentCount.toString()}
        subtext="Total uploaded"
        color="gray"
      />
    </div>
  );
}
