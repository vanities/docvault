// Invented bank and brokerage records for native contract and UI verification.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function seedNativeFinance(dataDir: string) {
  const settingsFile = path.join(dataDir, '.docvault-settings.json');
  const settings = JSON.parse(await readFile(settingsFile, 'utf8'));
  const manual = {
    id: 'synthetic-broker',
    broker: 'other',
    name: 'Acme Brokerage',
    holdings: [
      { ticker: 'FDEMO', shares: 4, costBasis: 320, price: 100, label: 'Fictional Growth Fund' },
      { ticker: 'CASH', shares: 1, price: 50, label: 'Synthetic cash' },
    ],
  };
  const fixed = {
    id: 'synthetic-fixed',
    broker: 'other',
    name: 'Acme Fixed Account',
    holdings: [],
    overrideValue: 550,
  };
  settings.simplefin = { accessUrl: 'https://example.com/synthetic-disabled-bank' };
  settings.brokers = { accounts: [manual, fixed] };
  await writeFile(settingsFile, JSON.stringify(settings));
  const stamp = new Date().toISOString();
  await writeFile(
    path.join(dataDir, '.docvault-simplefin-cache.json'),
    JSON.stringify({
      lastUpdated: stamp,
      connectionErrors: [],
      accounts: [
        {
          id: 'synthetic-checking',
          name: 'Acme Checking',
          connId: 'synthetic-bank',
          connectionName: 'Acme Bank',
          currency: 'USD',
          balance: 1234.56,
          availableBalance: 1200,
          balanceDate: 1791288000,
        },
        {
          id: 'synthetic-card',
          name: 'Acme Credit Card',
          connId: 'synthetic-bank',
          connectionName: 'Acme Bank',
          currency: 'USD',
          balance: -200,
          availableBalance: 0,
          balanceDate: 1791288000,
        },
        {
          id: 'synthetic-zero',
          name: 'Acme Empty Savings',
          connId: 'synthetic-second',
          connectionName: 'Example Credit Union',
          currency: 'USD',
          balance: 0,
          availableBalance: 0,
          balanceDate: 1791288000,
        },
        {
          id: 'synthetic-euro',
          name: 'Acme Euro Account',
          connId: 'synthetic-third',
          connectionName: 'Example European Bank',
          currency: 'EUR',
          balance: 500,
          availableBalance: null,
          balanceDate: 1791288000,
        },
        {
          id: 'synthetic-missing',
          name: 'Acme Unavailable Account',
          connId: 'synthetic-third',
          connectionName: 'Example European Bank',
          currency: 'EUR',
          balance: null,
          availableBalance: null,
          balanceDate: null,
        },
      ],
    })
  );
  await writeFile(
    path.join(dataDir, '.docvault-account-annotations.json'),
    JSON.stringify({
      'synthetic-card': {
        type: 'credit-card',
        rate: 0.1,
        monthlyPayment: 30,
        notes: 'Synthetic account note.',
      },
    })
  );
  await writeFile(
    path.join(dataDir, '.docvault-broker-cache.json'),
    JSON.stringify({
      accounts: [
        {
          ...manual,
          holdings: [
            {
              ...manual.holdings[0],
              marketValue: 400,
              gainLoss: 80,
              gainLossPercent: 25,
              gainType: 'long-term',
            },
            { ...manual.holdings[1], marketValue: 50, gainLoss: null },
          ],
          totalValue: 450,
          totalCostBasis: 320,
          totalGainLoss: 80,
        },
        { ...fixed, totalValue: 550, totalCostBasis: 0, totalGainLoss: 0 },
      ],
      totalValue: 1000,
      totalCostBasis: 320,
      totalGainLoss: 80,
      shortTermGains: 0,
      longTermGains: 80,
      lastUpdated: stamp,
    })
  );
  const cacheFile = path.join(dataDir, '.docvault-ticker-cache.json');
  const cache = JSON.parse(await readFile(cacheFile, 'utf8'));
  cache.quotes.FDEMO = {
    symbol: 'FDEMO',
    price: 100,
    currency: 'USD',
    name: 'Fictional Growth Fund',
    fetchedAt: stamp,
    error: null,
    performance: {
      asOf: stamp,
      changes: {
        '1D': { amount: 2, percent: 2.04, baselineDate: '2026-10-05' },
        '7D': { amount: 5, percent: 5.26, baselineDate: '2026-09-29' },
        '1M': null,
      },
    },
    sparklineCloses: [80, 90, 88, 100],
    oneYearChangePct: 25,
    fiftyTwoWeekLow: 80,
    fiftyTwoWeekHigh: 100,
  };
  await writeFile(cacheFile, JSON.stringify(cache));
  const now = new Date();
  const snapshots = Array.from({ length: 45 }, (_, index) => {
    const day = new Date(now);
    day.setUTCDate(now.getUTCDate() - 44 + index);
    return {
      date: day.toISOString().slice(0, 10),
      totalValue: 2000 + index * 10,
      bankValue: index === 15 ? null : 900 + index * 3,
      brokerValue: 800 + index * 5,
      cryptoValue: 0,
      goldValue: 0,
      propertyValue: 0,
    };
  });
  const years = new Set(snapshots.map((row) => row.date.slice(0, 4)));
  for (const year of years)
    await writeFile(
      path.join(dataDir, `.docvault-portfolio-snapshots-${year}.json`),
      JSON.stringify(snapshots.filter((row) => row.date.startsWith(year)))
    );
}
