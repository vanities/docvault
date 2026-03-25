import { Receipt, TrendingDown, Percent, Download, Fuel, ArrowRight } from 'lucide-react';
import { CopyableField } from './CopyableField';
import type { ExpenseSummary as ExpenseSummaryType, TaxDocument, ParsedReceipt } from '../../types';
import { EXPENSE_CATEGORIES } from '../../config';
import { Card } from '@/components/ui/card';

interface ExpenseSummaryProps {
  summary: ExpenseSummaryType;
  documents: TaxDocument[];
  onDownload?: () => void;
  onNavigateToMileage?: () => void;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount);
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

export function ExpenseSummary({
  summary,
  documents,
  onDownload,
  onNavigateToMileage,
}: ExpenseSummaryProps) {
  // Group documents by category
  const docsByCategory = documents.reduce(
    (acc, doc) => {
      const data = doc.parsedData as ParsedReceipt | undefined;
      const category = data?.category || 'other';
      if (!acc[category]) acc[category] = [];
      acc[category].push(doc);
      return acc;
    },
    {} as Record<string, TaxDocument[]>
  );

  return (
    <div className="space-y-6">
      {/* Header with download */}
      {onDownload && documents.length > 0 && (
        <div className="flex justify-end">
          <button
            onClick={onDownload}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-surface-700 hover:text-surface-950 bg-surface-200/50 hover:bg-surface-200 border border-border rounded-lg transition-colors"
          >
            <Download className="w-4 h-4" />
            Download Expense Docs
          </button>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card variant="glass" className="p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-danger-500/10 rounded-lg">
              <TrendingDown className="w-5 h-5 text-danger-400" />
            </div>
            <h3 className="font-semibold text-surface-950 text-[13px]">Total Expenses</h3>
          </div>
          <p className="text-3xl font-bold text-surface-950 font-mono tracking-tight">
            {formatCurrency(summary.totalExpenses)}
          </p>
          <p className="text-[11px] text-surface-600 mt-1">Gross expense amount</p>
        </Card>

        <Card variant="glass" className="p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-emerald-500/10 rounded-lg">
              <Percent className="w-5 h-5 text-emerald-400" />
            </div>
            <h3 className="font-semibold text-surface-950 text-[13px]">Deductible</h3>
          </div>
          <p className="text-3xl font-bold text-surface-950 font-mono tracking-tight">
            {formatCurrency(summary.totalDeductible)}
          </p>
          <p className="text-[11px] text-surface-600 mt-1">After deduction rates applied</p>
        </Card>

        <Card variant="glass" className="p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-info-500/10 rounded-lg">
              <Receipt className="w-5 h-5 text-info-400" />
            </div>
            <h3 className="font-semibold text-surface-950 text-[13px]">Receipts</h3>
          </div>
          <p className="text-3xl font-bold text-surface-950 font-mono tracking-tight">
            {documents.length}
          </p>
          <p className="text-[11px] text-surface-600 mt-1">
            Across {summary.items.length} categories
          </p>
        </Card>
      </div>

      {/* Schedule C Copyable Fields */}
      {summary.items.length > 0 && (
        <Card variant="glass" className="p-5">
          <h3 className="font-semibold text-surface-950 mb-4 text-[14px]">
            Schedule C Entry Values
          </h3>
          <p className="text-[13px] text-surface-600 mb-4">
            Click any value to copy for easy pasting into TurboTax Schedule C.
          </p>

          <div className="space-y-2">
            {summary.items.map((item) => {
              const categoryInfo = EXPENSE_CATEGORIES.find((c) => c.id === item.category);
              return (
                <CopyableField
                  key={item.category}
                  label={categoryInfo?.label || item.category}
                  value={item.deductibleAmount}
                  sublabel={
                    categoryInfo?.scheduleC
                      ? `${categoryInfo.scheduleC} · ${item.count} receipts`
                      : `${item.count} receipts`
                  }
                />
              );
            })}

            {summary.mileageDeduction > 0 && (
              <>
                <div className="border-t border-border pt-2 mt-3" />
                <CopyableField
                  label="Mileage Deduction"
                  value={summary.mileageDeduction}
                  sublabel={`${summary.mileageTotal.toLocaleString()} miles × IRS rate · ${summary.mileageCount} trips`}
                />
              </>
            )}

            <div className="border-t border-border pt-2 mt-3">
              <CopyableField
                label="Total Deductible Expenses"
                value={summary.totalDeductible}
                sublabel="Sum of all deductible amounts (including mileage)"
              />
            </div>
          </div>
        </Card>
      )}

      {/* Mileage Section */}
      {onNavigateToMileage && (
        <Card variant="glass" className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-surface-950 text-[14px]">
              Mileage Deduction{summary.mileageCount > 0 ? ` (${summary.mileageCount} trips)` : ''}
            </h3>
            <button
              onClick={onNavigateToMileage}
              className="flex items-center gap-1.5 text-[13px] font-medium text-teal-500 hover:text-teal-400 transition-colors"
            >
              <Fuel className="w-4 h-4" />
              {summary.mileageCount > 0 ? 'View Mileage Log' : 'Log Mileage'}
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
          {summary.mileageCount > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="border border-border rounded-lg p-4">
                <p className="text-[11px] text-surface-600 mb-1">Total Miles</p>
                <p className="text-2xl font-bold text-surface-950 font-mono tracking-tight">
                  {summary.mileageTotal.toLocaleString()}
                </p>
                <p className="text-[11px] text-surface-600 mt-1">Business miles driven</p>
              </div>
              <div className="border border-border rounded-lg p-4">
                <p className="text-[11px] text-surface-600 mb-1">IRS Deduction</p>
                <p className="text-2xl font-bold text-emerald-500 font-mono tracking-tight">
                  {formatCurrency(summary.mileageDeduction)}
                </p>
                <p className="text-[11px] text-surface-600 mt-1">100% deductible (Schedule C)</p>
              </div>
              <div className="border border-border rounded-lg p-4">
                <p className="text-[11px] text-surface-600 mb-1">Trips Logged</p>
                <p className="text-2xl font-bold text-surface-950 font-mono tracking-tight">
                  {summary.mileageCount}
                </p>
                <p className="text-[11px] text-surface-600 mt-1">For tax year {summary.taxYear}</p>
              </div>
            </div>
          ) : (
            <p className="text-[13px] text-surface-500">No mileage logged for this tax year.</p>
          )}
        </Card>
      )}

      {/* Category Breakdown */}
      {summary.items.length > 0 && (
        <Card variant="glass" className="p-5">
          <h3 className="font-semibold text-surface-950 mb-4 text-[14px]">Expense Categories</h3>

          <div className="space-y-4">
            {summary.items.map((item) => {
              const categoryInfo = EXPENSE_CATEGORIES.find((c) => c.id === item.category);
              const categoryDocs = docsByCategory[item.category] || [];
              const deductionRate = categoryInfo?.deductionRate || 1;

              return (
                <div
                  key={item.category}
                  className="border border-border rounded-lg overflow-hidden"
                >
                  {/* Category Header */}
                  <div className="bg-surface-200/30 px-4 py-3 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-surface-950 text-[13px]">
                        {categoryInfo?.label || item.category}
                      </p>
                      <p className="text-[11px] text-surface-600">
                        {categoryInfo?.scheduleC && `${categoryInfo.scheduleC} · `}
                        {deductionRate < 1
                          ? `${deductionRate * 100}% deductible`
                          : 'Fully deductible'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-surface-950 font-mono text-[13px]">
                        {formatCurrency(item.deductibleAmount)}
                      </p>
                      {deductionRate < 1 && (
                        <p className="text-[11px] text-surface-600">
                          of {formatCurrency(item.total)}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Receipts in category */}
                  {categoryDocs.length > 0 && (
                    <div className="divide-y divide-border">
                      {categoryDocs.slice(0, 5).map((doc) => {
                        const data = doc.parsedData as ParsedReceipt | undefined;

                        return (
                          <div key={doc.id} className="px-4 py-2 flex items-center justify-between">
                            <div className="min-w-0 flex-1">
                              <p className="text-[13px] text-surface-800 truncate">
                                {data?.vendor || doc.fileName}
                              </p>
                              <p className="text-[11px] text-surface-600">
                                {data?.date ? formatDate(data.date) : formatDate(doc.createdAt)}
                                {data?.description && ` · ${data.description}`}
                              </p>
                            </div>
                            <p className="text-[13px] font-medium text-surface-950 ml-4 font-mono">
                              {data?.amount ? formatCurrency(data.amount) : '-'}
                            </p>
                          </div>
                        );
                      })}
                      {categoryDocs.length > 5 && (
                        <div className="px-4 py-2 text-center">
                          <p className="text-[11px] text-surface-600">
                            +{categoryDocs.length - 5} more receipts
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Empty State */}
      {documents.length === 0 && (
        <Card variant="glass" className="p-8 text-center">
          <Receipt className="w-12 h-12 text-surface-500 mx-auto mb-4" />
          <h3 className="font-medium text-surface-900 mb-1">No expense receipts</h3>
          <p className="text-[13px] text-surface-600">
            Upload your receipts and categorize them to see your expense summary.
          </p>
        </Card>
      )}

      {/* Category Legend */}
      <Card variant="glass" className="p-5">
        <h3 className="font-semibold text-surface-950 mb-4 text-[14px]">Expense Category Guide</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {EXPENSE_CATEGORIES.map((cat) => (
            <div key={cat.id} className="flex items-start gap-2 text-[13px]">
              <div
                className={`w-2 h-2 rounded-full mt-1.5 ${
                  cat.deductionRate < 1 ? 'bg-amber-400' : 'bg-emerald-400'
                }`}
              />
              <div>
                <p className="font-medium text-surface-800">{cat.label}</p>
                <p className="text-[11px] text-surface-600">
                  {cat.scheduleC || 'Form varies'}
                  {cat.deductionRate < 1 && ` · ${cat.deductionRate * 100}%`}
                </p>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
