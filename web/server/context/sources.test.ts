// A loan balance lowered by hand on one day while its payment clears days
// later. All names and amounts are fabricated.
import { afterEach, describe, expect, test, vi } from 'vite-plus/test';
import { promises as fs } from 'fs';
import path from 'path';
import { tmpdir } from 'os';

vi.hoisted(() => {
  process.env.DOCVAULT_DATA_DIR = `${process.env.TMPDIR ?? '/tmp'}/docvault-context-sources-${Date.now()}`;
});

const { createContextHistory } = await import('./history.js');
const { debtChanges, debtsState, describeDebtChange } = await import('./sources/debts.js');
const { bankAccountChanges } = await import('./sources/bank-accounts.js');
const { transactionEvents } = await import('./sources/bank-transactions.js');
const { mergeBankTransactions, emptyLedger } = await import('../bank-transactions.js');
import type { DebtPaymentItem } from '../debt-payments.js';

const dirs: string[] = [];
async function history() {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'context-sources-'));
  dirs.push(dir);
  return createContextHistory(dir);
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

const land: DebtPaymentItem = {
  source: 'property',
  name: 'Lakeside Cabin',
  lender: 'Acme Lending',
  kind: 'Mortgage',
  balance: 185_000,
  rate: 0.06,
  monthlyPayment: 1_500,
};

describe('debts', () => {
  test('a loan balance lowered by hand reads as a paydown on the day it was entered', async () => {
    const h = await history();
    const key = 'property:Lakeside Cabin';
    await h.record('debts', '2026-03-22', {
      [key]: { label: 'Lakeside Cabin (Mortgage)', value: 197_000 },
    });
    await h.record('debts', '2026-03-23', {
      [key]: { label: 'Lakeside Cabin (Mortgage)', value: 185_000 },
    });
    const events = await debtChanges({ from: '2026-03-18', to: '2026-04-01' }, h, [land]);
    expect(events).toEqual([
      {
        date: '2026-03-23',
        text: 'Lakeside Cabin (Mortgage) balance down $12,000 ($197,000 to $185,000)',
        amount: -12_000,
      },
    ]);
  });

  test('a drop the size of one scheduled payment is labeled as the regular payment', () => {
    // At 6% on $200,000, interest is $1,000 of the $1,500 payment: $500 of principal.
    const event = describeDebtChange(
      {
        date: '2026-04-01',
        previousDate: '2026-03-31',
        key: 'k',
        label: 'Home (Mortgage)',
        before: 200_000,
        after: 199_500,
      },
      land
    );
    expect(event.text).toContain('about one regular monthly payment');
    const big = describeDebtChange(
      {
        date: '2026-04-01',
        previousDate: '2026-03-31',
        key: 'k',
        label: 'Home (Mortgage)',
        before: 200_000,
        after: 170_000,
      },
      land
    );
    expect(big.text).not.toContain('regular');
  });

  test('the state says which debts the portfolio total leaves out', () => {
    const van: DebtPaymentItem = {
      source: 'manual',
      name: 'Delivery Van',
      kind: 'Equipment Loan',
      balance: 25_000,
      rate: 0,
      monthlyPayment: 800,
    };
    const lines = debtsState([land, van], 2_300);
    expect(lines[0]).toBe('Debts: 2, $210,000 owed, $2,300 a month in payments.');
    expect(lines).toContain('Lakeside Cabin (Mortgage, Acme Lending): $185,000 at 6%, $1,500/mo.');
    expect(lines[lines.length - 1]).toContain('hand-entered debts, which come to $25,000');
  });
});

describe('bank accounts', () => {
  test('lists only large moves, and says when days are missing between records', async () => {
    const h = await history();
    const checking = (value: number) => ({
      'acct:c': { label: 'Everyday Checking at Acme Bank', value },
    });
    await h.record('bank-accounts', '2026-03-24', checking(25_000));
    await h.record('bank-accounts', '2026-03-25', checking(24_600));
    await h.record('bank-accounts', '2026-03-28', checking(12_100));
    const events = await bankAccountChanges({ from: '2026-03-25', to: '2026-03-31' }, h);
    expect(events).toEqual([
      {
        date: '2026-03-28',
        text: 'Everyday Checking at Acme Bank: -$12,500 since 2026-03-25 ($24,600 to $12,100)',
        amount: -12_500,
      },
    ]);
  });
});

