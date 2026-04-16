// Apple Health export parser.
//
// Standalone (NOT a DocumentParser / registry entry) because:
//  - Input is a multi-hundred-MB zip containing XML, not a PDF
//  - Output is thousands of daily summaries + workouts, not a single record
//  - No LLM involvement — pure streaming aggregation
//
// Invoked directly by the /api/health/:personId/parse-export endpoint.
//
// Memory strategy:
//  1. Read 80 MB zip into memory (fine)
//  2. fflate.unzipSync with filter extracts ONLY export.xml (skipping
//     export_cda.xml ~672 MB and workout-routes ~208 MB)
//  3. Write decompressed XML (~976 MB typical upper bound) to a temp file
//  4. Free the in-memory copy, stream-parse the temp file with sax
//  5. Delete the temp directory when done
//
// Aggregation is generic over type:
//   per (date, type) → { count, sum, min, max, first, last, unit }
// Category records (e.g. SleepAnalysis where `value` is a string) are tracked
// separately in a `valueCounts` map keyed by the value string.

import { promises as fs, createReadStream } from 'fs';
import path from 'path';
import { unzipSync } from 'fflate';
import * as sax from 'sax';
import { createLogger } from '../logger.js';

const log = createLogger('AppleHealth');

// ---------------------------------------------------------------------------
// Output shape
// ---------------------------------------------------------------------------

/** Numeric-metric aggregation for a single (date, type) cell. */
export interface NumericAggregate {
  count: number;
  sum: number;
  min: number;
  max: number;
  first: number;
  last: number;
  unit?: string;
}

/**
 * Category-metric aggregation (e.g. SleepAnalysis values are strings).
 *
 * `count` / `valueCounts` track how many records landed on this day.
 * `totalDurationMinutes` / `valueDurationMinutes` track how many minutes
 * the category occupied (endDate − startDate, summed). Sleep stages use
 * this to give "X hours of deep sleep last night" rather than "N sleep
 * records last night."
 */
export interface CategoryAggregate {
  count: number;
  valueCounts: Record<string, number>;
  totalDurationMinutes: number;
  valueDurationMinutes: Record<string, number>;
}

/**
 * Per-day summary. `numeric[type]` holds quantity-type aggregates,
 * `category[type]` holds category-type aggregates.
 */
export interface DailySummary {
  date: string; // YYYY-MM-DD
  numeric: Record<string, NumericAggregate>;
  category: Record<string, CategoryAggregate>;
}

/** ActivitySummary row — Apple's pre-aggregated daily activity ring data. */
export interface ActivitySummaryRow {
  date: string; // YYYY-MM-DD
  activeEnergyBurned?: number;
  activeEnergyBurnedGoal?: number;
  activeEnergyBurnedUnit?: string;
  appleMoveTime?: number;
  appleMoveTimeGoal?: number;
  appleExerciseTime?: number;
  appleExerciseTimeGoal?: number;
  appleStandHours?: number;
  appleStandHoursGoal?: number;
}

/** One workout with all its top-level fields. */
export interface WorkoutEntry {
  type: string; // e.g. "HKWorkoutActivityTypeRunning" → we strip the prefix
  start: string; // ISO-ish
  end: string;
  durationMinutes?: number;
  sourceName?: string;
  // WorkoutStatistics children collapsed into a flat map
  // e.g. { "ActiveEnergyBurned": { sum: 305.4, unit: "Cal" }, ... }
  statistics: Record<
    string,
    { sum?: number; min?: number; max?: number; avg?: number; unit?: string }
  >;
  metadata: Record<string, string>;
}

/** The `<Me>` element — one-time profile characteristics. */
export interface ProfileCharacteristics {
  dateOfBirth?: string;
  biologicalSex?: string;
  bloodType?: string;
  fitzpatrickSkinType?: string;
  cardioFitnessMedicationsUse?: string;
}

