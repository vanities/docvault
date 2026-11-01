// A recorded Newsstand digest over a fabricated household, so moving how the
// digest is gathered (server/context/) can be checked line by line. Lines are
// compared per desk as sorted sets: regrouping lines inside a desk is fine,
// losing, adding or rewording one is not, and desk order is kept.
//
// Every name, amount and date below is fabricated. When an intended change
// alters a line, update the snapshot and review its diff like code.

import { mkdirSync, writeFileSync, utimesSync } from 'fs';
import path from 'path';
import { afterAll, beforeAll, expect, test, vi } from 'vite-plus/test';

const DATA = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? '/tmp'}/docvault-newsstand-golden-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
  process.env.DOCVAULT_DATA_DIR = dir;
  return dir;
});

vi.mock('./ticker-prices.js', () => ({
  fetchTickerPrices: async (symbols: string[]) => ({
    quotes: symbols.map((symbol) => ({
      symbol,
      price: symbol === 'GLD' ? 180.25 : symbol === 'SLV' ? 22.5 : 101.5,
      oneYearChangePct: symbol === 'SLV' ? -4 : 12,
    })),
  }),
}));

const NOW = new Date('2026-03-15T15:00:00.000Z');
const write = (name: string, value: unknown) =>
  writeFileSync(
    path.join(DATA, name),
    typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  );

