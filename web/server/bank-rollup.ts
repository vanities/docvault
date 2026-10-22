// The one answer to "what does each bank-synced account count as?"
//
// SimpleFIN returns every account at every linked institution: checking and
// cards, but also a brokerage's 401(k) or a payments app's Bitcoin balance.
// Those are not cash, and DocVault's brokerage and crypto syncs often value the
// same account themselves. Summing SimpleFIN balances directly therefore
// inflated "cash" and counted a retirement account twice, once under Bank
// Accounts and again under Brokerage.
//
// Every place that totals bank accounts goes through rollUpBankAccounts so they
// agree: the financial snapshot, the portfolio history recorder, and the Banks
// and Portfolio pages (via /api/simplefin/balances). Never sum SimpleFIN
// balances anywhere else.
//
// Pure (no node built-ins) so the browser bundle can import its types.

import {
  categorizeAccount,
  type AccountAnnotation,
  type AccountCategory,
} from './account-classify.js';

export interface RollupBankAccount {
  id: string;
  name: string;
  balance: number;
  connectionName?: string;
}

/** A brokerage account another sync already values. */
export interface RollupBrokerAccount {
  id: string;
  name: string;
}

/** A crypto sync source. Only exchanges can also show up in a bank sync. */
export interface RollupCryptoSource {
  sourceId: string;
  sourceType?: string;
  label: string;
}

/** Which net-worth bucket an account's balance lands in. */
export type CountedIn = 'cash' | 'debt' | 'brokerage' | 'crypto' | 'elsewhere';

export interface RolledUpAccount {
  id: string;
  category: AccountCategory;
  countedIn: CountedIn;
  /** The brokerage account or crypto source already counting it ('elsewhere' only). */
  duplicateOf?: string;
  /** This account's share of monthly debt service. */
  monthlyPayment: number;
}

export interface BankRollup {
  accounts: RolledUpAccount[];
  liquidCash: number;
  creditCardDebt: number;
  autoLoans: number;
  mortgageDebt: number;
  otherLoans: number;
  otherLiabilities: number;
  /** Sum of the debt buckets above (a negative number). */
  totalDebt: number;
  /** liquidCash + totalDebt: the "Bank Accounts" figure in net worth. */
  bankTotal: number;
  /** Bank-synced investment accounts no brokerage sync covers; add to Brokerage. */
  brokerageTotal: number;
  /** Bank-synced crypto no crypto sync covers; add to Crypto. */
  cryptoTotal: number;
  /** Balances left out of every total because another source already counts them. */
  countedElsewhereTotal: number;
  monthlyDebtService: number;
}

export function emptyBankRollup(): BankRollup {
  return rollUpBankAccounts([], {});
}

/** Last four digits of the last 4+ digit run: "(1234)", "- 1234", "Account 87651234". */
export function accountNumberTail(name: string): string | null {
  const runs = name.match(/\d{4,}/g);
  return runs ? runs[runs.length - 1].slice(-4) : null;
}

