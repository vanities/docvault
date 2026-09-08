// Sent-mail log — an append-only record of every outbound email attempt.
//
// The server log line in email.ts is redacted and rolls over; this store is
// the durable, queryable answer to "what did DocVault email, to whom, when,
// and did it work?". Every sendEmail() call appends one entry — successes AND
// failures — so a missing edition or an unpaid invoice can be traced back to
// the exact send. Addresses are stored in the clear on purpose: the whole
// point is to see who received what. DATA_DIR is private and rides along with
// the encrypted backup bundle.
//
// Bounded at MAX_ENTRIES (newest kept) so the file can't grow forever.

import { promises as fs } from 'fs';
import path from 'path';
import { DATA_DIR } from './data.js';
import { createLogger } from './logger.js';

const log = createLogger('EmailLog');

export const EMAIL_LOG_PATH = path.join(DATA_DIR, '.docvault-email-log.json');
export const MAX_ENTRIES = 500;

/** Why an email went out. Drives which configured CC applies (see email.ts)
 *  and lets the log be filtered by audience. */
export type EmailPurpose = 'news' | 'client' | 'test';

export const EMAIL_PURPOSES: readonly EmailPurpose[] = ['news', 'client', 'test'] as const;

export function isEmailPurpose(v: unknown): v is EmailPurpose {
  return typeof v === 'string' && (EMAIL_PURPOSES as readonly string[]).includes(v);
}

export interface EmailLogAttachment {
  filename: string;
  /** Decoded size in bytes (derived from the base64 payload length). */
  bytes: number;
}

export interface EmailLogEntry {
  id: string;
  /** ISO timestamp of the send attempt. */
  at: string;
  purpose: EmailPurpose;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  attachments: EmailLogAttachment[];
  ok: boolean;
  /** Resend's message id on success. */
  providerId?: string;
  error?: string;
  elapsedMs: number;
  /** Caller-supplied context: an edition id, `invoice:<id>`, a report week. */
  ref?: string;
}

interface EmailLogFile {
  entries: EmailLogEntry[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === 'string');
}

/** Shape guard for one stored entry. Lenient on optional fields; strict on
 *  the ones the UI renders so a corrupt row can't crash the panel. */
export function isEmailLogEntry(value: unknown): value is EmailLogEntry {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.at === 'string' &&
    isEmailPurpose(value.purpose) &&
    typeof value.from === 'string' &&
    isStringArray(value.to) &&
    isStringArray(value.cc) &&
    typeof value.subject === 'string' &&
    Array.isArray(value.attachments) &&
    typeof value.ok === 'boolean' &&
    typeof value.elapsedMs === 'number'
  );
}

async function readFile(): Promise<EmailLogFile> {
  try {
    const raw = await fs.readFile(EMAIL_LOG_PATH, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (isPlainObject(parsed) && Array.isArray(parsed.entries)) {
      const entries = parsed.entries.filter(isEmailLogEntry);
      if (entries.length !== parsed.entries.length) {
        log.warn(
          `[load] dropped ${parsed.entries.length - entries.length} malformed entr(y/ies) from ${EMAIL_LOG_PATH}`
        );
      }
      return { entries };
    }
    log.warn('[load] stored email log malformed — starting empty');
  } catch {
    // Missing file (first send) or unreadable JSON — start empty either way.
  }
  return { entries: [] };
}

async function writeFile(data: EmailLogFile): Promise<void> {
  // Write-then-rename so a crash mid-write can't truncate the log.
  const tmpPath = `${EMAIL_LOG_PATH}.tmp`;
  await fs.mkdir(path.dirname(EMAIL_LOG_PATH), { recursive: true });
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2));
  await fs.rename(tmpPath, EMAIL_LOG_PATH);
}

// Appends are serialized through this chain: the scheduler can fire the
// Newsstand edition and the weekly report in the same tick, and two
// read-modify-write cycles interleaving would lose one of them.
let writeChain: Promise<void> = Promise.resolve();

/** Append one entry (newest last on disk; readEmailLog returns newest first).
 *  Best-effort: never throws — a logging failure must not fail the send. */
export async function appendEmailLog(entry: EmailLogEntry): Promise<void> {
  const run = async () => {
    const t0 = performance.now();
    const data = await readFile();
    data.entries.push(entry);
    if (data.entries.length > MAX_ENTRIES) {
      data.entries = data.entries.slice(data.entries.length - MAX_ENTRIES);
    }
    await writeFile(data);
    log.debug(
      `[append] id=${entry.id} purpose=${entry.purpose} ok=${entry.ok} total=${data.entries.length} in ${(performance.now() - t0).toFixed(1)}ms`
    );
  };
  writeChain = writeChain.then(run, run).catch((err) => {
    log.error(
      `[append] failed id=${entry.id}: ${err instanceof Error ? err.message : String(err)}`
    );
  });
  return writeChain;
}

export interface ReadEmailLogOptions {
  /** Max entries to return (default 100, capped at MAX_ENTRIES). */
  limit?: number;
  /** Only entries with this purpose. */
  purpose?: EmailPurpose;
}

/** Newest-first slice of the log. */
export async function readEmailLog(opts: ReadEmailLogOptions = {}): Promise<EmailLogEntry[]> {
  const limit = Math.max(1, Math.min(MAX_ENTRIES, Math.floor(opts.limit ?? 100)));
  const { entries } = await readFile();
  const filtered = opts.purpose ? entries.filter((e) => e.purpose === opts.purpose) : entries;
  return filtered.slice(-limit).reverse();
}
