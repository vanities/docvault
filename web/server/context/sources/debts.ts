import { loadDebtPayments } from '../../data.js';
import type { DebtPaymentItem } from '../../debt-payments.js';
import { debtId } from '../../debt-plan.js';
import { addDays, money, percent } from '../format.js';
import { contextHistory, diffHistory, type ContextHistory, type MetricChange } from '../history.js';
import type { ContextEvent, ContextSource, ContextWindow } from '../types.js';

const BASELINE_LOOKBACK_DAYS = 40;

/** Within this much of one month's scheduled principal, a drop is the regular payment. */
function isRegularPayment(paidDown: number, before: number, item?: DebtPaymentItem): boolean {
  if (!item || item.monthlyPayment <= 0) return false;
  const principal = item.monthlyPayment - (before * (item.rate ?? 0)) / 12;
  if (principal <= 0) return false;
  return Math.abs(paidDown - principal) <= Math.max(5, principal * 0.03);
}

export function describeDebtChange(change: MetricChange, item?: DebtPaymentItem): ContextEvent {
  const { before, after, label, date } = change;
  if (before === undefined) {
    return { date, text: `${label} added, ${money(after ?? 0)} owed`, amount: after };
  }
  if (after === undefined) {
    return {
      date,
      text: `${label} no longer listed (last balance ${money(before)})`,
      amount: -before,
    };
  }
  const delta = after - before;
  const range = `${money(before)} to ${money(after)}`;
  if (delta < 0) {
    const regular = isRegularPayment(-delta, before, item)
      ? ', about one regular monthly payment'
      : '';
    return {
      date,
      text: `${label} balance down ${money(-delta)} (${range})${regular}`,
      amount: delta,
    };
  }
  return { date, text: `${label} balance up ${money(delta)} (${range})`, amount: delta };
}

export async function debtChanges(
  window: ContextWindow,
  history: ContextHistory = contextHistory,
  current?: DebtPaymentItem[]
): Promise<ContextEvent[]> {
  const [days, items] = await Promise.all([
    history.load('debts', addDays(window.from, -BASELINE_LOOKBACK_DAYS), window.to),
    current ? Promise.resolve(current) : loadDebtPayments().then((d) => d.items),
  ]);
  const byId = new Map(items.map((i) => [debtId(i), i]));
  return diffHistory(days, window, 1).map((c) => describeDebtChange(c, byId.get(c.key)));
}

export function debtsState(items: DebtPaymentItem[], monthlyTotal: number): string[] {
  if (!items.length) return [];
  const owed = items.reduce((s, i) => s + i.balance, 0);
  const manual = items.filter((i) => i.source === 'manual').reduce((s, i) => s + i.balance, 0);
  const lines = [
    `Debts: ${items.length}, ${money(owed)} owed, ${money(monthlyTotal)} a month in payments.`,
  ];
  for (const i of [...items].sort((a, b) => b.balance - a.balance)) {
    const lender = i.lender ? `, ${i.lender}` : '';
    const rate = i.rate !== undefined ? ` at ${percent(i.rate)}` : '';
    const payment = `${money(i.monthlyPayment)}/mo${i.estimated ? ' (estimated)' : ''}`;
    lines.push(`${i.name} (${i.kind}${lender}): ${money(i.balance)}${rate}, ${payment}.`);
  }
  // The portfolio total nets mortgages inside property equity and bank-synced
  // loans and cards inside the bank figure, but never subtracts debts typed in
  // by hand. Without this line a model reads that total as net worth.
  lines.push(
    'The portfolio net-worth total already subtracts property mortgages (inside property equity) ' +
      'and bank-synced loans and cards (inside bank). It does not subtract hand-entered debts' +
      (manual > 0 ? `, which come to ${money(manual)}.` : '; there are none.')
  );
  return lines;
}

export const debtsSource: ContextSource = {
  id: 'debts',
  label: 'Debts',
  group: 'money',
  description:
    'Every debt from the Debts page: property mortgages, loans added by hand, and bank-synced ' +
    'loans and cards, with balance, rate and monthly payment. Balances are recorded daily, so ' +
    'paydowns and new borrowing show up as dated changes.',
  files: ['.docvault-liabilities.json', '.docvault-property.json'],
  async state() {
    const { items, total } = await loadDebtPayments();
    return debtsState(items, total);
  },
  changes: (window) => debtChanges(window),
  async metrics() {
    const { items } = await loadDebtPayments();
    // Card balances move with every purchase and already sit in bank-accounts history.
    return Object.fromEntries(
      items
        .filter((i) => !i.card)
        .map((i) => [debtId(i), { label: `${i.name} (${i.kind})`, value: i.balance }])
    );
  },
};