describe('bank transactions', () => {
  test('each transaction names the payee, the bank text when it adds something, and the account', () => {
    const ledger = mergeBankTransactions(
      emptyLedger(),
      [
        {
          id: 't2',
          accountId: 'c',
          posted: '2026-03-27',
          amount: -12_000,
          description: 'WEB PMT 1029384',
          payee: 'Acme Lending',
        },
        {
          id: 't1',
          accountId: 'c',
          posted: '2026-03-24',
          amount: 12_200,
          description: 'TRANSFER FROM SAVINGS',
        },
      ],
      { c: { name: 'Everyday Checking' } },
      '2026-08-01',
      new Date('2026-04-01T00:00:00Z')
    );
    expect(transactionEvents(ledger, { from: '2026-03-18', to: '2026-04-01' })).toEqual([
      {
        date: '2026-03-24',
        text: '+$12,200.00 TRANSFER FROM SAVINGS, Everyday Checking',
        amount: 12_200,
      },
      {
        date: '2026-03-27',
        text: '-$12,000.00 Acme Lending (WEB PMT 1029384), Everyday Checking',
        amount: -12_000,
      },
    ]);
  });
});

const { describeBankAccounts } = await import('./sources/bank-accounts.js');
const { describeTransaction } = await import('./sources/bank-transactions.js');
const { emptyBankRollup } = await import('../bank-rollup.js');

describe('readable lines from real-world shapes', () => {
  test('bank text that only repeats the payee is left out', () => {
    const ledger = { ...emptyLedger(), accounts: { c: { name: 'Everyday Checking' } } };
    const base = { id: 'x', accountId: 'c', posted: '2026-03-26', amount: -2_000 };
    expect(
      describeTransaction(
        {
          ...base,
          payee: 'Acme Lending Check #123',
          description: 'ACH Debit - Acme Lending 123',
        },
        ledger
      )
    ).toBe('-$2,000.00 Acme Lending Check #123, Everyday Checking');
    expect(
      describeTransaction(
        { ...base, payee: 'Globex Card Services', description: 'GLBX EPAYMENT ACH PMT' },
        ledger
      )
    ).toBe('-$2,000.00 Globex Card Services (GLBX EPAYMENT ACH PMT), Everyday Checking');
  });

  test('accounts under a dollar are counted, not listed; the rest go largest first', () => {
    const accounts = [
      { id: 'a', name: 'Everyday Checking', balance: 1_200, connectionName: 'Acme Bank' },
      { id: 'b', name: 'Rewards Card', balance: -3_400, connectionName: 'Acme Bank' },
      { id: 'c', name: 'Old Savings', balance: 0.4 },
      { id: 'd', name: 'Closed Loan', balance: 0 },
    ];
    const lines = describeBankAccounts({
      accounts,
      rollup: { ...emptyBankRollup(), liquidCash: 1_200, totalDebt: -3_400 },
      kindOf: (a) => (a.balance < 0 ? 'Credit Card' : 'Checking'),
      lastUpdated: '2026-04-01T14:00:00Z',
    });
    expect(lines).toEqual([
      'Bank-synced accounts as of 2026-04-01: cash $1,200, bank-synced debt $3,400, 4 accounts.',
      'Rewards Card at Acme Bank (Credit Card): -$3,400.',
      'Everyday Checking at Acme Bank (Checking): $1,200.',
      '2 more account(s) hold under $1 and are not listed.',
    ]);
  });
});

const { equityEvents } = await import('./sources/property-equity.js');

describe('property equity', () => {
  const snap = (date: string, propertyValue: number) => ({
    date,
    totalValue: 0,
    cryptoValue: 0,
    brokerValue: 0,
    goldValue: 0,
    propertyValue,
  });

  test('a hand edit and the monthly amortization read differently; small moves are left out', () => {
    const events = equityEvents(
      [
        snap('2026-03-02', 200_000),
        snap('2026-03-05', 200_000),
        snap('2026-03-06', 212_000),
        snap('2026-04-01', 213_200),
        snap('2026-04-03', 213_000),
      ],
      { from: '2026-03-01', to: '2026-04-30' }
    );
    expect(events).toEqual([
      {
        date: '2026-03-06',
        text: '+$12,000 ($200,000 to $212,000), a mortgage balance or a property value was changed by hand that day',
        amount: 12_000,
      },
      {
        date: '2026-04-01',
        text: '+$1,200 ($212,000 to $213,200), the monthly principal amortization',
        amount: 1_200,
      },
    ]);
  });
});

const { describePlanOutlook } = await import('./sources/payoff-plan.js');
const { buildPlan, planOutlook, DEFAULT_DEBT_PLAN_SETTINGS } = await import('../debt-plan.js');
import type { DebtPlanSettings } from '../debt-plan.js';

