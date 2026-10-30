// Payoff and financial-freedom projection across every debt at once.
//
// LoanAmortization projects one loan on its own. This runs every debt through
// one monthly loop, so a payment freed by one payoff rolls onto the next debt,
// and "debt-free" and "financially free" come off the same timeline. Pure (no
// I/O): the Debts page renders it, and server code can call it too.
//
// Everything is in today's dollars: payments are fixed amounts, so investment
// growth is a real (after-inflation) rate and living expenses stay flat.

import type { DebtPaymentItem } from './debt-payments.js';

export type PayoffOrder = 'avalanche' | 'snowball';

/** The Payoff plan's saved inputs (`.docvault-debt-plan.json`). */
export interface DebtPlanSettings {
  /** Paid toward debt each month on top of the scheduled payments. */
  extraMonthly: number;
  /** Which debt the extra and freed-up payments go to first. */
  order: PayoffOrder;
  /** Credit cards are cleared every statement, so they're spending, not debt. */
  cardsPaidInFull: boolean;
  /** Monthly spending that isn't a debt payment. 0 means not entered yet. */
  livingExpenses: number;
  /** Put into investments each month today, outside debt payments. */
  monthlySavings: number;
  /** Income that keeps coming without work. null means the Income page total. */
  passiveIncome: number | null;
  /** Investments counted toward freedom. null means the snapshot's total. */
  investments: number | null;
  /** Yearly growth on investments after inflation, as a decimal. */
  realReturn: number;
  /** Share of investments drawn each year once free, as a decimal. */
  withdrawalRate: number;
  updatedAt?: string;
}

export const DEFAULT_DEBT_PLAN_SETTINGS: DebtPlanSettings = {
  extraMonthly: 0,
  order: 'avalanche',
  cardsPaidInFull: false,
  livingExpenses: 0,
  monthlySavings: 0,
  passiveIncome: null,
  investments: null,
  realReturn: 0.05,
  withdrawalRate: 0.04,
};

const isMoney = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e10;
const isRate = (min: number, max: number) => (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

const FIELD_CHECKS: Record<
  Exclude<keyof DebtPlanSettings, 'updatedAt'>,
  (v: unknown) => boolean
> = {
  extraMonthly: isMoney,
  order: (v) => v === 'avalanche' || v === 'snowball',
  cardsPaidInFull: (v) => typeof v === 'boolean',
  livingExpenses: isMoney,
  monthlySavings: isMoney,
  passiveIncome: (v) => v === null || isMoney(v),
  investments: (v) => v === null || isMoney(v),
  realReturn: isRate(-0.2, 0.2),
  // A 0% draw would make freedom impossible by definition.
  withdrawalRate: (v) => isRate(0, 0.2)(v) && (v as number) > 0,
};

/**
 * Merge a partial update into saved settings. A field that fails its check
 * keeps its current value and is named in `invalid`; unknown fields and the
 * server-owned updatedAt are ignored.
 */
export function applyDebtPlanPatch(
  current: DebtPlanSettings,
  patch: unknown
): { settings: DebtPlanSettings; invalid: string[] } {
  const settings = { ...current };
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { settings, invalid: ['body'] };
  }
  const invalid: string[] = [];
  for (const [key, check] of Object.entries(FIELD_CHECKS)) {
    if (!(key in patch)) continue;
    const value = (patch as Record<string, unknown>)[key];
    if (check(value)) Object.assign(settings, { [key]: value });
    else invalid.push(key);
  }
  return { settings, invalid };
}

export interface PlanDebt {
  /** Stable id, used as the chart series key. */
  key: string;
  name: string;
  balance: number;
  /** Annual rate as a decimal. An unknown rate counts as 0. */
  rate: number;
  monthlyPayment: number;
}

/**
 * The Debts list as the plan sees it. Keys come from each item's place in the
 * full list, so leaving cards out doesn't shift another debt's key (or color).
 */
export function planDebts(items: DebtPaymentItem[], cardsPaidInFull: boolean): PlanDebt[] {
  return items
    .map((d, i) => ({ item: d, key: `debt${i}` }))
    .filter(({ item }) => !(cardsPaidInFull && item.card))
    .map(({ item, key }) => ({
      key,
      name: item.name,
      balance: item.balance,
      rate: item.rate ?? 0,
      monthlyPayment: item.monthlyPayment,
    }));
}

