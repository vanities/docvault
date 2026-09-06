// Calendar routes — the one global calendar of birthdays, recurring tasks,
// and one-off events. Event definitions live in `.docvault-calendar.json`
// (server/calendar-store.ts); dated occurrences are projected on demand by
// the pure engine in server/calendar-recurrence.ts, so a month grid or a
// "next 60 days" query never depends on materialized rows.
//
// Routes:
//   GET    /api/calendar/events?entity=            — list event definitions
//   POST   /api/calendar/events                    — create an event
//   PUT    /api/calendar/events/:id               — partial update (archive via status)
//   DELETE /api/calendar/events/:id               — hard delete
//   GET    /api/calendar/occurrences?start=&end=&entity=&includeCompleted=
//   POST   /api/calendar/events/:id/complete      — resolve one occurrence
//   POST   /api/calendar/events/:id/uncomplete    — undo a resolution
//
// Chat tools call these same handlers in-process via invokeRoute, so all
// validation lives here and nowhere else.

import { jsonResponse } from '../data.js';
import { readJsonBody } from '../http.js';
import { createLogger } from '../logger.js';
import {
  calendarToday,
  loadCalendarStore,
  saveCalendarStore,
  type CalendarEvent,
  type CalendarEventKind,
  type CalendarRecurrence,
} from '../calendar-store.js';
import {
  addInterval,
  diffDays,
  isYMD,
  nextOccurrence,
  projectOccurrences,
} from '../calendar-recurrence.js';

const log = createLogger('Calendar');

// Widest occurrences window we'll expand (~2 years + slack). Bigger asks are
// almost certainly a client bug, and expansion cost grows linearly.
const MAX_WINDOW_DAYS = 800;
const DEFAULT_WINDOW_DAYS = 60;

const KINDS: CalendarEventKind[] = ['birthday', 'task', 'event'];
// Longest multi-day span we accept. A trip or sabbatical fits comfortably;
// anything longer is a standing state, not a calendar event, and every
// consumer that paints one cell per covered day would pay for it.
const MAX_SPAN_DAYS = 366;
const UNITS = ['day', 'week', 'month', 'year'];

/** Validate a recurrence payload for a given kind. Returns an error string or
 * null. Birthdays carry no explicit recurrence (implicitly yearly). */
function recurrenceError(recurrence: unknown, kind: CalendarEventKind): string | null {
  if (recurrence === null || recurrence === undefined) return null;
  if (kind === 'birthday') return 'Birthdays are implicitly yearly — omit recurrence';
  if (typeof recurrence !== 'object' || Array.isArray(recurrence)) {
    return 'recurrence must be an object or null';
  }
  const r = recurrence as Partial<CalendarRecurrence>;
  if (!Number.isInteger(r.interval) || (r.interval as number) < 1) {
    return 'recurrence.interval must be an integer >= 1';
  }
  if (!UNITS.includes(r.unit as string)) {
    return `recurrence.unit must be one of ${UNITS.join(', ')}`;
  }
  if (r.anchor !== 'fixed' && r.anchor !== 'afterCompletion') {
    return "recurrence.anchor must be 'fixed' or 'afterCompletion'";
  }
  if (r.anchor === 'afterCompletion' && kind !== 'task') {
    return "recurrence.anchor 'afterCompletion' is only valid for tasks";
  }
  return null;
}

/** Validate a multi-day span against the event it belongs to. `endDate` is
 * the INCLUSIVE last day; equal to `date` (or absent) means single-day.
 * Returns an error string or null. */
function spanError(
  endDate: unknown,
  kind: CalendarEventKind,
  date: string,
  recurrence: CalendarRecurrence | null | undefined
): string | null {
  if (endDate === null || endDate === undefined || endDate === '') return null;
  if (typeof endDate !== 'string' || !isYMD(endDate)) {
    return 'endDate must be a valid YYYY-MM-DD';
  }
  if (kind === 'birthday') return 'Birthdays are single-day — omit endDate';
  if (endDate < date) return 'endDate must not precede date';
  if (diffDays(date, endDate) > MAX_SPAN_DAYS) {
    return `A multi-day event may span at most ${MAX_SPAN_DAYS} days`;
  }
  // Every occurrence carries the same span, so an overlong span on a
  // recurring event would have occurrence k still running when k+1 starts.
  if (recurrence && endDate >= addInterval(date, recurrence.interval, recurrence.unit)) {
    return 'A recurring multi-day event must end before its next occurrence begins';
  }
  return null;
}

/** Normalize a validated endDate: a span of zero days is just a single-day
 * event, and storing `endDate === date` would only give consumers a second
 * way to say the same thing. */
function normalizeEndDate(endDate: string | null | undefined, date: string): string | undefined {
  return endDate && endDate > date ? endDate : undefined;
}

interface EventBody {
  kind?: CalendarEventKind;
  title?: string;
  date?: string;
  endDate?: string | null;
  recurrence?: CalendarRecurrence | null;
  birthYear?: number | null;
  entityId?: string | null;
  notes?: string | null;
  status?: 'active' | 'archived';
}