/** Lowercased words with account numbers and punctuation removed. */
export function normalizeAccountName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\d{4,}/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function sameInstitution(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `);
}

export function rollUpBankAccounts(
  accounts: RollupBankAccount[],
  annotations: Record<string, AccountAnnotation>,
  others: { brokerAccounts?: RollupBrokerAccount[]; cryptoSources?: RollupCryptoSource[] } = {}
): BankRollup {
  const brokerAccounts = others.brokerAccounts ?? [];
  const exchanges = (others.cryptoSources ?? []).filter(
    (s) => s.sourceType === undefined || s.sourceType === 'exchange'
  );

  const categories = new Map(
    accounts.map((a) => [a.id, categorizeAccount(a.name, annotations[a.id], a.balance)])
  );

  // Pair bank-synced investment accounts with brokerage accounts, one to one.
  // Account numbers go first and decide whenever both sides carry one, because
  // a shared name is not proof: two spouses can each hold a "Roth IRA".
  const brokerMatch = new Map<string, RollupBrokerAccount>();
  const used = new Set<string>();
  const investments = accounts.filter((a) => categories.get(a.id) === 'investment');
  for (const a of investments) {
    const tail = accountNumberTail(a.name);
    if (tail === null) continue;
    const hit = brokerAccounts.find((b) => !used.has(b.id) && accountNumberTail(b.name) === tail);
    if (hit) {
      brokerMatch.set(a.id, hit);
      used.add(hit.id);
    }
  }
  for (const a of investments) {
    if (brokerMatch.has(a.id)) continue;
    const tail = accountNumberTail(a.name);
    const name = normalizeAccountName(a.name);
    const hit = brokerAccounts.find((b) => {
      if (used.has(b.id) || !name) return false;
      if (tail !== null && accountNumberTail(b.name) !== null) return false;
      return normalizeAccountName(b.name) === name;
    });
    if (hit) {
      brokerMatch.set(a.id, hit);
      used.add(hit.id);
    }
  }

  const rollup: BankRollup = {
    accounts: [],
    liquidCash: 0,
    creditCardDebt: 0,
    autoLoans: 0,
    mortgageDebt: 0,
    otherLoans: 0,
    otherLiabilities: 0,
    totalDebt: 0,
    bankTotal: 0,
    brokerageTotal: 0,
    cryptoTotal: 0,
    countedElsewhereTotal: 0,
    monthlyDebtService: 0,
  };

  for (const a of accounts) {
    const category = categories.get(a.id)!;
    const balance = a.balance || 0;
    // A payment can't exceed what is left to pay. A paid-off loan whose
    // annotation still lists its old payment contributes nothing, and a loan
    // with one small payment left contributes only that.
    const monthlyPayment = Math.min(annotations[a.id]?.monthlyPayment || 0, Math.abs(balance));
    let countedIn: CountedIn = 'debt';
    let duplicateOf: string | undefined;

    switch (category) {
      case 'depository':
        countedIn = 'cash';
        rollup.liquidCash += balance;
        break;
      case 'credit-card':
      case 'line-of-credit':
        rollup.creditCardDebt += balance;
        break;
      case 'auto-loan':
        rollup.autoLoans += balance;
        break;
      case 'mortgage':
        rollup.mortgageDebt += balance;
        break;
      case 'personal-loan':
      case 'student-loan':
        rollup.otherLoans += balance;
        break;
      case 'other-liability':
        rollup.otherLiabilities += balance;
        break;
      case 'investment': {
        const hit = brokerMatch.get(a.id);
        if (hit) {
          countedIn = 'elsewhere';
          duplicateOf = hit.name;
          rollup.countedElsewhereTotal += balance;
        } else {
          countedIn = 'brokerage';
          rollup.brokerageTotal += balance;
        }
        break;
      }
      case 'crypto': {
        const inst = normalizeAccountName(a.connectionName ?? '');
        const hit = exchanges.find(
          (s) =>
            sameInstitution(inst, normalizeAccountName(s.label)) ||
            sameInstitution(inst, normalizeAccountName(s.sourceId))
        );
        if (hit) {
          countedIn = 'elsewhere';
          duplicateOf = hit.label;
          rollup.countedElsewhereTotal += balance;
        } else {
          countedIn = 'crypto';
          rollup.cryptoTotal += balance;
        }
        break;
      }
    }

    rollup.monthlyDebtService += monthlyPayment;
    rollup.accounts.push({
      id: a.id,
      category,
      countedIn,
      ...(duplicateOf ? { duplicateOf } : {}),
      monthlyPayment,
    });
  }

  rollup.totalDebt =
    rollup.creditCardDebt +
    rollup.autoLoans +
    rollup.mortgageDebt +
    rollup.otherLoans +
    rollup.otherLiabilities;
  rollup.bankTotal = rollup.liquidCash + rollup.totalDebt;
  return rollup;
}
