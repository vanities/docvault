// Apple Health snapshot computer.
//
// Pure function over an already-parsed AppleHealthSummary. Produces a
// PersonSnapshots object with five segment views (Activity, Heart, Sleep,
// Workouts, Body) that the UI consumes directly — no further aggregation
// needed on the client.
//
// All helpers are exported for unit testing. Do not add I/O to this module.

import type { AppleHealthSummary, DailySummary, WorkoutEntry } from './apple-health.js';

/**
 * Snapshot schema / computer version. Bump this when the snapshot computer's
 * output shape or logic changes in a way that makes older cached snapshots
 * stale or visually wrong, even when the underlying parser didn't change.
 * The health route compares `snapshot.schemaVersion` against this constant
 * and auto-recomputes on mismatch.
 *
 * History:
 *   1 — initial: activity/heart/sleep/workouts/body segments
 *   2 — +insights per segment, +WorkoutsSnapshot.distanceUnit,
 *       humanizeTypeName applied to insight strings
 *   3 — delta (iOS Shortcut) overlay support — snapshots may now include
 *       days that come from shortcut-posted deltas rather than the bulk
 *       summary, and existing days may have metrics replaced by deltas.
 *   4 — +period summaries (today/week/month/year with vs-previous deltas),
 *       +recoveryScores per day (composite 0-100), +sleepQualityScores,
 *       collapsible-table-ready data (all days exposed, not just last 14).
 *   5 — +illness detection: auto-flagged periods where multiple vitals
 *       deviate from baseline simultaneously (elevated RHR, low HRV,
 *       low steps, elevated respiratory rate, positive wrist temp).
 */
export const SNAPSHOT_SCHEMA_VERSION = 5;

/**
 * A delta file — written by the /api/health/:personId/ingest endpoint when
 * an iOS Shortcut POSTs daily health data. Each file covers one date and
 * contains a small subset of metrics the shortcut chose to report. The
 * snapshot computer overlays these onto the corresponding day of the bulk
 * parse summary at compute time, so deltas are lossless and inspectable
 * (each one is a file on disk that can be deleted or hand-edited).
 */
export interface DeltaFile {
  /** YYYY-MM-DD — the day this data covers. */
  date: string;
  /** Free-form identifier for where the data came from (e.g. "shortcut-v1"). */
  source: string;
  /** ISO timestamp the server received the POST (added by the endpoint). */
  receivedAt?: string;
  /**
   * Map of HealthKit type (stripped prefix, same as parser) to a partial
   * NumericAggregate. Each metric replaces the corresponding entry in
   * `DailySummary.numeric[type]` entirely — it's an overwrite, not a merge.
   */
  metrics: Record<string, DeltaMetric>;
}

/**
 * A metric reported by a Shortcut. All fields optional so the shortcut can
 * send whatever it has — e.g. StepCount just needs `sum`, HeartRate wants
 * `min`/`avg`/`max`/`count`. The overlay function converts this to a full
 * NumericAggregate by filling in missing fields with reasonable defaults.
 */
export interface DeltaMetric {
  sum?: number;
  avg?: number;
  min?: number;
  max?: number;
  count?: number;
  last?: number;
  unit?: string;
}

/**
 * A single computed insight about a segment. Rendered as a stat tile in
 * the segment view. Segments add whatever insights their data supports —
 * there's no rigid schema for what "Activity insights" should contain.
 *
 * `tone` steers visual styling: "good" is greenish, "warn" is amberish,
 * "neutral" is the default.
 */
export interface InsightItem {
  label: string;
  value: string;
  caption?: string;
  tone?: 'good' | 'warn' | 'neutral';
}

// ===========================================================================
// Exported types (kept in sync with src/components/Health/types.ts by hand)
// ===========================================================================

export interface ActivityDay {
  date: string;
  steps: number;
  activeEnergy: number;
  basalEnergy: number;
  exerciseMinutes: number;
  standHours: number;
  distance: number;
  flightsClimbed: number;
  steps7dAvg: number;
  activeEnergy7dAvg: number;
  exerciseMinutes7dAvg: number;
}

export interface ActivitySnapshot {
  daily: ActivityDay[];
  headline: {
    avgDailySteps90d: number;
    totalSteps: number;
    totalDistance: number;
    totalActiveEnergy: number;
    totalExerciseMinutes: number;
    ringCompletionPct: number | null;
    mostActiveDay: { date: string; steps: number } | null;
  };
  insights: InsightItem[];
  periods: PeriodSummary[];
  recoveryScores: DailyRecoveryScore[];
  distanceUnit: string;
}

export interface HeartDay {
  date: string;
  restingHR: number | null;
  avgHR: number | null;
  minHR: number | null;
  maxHR: number | null;
  hrv: number | null;
  walkingHR: number | null;
  hrRecovery1min: number | null;
}

export interface HeartSnapshot {
  daily: HeartDay[];
  headline: {
    latestRestingHR: number | null;
    avgRestingHR90d: number | null;
    restingHRTrend: 'improving' | 'steady' | 'worsening' | 'unknown';
    latestHRV: number | null;
    avgHRV90d: number | null;
    hrvTrend: 'up' | 'flat' | 'down' | 'unknown';
  };
  insights: InsightItem[];
  periods: PeriodSummary[];
}

export interface SleepDay {
  date: string;
  asleepMinutes: number;
  inBedMinutes: number;
  deepMinutes: number | null;
  remMinutes: number | null;
  coreMinutes: number | null;
  awakeMinutes: number | null;
  respiratoryRate: number | null;
  wristTempDeviationC: number | null;
}

export interface SleepSnapshot {
  daily: SleepDay[];
  headline: {
    avgSleepHours90d: number;
    avgSleepHoursAll: number;
    longestSleep: { date: string; minutes: number } | null;
    shortestSleep: { date: string; minutes: number } | null;
    nightsWith5Plus: number;
    nightsWith7Plus: number;
  };
  insights: InsightItem[];
  periods: PeriodSummary[];
  qualityScores: SleepQualityScore[];
}

export interface WorkoutTypeAgg {
  type: string;
  count: number;
  totalDurationMinutes: number;
  totalDistance: number | null;
  totalEnergy: number | null;
  avgDurationMinutes: number;
  lastWorkout: string;
}

export interface WorkoutWeek {
  weekStart: string;
  count: number;
  totalDurationMinutes: number;
}

export interface WorkoutCondensed {
  type: string;
  start: string;
  durationMinutes: number;
  distance: number | null;
  avgHR: number | null;
  energy: number | null;
}

export interface WorkoutsSnapshot {
  byType: WorkoutTypeAgg[];
  weekly: WorkoutWeek[];
  recent: WorkoutCondensed[];
  headline: {
    totalWorkouts: number;
    thisWeekCount: number;
    thisWeekMinutes: number;
    currentStreakDays: number;
    longestStreakDays: number;
    favoriteType: string | null;
  };
  insights: InsightItem[];
  periods: PeriodSummary[];
  /** Unit (e.g. "mi", "km") for workout distance stats. Derived from the
   * first workout with a distance value, since all workouts for one person
   * use the same unit system. Null if no workouts have distance data. */
  distanceUnit: string | null;
}

export interface WeightPoint {
  date: string;
  kg: number;
  lb: number;
}

export interface BodySnapshot {
  weightHistory: WeightPoint[];
  heightCm: number | null;
  heightIn: number | null;
  headline: {
    currentKg: number | null;
    currentLb: number | null;
    change30d: number | null;
    change1y: number | null;
  };
  insights: InsightItem[];
  periods: PeriodSummary[];
}

export interface PersonSnapshots {
  /** Persisted on disk; may be older than the current SNAPSHOT_SCHEMA_VERSION.
   * The health route compares and recomputes on mismatch. */
  schemaVersion: number;
  generatedAt: string;
  sourceFilename: string;
  parserVersion: string;
  activity: ActivitySnapshot;
  heart: HeartSnapshot;
  sleep: SleepSnapshot;
  workouts: WorkoutsSnapshot;
  body: BodySnapshot;
  /** Auto-detected illness periods from cross-metric anomaly analysis. */
  illnessPeriods: IllnessPeriod[];
}

export type HealthSegment = 'activity' | 'heart' | 'sleep' | 'workouts' | 'body';

// ===========================================================================
// Period summaries — today / this week / this month / this year with deltas
// ===========================================================================

/** A single period stat with optional comparison to the previous period. */
export interface PeriodStat {
  label: string;
  value: number;
  formatted: string;
  prevValue: number | null;
  /** Percentage change vs previous period. Null if no prior data. */
  deltaPct: number | null;
}

/** Summary for one named time period (e.g. "This Week"). */
export interface PeriodSummary {
  name: string;
  /** Date range covered: [start, end] inclusive. */
  start: string;
  end: string;
  stats: PeriodStat[];
}

/**
 * Recovery score for a single day (0-100). Composite of:
 *   - HRV vs 30d baseline (40%)
 *   - Sleep duration vs 8h target (30%)
 *   - Resting HR vs 30d baseline (20%)
 *   - Previous day exercise load factor (10%)
 */
export interface DailyRecoveryScore {
  date: string;
  score: number;
  components: {
    hrv: number;
    sleep: number;
    restingHR: number;
    exerciseLoad: number;
  };
}

/**
 * Sleep quality score for a single night (0-100). Based on Apple's formula:
 *   - Duration: up to 50 pts (8h target)
 *   - Consistency: up to 30 pts (deviation from personal avg bedtime)
 *   - Interruptions: up to 20 pts (awake time / total time)
 */
export interface SleepQualityScore {
  date: string;
  score: number;
  components: {
    duration: number;
    consistency: number;
    interruptions: number;
  };
}

