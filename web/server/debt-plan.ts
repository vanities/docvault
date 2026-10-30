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

/** A loan you expect to take out, like a build loan that pays off the land loan. */
export interface PlannedLoan {
  /** Stable id, made when the loan is added. */
  id: string;
  name: string;
  /** YYYY-MM of the first full payment; the loan doesn't exist before then. */
  start: string;
  /** New money borrowed, not counting the debts it pays off. */
  amount: number;
  /** Annual rate as a decimal. */
  rate: number;
  termMonths: number;
  /** Listed debts (by debtId) it pays off when it starts; their balances join it. */
  paysOff: string[];
  /** Only ever gets its scheduled payment, never the plan's extra. */
  minimumOnly: boolean;
}

/** Passive income that starts later, like rent once you move out. */
export interface IncomeChange {
  id: string;
  name: string;
  /** YYYY-MM it starts. */
  start: string;
  /** Added to passive income every month from `start` on. */
  monthly: number;
}

/** A price you expect a holding to reach, like BTC at a round number by some month. */
export interface PriceTarget {
  /** The asset as DocVault's crypto data names it (BTC, ETH). */
  asset: string;
  /** Price per unit, in today's dollars like everything else in the plan. */
  price: number;
  /** YYYY-MM it gets there. Before then it climbs steadily; after, it grows at the plan's rate. */
  month: string;
}

/** Selling units of a holding and putting what's left after tax on a debt. */
export interface HoldingSale {
  id: string;
  asset: string;
  units: number;
  /** YYYY-MM of the sale; it sells at that month's price on the holding's path. */
  month: string;
  /** Share of the proceeds lost to tax, as a decimal. */
  taxRate: number;
  /** Debt (debtId) or planned loan (id) it pays down. What it can't use stays invested. */
  payTo: string;
}

/** The Payoff plan's saved inputs (`.docvault-debt-plan.json`). */
export interface DebtPlanSettings {
  /** Paid toward debt each month on top of the scheduled payments. */
  extraMonthly: number;
  /** Which debt the extra and freed-up payments go to first. */
  order: PayoffOrder;
  /** Credit cards are cleared every statement, so they're spending, not debt. */
  cardsPaidInFull: boolean;
  /** Debts (by debtId) that only ever get their scheduled payment. */
  minimumOnly: string[];
  plannedLoans: PlannedLoan[];
  incomeChanges: IncomeChange[];
  priceTargets: PriceTarget[];
  sales: HoldingSale[];
  /** Monthly spending that isn't a debt payment. 0 means not entered yet. */
  livingExpenses: number;
  /** Put into investments outside retirement accounts each month. */
  monthlySavings: number;
  /** Income that keeps coming without work. null means the Income page total. */
  passiveIncome: number | null;
  /** Investments outside retirement accounts. null means the snapshot's total. */
  investments: number | null;
  /** 401(k)s, IRAs and the like today. null means DocVault's total of those accounts. */
  retirement: number | null;
  /** Put into retirement accounts each month. */
  retirementSavings: number;
  /** YYYY-MM retirement money starts counting toward freedom. null means it counts now. */
  retirementFrom: string | null;
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
  minimumOnly: [],
  plannedLoans: [],
  incomeChanges: [],
  priceTargets: [],
  sales: [],
  livingExpenses: 0,
  monthlySavings: 0,
  passiveIncome: null,
  investments: null,
  retirement: null,
  retirementSavings: 0,
  retirementFrom: null,
  realReturn: 0.05,
  withdrawalRate: 0.04,
};

