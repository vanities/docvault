// Filing archive — persists every disclosure we fetch (raw PDF + extracted text
// + parse metadata) under DATA_DIR/.docvault-filings/{source}/{docId}.{pdf,txt,json}.
//
// Before this, the ingest fetched each filing into a temp dir, parsed it, and
// DELETED it — only the extracted trades survived, in a capped rolling cache. That
// made past filings unsearchable and un-re-parseable. Archiving them is the
// substrate for the browse/search pages, re-parsing without re-fetching, the
// backtest's price-at-trade inputs, and an audit trail.
//
// Layout is one small file-set per filing (no shared index file to contend on
// during a backfill). Listing/search build an in-memory index by scanning the
// metadata files once, cached for the process lifetime.

import { promises as fs } from 'fs';
import path from 'path';
import { DATA_DIR } from '../data.js';
import { createLogger } from '../logger.js';

const log = createLogger('PoliticsArchive');

/** Overridable for tests. */
function archiveDir(): string {
  return process.env.DOCVAULT_FILINGS_DIR ?? path.join(DATA_DIR, '.docvault-filings');
}

const safe = (s: string): string => s.replace(/[^A-Za-z0-9_-]/g, '');

export type ParseMethod = 'text' | 'ocr' | 'none';

export interface FilingMeta {
  docId: string;
  source: string; // 'house-ptr' | 'senate-ptr' | 'oge-278t'
  chamber: string;
  filerName: string;
  filingYear: number;
  filingDate: string | null;
  filingUrl: string;
  parseMethod: ParseMethod;
  tradeCount: number;
  textLength: number;
  hasPdf: boolean;
  fetchedAt: string; // ISO
}

export interface ArchiveInput {
  source: string;
  docId: string;
  chamber: string;
  filerName: string;
  filingYear: number;
  filingDate: string | null;
  filingUrl: string;
  pdfBytes?: ArrayBuffer | null;
  text?: string | null;
  parseMethod: ParseMethod;
  tradeCount: number;
  /** ISO timestamp; defaults to now. Injectable for deterministic tests. */
  fetchedAt?: string;
}

export interface FilingFilter {
  source?: string;
  chamber?: string;
  filer?: string; // substring, case-insensitive
  year?: number;
  hasTrades?: boolean;
  limit?: number;
}

// In-memory index, keyed by the archive dir so a test pointing elsewhere rebuilds.
let cache: { dir: string; map: Map<string, FilingMeta> } | null = null;
const cacheKey = (source: string, docId: string): string => `${safe(source)}/${safe(docId)}`;

/** Reset the in-memory index (tests). */
export function resetArchiveCache(): void {
  cache = null;
}

async function writeAtomic(file: string, data: Buffer | string): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file);
}

/** Save a fetched filing (PDF + text + metadata). Best-effort: never throws into
 *  the ingest path. */
export async function archiveFiling(input: ArchiveInput): Promise<void> {
  const source = safe(input.source);
  const docId = safe(input.docId);
  if (!docId) return;
  try {
    const dir = path.join(archiveDir(), source);
    await fs.mkdir(dir, { recursive: true });
    const base = path.join(dir, docId);
    if (input.pdfBytes) await writeAtomic(`${base}.pdf`, Buffer.from(input.pdfBytes));
    if (input.text != null) await writeAtomic(`${base}.txt`, input.text);
    const meta: FilingMeta = {
      docId: input.docId,
      source: input.source,
      chamber: input.chamber,
      filerName: input.filerName,
      filingYear: input.filingYear,
      filingDate: input.filingDate,
      filingUrl: input.filingUrl,
      parseMethod: input.parseMethod,
      tradeCount: input.tradeCount,
      textLength: input.text?.length ?? 0,
      hasPdf: !!input.pdfBytes,
      fetchedAt: input.fetchedAt ?? new Date().toISOString(),
    };
    await writeAtomic(`${base}.json`, JSON.stringify(meta));
    if (cache && cache.dir === archiveDir()) cache.map.set(cacheKey(source, docId), meta);
  } catch (err) {
    log.warn(`archive failed for ${source}/${docId}: ${err instanceof Error ? err.message : err}`);
  }
}

async function loadIndex(): Promise<Map<string, FilingMeta>> {
  const dir = archiveDir();
  if (cache && cache.dir === dir) return cache.map;
  const map = new Map<string, FilingMeta>();
  try {
    for (const src of await fs.readdir(dir)) {
      const sub = path.join(dir, src);
      let files: string[];
      try {
        files = await fs.readdir(sub);
      } catch {
        continue;
      }
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        try {
          const meta = JSON.parse(await fs.readFile(path.join(sub, f), 'utf8')) as FilingMeta;
          map.set(cacheKey(meta.source, meta.docId), meta);
        } catch {
          /* skip corrupt entry */
        }
      }
    }
  } catch {
    /* archive dir doesn't exist yet */
  }
  cache = { dir, map };
  return map;
}

/** Pure: filter + sort (newest filing first) + limit a list of filing metadata. */
export function filterFilings(all: FilingMeta[], filter: FilingFilter = {}): FilingMeta[] {
  let out = all;
  if (filter.source) out = out.filter((f) => f.source === filter.source);
  if (filter.chamber) out = out.filter((f) => f.chamber === filter.chamber);
  if (filter.year != null) out = out.filter((f) => f.filingYear === filter.year);
  if (filter.hasTrades) out = out.filter((f) => f.tradeCount > 0);
  if (filter.filer) {
    const q = filter.filer.toLowerCase();
    out = out.filter((f) => f.filerName.toLowerCase().includes(q));
  }
  out = [...out].sort(
    (a, b) =>
      (b.filingDate ?? '').localeCompare(a.filingDate ?? '') ||
      b.fetchedAt.localeCompare(a.fetchedAt)
  );
  return filter.limit ? out.slice(0, filter.limit) : out;
}

export async function listFilings(filter: FilingFilter = {}): Promise<FilingMeta[]> {
  return filterFilings([...(await loadIndex()).values()], filter);
}

export async function getFilingMeta(source: string, docId: string): Promise<FilingMeta | null> {
  return (await loadIndex()).get(cacheKey(source, docId)) ?? null;
}

export async function readFilingText(source: string, docId: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(archiveDir(), safe(source), `${safe(docId)}.txt`), 'utf8');
  } catch {
    return null;
  }
}

export async function readFilingPdf(source: string, docId: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(path.join(archiveDir(), safe(source), `${safe(docId)}.pdf`));
  } catch {
    return null;
  }
}

/** Full-text search across archived filing text (simple substring scan; fine for
 *  thousands of filings, upgrade to an index if it ever isn't). */
export async function searchFilings(query: string, limit = 50): Promise<FilingMeta[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const metas = filterFilings([...(await loadIndex()).values()]); // newest first
  const hits: FilingMeta[] = [];
  for (const meta of metas) {
    if (hits.length >= limit) break;
    const text = await readFilingText(meta.source, meta.docId);
    if (text && text.toLowerCase().includes(q)) hits.push(meta);
  }
  return hits;
}