/**
 * An auto-detected illness period. Flagged when multiple vital signs
 * deviate from the 30-day rolling baseline simultaneously for 2+ days.
 *
 * Signals checked (all relative to 30-day personal baseline):
 *   - Resting HR elevated (> baseline + 1.5 SD)
 *   - HRV depressed (< baseline - 1.5 SD)
 *   - Steps significantly below normal (< baseline - 1.5 SD)
 *   - Respiratory rate elevated (> baseline + 1.5 SD, if available)
 *   - Wrist temperature elevated (> baseline + 1.5 SD, if available)
 *
 * A day is flagged when 2+ signals fire. Consecutive flagged days are
 * merged into a single period.
 */
export interface IllnessPeriod {
  startDate: string;
  endDate: string;
  durationDays: number;
  /** Which signals fired during this period (union across all days). */
  signals: string[];
  /** Peak number of simultaneous signals on any day in this period. */
  peakSignals: number;
  /** Confidence: 'likely' (3+ signals), 'possible' (2 signals). */
  confidence: 'likely' | 'possible';
}

// ===========================================================================
// Helpers (exported for testing)
// ===========================================================================

/**
 * Compute a right-aligned rolling mean with window `window`. Position i is
 * the mean of values[i-window+1 .. i]. Returns NaN-free numbers by treating
 * missing values (null/undefined) as skipped — the window shrinks but the
 * output has the same length as the input.
 */
export function rollingAverage(
  values: readonly (number | null | undefined)[],
  window: number
): number[] {
  const result = new Array<number>(values.length);
  for (let i = 0; i < values.length; i++) {
    const from = Math.max(0, i - window + 1);
    let sum = 0;
    let count = 0;
    for (let j = from; j <= i; j++) {
      const v = values[j];
      if (v !== null && v !== undefined && Number.isFinite(v)) {
        sum += v;
        count += 1;
      }
    }
    result[i] = count > 0 ? sum / count : 0;
  }
  return result;
}

/**
 * Get the Monday (YYYY-MM-DD) of the ISO week that contains `dateStr`.
 * `dateStr` is a local-date string like "2026-04-15"; timezone is not
 * considered (Apple Health exports have per-record timezones anyway).
 */
export function weekStartMonday(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  // getUTCDay: Sun=0, Mon=1, ..., Sat=6. Want Mon=0.
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/**
 * Linear regression slope for a series of (x, y) values. Used for "trend
 * direction" indicators on headline stats. Returns the slope, or null if
 * fewer than 2 valid points.
 */
export function linearTrendSlope(series: readonly (number | null)[]): number | null {
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < series.length; i++) {
    const v = series[i];
    if (v !== null && v !== undefined && Number.isFinite(v)) {
      points.push({ x: i, y: v });
    }
  }
  if (points.length < 2) return null;
  const n = points.length;
  const sumX = points.reduce((a, p) => a + p.x, 0);
  const sumY = points.reduce((a, p) => a + p.y, 0);
  const sumXX = points.reduce((a, p) => a + p.x * p.x, 0);
  const sumXY = points.reduce((a, p) => a + p.x * p.y, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;
  return (n * sumXY - sumX * sumY) / denom;
}

/**
 * "Resting HR is better when lower" — so improving = slope negative.
 * Uses a ±0.05 bpm/day dead zone before declaring a trend.
 */
export function classifyRestingHRTrend(
  series: readonly (number | null)[]
): 'improving' | 'steady' | 'worsening' | 'unknown' {
  const slope = linearTrendSlope(series);
  if (slope === null) return 'unknown';
  if (slope < -0.05) return 'improving';
  if (slope > 0.05) return 'worsening';
  return 'steady';
}

/**
 * "HRV is better when higher" — so up = slope positive. Uses a ±0.1 ms/day
 * dead zone.
 */
export function classifyHRVTrend(
  series: readonly (number | null)[]
): 'up' | 'flat' | 'down' | 'unknown' {
  const slope = linearTrendSlope(series);
  if (slope === null) return 'unknown';
  if (slope > 0.1) return 'up';
  if (slope < -0.1) return 'down';
  return 'flat';
}

/** Consecutive-day streak from the end of a sorted-ascending boolean array. */
export function trailingStreak(bools: readonly boolean[]): number {
  let count = 0;
  for (let i = bools.length - 1; i >= 0; i--) {
    if (bools[i]) count += 1;
    else break;
  }
  return count;
}

/** Longest run of `true` values anywhere in the array. */
export function longestStreak(bools: readonly boolean[]): number {
  let best = 0;
  let current = 0;
  for (const b of bools) {
    if (b) {
      current += 1;
      if (current > best) best = current;
    } else {
      current = 0;
    }
  }
  return best;
}

/** Last N entries of an array. Convenient for "last 90 days." */
export function takeLast<T>(arr: readonly T[], n: number): T[] {
  if (n <= 0) return [];
  return arr.slice(Math.max(0, arr.length - n));
}

/** Mean of a nullable numeric series, skipping nulls. 0 if all null. */
export function nanMean(values: readonly (number | null | undefined)[]): number {
  let sum = 0;
  let count = 0;
  for (const v of values) {
    if (v !== null && v !== undefined && Number.isFinite(v)) {
      sum += v;
      count += 1;
    }
  }
  return count > 0 ? sum / count : 0;
}

/** Return the latest non-null value in a sorted-ascending series. */
export function latestNonNull(values: readonly (number | null | undefined)[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (v !== null && v !== undefined && Number.isFinite(v)) return v;
  }
  return null;
}

/**
 * Number of minutes between two timestamps. Accepts both Apple export format
 * (`"2026-04-15 10:00:00 -0500"`) and ISO-8601. Returns 0 for any inputs
 * that can't be parsed or are reversed.
 */
export function minutesBetween(startStr: string, endStr: string): number {
  const parseOne = (value: string): number | null => {
    const apple = value.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-])(\d{2})(\d{2})$/);
    if (apple) {
      const [, date, time, sign, hh, mm] = apple;
      const iso = `${date}T${time}${sign}${hh}:${mm}`;
      const ms = Date.parse(iso);
      return Number.isFinite(ms) ? ms : null;
    }
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  };
  const s = parseOne(startStr);
  const e = parseOne(endStr);
  if (s === null || e === null || e < s) return 0;
  return (e - s) / 60_000;
}

// ===========================================================================
// Insight helpers — reused across segments
// ===========================================================================

/**
 * Return the 0-based day-of-week for a YYYY-MM-DD local-date string,
 * with Monday=0 ... Sunday=6 (ISO convention).
 */
export function dayOfWeekMondayZero(dateStr: string): number {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return (d.getUTCDay() + 6) % 7;
}

/** Split numeric values into weekday (Mon-Fri) and weekend (Sat-Sun) buckets. */
export function weekdayWeekendSplit(
  rows: ReadonlyArray<{ date: string; value: number | null | undefined }>
): { weekdayMean: number; weekendMean: number; weekdayCount: number; weekendCount: number } {
  let wdSum = 0;
  let wdCount = 0;
  let weSum = 0;
  let weCount = 0;
  for (const row of rows) {
    if (row.value === null || row.value === undefined || !Number.isFinite(row.value)) continue;
    const dow = dayOfWeekMondayZero(row.date);
    if (dow >= 5) {
      weSum += row.value;
      weCount += 1;
    } else {
      wdSum += row.value;
      wdCount += 1;
    }
  }
  return {
    weekdayMean: wdCount > 0 ? wdSum / wdCount : 0,
    weekendMean: weCount > 0 ? weSum / weCount : 0,
    weekdayCount: wdCount,
    weekendCount: weCount,
  };
}

/**
 * Longest streak of consecutive days where a predicate returns true.
 * Input is assumed sorted ascending by date. Returns 0 if empty.
 */
export function maxConsecutiveDays<T extends { date: string }>(
  rows: readonly T[],
  predicate: (row: T) => boolean
): number {
  let best = 0;
  let current = 0;
  let lastDate: string | null = null;
  for (const row of rows) {
    if (!predicate(row)) {
      current = 0;
      lastDate = row.date;
      continue;
    }
    if (lastDate === null) {
      current = 1;
    } else {
      // Is this row the day AFTER lastDate?
      const prev = new Date(`${lastDate}T00:00:00Z`);
      const curr = new Date(`${row.date}T00:00:00Z`);
      const delta = Math.round((curr.getTime() - prev.getTime()) / 86_400_000);
      current = delta === 1 ? current + 1 : 1;
    }
    if (current > best) best = current;
    lastDate = row.date;
  }
  return best;
}

/** Coefficient of variation (stddev/mean × 100) — "how variable is this series". */
export function coefficientOfVariation(
  values: readonly (number | null | undefined)[]
): number | null {
  const nums = values.filter(
    (v): v is number => v !== null && v !== undefined && Number.isFinite(v)
  );
  if (nums.length < 2) return null;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  if (mean === 0) return null;
  const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
  return (Math.sqrt(variance) / mean) * 100;
}

/** Format a number with sign prefix, e.g. "+1,234" or "-500". */
export function formatSigned(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const rounded = Math.round(n);
  return rounded >= 0 ? `+${rounded.toLocaleString()}` : rounded.toLocaleString();
}

/** Pretty-format minutes as "Xh Ym". */
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * Split a HealthKit camelCase identifier into space-separated words so
 * "TraditionalStrengthTraining" renders as "Traditional Strength Training".
 * Mirrors src/components/Health/healthFormatters.ts humanizeTypeName so
 * server-side insight computation can format type names at compute time.
 */
export function humanizeTypeName(name: string): string {
  if (!name) return name;
  return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
}

// ===========================================================================
// Metric accessors — pull a single value out of a DailySummary safely
// ===========================================================================

function sum(day: DailySummary, type: string): number {
  return day.numeric[type]?.sum ?? 0;
}

function count(day: DailySummary, type: string): number {
  return day.numeric[type]?.count ?? 0;
}

