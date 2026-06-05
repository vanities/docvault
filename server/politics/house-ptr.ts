// House PTR (Periodic Transaction Report) ingest — forward-only.
//
// Ported from the Check the Vote repo (`lib/ingest/trades/house-disclosures.ts`,
// `house-ptr-pdf.ts`, `house-ptr-parser.ts`). The line-based parser + its
// date-repair heuristics are kept faithfully; the DB/option-column machinery is
// dropped (DocVault carries a flat TradeRecord). PDF text comes from `pdftotext`
// (poppler-utils, baked into the Docker image); a missing binary or a scanned
// PDF degrades to a "needs attention" filing rather than wrong trades.

import { execFile } from 'child_process';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { createLogger } from '../logger.js';
import { timeoutFetch } from './http.js';
import { ocrAvailable } from './ocr.js';
import { parseScannedHousePtr } from './scanned-house-ptr.js';
import { parseDisclosureAmountRange } from './trade-transform.js';
import { parseOptionDescription } from './option-description.js';
import { markSeen, mergeFilings, mergeTrades } from './feed-store.js';
import type { FilingRecord, PoliticsCache, TradeCategory, TradeRecord } from './types.js';

const log = createLogger('PoliticsHouse');
const execFileAsync = promisify(execFile);

const HOUSE_BASE = 'https://disclosures-clerk.house.gov';

// ---------------------------------------------------------------------------
// Index (tab-separated `{year}FD.txt`)
// ---------------------------------------------------------------------------

export interface HouseDisclosureIndexRow {
  prefix: string | null;
  last: string;
  first: string;
  suffix: string | null;
  filingType: string;
  stateDistrict: string;
  year: number;
  filingDate: string | null;
  docId: string;
  isPtr: boolean;
}

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseHouseDate(value: string | null): string | null {
  if (!value) return null;
  const [month, day, year] = value.split('/').map((part) => Number(part));
  if (!month || !day || !year) return null;
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day
    .toString()
    .padStart(2, '0')}`;
}

export function houseIndexUrl(year: number): string {
  return `${HOUSE_BASE}/public_disc/financial-pdfs/${year}FD.txt`;
}

export function housePtrPdfUrl(year: number, docId: string): string {
  return `${HOUSE_BASE}/public_disc/ptr-pdfs/${year}/${docId}.pdf`;
}

export function parseHouseDisclosureIndex(text: string): HouseDisclosureIndexRow[] {
  const rows = text.trim().split(/\r?\n/);
  const header = rows.shift()?.split('\t') ?? [];
  const required = [
    'Prefix',
    'Last',
    'First',
    'Suffix',
    'FilingType',
    'StateDst',
    'Year',
    'FilingDate',
    'DocID',
  ];
  const indexes = new Map(header.map((name, idx) => [name, idx]));
  const missing = required.filter((name) => indexes.get(name) === undefined);
  if (missing.length > 0) {
    throw new Error(`Unexpected House disclosure index header: ${header.join(',')}`);
  }
  const col = (columns: string[], name: string): string | undefined => columns[indexes.get(name)!];

  return rows
    .filter((row) => row.trim().length > 0)
    .map((row) => {
      const columns = row.split('\t');
      const filingType = clean(col(columns, 'FilingType')) ?? '';
      const year = Number(col(columns, 'Year'));
      const docId = clean(col(columns, 'DocID'));
      if (!year || !docId) throw new Error(`Invalid House disclosure row: ${row}`);
      return {
        prefix: clean(col(columns, 'Prefix')),
        last: clean(col(columns, 'Last')) ?? '',
        first: clean(col(columns, 'First')) ?? '',
        suffix: clean(col(columns, 'Suffix')),
        filingType,
        stateDistrict: clean(col(columns, 'StateDst')) ?? '',
        year,
        filingDate: parseHouseDate(clean(col(columns, 'FilingDate')) ?? ''),
        docId,
        isPtr: filingType === 'P',
      };
    });
}

// ---------------------------------------------------------------------------
// PDF text extraction (pdftotext)
// ---------------------------------------------------------------------------

export type PdfTextExtractor = (pdfBytes: ArrayBuffer, args: string[]) => Promise<string>;

export function isBlankExtractedPdfText(text: string): boolean {
  return text.replace(/[\f\s]/g, '').length === 0;
}

/** Shell out to poppler's `pdftotext`. Throws if the binary is missing (local
 *  dev without poppler) — the caller turns that into a needs-attention filing. */
export async function extractPdfTextWithPdftotext(
  pdfBytes: ArrayBuffer,
  args: string[] = ['-layout']
): Promise<string> {
  const command = process.env.PDFTOTEXT_BIN ?? 'pdftotext';
  const dir = await mkdtemp(join(tmpdir(), 'docvault-ptr-'));
  const pdfPath = join(dir, 'filing.pdf');
  try {
    await writeFile(pdfPath, Buffer.from(pdfBytes));
    const { stdout } = await execFileAsync(command, [...args, pdfPath, '-'], {
      maxBuffer: 20 * 1024 * 1024,
    });
    return stdout;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** True if `pdftotext` is callable. Only a missing binary (ENOENT) counts as
 *  unavailable — a non-zero exit still means poppler is installed. */
export async function pdftotextAvailable(): Promise<boolean> {
  const command = process.env.PDFTOTEXT_BIN ?? 'pdftotext';
  try {
    await execFileAsync(command, ['-v'], { timeout: 5000 });
    return true;
  } catch (err) {
    const code = (err as { code?: string })?.code;
    return code !== 'ENOENT' && !/ENOENT|not found/i.test(msg(err));
  }
}

// ---------------------------------------------------------------------------
// PTR text parser (line-based; ported verbatim, mapped to TradeRecord)
// ---------------------------------------------------------------------------

const TX_RE =
  /\b(?<tx>P|S|E|G)(?:\s+\((?<qualifier>[^)]+)\))?\s+(?<trade>\d{2}\/\d{2}\/\d{4})\s+(?<notify>\d{2}\/\d{2}\/\d{4})\s+(?<amount>(?:Spouse\/DC\s+)?(?:\$[\d,]+\s*-\s*(?:\$[\d,]+)?|Over(?:\s+\$[\d,]+)?))/;

function formatIsoDate(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day
    .toString()
    .padStart(2, '0')}`;
}

