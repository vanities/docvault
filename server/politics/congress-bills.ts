// Congress.gov bills — forward-only recent-bill ingest.
//
// Ported from the Check the Vote repo (`lib/ingest/congress/{client,bills/*}`),
// trimmed to the forward-going slice DocVault needs: pull the most-recently-
// updated bills, stop at the last-seen cursor (no historical backfill). Status
// (incl. signings/vetoes) is inferred from the free-text latestAction.
//
// Auth: a free Congress.gov API key (api.congress.gov/sign-up), stored as
// `settings.congressApiKey`. 5,000 req/hour — daily forward pulls use a handful.

import { createLogger } from '../logger.js';
import type { BillRecord, BillStatus } from './types.js';

const log = createLogger('PoliticsBills');

const BASE_URL = 'https://api.congress.gov/v3';
const DEFAULT_CONGRESS = 119;
const PAGE_SIZE = 250;
const DEFAULT_MAX_PAGES = 8; // 2,000 bills/run ceiling — forward-only never needs more

interface CongressBillListItem {
  congress: number;
  type: string;
  number: string;
  title: string;
  introducedDate?: string;
  updateDate: string;
  latestAction?: { actionDate: string; text: string };
  url: string;
}

interface CongressBillListResponse {
  bills?: CongressBillListItem[];
  pagination?: { count?: number; next?: string };
}

/** Map free-form latestAction text to a normalized lifecycle bucket. Errs toward
 *  "introduced" — we'd rather under-claim status than over-claim. (Ported verbatim
 *  from Check the Vote's bills/transform.ts.) */
export function inferBillStatus(text: string | undefined): BillStatus {
  if (!text) return 'introduced';
  const lower = text.toLowerCase();
  if (lower.includes('became public law') || lower.includes('signed by president')) return 'signed';
  if (lower.includes('vetoed')) return 'vetoed';
  if (lower.includes('passed senate') && lower.includes('passed house')) return 'passed_both';
  if (
    lower.includes('passed house') ||
    lower.includes('passed senate') ||
    lower.includes('passed/agreed to')
  ) {
    return 'passed_chamber';
  }
  if (
    lower.includes('referred to') ||
    lower.includes('committee on') ||
    lower.includes('reported') ||
    lower.includes('placed on')
  ) {
    return 'committee';
  }
  return 'introduced';
}

export function transformBill(item: CongressBillListItem): BillRecord {
  const type = item.type.toLowerCase();
  return {
    externalId: `${type}-${item.number}-${item.congress}`,
    officialId: `${item.type.toUpperCase()} ${item.number}`,
    title: item.title,
    type,
    status: inferBillStatus(item.latestAction?.text),
    introducedDate: item.introducedDate ?? null,
    latestAction: item.latestAction?.text ?? null,
    latestActionDate: item.latestAction?.actionDate ?? null,
    updateDate: item.updateDate,
    url: item.url ?? null,
  };
}

export interface FetchRecentBillsOptions {
  apiKey: string;
  congress?: number;
  /** Stop paging once a bill's updateDate is <= this (the prior run's high-water mark). */
  sinceUpdateDate?: string;
  maxPages?: number;
  fetchFn?: typeof fetch;
}

/** Forward-only: walk newest-first until we cross `sinceUpdateDate` or hit the
 *  page cap. Returns the bills seen and the new high-water mark to persist. */
export async function fetchRecentBills(
  opts: FetchRecentBillsOptions
): Promise<{ bills: BillRecord[]; newestUpdateDate?: string }> {
  const fetchFn = opts.fetchFn ?? fetch;
  const congress = opts.congress ?? DEFAULT_CONGRESS;
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
  const since = opts.sinceUpdateDate;

  const collected: BillRecord[] = [];
  let newestUpdateDate: string | undefined;
  let crossedCursor = false;

  for (let page = 0; page < maxPages && !crossedCursor; page++) {
    const url = new URL(`${BASE_URL}/bill/${congress}`);
    url.searchParams.set('api_key', opts.apiKey);
    url.searchParams.set('format', 'json');
    url.searchParams.set('sort', 'updateDate+desc');
    url.searchParams.set('limit', String(PAGE_SIZE));
    url.searchParams.set('offset', String(page * PAGE_SIZE));
    if (since) url.searchParams.set('fromDateTime', `${since.slice(0, 10)}T00:00:00Z`);

    const res = await fetchFn(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      throw new Error(`Congress.gov /bill/${congress} failed: HTTP ${res.status}`);
    }
    const data = (await res.json()) as CongressBillListResponse;
    const items = data.bills ?? [];
    if (items.length === 0) break;

    for (const item of items) {
      if (!newestUpdateDate || item.updateDate > newestUpdateDate)
        newestUpdateDate = item.updateDate;
      // Forward-only stop: anything at/older than the cursor is already ingested.
      if (since && item.updateDate <= since) {
        crossedCursor = true;
        continue;
      }
      collected.push(transformBill(item));
    }

    if (items.length < PAGE_SIZE) break;
  }

  log.info(
    `Fetched ${collected.length} recent bills (congress ${congress}, since=${since ?? 'none'})`
  );
  return { bills: collected, newestUpdateDate };
}
