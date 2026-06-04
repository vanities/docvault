// Senate PTR (Periodic Transaction Report) ingest — forward-only.
//
// Ported from the Check the Vote repo (`lib/ingest/trades/senate-efd.ts`,
// `senate-ptr-parser.ts`). Unlike the House (a plain file) the Senate eFD is a
// Django app gated by a CSRF cookie + a prohibition-agreement form, so each run
// performs a stateful handshake. This is the most fragile source — but failures
// are isolated by the orchestrator's per-source try/catch, so a Senate outage
// never affects House/OGE/bills. One optimization over the original: the CSRF
// session is established ONCE per run and reused for every report fetch.

import { createLogger } from '../logger.js';
import { markSeen, mergeFilings, mergeTrades } from './feed-store.js';
import { normalizeTradeCategory, parseDisclosureAmountRange } from './trade-transform.js';
import type { FilingRecord, PoliticsCache, TradeRecord } from './types.js';

const log = createLogger('PoliticsSenate');

const ORIGIN = 'https://efdsearch.senate.gov';
const HOME_URL = `${ORIGIN}/search/home/`;
const SEARCH_URL = `${ORIGIN}/search/`;
const REPORT_DATA_URL = `${ORIGIN}/search/report/data/`;
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36';

type CookieMap = Map<string, string>;
type SenateSession = { cookies: CookieMap; csrf: string };
type ReportKind = 'ptr' | 'paper';

interface SenateFilingRow {
  filerName: string;
  filingDate: string;
  filingDocId: string;
  reportKind: ReportKind;
  filingUrl: string;
}

// --- HTML / cookie helpers (ported) ----------------------------------------

