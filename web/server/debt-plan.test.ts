// Fabricated debts and amounts only. Pure projection math, no data dir.
import { describe, expect, test } from 'vite-plus/test';
import {
  applyDebtPlanPatch,
  DEFAULT_DEBT_PLAN_SETTINGS,
  planDebts,
  projectDebtPlan,
  yearlyPoints,
  type DebtPlanInput,
  type PlanDebt,
} from './debt-plan.js';
import type { DebtPaymentItem } from './debt-payments.js';

// Month 0 is January 2026, so the first payment lands in February.
const TODAY = new Date(2026, 0, 15);

function plan(debts: PlanDebt[], overrides: Partial<DebtPlanInput> = {}) {
  return projectDebtPlan({
    debts,
    extraMonthly: 0,
    order: 'avalanche',
    livingExpenses: 0,
    monthlySavings: 0,
    passiveIncome: 0,
    investments: 0,
    realReturn: 0,
    withdrawalRate: 0.04,
    today: TODAY,
    ...overrides,
  });
}

const loan = (key: string, balance: number, rate: number, monthlyPayment: number): PlanDebt => ({
  key,
  name: `Acme ${key}`,
  balance,
  rate,
  monthlyPayment,
});

describe('projectDebtPlan: debt payoff', () => {
  test('a 0% loan pays off balance / payment months after this one', () => {
    const r = plan([loan('a', 1200, 0, 100)]);
    expect(r.months[0].month).toBe('2026-01');
    expect(r.paidOff.a).toBe('2027-01'); // 12 payments, Feb 2026 through Jan 2027
    expect(r.debtFree).toBe('2027-01');
    expect(r.debtFreeAsScheduled).toBe('2027-01');
  });

  test("a loan's last payment absorbs the cents its rounded payment leaves", () => {
    // 3 x 333.33 is 999.99: the final payment covers the last cent, no 4th month.
    const r = plan([loan('a', 1000, 0, 333.33)]);
    expect(r.paidOff.a).toBe('2026-04');
    expect(r.paidOffAsScheduled.a).toBe('2026-04');
    expect(r.months[3].payments.a).toBeCloseTo(333.34, 6);
  });

  test('the as-scheduled payoff matches the closed-form amortization term', () => {
    // n = -ln(1 - rB/P) / ln(1 + r) with r = 0.5%/mo, B = 20,000, P = 400: 57.7, so 58 payments.
    const r = plan([loan('a', 20_000, 0.06, 400)]);
    expect(r.debtFreeAsScheduled).toBe('2030-11');
  });

  test('freed-up payments roll onto the next debt', () => {
    // A clears in 2 payments. From month 3 B gets its $100 plus A's $500:
    // 2,800 left -> 2,200 -> 1,600 -> 1,000 -> 400 -> 0 in month 7.
    const r = plan([loan('a', 1000, 0, 500), loan('b', 3000, 0, 100)]);
    expect(r.paidOff.a).toBe('2026-03');
    expect(r.paidOff.b).toBe('2026-08');
    expect(r.debtFree).toBe('2026-08');
    // As scheduled, B runs its 30 payments alone.
    expect(r.paidOffAsScheduled.b).toBe('2028-07');
    expect(r.debtFreeAsScheduled).toBe('2028-07');
    expect(r.debtBudget).toBe(600);
  });

  test('extra payments cut interest and time against the schedule', () => {
    const r = plan([loan('a', 20_000, 0.06, 400)], { extraMonthly: 200 });
    expect(r.interest).toBeLessThan(r.interestAsScheduled);
    expect(r.debtFree! < r.debtFreeAsScheduled!).toBe(true);
  });

  test('avalanche aims the extra at the highest rate, snowball at the smallest balance', () => {
    const debts = [loan('pricey', 10_000, 0.2, 300), loan('small', 2000, 0.05, 100)];
    const avalanche = plan(debts, { extraMonthly: 1000, order: 'avalanche' });
    const snowball = plan(debts, { extraMonthly: 1000, order: 'snowball' });
    expect(avalanche.paidOff.pricey! < avalanche.paidOff.small!).toBe(true);
    expect(snowball.paidOff.small! < snowball.paidOff.pricey!).toBe(true);
    expect(avalanche.interest).toBeLessThan(snowball.interest);
  });

  test('a payment under the interest never pays off on schedule, but the plan can still clear it', () => {
    // 24% on 10,000 is 200/mo of interest; a 150 payment loses ground.
    const r = plan([loan('card', 10_000, 0.24, 150)], { extraMonthly: 500 });
    expect(r.growing).toEqual(['card']);
    expect(r.debtFreeAsScheduled).toBeNull();
    expect(r.paidOffAsScheduled.card).toBeNull();
    expect(r.debtFree).not.toBeNull();
    expect(r.months.length).toBeLessThan(600);
  });

  test('no debts means debt-free now', () => {
    const r = plan([]);
    expect(r.debtFree).toBe('2026-01');
    expect(r.months[0].totalOwed).toBe(0);
  });

  test('the projection ends on a December so the last year has a year-end point', () => {
    const r = plan([loan('a', 1000, 0, 500), loan('b', 3000, 0, 100)]);
    expect(r.months[r.months.length - 1].month).toBe('2028-12');
  });
});

