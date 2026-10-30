// Fabricated debts and amounts only. Pure projection math, no data dir.
import { describe, expect, test } from 'vite-plus/test';
import {
  applyDebtPlanPatch,
  DEFAULT_DEBT_PLAN_SETTINGS,
  planDebts,
  planLoans,
  cryptoHoldings,
  fireNumber,
  projectDebtPlan,
  yearlyPoints,
  type DebtPlanInput,
  type KeyedLoan,
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
  id: `manual:Acme ${key}`,
  name: `Acme ${key}`,
  balance,
  rate,
  monthlyPayment,
});

const newLoan = (overrides: Partial<KeyedLoan>): KeyedLoan => ({
  key: 'new0',
  id: 'loan-1',
  name: 'Example build loan',
  start: '2026-04',
  amount: 20_000,
  rate: 0,
  termMonths: 30,
  paysOff: [],
  minimumOnly: false,
  ...overrides,
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

describe('projectDebtPlan: minimum payments only', () => {
  test('freed-up money skips a minimum-only debt and is invested instead', () => {
    // Budget 600: B gets its 100 plus the 400 extra and clears in month 2. From
    // month 3 the 500 that A won't take is invested; A runs its own 12 payments.
    const a = { ...loan('a', 1200, 0, 100), minimumOnly: true };
    const r = plan([a, loan('b', 1000, 0, 100)], { extraMonthly: 400 });
    expect(r.paidOff.b).toBe('2026-03');
    expect(r.paidOff.a).toBe('2027-01');
    expect(r.paidOff.a).toBe(r.paidOffAsScheduled.a);
    expect(r.months[3].invested).toBeCloseTo(500, 6);
  });
});

describe('projectDebtPlan: planned loans and later income', () => {
  test('a planned loan takes over the debts it pays off and replaces their payment', () => {
    // Land is 8,000 after two 1,000 payments. In April it joins the 20,000 build
    // loan: 28,000 over 30 months is 933.33/mo, which replaces land's 1,000.
    const land = loan('land', 10_000, 0, 1000);
    const r = plan([land], { plannedLoans: [newLoan({ paysOff: [land.id] })] });
    expect(r.rolledInto.land).toEqual({ into: 'new0', month: '2026-04' });
    expect(r.paidOff.land).toBe('2026-04');
    expect(r.loanStarts.new0.balance).toBeCloseTo(28_000, 6);
    expect(r.loanStarts.new0.payment).toBeCloseTo(933.33, 2);
    expect(r.months[3].payments).toEqual({ new0: expect.closeTo(933.33, 2) });
    expect(r.paidOff.new0).toBe('2028-09'); // 30 payments, Apr 2026 through Sep 2028
    expect(r.debtFree).toBe('2028-09');
  });

  test('debt-free waits for a planned loan, even when nothing is owed today', () => {
    const r = plan([], {
      plannedLoans: [newLoan({ start: '2026-07', amount: 3000, termMonths: 3 })],
    });
    expect(r.debtFree).toBe('2026-09');
  });

  test('income that starts later joins passive income from its start month', () => {
    const r = plan([], {
      incomeChanges: [{ id: 'rent', name: 'Example rent', start: '2026-06', monthly: 1500 }],
      livingExpenses: 1,
    });
    expect(r.months[4].passive).toBe(0); // May
    expect(r.months[5].passive).toBe(1500); // June
  });

  test('freedom is the last stretch covered for good, not a month a planned loan undoes', () => {
    // 2,500 of passive income covers 1,000 of living today, but the July loan
    // adds 2,000 a month through Dec 2028. Only from Jan 2029 is every month covered.
    const r = plan([], {
      livingExpenses: 1000,
      passiveIncome: 2500,
      plannedLoans: [newLoan({ start: '2026-07', amount: 60_000, termMonths: 30 })],
    });
    expect(r.months[0].passive).toBeGreaterThanOrEqual(r.months[0].needs);
    expect(r.free).toBe('2029-01');
    expect(r.debtFree).toBe('2028-12');
  });

  test('planLoans gives each planned loan its own chart key', () => {
    expect(planLoans([newLoan({}), newLoan({ id: 'loan-2' })]).map((l) => l.key)).toEqual([
      'new0',
      'new1',
    ]);
  });
});

describe('projectDebtPlan: retirement accounts', () => {
  test('retirement money pays out only from the month it starts counting', () => {
    // 4% a year of 300,000 is 1,000 a month: enough for 1,000 of living, but only from July.
    const r = plan([], {
      livingExpenses: 1000,
      retirement: 300_000,
      retirementFrom: '2026-07',
    });
    expect(r.months[5].passive).toBe(0);
    expect(r.months[6].passive).toBeCloseTo(1000, 6);
    expect(r.free).toBe('2026-07');
  });

  test('retirement contributions grow the retirement pot, not the spendable one', () => {
    const r = plan([], {
      retirementSavings: 500,
      monthlySavings: 100,
      livingExpenses: 1,
      maxMonths: 3,
    });
    expect(r.months[3].retirement).toBe(1500);
    expect(r.months[3].invested).toBe(300);
  });
});

describe('projectDebtPlan: holdings with a price target, and sales', () => {
  // 2 units at 50,000 today, aiming for 200,000 by July (six months out).
  const btc = { holdings: [{ asset: 'BTC', units: 2, value: 100_000 }] };
  const target = { priceTargets: [{ asset: 'BTC', price: 200_000, month: '2026-07' }] };

  test('a holding climbs steadily to its target price, then grows at the plan rate', () => {
    const r = plan([], { ...btc, ...target, livingExpenses: 1 });
    // Halfway (3 of 6 months) on a steady climb from 50,000 to 200,000 is 100,000.
    expect(r.months[3].invested).toBeCloseTo(200_000, 4);
    expect(r.months[6].invested).toBeCloseTo(400_000, 4);
    expect(r.months[8].invested).toBeCloseTo(400_000, 4);
  });

  test('a sale pays down its debt after tax and the debt ends sooner', () => {
    // 5 payments leave 295,000. Selling 1 unit at 200,000 loses 50,000 to tax and
    // puts 150,000 on the house; July's 1,000 leaves 144,000, so 144 more payments.
    const house = loan('house', 300_000, 0, 1000);
    const r = plan([house], {
      ...btc,
      ...target,
      sales: [
        { id: 's1', asset: 'BTC', units: 1, month: '2026-07', taxRate: 0.25, payTo: house.id },
      ],
    });
    expect(r.saleResults.s1).toEqual({
      month: '2026-07',
      units: 1,
      proceeds: expect.closeTo(200_000, 4),
      tax: expect.closeTo(50_000, 4),
      toDebt: expect.closeTo(150_000, 4),
    });
    expect(r.months[6].owed.house).toBeCloseTo(144_000, 4);
    expect(r.paidOff.house).toBe('2038-07');
    expect(r.paidOffAsScheduled.house).toBe('2051-01'); // no lump sums when paying only what's due
  });

  test('what the debt can’t take stays invested', () => {
    // Both units at 200,000 net 300,000 after tax; the house only needs 295,000.
    // The 5,000 left over is invested, and so is July's 1,000 house payment,
    // which the paid-off house no longer needs.
    const house = loan('house', 300_000, 0, 1000);
    const r = plan([house], {
      ...btc,
      ...target,
      sales: [
        { id: 's1', asset: 'BTC', units: 2, month: '2026-07', taxRate: 0.25, payTo: house.id },
      ],
    });
    expect(r.saleResults.s1.toDebt).toBeCloseTo(295_000, 4);
    expect(r.paidOff.house).toBe('2026-07');
    expect(r.months[6].invested).toBeCloseTo(6000, 4);
  });

  test('cryptoHoldings adds up each asset across sources, largest first', () => {
    expect(
      cryptoHoldings([
        {
          balances: [
            { asset: 'ETH', amount: 2, usdValue: 4000 },
            { asset: 'BTC', amount: 1, usdValue: 50_000 },
          ],
        },
        { balances: [{ asset: 'BTC', amount: 0.5, usdValue: 25_000 }] },
        {},
      ])
    ).toEqual([
      { asset: 'BTC', units: 1.5, value: 75_000 },
      { asset: 'ETH', units: 2, value: 4000 },
    ]);
  });
});

describe('projectDebtPlan: stopping work', () => {
  test('needs come out of investments, and the run says when they run out', () => {
    // 12,000 pays 12 months of 1,000; February 2027 is the first one it can't.
    const r = plan([], {
      livingExpenses: 1000,
      investments: 12_000,
      stopWorking: '2026-01',
      maxMonths: 24,
    });
    expect(r.months[12].invested).toBeCloseTo(0, 6);
    expect(r.runsOut).toBe('2027-02');
    expect(r.lowest?.amount).toBeCloseTo(0, 6);
  });

  test('saving stops in the stop month', () => {
    const r = plan([], {
      monthlySavings: 500,
      retirementSavings: 100,
      stopWorking: '2026-04',
      maxMonths: 6,
    });
    expect(r.months[6].invested).toBe(1000); // February and March only
    expect(r.months[6].retirement).toBe(200);
  });

  test('extra payments stop too, and the payments still due come out of investments', () => {
    const r = plan([loan('a', 10_000, 0, 100)], {
      extraMonthly: 400,
      investments: 100_000,
      stopWorking: '2026-03',
      maxMonths: 3,
    });
    expect(r.months[1].owed.a).toBe(9500); // February: 100 due + 400 extra
    expect(r.months[2].owed.a).toBe(9400); // March: only the 100 due
    expect(r.months[2].invested).toBe(99_900);
  });

  test('holdings are sold once cash runs out', () => {
    // One unit at 10,000 covers ten months of 1,000.
    const r = plan([], {
      holdings: [{ asset: 'BTC', units: 1, value: 10_000 }],
      livingExpenses: 1000,
      stopWorking: '2026-01',
      maxMonths: 24,
    });
    expect(r.months[5].invested).toBeCloseTo(5000, 6);
    expect(r.runsOut).toBe('2026-12');
  });

  test('retirement money pays only once it is reachable', () => {
    // Cash lasts February through July; August needs the retirement money.
    const reachable = { investments: 6000, retirement: 100_000, livingExpenses: 1000 };
    const r = plan([], {
      ...reachable,
      retirementFrom: '2026-08',
      stopWorking: '2026-01',
      maxMonths: 24,
    });
    expect(r.runsOut).toBeNull();
    expect(r.months[7].retirement).toBe(99_000);
    // Spendable money is gone in July, the month before retirement money counts.
    expect(r.lowest?.month).toBe('2026-07');
    expect(r.lowest?.amount).toBeCloseTo(0, 6);
    const late = plan([], {
      ...reachable,
      retirementFrom: '2026-09',
      stopWorking: '2026-01',
      maxMonths: 24,
    });
    expect(late.runsOut).toBe('2026-08');
  });

  test('the low point counts retirement money that is already reachable', () => {
    const r = plan([], {
      investments: 1000,
      retirement: 100_000,
      livingExpenses: 1000,
      stopWorking: '2026-01',
      maxMonths: 3,
    });
    expect(r.lowest).toEqual({ month: '2026-04', amount: 98_000 });
  });

  test('with a birth month, a run that stops working goes on to age 95', () => {
    const r = plan([], {
      livingExpenses: 1,
      investments: 1_000_000,
      stopWorking: '2026-01',
      birthMonth: '1980-06',
    });
    expect(r.months[r.months.length - 1].month).toBe('2075-06');
    expect(r.runsOut).toBeNull();
  });

  test('the FIRE number is what lasts the whole run without work', () => {
    const base: DebtPlanInput = {
      debts: [],
      extraMonthly: 0,
      order: 'avalanche',
      livingExpenses: 1000,
      monthlySavings: 0,
      passiveIncome: 0,
      investments: 0,
      realReturn: 0,
      withdrawalRate: 0.04,
      today: TODAY,
      maxMonths: 120,
    };
    // 1,000 a month for 120 months with no growth: exactly 120,000.
    expect(fireNumber(base)).toBeCloseTo(120_000, 0);
    expect(fireNumber({ ...base, passiveIncome: 1000 })).toBe(0);
    // A 0% loan of 1,200 at 100 a month adds exactly 1,200.
    expect(fireNumber({ ...base, debts: [loan('a', 1200, 0, 100)] })).toBeCloseTo(121_200, 0);
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
    const debts = planDebts(items, { cardsPaidInFull: false, minimumOnly: [] });
    expect(debts.map((d) => [d.key, d.id, d.rate])).toEqual([
      ['debt0', 'property:Example House', 0.04],
      ['debt1', 'bank:Acme Visa', 0],
      ['debt2', 'manual:Acme Loan', 0],
    ]);
  });

  test('cards paid in full drop out without shifting the other debts’ keys', () => {
    const debts = planDebts(items, { cardsPaidInFull: true, minimumOnly: [] });
    expect(debts.map((d) => d.key)).toEqual(['debt0', 'debt2']);
  });

  test('marks the debts saved as minimum payments only', () => {
    const debts = planDebts(items, {
      cardsPaidInFull: true,
      minimumOnly: ['property:Example House'],
    });
    expect(debts.map((d) => [d.name, !!d.minimumOnly])).toEqual([
      ['Example House', true],
      ['Acme Loan', false],
    ]);
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

  const validLoan = {
    id: 'loan-1',
    name: 'Example build loan',
    start: '2027-10',
    amount: 500_000,
    rate: 0.065,
    termMonths: 360,
    paysOff: ['property:Example Land'],
    minimumOnly: false,
  };

  test('saves planned loans, later income, and minimum-only debts with only their known fields', () => {
    const { settings, invalid } = applyDebtPlanPatch(DEFAULT_DEBT_PLAN_SETTINGS, {
      plannedLoans: [{ ...validLoan, key: 'new0' }],
      incomeChanges: [{ id: 'rent', name: 'Example rent', start: '2027-10', monthly: 1800 }],
      minimumOnly: ['property:Example House'],
    });
    expect(invalid).toEqual([]);
    expect(settings.plannedLoans).toEqual([validLoan]);
    expect(settings.plannedLoans[0]).not.toHaveProperty('key');
    expect(settings.incomeChanges).toHaveLength(1);
    expect(settings.minimumOnly).toEqual(['property:Example House']);
  });

  test('checks the stop-working and birth months', () => {
    const ok = applyDebtPlanPatch(DEFAULT_DEBT_PLAN_SETTINGS, {
      stopWorking: '2031-01',
      birthMonth: null,
    });
    expect(ok.invalid).toEqual([]);
    expect(ok.settings.stopWorking).toBe('2031-01');
    expect(
      applyDebtPlanPatch(DEFAULT_DEBT_PLAN_SETTINGS, {
        stopWorking: 'soon',
        birthMonth: 1990,
      }).invalid.sort()
    ).toEqual(['birthMonth', 'stopWorking']);
  });

  test('checks price targets, sales, and the retirement fields', () => {
    const sale = {
      id: 's1',
      asset: 'BTC',
      units: 2,
      month: '2029-10',
      taxRate: 0.24,
      payTo: 'loan-1',
      extra: 1,
    };
    const ok = applyDebtPlanPatch(DEFAULT_DEBT_PLAN_SETTINGS, {
      priceTargets: [{ asset: 'BTC', price: 300_000, month: '2029-10' }],
      sales: [sale],
      retirement: null,
      retirementSavings: 1500,
      retirementFrom: '2061-06',
    });
    expect(ok.invalid).toEqual([]);
    expect(ok.settings.sales[0]).not.toHaveProperty('extra');
    expect(ok.settings.retirementFrom).toBe('2061-06');

    const bad = applyDebtPlanPatch(DEFAULT_DEBT_PLAN_SETTINGS, {
      priceTargets: [{ asset: 'BTC', price: 0, month: '2029-10' }],
      sales: [{ ...sale, taxRate: 0.7 }],
      retirementFrom: '2050-13',
      retirementSavings: -1,
    });
    expect(bad.invalid.sort()).toEqual(
      ['priceTargets', 'retirementFrom', 'retirementSavings', 'sales'].sort()
    );
  });

  test('rejects malformed planned loans, later income, and minimum-only lists', () => {
    const loans = (overrides: object) =>
      applyDebtPlanPatch(DEFAULT_DEBT_PLAN_SETTINGS, {
        plannedLoans: [{ ...validLoan, ...overrides }],
      }).invalid;
    expect(loans({ start: '2027-13' })).toEqual(['plannedLoans']);
    expect(loans({ termMonths: 0 })).toEqual(['plannedLoans']);
    expect(loans({ rate: 0.5 })).toEqual(['plannedLoans']);
    expect(loans({ minimumOnly: 'no' })).toEqual(['plannedLoans']);
    expect(
      applyDebtPlanPatch(DEFAULT_DEBT_PLAN_SETTINGS, {
        incomeChanges: [{ id: 'rent', name: '', start: 'soon', monthly: 1 }],
      }).invalid
    ).toEqual(['incomeChanges']);
    expect(applyDebtPlanPatch(DEFAULT_DEBT_PLAN_SETTINGS, { minimumOnly: [42] }).invalid).toEqual([
      'minimumOnly',
    ]);
  });
});
