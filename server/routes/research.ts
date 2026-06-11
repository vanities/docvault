// Research routes — analyst research ingest with plain-text storage.
//
// Two ingest paths, both deliberately AI-free:
//   • PDF upload  — text is pulled out via unpdf so it's searchable + readable.
//   • Pasted text — transcripts, articles, and notes are stored verbatim; the
//                   request body IS the text, so there's no extraction step.
// Users add their own notes and tags. An AI summarizer can be layered on later
// as an opt-in action.
//
// Routes:
//   POST   /api/research/upload            — upload a PDF, extract text immediately
//     body: raw PDF bytes; query: ?filename=<name>&title=<override>
//   POST   /api/research/text              — ingest pasted text (e.g. a video transcript)
//     body: JSON { text, title?, author?, publisher?, reportDate?, sourceUrl?, tickers?, filename? }
//   POST   /api/research/youtube           — fetch a YouTube video's captions + metadata via yt-dlp
//     body: JSON { url, tickers? }
//   GET    /api/research                   — list all entries (newest first)
//   GET    /api/research/:id               — single entry (metadata + text)
//   GET    /api/research/:id/file          — raw file bytes (inline for browser viewer)
//   PATCH  /api/research/:id               — update title / author / publisher / reportDate / sourceUrl / notes / tags / tickers
//   POST   /api/research/:id/re-extract    — re-run text extraction (PDF entries only)
//   DELETE /api/research/:id                — delete entry + file
//
// Storage:
//   data/research/<id>.pdf | <id>.txt       — raw PDF, or pasted text
//   .docvault-research.json → { version, entries: { id → ResearchEntry } }

import { promises as fs } from 'fs';
import path from 'path';
import { jsonResponse, ensureDir, DATA_DIR } from '../data.js';
import { extractResearchText, RESEARCH_EXTRACTOR_VERSION } from '../parsers/research-report.js';
import {
  YOUTUBE_EXTRACTOR_VERSION,
  extractVideoId,
  fetchYouTubeTranscript,
} from '../parsers/youtube-transcript.js';
import {
  MEDIA_TRANSCRIBE_EXTRACTOR_VERSION,
  transcribeMediaFile,
} from '../parsers/media-transcribe.js';
import { createLogger } from '../logger.js';
import { normalizeTickers } from '../tickers.js';
import { buildResearchIntelligence, type ResearchIntelligence } from '../research-intelligence.js';
import {
  buildResearchPoliticsBriefs,
  buildResearchPoliticsLinks,
} from '../research-politics-links.js';
import { loadPoliticsFeedPayload } from '../politics/feed-store.js';

const log = createLogger('Research');

const RESEARCH_STORE_FILE = path.join(DATA_DIR, '.docvault-research.json');
const RESEARCH_DATA_DIR = path.join(DATA_DIR, 'research');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const RESEARCH_DOMAINS = ['finance', 'health', 'politics', 'tech', 'local'] as const;
export type ResearchDomain = (typeof RESEARCH_DOMAINS)[number];

/**
 * Stored media types. PDF and plain text are the original ingest paths; the
 * video/* and audio/* types back the "Upload video/audio" path, where the file
 * is kept as playable media and transcribed in the background. The value also
 * doubles as the Content-Type when serving the file back.
 */
export type ResearchMediaType =
  | 'application/pdf'
  | 'text/plain'
  | 'video/mp4'
  | 'video/quicktime'
  | 'video/x-matroska'
  | 'video/webm'
  | 'audio/mpeg'
  | 'audio/mp4'
  | 'audio/wav'
  | 'audio/webm';

