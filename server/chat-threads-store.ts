// Chat thread persistence — one file per thread plus a lightweight index.
//
// History is kept in FULL: nothing is pruned server-side. That is what rules
// out the old single-blob layout, where the client re-PUT every transcript it
// held 1.5s after each change. With unbounded history that means multi-megabyte
// writes per keystroke burst, and a boot that downloads every conversation the
// user has ever had before the first message renders.
//
// Layout:
//   DATA_DIR/.docvault-chat-threads.json   index — summaries + activeThreadId
//   DATA_DIR/chat-threads/<id>.json        one full transcript per thread
//
// The client hydrates the index (cheap) plus the active transcript, writes only
// the thread being edited, and lazy-loads the others on demand. Search scans the
// transcript files here so the browser never has to hold the archive.
//
// Transcripts stay `unknown[]`: only ChatView interprets message shape. The one
// exception is the deliberately defensive `extractText` below, which the index
// preview and the search endpoint need.

import { promises as fs } from 'fs';
import path from 'path';
import { DATA_DIR } from './data.js';
import { createLogger } from './logger.js';

const log = createLogger('ChatThreads');

export const CHAT_THREADS_PATH = path.join(DATA_DIR, '.docvault-chat-threads.json');
export const CHAT_THREADS_DIR = path.join(DATA_DIR, 'chat-threads');

/** Preview text stored in the index, so the history list needs no transcript reads. */
const PREVIEW_CHARS = 180;
/** Characters of context returned around each search hit. */
const SNIPPET_CHARS = 160;

export interface ChatThreadStats {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/** Index row — everything the sidebar and history list render, minus the transcript. */
export interface ChatThreadSummary {
  id: string;
  title: string;
  resumeSessionId: string | null;
  stats: ChatThreadStats;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  preview: string;
}

export interface ChatThread extends ChatThreadSummary {
  messages: unknown[];
}

export interface ChatThreadsIndex {
  threads: Record<string, ChatThreadSummary>;
  activeThreadId: string | null;
}

/** Legacy single-blob shape, still accepted on the bulk PUT for older tabs. */
export interface ChatThreadsState {
  threads: Record<string, unknown>;
  activeThreadId: string | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isChatThreadsState(value: unknown): value is ChatThreadsState {
  if (!isPlainObject(value)) return false;
  if (!isPlainObject(value.threads)) return false;
  return value.activeThreadId === null || typeof value.activeThreadId === 'string';
}

/**
 * Thread ids become filenames, so they are validated rather than escaped.
 * Client ids are uuid v4 (or a base36 fallback on non-secure origins); anything
 * outside this character set is rejected instead of sanitized, so a crafted id
 * can never walk out of CHAT_THREADS_DIR.
 */
export function isValidThreadId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id);
}

function threadPath(id: string): string {
  return path.join(CHAT_THREADS_DIR, `${id}.json`);
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/**
 * Pull readable text out of an opaque persisted message array.
 *
 * Deliberately defensive: message shape belongs to ChatView and has already
 * changed once (assistant messages moved from a flat string to `blocks`), so
 * every access is guarded and anything unrecognized contributes nothing rather
 * than throwing. Used for the index preview and for search matching.
 */
export function extractText(messages: unknown[]): string {
  const parts: string[] = [];
  for (const message of messages) {
    if (!isPlainObject(message)) continue;
    if (typeof message.content === 'string') {
      parts.push(message.content);
      continue;
    }
    if (Array.isArray(message.blocks)) {
      for (const block of message.blocks) {
        if (isPlainObject(block) && typeof block.text === 'string') parts.push(block.text);
      }
    }
  }
  return parts.join('\n').trim();
}

function summarize(thread: ChatThread): ChatThreadSummary {
  const { messages: _messages, ...summary } = thread;
  return summary;
}

/**
 * Rebuild an index row from stored JSON.
 *
 * Index rows have no `messages` — that is the whole point of the split — so
 * messageCount and preview must be READ from the row rather than derived, or
 * every read of the index would reset them to 0/'' and make each unopened
 * thread look like an empty one that never needs fetching.
 */
function normalizeSummary(id: string, value: unknown): ChatThreadSummary {
  const raw = isPlainObject(value) ? value : {};
  const summary = summarize(normalizeThread(id, raw));
  return {
    ...summary,
    messageCount: Array.isArray(raw.messages) ? raw.messages.length : num(raw.messageCount),
    preview: str(raw.preview) || summary.preview,
  };
}

/** Build a full thread record from loosely-typed input (client PUT or legacy blob). */
function normalizeThread(id: string, value: unknown): ChatThread {
  const raw = isPlainObject(value) ? value : {};
  const messages = Array.isArray(raw.messages) ? raw.messages : [];
  const now = new Date().toISOString();
  const stats = isPlainObject(raw.stats) ? raw.stats : {};
  const text = extractText(messages);
  return {
    id,
    title: str(raw.title) || 'New chat',
    resumeSessionId: typeof raw.resumeSessionId === 'string' ? raw.resumeSessionId : null,
    stats: {
      inputTokens: num(stats.inputTokens),
      outputTokens: num(stats.outputTokens),
      costUsd: num(stats.costUsd),
    },
    createdAt: str(raw.createdAt) || now,
    updatedAt: str(raw.updatedAt) || now,
    messageCount: messages.length,
    preview: text.slice(0, PREVIEW_CHARS),
    messages,
  };
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  // Write-then-rename so a crash mid-write can't truncate a live file.
  const tmpPath = `${filePath}.tmp`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(tmpPath, JSON.stringify(value, null, 2));
  await fs.rename(tmpPath, filePath);
}

// Index reads/writes are serialized: saveThread and deleteThread both
// read-modify-write the same file, and two chats saving at once would otherwise
// interleave and drop one of the updates.
let indexQueue: Promise<unknown> = Promise.resolve();
function withIndexLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = indexQueue.then(fn, fn);
  indexQueue = run.catch(() => {});
  return run;
}