const isMoney = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e10;
const isRate = (min: number, max: number) => (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const isText = (max: number) => (v: unknown) => typeof v === 'string' && v.length <= max;
const isId = (v: unknown) => isText(200)(v) && (v as string).length > 0;
const isMonth = (v: unknown) => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const listOf = (max: number, item: (v: unknown) => boolean) => (v: unknown) =>
  Array.isArray(v) && v.length <= max && v.every(item);
const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const isPlannedLoan = (v: unknown) =>
  isRecord(v) &&
  isId(v.id) &&
  isText(100)(v.name) &&
  isMonth(v.start) &&
  isMoney(v.amount) &&
  isRate(0, 0.3)(v.rate) &&
  Number.isInteger(v.termMonths) &&
  (v.termMonths as number) >= 1 &&
  (v.termMonths as number) <= 600 &&
  listOf(50, isId)(v.paysOff) &&
  typeof v.minimumOnly === 'boolean';

const isIncomeChange = (v: unknown) =>
  isRecord(v) &&
  isId(v.id) &&
  isText(100)(v.name) &&
  isMonth(v.start) &&
  typeof v.monthly === 'number' &&
  Number.isFinite(v.monthly) &&
  Math.abs(v.monthly) <= 1e7;

const isAsset = (v: unknown) => isText(20)(v) && (v as string).length > 0;

const isPriceTarget = (v: unknown) =>
  isRecord(v) &&
  isAsset(v.asset) &&
  isMoney(v.price) &&
  (v.price as number) > 0 &&
  isMonth(v.month);

const isHoldingSale = (v: unknown) =>
  isRecord(v) &&
  isId(v.id) &&
  isAsset(v.asset) &&
  typeof v.units === 'number' &&
  Number.isFinite(v.units) &&
  v.units > 0 &&
  v.units <= 1e9 &&
  isMonth(v.month) &&
  isRate(0, 0.6)(v.taxRate) &&
  isText(200)(v.payTo);

const FIELD_CHECKS: Record<
  Exclude<keyof DebtPlanSettings, 'updatedAt'>,
  (v: unknown) => boolean
> = {
  extraMonthly: isMoney,
  order: (v) => v === 'avalanche' || v === 'snowball',
  cardsPaidInFull: (v) => typeof v === 'boolean',
  minimumOnly: listOf(100, isId),
  plannedLoans: listOf(10, isPlannedLoan),
  incomeChanges: listOf(20, isIncomeChange),
  priceTargets: listOf(10, isPriceTarget),
  sales: listOf(20, isHoldingSale),
  retirement: (v) => v === null || isMoney(v),
  retirementSavings: isMoney,
  retirementFrom: (v) => v === null || isMonth(v),
  livingExpenses: isMoney,
  monthlySavings: isMoney,
  passiveIncome: (v) => v === null || isMoney(v),
  investments: (v) => v === null || isMoney(v),
  realReturn: isRate(-0.2, 0.2),
  // A 0% draw would make freedom impossible by definition.
  withdrawalRate: (v) => isRate(0, 0.2)(v) && (v as number) > 0,
};

// List fields are copied down to their known keys, so a stray property sent
// by a client never ends up in the saved file.
const CLEAN: Partial<Record<keyof DebtPlanSettings, (v: unknown) => unknown>> = {
  minimumOnly: (v) => [...(v as string[])],
  plannedLoans: (v) =>
    (v as PlannedLoan[]).map(
      ({ id, name, start, amount, rate, termMonths, paysOff, minimumOnly }) => ({
        id,
        name,
        start,
        amount,
        rate,
        termMonths,
        paysOff: [...paysOff],
        minimumOnly,
      })
    ),
  incomeChanges: (v) =>
    (v as IncomeChange[]).map(({ id, name, start, monthly }) => ({ id, name, start, monthly })),
  priceTargets: (v) =>
    (v as PriceTarget[]).map(({ asset, price, month }) => ({ asset, price, month })),
  sales: (v) =>
    (v as HoldingSale[]).map(({ id, asset, units, month, taxRate, payTo }) => ({
      id,
      asset,
      units,
      month,
      taxRate,
      payTo,
    })),
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
    if (!check(value)) {
      invalid.push(key);
      continue;
    }
    const clean = CLEAN[key as keyof DebtPlanSettings];
    Object.assign(settings, { [key]: clean ? clean(value) : value });
  }
  return { settings, invalid };
}

export interface PlanDebt {
  /** Chart series key. */
  key: string;
  /** Stable id the plan's settings refer to (see debtId). */
  id: string;
  name: string;
  balance: number;
  /** Annual rate as a decimal. An unknown rate counts as 0. */
  rate: number;
  monthlyPayment: number;
  /** Only ever gets its scheduled payment; freed-up money skips it. */
  minimumOnly?: boolean;
}

/** How settings name a listed debt: stable when the Debts list reorders, not when it's renamed. */
export function debtId(d: Pick<DebtPaymentItem, 'source' | 'name'>): string {
  return `${d.source}:${d.name}`;
}