function seed(): void {
  mkdirSync(DATA, { recursive: true });

  write('.docvault-quant-cache.json', {
    fearGreed: { data: { latest: { value: 42, classification: 'Fear' }, ma30: 47.6 } },
    btcDrawdown: { data: { latest: { drawdown: -0.183, ath: 120000, daysSinceAth: 61 } } },
    altcoinSeason: { data: { indexValue: 31, regime: 'bitcoin-season', btcReturn90d: 0.12 } },
    predictions: {
      data: {
        finance: [
          {
            source: 'Kalshi',
            topic: 'fed',
            question: 'Fed cuts in June?',
            probability: 35,
            volumeUsd: 900,
          },
        ],
        politics: [
          {
            source: 'Polymarket',
            topic: 'senate',
            question: 'Senate flips?',
            probability: 41,
            volumeUsd: 500,
          },
        ],
      },
    },
  });

  write('.docvault-portfolio-snapshots-2026.json', [
    {
      date: '2026-03-01',
      totalValue: 500000,
      cryptoValue: 200000,
      brokerValue: 150000,
      bankValue: 50000,
      goldValue: 20000,
      propertyValue: 80000,
    },
    {
      date: '2026-03-09',
      totalValue: 510000,
      cryptoValue: 205000,
      brokerValue: 152000,
      bankValue: 52000,
      goldValue: 21000,
      propertyValue: 80000,
    },
    {
      date: '2026-03-14',
      totalValue: 498000,
      cryptoValue: 190000,
      brokerValue: 155000,
      bankValue: 52000,
      goldValue: 21000,
      propertyValue: 80000,
    },
    {
      date: '2026-03-15',
      totalValue: 501000,
      cryptoValue: 193000,
      brokerValue: 155000,
      bankValue: 52000,
      goldValue: 21000,
      propertyValue: 80000,
    },
  ]);

  write('.docvault-research.json', {
    entries: {
      r1: {
        id: 'r1',
        domain: 'finance',
        filename: null,
        filePath: 'research/r1.txt',
        mediaType: 'text/plain',
        uploadedAt: '2026-03-14T20:00:00.000Z',
        reportDate: '2026-03-14',
        text: 'Rates stay high while credit spreads widen. '.repeat(20),
        pageCount: null,
        extractedAt: null,
        title: 'Credit check',
        publisher: 'Acme Macro',
        tickers: ['ACME'],
        sourceUrl: 'https://example.com/credit-check',
        intelligence: { summary: [{ text: 'Spreads widened for a third week.' }] },
      },
      r2: {
        id: 'r2',
        domain: 'local',
        filename: null,
        filePath: 'research/r2.txt',
        mediaType: 'text/plain',
        uploadedAt: '2026-03-10T13:00:00.000Z',
        reportDate: '2026-03-10',
        text: 'The town council approved a new library branch.',
        pageCount: null,
        extractedAt: null,
        title: 'Library approved',
        publisher: 'Example Gazette',
        sourceUrl: 'https://example.com/library',
      },
      r3: {
        id: 'r3',
        domain: 'tech',
        filename: null,
        filePath: 'research/r3.txt',
        mediaType: 'text/plain',
        uploadedAt: '2026-02-01T13:00:00.000Z',
        reportDate: '2026-02-01',
        text: 'Old news outside every window.',
        pageCount: null,
        extractedAt: null,
        title: 'Old piece',
        publisher: 'Example Weekly',
      },
    },
  });

  write('.docvault-sales.json', {
    products: [
      { id: 'p1', name: 'Eggs' },
      { id: 'p2', name: 'Honey' },
    ],
    sales: [
      { date: '2026-03-14', productId: 'p1', total: 24 },
      { date: '2026-03-11', productId: 'p2', total: 40 },
      { date: '2026-02-20', productId: 'p1', total: 18 },
    ],
  });
  write('.docvault-mileage.json', {
    irsRate: 0.7,
    entries: [
      { date: '2026-03-12', tripMiles: 42 },
      { date: '2026-03-14', tripMiles: 18 },
    ],
  });
  write('.docvault-strategy-history.json', {
    entries: [
      {
        id: 's1',
        title: 'Hold steady',
        body: 'Keep the allocation; add on dips.',
        createdAt: '2026-03-13T12:00:00.000Z',
      },
    ],
  });
  write('.docvault-broker-cache.json', { accounts: [{ id: 'b1', name: 'Acme Brokerage' }] });
  write('.docvault-broker-activities.json', {
    accounts: {
      b1: {
        activities: [
          { type: 'BUY', tradeDate: '2026-03-12', ticker: 'ACME', amount: -1500 },
          { type: 'DIVIDEND', tradeDate: '2026-03-14', ticker: 'GLOBEX', amount: 42.1 },
        ],
      },
    },
  });
  write('.docvault-crypto-cache.json', {
    totalUsdValue: 193000,
    byAsset: [
      { asset: 'BTC', usdValue: 150000 },
      { asset: 'ETH', usdValue: 30000 },
      { asset: 'USDC', usdValue: 13000 },
    ],
  });
  write('.docvault-income.json', {
    sources: [
      {
        id: 'i1',
        name: 'Consulting retainer',
        amount: 4000,
        frequency: 'monthly',
        taxable: true,
        createdAt: '2026-03-13T12:00:00.000Z',
      },
      {
        id: 'i2',
        name: 'Pension',
        amount: 1200,
        frequency: 'monthly',
        taxable: true,
        createdAt: '2025-01-01T00:00:00.000Z',
      },
    ],
  });
  write('.docvault-estimated-taxes.json', {
    'personal/2026': {
      payments: [{ quarter: 1, amount: 2500, date: '2026-03-12' }],
      config: { annualTarget: 10000 },
    },
  });
  write('.docvault-contributions.json', {
    'personal/2026': [
      { amount: 1000, type: 'employee', date: '2026-03-10' },
      { amount: 500, type: 'employer', date: '2026-01-15' },
    ],
  });
  write('.docvault-federal.json', {
    '2025': {
      filed: true,
      filedDate: '2026-03-11',
      agi: 98000,
      taxableIncome: 80000,
      tax: { totalTax: 12000 },
      balance: { totalOwed: -800 },
    },
  });
  write('.docvault-property.json', {
    entries: [
      {
        id: 'h1',
        name: 'Lakeside Cabin',
        type: 'primary-residence',
        address: { street: '1 Example Way', city: 'Springfield', state: 'XX', zip: '00000' },
        purchaseDate: '2020-01-01',
        purchasePrice: 200000,
        currentValue: 250000,
        mortgage: { lender: 'Acme Lending', balance: 170000, rate: 0.04, monthlyPayment: 1200 },
        lastAmortizationDate: '2026-03',
        createdAt: '2020-01-01T00:00:00.000Z',
      },
    ],
  });
  write('.docvault-liabilities.json', {
    entries: [
      {
        id: 'l1',
        name: 'Delivery Van',
        lender: 'Globex Credit',
        type: 'auto-loan',
        balance: 12000,
        rate: 0.05,
        monthlyPayment: 400,
        createdAt: '2025-01-01T00:00:00.000Z',
      },
    ],
  });
  write('.docvault-gold.json', {
    entries: [
      { id: 'g1', metal: 'gold', weightOz: 1, quantity: 3, createdAt: '2025-01-01T00:00:00.000Z' },
    ],
  });
  write('.docvault-assets.json', {
    'personal/2026': [{ id: 'a1', name: 'Utility trailer', value: 3500 }],
  });

  write('.docvault-simplefin-cache.json', {
    lastUpdated: '2026-03-15T14:00:00.000Z',
    accounts: [
      {
        id: 'c1',
        name: 'Everyday Checking',
        connId: 'x',
        currency: 'USD',
        balance: 8400,
        availableBalance: null,
        balanceDate: null,
        connectionName: 'Acme Bank',
      },
      {
        id: 'k1',
        name: 'Rewards Card',
        connId: 'x',
        currency: 'USD',
        balance: -650,
        availableBalance: null,
        balanceDate: null,
        connectionName: 'Acme Bank',
      },
    ],
  });
  write('.docvault-bank-transactions.json', {
    version: 1,
    updatedAt: '2026-03-15T14:00:00.000Z',
    coveredFrom: '2026-01-01',
    accounts: { c1: { name: 'Everyday Checking' } },
    transactions: [
      {
        id: 't3',
        accountId: 'c1',
        posted: '2026-03-13',
        amount: -5000,
        description: 'WEB PMT 552',
        payee: 'Acme Lending',
      },
      {
        id: 't2',
        accountId: 'c1',
        posted: '2026-03-12',
        amount: 5000,
        description: 'TRANSFER FROM SAVINGS',
      },
      {
        id: 't1',
        accountId: 'c1',
        posted: '2026-03-12',
        amount: -38.5,
        description: 'CORNER GROCERY',
      },
    ],
  });

  write('.docvault-config.json', {
    entities: [{ id: 'acme-llc', name: 'Acme LLC', type: 'docs', path: 'acme-llc' }],
  });
  mkdirSync(path.join(DATA, 'acme-llc'), { recursive: true });
  writeFileSync(path.join(DATA, 'acme-llc', 'Acme_Invoice_2026-03-14.pdf'), 'fake pdf');
  writeFileSync(path.join(DATA, 'acme-llc', 'Acme_Receipt_2026-02-01.pdf'), 'fake pdf');
  utimesSync(
    path.join(DATA, 'acme-llc', 'Acme_Invoice_2026-03-14.pdf'),
    new Date('2026-03-14T18:00:00Z'),
    new Date('2026-03-14T18:00:00Z')
  );
  utimesSync(
    path.join(DATA, 'acme-llc', 'Acme_Receipt_2026-02-01.pdf'),
    new Date('2026-02-01T18:00:00Z'),
    new Date('2026-02-01T18:00:00Z')
  );

  write('.docvault-deep-research.json', {
    d1: {
      id: 'd1',
      question: 'Is a 15-year refinance worth it?',
      status: 'done',
      searchCount: 6,
      createdAt: '2026-03-13T10:00:00.000Z',
      completedAt: '2026-03-13T10:20:00.000Z',
    },
  });
  write('.docvault-todos.json', [
    {
      id: 'td1',
      title: 'Renew trailer tags',
      status: 'pending',
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-14T16:00:00.000Z',
    },
  ]);
  write('.docvault-calendar.json', {
    version: 1,
    events: [
      {
        id: 'e1',
        kind: 'event',
        title: 'County fair',
        date: '2026-03-18',
        status: 'active',
        completions: [],
        createdAt: '2026-03-01T00:00:00.000Z',
      },
      {
        id: 'e2',
        kind: 'birthday',
        title: 'Sam Example',
        date: '1990-03-20',
        status: 'active',
        completions: [],
        createdAt: '2026-03-01T00:00:00.000Z',
      },
    ],
  });
  write('.docvault-politics.json', {
    generatedAt: '2026-03-15T06:00:00.000Z',
    bills: [
      {
        externalId: 'hr-1234-119',
        congress: 119,
        number: '1234',
        officialId: 'HR 1234',
        title: 'Example Roads Act',
        type: 'hr',
        status: 'introduced',
        introducedDate: '2026-03-12',
        latestAction: 'Referred to committee',
        latestActionDate: '2026-03-12',
        summary: 'Funds rural road repair.',
        summarySource: 'congress-crs',
        summaryActionDate: '2026-03-12',
      },
    ],
    executiveActions: [
      {
        slug: 'eo-1',
        type: 'executive_order',
        title: 'Example Order on Ports',
        issuedDate: '2026-03-13',
        url: null,
        federalRegisterNumber: '2026-00001',
      },
    ],
    trades: [],
    filings: [],
    cursors: {},
    seen: { houseDocIds: [], ogeDocIds: [], senateFilingIds: [] },
  });
  write('.docvault-health.json', {
    version: 1,
    people: [{ id: 'pat', name: 'Pat Example' }],
    summaries: {},
    snapshots: {
      'pat/export.zip': {
        generatedAt: '2026-03-15T08:00:00.000Z',
        activity: {
          daily: [
            { date: '2026-03-13', steps: 9100 },
            { date: '2026-03-14', steps: 10200, steps7dAvg: 9500 },
          ],
        },
        heart: { daily: [{ date: '2026-03-15', restingHR: 57, hrv: 48 }] },
        sleep: {
          daily: [{ date: '2026-03-15', asleepMinutes: 440, deepMinutes: 70, remMinutes: 95 }],
        },
        body: { headline: { currentLb: 172 } },
      },
    },
    nutrition: { 'pat/n1': { status: 'active', parsed: { productName: 'Vitamin D3' } } },
  });
}