function lastNullable(day: DailySummary, type: string): number | null {
  const v = day.numeric[type]?.last;
  return v !== undefined && Number.isFinite(v) ? v : null;
}

function avgNullable(day: DailySummary, type: string): number | null {
  const agg = day.numeric[type];
  if (!agg || agg.count === 0) return null;
  return agg.sum / agg.count;
}

function minNullable(day: DailySummary, type: string): number | null {
  const v = day.numeric[type]?.min;
  return v !== undefined && Number.isFinite(v) ? v : null;
}

function maxNullable(day: DailySummary, type: string): number | null {
  const v = day.numeric[type]?.max;
  return v !== undefined && Number.isFinite(v) ? v : null;
}

function unitOf(day: DailySummary, type: string): string | undefined {
  return day.numeric[type]?.unit;
}

// ===========================================================================
// Period helpers
// ===========================================================================

/** Date-range definition for a named period. */
interface DateRange {
  name: string;
  start: string; // YYYY-MM-DD inclusive
  end: string; // YYYY-MM-DD inclusive
}

/**
 * Build the standard time periods relative to `now`:
 *   Today, Yesterday, This Week (Mon-Sun), Last Week,
 *   This Month, Last Month, This Year, Last Year.
 */
export function buildPeriodRanges(now: Date): { current: DateRange; previous: DateRange }[] {
  const todayStr = now.toISOString().slice(0, 10);
  const yesterday = new Date(now);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  // Week boundaries (Mon-Sun)
  const dow = (now.getUTCDay() + 6) % 7; // Mon=0
  const thisWeekStart = new Date(now);
  thisWeekStart.setUTCDate(thisWeekStart.getUTCDate() - dow);
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setUTCDate(lastWeekStart.getUTCDate() - 7);
  const lastWeekEnd = new Date(thisWeekStart);
  lastWeekEnd.setUTCDate(lastWeekEnd.getUTCDate() - 1);

  // Month boundaries
  const thisMonthStart = `${todayStr.slice(0, 7)}-01`;
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const lastMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));

  // Year boundaries
  const thisYearStart = `${now.getUTCFullYear()}-01-01`;
  const lastYearStart = `${now.getUTCFullYear() - 1}-01-01`;
  const lastYearEnd = `${now.getUTCFullYear() - 1}-12-31`;

  return [
    {
      current: { name: 'Today', start: todayStr, end: todayStr },
      previous: { name: 'Yesterday', start: yesterdayStr, end: yesterdayStr },
    },
    {
      current: {
        name: 'This Week',
        start: thisWeekStart.toISOString().slice(0, 10),
        end: todayStr,
      },
      previous: {
        name: 'Last Week',
        start: lastWeekStart.toISOString().slice(0, 10),
        end: lastWeekEnd.toISOString().slice(0, 10),
      },
    },
    {
      current: { name: 'This Month', start: thisMonthStart, end: todayStr },
      previous: {
        name: 'Last Month',
        start: lastMonth.toISOString().slice(0, 10),
        end: lastMonthEnd.toISOString().slice(0, 10),
      },
    },
    {
      current: { name: 'This Year', start: thisYearStart, end: todayStr },
      previous: { name: 'Last Year', start: lastYearStart, end: lastYearEnd },
    },
  ];
}

/** Filter rows to a date range. */
function inRange<T extends { date: string }>(rows: readonly T[], start: string, end: string): T[] {
  return rows.filter((r) => r.date >= start && r.date <= end);
}

/** Compute percentage change, null if no denominator. */
function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

// ===========================================================================
// Recovery score computation
// ===========================================================================

/**
 * Compute daily recovery scores. Uses a 30-day rolling baseline for HRV and
 * resting HR. Score is 0-100 where 100 = fully recovered.
 *
 * Components (weighted):
 *   - HRV vs 30d baseline:        40% — higher HRV = better recovery
 *   - Sleep vs 8h target:         30% — closer to 8h = better
 *   - Resting HR vs 30d baseline: 20% — lower HR = better recovery
 *   - Previous day exercise load: 10% — less load yesterday = more recovery
 */
export function computeRecoveryScores(
  activityDays: readonly ActivityDay[],
  heartDays: readonly HeartDay[],
  sleepDays: readonly SleepDay[]
): DailyRecoveryScore[] {
  // Index heart and sleep by date for fast lookup
  const heartByDate = new Map(heartDays.map((d) => [d.date, d]));
  const sleepByDate = new Map(sleepDays.map((d) => [d.date, d]));

  const scores: DailyRecoveryScore[] = [];

  for (let i = 0; i < activityDays.length; i++) {
    const day = activityDays[i];
    const heart = heartByDate.get(day.date);
    const sleep = sleepByDate.get(day.date);

    // 30-day rolling baseline for HRV and resting HR
    const baselineStart = Math.max(0, i - 30);
    const hrvValues: number[] = [];
    const restingValues: number[] = [];
    for (let j = baselineStart; j < i; j++) {
      const h = heartByDate.get(activityDays[j].date);
      if (h?.hrv !== null && h?.hrv !== undefined) hrvValues.push(h.hrv);
      if (h?.restingHR !== null && h?.restingHR !== undefined) restingValues.push(h.restingHR);
    }

    const hrvBaseline =
      hrvValues.length > 0 ? hrvValues.reduce((a, b) => a + b, 0) / hrvValues.length : null;
    const restingBaseline =
      restingValues.length > 0
        ? restingValues.reduce((a, b) => a + b, 0) / restingValues.length
        : null;

    // HRV component (40%): ratio of today's HRV to baseline, capped at 0-100
    let hrvScore = 50; // default if no data
    if (
      heart?.hrv !== null &&
      heart?.hrv !== undefined &&
      hrvBaseline !== null &&
      hrvBaseline > 0
    ) {
      const ratio = heart.hrv / hrvBaseline;
      hrvScore = Math.min(100, Math.max(0, ratio * 50 + 25)); // center at 75 when at baseline
    }

    // Sleep component (30%): how close to 8 hours
    let sleepScore = 50;
    if (sleep && sleep.asleepMinutes > 0) {
      const hours = sleep.asleepMinutes / 60;
      // Perfect at 8h, linearly drops. 6h = ~75, 4h = ~50, 10h = ~88
      sleepScore = Math.min(100, Math.max(0, 100 - Math.abs(hours - 8) * 12.5));
    }

    // Resting HR component (20%): lower than baseline = better
    let restingScore = 50;
    if (
      heart?.restingHR !== null &&
      heart?.restingHR !== undefined &&
      restingBaseline !== null &&
      restingBaseline > 0
    ) {
      const delta = restingBaseline - heart.restingHR; // positive = good (lower than baseline)
      restingScore = Math.min(100, Math.max(0, 75 + delta * 5)); // 5 pts per bpm below baseline
    }

    // Exercise load component (10%): yesterday's exercise minutes
    let exerciseLoadScore = 75; // default = light recovery
    if (i > 0) {
      const prevExercise = activityDays[i - 1].exerciseMinutes;
      // 0 min = 100 (full rest), 30 min = 75, 60 min = 50, 120 min = 0
      exerciseLoadScore = Math.min(100, Math.max(0, 100 - (prevExercise / 120) * 100));
    }

    const score = Math.round(
      hrvScore * 0.4 + sleepScore * 0.3 + restingScore * 0.2 + exerciseLoadScore * 0.1
    );

    scores.push({
      date: day.date,
      score: Math.min(100, Math.max(0, score)),
      components: {
        hrv: Math.round(hrvScore),
        sleep: Math.round(sleepScore),
        restingHR: Math.round(restingScore),
        exerciseLoad: Math.round(exerciseLoadScore),
      },
    });
  }

  return scores;
}

// ===========================================================================
// Sleep quality score computation
// ===========================================================================

/**
 * Compute nightly sleep quality scores (0-100).
 *
 * Apple's formula (publicly documented):
 *   - Duration: up to 50 pts — based on closeness to 8h target
 *   - Consistency: up to 30 pts — deviation from average sleep duration
 *   - Interruptions: up to 20 pts — awake minutes relative to total sleep
 */
export function computeSleepQualityScores(sleepDays: readonly SleepDay[]): SleepQualityScore[] {
  if (sleepDays.length === 0) return [];

  // Compute average sleep duration for consistency scoring
  const validDays = sleepDays.filter((d) => d.asleepMinutes > 0);
  const avgSleep =
    validDays.length > 0
      ? validDays.reduce((a, d) => a + d.asleepMinutes, 0) / validDays.length
      : 480; // 8h default

  return sleepDays.map((d) => {
    // Duration component (50 pts): 8h target
    const hours = d.asleepMinutes / 60;
    let durationPts: number;
    if (hours >= 7 && hours <= 9) {
      durationPts = 50; // optimal range
    } else if (hours >= 6 && hours < 7) {
      durationPts = 35;
    } else if (hours >= 5 && hours < 6) {
      durationPts = 20;
    } else if (hours > 9 && hours <= 10) {
      durationPts = 40;
    } else if (hours < 5) {
      durationPts = Math.max(0, hours * 4); // ~4 pts per hour under 5h
    } else {
      durationPts = 30; // > 10h
    }

    // Consistency component (30 pts): deviation from personal average
    const deviation = Math.abs(d.asleepMinutes - avgSleep);
    const deviationHours = deviation / 60;
    // 0h deviation = 30pts, 1h = 20pts, 2h = 10pts, 3h+ = 0pts
    const consistencyPts = Math.max(0, 30 - deviationHours * 10);

    // Interruptions component (20 pts): awake time relative to sleep time
    const awakeMins = d.awakeMinutes ?? 0;
    const totalTime = d.asleepMinutes + awakeMins;
    const awakeRatio = totalTime > 0 ? awakeMins / totalTime : 0;
    // 0% awake = 20pts, 10% = 10pts, 20%+ = 0pts
    const interruptionPts = Math.max(0, 20 - awakeRatio * 100);

    const score = Math.round(durationPts + consistencyPts + interruptionPts);

    return {
      date: d.date,
      score: Math.min(100, Math.max(0, score)),
      components: {
        duration: Math.round(durationPts),
        consistency: Math.round(consistencyPts),
        interruptions: Math.round(interruptionPts),
      },
    };
  });
}

