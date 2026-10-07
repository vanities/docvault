// Regression tests for concurrent writes to the health store.
//
// The store file is tens of megabytes, so a save is slow enough that a HealthKit
// sync landing during a clinical ingest reliably overlaps. Two defects came out
// of that:
//
//   1. Every save used ONE fixed temp path, `<file>.tmp`. Overlapping saves
//      raced: B overwrote A's temp bytes, A renamed (publishing B's content),
//      and B's rename then failed with ENOENT. ~1-2 a day in production.
//   2. Callers did load -> mutate -> save as separate steps, so even without a
//      temp-file collision the last writer clobbered the others' changes.
//
// No personal data — synthetic person ids and counters only.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test';
import { mkdtempSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const DIR = vi.hoisted(() => {
  const d = `${process.env.TMPDIR ?? '/tmp'}/docvault-health-conc-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
  process.env.DOCVAULT_DATA_DIR = d;
  return d;
});

let store: typeof import('./health-store.js');

beforeEach(async () => {
  vi.resetModules();
  rmSync(DIR, { recursive: true, force: true });
  mkdtempSync(path.join(tmpdir(), 'unused-'));
  store = await import('./health-store.js');
  // Seed an empty store on disk.
  await store.saveHealthStore(await store.loadHealthStore());
});

afterEach(() => {
  rmSync(DIR, { recursive: true, force: true });
});

describe('saveHealthStore', () => {
  test('concurrent saves all succeed — no ENOENT from a shared temp path', async () => {
    const base = await store.loadHealthStore();
    const saves = Array.from({ length: 12 }, (_, i) =>
      store.saveHealthStore({ ...base, people: [{ id: `p${i}`, name: `Person ${i}` }] })
    );
    // The bug surfaced as exactly this rejecting with ENOENT on rename.
    await expect(Promise.all(saves)).resolves.toBeDefined();
  });

  test('leaves no temp files behind', async () => {
    const base = await store.loadHealthStore();
    await Promise.all(Array.from({ length: 8 }, () => store.saveHealthStore(base)));
    const leftovers = readdirSync(DIR).filter((f) => f.includes('.tmp'));
    expect(leftovers).toEqual([]);
  });

  test('the file is always valid JSON after concurrent writes', async () => {
    const base = await store.loadHealthStore();
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        store.saveHealthStore({ ...base, people: [{ id: `p${i}`, name: `Person ${i}` }] })
      )
    );
    // A torn write would throw here.
    const after = await store.loadHealthStore();
    expect(Array.isArray(after.people)).toBe(true);
    expect(after.people).toHaveLength(1);
  });
});

describe('updateHealthStore', () => {
  test('concurrent updates do not lose each other (no clobbering)', async () => {
    // Each update appends one person. With a split load/save this drops to 1.
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        store.updateHealthStore((s) => {
          s.people.push({ id: `p${i}`, name: `Person ${i}` });
        })
      )
    );
    const after = await store.loadHealthStore();
    expect(after.people).toHaveLength(10);
  });

  test('a split load/mutate/save DOES lose updates — proving the lock is the fix', async () => {
    // This is the anti-pattern updateHealthStore exists to replace. Asserting
    // the bad behavior keeps the reason for the transaction wrapper honest.
    await Promise.all(
      Array.from({ length: 10 }, async (_, i) => {
        const s = await store.loadHealthStore();
        s.people.push({ id: `q${i}`, name: `Person ${i}` });
        await store.saveHealthStore(s);
      })
    );
    const after = await store.loadHealthStore();
    expect(after.people.length).toBeLessThan(10);
  });

  test('returns the mutator result', async () => {
    const n = await store.updateHealthStore((s) => s.people.length);
    expect(n).toBe(0);
  });

  test('a throwing mutator rejects but does not wedge later writes', async () => {
    await expect(
      store.updateHealthStore(() => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    // The chain must survive a rejection — otherwise one bad write kills all writes.
    await expect(
      store.updateHealthStore((s) => {
        s.people.push({ id: 'after', name: 'After' });
        return s.people.length;
      })
    ).resolves.toBe(1);
  });
});
