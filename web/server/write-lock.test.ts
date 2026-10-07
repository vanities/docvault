// Tests for the shared write primitives. These back two production incidents:
// ~400 ENOENT errors from concurrent health-store saves sharing one temp path,
// and a scheduler status file where politicsRefresh ended up with a
// lastSuccessAt NEWER than its lastRanAt because two tasks' read-modify-write
// cycles overlapped. All fixtures fabricated.
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { createWriteLock, writeJsonAtomic } from './write-lock.js';

const DIR = path.join(
  process.env.TMPDIR ?? '/tmp',
  `docvault-writelock-${Date.now()}-${Math.random().toString(36).slice(2)}`
);
const FILE = path.join(DIR, 'store.json');

beforeEach(() => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
});
afterEach(() => rmSync(DIR, { recursive: true, force: true }));

describe('writeJsonAtomic', () => {
  test('concurrent writes all resolve — no shared-temp-path ENOENT', async () => {
    const writes = Array.from({ length: 20 }, (_, i) => writeJsonAtomic(FILE, { n: i }));
    await expect(Promise.all(writes)).resolves.toBeDefined();
  });

  test('leaves no temp files behind', async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => writeJsonAtomic(FILE, { n: i })));
    expect(readdirSync(DIR).filter((f) => f.includes('.tmp'))).toEqual([]);
  });

  test('the result is always parseable — never a torn write', async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => writeJsonAtomic(FILE, { n: i })));
    expect(() => JSON.parse(readFileSync(FILE, 'utf-8'))).not.toThrow();
  });

  test('cleans up its temp file when the rename fails', async () => {
    // Target is a directory, so rename cannot succeed.
    const badTarget = path.join(DIR, 'subdir');
    mkdirSync(badTarget);
    await expect(writeJsonAtomic(badTarget, { a: 1 })).rejects.toBeDefined();
    expect(readdirSync(DIR).filter((f) => f.includes('.tmp'))).toEqual([]);
  });
});

describe('createWriteLock', () => {
  test('runs work strictly in order, never overlapping', async () => {
    const lock = createWriteLock();
    const events: string[] = [];
    await Promise.all(
      [10, 1, 5].map((delay, i) =>
        lock(async () => {
          events.push(`start${i}`);
          await new Promise((r) => setTimeout(r, delay));
          events.push(`end${i}`);
        })
      )
    );
    // Strict interleaving would give start0,start1,... — the lock forbids it.
    expect(events).toEqual(['start0', 'end0', 'start1', 'end1', 'start2', 'end2']);
  });

  test('a read-modify-write under the lock loses no updates', async () => {
    const lock = createWriteLock();
    writeFileSync(FILE, JSON.stringify({ counters: {} }));
    await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        lock(async () => {
          const cur = JSON.parse(readFileSync(FILE, 'utf-8'));
          await new Promise((r) => setTimeout(r, 1)); // widen the window
          cur.counters[`t${i}`] = i;
          await writeJsonAtomic(FILE, cur);
        })
      )
    );
    expect(Object.keys(JSON.parse(readFileSync(FILE, 'utf-8')).counters)).toHaveLength(15);
  });

  test('WITHOUT the lock the same pattern loses updates', async () => {
    // Documents why the lock exists — this is the scheduler-status bug.
    writeFileSync(FILE, JSON.stringify({ counters: {} }));
    await Promise.all(
      Array.from({ length: 15 }, async (_, i) => {
        const cur = JSON.parse(readFileSync(FILE, 'utf-8'));
        await new Promise((r) => setTimeout(r, 1));
        cur.counters[`t${i}`] = i;
        await writeJsonAtomic(FILE, cur);
      })
    );
    expect(Object.keys(JSON.parse(readFileSync(FILE, 'utf-8')).counters).length).toBeLessThan(15);
  });

  test('a rejection does not poison later work', async () => {
    const lock = createWriteLock();
    await expect(
      lock(async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    await expect(lock(async () => 'ok')).resolves.toBe('ok');
  });

  test('separate locks are independent', async () => {
    const a = createWriteLock();
    const b = createWriteLock();
    await expect(Promise.all([a(async () => 1), b(async () => 2)])).resolves.toEqual([1, 2]);
  });
});
