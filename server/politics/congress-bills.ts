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
import { timeoutFetch } from './http.js';
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

interface CongressBillSummaryItem {
  text?: string;
  actionDate?: string;
  updateDate?: string;
  lastSummaryUpdateDate?: string;
  actionDesc?: string;
  versionCode?: string;
}

interface CongressBillSummariesResponse {
  summaries?: CongressBillSummaryItem[];
}

export interface BillSummary {
  text: string;
  actionDate: string | null;
  updateDate: string | null;
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
    congress: item.congress,
    number: item.number,
    officialId: `${item.type.toUpperCase()} ${item.number}`,
    title: item.title,
    type,
    status: inferBillStatus(item.latestAction?.text),
    introducedDate: item.introducedDate ?? null,
    latestAction: item.latestAction?.text ?? null,
    latestActionDate: item.latestAction?.actionDate ?? null,
    summary: null,
    summarySource: null,
    summaryActionDate: null,
    summaryCheckedAt: null,
    summaryUpdatedAt: null,
    updateDate: item.updateDate,
    url: item.url ?? null,
  };
}

function decodeHtmlEntities(text: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith('#x')) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (lower.startsWith('#')) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return named[lower] ?? match;
  });
}

/** Congress.gov returns CRS summary text as lightly-invalid HTML. Strip tags,
 * decode common entities, and collapse whitespace so the UI and Daily News can
 * use the summary as plain prose. */
export function cleanSummaryHtml(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<\s*br\s*\/?\s*>/gi, '\n')
      .replace(/<\s*\/\s*p\s*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function stripDuplicatedSummaryTitle(summary: string, title?: string): string {
  if (!title) return summary;
  const normalizedTitle = title.replace(/\s+/g, ' ').trim();
  if (!normalizedTitle) return summary;
  if (!summary.toLowerCase().startsWith(normalizedTitle.toLowerCase())) return summary;
  return (
    summary
      .slice(normalizedTitle.length)
      .replace(/^\s*[-–—:.;]?\s*/, '')
      .trim() || summary
  );
}

function parseBillLocator(
  bill: BillRecord
): { congress: number; type: string; number: string } | null {
  if (bill.congress && bill.type && bill.number) {
    return { congress: bill.congress, type: bill.type, number: bill.number };
  }
  const match = bill.externalId.match(/^([a-z]+)-(\d+)-(\d+)$/i);
  if (!match) return null;
  return { congress: Number(match[3]), type: match[1].toLowerCase(), number: match[2] };
}

function latestSummary(items: CongressBillSummaryItem[], billTitle?: string): BillSummary | null {
  const usable = items
    .map((item) => ({
      ...item,
      text: item.text ? stripDuplicatedSummaryTitle(cleanSummaryHtml(item.text), billTitle) : '',
      sortDate: item.lastSummaryUpdateDate ?? item.updateDate ?? item.actionDate ?? '',
    }))
    .filter((item) => item.text);
  if (usable.length === 0) return null;
  usable.sort((a, b) => b.sortDate.localeCompare(a.sortDate));
  const picked = usable[0];
  return {
    text: picked.text,
    actionDate: picked.actionDate ?? null,
    updateDate: picked.lastSummaryUpdateDate ?? picked.updateDate ?? null,
  };
}

export interface FetchBillSummaryOptions {
  apiKey: string;
  congress: number;
  billType: string;
  billNumber: string;
  billTitle?: string;
  fetchFn?: typeof fetch;
}

export async function fetchBillSummary(opts: FetchBillSummaryOptions): Promise<BillSummary | null> {
  const fetchFn = opts.fetchFn ?? timeoutFetch();
  const started = Date.now();
  const url = new URL(
    `${BASE_URL}/bill/${opts.congress}/${opts.billType.toLowerCase()}/${opts.billNumber}/summaries`
  );
  url.searchParams.set('api_key', opts.apiKey);
  url.searchParams.set('format', 'json');

  const res = await fetchFn(url, { headers: { Accept: 'application/json' } });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(
      `Congress.gov /bill/${opts.congress}/${opts.billType}/${opts.billNumber}/summaries failed: HTTP ${res.status}`
    );
  }
  const data = (await res.json()) as CongressBillSummariesResponse;
  const summary = latestSummary(data.summaries ?? [], opts.billTitle);
  log.debug(
    `[bills] summary ${opts.billType.toUpperCase()} ${opts.billNumber} in ${Date.now() - started}ms (${summary ? 'hit' : 'miss'})`
  );
  return summary;
}

export interface EnrichBillSummariesOptions {
  apiKey: string;
  maxFetches?: number;
  /** Refetch summary misses after this many days, in case CRS publishes later. */
  retryMissAfterDays?: number;
  fetchFn?: typeof fetch;
}

function shouldFetchSummary(bill: BillRecord, retryMissAfterDays: number): boolean {
  if (bill.summary) return false;
  const checkedAt = Date.parse(bill.summaryCheckedAt ?? '');
  if (!Number.isFinite(checkedAt)) return true;
  return Date.now() - checkedAt > retryMissAfterDays * 24 * 60 * 60 * 1000;
}

/** Fill missing official CRS summaries for the newest bills in the rolling cache.
 * Mutates the passed records in place and returns the number populated. */
export async function enrichBillSummaries(
  bills: BillRecord[],
  opts: EnrichBillSummariesOptions
): Promise<{ fetched: number; populated: number }> {
  const started = Date.now();
  const maxFetches = opts.maxFetches ?? 40;
  const retryMissAfterDays = opts.retryMissAfterDays ?? 7;
  let fetched = 0;
  let populated = 0;

  for (const bill of bills) {
    if (fetched >= maxFetches) break;
    if (!shouldFetchSummary(bill, retryMissAfterDays)) continue;
    const locator = parseBillLocator(bill);
    if (!locator) continue;
    fetched++;
    const checkedAt = new Date().toISOString();
    const summary = await fetchBillSummary({
      apiKey: opts.apiKey,
      congress: locator.congress,
      billType: locator.type,
      billNumber: locator.number,
      billTitle: bill.title,
      fetchFn: opts.fetchFn,
    });
    bill.congress = bill.congress ?? locator.congress;
    bill.number = bill.number ?? locator.number;
    bill.summaryCheckedAt = checkedAt;
    if (!summary) continue;
    bill.summary = summary.text;
    bill.summarySource = 'congress-crs';
    bill.summaryActionDate = summary.actionDate;
    bill.summaryUpdatedAt = summary.updateDate ?? checkedAt;
    populated++;
  }

  log.info(
    `[bills] enriched ${populated}/${fetched} bill summaries in ${Date.now() - started}ms (cap=${maxFetches})`
  );
  return { fetched, populated };
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
  const fetchFn = opts.fetchFn ?? timeoutFetch();
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
