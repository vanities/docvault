import { Landmark, CreditCard, AlertTriangle } from 'lucide-react';
import type { TaxDocument, IncomeSummary as IncomeSummaryType } from '../../types';

interface StatementSummaryProps {
  bankDocs: TaxDocument[];
  ccDocs: TaxDocument[];
  incomeSummary?: IncomeSummaryType;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount);
}

/** Extract a month label from parsed data or filename */
function getMonthLabel(doc: TaxDocument): string {
  const data = doc.parsedData as Record<string, unknown> | undefined;
  if (data?.periodLabel) return data.periodLabel as string;
  if (data?.startDate) {
    const d = new Date(data.startDate as string);
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
  if (data?.statementDate) {
    const d = new Date(data.statementDate as string);
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
  // Fallback: parse YYYY-MM from filename
  const match = doc.fileName.match(/(\d{4})-(\d{2})/);
  if (match) {
    const d = new Date(Number(match[1]), Number(match[2]) - 1);
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
  return doc.fileName;
}

/** Sort key from parsed data or filename */
function getSortDate(doc: TaxDocument): string {
  const data = doc.parsedData as Record<string, unknown> | undefined;
  if (data?.startDate) return data.startDate as string;
  if (data?.statementDate) return data.statementDate as string;
  const match = doc.fileName.match(/(\d{4}-\d{2})/);
  return match?.[1] || '9999';
}

export function StatementSummary({ bankDocs, ccDocs, incomeSummary }: StatementSummaryProps) {
  // Sort chronologically
  const sortedBank = [...bankDocs].sort((a, b) => getSortDate(a).localeCompare(getSortDate(b)));
  const sortedCC = [...ccDocs].sort((a, b) => getSortDate(a).localeCompare(getSortDate(b)));

  // Bank totals
  let totalDeposits = 0;
  let totalWithdrawals = 0;
  for (const doc of sortedBank) {
    const data = doc.parsedData as Record<string, unknown> | undefined;
    totalDeposits += Number(data?.totalDeposits || 0);
    totalWithdrawals += Number(data?.totalWithdrawals || 0);
  }

  // CC totals
  let totalPurchases = 0;
  let totalPayments = 0;
  for (const doc of sortedCC) {
    const data = doc.parsedData as Record<string, unknown> | undefined;
    totalPurchases += Number(data?.purchases || data?.newCharges || 0);
    totalPayments += Math.abs(Number(data?.payments || 0));
  }

  // Reconciliation: compare bank deposits to 1099 income
  const income1099Total = incomeSummary?.income1099Total ?? 0;
  const difference = totalDeposits - income1099Total;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="glass-card rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <Landmark className="w-5 h-5 text-blue-400" />
            </div>
            <h3 className="font-semibold text-surface-950 text-[13px]">Bank Deposits</h3>
          </div>
          <p className="text-3xl font-bold text-surface-950 font-mono tracking-tight">
            {formatCurrency(totalDeposits)}
          </p>
          <p className="text-[11px] text-surface-600 mt-1">
            {sortedBank.length} statement{sortedBank.length !== 1 ? 's' : ''}
          </p>
        </div>

        <div className="glass-card rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-purple-500/10 rounded-lg">
              <CreditCard className="w-5 h-5 text-purple-400" />
            </div>
            <h3 className="font-semibold text-surface-950 text-[13px]">CC Purchases</h3>
          </div>
          <p className="text-3xl font-bold text-surface-950 font-mono tracking-tight">
            {formatCurrency(totalPurchases)}
          </p>
          <p className="text-[11px] text-surface-600 mt-1">
            {sortedCC.length} statement{sortedCC.length !== 1 ? 's' : ''}
          </p>
        </div>

        {income1099Total > 0 && (
          <div className="glass-card rounded-xl p-5">
            <div className="flex items-center gap-3 mb-3">
              <div
                className={`p-2 rounded-lg ${Math.abs(difference) > 100 ? 'bg-amber-500/10' : 'bg-emerald-500/10'}`}
              >
                <AlertTriangle
                  className={`w-5 h-5 ${Math.abs(difference) > 100 ? 'text-amber-400' : 'text-emerald-400'}`}
                />
              </div>
              <h3 className="font-semibold text-surface-950 text-[13px]">Deposits vs 1099s</h3>
            </div>
            <p
              className={`text-3xl font-bold font-mono tracking-tight ${Math.abs(difference) > 100 ? 'text-amber-400' : 'text-emerald-400'}`}
            >
              {difference >= 0 ? '+' : ''}
              {formatCurrency(difference)}
            </p>
            <p className="text-[11px] text-surface-600 mt-1">
              {formatCurrency(totalDeposits)} deposits − {formatCurrency(income1099Total)} 1099s
            </p>
          </div>
        )}
      </div>

      {/* Bank Statements */}
      {sortedBank.length > 0 && (
        <div className="glass-card rounded-xl p-5">
          <h3 className="font-semibold text-surface-950 mb-4 text-[14px]">
            Bank Statements ({sortedBank.length})
          </h3>

          <div className="space-y-2">
            {/* Header row */}
            <div className="grid grid-cols-5 gap-3 px-4 pb-2 border-b border-border">
              <p className="text-[11px] font-semibold text-surface-600 uppercase tracking-wider">
                Month
              </p>
              <p className="text-[11px] font-semibold text-surface-600 uppercase tracking-wider text-right">
                Deposits
              </p>
              <p className="text-[11px] font-semibold text-surface-600 uppercase tracking-wider text-right">
                Withdrawals
              </p>
              <p className="text-[11px] font-semibold text-surface-600 uppercase tracking-wider text-right">
                Ending Bal
              </p>
              <p className="text-[11px] font-semibold text-surface-600 uppercase tracking-wider text-right">
                # Deposits
              </p>
            </div>

            {sortedBank.map((doc) => {
              const data = doc.parsedData as Record<string, unknown> | undefined;
              const deposits = Number(data?.totalDeposits || 0);
              const withdrawals = Number(data?.totalWithdrawals || 0);
              const ending = Number(data?.endingBalance || 0);
              const count = Number(data?.depositCount || data?.depositsCount || 0);

              return (
                <div
                  key={doc.id}
                  className="grid grid-cols-5 gap-3 px-4 py-2 hover:bg-surface-200/30 rounded-lg transition-colors"
                >
                  <p className="text-[13px] text-surface-950 font-medium">{getMonthLabel(doc)}</p>
                  <p className="text-[13px] text-emerald-500 font-mono text-right">
                    {formatCurrency(deposits)}
                  </p>
                  <p className="text-[13px] text-red-400 font-mono text-right">
                    {formatCurrency(withdrawals)}
                  </p>
                  <p className="text-[13px] text-surface-950 font-mono text-right">
                    {ending ? formatCurrency(ending) : '—'}
                  </p>
                  <p className="text-[13px] text-surface-700 font-mono text-right">
                    {count || '—'}
                  </p>
                </div>
              );
            })}

            {/* Totals row */}
            <div className="grid grid-cols-5 gap-3 px-4 pt-2 border-t border-border">
              <p className="text-[13px] font-semibold text-surface-950">Total</p>
              <p className="text-[13px] font-semibold text-emerald-500 font-mono text-right">
                {formatCurrency(totalDeposits)}
              </p>
              <p className="text-[13px] font-semibold text-red-400 font-mono text-right">
                {formatCurrency(totalWithdrawals)}
              </p>
              <p className="text-[13px] text-surface-600 text-right">—</p>
              <p className="text-[13px] text-surface-600 text-right">—</p>
            </div>
          </div>
        </div>
      )}

      {/* Credit Card Statements */}
      {sortedCC.length > 0 && (
        <div className="glass-card rounded-xl p-5">
          <h3 className="font-semibold text-surface-950 mb-4 text-[14px]">
            Credit Card Statements ({sortedCC.length})
          </h3>

          <div className="space-y-2">
            {/* Header row */}
            <div className="grid grid-cols-5 gap-3 px-4 pb-2 border-b border-border">
              <p className="text-[11px] font-semibold text-surface-600 uppercase tracking-wider">
                Month
              </p>
              <p className="text-[11px] font-semibold text-surface-600 uppercase tracking-wider text-right">
                Purchases
              </p>
              <p className="text-[11px] font-semibold text-surface-600 uppercase tracking-wider text-right">
                Payments
              </p>
              <p className="text-[11px] font-semibold text-surface-600 uppercase tracking-wider text-right">
                Balance
              </p>
              <p className="text-[11px] font-semibold text-surface-600 uppercase tracking-wider text-right">
                Limit
              </p>
            </div>

            {sortedCC.map((doc) => {
              const data = doc.parsedData as Record<string, unknown> | undefined;
              const purchases = Number(data?.purchases || data?.newCharges || 0);
              const payments = Math.abs(Number(data?.payments || 0));
              const balance = Number(data?.newBalance || data?.currentBalance || 0);
              const limit = Number(data?.creditLimit || 0);

              return (
                <div
                  key={doc.id}
                  className="grid grid-cols-5 gap-3 px-4 py-2 hover:bg-surface-200/30 rounded-lg transition-colors"
                >
                  <p className="text-[13px] text-surface-950 font-medium">{getMonthLabel(doc)}</p>
                  <p className="text-[13px] text-red-400 font-mono text-right">
                    {formatCurrency(purchases)}
                  </p>
                  <p className="text-[13px] text-emerald-500 font-mono text-right">
                    {formatCurrency(payments)}
                  </p>
                  <p className="text-[13px] text-surface-950 font-mono text-right">
                    {formatCurrency(balance)}
                  </p>
                  <p className="text-[13px] text-surface-700 font-mono text-right">
                    {limit ? formatCurrency(limit) : '—'}
                  </p>
                </div>
              );
            })}

            {/* Totals row */}
            <div className="grid grid-cols-5 gap-3 px-4 pt-2 border-t border-border">
              <p className="text-[13px] font-semibold text-surface-950">Total</p>
              <p className="text-[13px] font-semibold text-red-400 font-mono text-right">
                {formatCurrency(totalPurchases)}
              </p>
              <p className="text-[13px] font-semibold text-emerald-500 font-mono text-right">
                {formatCurrency(totalPayments)}
              </p>
              <p className="text-[13px] text-surface-600 text-right">—</p>
              <p className="text-[13px] text-surface-600 text-right">—</p>
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {sortedBank.length === 0 && sortedCC.length === 0 && (
        <div className="glass-card rounded-xl p-8 text-center">
          <Landmark className="w-12 h-12 text-surface-500 mx-auto mb-4" />
          <h3 className="font-medium text-surface-900 mb-1">No statements found</h3>
          <p className="text-[13px] text-surface-600">
            Upload bank or credit card statements to track deposits and reconcile against 1099s.
          </p>
        </div>
      )}
    </div>
  );
}
