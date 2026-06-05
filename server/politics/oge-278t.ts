// OGE Form 278-T (Trump executive-branch periodic transaction reports) ingest.
//
// Discovery ported from the Check the Vote backfill script
// (`scripts/backfill-trump-oge-278t.ts`), adapted to forward-only daily ingest
// (dedup by docId; no historical backfill loop). Trump files these rarely, so we
// process all *new* filings each run rather than bounding to a date window —
// otherwise the feed would usually be empty. The scanned PDFs are parsed with the
// OCR-hardened dual-strategy parser (`oge-parser.ts`).

import { createLogger } from '../logger.js';
import { timeoutFetch } from './http.js';
import {
  extractPdfTextWithPdftotext,
  pdftotextAvailable,
  type PdfTextExtractor,
} from './house-ptr.js';
import { markSeen, mergeFilings, mergeTrades } from './feed-store.js';
import { archiveFiling } from './filing-archive.js';
import { inferOgeTicker } from './oge-asset-normalization.js';
import {
  categoryFor,
  mergeOgeTransactions,
  parseOge278Transactions,
  parseOge278TransactionsFromBboxLayout,
  type OgeTransaction,
} from './oge-parser.js';
import { parseDisclosureAmountRange } from './trade-transform.js';
import type { FilingRecord, PoliticsCache, TradeRecord } from './types.js';

const log = createLogger('PoliticsOGE');

const OGE_ORIGIN = 'https://extapps2.oge.gov';
const OGE_API = `${OGE_ORIGIN}/201/Presiden.nsf/API.xsp/v2/rest`;
const COLUMNS = ['docDate', 'title', 'type', 'name', 'agency', 'level'] as const;

const TRUMP_NAME = 'Donald J. Trump';

interface OgeApiRow {
  type: string;
  name: string;
  agency: string;
  title: string;
  level: string;
  docDate: string;
  amended: string;
}

export interface OgePdf {
  docId: string;
  url: string;
  docDate: string;
  name: string;
}

function asDateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
}

function inferAssetType(assetName: string): string | null {
  const upper = assetName.toUpperCase();
  if (upper.includes(' ETF') || upper.includes('TRUST')) return 'ETF';
  if (upper.includes('OPSH') || upper.includes('DPSH') || upper.includes('COMMON STOCK')) {
    return 'ST';
  }
  if (
    upper.includes(' DUE ') ||
    upper.includes(' B/E') ||
    upper.includes(' REV ') ||
    upper.includes(' RFDG') ||
    upper.includes(' NOTE') ||
    upper.includes(' NTS') ||
    upper.includes(' BOND') ||
    upper.includes(' MUN ') ||
    upper.includes(' CNTY ') ||
    upper.includes(' SCH ')
  ) {
    return 'BOND';
  }
  return null;
}

function resolveOgeUrl(href: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  return `${OGE_ORIGIN}${href.startsWith('/') ? '' : '/'}${href}`;
}

