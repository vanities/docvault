// Turning a source's dated events into lines a reader can use: the larger
// moves, oldest first, each marked when it falls before the window it was read
// for. Shared by every surface, so chat and the Newsstand describe a transfer
// the same way.

import { addDays, money } from './format.js';
import { ReadCollector } from './request.js';
import type { ContextEvent, ContextRead, ContextRequest, ContextSource } from './types.js';

/** Moves smaller than this are routine spending, reported only as a count. */
export const EVENT_MIN_AMOUNT = 500;
const EVENTS_PER_SOURCE = 25;

/** Days before the window that events still show up: a loan balance edited a
 *  few days before its payment clears belongs with that payment. A direct
 *  query asked for exact dates, so it gets none. */
export function eventLeadInDays(purpose: ContextRequest['purpose']): number {
  return purpose === 'weekly' ? 7 : purpose === 'daily' ? 3 : 0;
}

export function formatContextEvents(
  label: string,
  events: ContextEvent[],
  windowFrom: string,
  opts: { minAmount?: number; max?: number } = {}
): string[] {
  const minAmount = opts.minAmount ?? EVENT_MIN_AMOUNT;
  const max = opts.max ?? EVENTS_PER_SOURCE;
  const big = events.filter((e) => e.amount === undefined || Math.abs(e.amount) >= minAmount);
  const kept =
    big.length > max
      ? [...big]
          .sort(
            (a, b) =>
              Math.abs(b.amount ?? Number.POSITIVE_INFINITY) -
              Math.abs(a.amount ?? Number.POSITIVE_INFINITY)
          )
          .slice(0, max)
      : big;
  const lines = [...kept]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(
      (e) => `${label}, ${e.date}${e.date < windowFrom ? ' (before this period)' : ''}: ${e.text}.`
    );
  const small = events.length - big.length;
  const capped = big.length - kept.length;
  if (small > 0) {
    lines.push(`${label}: ${small} smaller item(s) under ${money(minAmount)} not listed.`);
  }
  if (capped > 0) {
    lines.push(`${label}: ${capped} more item(s) not listed; only the ${max} largest are.`);
  }
  return lines;
}

/** read() for a source whose changes are dated events: its standing picture
 *  when `full`, then its events over the window plus the lead-in. */
export async function readEventSource(
  source: ContextSource,
  req: ContextRequest,
  state?: () => Promise<string[]>
): Promise<ContextRead> {
  const r = new ReadCollector();
  await r.part(`${source.group}/${source.id}`, async () => {
    if (!source.events) throw new Error(`${source.id} has no events()`);
    if (req.full && state) r.lines.push(...(await state()));
    const windowFrom = req.since.slice(0, 10);
    const events = await source.events({
      from: addDays(windowFrom, -eventLeadInDays(req.purpose)),
      to: req.until ?? req.today,
    });
    r.lines.push(...formatContextEvents(source.label, events, windowFrom));
  });
  return r.result();
}