describe('payoff plan projection', () => {
  // Month 0 is January 2026, so the first payment lands in February.
  const today = new Date(2026, 0, 15);
  const van: DebtPaymentItem = {
    source: 'manual',
    name: 'Delivery Van',
    kind: 'Auto loan',
    balance: 12_000,
    rate: 0,
    monthlyPayment: 400,
  };
  const outlookLines = (patch: Partial<DebtPlanSettings>, items: DebtPaymentItem[] = [van]) => {
    const settings: DebtPlanSettings = {
      ...DEFAULT_DEBT_PLAN_SETTINGS,
      investments: 0,
      passiveIncome: 0,
      realReturn: 0,
      livingExpenses: 3_000,
      ...patch,
    };
    const defaults = {
      items,
      investmentParts: [],
      incomeMonthly: 0,
      retirementDefault: 0,
      holdings: [],
    };
    const setup = buildPlan(settings, defaults, today);
    return describePlanOutlook(settings, setup, planOutlook(setup, settings.stopWorking));
  };

  test('the headline dates, the payoff order and the FIRE share read like the Debts page', () => {
    const lines = outlookLines({ extraMonthly: 200, investments: 20_000_000 });
    expect(lines.slice(0, 2)).toEqual([
      "Payoff plan projection (today's dollars, as if you keep working): debt-free 2027-09 " +
        "(in 20 months), 10 months sooner than paying only what's due (2028-07). Interest left $0.",
      'Under the plan, in order: Delivery Van paid off 2027-09.',
    ]);
    expect(lines).toContain('Going out each month now: $600 to debt plus $3,000 living expenses.');
    expect(lines).toContain('Financially free now: passive income already covers monthly needs.');
    const fire = lines.find((l) => l.startsWith('FIRE number:'));
    const share = Number(fire?.match(/there is \$20,000,000 now \((\d+)%\)\.$/)?.[1]);
    // The page caps its tile at 999% to fit; a model should get the real ratio.
    expect(share).toBeGreaterThan(999);
  });

  test('without living expenses the plan cannot date financial freedom', () => {
    expect(outlookLines({ livingExpenses: 0 })).toContain(
      'Financially free: no living expenses entered, so the plan cannot say.'
    );
  });

  test('the stop-working scenario says when the money runs out, or its lowest point', () => {
    const stop = { stopWorking: '2026-06', birthMonth: '1990-01' };
    expect(outlookLines(stop)).toContain(
      'If you stop working 2026-06: the money runs out 2026-06, at age 36.'
    );
    const lasts = outlookLines({ ...stop, investments: 20_000_000 }).at(-1);
    expect(lasts).toMatch(
      /^If you stop working 2026-06: the money lasts to age 95; lowest point \$[\d,]+ to draw on, in \d{4}-\d{2}, at age \d+\.$/
    );
  });

  test('a debt a planned loan takes over reads as rolled in; a loan that never opens is left out', () => {
    const lines = outlookLines({
      plannedLoans: [
        {
          id: 'loan-1',
          name: 'Example build loan',
          start: '2026-04',
          amount: 20_000,
          rate: 0,
          termMonths: 40,
          paysOff: ['manual:Delivery Van'],
          minimumOnly: false,
        },
        {
          id: 'loan-2',
          name: 'Someday loan',
          start: '2099-01',
          amount: 5_000,
          rate: 0,
          termMonths: 10,
          paysOff: [],
          minimumOnly: false,
        },
      ],
    });
    expect(lines.find((l) => l.startsWith('Under the plan'))).toMatch(
      /^Under the plan, in order: Delivery Van rolled into Example build loan 2026-04; Example build loan paid off \d{4}-\d{2}\.$/
    );
    expect(lines).toContainEqual(
      expect.stringMatching(
        /^Planned loan "Example build loan" opens 2026-04 at \$[\d,]+, \$[\d,]+\/mo\.$/
      )
    );
    expect(lines.join('\n')).not.toContain('Someday loan');
  });

  test('a debt whose payment does not cover its interest is called out', () => {
    const loan: DebtPaymentItem = {
      source: 'manual',
      name: 'Acme Loan',
      kind: 'Personal loan',
      balance: 100_000,
      rate: 0.12,
      monthlyPayment: 500,
    };
    expect(outlookLines({}, [loan])).toContain(
      "Acme Loan: the scheduled payment doesn't cover the interest, so only the plan's extra " +
        'and rolled-over payments pay it off.'
    );
  });

  test('nothing owed says so and lists no payoff order', () => {
    const lines = outlookLines({}, []);
    expect(lines[0]).toBe('Payoff plan projection: nothing owed now or under any planned loan.');
    expect(lines.some((l) => l.startsWith('Under the plan'))).toBe(false);
  });
});