let gatherDigest: typeof import('./daily-news.js').gatherDigest;

beforeAll(async () => {
  seed();
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  ({ gatherDigest } = await import('./daily-news.js'));
});

afterAll(() => {
  vi.useRealTimers();
});

function normalize(d: Awaited<ReturnType<typeof gatherDigest>>) {
  return {
    desks: d.sections.map((s) => ({ desk: s.desk, items: [...s.items].sort() })),
    citations: [...(d.citations ?? [])].map((c) => `${c.ref} ${c.url}`).sort(),
    pulled: d.pulled.map((p) => `${p.source} | ${p.title} | ${p.url ?? ''}`).sort(),
    weekAhead: d.weekAhead?.items.map((i) => `${i.date} ${i.kind} ${i.title}`) ?? [],
    warnings: d.sourceWarnings.map((w) => w.source).sort(),
  };
}

test('weekly digest over the fabricated household', async () => {
  const digest = await gatherDigest('weekly', '2026-03-08T15:00:00.000Z', '2026-03-15');
  expect(normalize(digest)).toMatchSnapshot();
});

test('daily digest over the fabricated household', async () => {
  const digest = await gatherDigest('daily', '2026-03-14T15:00:00.000Z', '2026-03-15');
  expect(normalize(digest)).toMatchSnapshot();
});