describe('projectDebtPlan: financial freedom', () => {
  test('free is the first month passive income covers living plus payments still due', () => {
    // Needs are 1,000 living + 1,000 payment until the loan ends in April (month 3),
    // then 1,000; passive income is 1,500, so May is the first month it covers needs.
    const r = plan([loan('a', 3000, 0, 1000)], { livingExpenses: 1000, passiveIncome: 1500 });
    expect(r.months[3].needs).toBe(2000);
    expect(r.months[4].needs).toBe(1000);
    expect(r.free).toBe('2026-05');
  });

  test('free is now when passive income already covers everything', () => {
    const r = plan([loan('a', 3000, 0, 1000)], { livingExpenses: 500, passiveIncome: 2000 });
    expect(r.free).toBe('2026-01');
  });

  test('without living expenses there is no freedom date', () => {
    const r = plan([loan('a', 3000, 0, 1000)], { passiveIncome: 5000 });
    expect(r.free).toBeNull();
  });

  test('investments draw at the withdrawal rate and compound at the real return', () => {
    const r = plan([], { investments: 120_000, realReturn: 0.12, livingExpenses: 1 });
    // 4% a year of 120,000 is 400 a month.
    expect(r.months[0].passive).toBeCloseTo(400, 6);
    // Eleven months of 12%-a-year growth.
    expect(r.months[11].invested).toBeCloseTo(120_000 * Math.pow(1.12, 11 / 12), 4);
  });

  test('after the last payoff the whole debt budget is invested', () => {
    const r = plan([loan('a', 1000, 0, 500)], { extraMonthly: 100, monthlySavings: 50 });
    // Month 1: 500 + 100 extra pays 600 of the 1,000; month 2 takes the last 400.
    expect(r.debtFree).toBe('2026-03');
    expect(r.months[2].invested).toBeCloseTo(50 + 50 + 200, 6);
    expect(r.months[3].invested).toBeCloseTo(300 + 50 + 600, 6);
  });
});

describe('yearlyPoints', () => {
  test('keeps now and each December, skipping one under six months away', () => {
    // Month 0 is October; the December two months out is too close to "now".
    const r = plan([loan('a', 3000, 0, 100)], { today: new Date(2026, 9, 15) });
    expect(r.debtFree).toBe('2029-04');
    expect(yearlyPoints(r.months).map((m) => m.month)).toEqual([
      '2026-10',
      '2027-12',
      '2028-12',
      '2029-12',
    ]);
  });

  test('keeps the final month when the cap stops short of a December', () => {
    const r = plan([loan('a', 10_000, 0, 10)], { maxMonths: 8 });
    expect(yearlyPoints(r.months).map((m) => m.month)).toEqual(['2026-01', '2026-09']);
  });
});

