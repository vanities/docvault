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

/** Category-metric aggregation (e.g. SleepAnalysis values are strings). */
export interface CategoryAggregate {
  count: number;
  valueCounts: Record<string, number>;
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

const PARSER_VERSION = '1.0.0';

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

/** HealthKit prefixes we strip for readability. */
const HK_PREFIXES = [
  'HKQuantityTypeIdentifier',
  'HKCategoryTypeIdentifier',
  'HKDataType',
  'HKWorkoutActivityType',
  'HKCharacteristicTypeIdentifier',
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

function aggregateCategory(day: DailySummary, type: string, value: string): void {
  let agg = day.category[type];
  if (!agg) {
    agg = { count: 0, valueCounts: {} };
    day.category[type] = agg;
  }
  agg.count += 1;
  agg.valueCounts[value] = (agg.valueCounts[value] ?? 0) + 1;
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

  const date = extractDate(attrs.startDate);
  if (!date) return;

  updateDateRange(state, date);

  const type = stripPrefix(rawType);
  bumpTypeCount(state, type);

  const day = ensureDay(state, date);
  const rawValue = attrs.value;

  // Try numeric first
  const numericValue = rawValue !== undefined ? Number(rawValue) : NaN;
  if (rawValue !== undefined && !Number.isNaN(numericValue)) {
    aggregateNumeric(day, type, numericValue, attrs.unit);
  } else if (rawValue !== undefined) {
    // Non-numeric → treat as category
    aggregateCategory(day, type, stripPrefix(rawValue));
  } else {
    // No value — some event-style records have none. Count as category occurrence.
    aggregateCategory(day, type, '(present)');
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
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Parse an Apple Health `export.zip` into an aggregated summary.
 *
 * The zip is expected to contain `apple_health_export/export.xml`. Other
 * members (CDA, workout routes, ECGs, clinical records, attachments) are
 * ignored in v1.
 *
 * @param zipPath  Absolute path to the `export.zip`.
 * @param tmpDir   Directory in which to write the transient decompressed XML
 *                 (~1 GB peak for a full 8-year export). Callers should pass
 *                 a path on real disk (e.g. `DATA_DIR/health/.tmp/`) rather
 *                 than `os.tmpdir()`, which is tmpfs on many Linux systems
 *                 and would count against RAM.
 */
export async function parseAppleHealthExport(
  zipPath: string,
  tmpDir: string
): Promise<AppleHealthSummary> {
  const startTime = Date.now();
  log.info(`Reading zip: ${zipPath}`);

  // Step 1: read zip into memory (80 MB typical)
  const zipBuffer = await fs.readFile(zipPath);
  log.info(`Zip loaded: ${(zipBuffer.length / 1024 / 1024).toFixed(1)} MB`);

  // Step 2: decompress ONLY export.xml via filter
  // Spike: ~1 GB for a full export during this call
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

  // Step 3: write to temp file on real disk so we can stream-parse without
  //         holding the decompressed string in memory
  await fs.mkdir(tmpDir, { recursive: true });
  const tmpXml = path.join(
    tmpDir,
    `export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.xml`
  );
  await fs.writeFile(tmpXml, Buffer.from(xmlBytes));
  log.info(`Wrote temp XML: ${tmpXml}`);

  try {
    // Step 4: stream-parse from disk
    const parseStart = Date.now();
    const state = await parseXmlStream(tmpXml);
    const parseMs = Date.now() - parseStart;
    log.info(
      `Parsed ${state.totalRecords} records, ${state.workouts.length} workouts, ` +
        `${state.activitySummaries.length} activity summaries in ${parseMs} ms`
    );

    const totalMs = Date.now() - startTime;
    return buildSummary(state, totalMs);
  } finally {
    // Step 5: always clean up the temp file (directory may contain other
    // in-flight parses from concurrent uploads, so we only unlink our file)
    await fs.rm(tmpXml, { force: true });
    log.info(`Cleaned up ${tmpXml}`);
  }
}
