// Invented consolidated records. Called explicitly; other fixture flows keep
// their own seeds and reset contracts.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { seedNativeFinance } from './ios-finance-fixture';
import { seedNativeTax } from './ios-tax-fixture';

export async function seedNativeSnapshot(dataDir: string, pdf: Uint8Array) {
  await seedNativeFinance(dataDir);
  await seedNativeTax(dataDir, pdf);
  const stamp = new Date().toISOString();
  const records: Record<string, unknown> = {
    '.docvault-income.json': {
      sources: [
        {
          id: 'snapshot-income',
          name: 'Acme Monthly Income',
          amount: 4000,
          frequency: 'monthly',
          taxable: true,
        },
      ],
    },
    '.docvault-liabilities.json': {
      entries: [
        {
          id: 'snapshot-loan',
          name: 'Acme Equipment Loan',
          type: 'equipment-loan',
          balance: 300,
          monthlyPayment: 25,
          rate: 0.05,
          createdAt: stamp,
        },
      ],
    },
    '.docvault-sales.json': {
      products: [{ id: 'snapshot-product', name: 'Synthetic Kit', price: 100 }],
      sales: [
        {
          id: 'snapshot-sale1',
          person: 'Acme Buyer',
          productId: 'snapshot-product',
          quantity: 2,
          total: 200,
          date: '2026-02-15',
          entity: 'tax-demo',
          createdAt: stamp,
        },
        {
          id: 'snapshot-sale2',
          person: 'Acme Buyer',
          productId: 'snapshot-product',
          quantity: 3,
          total: 300,
          date: '2026-07-15',
          entity: 'tax-demo',
          createdAt: stamp,
        },
        {
          id: 'snapshot-oldsale',
          person: 'Acme Buyer',
          productId: 'snapshot-product',
          quantity: 9,
          total: 900,
          date: '2025-01-10',
          entity: 'tax-demo',
          createdAt: stamp,
        },
      ],
    },
    '.docvault-mileage.json': {
      vehicles: [{ id: 'snapshot-car', name: 'Synthetic Car' }],
      irsRate: 0.5,
      entries: [
        {
          id: 'snapshot-trip',
          vehicleId: 'snapshot-car',
          date: '2026-02-12',
          tripMiles: 100,
          purpose: 'Invented delivery',
        },
      ],
    },
    '.docvault-contributions.json': {
      'tax-demo/2026': [
        {
          id: 'snapshot-employee',
          date: '2026-02-20',
          type: 'employee',
          amount: 200,
          notes: 'Invented deferral',
        },
      ],
      'tax-other/2026': [
        { id: 'snapshot-employer', date: '2026-03-20', type: 'employer', amount: 100 },
      ],
      'tax-demo/2025': [{ id: 'snapshot-old', date: '2025-02-20', type: 'employee', amount: 50 }],
    },
    '.docvault-calendar.json': {
      version: 1,
      events: [
        {
          id: 'snapshot-reminder',
          kind: 'task',
          title: 'Review synthetic tax records',
          date: '2027-04-10',
          entityId: 'tax-demo',
          status: 'active',
          completions: [],
          notes: 'Invented filing-season reminder',
          createdAt: stamp,
          updatedAt: stamp,
        },
        {
          id: 'snapshot-excluded-reminder',
          kind: 'task',
          title: 'Later unrelated reminder',
          date: '2027-06-10',
          status: 'active',
          completions: [],
          createdAt: stamp,
          updatedAt: stamp,
        },
      ],
    },
  };
  for (const [file, data] of Object.entries(records))
    await writeFile(path.join(dataDir, file), JSON.stringify(data));
}

export async function clearNativeSnapshot(dataDir: string) {
  for (const [file, data] of Object.entries({
    '.docvault-income.json': { sources: [] },
    '.docvault-liabilities.json': { entries: [] },
    '.docvault-sales.json': { products: [], sales: [] },
    '.docvault-mileage.json': { vehicles: [], entries: [], irsRate: 0.5 },
    '.docvault-contributions.json': {},
    '.docvault-calendar.json': { version: 1, events: [] },
  }))
    await writeFile(path.join(dataDir, file), JSON.stringify(data));
}
