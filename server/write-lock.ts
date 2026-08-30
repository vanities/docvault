// Shared primitives for safely writing a JSON file that several callers touch.
//
// Two distinct hazards, and both need covering:
//
//   1. TORN / LOST WRITES AT THE FILESYSTEM. A plain `writeFile` can be
//      interrupted, leaving truncated JSON. Writing to a temp file and renaming
//      makes publication atomic — but the temp path must be UNIQUE, or two
//      concurrent writers collide: B overwrites A's temp bytes, A renames
//      (publishing B's content), and B's rename fails with ENOENT.
//
//   2. LOST UPDATES IN THE CALLER. `load() -> mutate -> save()` as three
//      separate awaits lets another caller read the same starting state and
//      overwrite everything done in between. Fixing (1) alone converts a loud
//      ENOENT into silent data loss, which is strictly worse. Serialize the
//      whole read-modify-write cycle.
//
// Used by the health store (tens of MB, written by concurrent HealthKit syncs
// and clinical ingests) and the scheduler status file (written by overlapping
// scheduled tasks).

import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';

/**
 * Serializes async work. Each call waits for the previous one, and a rejection
 * never poisons the chain — otherwise one failed write would kill every write
 * after it.
 */
export function createWriteLock(): <T>(fn: () => Promise<T>) => Promise<T> {
  let chain: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  };
}

/**
 * Write JSON via a unique temp file + rename. The rename is atomic, so a reader
 * never observes a partial file; the unique name keeps concurrent writers from
 * publishing each other's bytes. Cleans up the temp file if anything fails.
 */
export async function writeJsonAtomic(targetPath: string, data: unknown): Promise<void> {
  const tmp = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(data, null, 2));
    await fs.rename(tmp, targetPath);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
}
