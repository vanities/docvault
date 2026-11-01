// The two tools that let a model read any context source: list_context to see
// what exists, get_context to read one for a window. Chat (Claude and Codex),
// assignments and owner-aware Deep Research all reach DocVault data this way,
// so a new source is readable everywhere the moment it is registered.

import { calendarToday } from '../calendar-store.js';
import { createLogger } from '../logger.js';
import { addDays } from './format.js';
import { CONTEXT_SOURCES, getContextSource } from './registry.js';

const log = createLogger('Context');

export const CONTEXT_TOOL_NAMES = ['list_context', 'get_context'] as const;

/** Keeps one read inside what a tool result can carry; research full text is the big one. */
const MAX_RESULT_CHARS = 60_000;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export async function listContext(input: { group?: string }) {
  const sources = CONTEXT_SOURCES.filter((s) => !input.group || s.group === input.group);
  return {
    sources: sources.map((s) => ({
      id: s.id,
      label: s.label,
      group: s.group,
      description: s.description,
    })),
    groups: [...new Set(CONTEXT_SOURCES.map((s) => s.group))],
  };
}

export async function getContext(input: {
  source: string;
  since?: string;
  until?: string;
  full?: boolean;
}) {
  const t0 = Date.now();
  const source = getContextSource(input.source);
  if (!source) {
    throw new Error(`No context source "${input.source}". Call list_context for the ids.`);
  }
  for (const [name, value] of [
    ['since', input.since],
    ['until', input.until],
  ] as const) {
    if (value !== undefined && !YMD.test(value)) throw new Error(`${name} must be YYYY-MM-DD`);
  }
  const today = await calendarToday();
  const since = input.since ?? addDays(today, -7);
  if (input.until && input.until < since) throw new Error('until is before since');
  const read = await source.read({
    since,
    until: input.until,
    today,
    purpose: 'query',
    full: input.full ?? true,
  });

  const kept: string[] = [];
  let chars = 0;
  for (const line of read.lines) {
    if (chars + line.length > MAX_RESULT_CHARS) break;
    kept.push(line);
    chars += line.length;
  }
  log.info(
    `[tool] get_context source=${source.id} window=${since}..${input.until ?? today} ` +
      `lines=${kept.length}/${read.lines.length} chars=${chars} in ${Date.now() - t0}ms`
  );
  return {
    source: source.id,
    label: source.label,
    window: { since, until: input.until ?? today },
    lines: kept,
    ...(kept.length < read.lines.length
      ? { truncated: `${read.lines.length - kept.length} more line(s) left out; narrow the window` }
      : {}),
    ...(read.citations?.length ? { links: read.citations } : {}),
    ...(read.warnings?.length ? { warnings: read.warnings } : {}),
  };
}