/**
 * The Debts list as the plan sees it. Keys come from each item's place in the
 * full list, so leaving cards out doesn't shift another debt's key (or color).
 */
export function planDebts(
  items: DebtPaymentItem[],
  settings: Pick<DebtPlanSettings, 'cardsPaidInFull' | 'minimumOnly'>
): PlanDebt[] {
  const minimumOnly = new Set(settings.minimumOnly);
  return items
    .map((d, i) => ({ item: d, key: `debt${i}` }))
    .filter(({ item }) => !(settings.cardsPaidInFull && item.card))
    .map(({ item, key }) => ({
      key,
      id: debtId(item),
      name: item.name,
      balance: item.balance,
      rate: item.rate ?? 0,
      monthlyPayment: item.monthlyPayment,
      ...(minimumOnly.has(debtId(item)) ? { minimumOnly: true } : {}),
    }));
}

export type KeyedLoan = PlannedLoan & { key: string };

/** Planned loans with their chart keys. */
export function planLoans(loans: PlannedLoan[]): KeyedLoan[] {
  return loans.map((l, i) => ({ ...l, key: `new${i}` }));
}

export interface Holding {
  asset: string;
  units: number;
  /** Value today. */
  value: number;
}

/** Units and value of each crypto asset across every source DocVault syncs, largest first. */
export function cryptoHoldings(
  sources: { balances?: { asset: string; amount: number; usdValue: number }[] }[]
): Holding[] {
  const byAsset = new Map<string, Holding>();
  for (const b of sources.flatMap((s) => s.balances ?? [])) {
    const h = byAsset.get(b.asset) ?? { asset: b.asset, units: 0, value: 0 };
    h.units += b.amount;
    h.value += b.usdValue;
    byAsset.set(b.asset, h);
  }
  return [...byAsset.values()]
    .filter((h) => h.units > 0 && h.value > 0)
    .sort((a, b) => b.value - a.value);
}

export interface DebtPlanInput {
  debts: PlanDebt[];
  plannedLoans?: KeyedLoan[];
  incomeChanges?: IncomeChange[];
  /** Holdings priced on their own path: one a price target or a sale names. */
  holdings?: Holding[];
  priceTargets?: PriceTarget[];
  sales?: HoldingSale[];
  extraMonthly: number;
  order: PayoffOrder;
  livingExpenses: number;
  monthlySavings: number;
  passiveIncome: number;
  /** Investments outside retirement accounts, not counting `holdings`. */
  investments: number;
  retirement?: number;
  retirementSavings?: number;
  /** YYYY-MM retirement money starts counting toward freedom; unset means now. */
  retirementFrom?: string | null;
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
  /** Investments outside retirement accounts at the end of the month, holdings included. */
  invested: number;
  /** Retirement accounts at the end of the month, whether or not they count yet. */
  retirement: number;
  /** Passive income plus what the investments that count can pay out this month. */
  passive: number;
}

export interface DebtPlanResult {
  months: DebtPlanMonth[];
  /** Month of the last payment on everything, planned loans included; null past the cap. */
  debtFree: string | null;
  debtFreeAsScheduled: string | null;
  /** Month each debt closes, by payoff or by a planned loan taking it over. */
  paidOff: Record<string, string | null>;
  paidOffAsScheduled: Record<string, string | null>;
  /** Debts a planned loan took over: the loan's key and the month. */
  rolledInto: Record<string, { into: string; month: string }>;
  /** Each planned loan's opening balance and payment under the plan. */
  loanStarts: Record<string, { month: string; balance: number; payment: number }>;
  /** What each sale (by id) sold, lost to tax, and put on its debt. */
  saleResults: Record<
    string,
    { month: string; units: number; proceeds: number; tax: number; toDebt: number }
  >;
  interest: number;
  interestAsScheduled: number;
  /**
   * Start of the last stretch where passive income covers needs for good; a
   * month that's covered only until a planned loan arrives doesn't count. Null
   * without living expenses or within the cap.
   */
  free: string | null;
  /** Debts whose scheduled payment doesn't cover their interest, so they never pay off on schedule. */
  growing: string[];
  /** Paid toward debt each month right now: scheduled payments plus the extra. */
  debtBudget: number;
}