// ===========================================================================
// Illness detection
// ===========================================================================

/** Rolling mean and standard deviation over a window. */
function rollingStats(
  values: readonly (number | null | undefined)[],
  windowSize: number,
  index: number
): { mean: number; sd: number; count: number } {
  const from = Math.max(0, index - windowSize);
  const nums: number[] = [];
  for (let i = from; i < index; i++) {
    const v = values[i];
    if (v !== null && v !== undefined && Number.isFinite(v)) nums.push(v);
  }
  if (nums.length < 5) return { mean: 0, sd: 0, count: 0 };
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
  return { mean, sd: Math.sqrt(variance), count: nums.length };
}

/**
 * Detect illness periods by scanning for days where multiple vital signs
 * deviate from their 30-day rolling baselines simultaneously.
 */
export function detectIllnessPeriods(
  activityDays: readonly ActivityDay[],
  heartDays: readonly HeartDay[],
  sleepDays: readonly SleepDay[]
): IllnessPeriod[] {
  // Index by date for cross-referencing
  const heartByDate = new Map(heartDays.map((d) => [d.date, d]));
  const sleepByDate = new Map(sleepDays.map((d) => [d.date, d]));

  // For each activity day, check signals against 30-day rolling baseline
  const WINDOW = 30;
  const THRESHOLD = 1.5; // standard deviations

  interface FlaggedDay {
    date: string;
    signals: string[];
  }

  const flaggedDays: FlaggedDay[] = [];

  // Build parallel series for rolling stats
  const restingHRSeries = activityDays.map((d) => heartByDate.get(d.date)?.restingHR ?? null);
  const hrvSeries = activityDays.map((d) => heartByDate.get(d.date)?.hrv ?? null);
  const stepsSeries = activityDays.map((d) => d.steps as number | null);
  const respRateSeries = activityDays.map((d) => sleepByDate.get(d.date)?.respiratoryRate ?? null);
  const wristTempSeries = activityDays.map(
    (d) => sleepByDate.get(d.date)?.wristTempDeviationC ?? null
  );

  for (let i = WINDOW; i < activityDays.length; i++) {
    const day = activityDays[i];
    const signals: string[] = [];

    // Resting HR elevated
    const rhr = restingHRSeries[i];
    if (rhr !== null && rhr !== undefined) {
      const stats = rollingStats(restingHRSeries, WINDOW, i);
      if (stats.count >= 5 && stats.sd > 0 && rhr > stats.mean + THRESHOLD * stats.sd) {
        signals.push(`Resting HR elevated (${Math.round(rhr)} vs ${Math.round(stats.mean)} avg)`);
      }
    }

    // HRV depressed
    const hrv = hrvSeries[i];
    if (hrv !== null && hrv !== undefined) {
      const stats = rollingStats(hrvSeries, WINDOW, i);
      if (stats.count >= 5 && stats.sd > 0 && hrv < stats.mean - THRESHOLD * stats.sd) {
        signals.push(`HRV depressed (${Math.round(hrv)} vs ${Math.round(stats.mean)} avg)`);
      }
    }

    // Steps below normal
    const steps = stepsSeries[i];
    if (steps !== null && steps !== undefined) {
      const stats = rollingStats(stepsSeries, WINDOW, i);
      if (stats.count >= 5 && stats.sd > 0 && steps < stats.mean - THRESHOLD * stats.sd) {
        signals.push(
          `Steps low (${Math.round(steps).toLocaleString()} vs ${Math.round(stats.mean).toLocaleString()} avg)`
        );
      }
    }

    // Respiratory rate elevated
    const resp = respRateSeries[i];
    if (resp !== null && resp !== undefined) {
      const stats = rollingStats(respRateSeries, WINDOW, i);
      if (stats.count >= 5 && stats.sd > 0 && resp > stats.mean + THRESHOLD * stats.sd) {
        signals.push(
          `Respiratory rate elevated (${resp.toFixed(1)} vs ${stats.mean.toFixed(1)} avg)`
        );
      }
    }

    // Wrist temperature — use rolling baseline comparison like all other
    // metrics. The raw field may be a small deviation (±1°C) or an absolute
    // reading (97°F) depending on the Apple Watch model/firmware. Rolling
    // baseline handles both formats correctly.
    const wristTemp = wristTempSeries[i];
    if (wristTemp !== null && wristTemp !== undefined) {
      const stats = rollingStats(wristTempSeries, WINDOW, i);
      if (stats.count >= 5 && stats.sd > 0 && wristTemp > stats.mean + THRESHOLD * stats.sd) {
        signals.push(
          `Wrist temp elevated (${wristTemp.toFixed(1)} vs ${stats.mean.toFixed(1)} avg)`
        );
      }
    }

    if (signals.length >= 2) {
      flaggedDays.push({ date: day.date, signals });
    }
  }

  // Merge consecutive flagged days into periods
  const periods: IllnessPeriod[] = [];
  let currentPeriod: {
    startDate: string;
    endDate: string;
    signals: Set<string>;
    peakSignals: number;
  } | null = null;

  for (const flagged of flaggedDays) {
    if (currentPeriod) {
      // Check if this day is consecutive (within 2 days to allow one gap day)
      const prevDate = new Date(`${currentPeriod.endDate}T00:00:00Z`);
      const thisDate = new Date(`${flagged.date}T00:00:00Z`);
      const gapDays = Math.round((thisDate.getTime() - prevDate.getTime()) / 86_400_000);

      if (gapDays <= 2) {
        // Extend the current period
        currentPeriod.endDate = flagged.date;
        for (const s of flagged.signals) currentPeriod.signals.add(s);
        currentPeriod.peakSignals = Math.max(currentPeriod.peakSignals, flagged.signals.length);
        continue;
      }
    }

    // Finalize previous period and start new one
    if (currentPeriod) {
      const startD = new Date(`${currentPeriod.startDate}T00:00:00Z`);
      const endD = new Date(`${currentPeriod.endDate}T00:00:00Z`);
      const duration = Math.round((endD.getTime() - startD.getTime()) / 86_400_000) + 1;
      if (duration >= 2) {
        periods.push({
          startDate: currentPeriod.startDate,
          endDate: currentPeriod.endDate,
          durationDays: duration,
          signals: [...currentPeriod.signals],
          peakSignals: currentPeriod.peakSignals,
          confidence: currentPeriod.peakSignals >= 3 ? 'likely' : 'possible',
        });
      }
    }

    currentPeriod = {
      startDate: flagged.date,
      endDate: flagged.date,
      signals: new Set(flagged.signals),
      peakSignals: flagged.signals.length,
    };
  }

  // Don't forget the last period
  if (currentPeriod) {
    const startD = new Date(`${currentPeriod.startDate}T00:00:00Z`);
    const endD = new Date(`${currentPeriod.endDate}T00:00:00Z`);
    const duration = Math.round((endD.getTime() - startD.getTime()) / 86_400_000) + 1;
    if (duration >= 2) {
      periods.push({
        startDate: currentPeriod.startDate,
        endDate: currentPeriod.endDate,
        durationDays: duration,
        signals: [...currentPeriod.signals],
        peakSignals: currentPeriod.peakSignals,
        confidence: currentPeriod.peakSignals >= 3 ? 'likely' : 'possible',
      });
    }
  }

  return periods;
}

// ===========================================================================
// Segment computers
// ===========================================================================

/** Get all days sorted ascending. */
function sortedDays(summary: AppleHealthSummary): DailySummary[] {
  return Object.values(summary.dailySummaries).sort((a, b) => a.date.localeCompare(b.date));
}