export interface ResearchEntry {
  id: string;
  /**
   * Which tab surfaces this entry — 'finance' shows up in Quant → Research,
   * 'health' shows up in Health → Research, and 'politics' shows up in the
   * Political intelligence tab. Defaults to 'finance' for entries written
   * before this field existed (backfilled in loadStore).
   */
  domain: ResearchDomain;
  /** Original filename at upload, for display. */
  filename: string | null;
  /** Relative path under DATA_DIR. */
  filePath: string;
  /**
   * 'application/pdf' for uploaded PDFs, 'text/plain' for pasted text
   * (transcripts, articles, notes), or a video/* | audio/* type for uploaded
   * media. Determines the ingest path and which per-entry actions apply — e.g.
   * re-extract is PDF-only, re-transcribe is media-only.
   */
  mediaType: ResearchMediaType;
  uploadedAt: string;
  /**
   * The entry's text. For PDFs: extracted via unpdf, pages separated by
   * form-feed (\f). For pasted text: the verbatim body, stored as-is.
   */
  text: string | null;
  /** PDF page count; null for pasted-text entries. */
  pageCount: number | null;
  extractedAt: string | null;
  /** Extractor schema version for PDFs; null for pasted text (no extractor). */
  extractorVersion: string | null;
  /** Error message if extraction failed. */
  extractError: string | null;

  // Background transcription lifecycle — video/audio entries only; absent on
  // PDF/text. The entry is created immediately (file on disk, text=null,
  // transcribeStatus='pending'); a background job flips it 'running' → 'done'
  // (text populated) or 'error' (transcribeError set). Polling rides the
  // existing GET /api/research/:id — there is no separate job store.
  /** Lifecycle of background transcription. Undefined for non-media entries. */
  transcribeStatus?: 'pending' | 'running' | 'done' | 'error';
  /** Failure message when transcribeStatus === 'error'. */
  transcribeError?: string;
  /** Source media duration in seconds (from ffmpeg), for display. */
  durationSec?: number;

  // User-editable metadata —
  /** User-supplied or inferred (first-line) title. */
  title?: string;
  /** Analyst / author name. Free-form. */
  author?: string;
  /** Publication name (e.g. "Into The Cryptoverse", "Lyn Alden"). */
  publisher?: string;
  /** YYYY-MM-DD publication date. */
  reportDate?: string;
  /** Source URL — e.g. the YouTube link a transcript was captured from. */
  sourceUrl?: string;
  /** User's free-form notes. */
  notes?: string;
  /** User-defined tags for filtering. */
  tags?: string[];
  /**
   * Yahoo-style ticker symbols tagged on this entry — e.g. ["NVDA","TSM","NK.PA"].
   * Normalized on write (uppercase, deduped, charset-validated). Used to power
   * the per-entry price strip and the Quant → Tickers aggregate view. Finance
   * entries only — health entries leave this undefined.
   */
  tickers?: string[];
  /**
   * Optional list of HealthPerson IDs this entry is relevant to. Health
   * entries can be linked to one or more people so research about a
   * specific family member (e.g. pediatric studies for a child) can be
   * surfaced on that person's dashboard later. Finance entries leave this
   * undefined.
   */
  linkedPersonIds?: string[];
  /** Deterministic source-grounded summary/claim extraction generated from `text`. */
  intelligence?: ResearchIntelligence;
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
    const entries: Record<string, ResearchEntry> = {};
    for (const [id, e] of Object.entries(parsed.entries ?? {})) {
      // Backfill `domain` for entries written before the field existed —
      // they're all finance (Quant Research is where the feature shipped).
      entries[id] = { ...e, domain: e.domain ?? 'finance' };
    }
    return { version: 1, entries };
  } catch {
    return { version: 1, entries: {} };
  }
}

/** All research entries (optionally one domain), newest-first by reportDate
 *  then upload time. Exported for in-process consumers (the Daily News digest)
 *  that need entries without an HTTP round-trip. */
export async function listResearchEntries(domain?: ResearchDomain): Promise<ResearchEntry[]> {
  const store = await loadStore();
  let entries = Object.values(store.entries);
  if (domain) entries = entries.filter((e) => e.domain === domain);
  entries.sort((a, b) => {
    const aDate = a.reportDate ?? a.uploadedAt.slice(0, 10);
    const bDate = b.reportDate ?? b.uploadedAt.slice(0, 10);
    return bDate.localeCompare(aDate);
  });
  return entries;
}