// Half a cent: below this a balance is paid off (float dust from the interest math).
const PAID = 0.005;

function monthLabel(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Whole months from one YYYY-MM to another. */
export function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

// A payment rounded to the cent (1,000.00 over 3 months is 333.33) leaves a
// few cents after the last one. Lenders fold them into that final payment, so
// a remainder under a dollar is paid that month instead of a month later.
const ROUNDING = 1;

function scheduledPayment(due: number, payment: number): number {
  return due - payment < ROUNDING ? due : payment;
}

function amortizedPayment(balance: number, annualRate: number, months: number): number {
  const r = annualRate / 12;
  return r === 0 ? balance / months : (balance * r) / (1 - Math.pow(1 + r, -months));
}

function total(values: Iterable<number>): number {
  let sum = 0;
  for (const v of values) sum += v;
  return sum;
}

interface Loan {
  key: string;
  rate: number;
  payment: number;
  minimumOnly: boolean;
}

/** One way of paying the debts: what's owed, the loans, and the interest so far. */
interface Ledger {
  owed: Map<string, number>;
  loans: Map<string, Loan>;
  paidOff: Record<string, string | null>;
  interest: number;
  /** Paid toward debt each month: scheduled payments, the extra, and freed-up payments. */
  budget: number;
}

function newLedger(debts: PlanDebt[], extra: number): Ledger {
  return {
    owed: new Map(debts.map((d) => [d.key, d.balance])),
    loans: new Map(
      debts.map((d) => [
        d.key,
        { key: d.key, rate: d.rate, payment: d.monthlyPayment, minimumOnly: !!d.minimumOnly },
      ])
    ),
    paidOff: Object.fromEntries(debts.map((d) => [d.key, null])),
    interest: 0,
    budget: total(debts.map((d) => d.monthlyPayment)) + extra,
  };
}

/**
 * Open a planned loan: the debts it pays off close and their balances join it,
 * and its payment replaces theirs in the monthly budget.
 */
function openLoan(
  ledger: Ledger,
  loan: KeyedLoan,
  keyById: Map<string, string>,
  month: string,
  onRolled?: (key: string) => void
): { balance: number; payment: number } {
  let balance = loan.amount;
  let replaced = 0;
  for (const id of loan.paysOff) {
    const key = keyById.get(id);
    const owed = key ? (ledger.owed.get(key) ?? 0) : 0;
    if (!key || owed <= PAID) continue;
    balance += owed;
    replaced += ledger.loans.get(key)!.payment;
    ledger.owed.set(key, 0);
    ledger.paidOff[key] = month;
    onRolled?.(key);
  }
  const payment = balance > PAID ? amortizedPayment(balance, loan.rate, loan.termMonths) : 0;
  ledger.loans.set(loan.key, {
    key: loan.key,
    rate: loan.rate,
    payment,
    minimumOnly: loan.minimumOnly,
  });
  ledger.owed.set(loan.key, balance);
  ledger.paidOff[loan.key] = balance > PAID ? null : month;
  ledger.budget += payment - replaced;
  return { balance, payment };
}

/** Interest, then each open loan's scheduled payment. Returns what was paid. */
function payScheduled(ledger: Ledger): Record<string, number> {
  const payments: Record<string, number> = {};
  for (const loan of ledger.loans.values()) {
    const balance = ledger.owed.get(loan.key)!;
    if (balance <= PAID) continue;
    const charge = (balance * loan.rate) / 12;
    const pay = scheduledPayment(balance + charge, loan.payment);
    ledger.interest += charge;
    payments[loan.key] = pay;
    ledger.owed.set(loan.key, balance + charge - pay);
  }
  return payments;
}

function closePaidOff(ledger: Ledger, month: string): void {
  for (const key of ledger.loans.keys()) {
    if (ledger.paidOff[key] === null && ledger.owed.get(key)! <= PAID) {
      ledger.paidOff[key] = month;
      ledger.owed.set(key, 0);
    }
  }
}

/**
 * Project every debt month by month two ways. As scheduled, each debt gets its
 * own payment and nothing more. Under the plan, the monthly total stays the
 * same, so the extra and every freed-up payment go down the payoff order,
 * skipping minimum-only debts; whatever no debt takes is invested. A planned
 * loan opens in its start month in both. Freedom is the start of the last
 * stretch where passive income, plus a `withdrawalRate` draw on investments,
 * covers living expenses and the payments still due.
 */
export function projectDebtPlan(input: DebtPlanInput): DebtPlanResult {
  const maxMonths = input.maxMonths ?? 600;
  const today = input.today ?? new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const debts = input.debts.filter((d) => d.balance > PAID);
  const extra = Math.max(0, input.extraMonthly);
  const living = Math.max(0, input.livingExpenses);
  const savings = Math.max(0, input.monthlySavings);
  const growth = Math.pow(1 + input.realReturn, 1 / 12);
  const draw = input.withdrawalRate / 12;
  const planned = [...(input.plannedLoans ?? [])].sort((a, b) => a.start.localeCompare(b.start));
  const incomeChanges = input.incomeChanges ?? [];
  const sales = [...(input.sales ?? [])].sort((a, b) => a.month.localeCompare(b.month));
  const targets = new Map((input.priceTargets ?? []).map((t) => [t.asset, t]));
  const holdings = new Map(
    (input.holdings ?? [])
      .filter((h) => h.units > 0 && h.value > 0)
      .map((h) => [h.asset, { units: h.units, price: h.value / h.units }])
  );
  const keyById = new Map(debts.map((d) => [d.id, d.key]));
  const loanKeyById = new Map(planned.map((l) => [l.id, l.key]));
  const retirementFrom = input.retirementFrom ?? null;
  const retirementSavings = Math.max(0, input.retirementSavings ?? 0);
  const lastEvent = [
    ...planned.map((l) => l.start),
    ...incomeChanges.map((c) => c.start),
    ...sales.map((s) => s.month),
    ...[...targets.values()].map((t) => t.month),
    ...(retirementFrom ? [retirementFrom] : []),
  ]
    .sort()
    .at(-1);

  const plan = newLedger(debts, extra);
  const asScheduled = newLedger(debts, 0);
  const debtBudget = plan.budget;
  const rolledInto: DebtPlanResult['rolledInto'] = {};
  const loanStarts: DebtPlanResult['loanStarts'] = {};
  const opened = new Set<string>();
  const growing = debts
    .filter((d) => (d.balance * d.rate) / 12 >= d.monthlyPayment)
    .map((d) => d.key);

  const now = monthLabel(start);
  const saleResults: DebtPlanResult['saleResults'] = {};
  const sold = new Set<string>();

  /** A holding's price i months out: a steady climb to its target, then the plan's growth. */
  const priceAt = (asset: string, i: number): number => {
    const { price } = holdings.get(asset)!;
    const target = targets.get(asset);
    if (!target) return price * Math.pow(growth, i);
    const reach = Math.max(1, monthsBetween(now, target.month));
    return i <= reach
      ? price * Math.pow(target.price / price, i / reach)
      : target.price * Math.pow(growth, i - reach);
  };
  const heldAt = (i: number) =>
    total([...holdings].map(([asset, h]) => h.units * priceAt(asset, i)));

  // Retirement money pays out only from retirementFrom (59½, or earlier with
  // a SEPP or a Roth conversion ladder); before that it just grows.
  const passiveIn = (month: string, spendable: number, retirement: number) =>
    input.passiveIncome +
    total(incomeChanges.filter((c) => c.start <= month).map((c) => c.monthly)) +
    (spendable + (!retirementFrom || month >= retirementFrom ? retirement : 0)) * draw;

  let invested = Math.max(0, input.investments);
  let retirement = Math.max(0, input.retirement ?? 0);
  const months: DebtPlanMonth[] = [
    {
      month: now,
      owed: Object.fromEntries(plan.owed),
      totalOwed: total(plan.owed.values()),
      totalOwedAsScheduled: total(plan.owed.values()),
      payments: Object.fromEntries(debts.map((d) => [d.key, d.monthlyPayment])),
      needs: living + total(debts.map((d) => d.monthlyPayment)),
      invested: invested + heldAt(0),
      retirement,
      passive: passiveIn(now, invested + heldAt(0), retirement),
    },
  ];

  for (let i = 1; i <= maxMonths; i++) {
    const date = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const label = monthLabel(date);

    for (const loan of planned) {
      if (opened.has(loan.key) || loan.start > label) continue;
      opened.add(loan.key);
      loanStarts[loan.key] = {
        month: label,
        ...openLoan(plan, loan, keyById, label, (key) => {
          rolledInto[key] = { into: loan.key, month: label };
        }),
      };
      openLoan(asScheduled, loan, keyById, label);
    }

    // A sale goes at this month's price. After tax the money pays down its
    // debt (plan only: paying only what's due means no lump sums), and what
    // the debt can't take stays invested.
    for (const sale of sales) {
      if (sold.has(sale.id) || sale.month > label) continue;
      sold.add(sale.id);
      const held = holdings.get(sale.asset);
      if (!held) continue;
      const units = Math.min(sale.units, held.units);
      held.units -= units;
      const proceeds = units * priceAt(sale.asset, i);
      const tax = proceeds * sale.taxRate;
      const key = keyById.get(sale.payTo) ?? loanKeyById.get(sale.payTo);
      const owed = key ? (plan.owed.get(key) ?? 0) : 0;
      const toDebt = key && owed > PAID ? Math.min(proceeds - tax, owed) : 0;
      if (key && toDebt > 0) plan.owed.set(key, owed - toDebt);
      invested += proceeds - tax - toDebt;
      saleResults[sale.id] = { month: label, units, proceeds, tax, toDebt };
    }

    // Plan: every open loan gets its scheduled payment, then what's left of
    // the budget goes down the payoff order to loans that take extra.
    const payments = payScheduled(plan);
    let pool = plan.budget - total(Object.values(payments));
    const targets = [...plan.loans.values()]
      .filter((l) => !l.minimumOnly && plan.owed.get(l.key)! > PAID)
      .sort((a, b) => {
        const owedA = plan.owed.get(a.key)!;
        const owedB = plan.owed.get(b.key)!;
        return input.order === 'avalanche'
          ? b.rate - a.rate || owedA - owedB
          : owedA - owedB || b.rate - a.rate;
      });
    for (const loan of targets) {
      if (pool <= PAID) break;
      const amount = Math.min(pool, plan.owed.get(loan.key)!);
      plan.owed.set(loan.key, plan.owed.get(loan.key)! - amount);
      pool -= amount;
    }
    closePaidOff(plan, label);

    payScheduled(asScheduled);
    closePaidOff(asScheduled, label);

    // Whatever the debts didn't take is invested, along with regular savings.
    invested = invested * growth + savings + Math.max(0, pool);
    retirement = retirement * growth + retirementSavings;
    const held = heldAt(i);
    const totalOwed = total(plan.owed.values());
    const totalOwedAsScheduled = total(asScheduled.owed.values());
    const needs = living + total(Object.values(payments));
    const passive = passiveIn(label, invested + held, retirement);
    months.push({
      month: label,
      owed: Object.fromEntries(plan.owed),
      totalOwed,
      totalOwedAsScheduled,
      payments,
      needs,
      invested: invested + held,
      retirement,
      passive,
    });

    // Stop at the December after everything has settled, so the last year
    // gets a year-end point. A debt that grows on schedule never pays off that
    // way, so don't wait for it.
    const settled =
      (!lastEvent || label >= lastEvent) &&
      totalOwed <= PAID &&
      (totalOwedAsScheduled <= PAID || growing.length > 0) &&
      (living === 0 || passive >= needs);
    if (settled && date.getMonth() === 11) break;
  }

  // Everything is judged on the finished timeline, since a planned loan can
  // turn a debt-free or covered month back into one that isn't.
  const allOpened = opened.size === planned.length;
  const after = (isOpen: (m: DebtPlanMonth) => boolean): string | null => {
    let last = -1;
    months.forEach((m, i) => {
      if (isOpen(m)) last = i;
    });
    if (last === months.length - 1 || !allOpened) return null;
    return months[last + 1].month;
  };

  return {
    months,
    debtFree: after((m) => m.totalOwed > PAID),
    debtFreeAsScheduled: after((m) => m.totalOwedAsScheduled > PAID),
    paidOff: plan.paidOff,
    paidOffAsScheduled: asScheduled.paidOff,
    rolledInto,
    loanStarts,
    saleResults,
    interest: plan.interest,
    interestAsScheduled: asScheduled.interest,
    free: living > 0 ? after((m) => m.passive < m.needs) : null,
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
