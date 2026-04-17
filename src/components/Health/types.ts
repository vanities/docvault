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

/** A single period stat with optional comparison to the previous period. */
export interface PeriodStat {
  label: string;
  value: number;
  formatted: string;
  prevValue: number | null;
  deltaPct: number | null;
}

/** Summary for one named time period (e.g. "This Week"). */
export interface PeriodSummary {
  name: string;
  start: string;
  end: string;
  stats: PeriodStat[];
}

/** Daily recovery score (0-100). */
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

/** Nightly sleep quality score (0-100). */
export interface SleepQualityScore {
  date: string;
  score: number;
  components: {
    duration: number;
    consistency: number;
    interruptions: number;
  };
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
  periods: PeriodSummary[];
  recoveryScores: DailyRecoveryScore[];
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
  periods: PeriodSummary[];
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
  periods: PeriodSummary[];
  qualityScores: SleepQualityScore[];
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
  periods: PeriodSummary[];
  distanceUnit: string | null;
}

export interface WeightPoint {
  date: string;
  kg: number;
  lb: number;
  source: 'apple-health' | 'clinical';
}

export interface HeightPoint {
  date: string;
  cm: number;
  inches: number;
  source: 'apple-health' | 'clinical';
}

export interface BodySnapshot {
  weightHistory: WeightPoint[];
  heightHistory: HeightPoint[];
  heightCm: number | null;
  heightIn: number | null;
  headline: {
    currentKg: number | null;
    currentLb: number | null;
    change30d: number | null; // kg
    change1y: number | null; // kg
  };
  insights: InsightItem[];
  periods: PeriodSummary[];
}

export interface ClinicalVitalPoint {
  date: string;
  value: number;
  unit: string | null;
}

export interface BloodPressurePoint {
  date: string;
  systolic: number;
  diastolic: number;
  unit: string | null;
}

export interface ClinicalVitalsSnapshot {
  bp: BloodPressurePoint[];
  heartRate: ClinicalVitalPoint[];
  temperature: ClinicalVitalPoint[];
  oxygenSaturation: ClinicalVitalPoint[];
  respiratoryRate: ClinicalVitalPoint[];
  pain: ClinicalVitalPoint[];
  headline: {
    latestBP: { systolic: number; diastolic: number; date: string } | null;
    avgBP90d: { systolic: number; diastolic: number } | null;
    latestTemperatureF: number | null;
    latestSpO2: number | null;
  };
  insights: InsightItem[];
}

/** An auto-detected illness period from cross-metric anomaly analysis. */
export interface IllnessPeriod {
  startDate: string;
  endDate: string;
  durationDays: number;
  signals: string[];
  peakSignals: number;
  confidence: 'likely' | 'possible';
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
  illnessPeriods: IllnessPeriod[];
  clinicalVitals: ClinicalVitalsSnapshot | null;
}

/** Segment identifier. Used by the API path + NavView routing. */
export type HealthSegment = 'activity' | 'heart' | 'sleep' | 'workouts' | 'body';

// ===========================================================================
// Clinical summary shapes (mirror of server/parsers/apple-health-clinical.ts).
// Kept in sync by hand — change the server module, change this too.
// ===========================================================================

export interface Coding {
  system?: string;
  code?: string;
  display?: string;
}

export interface LabResult {
  id: string;
  loinc: string | null;
  name: string;
  codings: Coding[];
  value: number | null;
  valueString: string | null;
  unit: string | null;
  refLow: number | null;
  refHigh: number | null;
  refText: string | null;
  date: string | null;
  effectiveAt: string | null;
  status: string | null;
  interpretation: string | null;
  derivedFlag: 'low' | 'high' | 'normal' | null;
  panelId: string | null;
}

export interface LabPanel {
  id: string;
  name: string;
  category: string | null;
  date: string | null;
  effectiveAt: string | null;
  issuedAt: string | null;
  status: string | null;
  conclusion: string | null;
  resultIds: string[];
}

export interface LabTrend {
  loinc: string | null;
  name: string;
  unit: string | null;
  points: LabResult[];
  latest: LabResult | null;
  latestFlag: 'low' | 'high' | 'normal' | null;
  refLow: number | null;
  refHigh: number | null;
}

export interface ClinicalCondition {
  id: string;
  name: string;
  icd10: string | null;
  clinicalStatus: string | null;
  verificationStatus: string | null;
  onsetDate: string | null;
  recordedDate: string | null;
  abatementDate: string | null;
}

export interface ClinicalMedication {
  id: string;
  name: string;
  status: string | null;
  authoredOn: string | null;
  dosageText: string | null;
  route: string | null;
  startDate: string | null;
  endDate: string | null;
}

export interface ClinicalImmunization {
  id: string;
  name: string;
  cvx: string | null;
  status: string | null;
  date: string | null;
  primarySource: boolean | null;
}

export interface ClinicalAllergy {
  id: string;
  name: string;
  clinicalStatus: string | null;
  recordedDate: string | null;
  reactions: string[];
}

export interface ClinicalProcedure {
  id: string;
  name: string;
  cpt: string | null;
  status: string | null;
  date: string | null;
}

export interface ClinicalDocumentRef {
  id: string;
  name: string;
  category: string | null;
  date: string | null;
  description: string | null;
}

