// All accounts, payees and amounts below are fabricated.
import { afterEach, describe, expect, test } from 'vite-plus/test';
import { promises as fs } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import {
  emptyLedger,
  loadBankTransactions,
  MAX_FETCH_DAYS,
  mergeBankTransactions,
  transactionsBetween,
  transactionsStartDate,
  type BankTransaction,
} from './bank-transactions.js';

const tx = (over: Partial<BankTransaction>): BankTransaction => ({
  id: 't1',
  accountId: 'acct-checking',
  posted: '2026-10-27',
  amount: -100,
  description: 'ACME UTILITIES',
  ...over,
});
const ACCOUNTS = { 'acct-checking': { name: 'Everyday Checking', connectionName: 'Acme Bank' } };
const NOW = new Date('2026-11-01T12:00:00Z');

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

describe('mergeBankTransactions', () => {
  test('keeps one copy per account and id, the newest fetch winning', () => {
    const first = mergeBankTransactions(
      emptyLedger(),
      [tx({ description: 'PENDING TEXT' })],
      ACCOUNTS,
      '2026-10-01',
      NOW
    );
    const second = mergeBankTransactions(
      first,
      [tx({ description: 'FINAL TEXT' })],
      ACCOUNTS,
      '2026-10-20',
      NOW
    );
    expect(second.transactions).toHaveLength(1);
    expect(second.transactions[0].description).toBe('FINAL TEXT');
  });

  test('the same id in two accounts is two transactions', () => {
    const ledger = mergeBankTransactions(
      emptyLedger(),
      [tx({}), tx({ accountId: 'acct-savings' })],
      ACCOUNTS,
      '2026-10-01',
      NOW
    );
    expect(ledger.transactions).toHaveLength(2);
  });

  test('sorts newest first and keeps the earliest date ever requested', () => {
    const a = mergeBankTransactions(
      emptyLedger(),
      [tx({ id: 'old', posted: '2026-08-05' })],
      ACCOUNTS,
      '2026-08-04',
      NOW
    );
    const b = mergeBankTransactions(
      a,
      [tx({ id: 'new', posted: '2026-10-30' })],
      ACCOUNTS,
      '2026-10-20',
      NOW
    );
    expect(b.transactions.map((t) => t.id)).toEqual(['new', 'old']);
    expect(b.coveredFrom).toBe('2026-08-04');
    expect(b.updatedAt).toBe(NOW.toISOString());
  });
});

describe('transactionsStartDate', () => {
  const daysBack = (seconds: number) => (NOW.getTime() / 1000 - seconds) / 86_400;

  test('an empty ledger asks for as much history as SimpleFIN allows', () => {
    expect(daysBack(transactionsStartDate(emptyLedger(), NOW))).toBeCloseTo(MAX_FETCH_DAYS, 3);
  });

  test('after a fetch, re-reads ten days behind it for back-dated postings', () => {
    const ledger = { ...emptyLedger(), updatedAt: '2026-10-31T12:00:00Z' };
    expect(daysBack(transactionsStartDate(ledger, NOW))).toBeCloseTo(11, 3);
  });

  test('a long outage never asks past the 90-day limit', () => {
    const ledger = { ...emptyLedger(), updatedAt: '2026-01-01T00:00:00Z' };
    expect(daysBack(transactionsStartDate(ledger, NOW))).toBeCloseTo(MAX_FETCH_DAYS, 3);
  });
});

test('transactionsBetween is inclusive on both ends', () => {
  const ledger = mergeBankTransactions(
    emptyLedger(),
    [
      tx({ id: 'a', posted: '2026-10-24' }),
      tx({ id: 'b', posted: '2026-10-25' }),
      tx({ id: 'c', posted: '2026-10-31' }),
      tx({ id: 'd', posted: '2026-11-01' }),
    ],
    ACCOUNTS,
    '2026-10-01',
    NOW
  );
  expect(transactionsBetween(ledger, '2026-10-25', '2026-10-31').map((t) => t.id)).toEqual([
    'c',
    'b',
  ]);
});

describe('loadBankTransactions', () => {
  async function dir() {
    const d = await fs.mkdtemp(path.join(tmpdir(), 'bank-tx-'));
    dirs.push(d);
    return d;
  }

  test('a missing file is an empty ledger', async () => {
    const ledger = await loadBankTransactions(path.join(await dir(), 'none.json'));
    expect(ledger.transactions).toEqual([]);
  });

  test('an unreadable file throws instead of starting over', async () => {
    const file = path.join(await dir(), 'ledger.json');
    await fs.writeFile(file, '{ not json');
    await expect(loadBankTransactions(file)).rejects.toThrow();
    await fs.writeFile(file, JSON.stringify({ version: 1 }));
    await expect(loadBankTransactions(file)).rejects.toThrow(/no transactions array/);
  });
});
