// Frontend-side mirror of server/parsers/apple-health.ts and
// server/parsers/apple-health-snapshots.ts output shapes.
// Kept in sync by hand — if you change either server module, update this.

// ===========================================================================
// Raw parsed summary (produced by apple-health.ts parser)
// ===========================================================================

export interface NumericAggregate {
  count: number;
  sum: number;
  min: number;
  max: number;
  first: number;
  last: number;
  unit?: string;
}

export interface CategoryAggregate {
  count: number;
  valueCounts: Record<string, number>;
  totalDurationMinutes: number;
  valueDurationMinutes: Record<string, number>;
}

export interface DailySummary {
  date: string;
  numeric: Record<string, NumericAggregate>;
  category: Record<string, CategoryAggregate>;
}

export interface ActivitySummaryRow {
  date: string;
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

export interface WorkoutEntry {
  type: string;
  start: string;
  end: string;
  durationMinutes?: number;
  sourceName?: string;
  statistics: Record<
    string,
    { sum?: number; min?: number; max?: number; avg?: number; unit?: string }
  >;
  metadata: Record<string, string>;
}

export interface ProfileCharacteristics {
  dateOfBirth?: string;
  biologicalSex?: string;
  bloodType?: string;
  fitzpatrickSkinType?: string;
  cardioFitnessMedicationsUse?: string;
}

export interface AppleHealthSummary {
  schemaVersion: 1;
  exportDate?: string;
  profile: ProfileCharacteristics;
  dateRange: { start: string | null; end: string | null };
  recordCounts: {
    totalRecords: number;
    totalWorkouts: number;
    totalActivitySummaries: number;
    byType: Record<string, number>;
  };
  typesSeen: {
    numeric: string[];
    category: string[];
  };
  dailySummaries: Record<string, DailySummary>;
  activitySummaries: ActivitySummaryRow[];
  workouts: WorkoutEntry[];
  parseDurationMs: number;
  parserVersion: string;
}

export interface ExportInfo {
  filename: string;
  size: number;
  uploadedAt: string;
  parsed: boolean;
}

// ===========================================================================
// Snapshot shapes (produced by apple-health-snapshots.ts)
// ===========================================================================

/** A computed insight (not a raw metric) — rendered as a stat tile. */
export interface InsightItem {
  label: string;
  value: string;
  caption?: string;
  tone?: 'good' | 'warn' | 'neutral';
}

/** One day in the Activity segment. */
export interface ActivityDay {
  date: string;
  steps: number;
  activeEnergy: number;
  basalEnergy: number;
  exerciseMinutes: number;
  standHours: number;
  distance: number; // in the unit returned by distanceUnit
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
  distanceUnit: string; // "mi" or "km"
}

/** One day in the Heart segment. */
export interface HeartDay {
  date: string;
  restingHR: number | null;
  avgHR: number | null;
  minHR: number | null;
  maxHR: number | null;
  hrv: number | null; // SDNN in ms
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
}

/** One day in the Sleep segment. */
export interface SleepDay {
  date: string; // attributed to the day you woke up
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
}

/** Workouts aggregated by activity type. */
export interface WorkoutTypeAgg {
  type: string;
  count: number;
  totalDurationMinutes: number;
  totalDistance: number | null;
  totalEnergy: number | null;
  avgDurationMinutes: number;
  lastWorkout: string;
}

/** One week in the Workouts segment. */
export interface WorkoutWeek {
  weekStart: string; // Monday of the week (YYYY-MM-DD)
  count: number;
  totalDurationMinutes: number;
}

/** A condensed workout (for the "recent" list). */
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
    change30d: number | null; // kg
    change1y: number | null; // kg
  };
  insights: InsightItem[];
}

/** The full set of snapshots for one parsed export. */
export interface PersonSnapshots {
  schemaVersion: 1;
  generatedAt: string; // ISO timestamp
  sourceFilename: string;
  parserVersion: string;
  activity: ActivitySnapshot;
  heart: HeartSnapshot;
  sleep: SleepSnapshot;
  workouts: WorkoutsSnapshot;
  body: BodySnapshot;
}

/** Segment identifier. Used by the API path + NavView routing. */
export type HealthSegment = 'activity' | 'heart' | 'sleep' | 'workouts' | 'body';
