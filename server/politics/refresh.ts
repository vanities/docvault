// Politics refresh orchestrator — the body of the built-in daily `politicsRefresh`
// scheduler task. Forward-only: each source walks back only to its persisted
// cursor, never the full history.
//
// Resilient by design: every source is wrapped independently so a Congress.gov
// outage or a missing key can't stop the Federal Register pull (and, later, the
// PTR/OGE trade pulls). Per-source outcomes surface as "sync events" in the UI.

import { loadSettings } from '../data.js';
import type { Settings } from '../data.js';
import { createLogger } from '../logger.js';
import { fetchRecentBills } from './congress-bills.js';
import { fetchRecentExecutiveActions } from './federal-register.js';
import { ingestHousePtr } from './house-ptr.js';
import { ingestOge278t } from './oge-278t.js';
import { ingestSenatePtr } from './senate-ptr.js';
import {
  loadPoliticsCache,
  mergeBills,
  mergeExecutiveActions,
  savePoliticsCache,
} from './feed-store.js';
import type { PoliticsRefreshResult, PoliticsSourceResult } from './types.js';

const log = createLogger('Politics');

export interface RefreshPoliticsOptions {
  dataDir?: string;
  settings?: Settings;
  fetchFn?: typeof fetch;
}

export async function refreshPolitics(
  opts: RefreshPoliticsOptions = {}
): Promise<PoliticsRefreshResult> {
  const settings = opts.settings ?? (await loadSettings());
  const cache = await loadPoliticsCache(opts.dataDir);
  const results: PoliticsSourceResult[] = [];

  // --- Bills (Congress.gov) — needs a key; absence is a soft skip, not a failure.
  if (settings.congressApiKey) {
    try {
      const { bills, newestUpdateDate } = await fetchRecentBills({
        apiKey: settings.congressApiKey,
        sinceUpdateDate: cache.cursors.billsUpdateDate,
        fetchFn: opts.fetchFn,
      });
      mergeBills(cache, bills);
      if (newestUpdateDate) cache.cursors.billsUpdateDate = newestUpdateDate;
      results.push({ source: 'bills', ok: true, added: bills.length });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.warn(`Bills refresh failed: ${error}`);
      results.push({ source: 'bills', ok: false, added: 0, error });
    }
  } else {
    results.push({ source: 'bills', ok: false, added: 0, error: 'Congress API key not set' });
  }

  // --- Executive actions (Federal Register) — keyless.
  try {
    const { actions, newestIssuedDate } = await fetchRecentExecutiveActions({
      sinceDate: cache.cursors.execIssuedDate,
      fetchFn: opts.fetchFn,
    });
    mergeExecutiveActions(cache, actions);
    if (newestIssuedDate) cache.cursors.execIssuedDate = newestIssuedDate;
    results.push({ source: 'executive-actions', ok: true, added: actions.length });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.warn(`Executive-actions refresh failed: ${error}`);
    results.push({ source: 'executive-actions', ok: false, added: 0, error });
  }

  // --- House PTR trades (Clerk of the House) — forward-only; needs pdftotext.
  try {
    const house = await ingestHousePtr(cache, { fetchFn: opts.fetchFn });
    results.push({
      source: 'house-ptr',
      ok: !house.error,
      added: house.added,
      error: house.error,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.warn(`House PTR refresh failed: ${error}`);
    results.push({ source: 'house-ptr', ok: false, added: 0, error });
  }

  // --- Trump OGE-278-T trades (executive-branch periodic transaction reports).
  try {
    const oge = await ingestOge278t(cache, { fetchFn: opts.fetchFn });
    results.push({ source: 'oge-278t', ok: !oge.error, added: oge.added, error: oge.error });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.warn(`OGE-278-T refresh failed: ${error}`);
    results.push({ source: 'oge-278t', ok: false, added: 0, error });
  }

  // --- Senate PTR trades (eFD). The most fragile source — its stateful CSRF
  // handshake can rot — but this try/catch isolates any failure from the rest.
  try {
    const senate = await ingestSenatePtr(cache, { fetchFn: opts.fetchFn });
    results.push({
      source: 'senate-ptr',
      ok: !senate.error,
      added: senate.added,
      error: senate.error,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.warn(`Senate PTR refresh failed: ${error}`);
    results.push({ source: 'senate-ptr', ok: false, added: 0, error });
  }

  const generatedAt = new Date().toISOString();
  cache.generatedAt = generatedAt;
  await savePoliticsCache(cache, opts.dataDir);

  const errors = results.filter((r) => !r.ok && r.error).map((r) => `${r.source}: ${r.error}`);
  const counts = {
    bills: cache.bills.length,
    executiveActions: cache.executiveActions.length,
    trades: cache.trades.length,
    filings: cache.filings.length,
  };
  log.info(
    `Refresh complete: bills=${counts.bills} exec=${counts.executiveActions} ` +
      `trades=${counts.trades} filings=${counts.filings}` +
      (errors.length ? ` (errors: ${errors.join('; ')})` : '')
  );

  return { generatedAt, results, errors, counts };
}