export async function handleCalendarRoutes(
  req: Request,
  url: URL,
  pathname: string
): Promise<Response | null> {
  if (!pathname.startsWith('/api/calendar/')) return null;

  // GET /api/calendar/events
  if (pathname === '/api/calendar/events' && req.method === 'GET') {
    const entity = url.searchParams.get('entity');
    const store = await loadCalendarStore();
    const events = entity ? store.events.filter((e) => e.entityId === entity) : store.events;
    return jsonResponse({ events });
  }

  // POST /api/calendar/events
  if (pathname === '/api/calendar/events' && req.method === 'POST') {
    const body = await readJsonBody<EventBody>(req);
    const { kind, title, date } = body;
    if (!kind || !KINDS.includes(kind)) {
      return jsonResponse({ error: `kind must be one of ${KINDS.join(', ')}` }, 400);
    }
    if (!title || typeof title !== 'string' || !title.trim()) {
      return jsonResponse({ error: 'title is required' }, 400);
    }
    if (!date || !isYMD(date)) {
      return jsonResponse({ error: 'date must be a valid YYYY-MM-DD' }, 400);
    }
    const recErr = recurrenceError(body.recurrence, kind);
    if (recErr) return jsonResponse({ error: recErr }, 400);
    const spanErr = spanError(body.endDate, kind, date, body.recurrence);
    if (spanErr) return jsonResponse({ error: spanErr }, 400);
    if (body.birthYear !== undefined && body.birthYear !== null) {
      if (kind !== 'birthday') {
        return jsonResponse({ error: 'birthYear is only valid for birthdays' }, 400);
      }
      if (!Number.isInteger(body.birthYear) || body.birthYear < 1 || body.birthYear > 9999) {
        return jsonResponse({ error: 'birthYear must be a plausible year' }, 400);
      }
    }

    const now = new Date().toISOString();
    const event: CalendarEvent = {
      id: crypto.randomUUID(),
      kind,
      title: title.trim(),
      date,
      ...(kind !== 'birthday' && normalizeEndDate(body.endDate, date)
        ? { endDate: body.endDate as string }
        : {}),
      recurrence: kind === 'birthday' ? null : (body.recurrence ?? null),
      ...(body.birthYear !== undefined && body.birthYear !== null
        ? { birthYear: body.birthYear }
        : {}),
      ...(body.entityId ? { entityId: body.entityId } : {}),
      ...(body.notes ? { notes: body.notes } : {}),
      status: 'active',
      completions: [],
      createdAt: now,
      updatedAt: now,
    };
    const store = await loadCalendarStore();
    store.events.push(event);
    await saveCalendarStore(store);
    log.info(
      `[create] kind=${kind} id=${event.id} recurring=${event.recurrence !== null} span=${
        event.endDate ? `${diffDays(event.date, event.endDate) + 1}d` : '1d'
      }`
    );
    return jsonResponse({ ok: true, event });
  }

  // GET /api/calendar/occurrences
  if (pathname === '/api/calendar/occurrences' && req.method === 'GET') {
    const today = await calendarToday();
    const start = url.searchParams.get('start') ?? today;
    const end = url.searchParams.get('end') ?? addInterval(today, DEFAULT_WINDOW_DAYS, 'day');
    if (!isYMD(start) || !isYMD(end)) {
      return jsonResponse({ error: 'start and end must be valid YYYY-MM-DD' }, 400);
    }
    if (end < start) return jsonResponse({ error: 'end must not precede start' }, 400);
    if (diffDays(start, end) > MAX_WINDOW_DAYS) {
      return jsonResponse({ error: `window exceeds ${MAX_WINDOW_DAYS} days` }, 400);
    }
    const entity = url.searchParams.get('entity');
    const includeCompleted = url.searchParams.get('includeCompleted') !== 'false';
    const store = await loadCalendarStore();
    const events = entity ? store.events.filter((e) => e.entityId === entity) : store.events;
    let occurrences = projectOccurrences(events, { start, end }, today);
    if (!includeCompleted) occurrences = occurrences.filter((o) => !o.completed);
    return jsonResponse({ occurrences, today });
  }

  // /api/calendar/events/:id[/(complete|uncomplete)]
  const eventMatch = pathname.match(
    /^\/api\/calendar\/events\/([^/]+)(?:\/(complete|uncomplete))?$/
  );
  if (!eventMatch) return null;
  const [, eventId, action] = eventMatch;

  const store = await loadCalendarStore();
  const event = store.events.find((e) => e.id === eventId);

  // PUT /api/calendar/events/:id
  if (!action && req.method === 'PUT') {
    if (!event) return jsonResponse({ error: 'Event not found' }, 404);
    const body = await readJsonBody<EventBody>(req);
    if (body.kind !== undefined && body.kind !== event.kind) {
      return jsonResponse({ error: 'kind cannot be changed' }, 400);
    }
    if (body.title !== undefined) {
      if (typeof body.title !== 'string' || !body.title.trim()) {
        return jsonResponse({ error: 'title must be a non-empty string' }, 400);
      }
      event.title = body.title.trim();
    }
    // date, endDate and recurrence constrain each other, so they are merged
    // and validated as one unit rather than field by field.
    const nextDate = body.date === undefined ? event.date : (body.date ?? '');
    if (!isYMD(nextDate)) {
      return jsonResponse({ error: 'date must be a valid YYYY-MM-DD' }, 400);
    }
    const nextRecurrence = body.recurrence === undefined ? event.recurrence : body.recurrence;
    if (body.recurrence !== undefined) {
      const recErr = recurrenceError(body.recurrence, event.kind);
      if (recErr) return jsonResponse({ error: recErr }, 400);
    }
    const nextEndDate = body.endDate === undefined ? event.endDate : body.endDate;
    const spanErr = spanError(nextEndDate, event.kind, nextDate, nextRecurrence);
    if (spanErr) return jsonResponse({ error: spanErr }, 400);
    event.date = nextDate;
    event.recurrence = nextRecurrence;
    const normalizedEnd = normalizeEndDate(nextEndDate, nextDate);
    if (normalizedEnd) event.endDate = normalizedEnd;
    else delete event.endDate;
    if (body.birthYear !== undefined) {
      if (body.birthYear === null) {
        delete event.birthYear;
      } else if (
        event.kind !== 'birthday' ||
        !Number.isInteger(body.birthYear) ||
        body.birthYear < 1 ||
        body.birthYear > 9999
      ) {
        return jsonResponse({ error: 'birthYear must be a plausible year on a birthday' }, 400);
      } else {
        event.birthYear = body.birthYear;
      }
    }
    if (body.entityId !== undefined) {
      if (body.entityId === null || body.entityId === '') delete event.entityId;
      else event.entityId = body.entityId;
    }
    if (body.notes !== undefined) {
      if (body.notes === null || body.notes === '') delete event.notes;
      else event.notes = body.notes;
    }
    if (body.status !== undefined) {
      if (body.status !== 'active' && body.status !== 'archived') {
        return jsonResponse({ error: "status must be 'active' or 'archived'" }, 400);
      }
      event.status = body.status;
    }
    event.updatedAt = new Date().toISOString();
    await saveCalendarStore(store);
    return jsonResponse({ ok: true, event });
  }

  // DELETE /api/calendar/events/:id
  if (!action && req.method === 'DELETE') {
    if (!event) return jsonResponse({ error: 'Event not found' }, 404);
    store.events = store.events.filter((e) => e.id !== eventId);
    await saveCalendarStore(store);
    log.info(`[delete] id=${eventId}`);
    return jsonResponse({ ok: true });
  }

  // POST /api/calendar/events/:id/complete
  if (action === 'complete' && req.method === 'POST') {
    if (!event) return jsonResponse({ error: 'Event not found' }, 404);
    if (event.kind !== 'task') {
      return jsonResponse({ error: 'Only tasks can be completed' }, 400);
    }
    const body = await readJsonBody<{
      occurrenceDate?: string;
      completedOn?: string;
      skipped?: boolean;
      notes?: string;
    }>(req);
    const today = await calendarToday();
    const { occurrenceDate } = body;
    if (!occurrenceDate || !isYMD(occurrenceDate)) {
      return jsonResponse({ error: 'occurrenceDate must be a valid YYYY-MM-DD' }, 400);
    }
    const completedOn = body.completedOn ?? today;
    if (!isYMD(completedOn)) {
      return jsonResponse({ error: 'completedOn must be a valid YYYY-MM-DD' }, 400);
    }
    if (event.completions.some((c) => c.occurrenceDate === occurrenceDate)) {
      return jsonResponse({ error: 'Occurrence already completed' }, 400);
    }
    event.completions.push({
      occurrenceDate,
      completedOn,
      completedAt: new Date().toISOString(),
      ...(body.skipped ? { skipped: true } : {}),
      ...(body.notes ? { notes: body.notes } : {}),
    });
    event.updatedAt = new Date().toISOString();
    await saveCalendarStore(store);
    const next = nextOccurrence(event, today);
    log.info(
      `[complete] id=${eventId} occurrence=${occurrenceDate} skipped=${body.skipped === true} next=${next?.date ?? 'none'}`
    );
    return jsonResponse({ ok: true, event, next });
  }

  // POST /api/calendar/events/:id/uncomplete
  if (action === 'uncomplete' && req.method === 'POST') {
    if (!event) return jsonResponse({ error: 'Event not found' }, 404);
    const body = await readJsonBody<{ occurrenceDate?: string }>(req);
    const { occurrenceDate } = body;
    if (!occurrenceDate) {
      return jsonResponse({ error: 'occurrenceDate is required' }, 400);
    }
    const before = event.completions.length;
    event.completions = event.completions.filter((c) => c.occurrenceDate !== occurrenceDate);
    if (event.completions.length === before) {
      return jsonResponse({ error: 'No completion for that occurrence' }, 404);
    }
    event.updatedAt = new Date().toISOString();
    await saveCalendarStore(store);
    return jsonResponse({ ok: true, event });
  }

  return null;
}