/** Final parser output. */
export interface AppleHealthSummary {
  schemaVersion: 1;
  exportDate?: string;
  profile: ProfileCharacteristics;
  dateRange: { start: string | null; end: string | null };
  recordCounts: {
    totalRecords: number;
    totalWorkouts: number;
    totalActivitySummaries: number;
    // Per-type counts so the UI can show "how much of what" without loading
    // the full per-day map
    byType: Record<string, number>;
  };
  typesSeen: {
    numeric: string[]; // HK type identifiers (stripped of prefix)
    category: string[];
  };
  dailySummaries: Record<string, DailySummary>; // keyed by date
  activitySummaries: ActivitySummaryRow[];
  workouts: WorkoutEntry[];
  parseDurationMs: number;
  parserVersion: string;
}

/**
 * Parser version. Bump this whenever the parse *pipeline* changes in a way
 * that invalidates cached summaries — so consumers (the snapshot computer,
 * the UI staleness banner, the Records tab) can detect that a re-parse is
 * needed. This tracks the whole pipeline, not just this file — bumping it
 * for changes in sibling parsers (e.g. clinical-records) is correct because
 * /parse-export runs the full pipeline end-to-end.
 *
 * History:
 *   1.0.0 — initial release
 *   1.1.0 — category duration tracking, sleep end-date attribution,
 *           HKCategoryValue* prefix stripping, explicit timezone parsing
 *   1.2.0 — parse pipeline now also ingests `apple_health_export/
 *           clinical-records/` (FHIR R4) into a parallel ClinicalSummary.
 *           Bumped so cached summaries from 1.1.0 surface the staleness
 *           banner and a single Re-parse click backfills clinical data.
 */
export const PARSER_VERSION = '1.2.0';

// ---------------------------------------------------------------------------
// Internal parse state
// ---------------------------------------------------------------------------

interface ParseState {
  exportDate?: string;
  profile: ProfileCharacteristics;
  dateRange: { start: string | null; end: string | null };
  days: Map<string, DailySummary>;
  activitySummaries: ActivitySummaryRow[];
  workouts: WorkoutEntry[];
  byType: Map<string, number>;
  totalRecords: number;
  currentWorkout: WorkoutEntry | null;
}

