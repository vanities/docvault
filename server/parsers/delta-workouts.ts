// Delta workout parsing — pure helpers that turn the loose workout data an iOS
// Shortcut (shortcut-v2+) can produce into canonical WorkoutEntry objects.
//
// Two input shapes are supported, both ending at normalizeDeltaWorkouts:
//
//   1. STRUCTURED — `workouts: [{ type, start, end, durationMinutes, ... }]`.
//      Easy to produce from curl / tests / a future richer client.
//
//   2. RAW PARALLEL LISTS — `workoutsRaw: { type, start, end, duration }` where
//      each value is a newline-joined list (one line per workout), index-
//      aligned across the four fields. This is what the generated Shortcut
//      emits: it interpolates a "Find Workouts" result four times (once per
//      property), and Shortcuts joins list items with newlines — the same
//      mechanism the metrics path relies on (`raw: true` + split on '\n').
//
// All functions are pure and have no I/O so they're cheaply unit-testable
// (see delta-workouts.test.ts). Keep them that way.

import type { WorkoutEntry } from './apple-health.js';

/**
 * Coerce a value that may be a number OR a numeric string into a finite
 * number, else undefined. Shortcuts interpolates health values as text, so
 * workout fields arrive as strings ("52.1") just like the `raw: true` metric
 * path — this is the workout-side equivalent of that coercion.
 */
export function toFiniteNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/**
 * Pull a 24-hour "HH:mm:ss" clock time out of whatever date string the
 * Shortcut emitted for a workout's Start/End. Deliberately format-tolerant
 * because we can't control how iOS renders a date inside an interpolated list:
 *
 *   "2026-06-04T08:18:04-05:00"  → "08:18:04"   (ISO)
 *   "2026-06-04 08:18:04 -0500"  → "08:18:04"   (export-style)
 *   "6/4/26, 8:18 AM"            → "08:18:00"   (US locale short)
 *   "Jun 4, 2026 at 8:18:30 PM"  → "20:18:30"   (US locale medium)
 *
 * Returns null when no time is present (e.g. a date-only string), so callers
 * can fall back to a synthetic time rather than fabricating a wrong one.
 */
export function extractClockTime(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  // 12-hour with an explicit AM/PM marker — check first so the meridiem wins.
  const ampm = raw.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp])[Mm]/);
  if (ampm) {
    let h = Number(ampm[1]) % 12;
    if (/[Pp]/.test(ampm[4])) h += 12;
    return `${String(h).padStart(2, '0')}:${ampm[2]}:${ampm[3] ?? '00'}`;
  }
  // 24-hour. No \b anchors — an ISO "T08:18" has no word boundary before "08".
  const h24 = raw.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (h24) {
    return `${h24[1].padStart(2, '0')}:${h24[2]}:${h24[3] ?? '00'}`;
  }
  return null;
}

/**
 * Parse a workout "Duration" string into minutes. Handles the formats iOS is
 * likely to render: "H:MM:SS", "M:SS", "52 min", or a bare number (assumed
 * minutes). Returns undefined when nothing usable is present, so the caller
 * can fall back to computing duration from start/end.
 */
