import { useMemo, useState } from 'react';
import {
  Landmark,
  CreditCard,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Users,
  Check,
  X,
} from 'lucide-react';
import type { TaxDocument, IncomeSummary as IncomeSummaryType } from '../../types';
import { Card } from '@/components/ui/card';
import { Money } from '../common/Money';

interface StatementSummaryProps {
  bankDocs: TaxDocument[];
  ccDocs: TaxDocument[];
  incomeDocs: TaxDocument[];
  incomeSummary?: IncomeSummaryType;
}

interface PayerGroup {
  payer: string;
  depositTotal: number;
  depositCount: number;
  form1099Amount: number | null;
  form1099Payer: string | null;
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

/** Extract just the payer/company name from an ACH description */
function extractPayerName(desc: string): string {
  const origMatch = desc.match(/Orig CO Name:([^O]+?)(?:\s*Orig\s|$)/i);
  if (origMatch) return origMatch[1].trim();
  // Fallback: first meaningful chunk
  if (desc.length > 40) return desc.substring(0, 37) + '...';
  return desc;
}

/** Clean up ACH deposit descriptions to extract a readable source name */
function cleanDepositDescription(desc: string): string {
  const name = extractPayerName(desc);
  // Also try to extract invoice/reference info
  const invoiceMatch = desc.match(/(?:For\s+)?Invoice\s*(?:Number:?\s*)?(\S+)/i);
  if (invoiceMatch && name !== desc) {
    return `${name} (Inv ${invoiceMatch[1]})`;
  }
  return name;
}

/** Fuzzy match a deposit payer name against a 1099 payer name */
function payerMatches(depositPayer: string, form1099Payer: string): boolean {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+(inc|llc|corp|ltd|company|co)\s*$/i, '')
      .trim();
  const dp = normalize(depositPayer);
  const fp = normalize(form1099Payer);
  // Either one contains the other, or they share a common prefix
  return dp.includes(fp) || fp.includes(dp);
}

/** Get the total deposits number from parsed data (handles inconsistent AI field names) */
function getDepositTotal(data: Record<string, unknown> | undefined): number {
  if (!data) return 0;
  if (typeof data.totalDeposits === 'number') return data.totalDeposits;
  if (typeof data.totalDepositsAndAdditions === 'number') return data.totalDepositsAndAdditions;
  // Fall back to summing individual deposit transactions
  const txns = getDepositTransactions(data);
  return txns.reduce((s, t) => s + t.amount, 0);
}

