// Net-worth regression tests for the financial snapshot: bank-synced accounts
// that are not cash, and broker accounts that carry only a fixed balance.
//
// Two bugs this guards against: a 401(k) that the bank sync also returns was
// counted as cash AND again under Brokerage, and a fixed-balance broker account
// (overrideValue, no holdings) was counted as $0 because the snapshot summed
// holdings. Every name and figure below is fabricated. Uses a temp DATA_DIR so
// file I/O can never touch real data.
import { promises as fs } from 'fs';
import path from 'path';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vite-plus/test';

// data.ts reads DOCVAULT_DATA_DIR at module load, so set it before any import.
const tmpDataDir = vi.hoisted(() => {
  const p = require('path') as typeof import('path');
  const o = require('os') as typeof import('os');
  const dir = p.join(o.tmpdir(), `docvault-snapshot-networth-test-${Date.now()}`);
  process.env.DOCVAULT_DATA_DIR = dir;
  return dir;
});

vi.mock('../logger.js', () => ({
  createLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    timer: () => () => 0,
  }),
}));

// The snapshot always asks for metal spot prices; keep the test offline.
vi.mock('../data.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data.js')>()),
  fetchMetalSpotPrices: async () => ({}),
}));

import { handleFinancialSnapshotRoutes } from './financial-snapshot.js';

const bank = (id: string, name: string, balance: number, connectionName: string) => ({
  id,
  name,
  connId: 'conn',
  currency: 'USD',
  balance,
  availableBalance: null,
  balanceDate: null,
  connectionName,
});

const brokerAccount = (name: string, holdingsValue: number[], overrideValue?: number) => ({
  id: name,
  broker: 'other',
  name,
  holdings: holdingsValue.map((v, i) => ({
    ticker: `FAKE${i}`,
    shares: 1,
    costBasis: v,
    label: `Fake Fund ${i}`,
    price: v,
    marketValue: v,
    gainLoss: 0,
    gainLossPercent: 0,
    gainType: 'long-term',
  })),
  totalValue: overrideValue ?? holdingsValue.reduce((s, v) => s + v, 0),
  ...(overrideValue !== undefined ? { overrideValue } : {}),
});

beforeAll(async () => {
  await fs.mkdir(tmpDataDir, { recursive: true });
  const write = (file: string, data: unknown) =>
    fs.writeFile(path.join(tmpDataDir, file), JSON.stringify(data));
  await write('.docvault-simplefin-cache.json', {
    lastUpdated: '2026-01-15T12:00:00.000Z',
    accounts: [
      bank('chk', 'EveryDay Checking (1111)', 1000, 'Acme Bank'),
      bank('card', 'Acme Rewards Visa (2222)', -200, 'Acme Bank'),
      bank('loan', 'New Vehicle Loan (3333)', 0, 'Acme Bank'),
      bank('k', 'Self-Employed 401K (4444)', 50000, 'Example Brokerage'),
      bank('btc', 'Bitcoin', 300, 'Acme Pay'),
    ],
  });
  // The paid-off loan still lists its old payment.
  await write('.docvault-account-annotations.json', {
    loan: { type: 'auto-loan', monthlyPayment: 600 },
  });
  await write('.docvault-broker-cache.json', {
    lastUpdated: '2026-01-15T12:00:00.000Z',
    accounts: [
      brokerAccount('Self-Employed 401K', [52000]),
      brokerAccount('Example 401(k) Plan', [], 30000),
    ],
  });
});

afterAll(async () => {
  await fs.rm(tmpDataDir, { recursive: true, force: true });
});

async function snapshot(format: 'json' | 'md') {
  const url = new URL(`http://localhost:3005/api/financial-snapshot/2026?format=${format}`);
  const res = await handleFinancialSnapshotRoutes(new Request(url), url, url.pathname);
  expect(res, 'route handled').not.toBeNull();
  return res!;
}

describe('financial snapshot net worth', () => {
  test('each account is counted once, in the right bucket', async () => {
    const json = await (await snapshot('json')).json();
    const s = json.portfolioSummary;
    // 52,000 of holdings + a 30,000 fixed balance; the bank-synced 401(k) copy is skipped.
    expect(s.brokerage).toBe(82000);
    // The bank-synced Bitcoin balance has no crypto source, so it counts as crypto.
    expect(s.crypto).toBe(300);
    // Only checking minus the card: the 401(k) and Bitcoin are not cash.
    expect(s.liquidCash).toBe(1000);
    expect(s.bankAccounts).toBe(800);
    expect(s.totalNetWorth).toBe(82000 + 300 + 800);
  });

  test('a paid-off loan adds no monthly debt service', async () => {
    const json = await (await snapshot('json')).json();
    expect(json.portfolioSummary.bankMonthlyDebtService).toBe(0);
  });

  test('the markdown says where each non-cash account went', async () => {
    const md = await (await snapshot('md')).text();
    expect(md).toContain('| Investment | Not counted: already in "Self-Employed 401K" |');
    expect(md).toContain('| Crypto | Crypto |');
    expect(md).toContain('**Total (cash minus debt)** | **$800.00**');
    expect(md).toContain('Total value: $30,000.00 (fixed balance)');
  });
});
