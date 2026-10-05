import { promises as fs } from 'fs';
import path from 'path';
import { DATA_DIR } from './data.js';
import { createLogger } from './logger.js';
import {
  fetchBalanceSnapshot,
  SimplefinFetchError,
  type SimplefinBalanceCache,
  type SimplefinConfig,
} from './simplefin.js';
import {
  deriveConnectionIssues,
  updateSimplefinHealth,
  type SimplefinHealth,
  type SimplefinIssue,
} from './simplefin-health.js';
import { createWriteLock, writeJsonAtomic } from './write-lock.js';

const log = createLogger('SimpleFIN');

function cachedIssues(cache: SimplefinBalanceCache): SimplefinIssue[] {
  return (
    cache.connectionIssues ??
    deriveConnectionIssues(
      (cache.connectionErrors ?? []).map((message) => {
        const names = [
          ...new Set(cache.accounts.map((account) => account.connectionName).filter(Boolean)),
        ];
        const name = names.find((name) => message.includes(name!));
        const accounts = cache.accounts.filter(
          (account) => name && account.connectionName === name
        );
        const latest = Math.max(0, ...accounts.map((account) => account.balanceDate ?? 0));
        return {
          message,
          connectionName: name,
          connectionId: accounts[0]?.connId,
          lastBankDataAt: latest > 0 ? new Date(latest * 1000).toISOString() : undefined,
        };
      })
    )
  );
}

/** One path owns balance caching and connection health for both the scheduler
 * and manual refresh. Status reads never contact the bank provider. */
export function createSimplefinSync(dataDir: string, fetchSnapshot = fetchBalanceSnapshot) {
  const cachePath = path.join(dataDir, '.docvault-simplefin-cache.json');
  const healthPath = path.join(dataDir, '.docvault-simplefin-status.json');
  const withLock = createWriteLock();
  let inFlight: { accessUrl: string; promise: Promise<SimplefinBalanceCache> } | undefined;

  async function read<T>(file: string): Promise<T | undefined> {
    try {
      return JSON.parse(await fs.readFile(file, 'utf8')) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async function getHealth(): Promise<SimplefinHealth> {
    const stored = await read<SimplefinHealth>(healthPath);
    if (stored) return stored;
    const cache = await read<SimplefinBalanceCache>(cachePath);
    return cache
      ? updateSimplefinHealth(undefined, cachedIssues(cache), cache.lastUpdated, true)
      : { issues: [], history: [] };
  }

  function sync(config: SimplefinConfig, force = false): Promise<SimplefinBalanceCache> {
    if (inFlight?.accessUrl === config.accessUrl) return inFlight.promise;
    const promise = withLock(async () => {
      const cache = await read<SimplefinBalanceCache>(cachePath);
      const previous = await getHealth();
      // Restarts should not repeat a fetch that just completed. A user refresh
      // after reconnecting is explicit and always checks the provider again.
      if (
        !force &&
        cache?.accounts.length &&
        Date.now() - Date.parse(cache.lastUpdated) < 5 * 60_000
      ) {
        if (cachedIssues(cache).length)
          log.warn('Using recent bank data; connection warnings remain unresolved');
        return cache;
      }
      try {
        const snapshot = await fetchSnapshot(config);
        await writeJsonAtomic(cachePath, snapshot);
        await writeJsonAtomic(
          healthPath,
          updateSimplefinHealth(previous, cachedIssues(snapshot), snapshot.lastUpdated, true)
        );
        return snapshot;
      } catch (error) {
        const issues =
          error instanceof SimplefinFetchError
            ? error.issues
            : [
                {
                  id: 'sync',
                  kind: 'sync' as const,
                  message: error instanceof Error ? error.message : 'Bank sync failed',
                },
              ];
        await writeJsonAtomic(
          healthPath,
          updateSimplefinHealth(previous, issues, new Date().toISOString(), false)
        );
        throw error;
      }
    });
    inFlight = { accessUrl: config.accessUrl, promise };
    void promise
      .finally(() => {
        if (inFlight?.promise === promise) inFlight = undefined;
      })
      .catch(() => {});
    return promise;
  }

  async function reset(): Promise<void> {
    await withLock(async () => {
      for (const file of [cachePath, healthPath]) await fs.rm(file, { force: true });
    });
  }

  return { sync, getHealth, reset };
}

export const simplefinSync = createSimplefinSync(DATA_DIR);
