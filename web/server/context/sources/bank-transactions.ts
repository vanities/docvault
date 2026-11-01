import {
  loadBankTransactions,
  transactionsBetween,
  type BankTransaction,
  type BankTransactionLedger,
} from '../../bank-transactions.js';
import { BANK_TRANSACTIONS_FILE } from '../../data.js';
import { clip, signedMoney } from '../format.js';
import { readEventSource } from '../events.js';
import type { ContextEvent, ContextSource, ContextWindow } from '../types.js';

const words = (s: string) => s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];

/** The bank's raw text adds nothing when it already names the payee
 * ("ACH Debit - Acme Lending 123" for payee "Acme Lending"). */
function descriptionAddsInfo(payee: string, description: string): boolean {
  const lead = words(payee).slice(0, 2);
  const text = new Set(words(description));
  return lead.length === 0 || !lead.every((w) => text.has(w));
}

export function describeTransaction(t: BankTransaction, ledger: BankTransactionLedger): string {
  const who = t.payee || t.description || 'no description';
  const extra =
    t.payee && t.description && descriptionAddsInfo(t.payee, t.description)
      ? ` (${clip(t.description, 60)})`
      : '';
  const account = ledger.accounts[t.accountId]?.name ?? 'an unlisted account';
  return `${signedMoney(t.amount, true)} ${clip(who, 60)}${extra}, ${account}`;
}

export function transactionEvents(
  ledger: BankTransactionLedger,
  window: ContextWindow
): ContextEvent[] {
  return transactionsBetween(ledger, window.from, window.to)
    .map((t) => ({ date: t.posted, text: describeTransaction(t, ledger), amount: t.amount }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function transactionLedgerState(ledger: BankTransactionLedger): string[] {
  if (!ledger.transactions.length) return [];
  const newest = ledger.transactions[0].posted;
  const oldest = ledger.transactions[ledger.transactions.length - 1].posted;
  const accounts = new Set(ledger.transactions.map((t) => t.accountId)).size;
  return [
    `Bank transaction history: ${ledger.transactions.length} posted transactions across ` +
      `${accounts} accounts, ${oldest} to ${newest}` +
      (ledger.updatedAt ? `, last fetched ${ledger.updatedAt.slice(0, 10)}.` : '.'),
  ];
}

export const bankTransactionsSource: ContextSource = {
  id: 'bank-transactions',
  label: 'Bank transactions',
  group: 'money',
  description:
    'Posted transactions from bank-synced accounts (date, signed amount, payee, account), kept ' +
    'beyond the bank link’s 90-day window. Shows where cash went: loan payments, transfers ' +
    'between accounts, tax payments, card payments, deposits.',
  files: ['.docvault-bank-transactions.json'],
  read: (req) =>
    readEventSource(bankTransactionsSource, req, async () =>
      transactionLedgerState(await loadBankTransactions(BANK_TRANSACTIONS_FILE))
    ),
  async events(window) {
    return transactionEvents(await loadBankTransactions(BANK_TRANSACTIONS_FILE), window);
  },
};