export interface DebtPlanInput {
  debts: PlanDebt[];
  extraMonthly: number;
  order: PayoffOrder;
  livingExpenses: number;
  monthlySavings: number;
  passiveIncome: number;
  investments: number;
  realReturn: number;
  withdrawalRate: number;
  /** Any day this month. Month 0 is this month as it stands; payments start next month. */
  today?: Date;
  /** Cap on projected months (default 600, 50 years). */
  maxMonths?: number;
}

export interface DebtPlanMonth {
  /** YYYY-MM. Index 0 is this month, before the next payment. */
  month: string;
  /** Owed on each debt after this month's payments, under the plan. */
  owed: Record<string, number>;
  totalOwed: number;
  /** Total owed if every debt only ever gets its scheduled payment. */
  totalOwedAsScheduled: number;
  /** Scheduled payment on each debt still open: the part of the month you can't skip. */
  payments: Record<string, number>;
  /** Living expenses plus this month's scheduled payments. */
  needs: number;
  /** Investments at the end of the month. */
  invested: number;
  /** Passive income plus what the investments can pay out this month. */
  passive: number;
}

export interface DebtPlanResult {
  months: DebtPlanMonth[];
  /** Month of the last payment under the plan; null if it isn't within the cap. */
  debtFree: string | null;
  debtFreeAsScheduled: string | null;
  paidOff: Record<string, string | null>;
  paidOffAsScheduled: Record<string, string | null>;
  interest: number;
  interestAsScheduled: number;
  /** First month passive income covers needs; null without living expenses or within the cap. */
  free: string | null;
  /** Debts whose scheduled payment doesn't cover their interest, so they never pay off on schedule. */
  growing: string[];
  /** Paid toward debt every month under the plan until nothing is owed. */
  debtBudget: number;
}

// Half a cent: below this a balance is paid off (float dust from the interest math).
const PAID = 0.005;