function toIsoDate(value: string): string {
  const [month, day, year] = value.split('/').map((part) => Number(part));
  return formatIsoDate(year, month, day);
}

function isValidIsoDate(value: string): boolean {
  const [year, month, day] = value.split('-').map((part) => Number(part));
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function yearOf(value: string): number {
  return Number(value.slice(0, 4));
}

function withYear(rawDate: string, year: number): string {
  const [month, day] = rawDate.split('/').map((part) => Number(part));
  return formatIsoDate(year, month, day);
}

function isPlausibleNotificationDate(notificationDate: string, filingDate: string | null): boolean {
  if (!filingDate) return true;
  return (
    notificationDate <= filingDate && Math.abs(yearOf(filingDate) - yearOf(notificationDate)) <= 1
  );
}

function repairNotificationDate(
  rawNotificationDate: string,
  tradeDate: string,
  filingDate: string | null
): string {
  const notificationDate = toIsoDate(rawNotificationDate);
  if (isPlausibleNotificationDate(notificationDate, filingDate)) return notificationDate;
  const candidates = [
    withYear(rawNotificationDate, yearOf(tradeDate)),
    withYear(rawNotificationDate, yearOf(tradeDate) + 1),
    ...(filingDate ? [withYear(rawNotificationDate, yearOf(filingDate))] : []),
  ];
  for (const candidate of candidates) {
    if (!isValidIsoDate(candidate)) continue;
    if (candidate < tradeDate) continue;
    if (filingDate && candidate > filingDate) continue;
    return candidate;
  }
  return notificationDate;
}

function repairTradeDate(rawTradeDate: string, notificationDate: string): string {
  const tradeDate = toIsoDate(rawTradeDate);
  if (tradeDate <= notificationDate) return tradeDate;
  const sameNotificationYear = withYear(rawTradeDate, yearOf(notificationDate));
  if (isValidIsoDate(sameNotificationYear) && sameNotificationYear <= notificationDate) {
    return sameNotificationYear;
  }
  const previousYear = withYear(rawTradeDate, yearOf(notificationDate) - 1);
  if (isValidIsoDate(previousYear)) return previousYear;
  return tradeDate;
}

function normalizeHousePtrDates(
  rawTradeDate: string,
  rawNotificationDate: string,
  filingDate: string | null
): { tradeDate: string; notificationDate: string } {
  const rawTradeIso = toIsoDate(rawTradeDate);
  const notificationDate = repairNotificationDate(rawNotificationDate, rawTradeIso, filingDate);
  return { tradeDate: repairTradeDate(rawTradeDate, notificationDate), notificationDate };
}

function txDescription(tx: string, qualifier?: string): string {
  const base =
    tx === 'P'
      ? 'Purchase'
      : tx === 'S'
        ? 'Sale'
        : tx === 'E'
          ? 'Exchange'
          : tx === 'G'
            ? 'Gift'
            : tx;
  return qualifier ? `${base} (${qualifier})` : base;
}

function txCategory(tx: string): TradeCategory {
  if (tx === 'P') return 'buy';
  if (tx === 'S') return 'sell';
  if (tx === 'E') return 'exchange';
  if (tx === 'G') return 'gift';
  return 'other';
}

function cleanAssetName(value: string): string {
  return value
    .replace(/\(([A-Z0-9.\-]+)\)\s*\[[A-Z]+\]/g, '')
    .replace(/\[[A-Z]+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTicker(value: string): string | null {
  return value.match(/\(([A-Z0-9.\-]+)\)\s*\[[A-Z]+\]/)?.[1] ?? null;
}

function extractAssetType(value: string): string | null {
  return (
    value.match(/\([A-Z0-9.\-]+\)\s*\[([A-Z]+)\]/)?.[1] ?? value.match(/\[([A-Z]+)\]/)?.[1] ?? null
  );
}

function normalizeAmount(raw: string, nextLine?: string): string {
  const compact = raw
    .replace(/^Spouse\/DC\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^Over$/i.test(compact)) {
    const nextAmount = nextLine?.match(/\$[\d,]+/)?.[0];
    return nextAmount ? `Over ${nextAmount}` : compact;
  }
  if (!compact.endsWith('-')) return compact;
  const nextAmount = nextLine?.match(/\$[\d,]+/)?.[0];
  return nextAmount ? `${compact} ${nextAmount}` : compact;
}

function assetContinuation(value: string): string {
  const trimmed = value.trim();
  if (/^\$[\d,]+$/.test(trimmed)) return '';
  return trimmed.replace(/\s+\$[\d,]+\s*$/g, '').trim();
}

export interface HousePtrParseContext {
  docId: string;
  filingYear: number;
  filingDate: string | null;
  filingUrl: string;
  filerNameFallback?: string;
}

// In `-layout` text the filer's "DESCRIPTION:" field renders as "D    : {text}"
// (the long label spills across table columns). It sits a few lines below its
// transaction and can wrap. Scan forward from a transaction for it, joining wraps,
// and stop at the next transaction so a description never attaches to the wrong row.
const DESC_MARKER = /^\s*D\s{2,}:\s*(.+\S)\s*$/;

function captureDescription(lines: string[], start: number): string | null {
  for (let k = start; k < lines.length; k++) {
    if (TX_RE.test(lines[k])) return null; // hit the next transaction first
    const m = lines[k].match(DESC_MARKER);
    if (!m) continue;
    let desc = m[1].trim();
    // Join up to 2 wrapped continuation lines (e.g. an expiry date that wrapped).
    for (let n = k + 1; n < lines.length && n <= k + 2; n++) {
      const cont = lines[n].trim();
      if (
        !cont ||
        TX_RE.test(lines[n]) ||
        /^(JT|SP|DC)\s/.test(cont) || // next owner row
        /^[A-Z]\s{0,6}(S\s{0,6})?:/.test(cont) || // next D:/F S: marker
        /Owner\s+Asset/.test(cont) // table header
      ) {
        break;
      }
      desc += ` ${cont}`;
    }
    return desc.replace(/\s+/g, ' ').trim();
  }
  return null;
}

export function parseHousePtrText(text: string, context: HousePtrParseContext): TradeRecord[] {
  const filerName =
    text.match(/Name:\s+([^\n]+)/)?.[1]?.trim() ?? context.filerNameFallback ?? 'Unknown filer';
  const lines = text.split(/\r?\n/);
  const trades: TradeRecord[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(TX_RE);
    if (!match?.groups) continue;

    const beforeTx = line.slice(0, match.index).trim();
    const ownerMatch = beforeTx.match(/^(JT|SP|DC)\s+(.+)$/);
    const owner = ownerMatch?.[1] ?? null;
    const firstAssetLine = ownerMatch?.[2] ?? beforeTx;

    const nextLine = lines[i + 1]?.trim() ?? '';
    const amount = normalizeAmount(match.groups.amount, nextLine);
    const continuation = assetContinuation(nextLine);
    const assetRaw = `${firstAssetLine} ${continuation}`.trim();
    const parsedAmount = parseDisclosureAmountRange(amount);
    const dates = normalizeHousePtrDates(
      match.groups.trade,
      match.groups.notify,
      context.filingDate
    );
    const index = trades.length + 1;
    const tx = match.groups.tx;
    const description = captureDescription(lines, i + 1);

    trades.push({
      externalId: `house-ptr:${context.filingYear}:${context.docId}:${index}`,
      source: 'house-ptr',
      chamber: 'house',
      politicianName: filerName,
      filerName,
      owner,
      assetName: cleanAssetName(assetRaw),
      ticker: extractTicker(assetRaw),
      assetType: extractAssetType(assetRaw),
      transactionType: tx,
      transactionDescription: txDescription(tx, match.groups.qualifier),
      category: txCategory(tx),
      tradeDate: dates.tradeDate,
      filingDate: context.filingDate,
      amount,
      amountRange: amount,
      amountMin: parsedAmount.amountMin,
      amountMax: parsedAmount.amountMax,
      filingDocId: context.docId,
      filingYear: context.filingYear,
      filingUrl: context.filingUrl,
      sourceUrl: context.filingUrl,
      description,
      option: parseOptionDescription(description),
    });
  }

  return trades;
}

// ---------------------------------------------------------------------------
// Forward-only ingest orchestrator
// ---------------------------------------------------------------------------

export interface IngestHouseOptions {
  fetchFn?: typeof fetch;
  extractText?: PdfTextExtractor;
  now?: Date;
  /** On the very first run, only ingest PTRs filed within this many days. */
  firstRunDays?: number;
  /** Max PDFs to fetch+parse per run (forward-only daily never needs many). */
  maxPdfs?: number;
  /** One-time: parse EVERY not-seen PTR for the year (ignore the recent window). */
  backfill?: boolean;
}

export interface IngestHouseResult {
  added: number;
  filings: number;
  scanned: number;
  error?: string;
}

function filerName(row: HouseDisclosureIndexRow): string {
  return [row.first, row.last, row.suffix].filter(Boolean).join(' ');
}

function daysAgoIso(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

/** Forward-only House PTR ingest. Mutates `cache` (trades, filings, seen ledger,
 *  houseYear cursor) and returns a summary. */
export async function ingestHousePtr(
  cache: PoliticsCache,
  opts: IngestHouseOptions = {}
): Promise<IngestHouseResult> {
  const fetchFn = opts.fetchFn ?? timeoutFetch();
  const extractText = opts.extractText ?? extractPdfTextWithPdftotext;
  const now = opts.now ?? new Date();
  const firstRunDays = opts.firstRunDays ?? 7;
  const maxPdfs = opts.maxPdfs ?? (opts.backfill ? 250 : 60);
  const year = now.getUTCFullYear();

  // Without poppler there's no point fetching PDFs — skip cleanly rather than
  // flood the feed with needs-attention filings. (Tests inject `extractText`.)
  if (!opts.extractText && !(await pdftotextAvailable())) {
    log.warn('pdftotext not available — skipping House PTR ingest (install poppler-utils)');
    return { added: 0, filings: 0, scanned: 0, error: 'pdftotext not available' };
  }

  const res = await fetchFn(houseIndexUrl(year), { headers: { Accept: 'text/plain' } });
  if (!res.ok) throw new Error(`House index fetch failed: HTTP ${res.status}`);
  const rows = parseHouseDisclosureIndex(await res.text());

  const seen = new Set(cache.seen.houseDocIds);
  // Backfill re-scans the whole year regardless of the seen ledger (a prior
  // forward-only first run may have seed-skipped every docId into it). Trade
  // externalIds keep re-processing idempotent.
  const ptrRows = rows.filter((row) => row.isPtr && (opts.backfill || !seen.has(row.docId)));

  // First-run bounding (the "forward-only" guarantee): the very first time we
  // ingest House, mark EVERY current PTR DocId as seen so history is never
  // back-filled, but only actually parse the last `firstRunDays`.
  const firstRun = cache.cursors.houseYear == null;
  const cutoff = daysAgoIso(now, firstRunDays);
  // Backfill parses every not-seen PTR for the year; a normal first run is bounded
  // to the recent window (forward-only).
  const windowed = opts.backfill
    ? ptrRows
    : firstRun
      ? ptrRows.filter((r) => (r.filingDate ?? '') >= cutoff)
      : ptrRows;
  const toProcess = windowed
    .sort((a, b) => (b.filingDate ?? '').localeCompare(a.filingDate ?? ''))
    .slice(0, maxPdfs);

  // Seed-skip (mark history seen without parsing) only applies to a normal
  // first run. In backfill we WANT the history, so don't pre-mark it.
  if (firstRun && !opts.backfill)
    cache.seen.houseDocIds = markSeen(
      cache.seen.houseDocIds,
      ptrRows.map((r) => r.docId)
    );
  if (firstRun && ptrRows.length > toProcess.length) {
    log.info(
      `First House run: seeding ${ptrRows.length} PTRs as seen, parsing ${toProcess.length}`
    );
  }

  const trades: TradeRecord[] = [];
  const filings: FilingRecord[] = [];
  const handled: string[] = [];
  let scanned = 0;
  let recovered = 0;
  const errors: string[] = [];

  // OCR fallback availability — checked once. Tests inject `extractText`, so OCR
  // only runs against the real pipeline.
  const canOcr = !opts.extractText && (await ocrAvailable());

  for (const row of toProcess) {
    const url = housePtrPdfUrl(year, row.docId);
    try {
      const pdfRes = await fetchFn(url, { headers: { Accept: 'application/pdf' } });
      if (!pdfRes.ok) throw new Error(`HTTP ${pdfRes.status}`);
      const pdfBytes = await pdfRes.arrayBuffer();

      let text = '';
      try {
        text = await extractText(pdfBytes, ['-layout']);
      } catch (extractErr) {
        filings.push(needsAttention(row, url, `pdftotext failed: ${msg(extractErr)}`));
        handled.push(row.docId);
        continue;
      }

      let parsed = isBlankExtractedPdfText(text)
        ? []
        : parseHousePtrText(text, {
            docId: row.docId,
            filingYear: year,
            filingDate: row.filingDate,
            filingUrl: url,
            filerNameFallback: filerName(row),
          });

      // Scanned/paper fallback: pdftotext found nothing parseable. Read the PTR
      // checkbox FORM directly from the rasterized image (gridline detection +
      // per-cell pixel-darkness for the Type/Amount X-marks). Handles the printed
      // A–J/3-type and A–K/4-type variants; handwritten or "see attached" filings
      // still come back empty and stay needs-attention.
      if (parsed.length === 0 && canOcr) {
        try {
          const ocrTrades = await parseScannedHousePtr(pdfBytes, {
            docId: row.docId,
            filingYear: year,
            filingDate: row.filingDate,
            filerName: filerName(row),
            filingUrl: url,
          });
          if (ocrTrades.length > 0) {
            parsed = ocrTrades;
            recovered += 1;
          }
        } catch (ocrErr) {
          log.warn(`Scanned-form recovery failed for ${row.docId}: ${msg(ocrErr)}`);
        }
      }

      if (parsed.length === 0) {
        filings.push(needsAttention(row, url, 'scanned/blank PDF (no extractable text)'));
        scanned++;
      } else {
        trades.push(...parsed);
      }
      handled.push(row.docId);
    } catch (err) {
      // Transient (network) failure — do NOT mark seen, so it retries next run.
      errors.push(`${row.docId}: ${msg(err)}`);
    }
  }

  mergeTrades(cache, trades);
  // Drop prior needs-attention entries for docIds we just resolved (OCR may have
  // recovered a filing that was previously flagged).
  const resolved = new Set(trades.map((t) => `house:${t.filingYear}:${t.filingDocId}`));
  cache.filings = cache.filings.filter((f) => !resolved.has(f.externalId));
  mergeFilings(cache, filings);
  cache.seen.houseDocIds = markSeen(cache.seen.houseDocIds, handled);
  cache.cursors.houseYear = year;

  if (errors.length) log.warn(`House PTR transient errors: ${errors.slice(0, 3).join('; ')}`);
  log.info(
    `House PTR: parsed ${trades.length} trades (${recovered} via OCR), ${filings.length} needs-attention`
  );
  return {
    added: trades.length,
    filings: filings.length,
    scanned,
    error: errors.length ? `${errors.length} transient fetch error(s)` : undefined,
  };
}

function needsAttention(row: HouseDisclosureIndexRow, url: string, warning: string): FilingRecord {
  const name = filerName(row);
  return {
    externalId: `house:${row.year}:${row.docId}`,
    source: 'house-ptr',
    chamber: 'house',
    filerName: name,
    politicianName: name,
    filingDate: row.filingDate,
    status: 'needs_attention',
    warning,
    docId: row.docId,
    sourceUrl: url,
  };
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