export function isResearchDomain(raw: unknown): raw is ResearchDomain {
  return typeof raw === 'string' && (RESEARCH_DOMAINS as readonly string[]).includes(raw);
}

/** Parse the `domain` value supplied by a client. Unknown values fall back to
 *  "finance" — keeps the legacy Quant ingest path working when callers don't
 *  send a domain at all. */
export function parseDomain(raw: unknown): ResearchDomain {
  return isResearchDomain(raw) ? raw : 'finance';
}

/** Coerce a client-supplied list of person IDs into a clean string[].
 *  Returns undefined when nothing usable came in — keeps the store tidy
 *  (no empty arrays serialized to disk). */
function parsePersonIds(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const ids = raw.filter((x): x is string => typeof x === 'string' && x.length > 0);
  return ids.length > 0 ? Array.from(new Set(ids)) : undefined;
}

/** Trim + dedupe a client-supplied list of free-form tags. Mirrors
 *  parsePersonIds — undefined when nothing usable came in. */
function parseTags(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const tags = raw
    .filter((x): x is string => typeof x === 'string')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  return tags.length > 0 ? Array.from(new Set(tags)) : undefined;
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
// Media (video/audio) detection — magic bytes first, filename extension as a
// tiebreaker/fallback. Backs the /video ingest path; PDFs go through /upload.
// ---------------------------------------------------------------------------

const MEDIA_EXT_TO_TYPE: Record<string, ResearchMediaType> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  weba: 'audio/webm', // audio-only WebM
};

