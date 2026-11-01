// The bank transaction ledger: every posted transaction the SimpleFIN sync has
// seen, kept after SimpleFIN's 90-day window rolls past it.
//
// Balances alone can't say where money went. A weekly Newsstand edition
// (2026-11-01) saw checking fall and told the owner to find where the money
// went; it had paid down a loan. This ledger is the record that answers that
// question. The SimpleFIN sync (simplefin-sync.ts) is its only
// writer.

import { promises as fs } from 'fs';

export interface BankTransaction {
  /** SimpleFIN's id; unique within its account, not across accounts. */
  id: string;
  accountId: string;
  /** Posting date, YYYY-MM-DD (UTC). */
  posted: string;
  /** Signed: negative is money leaving the account, or a new charge on a card. */
  amount: number;
  description: string;
  payee?: string;
  memo?: string;
  /** Purchase date when the bank reports one separately, YYYY-MM-DD. */
  transactedAt?: string;
}

export interface BankTransactionLedger {
  version: 1;
  /** When the ledger last merged a fetch. Drives the next fetch's start date. */
  updatedAt?: string;
  /** Earliest date any fetch has asked for. Nothing older was ever requested. */
  coveredFrom?: string;
  accounts: Record<string, { name: string; connectionName?: string }>;
  /** Newest first. */
  transactions: BankTransaction[];
}

/** SimpleFIN returns at most 90 days (one day of margin here). It also warns past
 * 45 days and says it may cap there later; only the first backfill, or the
 * catch-up after a long outage, asks for that much. */
export const MAX_FETCH_DAYS = 89;
/** Re-read this far behind the last fetch: banks post some transactions back-dated. */
const OVERLAP_DAYS = 10;
const DAY_MS = 86_400_000;

export function emptyLedger(): BankTransactionLedger {
  return { version: 1, accounts: {}, transactions: [] };
}

/** ENOENT is an empty ledger. Anything else throws: an unreadable ledger must
 * never be replaced by a fresh one, which would drop history SimpleFIN can no
 * longer return. */
export async function loadBankTransactions(file: string): Promise<BankTransactionLedger> {
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyLedger();
    throw error;
  }
  const parsed = JSON.parse(raw) as Partial<BankTransactionLedger>;
  if (!Array.isArray(parsed.transactions)) {
    throw new Error(`${file} has no transactions array`);
  }
  return {
    version: 1,
    updatedAt: parsed.updatedAt,
    coveredFrom: parsed.coveredFrom,
    accounts: parsed.accounts ?? {},
    transactions: parsed.transactions,
  };
}

const ymd = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** The `start-date` (unix seconds) for the next fetch: back to the last fetch
 * minus an overlap, never further than SimpleFIN allows. */
export function transactionsStartDate(ledger: BankTransactionLedger, now: Date): number {
  const floor = now.getTime() - MAX_FETCH_DAYS * DAY_MS;
  const last = ledger.updatedAt ? Date.parse(ledger.updatedAt) : NaN;
  const wanted = Number.isFinite(last) ? last - OVERLAP_DAYS * DAY_MS : floor;
  return Math.floor(Math.max(floor, wanted) / 1000);
}

const keyOf = (t: Pick<BankTransaction, 'accountId' | 'id'>) => `${t.accountId}\u0000${t.id}`;

/** Fold a fetch into the ledger. A transaction seen again replaces the stored
 * copy, since banks sometimes rewrite descriptions after posting. Pure. */
export function mergeBankTransactions(
  ledger: BankTransactionLedger,
  incoming: BankTransaction[],
  accounts: Record<string, { name: string; connectionName?: string }>,
  requestedFrom: string,
  now: Date
): BankTransactionLedger {
  const byKey = new Map(ledger.transactions.map((t) => [keyOf(t), t]));
  for (const t of incoming) byKey.set(keyOf(t), t);
  const transactions = [...byKey.values()].sort(
    (a, b) =>
      b.posted.localeCompare(a.posted) ||
      a.accountId.localeCompare(b.accountId) ||
      a.id.localeCompare(b.id)
  );
  const coveredFrom =
    ledger.coveredFrom && ledger.coveredFrom < requestedFrom ? ledger.coveredFrom : requestedFrom;
  return {
    version: 1,
    updatedAt: now.toISOString(),
    coveredFrom,
    accounts: { ...ledger.accounts, ...accounts },
    transactions,
  };
}

/** Transactions posted between two dates, inclusive, newest first. */
export function transactionsBetween(
  ledger: BankTransactionLedger,
  from: string,
  to: string
): BankTransaction[] {
  return ledger.transactions.filter((t) => t.posted >= from && t.posted <= to);
}

export function unixToYmd(seconds: number): string {
  return ymd(seconds * 1000);
}