export interface ClinicalSummary {
  schemaVersion: 1;
  recordCount: number;
  dateRange: { start: string | null; end: string | null };
  labsByTest: LabTrend[];
  labPanels: LabPanel[];
  vitals: LabResult[];
  conditions: ClinicalCondition[];
  medications: ClinicalMedication[];
  immunizations: ClinicalImmunization[];
  allergies: ClinicalAllergy[];
  procedures: ClinicalProcedure[];
  documents: ClinicalDocumentRef[];
  generatedAt: string;
}

/** The clinical-section sub-views accessible from the Health sidebar. */
export type ClinicalSection =
  | 'labs'
  | 'vitals'
  | 'conditions'
  | 'medications'
  | 'immunizations'
  | 'allergies'
  | 'procedures';

// ===========================================================================
// Nutrition (produced by server/parsers/nutrition-label.ts)
// Mirror of server/routes/nutrition.ts NutritionEntry + ParsedNutritionLabel.
// Kept in sync manually.
// ===========================================================================

export type NutritionStatus = 'considering' | 'active' | 'past' | 'never';

export type NutritionCategory =
  | 'multivitamin'
  | 'vitamin'
  | 'mineral'
  | 'fish-oil'
  | 'omega-3'
  | 'fiber'
  | 'psyllium'
  | 'electrolyte'
  | 'sports-drink'
  | 'protein'
  | 'creatine'
  | 'amino-acid'
  | 'herbal'
  | 'adaptogen'
  | 'probiotic'
  | 'other';

export interface NutrientEntry {
  name: string;
  amount?: number;
  unit?: string;
  dv?: number;
  form?: string;
  notes?: string;
}

export interface MacroBlock {
  calories?: number;
  totalFat?: NutrientEntry;
  saturatedFat?: NutrientEntry;
  transFat?: NutrientEntry;
  cholesterol?: NutrientEntry;
  sodium?: NutrientEntry;
  totalCarbohydrate?: NutrientEntry;
  dietaryFiber?: NutrientEntry;
  solubleFiber?: NutrientEntry;
  insolubleFiber?: NutrientEntry;
  totalSugars?: NutrientEntry;
  addedSugars?: NutrientEntry;
  sugarAlcohols?: NutrientEntry;
  protein?: NutrientEntry;
}

export interface ProprietaryBlend {
  name: string;
  totalAmount?: { amount: number; unit: string };
  ingredients?: string[];
}

export interface ParsedNutritionLabel {
  schemaVersion: 1;
  parserVersion: string;
  productName?: string;
  brandName?: string;
  category?: NutritionCategory;
  servingSize?: { amount: number; unit: string; description?: string };
  servingsPerContainer?: number | string;
  macros?: MacroBlock;
  vitamins?: NutrientEntry[];
  minerals?: NutrientEntry[];
  otherActive?: NutrientEntry[];
  proprietaryBlends?: ProprietaryBlend[];
  ingredients?: string[];
  allergenInfo?: string[];
  directions?: string;
  warnings?: string[];
  confidence?: number;
  parserNotes?: string;
}

export interface NutritionDose {
  amount?: number;
  unit?: string;
  frequency?: 'daily' | 'twice-daily' | 'as-needed' | 'weekly' | 'custom';
  frequencyCustom?: string;
  timeOfDay?: 'morning' | 'midday' | 'evening' | 'bedtime' | 'pre-workout' | 'post-workout';
}

export interface NutritionEntry {
  id: string;
  personId: string;
  filename: string | null;
  imagePath: string;
  imageMediaType: string;
  uploadedAt: string;
  parsedAt: string | null;
  parsed: ParsedNutritionLabel | null;
  parseError: string | null;
  status: NutritionStatus;
  dose?: NutritionDose;
  notes?: string;
  lastUpdated: string;
}

// ===========================================================================
// Sickness logs (mirror of server/routes/sickness.ts)
// ===========================================================================

export type SicknessCategory =
  | 'cold'
  | 'flu'
  | 'covid'
  | 'allergies'
  | 'sinus'
  | 'stomach'
  | 'injury'
  | 'migraine'
  | 'other';

export type SicknessSeverity = 'mild' | 'moderate' | 'severe';

export interface MedicationDose {
  name: string;
  doseText?: string;
  count?: number;
  notes?: string;
}

export interface SicknessLog {
  id: string;
  personId: string;
  startDate: string;
  endDate?: string;
  category: SicknessCategory;
  severity: SicknessSeverity;
  title: string;
  symptoms: string[];
  medications: MedicationDose[];
  notes?: string;
  linkToAutoDetection?: boolean;
  createdAt: string;
  updatedAt: string;
}

// ===========================================================================
// Health analysis entries (mirror of server/routes/health-analysis.ts)
// ===========================================================================

export interface HealthAnalysisSignals {
  ldl?: number | null;
  hdl?: number | null;
  triglycerides?: number | null;
  totalCholesterol?: number | null;
  apoB?: number | null;
  lpA?: number | null;
  hba1c?: number | null;
  fastingGlucose?: number | null;
  platelets?: number | null;
  restingHR?: number | null;
  hrv?: number | null;
  avgSleepHours?: number | null;
  avgDailySteps?: number | null;
  weightKg?: number | null;
  [key: string]: unknown;
}

export interface HealthAnalysisEntry {
  id: string;
  createdAt: string;
  title: string;
  body: string;
  personId?: string;
  signals: HealthAnalysisSignals;
  tags?: string[];
  author: string;
}
