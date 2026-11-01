// Shared plumbing for writing a source's read(): window tests that match the
// Newsstand's long-standing rules, and a collector that keeps each part of a
// source independent, so one unreadable store skips its lines instead of the
// whole source.

import { createLogger } from '../logger.js';
import type { ContextRead, ContextRequest, PulledItem, SourceCitation } from './types.js';

const log = createLogger('Context');

export type DateTest = (d?: string | null) => boolean;

/**
 * True when a date or timestamp falls inside the request's window. A bare
 * YYYY-MM-DD counts as the end of that day (local time), so an item dated
 * today is inside a window that opened this morning. Missing or unparseable
 * dates are outside.
 */
export function windowTest(req: Pick<ContextRequest, 'since' | 'until'>): DateTest {
  const since = new Date(req.since).getTime();
  return (d) => {
    if (!d) return false;
    const iso = d.length === 10 ? `${d}T23:59:59` : d;
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t) || t < since) return false;
    return req.until ? d.slice(0, 10) <= req.until : true;
  };
}

/** How the window reads in prose: "this week", "since the last edition", "since 2026-03-08". */
export function windowPhrase(req: Pick<ContextRequest, 'purpose' | 'since'>): string {
  if (req.purpose === 'weekly') return 'this week';
  if (req.purpose === 'daily') return 'since the last edition';
  return `since ${req.since.slice(0, 10)}`;
}

const cleanMessage = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/\s+/g, ' ').trim().slice(0, 240) ||
  'unknown error';

export class ReadCollector {
  lines: string[] = [];
  pulled: PulledItem[] = [];
  citations: SourceCitation[] = [];
  warnings: Array<{ source: string; message: string }> = [];

  /** Run one part of a source; a failure is recorded under `name` and skipped. */
  async part(name: string, fn: () => Promise<void> | void): Promise<void> {
    try {
      await fn();
    } catch (err) {
      const message = cleanMessage(err);
      this.warnings.push({ source: name, message });
      log.warn(`[read] ${name} failed: ${message}`);
    }
  }

  /** Tag a link for citing; returns ' [S#]' to append, or '' for a non-http URL. */
  cite(url: string | undefined | null): string {
    const u = url?.trim();
    if (!u || !/^https?:\/\//i.test(u)) return '';
    const ref = `S${this.citations.length + 1}`;
    this.citations.push({ ref, url: u });
    return ` [${ref}]`;
  }

  result(): ContextRead {
    return {
      lines: this.lines,
      ...(this.pulled.length ? { pulled: this.pulled } : {}),
      ...(this.citations.length ? { citations: this.citations } : {}),
      ...(this.warnings.length ? { warnings: this.warnings } : {}),
    };
  }
}