export function parseDurationMinutes(s: string): number | undefined {
  if (typeof s !== 'string' || !s.trim()) return undefined;
  const hms = s.match(/^(\d+):(\d{2}):(\d{2})$/);
  if (hms) return Number(hms[1]) * 60 + Number(hms[2]) + Number(hms[3]) / 60;
  const ms = s.match(/^(\d+):(\d{2})$/);
  if (ms) return Number(ms[1]) + Number(ms[2]) / 60;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Split a newline-joined Shortcut list into trimmed, non-empty lines.
 */
function splitLines(v: unknown): string[] {
  if (typeof v !== 'string') return [];
  return v
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Convert the `workoutsRaw` parallel-list shape into flat per-workout objects
 * ready for normalizeDeltaWorkouts. Each workout's calendar date is ANCHORED
 * to the delta's `payloadDate` (clean YYYY-MM-DD that the Shortcut already
 * formats reliably) — we only trust the Shortcut's per-workout strings for the
 * clock TIME, never the date, because list-item dates can arrive locale-
 * formatted and unparseable. The daily sync covers a single day, so anchoring
 * every session to that day is correct.
 *
 * Duration prefers the Shortcut-provided value; if absent/garbage it's derived
 * from start→end. A workout with no parseable time gets a synthetic, per-index
 * minute so two same-type sessions on one day keep distinct dedupe keys.
 */
export function workoutsRawToObjects(
  raw: unknown,
  payloadDate: string
): Array<Record<string, unknown>> {
  if (!raw || typeof raw !== 'object') return [];
  const r = raw as Record<string, unknown>;
  const types = splitLines(r.type);
  if (types.length === 0) return [];
  const starts = splitLines(r.start);
  const ends = splitLines(r.end);
  const durations = splitLines(r.duration);

  const out: Array<Record<string, unknown>> = [];
  for (let i = 0; i < types.length; i++) {
    const startTime =
      extractClockTime(starts[i] ?? '') ?? `00:${String(i % 60).padStart(2, '0')}:00`;
    const endTime = extractClockTime(ends[i] ?? '');
    const start = `${payloadDate}T${startTime}`;
    const end = endTime ? `${payloadDate}T${endTime}` : start;

    let durationMinutes = parseDurationMinutes(durations[i] ?? '');
    if (durationMinutes === undefined && endTime) {
      const diff = (Date.parse(end) - Date.parse(start)) / 60_000;
      if (Number.isFinite(diff) && diff > 0) durationMinutes = Math.round(diff * 10) / 10;
    }

    out.push({
      type: types[i],
      start,
      end,
      ...(durationMinutes !== undefined ? { durationMinutes } : {}),
    });
  }
  return out;
}

/**
 * Normalize loose workout objects (from either ingest shape) into canonical
 * WorkoutEntry objects the snapshot computer expects. Flat per-session fields —
 * type / start / end / durationMinutes plus optional distance / energy / avgHR,
 * all possibly strings — are coerced and folded into the `statistics` map keyed
 * exactly as the bulk XML parser keys them, so overlayDeltas +
 * computeWorkoutsSnapshot treat delta workouts and export workouts identically.
 *
 * Defensive by design: a non-array input yields [], and any entry missing a
 * usable `type` or a date-prefixed `start` is dropped (counted in `dropped` for
 * the caller to log). A malformed payload therefore degrades to "metrics-only
 * ingest" instead of failing the POST — the daily metrics sync can never be
 * broken by a bad workout entry.
 */
export function normalizeDeltaWorkouts(raw: unknown): {
  workouts: WorkoutEntry[];
  dropped: number;
} {
  if (!Array.isArray(raw)) return { workouts: [], dropped: 0 };
  const out: WorkoutEntry[] = [];
  let dropped = 0;
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      dropped++;
      continue;
    }
    const w = item as Record<string, unknown>;

    // type — required. Strip the HKWorkoutActivityType prefix if the Shortcut
    // sent the raw enum identifier rather than a friendly label ("Running").
    const type = (typeof w.type === 'string' ? w.type.trim() : '').replace(
      /^HKWorkoutActivityType/,
      ''
    );
    // start — required, and must begin with YYYY-MM-DD so the snapshot's
    // date-slicing (w.start.slice(0,10)) and lexical sort behave.
    const start = typeof w.start === 'string' ? w.start.trim() : '';
    if (!type || !/^\d{4}-\d{2}-\d{2}/.test(start)) {
      dropped++;
      continue;
    }
    const end = typeof w.end === 'string' && w.end.trim() ? w.end.trim() : start;

    // statistics — accept a pre-built map, else fold flat fields in. Distance
    // routes to DistanceCycling for cycling, DistanceWalkingRunning otherwise
    // (computeWorkoutsSnapshot sums both for a workout's distance).
    const statistics: WorkoutEntry['statistics'] =
      w.statistics && typeof w.statistics === 'object'
        ? (w.statistics as WorkoutEntry['statistics'])
        : {};
    const distance = toFiniteNumber(w.distance);
    if (distance !== undefined && distance > 0) {
      statistics[/cycl/i.test(type) ? 'DistanceCycling' : 'DistanceWalkingRunning'] = {
        sum: distance,
      };
    }
    const energy = toFiniteNumber(w.energy);
    if (energy !== undefined && energy > 0) statistics.ActiveEnergyBurned = { sum: energy };
    const avgHR = toFiniteNumber(w.avgHR);
    if (avgHR !== undefined && avgHR > 0) statistics.HeartRate = { avg: avgHR };

    const durationMinutes = toFiniteNumber(w.durationMinutes);
    const sourceName = typeof w.sourceName === 'string' ? w.sourceName : undefined;

    out.push({
      type,
      start,
      end,
      ...(durationMinutes !== undefined ? { durationMinutes } : {}),
      ...(sourceName ? { sourceName } : {}),
      statistics,
      metadata: {},
    });
  }
  return { workouts: out, dropped };
}