/** Always a FRESH object: callers mutate the result before writing it back. */
function emptyIndex(): ChatThreadsIndex {
  return { threads: {}, activeThreadId: null };
}

async function readIndexFile(): Promise<ChatThreadsIndex> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(CHAT_THREADS_PATH, 'utf-8'));
  } catch {
    // Missing file (first run) or unreadable JSON — start empty either way.
    return emptyIndex();
  }
  if (!isChatThreadsState(parsed)) {
    log.warn('[load] stored chat index malformed — returning empty state');
    return emptyIndex();
  }

  // Legacy single-blob file: rows still carry their transcripts. Split them into
  // per-thread files once, then rewrite this file as a pure index.
  const rows = Object.entries(parsed.threads);
  const legacy = rows.filter(([, t]) => isPlainObject(t) && Array.isArray(t.messages));
  if (legacy.length > 0) {
    const t0 = performance.now();
    log.info(`[migrate] splitting ${legacy.length} legacy thread(s) into per-thread files`);
    const threads: Record<string, ChatThreadSummary> = {};
    for (const [id, value] of rows) {
      if (!isValidThreadId(id)) {
        log.warn(`[migrate] skipping thread with unusable id: ${JSON.stringify(id).slice(0, 80)}`);
        continue;
      }
      const thread = normalizeThread(id, value);
      await writeJsonAtomic(threadPath(id), thread);
      threads[id] = summarize(thread);
    }
    const migrated: ChatThreadsIndex = { threads, activeThreadId: parsed.activeThreadId };
    await writeJsonAtomic(CHAT_THREADS_PATH, migrated);
    log.info(
      `[migrate] done threads=${Object.keys(threads).length} in ${(performance.now() - t0).toFixed(1)}ms`
    );
    return migrated;
  }

  const threads: Record<string, ChatThreadSummary> = {};
  for (const [id, value] of rows) {
    if (!isValidThreadId(id)) continue;
    threads[id] = normalizeSummary(id, value);
  }
  return { threads, activeThreadId: parsed.activeThreadId };
}

export async function loadIndex(): Promise<ChatThreadsIndex> {
  return withIndexLock(readIndexFile);
}

export async function loadThread(id: string): Promise<ChatThread | null> {
  if (!isValidThreadId(id)) return null;
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(threadPath(id), 'utf-8'));
    return normalizeThread(id, parsed);
  } catch {
    return null;
  }
}

/** Upsert one thread: write its transcript, then fold its summary into the index. */
export async function saveThread(id: string, value: unknown): Promise<ChatThread | null> {
  if (!isValidThreadId(id)) return null;
  const t0 = performance.now();
  const thread = normalizeThread(id, value);
  await writeJsonAtomic(threadPath(id), thread);
  await withIndexLock(async () => {
    const index = await readIndexFile();
    index.threads[id] = summarize(thread);
    await writeJsonAtomic(CHAT_THREADS_PATH, index);
  });
  log.debug(
    `[save] thread=${id} messages=${thread.messageCount} in ${(performance.now() - t0).toFixed(1)}ms`
  );
  return thread;
}