function extOf(filename: string | null): string {
  if (!filename) return '';
  const m = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

/**
 * Identify an uploaded video/audio file from its leading bytes, falling back to
 * the filename extension when the container is ambiguous (e.g. an ISO-BMFF
 * `ftyp` box that's an .m4a rather than .mp4). Returns the stored mediaType and
 * the on-disk extension, or null when nothing recognizable matches.
 */
export function detectMediaType(
  buf: Buffer,
  filename: string | null
): { mediaType: ResearchMediaType; extension: string } | null {
  const ext = extOf(filename);

  // ISO base media (MP4/MOV/M4A): bytes 4-7 are "ftyp".
  if (
    buf.length >= 12 &&
    buf[4] === 0x66 &&
    buf[5] === 0x74 &&
    buf[6] === 0x79 &&
    buf[7] === 0x70
  ) {
    const brand = buf.toString('ascii', 8, 12).trim().toLowerCase();
    if (brand === 'qt') return { mediaType: 'video/quicktime', extension: ext || 'mov' };
    if (brand.startsWith('m4a')) return { mediaType: 'audio/mp4', extension: ext || 'm4a' };
    // Ambiguous brand — trust an audio/quicktime extension when present.
    if (ext === 'm4a') return { mediaType: 'audio/mp4', extension: 'm4a' };
    if (ext === 'mov') return { mediaType: 'video/quicktime', extension: 'mov' };
    return { mediaType: 'video/mp4', extension: ext || 'mp4' };
  }

  // Matroska / WebM: EBML header 1A 45 DF A3; DocType distinguishes them.
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    const head = buf.toString('latin1', 0, Math.min(buf.length, 64));
    if (head.includes('webm')) return { mediaType: 'video/webm', extension: ext || 'webm' };
    return { mediaType: 'video/x-matroska', extension: ext || 'mkv' };
  }

  // MP3: ID3 tag ("ID3") or MPEG frame sync (0xFF 0xEx/0xFx).
  if (
    (buf.length >= 3 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) ||
    (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)
  ) {
    return { mediaType: 'audio/mpeg', extension: ext || 'mp3' };
  }

  // WAV: "RIFF"…."WAVE".
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x41 &&
    buf[10] === 0x56 &&
    buf[11] === 0x45
  ) {
    return { mediaType: 'audio/wav', extension: ext || 'wav' };
  }

  // Last resort: trust a known media extension even when magic didn't match
  // (some containers carry leading junk or unusual brands).
  if (ext && MEDIA_EXT_TO_TYPE[ext]) {
    return { mediaType: MEDIA_EXT_TO_TYPE[ext], extension: ext };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Entry creation — shared file-write + store-save path for every ingest
// route (`/upload`, `/text`, `/youtube`). Keeping it in one place means
// every ingest path lands in the store the same way, which matters because
// the store is the source of truth read by /api/research, /api/research/:id,
// and the upcoming Tickers aggregate view.
// ---------------------------------------------------------------------------

async function createResearchEntry(params: {
  /** File bytes (PDF) or string content (text). */
  content: Buffer | string;
  /** File extension on disk. Drives the stored filename, not the mediaType.
   *  Free-form so media uploads keep their original ext (mp4, mov, m4a, …). */
  extension: string;
  mediaType: ResearchEntry['mediaType'];
  /** Which tab this entry belongs to — drives where it surfaces. */
  domain: ResearchDomain;
  filename: string | null;
  text: string | null;
  pageCount: number | null;
  extractedAt: string | null;
  extractorVersion: string | null;
  extractError: string | null;
  title?: string;
  author?: string;
  publisher?: string;
  reportDate?: string;
  sourceUrl?: string;
  /** Already normalized — callers normalize at the API boundary. */
  tickers?: string[];
  /** Already trimmed/deduped — callers parse at the API boundary. */
  tags?: string[];
  /** Already parsed/deduped — callers parse at the API boundary. */
  linkedPersonIds?: string[];
}): Promise<ResearchEntry> {
  const id = newEntryId();
  await ensureDir(RESEARCH_DATA_DIR);
  const absPath = path.join(RESEARCH_DATA_DIR, `${id}.${params.extension}`);
  const relPath = path.relative(DATA_DIR, absPath);
  await fs.writeFile(absPath, params.content);

  const now = new Date().toISOString();
  const entry: ResearchEntry = {
    id,
    domain: params.domain,
    filename: params.filename,
    filePath: relPath,
    mediaType: params.mediaType,
    uploadedAt: now,
    text: params.text,
    pageCount: params.pageCount,
    extractedAt: params.extractedAt,
    extractorVersion: params.extractorVersion,
    extractError: params.extractError,
    title: params.title,
    author: params.author,
    publisher: params.publisher,
    reportDate: params.reportDate,
    sourceUrl: params.sourceUrl,
    // Only persist optional collection fields when non-empty — keeps the
    // store JSON tidy (no empty arrays everywhere).
    tickers: params.tickers && params.tickers.length > 0 ? params.tickers : undefined,
    tags: params.tags && params.tags.length > 0 ? params.tags : undefined,
    linkedPersonIds:
      params.linkedPersonIds && params.linkedPersonIds.length > 0
        ? params.linkedPersonIds
        : undefined,
    lastUpdated: now,
  };

  const store = await loadStore();
  store.entries[id] = entry;
  await saveStore(store);
  return entry;
}

// ---------------------------------------------------------------------------
// Background transcription — video/audio entries are created immediately (file
// on disk, text=null, status 'pending'), then transcribed off the request
// path. State lives on the entry itself, so the client just polls
// GET /api/research/:id and a crash leaves a durable record for boot recovery.
// Parakeet is a single box and ffmpeg is heavy on the NAS, so we run at most
// one transcription at a time (single-flight).
// ---------------------------------------------------------------------------

let transcribeBusy = false;

/** Whether a transcription job currently holds the single-flight slot. */
export function isTranscribeBusy(): boolean {
  return transcribeBusy;
}

/** Merge a patch onto an entry + bump lastUpdated, atomically. No-op if the
 *  entry was deleted while a job was running. */
async function setTranscribeStatus(id: string, patch: Partial<ResearchEntry>): Promise<void> {
  const store = await loadStore();
  const entry = store.entries[id];
  if (!entry) return;
  Object.assign(entry, patch, { lastUpdated: new Date().toISOString() });
  await saveStore(store);
}

/** Run extraction + transcription for one entry in the background. Never throws
 *  — every failure is recorded on the entry. The media file is left on disk
 *  regardless, so a failed transcription can be retried via re-transcribe. */
async function runTranscriptionJob(id: string): Promise<void> {
  const jobMs = log.timer();
  try {
    await setTranscribeStatus(id, { transcribeStatus: 'running' });
    const store = await loadStore();
    const entry = store.entries[id];
    if (!entry) return; // deleted mid-flight
    const abs = path.join(DATA_DIR, entry.filePath);

    const { text, durationSec } = await transcribeMediaFile(abs);
    await setTranscribeStatus(id, {
      transcribeStatus: 'done',
      text,
      durationSec: durationSec ?? undefined,
      extractedAt: new Date().toISOString(),
      extractorVersion: MEDIA_TRANSCRIBE_EXTRACTOR_VERSION,
      transcribeError: undefined,
      extractError: null,
    });
    log.info(`Transcription done: id=${id} chars=${text.length} in ${jobMs()}ms`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`Transcription failed: id=${id}: ${msg}`);
    // Mirror into extractError so the existing "extraction failed" badge shows.
    await setTranscribeStatus(id, {
      transcribeStatus: 'error',
      transcribeError: msg,
      extractError: msg,
    });
  } finally {
    transcribeBusy = false;
  }
}

/**
 * On boot, flip any transcription left mid-flight by a restart from
 * pending/running → error so it doesn't appear stuck forever. The media file is
 * still on disk, so the user can retry with re-transcribe. Called once from the
 * server boot block.
 */
export async function recoverStaleTranscriptions(): Promise<void> {
  const store = await loadStore();
  let changed = 0;
  const now = new Date().toISOString();
  for (const entry of Object.values(store.entries)) {
    if (entry.transcribeStatus === 'pending' || entry.transcribeStatus === 'running') {
      entry.transcribeStatus = 'error';
      entry.transcribeError =
        'Transcription was interrupted by a server restart. Use Re-transcribe to retry.';
      entry.extractError = entry.transcribeError;
      entry.lastUpdated = now;
      changed++;
    }
  }
  if (changed > 0) {
    await saveStore(store);
    log.warn(`Recovered ${changed} stale transcription(s) → error on boot`);
  }
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
    // Domain comes through the query string here — the request body is
    // the raw PDF bytes, so there's no JSON envelope to read from.
    const domain = parseDomain(url.searchParams.get('domain'));
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

    // Extract text — best-effort, surfacing errors back into the entry.
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
    }

    const entry = await createResearchEntry({
      content: raw,
      extension: 'pdf',
      mediaType: 'application/pdf',
      domain,
      filename,
      text,
      pageCount,
      extractedAt,
      extractorVersion: extractedAt ? RESEARCH_EXTRACTOR_VERSION : null,
      extractError,
      title: titleOverride ?? inferredTitle,
    });
    if (extractError) {
      log.error(`Text extraction failed for research ${entry.id}:`, extractError);
    }
    log.info(
      `Research upload: id=${entry.id} pages=${pageCount ?? '?'} title="${entry.title ?? '?'}"`
    );
    return jsonResponse({ entry });
  }

  // POST /api/research/text — ingest pasted text (transcripts, articles, notes).
  // No file-format guard and no extraction step: the request body IS the text.
  // Stored as data/research/<id>.txt so it's served + deleted like any entry.
  // Matched before the per-entry routes below so "/text" isn't read as an id.
  if (sub === '/text' && req.method === 'POST') {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

    // Keep only non-empty string fields; ignore anything malformed.
    const str = (v: unknown): string | undefined => {
      if (typeof v !== 'string') return undefined;
      const t = v.trim();
      return t === '' ? undefined : t;
    };

    const text = body && typeof body.text === 'string' ? body.text : '';
    if (text.trim() === '') {
      return jsonResponse({ error: 'A non-empty "text" field is required' }, 400);
    }

    // Fall back to the first non-empty line as a title, mirroring PDF uploads,
    // so a row never displays a raw id when no title was supplied.
    const firstNonEmptyLine = text
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0);
    const inferredTitle =
      firstNonEmptyLine && firstNonEmptyLine.length > 120
        ? firstNonEmptyLine.slice(0, 119).trimEnd() + '…'
        : firstNonEmptyLine;

    const entry = await createResearchEntry({
      content: text,
      extension: 'txt',
      mediaType: 'text/plain',
      domain: parseDomain(body?.domain),
      filename: str(body?.filename) ?? null,
      // The body is already plain text — record it as available "now" so the
      // UI shows it immediately and never offers a (meaningless) re-extract.
      // There is no extractor here, hence a null extractorVersion.
      text,
      pageCount: null,
      extractedAt: new Date().toISOString(),
      extractorVersion: null,
      extractError: null,
      title: str(body?.title) ?? inferredTitle,
      author: str(body?.author),
      publisher: str(body?.publisher),
      reportDate: str(body?.reportDate),
      sourceUrl: str(body?.sourceUrl),
      tickers: normalizeTickers(body?.tickers),
      tags: parseTags(body?.tags),
      linkedPersonIds: parsePersonIds(body?.linkedPersonIds),
    });

    log.info(
      `Research text ingest: id=${entry.id} chars=${text.length} title="${entry.title ?? '?'}"`
    );
    return jsonResponse({ entry });
  }

  // POST /api/research/youtube — fetch a YouTube video's captions +
  // metadata via yt-dlp (see ../parsers/youtube-transcript.ts) and
  // create a text/plain entry through the shared helper. Same store,
  // same shape — just a different ingest source.
  // Matched before the per-entry routes below so "/youtube" isn't read
  // as an id.
  if (sub === '/youtube' && req.method === 'POST') {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const url = body && typeof body.url === 'string' ? body.url.trim() : '';
    if (!url) {
      return jsonResponse({ error: 'A "url" field is required' }, 400);
    }
    if (!extractVideoId(url)) {
      return jsonResponse({ error: 'Not a recognized YouTube URL' }, 400);
    }

    let result;
    try {
      result = await fetchYouTubeTranscript(url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`YouTube ingest failed for ${url}: ${msg}`);
      return jsonResponse({ error: msg }, 502);
    }

    // Provenance header keeps the stored text self-documenting — mirrors
    // what the manual yt-dlp pipeline produced when we filed Cowen Part 1.
    const header =
      `[YouTube auto-captions via yt-dlp, cleaned — channel: ${result.channel}` +
      (result.uploadDate ? `, published ${result.uploadDate}` : '') +
      `]\n\n`;
    const text = header + result.text;

    const entry = await createResearchEntry({
      content: text,
      extension: 'txt',
      mediaType: 'text/plain',
      domain: parseDomain(body?.domain),
      filename: null,
      text,
      pageCount: null,
      extractedAt: new Date().toISOString(),
      extractorVersion: YOUTUBE_EXTRACTOR_VERSION,
      extractError: null,
      title: result.title,
      publisher: result.channel,
      reportDate: result.uploadDate ?? undefined,
      sourceUrl: result.url,
      tickers: normalizeTickers(body?.tickers),
      tags: parseTags(body?.tags),
      linkedPersonIds: parsePersonIds(body?.linkedPersonIds),
    });

    log.info(
      `Research YouTube ingest: id=${entry.id} videoId=${result.videoId} ` +
        `segments=${result.segmentCount} title="${entry.title ?? '?'}"`
    );
    return jsonResponse({ entry });
  }

  // POST /api/research/video — upload a video/audio file, keep it as playable
  // media, and transcribe it in the background (ffmpeg → Parakeet). Mirrors
  // /upload's raw-bytes shape; metadata rides the query string. Matched before
  // the per-entry routes below so "/video" isn't read as an id.
  if (sub === '/video' && req.method === 'POST') {
    const filename = url.searchParams.get('filename');
    const titleOverride = url.searchParams.get('title');
    const domain = parseDomain(url.searchParams.get('domain'));
    const raw = Buffer.from(await req.arrayBuffer());
    if (raw.length === 0) {
      return jsonResponse({ error: 'Empty upload' }, 400);
    }

    const detected = detectMediaType(raw, filename);
    if (!detected) {
      return jsonResponse(
        {
          error:
            'Unsupported media. Allowed: mp4, m4v, mov, mkv, webm (video); mp3, m4a, wav, weba (audio).',
        },
        400
      );
    }

    // Single-flight: refuse a second job while one is running (Parakeet is one
    // box; ffmpeg is heavy on the NAS). Checked before we write anything.
    if (transcribeBusy) {
      return jsonResponse(
        { error: 'A transcription is already in progress. Try again once it finishes.' },
        429
      );
    }
    // Reserve the slot before the file write so two near-simultaneous uploads
    // can't both pass the check; release it if creation fails.
    transcribeBusy = true;
    let entry: ResearchEntry;
    try {
      entry = await createResearchEntry({
        content: raw,
        extension: detected.extension,
        mediaType: detected.mediaType,
        domain,
        filename,
        text: null, // filled in by the background job
        pageCount: null,
        extractedAt: null,
        extractorVersion: null,
        extractError: null,
        title: titleOverride ?? filename ?? undefined,
      });
    } catch (err) {
      transcribeBusy = false;
      throw err;
    }

    // Persist 'pending' before firing the job so a crash in the gap is still
    // caught by boot recovery, then fire-and-forget (client polls GET /:id).
    // Best-effort: even if this write fails, the job runs and sets its own
    // state, releasing the single-flight slot in its finally.
    await setTranscribeStatus(entry.id, { transcribeStatus: 'pending' }).catch(() => {});
    void runTranscriptionJob(entry.id);

    log.info(
      `Research media upload: id=${entry.id} type=${detected.mediaType} bytes=${raw.length} ` +
        `domain=${domain}`
    );
    return jsonResponse({ entry: { ...entry, transcribeStatus: 'pending' } });
  }

  // GET /api/research/politics-links — joins politics-domain research claims
  // to the protected Check the Vote feed by ticker/topic. The upstream bearer
  // token stays server-side; only derived, source-grounded links are returned.
  if (sub === '/politics-links' && req.method === 'GET') {
    const [store, politics] = await Promise.all([loadStore(), loadPoliticsFeedPayload()]);
    const entries = Object.values(store.entries).filter((entry) => entry.domain === 'politics');
    const links = buildResearchPoliticsLinks({ entries, politics });
    const briefs = buildResearchPoliticsBriefs(links);
    return jsonResponse({ ok: politics.configured && politics.ok, links, briefs });
  }

  // GET /api/research?domain=health — list newest first (by reportDate if
  // set, else upload time). When `domain` is unset (or unknown), returns
  // everything for back-compat with the original Quant-only endpoint; callers
  // that want a single tab's entries should always pass a known ?domain=.
  if (sub === '' && req.method === 'GET') {
    const domainParam = url.searchParams.get('domain');
    const domain = isResearchDomain(domainParam) ? domainParam : undefined;
    return jsonResponse({ entries: await listResearchEntries(domain) });
  }

  // Per-entry subpaths
  const idMatch = sub.match(/^\/([a-z0-9]+)(?:\/(file|re-extract|intelligence|re-transcribe))?$/i);
  if (idMatch) {
    const id = idMatch[1];
    const action = idMatch[2];

    const store = await loadStore();
    const entry = store.entries[id];
    if (!entry) {
      return jsonResponse({ error: `No research entry "${id}"` }, 404);
    }

    // GET /api/research/:id/file — raw bytes, inline so the browser viewer
    // (PDF reader, or plain-text view) handles it.
    if (action === 'file' && req.method === 'GET') {
      const abs = path.join(DATA_DIR, entry.filePath);
      const file = Bun.file(abs);
      if (!(await file.exists())) {
        return jsonResponse({ error: 'File missing on disk' }, 410);
      }
      const contentType =
        entry.mediaType === 'text/plain' ? 'text/plain; charset=utf-8' : entry.mediaType;
      // Hand the BunFile to Response so Bun.serve honours incoming Range
      // requests (206 + Content-Range) — required for <video>/<audio> seeking.
      // The mediaType doubles as the Content-Type for pdf/video/audio.
      return new Response(file, {
        headers: {
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'private, max-age=3600',
          'Content-Disposition': `inline; filename="${entry.filename ?? entry.id}"`,
        },
      });
    }

    // POST /api/research/:id/re-extract — re-run text extraction (PDF only;
    // pasted-text entries store their content directly, nothing to re-extract).
    if (action === 're-extract' && req.method === 'POST') {
      if (entry.mediaType !== 'application/pdf') {
        return jsonResponse(
          {
            error:
              'Re-extract applies to PDF entries only — text entries store their content directly.',
          },
          400
        );
      }
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

    // POST /api/research/:id/re-transcribe — retry background transcription for
    // a video/audio entry (also the recovery path for entries the boot sweep
    // marked 'error'). Media-only; the file must still be on disk.
    if (action === 're-transcribe' && req.method === 'POST') {
      const isMedia = entry.mediaType.startsWith('video/') || entry.mediaType.startsWith('audio/');
      if (!isMedia) {
        return jsonResponse({ error: 'Re-transcribe applies to video/audio entries only.' }, 400);
      }
      const abs = path.join(DATA_DIR, entry.filePath);
      try {
        await fs.access(abs);
      } catch {
        return jsonResponse({ error: 'Media file missing on disk' }, 410);
      }
      if (transcribeBusy) {
        return jsonResponse(
          { error: 'A transcription is already in progress. Try again once it finishes.' },
          429
        );
      }
      transcribeBusy = true;
      // Reset to pending and clear prior errors, then fire-and-forget. The
      // pending write is best-effort (a failure here still lets the job run,
      // which sets its own state and releases the slot in its finally).
      await setTranscribeStatus(id, {
        transcribeStatus: 'pending',
        text: null,
        transcribeError: undefined,
        extractError: null,
      }).catch(() => {});
      void runTranscriptionJob(id);
      return jsonResponse({
        entry: {
          ...entry,
          transcribeStatus: 'pending',
          text: null,
          extractError: null,
          lastUpdated: new Date().toISOString(),
        },
      });
    }

    // POST /api/research/:id/intelligence — extract deterministic summary
    // bullets and source-grounded claims from the stored text. Every derived
    // item carries line/char offsets plus an exact quote, so later politics
    // linking can trace back to the original transcript/PDF line.
    if (action === 'intelligence' && req.method === 'POST') {
      entry.intelligence = buildResearchIntelligence(entry);
      entry.lastUpdated = new Date().toISOString();
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
        sourceUrl: string | null;
        notes: string | null;
        tags: string[] | null;
        tickers: string[] | null;
        linkedPersonIds: string[] | null;
      }>;

      if (body.title !== undefined) entry.title = body.title ?? undefined;
      if (body.author !== undefined) entry.author = body.author ?? undefined;
      if (body.publisher !== undefined) entry.publisher = body.publisher ?? undefined;
      if (body.reportDate !== undefined) entry.reportDate = body.reportDate ?? undefined;
      if (body.sourceUrl !== undefined) entry.sourceUrl = body.sourceUrl ?? undefined;
      if (body.notes !== undefined) entry.notes = body.notes ?? undefined;
      if (body.tags !== undefined) entry.tags = body.tags ?? undefined;
      if (body.tickers !== undefined) {
        const normalized = normalizeTickers(body.tickers);
        entry.tickers = normalized.length > 0 ? normalized : undefined;
      }
      if (body.linkedPersonIds !== undefined) {
        entry.linkedPersonIds = parsePersonIds(body.linkedPersonIds);
      }
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
