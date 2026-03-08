import { useState } from 'react';
import { Landmark, CreditCard, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import type { TaxDocument, IncomeSummary as IncomeSummaryType } from '../../types';

interface StatementSummaryProps {
  bankDocs: TaxDocument[];
  ccDocs: TaxDocument[];
  incomeSummary?: IncomeSummaryType;
}

interface DepositTransaction {
  date: string;
  description: string;
  amount: number;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount);
}

/** Clean up ACH deposit descriptions to extract a readable source name */
function cleanDepositDescription(desc: string): string {
  // Extract "Orig CO Name:" value — the company that sent the deposit
  const origMatch = desc.match(/Orig CO Name:([^O]+?)(?:\s*Orig\s|$)/i);
  if (origMatch) {
    let name = origMatch[1].trim();
    // Also try to extract invoice/reference info
    const invoiceMatch = desc.match(/(?:For\s+)?Invoice\s*(?:Number:?\s*)?(\S+)/i);
    if (invoiceMatch) {
      name += ` (Inv ${invoiceMatch[1]})`;
    }
    return name;
  }
  // Truncate long descriptions
  if (desc.length > 60) return desc.substring(0, 57) + '...';
  return desc;
}

/** Extract deposit transactions from parsed data (handles both formats) */
function getDepositTransactions(data: Record<string, unknown> | undefined): DepositTransaction[] {
  if (!data) return [];

  const result: DepositTransaction[] = [];

  // Format 1: separate "deposits" array (e.g., March, July)
  const depositsArr = data.deposits as
    | Array<{ date: string; description: string; amount: number }>
    | undefined;
  if (Array.isArray(depositsArr)) {
    for (const t of depositsArr) {
      if (t.amount > 0) {
        result.push({ date: t.date, description: t.description || '', amount: t.amount });
      }
    }
  }

  // Format 2: "transactions" array with type: 'deposit' (e.g., January)
  if (result.length === 0) {
    const txnsArr = data.transactions as
      | Array<{ date: string; description: string; amount: number; type?: string }>
      | undefined;
    if (Array.isArray(txnsArr)) {
      for (const t of txnsArr) {
        if (t.type === 'deposit' || (t.amount > 0 && t.type !== 'withdrawal')) {
          result.push({ date: t.date, description: t.description || '', amount: t.amount });
        }
      }
    }
  }

  return result;
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

function BankStatementRow({ doc }: { doc: TaxDocument }) {
  const [expanded, setExpanded] = useState(false);
  const data = doc.parsedData as Record<string, unknown> | undefined;
  const deposits = Number(data?.totalDeposits || 0);
  const withdrawals = Number(data?.totalWithdrawals || 0);
  const ending = Number(data?.endingBalance || 0);
  const count = Number(data?.depositCount || data?.depositsCount || 0);
  const depositTxns = getDepositTransactions(data);
  const hasDetails = depositTxns.length > 0;

  return (
    <div>
      <div
        onClick={() => hasDetails && setExpanded(!expanded)}
        className={`grid grid-cols-5 gap-3 px-4 py-2 rounded-lg transition-colors ${
          hasDetails ? 'cursor-pointer hover:bg-surface-200/30' : ''
        } ${expanded ? 'bg-surface-200/20' : ''}`}
      >
        <p className="text-[13px] text-surface-950 font-medium flex items-center gap-1">
          {hasDetails ? (
            expanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-surface-500 shrink-0" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-surface-500 shrink-0" />
            )
          ) : (
            <span className="w-3.5 shrink-0" />
          )}
          {getMonthLabel(doc)}
        </p>
        <p className="text-[13px] text-emerald-500 font-mono text-right">
          {formatCurrency(deposits)}
        </p>
        <p className="text-[13px] text-red-400 font-mono text-right">
          {formatCurrency(withdrawals)}
        </p>
        <p className="text-[13px] text-surface-950 font-mono text-right">
          {ending ? formatCurrency(ending) : '—'}
        </p>
        <p className="text-[13px] text-surface-700 font-mono text-right">{count || '—'}</p>
      </div>

      {/* Expanded deposit details */}
      {expanded && depositTxns.length > 0 && (
        <div className="ml-8 mr-4 mb-2 border-l-2 border-emerald-500/20 pl-3">
          {depositTxns.map((txn, i) => (
            <div
              key={i}
              className="flex items-center justify-between py-1.5 text-[12px] border-b border-border/50 last:border-0"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-surface-500 shrink-0">{txn.date}</span>
                <span className="text-surface-800 truncate">
                  {cleanDepositDescription(txn.description)}
                </span>
              </div>
              <span className="text-emerald-500 font-mono shrink-0 ml-3">
                {formatCurrency(txn.amount)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CreditCardStatementRow({ doc }: { doc: TaxDocument }) {
  const [expanded, setExpanded] = useState(false);
  const data = doc.parsedData as Record<string, unknown> | undefined;
  const purchases = Number(data?.purchases || data?.newCharges || 0);
  const payments = Math.abs(Number(data?.payments || 0));
  const balance = Number(data?.newBalance || data?.currentBalance || 0);
  const limit = Number(data?.creditLimit || 0);

  // Extract transactions
  const txnsArr = (data?.transactions || []) as Array<{
    date: string;
    description: string;
    amount: number;
  }>;
  const hasDetails = txnsArr.length > 0;

  return (
    <div>
      <div
        onClick={() => hasDetails && setExpanded(!expanded)}
        className={`grid grid-cols-5 gap-3 px-4 py-2 rounded-lg transition-colors ${
          hasDetails ? 'cursor-pointer hover:bg-surface-200/30' : ''
        } ${expanded ? 'bg-surface-200/20' : ''}`}
      >
        <p className="text-[13px] text-surface-950 font-medium flex items-center gap-1">
          {hasDetails ? (
            expanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-surface-500 shrink-0" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-surface-500 shrink-0" />
            )
          ) : (
            <span className="w-3.5 shrink-0" />
          )}
          {getMonthLabel(doc)}
        </p>
        <p className="text-[13px] text-red-400 font-mono text-right">{formatCurrency(purchases)}</p>
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

      {/* Expanded transaction details */}
      {expanded && txnsArr.length > 0 && (
        <div className="ml-8 mr-4 mb-2 border-l-2 border-purple-500/20 pl-3">
          {txnsArr.map((txn, i) => (
            <div
              key={i}
              className="flex items-center justify-between py-1.5 text-[12px] border-b border-border/50 last:border-0"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-surface-500 shrink-0">{txn.date}</span>
                <span className="text-surface-800 truncate">{txn.description}</span>
              </div>
              <span
                className={`font-mono shrink-0 ml-3 ${txn.amount < 0 ? 'text-emerald-500' : 'text-red-400'}`}
              >
                {formatCurrency(Math.abs(txn.amount))}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function StatementSummary({ bankDocs, ccDocs, incomeSummary }: StatementSummaryProps) {
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

  // Reconciliation
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

          <div className="space-y-0.5">
            {/* Header row */}
            <div className="grid grid-cols-5 gap-3 px-4 pb-2 border-b border-border">
              <p className="text-[11px] font-semibold text-surface-600 uppercase tracking-wider pl-5">
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

            {sortedBank.map((doc) => (
              <BankStatementRow key={doc.id} doc={doc} />
            ))}

            {/* Totals row */}
            <div className="grid grid-cols-5 gap-3 px-4 pt-2 border-t border-border">
              <p className="text-[13px] font-semibold text-surface-950 pl-5">Total</p>
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

          <div className="space-y-0.5">
            {/* Header row */}
            <div className="grid grid-cols-5 gap-3 px-4 pb-2 border-b border-border">
              <p className="text-[11px] font-semibold text-surface-600 uppercase tracking-wider pl-5">
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

            {sortedCC.map((doc) => (
              <CreditCardStatementRow key={doc.id} doc={doc} />
            ))}

            {/* Totals row */}
            <div className="grid grid-cols-5 gap-3 px-4 pt-2 border-t border-border">
              <p className="text-[13px] font-semibold text-surface-950 pl-5">Total</p>
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