export function computeActivitySnapshot(
  summary: AppleHealthSummary,
  now: Date = new Date()
): ActivitySnapshot {
  const days = sortedDays(summary);

  const daily: ActivityDay[] = days.map((day) => ({
    date: day.date,
    steps: sum(day, 'StepCount'),
    activeEnergy: sum(day, 'ActiveEnergyBurned'),
    basalEnergy: sum(day, 'BasalEnergyBurned'),
    exerciseMinutes: sum(day, 'AppleExerciseTime'),
    standHours: count(day, 'AppleStandHour'),
    distance: sum(day, 'DistanceWalkingRunning') + sum(day, 'DistanceCycling'),
    flightsClimbed: sum(day, 'FlightsClimbed'),
    steps7dAvg: 0, // filled below
    activeEnergy7dAvg: 0,
    exerciseMinutes7dAvg: 0,
  }));

  // Apply 7-day rolling averages
  const stepsRoll = rollingAverage(
    daily.map((d) => d.steps),
    7
  );
  const energyRoll = rollingAverage(
    daily.map((d) => d.activeEnergy),
    7
  );
  const exerciseRoll = rollingAverage(
    daily.map((d) => d.exerciseMinutes),
    7
  );
  for (let i = 0; i < daily.length; i++) {
    daily[i].steps7dAvg = stepsRoll[i];
    daily[i].activeEnergy7dAvg = energyRoll[i];
    daily[i].exerciseMinutes7dAvg = exerciseRoll[i];
  }

  // Headline stats from the last 90 days
  const last90 = takeLast(daily, 90);
  const avgDailySteps90d = nanMean(last90.map((d) => d.steps));

  const totalSteps = daily.reduce((a, d) => a + d.steps, 0);
  const totalDistance = daily.reduce((a, d) => a + d.distance, 0);
  const totalActiveEnergy = daily.reduce((a, d) => a + d.activeEnergy, 0);
  const totalExerciseMinutes = daily.reduce((a, d) => a + d.exerciseMinutes, 0);

  // Apple pre-aggregates activity rings — use those for ring completion if available
  let ringCompletionPct: number | null = null;
  if (summary.activitySummaries.length > 0) {
    const completed = summary.activitySummaries.filter(
      (a) =>
        (a.activeEnergyBurnedGoal ?? 0) > 0 &&
        (a.activeEnergyBurned ?? 0) >= (a.activeEnergyBurnedGoal ?? 0)
    ).length;
    ringCompletionPct = (completed / summary.activitySummaries.length) * 100;
  }

  let mostActiveDay: ActivitySnapshot['headline']['mostActiveDay'] = null;
  if (daily.length > 0) {
    const top = daily.reduce((a, b) => (b.steps > a.steps ? b : a));
    if (top.steps > 0) mostActiveDay = { date: top.date, steps: top.steps };
  }

  // Pick a distance unit. Prefer whatever WalkingRunning used; fall back to cycling.
  const distanceUnit =
    days.find((d) => unitOf(d, 'DistanceWalkingRunning'))?.numeric.DistanceWalkingRunning?.unit ??
    days.find((d) => unitOf(d, 'DistanceCycling'))?.numeric.DistanceCycling?.unit ??
    'mi';

  // -----------------------------------------------------------------------
  // Insights
  // -----------------------------------------------------------------------
  const insights: InsightItem[] = [];

  // Weekday vs weekend step patterns (how much more/less active on weekends?)
  const split = weekdayWeekendSplit(daily.map((d) => ({ date: d.date, value: d.steps })));
  if (split.weekdayCount > 0 && split.weekendCount > 0) {
    const delta = split.weekendMean - split.weekdayMean;
    const pct = split.weekdayMean > 0 ? (delta / split.weekdayMean) * 100 : 0;
    insights.push({
      label: 'Weekend vs weekday',
      value: `${formatSigned(Math.round(delta))} steps`,
      caption: `${pct >= 0 ? '+' : ''}${Math.round(pct)}% on weekends`,
      tone: delta >= 0 ? 'good' : 'neutral',
    });
  }

  // 10k-step day count + percentage
  const tenKDays = daily.filter((d) => d.steps >= 10_000).length;
  if (daily.length > 0) {
    insights.push({
      label: '10,000-step days',
      value: `${tenKDays.toLocaleString()}`,
      caption: `${Math.round((tenKDays / daily.length) * 100)}% of tracked days`,
      tone: 'neutral',
    });
  }

  // Longest 10k-step streak
  const tenKStreak = maxConsecutiveDays(daily, (d) => d.steps >= 10_000);
  if (tenKStreak > 0) {
    insights.push({
      label: 'Longest 10k streak',
      value: `${tenKStreak} days`,
      tone: 'good',
    });
  }

  // Most active day of the week (avg steps by DOW over last year)
  const last365 = takeLast(daily, 365);
  if (last365.length >= 14) {
    const dowSums = new Array<number>(7).fill(0);
    const dowCounts = new Array<number>(7).fill(0);
    for (const d of last365) {
      const dow = dayOfWeekMondayZero(d.date);
      dowSums[dow] += d.steps;
      dowCounts[dow] += 1;
    }
    const dowAvgs = dowSums.map((s, i) => (dowCounts[i] > 0 ? s / dowCounts[i] : 0));
    let bestDow = 0;
    for (let i = 1; i < 7; i++) if (dowAvgs[i] > dowAvgs[bestDow]) bestDow = i;
    const dowNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    insights.push({
      label: 'Most active weekday',
      value: dowNames[bestDow],
      caption: `${Math.round(dowAvgs[bestDow]).toLocaleString()} avg steps`,
      tone: 'neutral',
    });
  }

  // Flights climbed lifetime
  const totalFlights = daily.reduce((a, d) => a + d.flightsClimbed, 0);
  if (totalFlights > 0) {
    insights.push({
      label: 'Flights climbed',
      value: totalFlights.toLocaleString(),
      caption: 'lifetime',
      tone: 'neutral',
    });
  }

  // -----------------------------------------------------------------------
  // Period summaries
  // -----------------------------------------------------------------------
  const periodRanges = buildPeriodRanges(now);
  const periods: PeriodSummary[] = periodRanges.map(({ current, previous }) => {
    const curDays = inRange(daily, current.start, current.end);
    const prevDays = inRange(daily, previous.start, previous.end);

    const curSteps =
      curDays.length > 0 ? curDays.reduce((a, d) => a + d.steps, 0) / curDays.length : 0;
    const prevSteps =
      prevDays.length > 0 ? prevDays.reduce((a, d) => a + d.steps, 0) / prevDays.length : 0;
    const curCal =
      curDays.length > 0 ? curDays.reduce((a, d) => a + d.activeEnergy, 0) / curDays.length : 0;
    const prevCal =
      prevDays.length > 0 ? prevDays.reduce((a, d) => a + d.activeEnergy, 0) / prevDays.length : 0;
    const curExercise =
      curDays.length > 0 ? curDays.reduce((a, d) => a + d.exerciseMinutes, 0) / curDays.length : 0;
    const prevExercise =
      prevDays.length > 0
        ? prevDays.reduce((a, d) => a + d.exerciseMinutes, 0) / prevDays.length
        : 0;

    return {
      name: current.name,
      start: current.start,
      end: current.end,
      stats: [
        {
          label: 'Avg steps',
          value: curSteps,
          formatted: formatSigned(curSteps).replace('+', ''),
          prevValue: prevDays.length > 0 ? prevSteps : null,
          deltaPct: prevDays.length > 0 ? pctChange(curSteps, prevSteps) : null,
        },
        {
          label: 'Avg calories',
          value: curCal,
          formatted: Math.round(curCal).toLocaleString(),
          prevValue: prevDays.length > 0 ? prevCal : null,
          deltaPct: prevDays.length > 0 ? pctChange(curCal, prevCal) : null,
        },
        {
          label: 'Avg exercise',
          value: curExercise,
          formatted: `${Math.round(curExercise)}m`,
          prevValue: prevDays.length > 0 ? prevExercise : null,
          deltaPct: prevDays.length > 0 ? pctChange(curExercise, prevExercise) : null,
        },
      ],
    };
  });

  return {
    daily,
    headline: {
      avgDailySteps90d,
      totalSteps,
      totalDistance,
      totalActiveEnergy,
      totalExerciseMinutes,
      ringCompletionPct,
      mostActiveDay,
    },
    insights,
    periods,
    recoveryScores: [], // filled by top-level compose (needs cross-segment data)
    distanceUnit,
  };
}

export function computeHeartSnapshot(
  summary: AppleHealthSummary,
  now: Date = new Date()
): HeartSnapshot {
  const days = sortedDays(summary);

  const daily: HeartDay[] = days.map((day) => ({
    date: day.date,
    restingHR: lastNullable(day, 'RestingHeartRate'),
    avgHR: avgNullable(day, 'HeartRate'),
    minHR: minNullable(day, 'HeartRate'),
    maxHR: maxNullable(day, 'HeartRate'),
    hrv: avgNullable(day, 'HeartRateVariabilitySDNN'),
    walkingHR: avgNullable(day, 'WalkingHeartRateAverage'),
    hrRecovery1min: avgNullable(day, 'HeartRateRecoveryOneMinute'),
  }));

  const last90 = takeLast(daily, 90);
  const restingSeries90 = last90.map((d) => d.restingHR);
  const hrvSeries90 = last90.map((d) => d.hrv);

  // -----------------------------------------------------------------------
  // Insights
  // -----------------------------------------------------------------------
  const insights: InsightItem[] = [];

  // All-time resting HR range
  const allResting = daily
    .map((d) => d.restingHR)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  if (allResting.length > 0) {
    const min = Math.min(...allResting);
    const max = Math.max(...allResting);
    insights.push({
      label: 'All-time resting HR range',
      value: `${Math.round(min)}–${Math.round(max)} bpm`,
      caption: `${allResting.length.toLocaleString()} days tracked`,
      tone: 'neutral',
    });
  }

  // HRV variability — high CV means erratic recovery; low means steady
  const hrvCv = coefficientOfVariation(hrvSeries90);
  if (hrvCv !== null) {
    insights.push({
      label: 'HRV variability (90d)',
      value: `${hrvCv.toFixed(0)}%`,
      caption:
        hrvCv < 20 ? 'steady recovery' : hrvCv < 35 ? 'moderate variation' : 'highly variable',
      tone: hrvCv < 20 ? 'good' : hrvCv < 35 ? 'neutral' : 'warn',
    });
  }

  // Max observed HR
  const allMaxHR = daily
    .map((d) => d.maxHR)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  if (allMaxHR.length > 0) {
    const peak = Math.max(...allMaxHR);
    insights.push({
      label: 'Peak heart rate',
      value: `${Math.round(peak)} bpm`,
      caption: 'highest ever recorded',
      tone: 'neutral',
    });
  }

  // Improvement since earliest tracked resting HR (when at least 180d of data)
  if (daily.length >= 180) {
    const earlyRestingHRs = daily
      .slice(0, 30)
      .map((d) => d.restingHR)
      .filter((v): v is number => v !== null);
    const recentRestingHRs = daily
      .slice(-30)
      .map((d) => d.restingHR)
      .filter((v): v is number => v !== null);
    if (earlyRestingHRs.length >= 5 && recentRestingHRs.length >= 5) {
      const earlyAvg = earlyRestingHRs.reduce((a, b) => a + b, 0) / earlyRestingHRs.length;
      const recentAvg = recentRestingHRs.reduce((a, b) => a + b, 0) / recentRestingHRs.length;
      const delta = recentAvg - earlyAvg;
      insights.push({
        label: 'Resting HR since start',
        value: `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} bpm`,
        caption: `${earlyAvg.toFixed(0)} → ${recentAvg.toFixed(0)}`,
        tone: delta < -2 ? 'good' : delta > 2 ? 'warn' : 'neutral',
      });
    }
  }

  // -----------------------------------------------------------------------
  // Period summaries
  // -----------------------------------------------------------------------
  const periodRanges = buildPeriodRanges(now);
  const periods: PeriodSummary[] = periodRanges.map(({ current, previous }) => {
    const curDays = inRange(daily, current.start, current.end);
    const prevDays = inRange(daily, previous.start, previous.end);

    const curResting = nanMean(curDays.map((d) => d.restingHR));
    const prevResting = nanMean(prevDays.map((d) => d.restingHR));
    const curHRV = nanMean(curDays.map((d) => d.hrv));
    const prevHRV = nanMean(prevDays.map((d) => d.hrv));

    return {
      name: current.name,
      start: current.start,
      end: current.end,
      stats: [
        {
          label: 'Avg resting HR',
          value: curResting,
          formatted: curResting > 0 ? `${Math.round(curResting)} bpm` : '—',
          prevValue: prevDays.length > 0 && prevResting > 0 ? prevResting : null,
          deltaPct: prevResting > 0 ? pctChange(curResting, prevResting) : null,
        },
        {
          label: 'Avg HRV',
          value: curHRV,
          formatted: curHRV > 0 ? `${curHRV.toFixed(1)} ms` : '—',
          prevValue: prevDays.length > 0 && prevHRV > 0 ? prevHRV : null,
          deltaPct: prevHRV > 0 ? pctChange(curHRV, prevHRV) : null,
        },
      ],
    };
  });

  return {
    daily,
    headline: {
      latestRestingHR: latestNonNull(daily.map((d) => d.restingHR)),
      avgRestingHR90d:
        nanMean(restingSeries90) > 0 ? Math.round(nanMean(restingSeries90) * 10) / 10 : null,
      restingHRTrend: classifyRestingHRTrend(restingSeries90),
      latestHRV: latestNonNull(daily.map((d) => d.hrv)),
      avgHRV90d: nanMean(hrvSeries90) > 0 ? Math.round(nanMean(hrvSeries90) * 10) / 10 : null,
      hrvTrend: classifyHRVTrend(hrvSeries90),
    },
    insights,
    periods,
  };
}

