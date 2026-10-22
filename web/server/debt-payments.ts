// Every monthly debt payment in one list: property mortgages, debts added by
// hand on the Debts page, and bank-synced loans and cards.
//
// These live in three stores (Property, liabilities, SimpleFIN + annotations),
// and the Debts page used to total only the hand-added ones while the DTI
// figure merged all three somewhere else. This list is the one place the
// monthly debt total is built, so the Debts page, the DTI calculator, and the
// financial snapshot always agree. Pure, so the browser can import its types.

import { accountTypeLabel, type AccountAnnotation } from './account-classify.js';
import type { BankRollup, RollupBankAccount } from './bank-rollup.js';

export type DebtSource = 'property' | 'manual' | 'bank';

export interface DebtPaymentItem {
  source: DebtSource;
  name: string;
  /** Who it's owed to: the mortgage lender, loan lender, or bank. */
  lender?: string;
  /** "Mortgage", "Auto Loan", "Credit Card", ... */
  kind: string;
  /** Amount still owed, as a positive number. */
  balance: number;
  /** Annual rate as a decimal, when known. */
  rate?: number;
  monthlyPayment: number;
  /** DocVault estimated the payment (a card with no minimum typed in). */
  estimated?: boolean;
}

export interface DebtPayments {
  items: DebtPaymentItem[];
  /** Every monthly payment, estimates included: the DTI "existing debt service". */
  total: number;
  /** The estimated part of total. */
  estimatedTotal: number;
  bySource: Record<DebtSource, number>;
}

export interface DebtPaymentInputs {
  properties: {
    name: string;
    mortgage?: { lender?: string; balance: number; rate?: number; monthlyPayment?: number };
  }[];
  liabilities: {
    name: string;
    lender?: string;
    balance: number;
    rate?: number;
    monthlyPayment?: number;
  }[];
  bankAccounts: RollupBankAccount[];
  bankRollup: BankRollup;
  annotations: Record<string, AccountAnnotation>;
}

export function buildDebtPayments(input: DebtPaymentInputs): DebtPayments {
  const items: DebtPaymentItem[] = [];

  // Same rule as bank loans: nothing owed means no payment, even when an old
  // payment is still saved on the entry, and a payment never exceeds the balance.
  for (const p of input.properties) {
    const m = p.mortgage;
    if (!m || m.balance <= 0) continue;
    items.push({
      source: 'property',
      name: p.name,
      lender: m.lender || undefined,
      kind: 'Mortgage',
      balance: m.balance,
      rate: m.rate,
      monthlyPayment: Math.min(m.monthlyPayment || 0, m.balance),
    });
  }

  for (const l of input.liabilities) {
    if (l.balance <= 0) continue;
    items.push({
      source: 'manual',
      name: l.name,
      lender: l.lender || undefined,
      kind: 'Added here',
      balance: l.balance,
      rate: l.rate,
      monthlyPayment: Math.min(l.monthlyPayment || 0, l.balance),
    });
  }

  // Bank-synced accounts take their payment from the rollup, which already
  // caps typed payments at the balance and estimates card minimums. An account
  // with nothing to pay (a paid-off loan, a card at $0) is left out.
  const rolledUp = new Map(input.bankRollup.accounts.map((r) => [r.id, r]));
  for (const a of input.bankAccounts) {
    const r = rolledUp.get(a.id);
    if (!r || r.monthlyPayment <= 0) continue;
    const ann = input.annotations[a.id];
    items.push({
      source: 'bank',
      name: ann?.notes || a.name,
      lender: a.connectionName,
      kind: accountTypeLabel(a.name, ann, a.balance),
      balance: Math.abs(a.balance),
      rate: ann?.rate,
      monthlyPayment: r.monthlyPayment,
      ...(r.paymentEstimated ? { estimated: true } : {}),
    });
  }

  // Known payments first, largest to smallest; estimates after them.
  items.sort(
    (x, y) => Number(!!x.estimated) - Number(!!y.estimated) || y.monthlyPayment - x.monthlyPayment
  );

  const sum = (pred: (i: DebtPaymentItem) => boolean) =>
    items.filter(pred).reduce((s, i) => s + i.monthlyPayment, 0);
  return {
    items,
    total: sum(() => true),
    estimatedTotal: sum((i) => !!i.estimated),
    bySource: {
      property: sum((i) => i.source === 'property'),
      manual: sum((i) => i.source === 'manual'),
      bank: sum((i) => i.source === 'bank'),
    },
  };
}
