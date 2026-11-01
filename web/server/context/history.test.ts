// Fabricated labels and balances only.
import { afterEach, describe, expect, test, vi } from 'vite-plus/test';
import { promises as fs } from 'fs';
import path from 'path';
import { tmpdir } from 'os';

vi.hoisted(() => {
  process.env.DOCVAULT_DATA_DIR = `${process.env.TMPDIR ?? '/tmp'}/docvault-context-history-${Date.now()}`;
});

const { createContextHistory, diffHistory } = await import('./history.js');
const { recordContextHistory } = await import('./registry.js');
import type { ContextSource } from './types.js';

const dirs: string[] = [];
async function history() {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'context-history-'));
  dirs.push(dir);
  return createContextHistory(dir);
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

const loan = (value: number) => ({ 'manual:Van': { label: 'Van (Loan)', value } });

describe('context history store', () => {
  test('one record per day: recording the same day again replaces it', async () => {
    const h = await history();
    await h.record('debts', '2026-03-23', loan(100));
    await h.record('debts', '2026-03-23', loan(90));
    expect(await h.load('debts', '2026-03-01', '2026-03-31')).toEqual([
      { date: '2026-03-23', metrics: loan(90) },
    ]);
  });

  test('loads across a year boundary, oldest first', async () => {
    const h = await history();
    await h.record('debts', '2027-01-02', loan(80));
    await h.record('debts', '2026-12-30', loan(85));
    const days = await h.load('debts', '2026-12-01', '2027-01-31');
    expect(days.map((d) => d.date)).toEqual(['2026-12-30', '2027-01-02']);
  });

  test('refuses ids that could leave the history folder', async () => {
    const h = await history();
    expect(() => h.record('../escape', '2026-03-23', loan(1))).toThrow(/Invalid context source/);
    await expect(h.load('debts', '2026-1-1', '2026-03-31')).rejects.toThrow(/Invalid date/);
  });
});

describe('diffHistory', () => {
  const days = [
    { date: '2026-03-20', metrics: { a: { label: 'Cabin loan', value: 197_000 } } },
    {
      date: '2026-03-23',
      metrics: {
        a: { label: 'Cabin loan', value: 185_000 },
        b: { label: 'New loan', value: 5_000 },
      },
    },
    { date: '2026-03-24', metrics: { a: { label: 'Cabin loan', value: 185_000 } } },
  ];

  test('compares with the recorded day before, even when it falls before the window', () => {
    const changes = diffHistory(days, { from: '2026-03-23', to: '2026-03-31' });
    expect(changes).toContainEqual({
      date: '2026-03-23',
      previousDate: '2026-03-20',
      key: 'a',
      label: 'Cabin loan',
      before: 197_000,
      after: 185_000,
    });
  });

  test('reports metrics that appear and disappear', () => {
    const changes = diffHistory(days, { from: '2026-03-21', to: '2026-03-31' });
    expect(changes.filter((c) => c.key === 'b')).toEqual([
      { date: '2026-03-23', previousDate: '2026-03-20', key: 'b', label: 'New loan', after: 5_000 },
      {
        date: '2026-03-24',
        previousDate: '2026-03-23',
        key: 'b',
        label: 'New loan',
        before: 5_000,
      },
    ]);
  });

  test('nothing outside the window, and nothing below the minimum change', () => {
    expect(diffHistory(days, { from: '2026-03-24', to: '2026-03-31' })).toHaveLength(1);
    expect(diffHistory(days, { from: '2026-03-01', to: '2026-03-22' })).toEqual([]);
  });
});

describe('recordContextHistory', () => {
  const source = (
    id: string,
    metrics: () => Promise<Record<string, never> | ReturnType<typeof loan>>
  ) =>
    ({
      id,
      label: id,
      group: 'money',
      description: 'test source',
      files: [],
      state: async () => [],
      metrics,
    }) as ContextSource;

  test('records sources with numbers, skips empty ones, and survives a failing one', async () => {
    const h = await history();
    const result = await recordContextHistory(
      '2026-11-01',
      [
        source('debts', async () => loan(50)),
        source('bank-accounts', async () => ({})),
        source('broken', async () => {
          throw new Error('store unreadable');
        }),
      ],
      h
    );
    expect(result).toEqual({ recorded: ['debts'], empty: ['bank-accounts'], failed: ['broken'] });
    expect(await h.load('bank-accounts', '2026-11-01', '2026-11-01')).toEqual([]);
    expect(await h.load('debts', '2026-11-01', '2026-11-01')).toHaveLength(1);
  });
});
