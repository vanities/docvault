// Shared account classification for SimpleFIN-sourced accounts.
//
// SimpleFIN does NOT return an account type — the payload is only
// { id, name, balance, availableBalance, ... } — so the type has to come from
// the user's explicit annotation, or be inferred from the account name.
//
// This module is the single source of truth for that inference. It lives in
// server/ because the frontend imports it too (see no-src-imports.test.ts:
// shared pure modules belong in server/, never the other way round).
//
// Two rules earn their keep here:
//
//  1. Match on WORD BOUNDARIES, never bare substrings. The old UI copy used
//     `name.toLowerCase().includes('chk')` to detect a checking account, which
//     also matches any name containing that letter run — a surname like
//     "PASCHKE" (mis-CHK-e) classified two business credit cards as checking
//     accounts. This is the Scunthorpe problem, and on financial data it
//     silently moves a liability into the cash column.
//
//  2. A negative balance is NEVER a depository account. If the name gives us
//     nothing, an account you owe money on is a liability that needs an
//     annotation — not "Checking" with a minus sign.

/**
 * User-supplied overrides for a SimpleFIN account, keyed by account id.
 * Declared here (not in data.ts) so this module stays free of node built-ins
 * and the browser bundle can import it.
 */
/** The annotation types a user can pick, and their labels. The Banks edit form
 *  renders its <select> straight off this list so the options can never drift
 *  from the union the API accepts. */
export const ACCOUNT_ANNOTATION_TYPES = [
  { value: 'auto-loan', label: 'Auto Loan' },
  { value: 'personal-loan', label: 'Personal Loan' },
  { value: 'student-loan', label: 'Student Loan' },
  { value: 'credit-card', label: 'Credit Card' },
  { value: 'mortgage', label: 'Mortgage' },
  { value: 'depository', label: 'Checking / Savings' },
  { value: 'investment', label: 'Investment / Retirement' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'other', label: 'Other' },
] as const;

export type AccountAnnotationType = (typeof ACCOUNT_ANNOTATION_TYPES)[number]['value'];

export function isAccountAnnotationType(v: string): v is AccountAnnotationType {
  return ACCOUNT_ANNOTATION_TYPES.some((t) => t.value === v);
}

export interface AccountAnnotation {
  rate?: number; // interest rate as decimal (e.g., 0.02 for 2%)
  type?: AccountAnnotationType;
  originalBalance?: number;
  term?: number; // months
  startDate?: string; // YYYY-MM-DD
  monthlyPayment?: number;
  notes?: string;
}

export type AccountCategory =
  | 'depository'
  | 'investment'
  | 'crypto'
  | 'credit-card'
  | 'line-of-credit'
  | 'auto-loan'
  | 'personal-loan'
  | 'student-loan'
  | 'mortgage'
  | 'other-liability';

/** Annotation types that map straight through to a category. */
const ANNOTATED_CATEGORIES = new Set<AccountAnnotation['type']>([
  'credit-card',
  'auto-loan',
  'personal-loan',
  'student-loan',
  'mortgage',
  'depository',
  'investment',
  'crypto',
]);