function createInitialState(): ParseState {
  return {
    exportDate: undefined,
    profile: {},
    dateRange: { start: null, end: null },
    days: new Map(),
    activitySummaries: [],
    workouts: [],
    byType: new Map(),
    totalRecords: 0,
    currentWorkout: null,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract YYYY-MM-DD from an Apple Health date like "2018-04-29 13:06:32 -0500". */
function extractDate(value: string | undefined): string | null {
  if (!value || value.length < 10) return null;
  const slice = value.slice(0, 10);
  // Simple validation — must look like a date
  if (!/^\d{4}-\d{2}-\d{2}$/.test(slice)) return null;
  return slice;
}

/**
 * HealthKit prefixes we strip for readability.
 *
 * Order matters: more specific prefixes (like `HKCategoryValueSleepAnalysis`)
 * must come before their parent (`HKCategoryValue`), so the strip function
 * removes the longest matching prefix first.
 */
const HK_PREFIXES = [
  'HKQuantityTypeIdentifier',
  'HKCategoryTypeIdentifier',
  'HKCharacteristicTypeIdentifier',
  'HKDataType',
  'HKWorkoutActivityType',
  // Category value prefixes — applied to `value` attributes on category
  // records so sleep stages show up as "AsleepDeep" rather than
  // "HKCategoryValueSleepAnalysisAsleepDeep".
  'HKCategoryValueSleepAnalysis',
  'HKCategoryValueAppleStandHour',
  'HKCategoryValue',
];

function stripPrefix(identifier: string): string {
  for (const prefix of HK_PREFIXES) {
    if (identifier.startsWith(prefix)) {
      return identifier.slice(prefix.length);
    }
  }
  return identifier;
}

function ensureDay(state: ParseState, date: string): DailySummary {
  let day = state.days.get(date);
  if (!day) {
    day = { date, numeric: {}, category: {} };
    state.days.set(date, day);
  }
  return day;
}

function updateDateRange(state: ParseState, date: string): void {
  if (!state.dateRange.start || date < state.dateRange.start) {
    state.dateRange.start = date;
  }
  if (!state.dateRange.end || date > state.dateRange.end) {
    state.dateRange.end = date;
  }
}

function bumpTypeCount(state: ParseState, type: string): void {
  state.byType.set(type, (state.byType.get(type) ?? 0) + 1);
}

function aggregateNumeric(
  day: DailySummary,
  type: string,
  value: number,
  unit: string | undefined
): void {
  let agg = day.numeric[type];
  if (!agg) {
    agg = {
      count: 0,
      sum: 0,
      min: value,
      max: value,
      first: value,
      last: value,
      unit,
    };
    day.numeric[type] = agg;
  }
  agg.count += 1;
  agg.sum += value;
  if (value < agg.min) agg.min = value;
  if (value > agg.max) agg.max = value;
  agg.last = value;
  // Prefer first non-empty unit we see
  if (!agg.unit && unit) agg.unit = unit;
}

function aggregateCategory(
  day: DailySummary,
  type: string,
  value: string,
  durationMinutes: number
): void {
  let agg = day.category[type];
  if (!agg) {
    agg = {
      count: 0,
      valueCounts: {},
      totalDurationMinutes: 0,
      valueDurationMinutes: {},
    };
    day.category[type] = agg;
  }
  agg.count += 1;
  agg.valueCounts[value] = (agg.valueCounts[value] ?? 0) + 1;
  if (durationMinutes > 0) {
    agg.totalDurationMinutes += durationMinutes;
    agg.valueDurationMinutes[value] = (agg.valueDurationMinutes[value] ?? 0) + durationMinutes;
  }
}

/**
 * Parse an Apple Health timestamp into milliseconds since epoch.
 *
 * Apple's export format is `"YYYY-MM-DD HH:MM:SS ±HHMM"` (space-separated
 * fields, no colon in the timezone offset). Neither `new Date(s)` nor
 * `Date.parse(s)` reliably accepts this format — Node/Bun mostly tolerate
 * it but browsers don't, and the timezone offset without a colon silently
 * returns NaN in some runtimes. So we parse it explicitly with a regex
 * and build a canonical ISO string before handing off to `Date.parse`.
 *
 * Returns `null` for missing/unparseable inputs — callers must check.
 */
export function parseTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-])(\d{2})(\d{2})$/);
  if (!match) {
    // Fall back to Date.parse for anything non-standard (rare)
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  const [, date, time, sign, hh, mm] = match;
  const iso = `${date}T${time}${sign}${hh}:${mm}`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

// ---------------------------------------------------------------------------
// SAX element handlers
// ---------------------------------------------------------------------------

type SaxAttrs = Record<string, string>;

function handleExportDate(state: ParseState, attrs: SaxAttrs): void {
  state.exportDate = attrs.value;
}

function handleMe(state: ParseState, attrs: SaxAttrs): void {
  state.profile = {
    dateOfBirth: attrs.HKCharacteristicTypeIdentifierDateOfBirth || undefined,
    biologicalSex: attrs.HKCharacteristicTypeIdentifierBiologicalSex
      ? stripPrefix(attrs.HKCharacteristicTypeIdentifierBiologicalSex).replace(
          /^HKBiologicalSex/,
          ''
        )
      : undefined,
    bloodType: attrs.HKCharacteristicTypeIdentifierBloodType
      ? attrs.HKCharacteristicTypeIdentifierBloodType.replace(/^HKBloodType/, '')
      : undefined,
    fitzpatrickSkinType: attrs.HKCharacteristicTypeIdentifierFitzpatrickSkinType
      ? attrs.HKCharacteristicTypeIdentifierFitzpatrickSkinType.replace(
          /^HKFitzpatrickSkinType/,
          ''
        )
      : undefined,
    cardioFitnessMedicationsUse:
      attrs.HKCharacteristicTypeIdentifierCardioFitnessMedicationsUse || undefined,
  };
}

function handleRecord(state: ParseState, attrs: SaxAttrs): void {
  state.totalRecords += 1;

  const rawType = attrs.type;
  if (!rawType) return;

  const type = stripPrefix(rawType);
  bumpTypeCount(state, type);

  // Duration (endDate − startDate, in minutes). Missing end = 0-duration
  // record, which is valid for instantaneous measurements like BodyMass.
  const startMs = parseTimestamp(attrs.startDate);
  const endMs = parseTimestamp(attrs.endDate);
  const durationMinutes =
    startMs !== null && endMs !== null && endMs >= startMs ? (endMs - startMs) / 60_000 : 0;

  // Day attribution. For SleepAnalysis records specifically we use the END
  // date: a session from 11 PM Monday to 7 AM Tuesday shows up under
  // Tuesday, matching Apple's "last night's sleep" convention. Everything
  // else uses the START date, same as before.
  const dateSource =
    type === 'SleepAnalysis' ? (attrs.endDate ?? attrs.startDate) : attrs.startDate;
  const date = extractDate(dateSource);
  if (!date) return;

  updateDateRange(state, date);

  const day = ensureDay(state, date);
  const rawValue = attrs.value;

  // Try numeric first
  const numericValue = rawValue !== undefined ? Number(rawValue) : NaN;
  if (rawValue !== undefined && !Number.isNaN(numericValue)) {
    aggregateNumeric(day, type, numericValue, attrs.unit);
  } else if (rawValue !== undefined) {
    // Non-numeric → treat as category
    aggregateCategory(day, type, stripPrefix(rawValue), durationMinutes);
  } else {
    // No value — some event-style records have none. Count as category occurrence.
    aggregateCategory(day, type, '(present)', durationMinutes);
  }
}

function handleActivitySummary(state: ParseState, attrs: SaxAttrs): void {
  const date = attrs.dateComponents;
  if (!date) return;
  // Skip the pre-epoch garbage rows Apple emits (e.g. "1969-12-30")
  if (date < '2000-01-01') return;

  updateDateRange(state, date);

  const num = (k: string): number | undefined => {
    const raw = attrs[k];
    if (raw === undefined) return undefined;
    const n = Number(raw);
    return Number.isNaN(n) ? undefined : n;
  };

  state.activitySummaries.push({
    date,
    activeEnergyBurned: num('activeEnergyBurned'),
    activeEnergyBurnedGoal: num('activeEnergyBurnedGoal'),
    activeEnergyBurnedUnit: attrs.activeEnergyBurnedUnit,
    appleMoveTime: num('appleMoveTime'),
    appleMoveTimeGoal: num('appleMoveTimeGoal'),
    appleExerciseTime: num('appleExerciseTime'),
    appleExerciseTimeGoal: num('appleExerciseTimeGoal'),
    appleStandHours: num('appleStandHours'),
    appleStandHoursGoal: num('appleStandHoursGoal'),
  });
}

function handleWorkoutOpen(state: ParseState, attrs: SaxAttrs): void {
  const workoutType = attrs.workoutActivityType
    ? stripPrefix(attrs.workoutActivityType)
    : 'Unknown';
  const duration = attrs.duration ? Number(attrs.duration) : undefined;

  state.currentWorkout = {
    type: workoutType,
    start: attrs.startDate ?? '',
    end: attrs.endDate ?? '',
    durationMinutes:
      duration !== undefined && !Number.isNaN(duration)
        ? attrs.durationUnit === 'min'
          ? duration
          : // Assume seconds if not min; convert
            duration / 60
        : undefined,
    sourceName: attrs.sourceName,
    statistics: {},
    metadata: {},
  };

  // Feed the start date into the date range tracker
  const date = extractDate(attrs.startDate);
  if (date) updateDateRange(state, date);
}

function handleWorkoutStatistics(state: ParseState, attrs: SaxAttrs): void {
  if (!state.currentWorkout) return;
  const rawType = attrs.type;
  if (!rawType) return;
  const type = stripPrefix(rawType);

  const num = (k: string): number | undefined => {
    const raw = attrs[k];
    if (raw === undefined) return undefined;
    const n = Number(raw);
    return Number.isNaN(n) ? undefined : n;
  };

  state.currentWorkout.statistics[type] = {
    sum: num('sum'),
    min: num('min'),
    max: num('max'),
    avg: num('average'),
    unit: attrs.unit,
  };
}

function handleMetadataEntry(state: ParseState, attrs: SaxAttrs): void {
  // Only capture metadata when we're inside a workout (cheap + high-value).
  // Record-level metadata is skipped to keep output size sane.
  if (!state.currentWorkout) return;
  if (attrs.key && attrs.value !== undefined) {
    state.currentWorkout.metadata[attrs.key] = attrs.value;
  }
}

function handleWorkoutClose(state: ParseState): void {
  if (state.currentWorkout) {
    state.workouts.push(state.currentWorkout);
    state.currentWorkout = null;
  }
}

// ---------------------------------------------------------------------------
// Stream-parse an XML file on disk
// ---------------------------------------------------------------------------

async function parseXmlStream(xmlPath: string): Promise<ParseState> {
  const state = createInitialState();
  const parser = sax.createStream(true, { trim: false, normalize: false });

  parser.on('opentag', (node: { name: string; attributes: SaxAttrs }) => {
    const attrs = node.attributes;
    switch (node.name) {
      case 'ExportDate':
        handleExportDate(state, attrs);
        break;
      case 'Me':
        handleMe(state, attrs);
        break;
      case 'Record':
        handleRecord(state, attrs);
        break;
      case 'ActivitySummary':
        handleActivitySummary(state, attrs);
        break;
      case 'Workout':
        handleWorkoutOpen(state, attrs);
        break;
      case 'WorkoutStatistics':
        handleWorkoutStatistics(state, attrs);
        break;
      case 'MetadataEntry':
        handleMetadataEntry(state, attrs);
        break;
      default:
        // Ignore: Correlation, WorkoutEvent, WorkoutRoute, ClinicalRecord,
        // Audiogram, VisionPrescription, HeartRateVariabilityMetadataList, etc.
        break;
    }
  });

  parser.on('closetag', (name: string) => {
    if (name === 'Workout') handleWorkoutClose(state);
  });

  return new Promise<ParseState>((resolve, reject) => {
    parser.on('end', () => resolve(state));
    parser.on('error', (err: Error) => {
      log.error(`SAX parse error: ${err.message}`);
      reject(err);
    });
    createReadStream(xmlPath).on('error', reject).pipe(parser);
  });
}

// ---------------------------------------------------------------------------
// Build final summary from accumulated state
// ---------------------------------------------------------------------------

function buildSummary(state: ParseState, parseDurationMs: number): AppleHealthSummary {
  const numericTypes = new Set<string>();
  const categoryTypes = new Set<string>();

  for (const day of state.days.values()) {
    for (const t of Object.keys(day.numeric)) numericTypes.add(t);
    for (const t of Object.keys(day.category)) categoryTypes.add(t);
  }

  const byType: Record<string, number> = {};
  for (const [k, v] of state.byType) byType[k] = v;

  const dailySummaries: Record<string, DailySummary> = {};
  for (const [date, day] of state.days) dailySummaries[date] = day;

  // Sort activity summaries by date for deterministic output
  state.activitySummaries.sort((a, b) => a.date.localeCompare(b.date));
  // Sort workouts by start date
  state.workouts.sort((a, b) => a.start.localeCompare(b.start));

  return {
    schemaVersion: 1,
    exportDate: state.exportDate,
    profile: state.profile,
    dateRange: state.dateRange,
    recordCounts: {
      totalRecords: state.totalRecords,
      totalWorkouts: state.workouts.length,
      totalActivitySummaries: state.activitySummaries.length,
      byType,
    },
    typesSeen: {
      numeric: [...numericTypes].sort(),
      category: [...categoryTypes].sort(),
    },
    dailySummaries,
    activitySummaries: state.activitySummaries,
    workouts: state.workouts,
    parseDurationMs,
    parserVersion: PARSER_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/**
 * Extract `apple_health_export/export.xml` from a zip and write it to `xmlPath`.
 * Skips all other members (CDA, workout routes, ECGs, attachments). Safe to
 * call repeatedly — if `xmlPath` already exists and is newer than `zipPath`,
 * this is a no-op and returns `false`.
 *
 * @returns `true` if the XML was freshly extracted, `false` if an up-to-date
 *          cache was already present.
 */
export async function extractAppleHealthXml(zipPath: string, xmlPath: string): Promise<boolean> {
  // Cache check: if the XML is already on disk and newer than the zip, skip
  // the expensive unzip entirely.
  try {
    const [xmlStat, zipStat] = await Promise.all([fs.stat(xmlPath), fs.stat(zipPath)]);
    if (xmlStat.mtimeMs >= zipStat.mtimeMs) {
      log.info(`Cached XML is up-to-date: ${xmlPath}`);
      return false;
    }
  } catch {
    // XML doesn't exist yet; fall through and extract
  }

  log.info(`Extracting XML from zip: ${zipPath}`);
  const zipBuffer = await fs.readFile(zipPath);
  log.info(`Zip loaded: ${(zipBuffer.length / 1024 / 1024).toFixed(1)} MB`);

  // Decompress ONLY export.xml via filter — avoids decompressing the CDA
  // file (~672 MB) and workout-routes folder (~208 MB) we don't need.
  const extracted = unzipSync(new Uint8Array(zipBuffer), {
    filter: (file) => file.name === 'apple_health_export/export.xml',
  });

  const xmlBytes = extracted['apple_health_export/export.xml'];
  if (!xmlBytes) {
    throw new Error(
      "Invalid Apple Health export: 'apple_health_export/export.xml' not found in zip"
    );
  }
  log.info(`Extracted export.xml: ${(xmlBytes.length / 1024 / 1024).toFixed(1)} MB`);

  // Write to final destination atomically (temp + rename) so an interrupted
  // extract never leaves a truncated cache file.
  await fs.mkdir(path.dirname(xmlPath), { recursive: true });
  const tmp = `${xmlPath}.tmp-${Date.now()}`;
  await fs.writeFile(tmp, Buffer.from(xmlBytes));
  await fs.rename(tmp, xmlPath);
  log.info(`Wrote XML cache: ${xmlPath}`);
  return true;
}

/**
 * Parse an already-extracted Apple Health `export.xml` file into an aggregated
 * summary. This is the hot path — skip straight here if the XML is already on
 * disk (e.g. from a prior `extractAppleHealthXml` call) to avoid the unzip
 * step.
 */
export async function parseAppleHealthXml(xmlPath: string): Promise<AppleHealthSummary> {
  const parseStart = Date.now();
  const state = await parseXmlStream(xmlPath);
  const parseMs = Date.now() - parseStart;
  log.info(
    `Parsed ${state.totalRecords} records, ${state.workouts.length} workouts, ` +
      `${state.activitySummaries.length} activity summaries in ${parseMs} ms`
  );
  return buildSummary(state, parseMs);
}

/**
 * Convenience: extract (if needed) and parse in one call. The XML is
 * persisted next to the zip at `<basename>.xml` so subsequent re-parses
 * skip the unzip step and so DocVault's data-dir backups capture both
 * the compressed source and the decompressed working copy.
 *
 * @param zipPath  Absolute path to the `export.zip`.
 */
export async function parseAppleHealthExport(zipPath: string): Promise<AppleHealthSummary> {
  const xmlPath = `${zipPath.replace(/\.zip$/i, '')}.xml`;
  await extractAppleHealthXml(zipPath, xmlPath);
  return parseAppleHealthXml(xmlPath);
}