describe('planDebts', () => {
  const items: DebtPaymentItem[] = [
    {
      source: 'property',
      name: 'Example House',
      kind: 'Mortgage',
      balance: 100_000,
      rate: 0.04,
      monthlyPayment: 900,
    },
    {
      source: 'bank',
      name: 'Acme Visa',
      kind: 'Credit Card',
      balance: 800,
      monthlyPayment: 25,
      estimated: true,
      card: true,
    },
    { source: 'manual', name: 'Acme Loan', kind: 'Added here', balance: 5000, monthlyPayment: 200 },
  ];

  test('keeps every debt when cards carry a balance, an unknown rate counting as 0', () => {
    expect(planDebts(items, false).map((d) => [d.key, d.name, d.rate])).toEqual([
      ['debt0', 'Example House', 0.04],
      ['debt1', 'Acme Visa', 0],
      ['debt2', 'Acme Loan', 0],
    ]);
  });

  test('cards paid in full drop out without shifting the other debts’ keys', () => {
    expect(planDebts(items, true).map((d) => d.key)).toEqual(['debt0', 'debt2']);
  });
});

describe('applyDebtPlanPatch', () => {
  test('merges valid fields and keeps the rest', () => {
    const { settings, invalid } = applyDebtPlanPatch(DEFAULT_DEBT_PLAN_SETTINGS, {
      livingExpenses: 4321,
      order: 'snowball',
      cardsPaidInFull: true,
    });
    expect(invalid).toEqual([]);
    expect(settings).toEqual({
      ...DEFAULT_DEBT_PLAN_SETTINGS,
      livingExpenses: 4321,
      order: 'snowball',
      cardsPaidInFull: true,
    });
  });

  test('names each invalid field and leaves it unchanged', () => {
    const { settings, invalid } = applyDebtPlanPatch(DEFAULT_DEBT_PLAN_SETTINGS, {
      livingExpenses: -1,
      order: 'sideways',
      withdrawalRate: 0,
      realReturn: '0.05',
      extraMonthly: Number.NaN,
      cardsPaidInFull: 'yes',
    });
    expect(invalid.sort()).toEqual(
      [
        'cardsPaidInFull',
        'extraMonthly',
        'livingExpenses',
        'order',
        'realReturn',
        'withdrawalRate',
      ].sort()
    );
    expect(settings).toEqual(DEFAULT_DEBT_PLAN_SETTINGS);
  });

  test('null hands passive income and investments back to their defaults', () => {
    const current = { ...DEFAULT_DEBT_PLAN_SETTINGS, passiveIncome: 900, investments: 5000 };
    const { settings, invalid } = applyDebtPlanPatch(current, {
      passiveIncome: null,
      investments: null,
    });
    expect(invalid).toEqual([]);
    expect(settings.passiveIncome).toBeNull();
    expect(settings.investments).toBeNull();
  });

  test('ignores unknown fields and the server-owned updatedAt', () => {
    const { settings, invalid } = applyDebtPlanPatch(DEFAULT_DEBT_PLAN_SETTINGS, {
      updatedAt: '1999-01-01T00:00:00.000Z',
      somethingElse: 1,
    });
    expect(invalid).toEqual([]);
    expect(settings).toEqual(DEFAULT_DEBT_PLAN_SETTINGS);
  });

  test('a non-object body is invalid', () => {
    expect(applyDebtPlanPatch(DEFAULT_DEBT_PLAN_SETTINGS, [1, 2]).invalid).toEqual(['body']);
    expect(applyDebtPlanPatch(DEFAULT_DEBT_PLAN_SETTINGS, null).invalid).toEqual(['body']);
  });
});