// Bank sync returns every account at a linked institution, including ones that
// are not spendable cash: a brokerage's 401(k), a payments app's Bitcoin
// balance. These patterns keep those out of the cash column.
//
// Plan names that never mean cash, even next to "savings" ("401(k) Savings
// Plan", "Health Savings Account").
const RETIREMENT_PLAN =
  /\b401\s*\(?k\b|\b403\s*\(?b\b|\b457\s*\(?b\b|\btsp\b|thrift savings|\bhsa\b|health savings/;
// Usually an investment account, but an explicit cash word wins: "IRA" is also
// a first name, and "IRA SMITH CHECKING" is a checking account.
const INVESTMENT_WORD = /\b(ira|brokerage|retirement|pension|annuity|investments?|investing)\b/;
const CRYPTO_WORD = /\b(bitcoin|btc|ethereum|crypto|cryptocurrency|litecoin|dogecoin|usdc|usdt)\b/;
const CASH_WORD = /\b(checking|chk|savings?|sav|money market)\b/;

export function categorizeAccount(
  name: string,
  annotation: AccountAnnotation | undefined,
  balance: number
): AccountCategory {
  // The user's explicit annotation always wins over any name guess.
  const t = annotation?.type;
  if (t && ANNOTATED_CATEGORIES.has(t)) return t as AccountCategory;

  const n = name.toLowerCase();
  // Credit cards — match common issuer / product names
  if (
    /\b(visa|mastercard|discover)\b/.test(n) ||
    /\bamex\b|american express/.test(n) ||
    /credit card|rewards card|signature card|prime rewards/.test(n)
  ) {
    return 'credit-card';
  }
  if (/line of credit|heloc/.test(n)) return 'line-of-credit';
  if (/mortgage/.test(n)) return 'mortgage';
  if (/(vehicle|auto|car)\s*loan|loan.*(vehicle|auto|truck|car)/.test(n)) return 'auto-loan';
  if (/\bloan\b/.test(n)) return 'personal-loan';
  // Only a non-negative balance can be an investment or crypto holding, so a
  // card issued in a name like "IRA SMITH" still lands as a liability below.
  if (balance >= 0) {
    if (RETIREMENT_PLAN.test(n)) return 'investment';
    if (!CASH_WORD.test(n)) {
      if (CRYPTO_WORD.test(n)) return 'crypto';
      if (INVESTMENT_WORD.test(n)) return 'investment';
    }
  }
  // Unknown negative balances should not be silently lumped into cash —
  // flag them so they show up as needing annotation.
  if (balance < 0) return 'other-liability';
  return 'depository';
}

/**
 * Human-readable label for the account list. Built on top of categorizeAccount
 * so the badge in the UI can never disagree with the category the snapshot,
 * the debt totals, and the strategy skill all use.
 */
export function accountTypeLabel(
  name: string,
  annotation: AccountAnnotation | undefined,
  balance: number
): string {
  const category = categorizeAccount(name, annotation, balance);
  switch (category) {
    case 'credit-card':
      return 'Credit Card';
    case 'line-of-credit':
      return 'Line of Credit';
    case 'auto-loan':
      return 'Auto Loan';
    case 'personal-loan':
      return 'Loan';
    case 'student-loan':
      return 'Student Loan';
    case 'mortgage':
      return 'Mortgage';
    case 'other-liability':
      // Owed money, but we can't tell what kind. Say so rather than guessing.
      return 'Liability';
    case 'investment':
      return 'Investment';
    case 'crypto':
      return 'Crypto';
    case 'depository':
      break;
  }

  // Depository refinements. `\bchk\b` (not `.includes('chk')`) so the token has
  // to stand alone the way Chase writes it in "BUS COMPLETE CHK".
  const n = name.toLowerCase();
  if (/money market/.test(n)) return 'Money Market';
  if (/\bsav(ings?)?\b/.test(n)) return 'Savings';
  if (/\bchecking\b|\bchk\b/.test(n)) return 'Checking';
  return 'Account';
}

/** Icon bucket for the account list — same classification, fewer buckets. */
export type AccountIconKind =
  | 'card'
  | 'savings'
  | 'loan'
  | 'checking'
  | 'investment'
  | 'crypto'
  | 'generic';

export function accountIconKind(
  name: string,
  annotation: AccountAnnotation | undefined,
  balance: number
): AccountIconKind {
  const category = categorizeAccount(name, annotation, balance);
  if (category === 'investment') return 'investment';
  if (category === 'crypto') return 'crypto';
  if (category === 'credit-card' || category === 'line-of-credit') return 'card';
  if (category === 'auto-loan' || category === 'mortgage') return 'loan';
  if (category === 'personal-loan' || category === 'student-loan') return 'loan';
  if (category === 'other-liability') return 'card';

  const n = name.toLowerCase();
  if (/money market/.test(n) || /\bsav(ings?)?\b/.test(n)) return 'savings';
  if (/\bchecking\b|\bchk\b/.test(n)) return 'checking';
  return 'generic';
}
