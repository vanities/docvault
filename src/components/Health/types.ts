// Frontend-side mirror of server/parsers/apple-health.ts output shape.
// Kept in sync by hand — if you change the parser output, update this too.

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