export function computeSleepSnapshot(
  summary: AppleHealthSummary,
  now: Date = new Date()
): SleepSnapshot {
  const days = sortedDays(summary);

  /**
   * Extract minute-per-stage from a day's SleepAnalysis category record.
   * The `valueDurationMinutes` field holds keys like "AsleepDeep", "InBed",
   * "Awake" (after the parser's prefix strip removes "HKCategoryValueSleepAnalysis").
   */
  const readSleep = (day: DailySummary): SleepDay => {
    const agg = day.category.SleepAnalysis;
    const durations = agg?.valueDurationMinutes ?? {};

    const inBed = durations.InBed ?? 0;
    // Legacy "Asleep" and modern "AsleepUnspecified" both mean "asleep, stage unknown"
    const asleepUnspecified = (durations.Asleep ?? 0) + (durations.AsleepUnspecified ?? 0);
    const deep = durations.AsleepDeep ?? 0;
    const rem = durations.AsleepREM ?? 0;
    const core = durations.AsleepCore ?? 0;
    const awake = durations.Awake ?? 0;
    // Total "asleep" = sum of non-awake, non-in-bed variants
    const asleep = asleepUnspecified + deep + rem + core;

    return {
      date: day.date,
      asleepMinutes: Math.round(asleep),
      inBedMinutes: Math.round(inBed),
      deepMinutes: deep > 0 ? Math.round(deep) : null,
      remMinutes: rem > 0 ? Math.round(rem) : null,
      coreMinutes: core > 0 ? Math.round(core) : null,
      awakeMinutes: awake > 0 ? Math.round(awake) : null,
      respiratoryRate: avgNullable(day, 'RespiratoryRate'),
      wristTempDeviationC: avgNullable(day, 'AppleSleepingWristTemperature'),
    };
  };

  // Only keep days that actually have sleep data
  const daily: SleepDay[] = days
    .map(readSleep)
    .filter((d) => d.asleepMinutes > 0 || d.inBedMinutes > 0);

  const last90 = takeLast(daily, 90);
  const avgSleep90Min = nanMean(last90.map((d) => d.asleepMinutes));
  const avgSleepAllMin = nanMean(daily.map((d) => d.asleepMinutes));

  let longestSleep: SleepSnapshot['headline']['longestSleep'] = null;
  let shortestSleep: SleepSnapshot['headline']['shortestSleep'] = null;
  if (daily.length > 0) {
    const slept = daily.filter((d) => d.asleepMinutes > 0);
    if (slept.length > 0) {
      const max = slept.reduce((a, b) => (b.asleepMinutes > a.asleepMinutes ? b : a));
      const min = slept.reduce((a, b) => (b.asleepMinutes < a.asleepMinutes ? b : a));
      longestSleep = { date: max.date, minutes: max.asleepMinutes };
      shortestSleep = { date: min.date, minutes: min.asleepMinutes };
    }
  }

  // -----------------------------------------------------------------------
  // Insights
  // -----------------------------------------------------------------------
  const insights: InsightItem[] = [];

  // Weekday vs weekend sleep — "do you sleep in on weekends?"
  const sleepSplit = weekdayWeekendSplit(
    daily.map((d) => ({ date: d.date, value: d.asleepMinutes }))
  );
  if (sleepSplit.weekdayCount > 0 && sleepSplit.weekendCount > 0) {
    const delta = sleepSplit.weekendMean - sleepSplit.weekdayMean;
    insights.push({
      label: 'Weekend vs weekday',
      value: `${delta >= 0 ? '+' : ''}${Math.round(delta)} min`,
      caption: `${Math.round(sleepSplit.weekendMean / 60)}h weekend vs ${Math.round(sleepSplit.weekdayMean / 60)}h weekday`,
      tone: 'neutral',
    });
  }

  // NOTE: Sleep efficiency (asleep / in-bed) is deliberately NOT computed
  // right now — Apple's sleep records have overlapping periods where
  // `InBed` wraps the entire block and `AsleepCore/Deep/REM` slices are
  // nested inside. Naively summing both gives a ratio around 50% that
  // looks like terrible sleep when it's actually a double-counting bug.
  // To fix properly we need wall-clock interval math at the session level,
  // which requires preserving individual record start/end timestamps in
  // the parser rather than collapsing them to per-day durations. TODO.

  // Longest streak of 7+ hour nights
  const goodSleepStreak = maxConsecutiveDays(daily, (d) => d.asleepMinutes >= 7 * 60);
  if (goodSleepStreak > 0) {
    insights.push({
      label: 'Longest 7+ hour streak',
      value: `${goodSleepStreak} nights`,
      tone: 'good',
    });
  }

  // Average deep sleep share (when stages are available)
  const nightsWithDeep = daily.filter((d) => d.deepMinutes !== null && d.asleepMinutes > 0);
  if (nightsWithDeep.length >= 7) {
    const avgDeepPct =
      nightsWithDeep.reduce((a, d) => a + (d.deepMinutes ?? 0) / d.asleepMinutes, 0) /
      nightsWithDeep.length;
    insights.push({
      label: 'Avg deep sleep share',
      value: `${Math.round(avgDeepPct * 100)}%`,
      caption: `${Math.round(avgDeepPct * avgSleep90Min)}m typical night`,
      tone: avgDeepPct >= 0.13 ? 'good' : 'neutral',
    });
  }

  // Average overnight respiratory rate
  const respValues = daily
    .map((d) => d.respiratoryRate)
    .filter((v): v is number => v !== null && v > 0);
  if (respValues.length >= 7) {
    const avg = respValues.reduce((a, b) => a + b, 0) / respValues.length;
    insights.push({
      label: 'Avg respiratory rate',
      value: `${avg.toFixed(1)} br/min`,
      caption: 'overnight',
      tone: 'neutral',
    });
  }

  // -----------------------------------------------------------------------
  // Period summaries
  // -----------------------------------------------------------------------
  const periodRanges = buildPeriodRanges(now);
  const periods: PeriodSummary[] = periodRanges.map(({ current, previous }) => {
    const curDays = inRange(daily, current.start, current.end);
    const prevDays = inRange(daily, previous.start, previous.end);

    const curSleep =
      curDays.length > 0 ? curDays.reduce((a, d) => a + d.asleepMinutes, 0) / curDays.length : 0;
    const prevSleep =
      prevDays.length > 0 ? prevDays.reduce((a, d) => a + d.asleepMinutes, 0) / prevDays.length : 0;
    const curDeep = curDays.length > 0 ? nanMean(curDays.map((d) => d.deepMinutes)) : 0;
    const prevDeep = prevDays.length > 0 ? nanMean(prevDays.map((d) => d.deepMinutes)) : 0;

    return {
      name: current.name,
      start: current.start,
      end: current.end,
      stats: [
        {
          label: 'Avg sleep',
          value: curSleep,
          formatted: formatDuration(curSleep),
          prevValue: prevDays.length > 0 ? prevSleep : null,
          deltaPct: prevDays.length > 0 ? pctChange(curSleep, prevSleep) : null,
        },
        {
          label: 'Avg deep',
          value: curDeep,
          formatted: curDeep > 0 ? formatDuration(curDeep) : '—',
          prevValue: prevDays.length > 0 && prevDeep > 0 ? prevDeep : null,
          deltaPct: prevDeep > 0 ? pctChange(curDeep, prevDeep) : null,
        },
      ],
    };
  });

  // Sleep quality scores
  const qualityScores = computeSleepQualityScores(daily);

  return {
    daily,
    headline: {
      avgSleepHours90d: avgSleep90Min / 60,
      avgSleepHoursAll: avgSleepAllMin / 60,
      longestSleep,
      shortestSleep,
      nightsWith5Plus: daily.filter((d) => d.asleepMinutes >= 5 * 60).length,
      nightsWith7Plus: daily.filter((d) => d.asleepMinutes >= 7 * 60).length,
    },
    insights,
    periods,
    qualityScores,
  };
}

