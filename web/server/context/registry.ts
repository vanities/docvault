// Every kind of DocVault data, described once for every AI surface.
//
// Add a source here when a feature stores new data. coverage.test.ts fails
// while a data file belongs to no source and has no written exemption in
// coverage.ts, so new features can't quietly stay invisible to chat, the
// Newsstand, assignments and deep research.

import { createLogger } from '../logger.js';
import { contextHistory, type ContextHistory } from './history.js';
import { bankAccountsSource } from './sources/bank-accounts.js';
import { bankTransactionsSource } from './sources/bank-transactions.js';
import { debtsSource } from './sources/debts.js';
import type { ContextSource } from './types.js';

const log = createLogger('Context');

export const CONTEXT_SOURCES: readonly ContextSource[] = [
  bankAccountsSource,
  bankTransactionsSource,
  debtsSource,
];

export function getContextSource(id: string): ContextSource | undefined {
  return CONTEXT_SOURCES.find((s) => s.id === id);
}

export interface HistoryRunResult {
  recorded: string[];
  empty: string[];
  failed: string[];
}

/**
 * Record each source's metrics for one day. Runs right after the daily
 * portfolio snapshot, so balances are fresh. A source with nothing to report
 * records nothing: an empty day would read as every balance disappearing.
 */
export async function recordContextHistory(
  date: string,
  sources: readonly ContextSource[] = CONTEXT_SOURCES,
  history: ContextHistory = contextHistory
): Promise<HistoryRunResult> {
  const result: HistoryRunResult = { recorded: [], empty: [], failed: [] };
  for (const source of sources) {
    if (!source.metrics) continue;
    const t0 = Date.now();
    try {
      const metrics = await source.metrics();
      const count = Object.keys(metrics).length;
      if (!count) {
        result.empty.push(source.id);
        log.info(`[history] ${source.id} had nothing to record for ${date}`);
        continue;
      }
      await history.record(source.id, date, metrics);
      result.recorded.push(source.id);
      log.info(
        `[history] ${source.id} recorded ${count} metric(s) for ${date} in ${Date.now() - t0}ms`
      );
    } catch (error) {
      result.failed.push(source.id);
      log.warn(
        `[history] ${source.id} failed for ${date}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return result;
}