function monthLabel(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// A payment rounded to the cent (1,000.00 over 3 months is 333.33) leaves a
// few cents after the last one. Lenders fold them into that final payment, so
// a remainder under a dollar is paid that month instead of a month later.
const ROUNDING = 1;

function scheduledPayment(due: number, payment: number): number {
  return due - payment < ROUNDING ? due : payment;
}

function total(values: Iterable<number>): number {
  let sum = 0;
  for (const v of values) sum += v;
  return sum;
}

function payoffOrder(debts: PlanDebt[], order: PayoffOrder): string[] {
  return [...debts]
    .sort((a, b) =>
      order === 'avalanche'
        ? b.rate - a.rate || a.balance - b.balance
        : a.balance - b.balance || b.rate - a.rate
    )
    .map((d) => d.key);
}

/**
 * Project every debt month by month two ways. As scheduled, each debt gets its
 * own payment and nothing more. Under the plan, the monthly total stays the
 * same, so the extra and every freed-up payment go down the payoff order, and
 * once nothing is owed that whole budget is invested. Freedom is the first
 * month passive income, plus a `withdrawalRate` draw on investments, covers
 * living expenses and the payments still due.
 */
export function projectDebtPlan(input: DebtPlanInput): DebtPlanResult {
  const maxMonths = input.maxMonths ?? 600;
  const today = input.today ?? new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const debts = input.debts.filter((d) => d.balance > PAID);
  const living = Math.max(0, input.livingExpenses);
  const savings = Math.max(0, input.monthlySavings);
  const growth = Math.pow(1 + input.realReturn, 1 / 12);
  const draw = input.withdrawalRate / 12;
  const order = payoffOrder(debts, input.order);
  const scheduled = total(debts.map((d) => d.monthlyPayment));
  const debtBudget = scheduled + Math.max(0, input.extraMonthly);

  const plan = new Map(debts.map((d) => [d.key, d.balance]));
  const asScheduled = new Map(plan);
  const paidOff: Record<string, string | null> = Object.fromEntries(
    debts.map((d) => [d.key, null])
  );
  const paidOffAsScheduled = { ...paidOff };
  const growing = debts
    .filter((d) => (d.balance * d.rate) / 12 >= d.monthlyPayment)
    .map((d) => d.key);

  const now = monthLabel(start);
  let invested = Math.max(0, input.investments);
  const nowNeeds = living + scheduled;
  const nowPassive = input.passiveIncome + invested * draw;
  const months: DebtPlanMonth[] = [
    {
      month: now,
      owed: Object.fromEntries(plan),
      totalOwed: total(plan.values()),
      totalOwedAsScheduled: total(plan.values()),
      payments: Object.fromEntries(debts.map((d) => [d.key, d.monthlyPayment])),
      needs: nowNeeds,
      invested,
      passive: nowPassive,
    },
  ];

  let debtFree = debts.length === 0 ? now : null;
  let debtFreeAsScheduled = debtFree;
  let free = living > 0 && nowPassive >= nowNeeds ? now : null;
  let interest = 0;
  let interestAsScheduled = 0;

  for (let i = 1; i <= maxMonths; i++) {
    const date = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const label = monthLabel(date);

    // Plan: every open debt accrues interest and gets its scheduled payment...
    const payments: Record<string, number> = {};
    for (const d of debts) {
      const balance = plan.get(d.key)!;
      if (balance <= PAID) continue;
      const charge = (balance * d.rate) / 12;
      const pay = scheduledPayment(balance + charge, d.monthlyPayment);
      interest += charge;
      payments[d.key] = pay;
      plan.set(d.key, balance + charge - pay);
    }
    // ...then what's left of the monthly budget goes down the payoff order.
    let pool = debtBudget - total(Object.values(payments));
    for (const key of order) {
      if (pool <= PAID) break;
      const balance = plan.get(key)!;
      if (balance <= PAID) continue;
      const amount = Math.min(pool, balance);
      plan.set(key, balance - amount);
      pool -= amount;
    }
    for (const d of debts) {
      if (paidOff[d.key] === null && plan.get(d.key)! <= PAID) {
        paidOff[d.key] = label;
        plan.set(d.key, 0);
      }
    }

    for (const d of debts) {
      const balance = asScheduled.get(d.key)!;
      if (balance <= PAID) continue;
      const charge = (balance * d.rate) / 12;
      const left = balance + charge - scheduledPayment(balance + charge, d.monthlyPayment);
      interestAsScheduled += charge;
      asScheduled.set(d.key, left <= PAID ? 0 : left);
      if (left <= PAID) paidOffAsScheduled[d.key] = label;
    }

    // Whatever the debts didn't take is invested, along with regular savings.
    invested = invested * growth + savings + Math.max(0, pool);
    const totalOwed = total(plan.values());
    const totalOwedAsScheduled = total(asScheduled.values());
    const needs = living + total(Object.values(payments));
    const passive = input.passiveIncome + invested * draw;
    months.push({
      month: label,
      owed: Object.fromEntries(plan),
      totalOwed,
      totalOwedAsScheduled,
      payments,
      needs,
      invested,
      passive,
    });

    if (debtFree === null && totalOwed <= PAID) debtFree = label;
    if (debtFreeAsScheduled === null && totalOwedAsScheduled <= PAID) debtFreeAsScheduled = label;
    if (free === null && living > 0 && passive >= needs) free = label;

    // Stop at the December after every milestone is known, so the last year
    // gets a year-end point. A debt that grows on schedule never pays off that
    // way, so don't wait for it.
    const settled =
      debtFree !== null &&
      (debtFreeAsScheduled !== null || growing.length > 0) &&
      (free !== null || living === 0);
    if (settled && date.getMonth() === 11) break;
  }

  return {
    months,
    debtFree,
    debtFreeAsScheduled,
    paidOff,
    paidOffAsScheduled,
    interest,
    interestAsScheduled,
    free,
    growing,
    debtBudget,
  };
}

/**
 * One point per year for charts and tables: this month, then each December
 * after it. A December less than six months out is skipped as too close to
 * "now". The final month is always kept so a capped run still shows its end.
 */
export function yearlyPoints(months: DebtPlanMonth[]): DebtPlanMonth[] {
  if (months.length === 0) return [];
  const points = [months[0]];
  for (let i = 6; i < months.length; i++) {
    if (months[i].month.endsWith('-12')) points.push(months[i]);
  }
  const last = months[months.length - 1];
  if (points[points.length - 1] !== last) points.push(last);
  return points;
}
