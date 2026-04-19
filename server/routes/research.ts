// Research routes — analyst research PDF uploads with plain-text extraction.
//
// Deliberately AI-free at upload time. Text is pulled out via unpdf so it's
// searchable + readable in the UI; users add their own notes and tags. An
// AI summarizer can be layered on later as an opt-in action.
//
// Routes:
//   POST   /api/research/upload            — upload a PDF, extract text immediately
//     body: raw PDF bytes; query: ?filename=<name>&title=<override>
//   GET    /api/research                   — list all entries (newest first)
//   GET    /api/research/:id               — single entry (metadata + text)
//   GET    /api/research/:id/file          — raw PDF bytes (inline for browser viewer)
//   PATCH  /api/research/:id               — update title / author / publisher / reportDate / notes / tags
//   POST   /api/research/:id/re-extract    — re-run text extraction against stored PDF
//   DELETE /api/research/:id                — delete entry + file
//
// Storage:
//   data/research/<id>.pdf                  — raw PDF
//   .docvault-research.json → { version, entries: { id → ResearchEntry } }

import { promises as fs } from 'fs';
import path from 'path';
import { jsonResponse, ensureDir, DATA_DIR } from '../data.js';
import { extractResearchText, RESEARCH_EXTRACTOR_VERSION } from '../parsers/research-report.js';
import { createLogger } from '../logger.js';

const log = createLogger('Research');

const RESEARCH_STORE_FILE = path.join(DATA_DIR, '.docvault-research.json');
const RESEARCH_DATA_DIR = path.join(DATA_DIR, 'research');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResearchEntry {
  id: string;
  /** Original filename at upload, for display. */
  filename: string | null;
  /** Relative path under DATA_DIR. */
  filePath: string;
  /** Always 'application/pdf' for now — UI + upload guard enforce this. */
  mediaType: 'application/pdf';
  uploadedAt: string;
  /** Plain text extracted from the PDF, pages separated by form-feed (\f). */
  text: string | null;
  pageCount: number | null;
  extractedAt: string | null;
  extractorVersion: string | null;
  /** Error message if extraction failed. */
  extractError: string | null;

  // User-editable metadata —
  /** User-supplied or inferred (first-line) title. */
  title?: string;
  /** Analyst / author name. Free-form. */
  author?: string;
  /** Publication name (e.g. "Into The Cryptoverse", "Lyn Alden"). */
  publisher?: string;
  /** YYYY-MM-DD publication date. */
  reportDate?: string;
  /** User's free-form notes. */
  notes?: string;
  /** User-defined tags for filtering. */
  tags?: string[];
  lastUpdated: string;
}

interface ResearchStore {
  version: 1;
  entries: Record<string, ResearchEntry>;
}

// ---------------------------------------------------------------------------
// Store helpers — atomic tmp→rename writes (same pattern as nutrition/health).
// ---------------------------------------------------------------------------