function extractDirectHref(typeHtml: string): string | null {
  const href = typeHtml.match(/href=['"]([^'"]+)['"]/i)?.[1];
  if (!href || !href.includes('/PAS+Index/') || !href.toLowerCase().includes('.pdf')) return null;
  return href.replace(/\\\//g, '/');
}

function extractDocId(url: string): string | null {
  return url.match(/\/PAS\+Index\/([^/]+)\//)?.[1] ?? null;
}

/** Query the OGE presidential-disclosure API for Trump's 278-T (transaction) PDFs. */
export async function fetchTrumpOgePdfs(fetchFn: typeof fetch = timeoutFetch()): Promise<OgePdf[]> {
  const params = new URLSearchParams({
    draw: '1',
    start: '0',
    length: '100',
    'search[value]': '',
    'search[regex]': 'false',
    'order[0][column]': '0',
    'order[0][dir]': 'desc',
  });
  COLUMNS.forEach((column, index) => {
    params.set(`columns[${index}][data]`, column);
    params.set(`columns[${index}][name]`, '');
    params.set(`columns[${index}][searchable]`, 'true');
    params.set(`columns[${index}][orderable]`, 'true');
    params.set(`columns[${index}][search][value]`, index === 3 ? 'Trump, Donald' : '');
    params.set(`columns[${index}][search][regex]`, 'false');
  });

  const response = await fetchFn(`${OGE_API}?${params.toString()}`, {
    headers: { 'user-agent': 'docvault-politics/1.0', accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`OGE API returned ${response.status}`);
  const data = (await response.json()) as { data?: OgeApiRow[] };

  const pdfs: OgePdf[] = [];
  const seen = new Set<string>();
  for (const row of data.data ?? []) {
    if (!/278\s+Transaction/i.test(row.type)) continue;
    const href = extractDirectHref(row.type);
    if (!href) continue;
    const docId = extractDocId(href);
    if (!docId || seen.has(docId)) continue;
    seen.add(docId);
    pdfs.push({ docId, url: resolveOgeUrl(href), docDate: row.docDate, name: row.name });
  }
  return pdfs;
}

/** Parse one OGE 278-T PDF with both strategies and merge by sequence number. */
async function parseOgePdf(
  pdf: OgePdf,
  filingYear: number,
  fetchFn: typeof fetch,
  extractText: PdfTextExtractor
): Promise<{ transactions: OgeTransaction[]; pdfBytes: ArrayBuffer; text: string }> {
  const response = await fetchFn(pdf.url, { headers: { Accept: 'application/pdf' } });
  if (!response.ok) throw new Error(`OGE 278-T PDF fetch failed: ${response.status}`);
  const pdfBytes = await response.arrayBuffer();

  const layoutText = await extractText(pdfBytes, ['-layout']);
  const layout = parseOge278Transactions(layoutText, filingYear);

  const bboxText = await extractText(pdfBytes, ['-bbox-layout']);
  const bbox = parseOge278TransactionsFromBboxLayout(bboxText, filingYear);

  return { transactions: mergeOgeTransactions(layout, bbox), pdfBytes, text: layoutText };
}

function toTradeRecord(
  pdf: OgePdf,
  filingDate: string | null,
  filingYear: number,
  txn: OgeTransaction
): TradeRecord {
  const assetType = inferAssetType(txn.assetName);
  const amount = txn.amount;
  const range = parseDisclosureAmountRange(amount);
  const description =
    txn.transactionType === 'purchase'
      ? 'Purchase'
      : txn.transactionType === 'sale'
        ? 'Sale'
        : txn.transactionType === 'exchange'
          ? 'Exchange'
          : 'Unknown';
  return {
    externalId: `oge-278t:${pdf.docId}:${txn.sequence}`,
    source: 'oge-278t',
    chamber: 'executive',
    politicianName: TRUMP_NAME,
    filerName: TRUMP_NAME,
    owner: null,
    assetName: txn.assetName,
    ticker: inferOgeTicker(txn.assetName, assetType),
    assetType,
    transactionType: txn.transactionType,
    transactionDescription: description,
    category: categoryFor(txn.transactionType),
    tradeDate: txn.tradeDate,
    filingDate,
    amount,
    amountRange: amount,
    amountMin: range.amountMin,
    amountMax: range.amountMax,
    filingDocId: pdf.docId,
    filingYear,
    filingUrl: pdf.url,
    sourceUrl: pdf.url,
  };
}

export interface IngestOgeOptions {
  fetchFn?: typeof fetch;
  extractText?: PdfTextExtractor;
  /** Newest filings to parse per run. Each OGE-278-T is huge; the few newest
   *  cover recent activity (forward-only). */
  maxPdfs?: number;
  /** Keep only the most-recent N transactions from each filing. */
  maxTradesPerFiling?: number;
  /** One-time: pull all of Trump's available filings, not just the newest few. */
  backfill?: boolean;
  /** Force-enable filing archiving even when `extractText` is injected (tests). */
  archive?: boolean;
}

export interface IngestOgeResult {
  added: number;
  filings: number;
  error?: string;
}

/** Forward-only Trump OGE-278-T ingest. Mutates `cache` and returns a summary. */
export async function ingestOge278t(
  cache: PoliticsCache,
  opts: IngestOgeOptions = {}
): Promise<IngestOgeResult> {
  const fetchFn = opts.fetchFn ?? timeoutFetch();
  const extractText = opts.extractText ?? extractPdfTextWithPdftotext;
  const maxPdfs = opts.maxPdfs ?? (opts.backfill ? 20 : 3);
  const maxTradesPerFiling = opts.maxTradesPerFiling ?? 250;

  if (!opts.extractText && !(await pdftotextAvailable())) {
    log.warn('pdftotext not available — skipping OGE-278-T ingest (install poppler-utils)');
    return { added: 0, filings: 0, error: 'pdftotext not available' };
  }

  const seen = new Set(cache.seen.ogeDocIds);
  let pdfs: OgePdf[];
  try {
    pdfs = (await fetchTrumpOgePdfs(fetchFn)).filter((p) => !seen.has(p.docId)).slice(0, maxPdfs);
  } catch (err) {
    return { added: 0, filings: 0, error: msg(err) };
  }

  const trades: TradeRecord[] = [];
  const filings: FilingRecord[] = [];
  const handled: string[] = [];
  const errors: string[] = [];
  let archived = 0;

  for (const pdf of pdfs) {
    const filingDate = asDateOnly(pdf.docDate);
    const filingYear = filingDate ? Number(filingDate.slice(0, 4)) : new Date().getUTCFullYear();
    try {
      const {
        transactions: txns,
        pdfBytes,
        text,
      } = await parseOgePdf(pdf, filingYear, fetchFn, extractText);
      // Drop transactions dated after the filing (an OCR year mis-read), then
      // keep only the most-recent N — a single filing can hold ~1,100 rows.
      const usable = txns
        .filter((t) => !filingDate || t.tradeDate <= filingDate)
        .sort((a, b) => b.tradeDate.localeCompare(a.tradeDate))
        .slice(0, maxTradesPerFiling);
      if (usable.length === 0) {
        filings.push(needsAttention(pdf, filingDate, 'no transactions parsed (scanned/illegible)'));
      } else {
        trades.push(...usable.map((t) => toTradeRecord(pdf, filingDate, filingYear, t)));
      }
      if (!opts.extractText || opts.archive) {
        await archiveFiling({
          source: 'oge-278t',
          docId: pdf.docId,
          chamber: 'executive',
          filerName: TRUMP_NAME,
          filingYear,
          filingDate,
          filingUrl: pdf.url,
          pdfBytes,
          text,
          parseMethod: usable.length > 0 ? 'text' : 'none',
          tradeCount: usable.length,
        });
        archived += 1;
        log.debug(`archived oge-278t/${pdf.docId} (${usable.length} trades)`);
      }
      handled.push(pdf.docId);
    } catch (err) {
      errors.push(`${pdf.docId}: ${msg(err)}`);
    }
  }

  mergeTrades(cache, trades);
  mergeFilings(cache, filings);
  cache.seen.ogeDocIds = markSeen(cache.seen.ogeDocIds, handled);
  if (pdfs[0]?.docDate) cache.cursors.ogeLastDocDate = asDateOnly(pdfs[0].docDate) ?? undefined;

  if (errors.length) log.warn(`OGE-278-T transient errors: ${errors.slice(0, 3).join('; ')}`);
  log.info(
    `OGE-278-T: parsed ${trades.length} Trump trades from ${handled.length} filing(s), archived ${archived}`
  );
  return {
    added: trades.length,
    filings: filings.length,
    error: errors.length ? `${errors.length} transient error(s)` : undefined,
  };
}

function needsAttention(pdf: OgePdf, filingDate: string | null, warning: string): FilingRecord {
  return {
    externalId: `oge-278t:${pdf.docId}`,
    source: 'oge-278t',
    chamber: 'executive',
    filerName: TRUMP_NAME,
    politicianName: TRUMP_NAME,
    filingDate,
    status: 'needs_attention',
    warning,
    docId: pdf.docId,
    sourceUrl: pdf.url,
  };
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