export function computeWorkoutsSnapshot(
  summary: AppleHealthSummary,
  now: Date = new Date()
): WorkoutsSnapshot {
  const workouts = summary.workouts;

  // ---------- by type ----------
  const byTypeMap = new Map<string, WorkoutTypeAgg>();
  for (const w of workouts) {
    const existing = byTypeMap.get(w.type);
    const distance =
      (w.statistics.DistanceWalkingRunning?.sum ?? 0) + (w.statistics.DistanceCycling?.sum ?? 0);
    const energy = w.statistics.ActiveEnergyBurned?.sum ?? 0;
    const duration = w.durationMinutes ?? 0;
    if (existing) {
      existing.count += 1;
      existing.totalDurationMinutes += duration;
      if (distance > 0) existing.totalDistance = (existing.totalDistance ?? 0) + distance;
      if (energy > 0) existing.totalEnergy = (existing.totalEnergy ?? 0) + energy;
      if (w.start > existing.lastWorkout) existing.lastWorkout = w.start;
    } else {
      byTypeMap.set(w.type, {
        type: w.type,
        count: 1,
        totalDurationMinutes: duration,
        totalDistance: distance > 0 ? distance : null,
        totalEnergy: energy > 0 ? energy : null,
        avgDurationMinutes: 0, // filled below
        lastWorkout: w.start,
      });
    }
  }
  for (const agg of byTypeMap.values()) {
    agg.avgDurationMinutes = agg.count > 0 ? agg.totalDurationMinutes / agg.count : 0;
  }
  const byType = [...byTypeMap.values()].sort((a, b) => b.count - a.count);

  // ---------- weekly ----------
  const weekMap = new Map<string, WorkoutWeek>();
  for (const w of workouts) {
    const date = w.start.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const week = weekStartMonday(date);
    const existing = weekMap.get(week);
    if (existing) {
      existing.count += 1;
      existing.totalDurationMinutes += w.durationMinutes ?? 0;
    } else {
      weekMap.set(week, {
        weekStart: week,
        count: 1,
        totalDurationMinutes: w.durationMinutes ?? 0,
      });
    }
  }
  const weekly = [...weekMap.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  // ---------- recent ----------
  const recent: WorkoutCondensed[] = [...workouts]
    .sort((a, b) => b.start.localeCompare(a.start))
    .slice(0, 50)
    .map((w) => ({
      type: w.type,
      start: w.start,
      durationMinutes: w.durationMinutes ?? 0,
      distance:
        (w.statistics.DistanceWalkingRunning?.sum ?? 0) +
          (w.statistics.DistanceCycling?.sum ?? 0) || null,
      avgHR: w.statistics.HeartRate?.avg ?? null,
      energy: w.statistics.ActiveEnergyBurned?.sum ?? null,
    }));

  // ---------- headline ----------
  const thisWeekStart = weekStartMonday(now.toISOString().slice(0, 10));
  const thisWeek = weekMap.get(thisWeekStart);

  // Streaks: compute a dense daily boolean from the earliest to latest workout date
  let currentStreakDays = 0;
  let longestStreakDays = 0;
  if (workouts.length > 0) {
    const datesWithWorkouts = new Set(workouts.map((w) => w.start.slice(0, 10)));
    const dates = [...datesWithWorkouts].sort();
    if (dates.length > 0) {
      const start = new Date(`${dates[0]}T00:00:00Z`);
      const end = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
      const dayBools: boolean[] = [];
      for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        dayBools.push(datesWithWorkouts.has(d.toISOString().slice(0, 10)));
      }
      currentStreakDays = trailingStreak(dayBools);
      longestStreakDays = longestStreak(dayBools);
    }
  }

  // -----------------------------------------------------------------------
  // Insights
  // -----------------------------------------------------------------------
  const insights: InsightItem[] = [];

  // Total lifetime workout hours
  const totalLifetimeMin = byType.reduce((a, t) => a + t.totalDurationMinutes, 0);
  if (totalLifetimeMin > 0) {
    insights.push({
      label: 'Lifetime workout time',
      value: formatDuration(totalLifetimeMin),
      caption: `${workouts.length.toLocaleString()} sessions`,
      tone: 'neutral',
    });
  }

  // Average per-week (over the spanned weeks)
  if (weekly.length > 0) {
    const avgPerWeek = weekly.reduce((a, w) => a + w.count, 0) / weekly.length;
    insights.push({
      label: 'Average per week',
      value: `${avgPerWeek.toFixed(1)} sessions`,
      caption: `over ${weekly.length.toLocaleString()} weeks`,
      tone: 'neutral',
    });
  }

  // Best week ever (by count)
  if (weekly.length > 0) {
    const best = weekly.reduce((a, b) => (b.count > a.count ? b : a));
    insights.push({
      label: 'Best week',
      value: `${best.count} workouts`,
      caption: `week of ${best.weekStart}`,
      tone: 'good',
    });
  }

  // Most versatile — how many distinct workout types?
  if (byType.length > 0) {
    insights.push({
      label: 'Activity types tried',
      value: byType.length.toString(),
      caption: `most: ${humanizeTypeName(byType[0].type)}`,
      tone: 'neutral',
    });
  }

  // Top 3 by time (distinct from favorite-by-count)
  if (byType.length > 0) {
    const byTime = [...byType].sort((a, b) => b.totalDurationMinutes - a.totalDurationMinutes);
    insights.push({
      label: 'Most time spent on',
      value: humanizeTypeName(byTime[0].type),
      caption: formatDuration(byTime[0].totalDurationMinutes),
      tone: 'neutral',
    });
  }

  // Derive a distance unit from the first workout that has one. All
  // workouts for a single person use the same unit system (mi or km).
  let distanceUnit: string | null = null;
  for (const w of workouts) {
    const wrUnit = w.statistics.DistanceWalkingRunning?.unit;
    const cyUnit = w.statistics.DistanceCycling?.unit;
    if (wrUnit) {
      distanceUnit = wrUnit;
      break;
    }
    if (cyUnit) {
      distanceUnit = cyUnit;
      break;
    }
  }

  // Biggest distance total across all running/walking/cycling
  const totalDist = byType.reduce((a, t) => a + (t.totalDistance ?? 0), 0);
  if (totalDist > 0) {
    insights.push({
      label: 'Total distance covered',
      value: `${totalDist.toFixed(1)} ${distanceUnit ?? ''}`.trim(),
      caption: 'running + cycling',
      tone: 'neutral',
    });
  }

  // -----------------------------------------------------------------------
  // Period summaries
  // -----------------------------------------------------------------------
  const periodRanges = buildPeriodRanges(now);
  const periods: PeriodSummary[] = periodRanges.map(({ current, previous }) => {
    const curWorkouts = workouts.filter((w) => {
      const d = w.start.slice(0, 10);
      return d >= current.start && d <= current.end;
    });
    const prevWorkouts = workouts.filter((w) => {
      const d = w.start.slice(0, 10);
      return d >= previous.start && d <= previous.end;
    });

    const curCount = curWorkouts.length;
    const prevCount = prevWorkouts.length;
    const curMinutes = curWorkouts.reduce((a, w) => a + (w.durationMinutes ?? 0), 0);
    const prevMinutes = prevWorkouts.reduce((a, w) => a + (w.durationMinutes ?? 0), 0);

    return {
      name: current.name,
      start: current.start,
      end: current.end,
      stats: [
        {
          label: 'Sessions',
          value: curCount,
          formatted: `${curCount}`,
          prevValue: prevCount > 0 ? prevCount : null,
          deltaPct: prevCount > 0 ? pctChange(curCount, prevCount) : null,
        },
        {
          label: 'Total time',
          value: curMinutes,
          formatted: formatDuration(curMinutes),
          prevValue: prevMinutes > 0 ? prevMinutes : null,
          deltaPct: prevMinutes > 0 ? pctChange(curMinutes, prevMinutes) : null,
        },
      ],
    };
  });

  return {
    byType,
    weekly,
    recent,
    headline: {
      totalWorkouts: workouts.length,
      thisWeekCount: thisWeek?.count ?? 0,
      thisWeekMinutes: thisWeek?.totalDurationMinutes ?? 0,
      currentStreakDays,
      longestStreakDays,
      favoriteType: byType.length > 0 ? byType[0].type : null,
    },
    insights,
    periods,
    distanceUnit,
  };
}

