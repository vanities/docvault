import { DollarSign, TrendingUp, TrendingDown, FileText } from 'lucide-react';
import type { IncomeSummary, ExpenseSummary } from '../../types';

interface QuickStatsProps {
  incomeSummary: IncomeSummary;
  expenseSummary: ExpenseSummary;
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
  const colorClasses = {
    green: 'bg-green-50 text-green-600',
    red: 'bg-red-50 text-red-600',
    blue: 'bg-blue-50 text-blue-600',
    gray: 'bg-gray-50 text-gray-600',
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500 font-medium">{label}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
          {subtext && <p className="text-xs text-gray-400 mt-1">{subtext}</p>}
        </div>
        <div className={`p-2 rounded-lg ${colorClasses[color]}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
    </div>
  );
}

export function QuickStats({ incomeSummary, expenseSummary, documentCount }: QuickStatsProps) {
  const netIncome = incomeSummary.totalIncome - expenseSummary.totalDeductible;
  const estimatedTax = netIncome * 0.25; // Rough estimate

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard
        icon={TrendingUp}
        label="Total Income"
        value={formatCurrency(incomeSummary.totalIncome)}
        subtext={`${incomeSummary.w2Count} W-2s, ${incomeSummary.income1099Count} 1099s`}
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