export async function deleteThread(id: string): Promise<boolean> {
  if (!isValidThreadId(id)) return false;
  await fs.rm(threadPath(id), { force: true });
  return withIndexLock(async () => {
    const index = await readIndexFile();
    const existed = id in index.threads;
    delete index.threads[id];
    if (index.activeThreadId === id) index.activeThreadId = null;
    await writeJsonAtomic(CHAT_THREADS_PATH, index);
    log.debug(`[delete] thread=${id} existed=${existed}`);
    return existed;
  });
}

export async function setActiveThreadId(id: string | null): Promise<void> {
  if (id !== null && !isValidThreadId(id)) return;
  await withIndexLock(async () => {
    const index = await readIndexFile();
    index.activeThreadId = id;
    await writeJsonAtomic(CHAT_THREADS_PATH, index);
  });
}

/**
 * Bulk import of the legacy whole-state shape.
 *
 * Kept so a browser tab still running pre-split JS can't fail its save, and so
 * a restored backup written in the old format lands correctly. Merges rather
 * than replaces: a bulk PUT carrying a pruned subset of history must never
 * delete the threads it happens not to mention.
 */
export async function importThreadsState(state: ChatThreadsState): Promise<number> {
  let imported = 0;
  for (const [id, value] of Object.entries(state.threads)) {
    if (!isValidThreadId(id)) continue;
    await saveThread(id, value);
    imported += 1;
  }
  if (state.activeThreadId !== undefined) await setActiveThreadId(state.activeThreadId);
  log.info(`[import] merged ${imported} thread(s) from legacy bulk PUT`);
  return imported;
}

export interface ChatSearchHit {
  thread: ChatThreadSummary;
  /** Text around the first match, with the query left intact for client highlighting. */
  snippet: string;
  matchCount: number;
}

export interface ChatSearchOptions {
  query?: string;
  /** Inclusive ISO date (YYYY-MM-DD) bounds against thread updatedAt. */
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

function buildSnippet(text: string, needle: string): { snippet: string; matchCount: number } {
  const haystack = text.toLowerCase();
  const first = haystack.indexOf(needle);
  if (first < 0) return { snippet: text.slice(0, SNIPPET_CHARS), matchCount: 0 };
  let matchCount = 0;
  for (let i = haystack.indexOf(needle); i >= 0; i = haystack.indexOf(needle, i + needle.length)) {
    matchCount += 1;
  }
  const start = Math.max(0, first - Math.floor(SNIPPET_CHARS / 3));
  const snippet = text.slice(start, start + SNIPPET_CHARS);
  return { snippet: (start > 0 ? '…' : '') + snippet.trim() + '…', matchCount };
}

/**
 * Scan transcripts for a query, newest first.
 *
 * A linear scan over the thread files, not an inverted index: at the scale this
 * holds (hundreds of threads) reading them is milliseconds, and an index would
 * be another thing to keep consistent with every write. Date filtering runs off
 * the index first so a narrow range never touches the transcripts at all.
 */
export async function searchThreads(options: ChatSearchOptions = {}): Promise<{
  hits: ChatSearchHit[];
  total: number;
}> {
  const t0 = performance.now();
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const needle = (options.query ?? '').trim().toLowerCase();

  const index = await loadIndex();
  let candidates = Object.values(index.threads).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt)
  );
  if (options.from) candidates = candidates.filter((t) => t.updatedAt >= options.from!);
  // `to` is an inclusive calendar day, so compare against the end of that day.
  if (options.to)
    candidates = candidates.filter((t) => t.updatedAt <= `${options.to}T23:59:59.999Z`);

  if (!needle) {
    const page = candidates.slice(offset, offset + limit);
    log.debug(
      `[search] browse total=${candidates.length} returned=${page.length} in ${(performance.now() - t0).toFixed(1)}ms`
    );
    return {
      hits: page.map((thread) => ({ thread, snippet: thread.preview, matchCount: 0 })),
      total: candidates.length,
    };
  }

  const hits: ChatSearchHit[] = [];
  let scanned = 0;
  for (const summary of candidates) {
    const thread = await loadThread(summary.id);
    if (!thread) continue;
    scanned += 1;
    const text = extractText(thread.messages);
    const inTitle = summary.title.toLowerCase().includes(needle);
    if (!text.toLowerCase().includes(needle) && !inTitle) continue;
    const { snippet, matchCount } = buildSnippet(text, needle);
    hits.push({ thread: summary, snippet: snippet || summary.preview, matchCount });
  }
  log.debug(
    `[search] q=${needle.length}ch scanned=${scanned} hits=${hits.length} in ${(performance.now() - t0).toFixed(1)}ms`
  );
  return { hits: hits.slice(offset, offset + limit), total: hits.length };
}
