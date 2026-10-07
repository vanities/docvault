// Invented records only; seed the isolated native API/UI fixture.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AppleHealthSummary } from '../server/parsers/apple-health';
import type { PersonSnapshots, PeriodSummary } from '../server/parsers/apple-health-snapshots';
import type { ClinicalSummary, LabResult, LabTrend } from '../server/parsers/apple-health-clinical';

export async function seedNativeHealth(dataDir: string) {
  const { PARSER_VERSION } = await import('../server/parsers/apple-health');
  const { SNAPSHOT_SCHEMA_VERSION } = await import('../server/parsers/apple-health-snapshots');
  const { CLINICAL_SCHEMA_VERSION } = await import('../server/parsers/apple-health-clinical');
  const generatedAt = new Date().toISOString();
  const dates = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'];
  const periods: PeriodSummary[] = [
    {
      name: 'This Week',
      start: dates[0],
      end: dates[4],
      stats: [
        {
          label: 'Daily steps',
          value: 5000,
          formatted: '5,000 steps/day',
          prevValue: 4000,
          deltaPct: 25,
        },
        { label: 'New measurement', value: 0, formatted: '0 min', prevValue: null, deltaPct: null },
      ],
    },
  ];
  const insights = [
    {
      label: 'Synthetic fixture insight',
      value: '5 recorded days',
      caption: 'Invented observations for interface verification.',
      tone: 'neutral' as const,
    },
  ];
  const summary: AppleHealthSummary = {
    schemaVersion: 1,
    profile: {},
    dateRange: { start: dates[0], end: dates[4] },
    recordCounts: { totalRecords: 0, totalWorkouts: 0, totalActivitySummaries: 0, byType: {} },
    typesSeen: { numeric: [], category: [] },
    dailySummaries: {},
    activitySummaries: [],
    workouts: [],
    parseDurationMs: 0,
    parserVersion: PARSER_VERSION,
  };
  const snapshot: PersonSnapshots = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    parserVersion: PARSER_VERSION,
    generatedAt,
    sourceFilename: 'synthetic-export.zip',
    illnessPeriods: [
      {
        startDate: '2026-09-28',
        endDate: '2026-09-29',
        durationDays: 2,
        signals: ['Synthetic elevated resting heart rate', 'Synthetic lower activity'],
        peakSignals: 2,
        confidence: 'possible',
      },
    ],
    clinicalVitals: null,
    activity: {
      distanceUnit: 'mi',
      daily: dates.map((date, i) => ({
        date,
        steps: i === 0 ? 0 : 4000 + i * 500,
        activeEnergy: 200 + i * 20,
        basalEnergy: 1500,
        exerciseMinutes: 20 + i * 5,
        standHours: 10,
        distance: 2 + i * 0.25,
        flightsClimbed: i,
        steps7dAvg: 4000 + i * 100,
        activeEnergy7dAvg: 220,
        exerciseMinutes7dAvg: 30,
      })),
      headline: {
        avgDailySteps90d: 5000,
        totalSteps: 21000,
        totalDistance: 12.5,
        totalActiveEnergy: 1200,
        totalExerciseMinutes: 150,
        ringCompletionPct: null,
        mostActiveDay: { date: dates[4], steps: 6000 },
      },
      insights,
      periods,
      recoveryScores: dates.map((date) => ({
        date,
        score: 82,
        components: { hrv: 30, sleep: 25, restingHR: 18, exerciseLoad: 9 },
      })),
    },
    heart: {
      daily: dates.map((date, i) => ({
        date,
        restingHR: i === 2 ? null : 60 + i,
        avgHR: 80 + i,
        minHR: 50 + i,
        maxHR: 130 + i,
        hrv: i === 1 ? null : 40 + i,
        walkingHR: null,
        hrRecovery1min: 20,
      })),
      headline: {
        latestRestingHR: 64,
        avgRestingHR90d: 62,
        restingHRTrend: 'steady',
        latestHRV: 44,
        avgHRV90d: 42,
        hrvTrend: 'flat',
      },
      insights,
      periods: [],
    },
    sleep: {
      daily: dates.map((date, i) => ({
        date,
        asleepMinutes: 420 + i * 15,
        inBedMinutes: 480 + i * 10,
        deepMinutes: i === 4 ? null : 60,
        remMinutes: 90,
        coreMinutes: 270,
        awakeMinutes: i === 4 ? 0 : 30,
        respiratoryRate: 14,
        wristTempDeviationC: i === 4 ? 0 : null,
      })),
      headline: {
        avgSleepHours90d: 7.5,
        avgSleepHoursAll: 7.5,
        longestSleep: { date: dates[4], minutes: 480 },
        shortestSleep: { date: dates[0], minutes: 420 },
        nightsWith5Plus: 5,
        nightsWith7Plus: 5,
      },
      insights,
      periods: [],
      qualityScores: dates.map((date) => ({
        date,
        score: 88,
        components: { duration: 45, consistency: 25, interruptions: 18 },
      })),
    },
    workouts: {
      byType: [
        {
          type: 'HKWorkoutActivityTypeRunning',
          count: 2,
          totalDurationMinutes: 70,
          totalDistance: 6,
          totalEnergy: 500,
          avgDurationMinutes: 35,
          lastWorkout: '2026-10-02T18:00:00Z',
        },
        {
          type: 'HKWorkoutActivityTypeYoga',
          count: 1,
          totalDurationMinutes: 25,
          totalDistance: null,
          totalEnergy: null,
          avgDurationMinutes: 25,
          lastWorkout: '2026-10-01T10:00:00Z',
        },
      ],
      weekly: [
        { weekStart: '2026-09-21', count: 0, totalDurationMinutes: 0 },
        { weekStart: '2026-09-28', count: 3, totalDurationMinutes: 95 },
      ],
      recent: [
        {
          type: 'HKWorkoutActivityTypeRunning',
          start: '2026-10-02T18:00:00Z',
          durationMinutes: 40,
          distance: 3.5,
          avgHR: 135,
          energy: 280,
        },
        {
          type: 'HKWorkoutActivityTypeYoga',
          start: '2026-10-01T10:00:00Z',
          durationMinutes: 25,
          distance: null,
          avgHR: null,
          energy: null,
        },
        {
          type: 'HKWorkoutActivityTypeRunning',
          start: '2026-09-29T18:00:00Z',
          durationMinutes: 30,
          distance: 2.5,
          avgHR: 130,
          energy: 220,
        },
      ],
      headline: {
        totalWorkouts: 3,
        thisWeekCount: 3,
        thisWeekMinutes: 95,
        currentStreakDays: 2,
        longestStreakDays: 2,
        favoriteType: 'HKWorkoutActivityTypeRunning',
      },
      insights,
      periods: [],
      distanceUnit: 'mi',
    },
    body: {
      weightHistory: [
        { date: dates[0], kg: 72, lb: 158.733, source: 'apple-health' },
        { date: dates[4], kg: 71, lb: 156.528, source: 'apple-health' },
        { date: dates[4], kg: 71.5, lb: 157.63, source: 'clinical' },
      ],
      heightHistory: [{ date: dates[4], cm: 170, inches: 66.929, source: 'clinical' }],
      heightCm: 170,
      heightIn: 66.929,
      headline: {
        currentKg: 71.5,
        currentLb: 157.63,
        change30d: null,
        change1y: null,
        changeSincePrev: { kg: 0.5, lb: 1.102, prevDate: dates[4], daysAgo: 0 },
      },
      insights,
      periods: [],
    },
  };
  const lab = (
    id: string,
    name: string,
    value: number | null,
    date: string,
    patch: Partial<LabResult> = {}
  ): LabResult => ({
    id,
    name,
    loinc: null,
    codings: [],
    value,
    valueString: null,
    unit: 'mg/dL',
    refLow: 10,
    refHigh: 100,
    refText: null,
    date,
    effectiveAt: date + 'T12:00:00Z',
    status: 'final',
    interpretation: null,
    derivedFlag: value == null ? null : value > 100 ? 'high' : value < 10 ? 'low' : 'normal',
    panelId: 'demo-panel',
    components: [],
    ...patch,
  });
  const glucose = [
    lab('lab-old', 'Demo glucose', 90, dates[0]),
    lab('lab-new', 'Demo glucose', 120, dates[4]),
  ];
  const mixed = [
    lab('lab-unit-a', 'Demo mixed units', 0, dates[0], {
      unit: 'mg/dL',
      refLow: null,
      refHigh: null,
      derivedFlag: null,
    }),
    lab('lab-unit-b', 'Demo mixed units', 1.2, dates[4], {
      unit: 'mmol/L',
      refLow: null,
      refHigh: null,
      derivedFlag: null,
    }),
  ];
  const negative = [
    lab('lab-negative', 'Demo qualitative test', null, dates[4], {
      valueString: 'Negative',
      unit: null,
      refLow: null,
      refHigh: null,
      refText: 'Negative',
    }),
  ];
  const trend = (points: LabResult[]): LabTrend => ({
    loinc: points[0].loinc,
    name: points[0].name,
    unit: points.at(-1)!.unit,
    points,
    latest: points.at(-1)!,
    latestFlag: points.at(-1)!.derivedFlag,
    refLow: points.at(-1)!.refLow,
    refHigh: points.at(-1)!.refHigh,
  });
  const bp = (id: string, date: string, systolic: number, diastolic: number) =>
    lab(id, 'Demo blood pressure', null, date, {
      loinc: '85354-9',
      unit: null,
      refLow: null,
      refHigh: null,
      components: [
        { loinc: '8480-6', name: 'Systolic', value: systolic, unit: 'mm[Hg]' },
        { loinc: '8462-4', name: 'Diastolic', value: diastolic, unit: 'mm[Hg]' },
      ],
    });
  const clinical: ClinicalSummary = {
    schemaVersion: CLINICAL_SCHEMA_VERSION,
    recordCount: 16,
    dateRange: summary.dateRange,
    generatedAt,
    labsByTest: [trend(glucose), trend(mixed), trend(negative)],
    labPanels: [
      {
        id: 'demo-panel',
        name: 'Demo chemistry panel',
        category: 'Laboratory',
        date: dates[4],
        effectiveAt: dates[4] + 'T12:00:00Z',
        issuedAt: dates[4] + 'T14:00:00Z',
        status: 'final',
        conclusion: 'Synthetic panel narrative preserved verbatim.',
        resultIds: ['lab-new', 'lab-negative'],
      },
    ],
    vitals: [bp('bp-old', dates[0], 118, 78), bp('bp-new', dates[4], 120, 80)],
    conditions: [
      {
        id: 'condition-chronic',
        name: 'Demo chronic condition',
        icd10: 'SYNTHETIC',
        clinicalStatus: 'active',
        verificationStatus: 'confirmed',
        onsetDate: dates[0],
        recordedDate: dates[0],
        abatementDate: null,
        category: 'chronic',
      },
      {
        id: 'condition-visit',
        name: 'Demo encounter',
        icd10: null,
        clinicalStatus: 'resolved',
        verificationStatus: null,
        onsetDate: dates[4],
        recordedDate: dates[4],
        abatementDate: dates[4],
        category: 'encounter',
      },
    ],
    medications: [
      {
        id: 'med-active',
        name: 'Demo medicine',
        status: 'active',
        authoredOn: dates[0],
        dosageText: 'Synthetic instruction: one fictional tablet daily.',
        route: 'Oral',
        startDate: dates[0],
        endDate: null,
      },
    ],
    immunizations: [
      {
        id: 'immunization-demo',
        name: 'Demo immunization',
        cvx: null,
        status: 'completed',
        date: dates[0],
        primarySource: false,
      },
    ],
    allergies: [
      {
        id: 'allergy-demo',
        name: 'Demo allergen',
        clinicalStatus: 'active',
        recordedDate: dates[0],
        reactions: ['Synthetic reaction text.'],
      },
    ],
    procedures: [
      {
        id: 'procedure-demo',
        name: 'Demo procedure',
        cpt: null,
        status: 'completed',
        date: dates[4],
        category: 'procedure',
      },
    ],
    documents: [
      {
        id: 'document-demo',
        name: 'Demo discharge note',
        category: 'Clinical note',
        date: dates[4],
        description: 'Synthetic narrative from the source document reference.',
      },
    ],
  };
  await writeFile(
    path.join(dataDir, '.docvault-health.json'),
    JSON.stringify({
      people: [
        { id: 'demo-person', name: 'Demo Person', createdAt: generatedAt },
        { id: 'other-person', name: 'Other Demo Person', createdAt: generatedAt },
      ],
      summaries: { 'demo-person/synthetic-export.zip': summary },
      snapshots: { 'demo-person/synthetic-export.zip': snapshot },
      clinical: { 'demo-person/synthetic-export.zip': clinical },
    })
  );
}