async function loadStore(): Promise<ResearchStore> {
  try {
    const raw = await fs.readFile(RESEARCH_STORE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<ResearchStore>;
    return { version: 1, entries: parsed.entries ?? {} };
  } catch {
    return { version: 1, entries: {} };
  }
}

async function saveStore(store: ResearchStore): Promise<void> {
  await ensureDir(DATA_DIR);
  const tmp = `${RESEARCH_STORE_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2));
  await fs.rename(tmp, RESEARCH_STORE_FILE);
}

function newEntryId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 10; i++) {
    id += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return id;
}

// ---------------------------------------------------------------------------
// Upload validation — PDFs only for now.
// ---------------------------------------------------------------------------

function looksLikePdf(buf: Buffer): boolean {
  // %PDF- magic bytes
  return (
    buf.length >= 5 &&
    buf[0] === 0x25 &&
    buf[1] === 0x50 &&
    buf[2] === 0x44 &&
    buf[3] === 0x46 &&
    buf[4] === 0x2d
  );
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function handleResearchRoutes(
  req: Request,
  url: URL,
  pathname: string
): Promise<Response | null> {
  const match = pathname.match(/^\/api\/research(\/[^?]*)?$/);
  if (!match) return null;
  const sub = match[1] ?? '';

  // POST /api/research/upload
  if (sub === '/upload' && req.method === 'POST') {
    const filename = url.searchParams.get('filename');
    const titleOverride = url.searchParams.get('title');
    const raw = Buffer.from(await req.arrayBuffer());
    if (raw.length === 0) {
      return jsonResponse({ error: 'Empty upload' }, 400);
    }
    if (!looksLikePdf(raw)) {
      return jsonResponse(
        { error: 'Only PDF uploads are supported. Convert other formats to PDF first.' },
        400
      );
    }

    const id = newEntryId();
    await ensureDir(RESEARCH_DATA_DIR);
    const absPath = path.join(RESEARCH_DATA_DIR, `${id}.pdf`);
    const relPath = path.relative(DATA_DIR, absPath);
    await fs.writeFile(absPath, raw);

    const now = new Date().toISOString();
    let text: string | null = null;
    let pageCount: number | null = null;
    let extractError: string | null = null;
    let extractedAt: string | null = null;
    let inferredTitle: string | undefined;

    try {
      const result = await extractResearchText(raw);
      text = result.text;
      pageCount = result.pageCount;
      inferredTitle = result.inferredTitle;
      extractedAt = new Date().toISOString();
    } catch (err) {
      extractError = err instanceof Error ? err.message : String(err);
      log.error(`Text extraction failed for research ${id}:`, extractError);
    }

    const entry: ResearchEntry = {
      id,
      filename,
      filePath: relPath,
      mediaType: 'application/pdf',
      uploadedAt: now,
      text,
      pageCount,
      extractedAt,
      extractorVersion: extractedAt ? RESEARCH_EXTRACTOR_VERSION : null,
      extractError,
      title: titleOverride ?? inferredTitle,
      lastUpdated: now,
    };

    const store = await loadStore();
    store.entries[id] = entry;
    await saveStore(store);

    log.info(`Research upload: id=${id} pages=${pageCount ?? '?'} title="${entry.title ?? '?'}"`);
    return jsonResponse({ entry });
  }

  // GET /api/research — list newest first (by reportDate if set, else upload time)
  if (sub === '' && req.method === 'GET') {
    const store = await loadStore();
    const entries = Object.values(store.entries).sort((a, b) => {
      const aDate = a.reportDate ?? a.uploadedAt.slice(0, 10);
      const bDate = b.reportDate ?? b.uploadedAt.slice(0, 10);
      return bDate.localeCompare(aDate);
    });
    return jsonResponse({ entries });
  }

  // Per-entry subpaths
  const idMatch = sub.match(/^\/([a-z0-9]+)(?:\/(file|re-extract))?$/i);
  if (idMatch) {
    const id = idMatch[1];
    const action = idMatch[2];

    const store = await loadStore();
    const entry = store.entries[id];
    if (!entry) {
      return jsonResponse({ error: `No research entry "${id}"` }, 404);
    }

    // GET /api/research/:id/file — raw PDF, inline so browser viewer handles it
    if (action === 'file' && req.method === 'GET') {
      const abs = path.join(DATA_DIR, entry.filePath);
      try {
        const bytes = await fs.readFile(abs);
        return new Response(new Uint8Array(bytes), {
          headers: {
            'Content-Type': entry.mediaType,
            'Cache-Control': 'private, max-age=3600',
            'Content-Disposition': `inline; filename="${entry.filename ?? `${id}.pdf`}"`,
          },
        });
      } catch {
        return jsonResponse({ error: 'File missing on disk' }, 410);
      }
    }

    // POST /api/research/:id/re-extract — re-run text extraction
    if (action === 're-extract' && req.method === 'POST') {
      const abs = path.join(DATA_DIR, entry.filePath);
      let raw: Buffer;
      try {
        raw = await fs.readFile(abs);
      } catch {
        return jsonResponse({ error: 'File missing on disk' }, 410);
      }

      let text: string | null = null;
      let pageCount: number | null = null;
      let extractError: string | null = null;
      try {
        const result = await extractResearchText(raw);
        text = result.text;
        pageCount = result.pageCount;
      } catch (err) {
        extractError = err instanceof Error ? err.message : String(err);
      }

      const now = new Date().toISOString();
      entry.text = text;
      entry.pageCount = pageCount;
      entry.extractError = extractError;
      entry.extractedAt = text !== null ? now : entry.extractedAt;
      entry.extractorVersion = text !== null ? RESEARCH_EXTRACTOR_VERSION : entry.extractorVersion;
      entry.lastUpdated = now;
      await saveStore(store);
      return jsonResponse({ entry });
    }

    // GET /api/research/:id
    if (!action && req.method === 'GET') {
      return jsonResponse({ entry });
    }

    // PATCH /api/research/:id — user edits for metadata + notes
    if (!action && req.method === 'PATCH') {
      const body = (await req.json().catch(() => ({}))) as Partial<{
        title: string | null;
        author: string | null;
        publisher: string | null;
        reportDate: string | null;
        notes: string | null;
        tags: string[] | null;
      }>;

      if (body.title !== undefined) entry.title = body.title ?? undefined;
      if (body.author !== undefined) entry.author = body.author ?? undefined;
      if (body.publisher !== undefined) entry.publisher = body.publisher ?? undefined;
      if (body.reportDate !== undefined) entry.reportDate = body.reportDate ?? undefined;
      if (body.notes !== undefined) entry.notes = body.notes ?? undefined;
      if (body.tags !== undefined) entry.tags = body.tags ?? undefined;
      entry.lastUpdated = new Date().toISOString();
      await saveStore(store);
      return jsonResponse({ entry });
    }

    // DELETE /api/research/:id — removes the PDF file AND the store entry
    if (!action && req.method === 'DELETE') {
      const abs = path.join(DATA_DIR, entry.filePath);
      try {
        await fs.unlink(abs);
      } catch {
        /* already gone — fine */
      }
      delete store.entries[id];
      await saveStore(store);
      log.info(`Research entry ${id} deleted`);
      return jsonResponse({ ok: true });
    }
  }

  return null;
}

export { RESEARCH_EXTRACTOR_VERSION };
