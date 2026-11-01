import { accountTypeLabel } from '../../account-classify.js';
import type { BankRollup, RolledUpAccount, RollupBankAccount } from '../../bank-rollup.js';
import {
  loadAccountAnnotations,
  loadSimplefinCache,
  rollUpCachedBankAccounts,
} from '../../data.js';
import { addDays, daysBetween, money, signedMoney } from '../format.js';
import { contextHistory, diffHistory, type ContextHistory } from '../history.js';
import type { ContextEvent, ContextSource, ContextWindow } from '../types.js';

/** A one-day move this large is worth a line; smaller ones are everyday spending. */
export const LARGE_ACCOUNT_MOVE = 1000;
/** How far back to look for the recorded day a window's first change compares with. */
const BASELINE_LOOKBACK_DAYS = 40;

function countedNote(r: RolledUpAccount | undefined): string {
  switch (r?.countedIn) {
    case 'brokerage':
      return ', counted as brokerage';
    case 'crypto':
      return ', counted as crypto';
    case 'elsewhere':
      return `, left out of totals because ${r.duplicateOf ?? 'another sync'} already counts it`;
    default:
      return '';
  }
}

export interface BankAccountsInput {
  accounts: RollupBankAccount[];
  rollup: BankRollup;
  kindOf: (account: RollupBankAccount) => string;
  lastUpdated?: string;
}

/** Accounts holding under a dollar are listed only as a count. Pure. */
export function describeBankAccounts({
  accounts,
  rollup,
  kindOf,
  lastUpdated,
}: BankAccountsInput): string[] {
  if (!accounts.length) return [];
  const byId = new Map(rollup.accounts.map((r) => [r.id, r]));
  const asOf = lastUpdated ? ` as of ${lastUpdated.slice(0, 10)}` : '';
  const lines = [
    `Bank-synced accounts${asOf}: cash ${money(rollup.liquidCash)}, ` +
      `bank-synced debt ${money(-rollup.totalDebt)}, ${accounts.length} accounts.`,
  ];
  const held = accounts.filter((a) => Math.abs(a.balance) >= 1);
  for (const a of [...held].sort((x, y) => Math.abs(y.balance) - Math.abs(x.balance))) {
    const at = a.connectionName ? ` at ${a.connectionName}` : '';
    lines.push(`${a.name}${at} (${kindOf(a)}${countedNote(byId.get(a.id))}): ${money(a.balance)}.`);
  }
  const empty = accounts.length - held.length;
  if (empty > 0) lines.push(`${empty} more account(s) hold under $1 and are not listed.`);
  return lines;
}

export async function bankAccountsState(): Promise<string[]> {
  const { accounts, lastUpdated } = await loadSimplefinCache();
  if (!accounts.length) return [];
  const [rollup, annotations] = await Promise.all([
    rollUpCachedBankAccounts(accounts),
    loadAccountAnnotations(),
  ]);
  return describeBankAccounts({
    accounts,
    rollup,
    kindOf: (a) => accountTypeLabel(a.name, annotations[a.id], a.balance),
    lastUpdated,
  });
}

/** Large day-over-day balance moves from recorded history. Accounts that appear
 * or vanish are skipped: a dropped bank connection looks exactly like that. */
export async function bankAccountChanges(
  window: ContextWindow,
  history: ContextHistory = contextHistory
): Promise<ContextEvent[]> {
  const days = await history.load(
    'bank-accounts',
    addDays(window.from, -BASELINE_LOOKBACK_DAYS),
    window.to
  );
  const events: ContextEvent[] = [];
  for (const c of diffHistory(days, window)) {
    if (c.before === undefined || c.after === undefined) continue;
    const delta = c.after - c.before;
    if (Math.abs(delta) < LARGE_ACCOUNT_MOVE) continue;
    const gap = daysBetween(c.previousDate, c.date);
    const span = gap > 1 ? ` since ${c.previousDate}` : ' in a day';
    events.push({
      date: c.date,
      text: `${c.label}: ${signedMoney(delta)}${span} (${money(c.before)} to ${money(c.after)})`,
      amount: delta,
    });
  }
  return events;
}

export const bankAccountsSource: ContextSource = {
  id: 'bank-accounts',
  label: 'Bank accounts',
  group: 'money',
  description:
    'Every bank-synced account (checking, savings, cards, loans, and any brokerage or crypto ' +
    'account the bank link returns) with its balance, type, and which net-worth bucket it counts in. ' +
    'Balances are recorded daily, so large one-day moves are listed as changes.',
  files: ['.docvault-simplefin-cache.json', '.docvault-account-annotations.json'],
  state: bankAccountsState,
  changes: (window) => bankAccountChanges(window),
  async metrics() {
    const { accounts } = await loadSimplefinCache();
    return Object.fromEntries(
      accounts.map((a) => [
        `acct:${a.id}`,
        { label: a.connectionName ? `${a.name} at ${a.connectionName}` : a.name, value: a.balance },
      ])
    );
  },
};