function clean(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function stripTags(value: string): string {
  return decodeHtml(value.replace(/<[^>]*>/g, ' '))
    .trim()
    .replace(/\s+/g, ' ');
}

function parseUsDate(value: string): string | null {
  const [month, day, year] = value
    .trim()
    .split('/')
    .map((part) => Number(part));
  if (!month || !day || !year) return null;
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day
    .toString()
    .padStart(2, '0')}`;
}

function formatUsDate(year: number, month: number, day: number, endOfDay = false): string {
  return `${month.toString().padStart(2, '0')}/${day.toString().padStart(2, '0')}/${year} ${
    endOfDay ? '23:59:59' : '00:00:00'
  }`;
}

function parseCookies(headers: Headers): CookieMap {
  const cookieMap: CookieMap = new Map();
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  const values = withGetSetCookie.getSetCookie?.() ?? [];
  const fallback = headers.get('set-cookie');
  if (values.length === 0 && fallback) values.push(fallback);
  for (const header of values) {
    for (const part of header.split(/,(?=\s*[^;,=]+=[^;,]+)/)) {
      const [pair] = part.trim().split(';');
      const idx = pair.indexOf('=');
      if (idx > 0) cookieMap.set(pair.slice(0, idx), pair.slice(idx + 1));
    }
  }
  return cookieMap;
}

function mergeCookies(target: CookieMap, headers: Headers): void {
  for (const [name, value] of parseCookies(headers)) target.set(name, value);
}

function cookieHeader(cookies: CookieMap): string {
  return Array.from(cookies.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

function csrfFromHtml(html: string): string {
  const match = html.match(/name="csrfmiddlewaretoken"\s+value="([^"]+)"/);
  if (!match) throw new Error('Unable to find Senate eFD CSRF token');
  return match[1];
}

// --- Session handshake -------------------------------------------------------

export async function establishSenateSession(
  fetchFn: typeof fetch = fetch
): Promise<SenateSession> {
  const cookies: CookieMap = new Map();

  const home = await fetchFn(HOME_URL, { headers: { 'User-Agent': UA } });
  if (!home.ok) throw new Error(`Senate eFD agreement fetch failed: ${home.status}`);
  mergeCookies(cookies, home.headers);
  const agreementCsrf = csrfFromHtml(await home.text());

  const agreement = await fetchFn(HOME_URL, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: HOME_URL,
      Cookie: cookieHeader(cookies),
    },
    body: new URLSearchParams({ prohibition_agreement: '1', csrfmiddlewaretoken: agreementCsrf }),
    redirect: 'manual',
  });
  if (agreement.status < 200 || agreement.status >= 400) {
    throw new Error(`Senate eFD agreement POST failed: ${agreement.status}`);
  }
  mergeCookies(cookies, agreement.headers);

  const location = agreement.headers.get('location') ?? SEARCH_URL;
  const search = await fetchFn(new URL(location, ORIGIN), {
    headers: { 'User-Agent': UA, Referer: HOME_URL, Cookie: cookieHeader(cookies) },
  });
  if (!search.ok) throw new Error(`Senate eFD search page fetch failed: ${search.status}`);
  mergeCookies(cookies, search.headers);
  const searchHtml = await search.text();

  return { cookies, csrf: cookies.get('csrftoken') ?? csrfFromHtml(searchHtml) };
}

// --- Filing index (DataTables report search) --------------------------------

export function buildReportDataPayload(year: number, start = 0, length = 100): URLSearchParams {
  const payload: Record<string, string> = {
    draw: '1',
    start: String(start),
    length: String(length),
    'search[value]': '',
    'search[regex]': 'false',
    'order[0][column]': '1',
    'order[0][dir]': 'asc',
    report_types: '[11]', // 11 = Periodic Transaction Report
    filer_types: '[1]', // 1 = Senator
    submitted_start_date: formatUsDate(year, 1, 1),
    submitted_end_date: formatUsDate(year, 12, 31, true),
    candidate_state: '',
    senator_state: '',
    office_id: '',
    first_name: '',
    last_name: '',
  };
  for (let i = 0; i < 5; i++) {
    payload[`columns[${i}][data]`] = String(i);
    payload[`columns[${i}][name]`] = '';
    payload[`columns[${i}][searchable]`] = 'true';
    payload[`columns[${i}][orderable]`] = 'true';
    payload[`columns[${i}][search][value]`] = '';
    payload[`columns[${i}][search][regex]`] = 'false';
  }
  return new URLSearchParams(payload);
}

export function parseReportDataRows(data: unknown[][]): SenateFilingRow[] {
  return data
    .map((row): SenateFilingRow | null => {
      const firstName = clean(row[0]);
      const lastName = clean(row[1]);
      const fallback = stripTags(clean(row[2]));
      const linkHtml = clean(row[3]);
      const dateText = stripTags(clean(row[4]));
      const href = linkHtml.match(/href="([^"]+)"/)?.[1];
      if (!href) return null;
      const docMatch = href.match(/\/search\/view\/(ptr|paper)\/([^/]+)\//);
      if (!docMatch) return null;
      const filingDate = parseUsDate(dateText);
      if (!filingDate) return null;
      const filerName = [firstName, lastName].filter(Boolean).join(' ').trim() || fallback;
      return {
        filerName: filerName || 'Unknown filer',
        filingDate,
        filingDocId: docMatch[2],
        reportKind: docMatch[1] as ReportKind,
        filingUrl: new URL(href, ORIGIN).toString(),
      };
    })
    .filter((row): row is SenateFilingRow => row != null);
}

async function fetchSenateFilings(
  year: number,
  session: SenateSession,
  fetchFn: typeof fetch
): Promise<SenateFilingRow[]> {
  const res = await fetchFn(REPORT_DATA_URL, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Origin: ORIGIN,
      Referer: SEARCH_URL,
      'X-CSRFToken': session.csrf,
      'X-Requested-With': 'XMLHttpRequest',
      Cookie: cookieHeader(session.cookies),
    },
    body: buildReportDataPayload(year),
  });
  if (!res.ok) throw new Error(`Senate eFD report data fetch failed: ${res.status}`);
  const json = (await res.json()) as { data?: unknown[][] };
  return parseReportDataRows(json.data ?? []);
}

async function fetchReportHtml(
  filingUrl: string,
  session: SenateSession,
  fetchFn: typeof fetch
): Promise<string> {
  const res = await fetchFn(filingUrl, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml',
      Referer: SEARCH_URL,
      Cookie: cookieHeader(session.cookies),
    },
  });
  if (!res.ok) throw new Error(`Senate eFD PTR HTML fetch failed: ${res.status}`);
  return res.text();
}

// --- PTR HTML transaction parser (ported, mapped to TradeRecord) ------------

function cellsFromRow(rowHtml: string): string[] {
  return Array.from(rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((m) => m[1]);
}

function extractTransactionRows(html: string): string[] {
  const transactionsIndex = html.search(/>\s*Transactions\s*</i);
  const searchable = transactionsIndex >= 0 ? html.slice(transactionsIndex) : html;
  const tbody = searchable.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i)?.[1];
  if (!tbody) return [];
  return Array.from(tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)).map((m) => m[1]);
}

function extractTicker(cellHtml: string, fallback: string): string | null {
  const fromQuote = cellHtml.match(/finance\.yahoo\.com\/quote\/([^"/?#]+)/i)?.[1];
  const cleaned = (fromQuote ?? fallback).trim().toUpperCase();
  return cleaned && cleaned !== '--' ? cleaned : null;
}

export interface SenatePtrContext {
  filingDocId: string;
  filerName: string;
  filingDate: string | null;
  filingYear: number;
  filingUrl: string;
}

export function parseSenatePtrHtml(html: string, ctx: SenatePtrContext): TradeRecord[] {
  const trades: TradeRecord[] = [];
  for (const row of extractTransactionRows(html)) {
    const cells = cellsFromRow(row);
    if (cells.length < 8) continue;
    const sequence = stripTags(cells[0]) || String(trades.length + 1);
    const tradeDate = parseUsDate(stripTags(cells[1]));
    if (!tradeDate) continue;
    const owner = stripTags(cells[2]) || null;
    const assetName = stripTags(cells[4]) || 'Unknown asset';
    const assetType = stripTags(cells[5]) || null;
    const transactionType = stripTags(cells[6]) || null;
    const amount = stripTags(cells[7]) || null;
    const comment = cells[8] ? stripTags(cells[8]) : null;
    const range = parseDisclosureAmountRange(amount);
    const description = transactionType ?? comment ?? 'Unknown';
    trades.push({
      externalId: `senate-ptr:${ctx.filingYear}:${ctx.filingDocId}:${sequence}`,
      source: 'senate-ptr',
      chamber: 'senate',
      politicianName: ctx.filerName,
      filerName: ctx.filerName,
      owner,
      assetName,
      ticker: extractTicker(cells[3], stripTags(cells[3])),
      assetType,
      transactionType,
      transactionDescription: description,
      category: normalizeTradeCategory(description),
      tradeDate,
      filingDate: ctx.filingDate,
      amount,
      amountRange: amount,
      amountMin: range.amountMin,
      amountMax: range.amountMax,
      filingDocId: ctx.filingDocId,
      filingYear: ctx.filingYear,
      filingUrl: ctx.filingUrl,
      sourceUrl: ctx.filingUrl,
    });
  }
  return trades;
}

// --- Forward-only orchestrator ----------------------------------------------

export interface IngestSenateOptions {
  fetchFn?: typeof fetch;
  now?: Date;
  firstRunDays?: number;
  maxFilings?: number;
}

export interface IngestSenateResult {
  added: number;
  filings: number;
  paper: number;
  error?: string;
}

function needsAttention(row: SenateFilingRow, warning: string): FilingRecord {
  return {
    externalId: `senate:${row.filingDocId}`,
    source: 'senate-ptr',
    chamber: 'senate',
    filerName: row.filerName,
    politicianName: row.filerName,
    filingDate: row.filingDate,
    status: 'needs_attention',
    warning,
    docId: row.filingDocId,
    sourceUrl: row.filingUrl,
  };
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Forward-only Senate PTR ingest. Mutates `cache` and returns a summary. The
 *  whole thing is wrapped by the orchestrator's try/catch, so a broken handshake
 *  surfaces as a soft error without affecting other sources. */
export async function ingestSenatePtr(
  cache: PoliticsCache,
  opts: IngestSenateOptions = {}
): Promise<IngestSenateResult> {
  const fetchFn = opts.fetchFn ?? fetch;
  const now = opts.now ?? new Date();
  const firstRunDays = opts.firstRunDays ?? 7;
  const maxFilings = opts.maxFilings ?? 40;
  const year = now.getUTCFullYear();

  const session = await establishSenateSession(fetchFn);
  const allRows = await fetchSenateFilings(year, session, fetchFn);

  const seen = new Set(cache.seen.senateFilingIds);
  const newRows = allRows.filter((row) => !seen.has(row.filingDocId));

  const firstRun = cache.cursors.senateLastSeen == null;
  const cutoff = new Date(now.getTime() - firstRunDays * 86_400_000).toISOString().slice(0, 10);
  const toProcess = (firstRun ? newRows.filter((r) => r.filingDate >= cutoff) : newRows)
    .sort((a, b) => b.filingDate.localeCompare(a.filingDate))
    .slice(0, maxFilings);

  if (firstRun) {
    // Seed every current filing as seen so history is never back-filled.
    cache.seen.senateFilingIds = markSeen(
      cache.seen.senateFilingIds,
      newRows.map((r) => r.filingDocId)
    );
  }

  const trades: TradeRecord[] = [];
  const filings: FilingRecord[] = [];
  const handled: string[] = [];
  const errors: string[] = [];
  let paper = 0;

  for (const row of toProcess) {
    try {
      if (row.reportKind === 'paper') {
        filings.push(needsAttention(row, 'paper filing (scanned PDF, not parsed)'));
        paper++;
        handled.push(row.filingDocId);
        continue;
      }
      const html = await fetchReportHtml(row.filingUrl, session, fetchFn);
      const parsed = parseSenatePtrHtml(html, {
        filingDocId: row.filingDocId,
        filerName: row.filerName,
        filingDate: row.filingDate,
        filingYear: year,
        filingUrl: row.filingUrl,
      });
      if (parsed.length === 0) {
        filings.push(needsAttention(row, 'no transactions parsed'));
      } else {
        trades.push(...parsed);
      }
      handled.push(row.filingDocId);
    } catch (err) {
      errors.push(`${row.filingDocId}: ${msg(err)}`);
    }
  }

  mergeTrades(cache, trades);
  mergeFilings(cache, filings);
  cache.seen.senateFilingIds = markSeen(cache.seen.senateFilingIds, handled);
  const newestDate = allRows.reduce((max, r) => (r.filingDate > max ? r.filingDate : max), '');
  if (newestDate) cache.cursors.senateLastSeen = newestDate;

  if (errors.length) log.warn(`Senate PTR transient errors: ${errors.slice(0, 3).join('; ')}`);
  log.info(`Senate PTR: parsed ${trades.length} trades, ${filings.length} needs-attention`);
  return {
    added: trades.length,
    filings: filings.length,
    paper,
    error: errors.length ? `${errors.length} transient error(s)` : undefined,
  };
}
