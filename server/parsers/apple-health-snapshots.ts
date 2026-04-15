// Apple Health snapshot computer.
//
// Pure function over an already-parsed AppleHealthSummary. Produces a
// PersonSnapshots object with five segment views (Activity, Heart, Sleep,
// Workouts, Body) that the UI consumes directly — no further aggregation
// needed on the client.
//
// All helpers are exported for unit testing. Do not add I/O to this module.

import type { AppleHealthSummary, DailySummary, WorkoutEntry } from './apple-health.js';

export const SNAPSHOT_SCHEMA_VERSION = 1;
export const SNAPSHOT_VERSION = '1.0.0';

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
}

export interface PersonSnapshots {
  schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION;
  generatedAt: string;
  sourceFilename: string;
  parserVersion: string;
  activity: ActivitySnapshot;
  heart: HeartSnapshot;
  sleep: SleepSnapshot;
  workouts: WorkoutsSnapshot;
  body: BodySnapshot;
}

export type HealthSegment = 'activity' | 'heart' | 'sleep' | 'workouts' | 'body';

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
// Segment computers
// ===========================================================================

/** Get all days sorted ascending. */
function sortedDays(summary: AppleHealthSummary): DailySummary[] {
  return Object.values(summary.dailySummaries).sort((a, b) => a.date.localeCompare(b.date));
}

export function computeActivitySnapshot(summary: AppleHealthSummary): ActivitySnapshot {
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
    distanceUnit,
  };
}

export function computeHeartSnapshot(summary: AppleHealthSummary): HeartSnapshot {
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
  };
}

export function computeSleepSnapshot(summary: AppleHealthSummary): SleepSnapshot {
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
  };
}

export function computeBodySnapshot(summary: AppleHealthSummary): BodySnapshot {
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

  return {
    weightHistory,
    heightCm: heightCm !== null ? Math.round(heightCm * 10) / 10 : null,
    heightIn: heightIn !== null ? Math.round(heightIn * 10) / 10 : null,
    headline: { currentKg, currentLb, change30d, change1y },
  };
}

// ===========================================================================
// Top-level compose
// ===========================================================================

/**
 * Compute all snapshots for a parsed summary. Pure — call this whenever
 * the source summary changes, or backfill existing summaries in the store.
 */
export function computeSnapshots(
  summary: AppleHealthSummary,
  sourceFilename: string,
  now: Date = new Date()
): PersonSnapshots {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    sourceFilename,
    parserVersion: SNAPSHOT_VERSION,
    activity: computeActivitySnapshot(summary),
    heart: computeHeartSnapshot(summary),
    sleep: computeSleepSnapshot(summary),
    workouts: computeWorkoutsSnapshot(summary, now),
    body: computeBodySnapshot(summary),
  };
}
