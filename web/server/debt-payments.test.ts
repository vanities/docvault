// Debt payment list tests: mortgages, hand-added debts, and bank-synced loans
// and cards combine into one list whose total is the DTI debt service.
//
// Every name and figure below is fabricated.
import { describe, expect, test } from 'vite-plus/test';
import { rollUpBankAccounts } from './bank-rollup.js';
import { buildDebtPayments, type DebtPaymentInputs } from './debt-payments.js';

const bankAccounts = [
  { id: 'chk', name: 'EveryDay Checking (1111)', balance: 2500, connectionName: 'Acme Bank' },
  { id: 'card', name: 'Acme Rewards Visa (2222)', balance: -500, connectionName: 'Acme Bank' },
  { id: 'van', name: 'New Vehicle Loan (3333)', balance: 0, connectionName: 'Acme Bank' },
  { id: 'car', name: 'Auto Loan (4444)', balance: -9000, connectionName: 'Globex CU' },
];
const annotations = {
  van: { type: 'auto-loan' as const, monthlyPayment: 600 },
  car: { type: 'auto-loan' as const, monthlyPayment: 350, rate: 0.03, notes: 'Sedan' },
};

function inputs(overrides: Partial<DebtPaymentInputs> = {}): DebtPaymentInputs {
  return {
    properties: [
      {
        name: 'Main House',
        mortgage: { lender: 'Example Mortgage', balance: 200000, rate: 0.03, monthlyPayment: 1200 },
      },
      {
        name: 'Paid-off Cabin',
        mortgage: { lender: 'Old Lender', balance: 0, monthlyPayment: 800 },
      },
      { name: 'Empty Lot' },
    ],
    liabilities: [
      {
        name: 'Tractor loan',
        lender: 'Example Credit',
        balance: 40000,
        rate: 0,
        monthlyPayment: 900,
      },
    ],
    bankAccounts,
    bankRollup: rollUpBankAccounts(bankAccounts, annotations),
    annotations,
    ...overrides,
  };
}

describe('buildDebtPayments', () => {
  test('every source lands in one list, known payments first, estimates last', () => {
    const d = buildDebtPayments(inputs());
    expect(d.items.map((i) => [i.name, i.monthlyPayment, !!i.estimated])).toEqual([
      ['Main House', 1200, false],
      ['Tractor loan', 900, false],
      ['Sedan', 350, false],
      ['Acme Rewards Visa (2222)', 25, true],
    ]);
    expect(d.total).toBe(1200 + 900 + 350 + 25);
    expect(d.estimatedTotal).toBe(25);
    expect(d.bySource).toEqual({ property: 1200, manual: 900, bank: 375 });
  });

  test('paid-off debts are left out even when an old payment is still saved', () => {
    const names = buildDebtPayments(inputs()).items.map((i) => i.name);
    expect(names).not.toContain('Paid-off Cabin');
    expect(names).not.toContain('New Vehicle Loan (3333)');
    expect(names).not.toContain('Empty Lot');
  });

  test('bank items carry the account type, the lender, and the note as their name', () => {
    const car = buildDebtPayments(inputs()).items.find((i) => i.name === 'Sedan')!;
    expect(car).toMatchObject({
      source: 'bank',
      kind: 'Auto Loan',
      lender: 'Globex CU',
      balance: 9000,
      rate: 0.03,
    });
  });

  test('a payment never exceeds what is owed', () => {
    const d = buildDebtPayments(
      inputs({ liabilities: [{ name: 'Almost done', balance: 150, monthlyPayment: 900 }] })
    );
    expect(d.items.find((i) => i.name === 'Almost done')!.monthlyPayment).toBe(150);
  });
});
