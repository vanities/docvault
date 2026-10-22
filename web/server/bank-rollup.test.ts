// Bank rollup tests: what each bank-synced account counts as, and that an
// account the brokerage or crypto sync already values is counted only once.
//
// Every name, balance, and account number below is fabricated.
import { describe, expect, test } from 'vite-plus/test';
import { accountNumberTail, normalizeAccountName, rollUpBankAccounts } from './bank-rollup.js';

const acct = (id: string, name: string, balance: number, connectionName = 'Acme Bank') => ({
  id,
  name,
  balance,
  connectionName,
});

describe('rollUpBankAccounts: cash and debt', () => {
  test('cash, cards and loans land in their buckets, and bankTotal nets them', () => {
    const r = rollUpBankAccounts(
      [
        acct('chk', 'EveryDay Checking (1111)', 2500),
        acct('card', 'Acme Rewards Visa (2222)', -300),
        acct('auto', 'New Vehicle Loan (3333)', -12000),
      ],
      { auto: { type: 'auto-loan', monthlyPayment: 450 } }
    );
    expect(r.liquidCash).toBe(2500);
    expect(r.creditCardDebt).toBe(-300);
    expect(r.autoLoans).toBe(-12000);
    expect(r.totalDebt).toBe(-12300);
    expect(r.bankTotal).toBe(2500 - 12300);
    expect(r.monthlyDebtService).toBe(450);
    expect(r.accounts.map((a) => a.countedIn)).toEqual(['cash', 'debt', 'debt']);
  });
});

describe('rollUpBankAccounts: a loan payment never exceeds what is owed', () => {
  test('a paid-off loan whose annotation still lists a payment adds nothing', () => {
    const r = rollUpBankAccounts([acct('van', 'New Vehicle Loan (4444)', 0)], {
      van: { type: 'auto-loan', monthlyPayment: 600 },
    });
    expect(r.monthlyDebtService).toBe(0);
    expect(r.accounts[0].monthlyPayment).toBe(0);
  });

  test('a loan with less left than one payment counts only the remainder', () => {
    const r = rollUpBankAccounts([acct('truck', 'Truck Loan (5555)', -12.5)], {
      truck: { type: 'auto-loan', monthlyPayment: 600 },
    });
    expect(r.monthlyDebtService).toBe(12.5);
  });
});

describe('rollUpBankAccounts: investment accounts are never cash', () => {
  test('a 401(k) the brokerage sync also has is counted once, by the brokerage', () => {
    const r = rollUpBankAccounts(
      [
        acct('chk', 'EveryDay Checking (1111)', 1000),
        acct('k', 'Self-Employed 401K (6789)', 50000, 'Example Brokerage'),
      ],
      {},
      {
        brokerAccounts: [
          { id: 'b1', name: 'Roth Self-Employed 401K' },
          { id: 'b2', name: 'Self-Employed 401K' },
        ],
      }
    );
    const k = r.accounts.find((a) => a.id === 'k')!;
    expect(k.category).toBe('investment');
    expect(k.countedIn).toBe('elsewhere');
    expect(k.duplicateOf).toBe('Self-Employed 401K');
    expect(r.liquidCash).toBe(1000);
    expect(r.bankTotal).toBe(1000);
    expect(r.brokerageTotal).toBe(0);
    expect(r.countedElsewhereTotal).toBe(50000);
  });

  test('account numbers match even when the names differ', () => {
    const r = rollUpBankAccounts(
      [acct('ira', 'Roth IRA (8642)', 20000, 'Example Brokerage')],
      {},
      { brokerAccounts: [{ id: 'b1', name: 'Jane Doe - Roth IRA Brokerage Account - 97538642' }] }
    );
    expect(r.accounts[0].countedIn).toBe('elsewhere');
  });

  test('the same name with different account numbers is two accounts', () => {
    const r = rollUpBankAccounts(
      [acct('ira', 'Roth IRA (1111)', 20000, 'Example Brokerage')],
      {},
      { brokerAccounts: [{ id: 'b1', name: 'Roth IRA - 2222' }] }
    );
    expect(r.accounts[0].countedIn).toBe('brokerage');
    expect(r.brokerageTotal).toBe(20000);
  });

  test('each brokerage account absorbs at most one bank-synced account', () => {
    const r = rollUpBankAccounts(
      [
        acct('a', 'Traditional IRA', 1000, 'Example Brokerage'),
        acct('b', 'Traditional IRA', 2000, 'Other Brokerage'),
      ],
      {},
      { brokerAccounts: [{ id: 'b1', name: 'Traditional IRA' }] }
    );
    expect(r.accounts.map((a) => a.countedIn)).toEqual(['elsewhere', 'brokerage']);
    expect(r.brokerageTotal).toBe(2000);
  });

  test('an investment account no other sync covers counts under Brokerage, not cash', () => {
    const r = rollUpBankAccounts([acct('hsa', 'Example Health Savings Account (1234)', 3000)], {});
    expect(r.accounts[0].countedIn).toBe('brokerage');
    expect(r.brokerageTotal).toBe(3000);
    expect(r.liquidCash).toBe(0);
    expect(r.bankTotal).toBe(0);
  });
});

describe('rollUpBankAccounts: crypto', () => {
  const sources = [
    { sourceId: 'globex', sourceType: 'exchange', label: 'Globex Exchange' },
    // A self-custody wallet never shows up in a bank sync, whatever its label.
    { sourceId: 'w1', sourceType: 'wallet', label: 'Acme Pay' },
  ];

  test('crypto at an exchange the crypto sync covers is skipped', () => {
    const r = rollUpBankAccounts(
      [acct('btc', 'BTC Wallet', 900, 'Globex Exchange, Inc.')],
      {},
      { cryptoSources: sources }
    );
    expect(r.accounts[0].countedIn).toBe('elsewhere');
    expect(r.accounts[0].duplicateOf).toBe('Globex Exchange');
    expect(r.cryptoTotal).toBe(0);
  });

  test("a payments app's Bitcoin balance that no exchange covers counts under Crypto", () => {
    const r = rollUpBankAccounts(
      [acct('cash', 'Cash', 40, 'Acme Pay'), acct('btc', 'Bitcoin', 800, 'Acme Pay')],
      {},
      { cryptoSources: sources }
    );
    expect(r.accounts.map((a) => a.countedIn)).toEqual(['cash', 'crypto']);
    expect(r.liquidCash).toBe(40);
    expect(r.cryptoTotal).toBe(800);
  });
});

describe('account-number and name helpers', () => {
  test.each([
    ['Checking (1234)', '1234'],
    ['Card - 5678', '5678'],
    ['Brokerage Account 87654321', '4321'],
    ['Self-Employed 401K', null],
  ])('accountNumberTail(%s) -> %s', (name, tail) => {
    expect(accountNumberTail(name)).toBe(tail);
  });

  test('normalizeAccountName drops account numbers and punctuation', () => {
    expect(normalizeAccountName('Self-Employed 401K (1234)')).toBe('self employed 401k');
  });
});