export function computeBodySnapshot(
  summary: AppleHealthSummary,
  now: Date = new Date()
): BodySnapshot {
  const days = sortedDays(summary);
  const LB_PER_KG = 2.20462;

  // Weight history: take the last BodyMass value each day that has one
  const weightHistory: WeightPoint[] = [];
  for (const day of days) {
    const mass = day.numeric.BodyMass;
    if (!mass || mass.count === 0) continue;
    const unit = mass.unit?.toLowerCase();
    const lastValue = mass.last;
    const kg = unit === 'lb' ? lastValue / LB_PER_KG : lastValue;
    const lb = unit === 'lb' ? lastValue : lastValue * LB_PER_KG;
    weightHistory.push({
      date: day.date,
      kg: Math.round(kg * 100) / 100,
      lb: Math.round(lb * 100) / 100,
    });
  }

  // Height: take the most recent value
  let heightCm: number | null = null;
  let heightIn: number | null = null;
  for (let i = days.length - 1; i >= 0; i--) {
    const h = days[i].numeric.Height;
    if (h && h.count > 0) {
      const unit = h.unit?.toLowerCase();
      heightCm = unit === 'cm' ? h.last : unit === 'm' ? h.last * 100 : h.last * 30.48;
      heightIn = unit === 'in' ? h.last : unit === 'ft' ? h.last * 12 : (heightCm ?? 0) / 2.54;
      break;
    }
  }

  // Headline deltas
  const currentKg = weightHistory.length > 0 ? weightHistory[weightHistory.length - 1].kg : null;
  const currentLb = weightHistory.length > 0 ? weightHistory[weightHistory.length - 1].lb : null;

  const weightOnDate = (target: string): number | null => {
    // Find the closest measurement on or before the target date
    for (let i = weightHistory.length - 1; i >= 0; i--) {
      if (weightHistory[i].date <= target) return weightHistory[i].kg;
    }
    return null;
  };

  let change30d: number | null = null;
  let change1y: number | null = null;
  if (currentKg !== null && weightHistory.length > 0) {
    const latest = new Date(`${weightHistory[weightHistory.length - 1].date}T00:00:00Z`);
    const d30 = new Date(latest);
    d30.setUTCDate(d30.getUTCDate() - 30);
    const d365 = new Date(latest);
    d365.setUTCDate(d365.getUTCDate() - 365);
    const w30 = weightOnDate(d30.toISOString().slice(0, 10));
    const w365 = weightOnDate(d365.toISOString().slice(0, 10));
    change30d = w30 !== null ? Math.round((currentKg - w30) * 100) / 100 : null;
    change1y = w365 !== null ? Math.round((currentKg - w365) * 100) / 100 : null;
  }

  // -----------------------------------------------------------------------
  // Insights
  // -----------------------------------------------------------------------
  const insights: InsightItem[] = [];

  if (weightHistory.length > 0) {
    // Min and max weight observed
    const minWeight = weightHistory.reduce((a, b) => (b.lb < a.lb ? b : a));
    const maxWeight = weightHistory.reduce((a, b) => (b.lb > a.lb ? b : a));
    if (minWeight.date !== maxWeight.date) {
      insights.push({
        label: 'Observed weight range',
        value: `${minWeight.lb.toFixed(1)}–${maxWeight.lb.toFixed(1)} lb`,
        caption: `${(maxWeight.lb - minWeight.lb).toFixed(1)} lb spread`,
        tone: 'neutral',
      });
    }

    // Span of tracking (first to last measurement)
    const first = weightHistory[0];
    const last = weightHistory[weightHistory.length - 1];
    const daysSpan = Math.round(
      (new Date(`${last.date}T00:00:00Z`).getTime() -
        new Date(`${first.date}T00:00:00Z`).getTime()) /
        86_400_000
    );
    const yearsSpan = daysSpan / 365.25;
    insights.push({
      label: 'Weight tracking span',
      value: yearsSpan >= 1 ? `${yearsSpan.toFixed(1)} years` : `${daysSpan} days`,
      caption: `${weightHistory.length.toLocaleString()} measurement${weightHistory.length === 1 ? '' : 's'}`,
      tone: 'neutral',
    });

    // Net change over the entire history
    const netDelta = last.lb - first.lb;
    insights.push({
      label: 'Net change since start',
      value: `${netDelta >= 0 ? '+' : ''}${netDelta.toFixed(1)} lb`,
      caption: `${first.lb.toFixed(1)} → ${last.lb.toFixed(1)} lb`,
      tone: Math.abs(netDelta) < 2 ? 'good' : 'neutral',
    });
  }

  if (heightCm !== null && currentKg !== null) {
    const bmi = currentKg / Math.pow(heightCm / 100, 2);
    insights.push({
      label: 'Current BMI',
      value: bmi.toFixed(1),
      caption: bmi < 18.5 ? 'underweight' : bmi < 25 ? 'normal' : bmi < 30 ? 'overweight' : 'obese',
      tone: bmi >= 18.5 && bmi < 25 ? 'good' : 'neutral',
    });
  }

  // -----------------------------------------------------------------------
  // Period summaries
  // -----------------------------------------------------------------------
  const periodRanges = buildPeriodRanges(now);
  const periods: PeriodSummary[] = periodRanges.map(({ current, previous }) => {
    const curWeights = inRange(weightHistory, current.start, current.end);
    const prevWeights = inRange(weightHistory, previous.start, previous.end);

    const curAvg =
      curWeights.length > 0 ? curWeights.reduce((a, w) => a + w.lb, 0) / curWeights.length : 0;
    const prevAvg =
      prevWeights.length > 0 ? prevWeights.reduce((a, w) => a + w.lb, 0) / prevWeights.length : 0;

    return {
      name: current.name,
      start: current.start,
      end: current.end,
      stats: [
        {
          label: 'Avg weight',
          value: curAvg,
          formatted: curAvg > 0 ? `${curAvg.toFixed(1)} lb` : '—',
          prevValue: prevAvg > 0 ? prevAvg : null,
          deltaPct: prevAvg > 0 ? pctChange(curAvg, prevAvg) : null,
        },
      ],
    };
  });

  return {
    weightHistory,
    heightCm: heightCm !== null ? Math.round(heightCm * 10) / 10 : null,
    heightIn: heightIn !== null ? Math.round(heightIn * 10) / 10 : null,
    headline: { currentKg, currentLb, change30d, change1y },
    insights,
    periods,
  };
}

// ===========================================================================
// Top-level compose
// ===========================================================================

/**
 * Overlay a list of deltas onto a summary, returning a *new* summary with
 * the delta metrics patched in. The original summary is not mutated.
 *
 * Merge rules:
 *   - For each delta file, find the day in `dailySummaries` matching
 *     `delta.date`. If the day doesn't exist yet (shortcut ran for a date
 *     past the bulk export's range), create a fresh `DailySummary` for it.
 *   - For each metric in `delta.metrics`, replace the corresponding entry
 *     in `day.numeric[type]` entirely with a NumericAggregate built from
 *     the delta's fields. Delta wins over the parser's baseline.
 *   - Missing NumericAggregate fields are filled with defaults: count=1,
 *     sum=0 (or the scalar equivalent), etc. Enough to satisfy downstream
 *     aggregators without lying about what the shortcut actually reported.
 */
export function overlayDeltas(
  summary: AppleHealthSummary,
  deltas: readonly DeltaFile[]
): AppleHealthSummary {
  if (deltas.length === 0) return summary;

  // Shallow-clone the dailySummaries map; we replace individual days
  // as needed rather than deep-cloning everything up front.
  const newDaily: Record<string, DailySummary> = { ...summary.dailySummaries };
  const newDateRange = {
    start: summary.dateRange.start,
    end: summary.dateRange.end,
  };
  let newTotal = summary.recordCounts.totalRecords;

  for (const delta of deltas) {
    const existing = newDaily[delta.date];
    // Clone just this day so we don't mutate the caller's summary
    const dayCopy: DailySummary = existing
      ? { date: delta.date, numeric: { ...existing.numeric }, category: { ...existing.category } }
      : { date: delta.date, numeric: {}, category: {} };

    for (const [type, m] of Object.entries(delta.metrics)) {
      // Build a full NumericAggregate from whatever fields the shortcut sent.
      // Preference order for the single-value fallback: sum, avg, last, min, max.
      const fallback = m.sum ?? m.avg ?? m.last ?? m.min ?? m.max ?? 0;
      const count = m.count ?? 1;
      const sum = m.sum ?? (m.avg !== undefined ? m.avg * count : fallback);
      dayCopy.numeric[type] = {
        count,
        sum,
        min: m.min ?? fallback,
        max: m.max ?? fallback,
        first: m.last ?? fallback,
        last: m.last ?? fallback,
        unit: m.unit,
      };
    }

    newDaily[delta.date] = dayCopy;

    // Extend the date range if the delta is outside the original span
    if (!newDateRange.start || delta.date < newDateRange.start) newDateRange.start = delta.date;
    if (!newDateRange.end || delta.date > newDateRange.end) newDateRange.end = delta.date;
    // Bump record count — the delta represents "at least one record worth of data"
    if (!existing) newTotal += 1;
  }

  return {
    ...summary,
    dailySummaries: newDaily,
    dateRange: newDateRange,
    recordCounts: {
      ...summary.recordCounts,
      totalRecords: newTotal,
    },
  };
}

/**
 * Compute all snapshots for a parsed summary. Pure — call this whenever
 * the source summary changes, or backfill existing summaries in the store.
 *
 * The returned snapshot inherits `parserVersion` from the source summary
 * so the UI can detect when a cached snapshot was produced by an older
 * parser (and therefore may be missing data a newer parser would capture).
 *
 * @param deltas optional DeltaFile[] from shortcut-posted daily data.
 *               Overlaid on the summary before segment computation.
 */
export function computeSnapshots(
  summary: AppleHealthSummary,
  sourceFilename: string,
  now: Date = new Date(),
  deltas: readonly DeltaFile[] = []
): PersonSnapshots {
  const merged = overlayDeltas(summary, deltas);
  const activity = computeActivitySnapshot(merged, now);
  const heart = computeHeartSnapshot(merged, now);
  const sleep = computeSleepSnapshot(merged, now);
  const workouts = computeWorkoutsSnapshot(merged, now);
  const body = computeBodySnapshot(merged, now);

  // Cross-segment: compute recovery scores (needs activity + heart + sleep)
  activity.recoveryScores = computeRecoveryScores(activity.daily, heart.daily, sleep.daily);

  // Cross-segment: detect illness periods
  const illnessPeriods = detectIllnessPeriods(activity.daily, heart.daily, sleep.daily);

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    sourceFilename,
    parserVersion: merged.parserVersion,
    activity,
    heart,
    sleep,
    workouts,
    body,
    illnessPeriods,
  };
}