/** Extract deposit transactions from parsed data (handles all AI parser formats) */
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

  // Format 2: "depositsAndAdditions" array
  if (result.length === 0) {
    const depsAddArr = data.depositsAndAdditions as
      | Array<{ date: string; description: string; amount: number }>
      | undefined;
    if (Array.isArray(depsAddArr)) {
      for (const t of depsAddArr) {
        if (t.amount > 0) {
          result.push({ date: t.date, description: t.description || '', amount: t.amount });
        }
      }
    }
  }

  // Format 3: "transactions" array with type: 'deposit' (e.g., January)
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
  const deposits = getDepositTotal(data);
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
          <Money>{formatCurrency(deposits)}</Money>
        </p>
        <p className="text-[13px] text-red-400 font-mono text-right">
          <Money>{formatCurrency(withdrawals)}</Money>
        </p>
        <p className="text-[13px] text-surface-950 font-mono text-right">
          {ending ? <Money>{formatCurrency(ending)}</Money> : '—'}
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
                <Money>{formatCurrency(txn.amount)}</Money>
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
        <p className="text-[13px] text-red-400 font-mono text-right">
          <Money>{formatCurrency(purchases)}</Money>
        </p>
        <p className="text-[13px] text-emerald-500 font-mono text-right">
          <Money>{formatCurrency(payments)}</Money>
        </p>
        <p className="text-[13px] text-surface-950 font-mono text-right">
          <Money>{formatCurrency(balance)}</Money>
        </p>
        <p className="text-[13px] text-surface-700 font-mono text-right">
          {limit ? <Money>{formatCurrency(limit)}</Money> : '—'}
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
                <Money>{formatCurrency(Math.abs(txn.amount))}</Money>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function StatementSummary({
  bankDocs,
  ccDocs,
  incomeDocs,
  incomeSummary,
}: StatementSummaryProps) {
  const sortedBank = [...bankDocs].sort((a, b) => getSortDate(a).localeCompare(getSortDate(b)));
  const sortedCC = [...ccDocs].sort((a, b) => getSortDate(a).localeCompare(getSortDate(b)));

  // Bank totals
  let totalDeposits = 0;
  let totalWithdrawals = 0;
  for (const doc of sortedBank) {
    const data = doc.parsedData as Record<string, unknown> | undefined;
    totalDeposits += getDepositTotal(data);
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

  // Group deposits by payer, match against 1099s
  const payerGroups = useMemo((): PayerGroup[] => {
    // Collect all deposit transactions across all bank statements
    const byPayer = new Map<string, { total: number; count: number }>();
    for (const doc of bankDocs) {
      const data = doc.parsedData as Record<string, unknown> | undefined;
      const txns = getDepositTransactions(data);
      for (const txn of txns) {
        const payer = extractPayerName(txn.description);
        const existing = byPayer.get(payer);
        if (existing) {
          existing.total += txn.amount;
          existing.count++;
        } else {
          byPayer.set(payer, { total: txn.amount, count: 1 });
        }
      }
    }

    // Build 1099 lookup from incomeDocs
    const form1099s: { payer: string; amount: number }[] = [];
    for (const doc of incomeDocs) {
      if (!doc.type.startsWith('1099')) continue;
      const data = doc.parsedData as Record<string, unknown> | undefined;
      if (!data) continue;
      const payer =
        (data.payer as string) || (data.payerName as string) || doc.fileName.split('_')[0];
      const amount = Number(
        data.nonemployeeCompensation ??
          data.ordinaryDividends ??
          data.interestIncome ??
          data.amount ??
          0
      );
      if (amount > 0) {
        form1099s.push({ payer, amount });
      }
    }

    // Match each deposit payer to a 1099
    const groups: PayerGroup[] = [];
    const matched1099s = new Set<number>();

    for (const [payer, { total, count }] of byPayer) {
      let matchedAmount: number | null = null;
      let matchedPayer: string | null = null;
      for (let i = 0; i < form1099s.length; i++) {
        if (matched1099s.has(i)) continue;
        if (payerMatches(payer, form1099s[i].payer)) {
          matchedAmount = form1099s[i].amount;
          matchedPayer = form1099s[i].payer;
          matched1099s.add(i);
          break;
        }
      }
      groups.push({
        payer,
        depositTotal: total,
        depositCount: count,
        form1099Amount: matchedAmount,
        form1099Payer: matchedPayer,
      });
    }

    // Add any unmatched 1099s (payer sent 1099 but no matching bank deposits found)
    for (let i = 0; i < form1099s.length; i++) {
      if (matched1099s.has(i)) continue;
      groups.push({
        payer: form1099s[i].payer,
        depositTotal: 0,
        depositCount: 0,
        form1099Amount: form1099s[i].amount,
        form1099Payer: form1099s[i].payer,
      });
    }

    // Sort by deposit total descending
    return groups.sort((a, b) => b.depositTotal - a.depositTotal);
  }, [bankDocs, incomeDocs]);

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card variant="glass" className="p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <Landmark className="w-5 h-5 text-blue-400" />
            </div>
            <h3 className="font-semibold text-surface-950 text-[13px]">Bank Deposits</h3>
          </div>
          <p className="text-3xl font-bold text-surface-950 font-mono tracking-tight">
            <Money>{formatCurrency(totalDeposits)}</Money>
          </p>
          <p className="text-[11px] text-surface-600 mt-1">
            {sortedBank.length} statement{sortedBank.length !== 1 ? 's' : ''}
          </p>
        </Card>

        <Card variant="glass" className="p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-purple-500/10 rounded-lg">
              <CreditCard className="w-5 h-5 text-purple-400" />
            </div>
            <h3 className="font-semibold text-surface-950 text-[13px]">CC Purchases</h3>
          </div>
          <p className="text-3xl font-bold text-surface-950 font-mono tracking-tight">
            <Money>{formatCurrency(totalPurchases)}</Money>
          </p>
          <p className="text-[11px] text-surface-600 mt-1">
            {sortedCC.length} statement{sortedCC.length !== 1 ? 's' : ''}
          </p>
        </Card>

        {income1099Total > 0 && (
          <Card variant="glass" className="p-5">
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
              <Money>{formatCurrency(difference)}</Money>
            </p>
            <p className="text-[11px] text-surface-600 mt-1">
              <Money>{formatCurrency(totalDeposits)}</Money> deposits −{' '}
              <Money>{formatCurrency(income1099Total)}</Money> 1099s
            </p>
          </Card>
        )}
      </div>

      {/* Deposits by Payer — reconciliation against 1099s */}
      {payerGroups.length > 0 && (
        <Card variant="glass" className="p-5">
          <h3 className="font-semibold text-surface-950 mb-4 text-[14px] flex items-center gap-2">
            <Users className="w-4 h-4 text-surface-600" />
            Deposits by Payer
          </h3>

          <div className="overflow-x-auto scrollbar-hide">
            <div className="min-w-[420px] space-y-0.5">
              {/* Header */}
              <div className="grid grid-cols-4 gap-3 px-4 pb-2 border-b border-border">
                <p className="text-[11px] font-semibold text-surface-600 uppercase tracking-wider">
                  Payer
                </p>
                <p className="text-[11px] font-semibold text-surface-600 uppercase tracking-wider text-right">
                  Bank Deposits
                </p>
                <p className="text-[11px] font-semibold text-surface-600 uppercase tracking-wider text-right">
                  1099 Amount
                </p>
                <p className="text-[11px] font-semibold text-surface-600 uppercase tracking-wider text-right">
                  Difference
                </p>
              </div>

              {payerGroups.map((group) => {
                const diff =
                  group.form1099Amount !== null ? group.depositTotal - group.form1099Amount : null;
                const isMatched = diff !== null && Math.abs(diff) < 1;
                const hasWarning = diff !== null && Math.abs(diff) >= 1;

                return (
                  <div
                    key={group.payer}
                    className="grid grid-cols-4 gap-3 px-4 py-2.5 hover:bg-surface-200/30 rounded-lg transition-colors"
                  >
                    <div>
                      <p className="text-[13px] text-surface-950 font-medium">{group.payer}</p>
                      <p className="text-[11px] text-surface-500">
                        {group.depositCount} deposit{group.depositCount !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <p className="text-[13px] text-emerald-500 font-mono text-right self-center">
                      {group.depositTotal > 0 ? (
                        <Money>{formatCurrency(group.depositTotal)}</Money>
                      ) : (
                        '—'
                      )}
                    </p>
                    <p className="text-[13px] text-surface-950 font-mono text-right self-center">
                      {group.form1099Amount !== null ? (
                        <Money>{formatCurrency(group.form1099Amount)}</Money>
                      ) : (
                        <span className="text-surface-400 text-[11px]">No 1099</span>
                      )}
                    </p>
                    <div className="text-right self-center flex items-center justify-end gap-1.5">
                      {isMatched && (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-[12px] text-emerald-400 font-medium">Match</span>
                        </>
                      )}
                      {hasWarning && (
                        <>
                          <X className="w-3.5 h-3.5 text-amber-400" />
                          <span className="text-[13px] text-amber-400 font-mono">
                            {diff! >= 0 ? '+' : ''}
                            <Money>{formatCurrency(diff!)}</Money>
                          </span>
                        </>
                      )}
                      {diff === null && group.depositTotal > 0 && (
                        <span className="text-[11px] text-surface-400">—</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      )}

      {/* Bank Statements */}
      {sortedBank.length > 0 && (
        <Card variant="glass" className="p-5">
          <h3 className="font-semibold text-surface-950 mb-4 text-[14px]">
            Bank Statements ({sortedBank.length})
          </h3>

          <div className="overflow-x-auto scrollbar-hide">
            <div className="min-w-[480px] space-y-0.5">
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
                  <Money>{formatCurrency(totalDeposits)}</Money>
                </p>
                <p className="text-[13px] font-semibold text-red-400 font-mono text-right">
                  <Money>{formatCurrency(totalWithdrawals)}</Money>
                </p>
                <p className="text-[13px] text-surface-600 text-right">—</p>
                <p className="text-[13px] text-surface-600 text-right">—</p>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Credit Card Statements */}
      {sortedCC.length > 0 && (
        <Card variant="glass" className="p-5">
          <h3 className="font-semibold text-surface-950 mb-4 text-[14px]">
            Credit Card Statements ({sortedCC.length})
          </h3>

          <div className="overflow-x-auto scrollbar-hide">
            <div className="min-w-[480px] space-y-0.5">
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
                  <Money>{formatCurrency(totalPurchases)}</Money>
                </p>
                <p className="text-[13px] font-semibold text-emerald-500 font-mono text-right">
                  <Money>{formatCurrency(totalPayments)}</Money>
                </p>
                <p className="text-[13px] text-surface-600 text-right">—</p>
                <p className="text-[13px] text-surface-600 text-right">—</p>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Empty State */}
      {sortedBank.length === 0 && sortedCC.length === 0 && (
        <Card variant="glass" className="p-8 text-center">
          <Landmark className="w-12 h-12 text-surface-500 mx-auto mb-4" />
          <h3 className="font-medium text-surface-900 mb-1">No statements found</h3>
          <p className="text-[13px] text-surface-600">
            Upload bank or credit card statements to track deposits and reconcile against 1099s.
          </p>
        </Card>
      )}
    </div>
  );
}
