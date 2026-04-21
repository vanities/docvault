// Health snapshot route — consolidated health data across all people, for LLM consumption.
//
// Route:
//   GET /api/health-snapshot?format=json|md|toon
//     &personId=person-xxx                 — single-person filter (default: all)
//     &includeArchived=true                — include archived people (default: false)
//     &includeClinical=false               — skip FHIR clinical summary (default: true)
//     &includeDNA=false                    — skip DNA results (default: true)
//     &includeDaily=true                   — (json only) include full daily arrays (default: false)
//     &includeResearch=true                — (md only) render evidence prose + citations per supplement (default: false)
//
// Mirrors server/routes/financial-snapshot.ts. Default format is `toon` — a
// flat line-oriented format ~60% smaller than JSON when fed to an LLM.
//
// Sources consolidated:
//   - .docvault-health.json           — people + summaries + snapshots + clinical + illness notes
//   - data/health/<personId>/dna/*    — encrypted DNA (decrypted on demand)
//   - .docvault-reminders.json        — filtered to health-related entries by keyword

import { promises as fs } from 'fs';
import path from 'path';
import {
  DATA_DIR,
  loadReminders,
  jsonResponse,
  type HealthPerson,
  type Reminder,
} from '../data.js';
import type { AppleHealthSummary } from '../parsers/apple-health.js';
import {
  SNAPSHOT_SCHEMA_VERSION,
  type PersonSnapshots,
  type IllnessPeriod,
} from '../parsers/apple-health-snapshots.js';
import {
  CLINICAL_SCHEMA_VERSION,
  type ClinicalSummary,
  type LabTrend,
} from '../parsers/apple-health-clinical.js';
import { decryptBytesWithMasterKey } from '../crypto-keys.js';
import type { DNAParseResult, TraitReading } from '../parsers/dna-traits.js';
import type { NutritionEntry, NutritionStatus } from './nutrition.js';
import type { SicknessLog } from './sickness.js';
import { createLogger } from '../logger.js';

const log = createLogger('HealthSnapshot');

const HEALTH_STORE_FILE = path.join(DATA_DIR, '.docvault-health.json');
const HEALTH_DATA_DIR = path.join(DATA_DIR, 'health');

interface IllnessNote {
  note?: string;
  dismissed?: boolean;
  updatedAt: string;
}

interface HealthStore {
  version: 1;
  people: HealthPerson[];
  summaries: Record<string, AppleHealthSummary>;
  snapshots: Record<string, PersonSnapshots>;
  clinical?: Record<string, ClinicalSummary>;
  illnessNotes?: Record<string, IllnessNote>;
  nutrition?: Record<string, NutritionEntry>;
  sicknessLogs?: Record<string, SicknessLog>;
}

async function loadHealthStore(): Promise<HealthStore> {
  try {
    const raw = await fs.readFile(HEALTH_STORE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<HealthStore>;
    return {
      version: 1,
      people: parsed.people ?? [],
      summaries: parsed.summaries ?? {},
      snapshots: parsed.snapshots ?? {},
      clinical: parsed.clinical ?? {},
      illnessNotes: parsed.illnessNotes ?? {},
      nutrition: parsed.nutrition ?? {},
      sicknessLogs: parsed.sicknessLogs ?? {},
    };
  } catch {
    return {
      version: 1,
      people: [],
      summaries: {},
      snapshots: {},
      clinical: {},
      illnessNotes: {},
      nutrition: {},
      sicknessLogs: {},
    };
  }
}

// Matches any of: health, doctor, dentist, medical, prescription, vaccine, lab,
// checkup, physical, eye/vision, specialist, therapy, surgery. Case-insensitive.
const HEALTH_KEYWORD_RE =
  /health|doctor|dentist|medical|prescription|vaccine|immuniz|\blab\b|checkup|check-up|physical therapy|\bphysical\b|\beye\b|vision|optometr|specialist|surgery|chiropract|therapy|refill|rx\b|well.?child|pediatric|ob.?gyn/i;

function isHealthReminder(r: Reminder): boolean {
  return HEALTH_KEYWORD_RE.test(r.title) || (r.notes ? HEALTH_KEYWORD_RE.test(r.notes) : false);
}

/** Pick the most recent "<personId>/<filename>" key from a store record. */
function latestKeyFor(
  personId: string,
  record: Record<string, { generatedAt?: string }>
): string | null {
  const prefix = `${personId}/`;
  const keys = Object.keys(record).filter((k) => k.startsWith(prefix));
  if (keys.length === 0) return null;
  keys.sort((a, b) => {
    const ga = record[a]?.generatedAt ?? '';
    const gb = record[b]?.generatedAt ?? '';
    if (ga !== gb) return gb.localeCompare(ga);
    return b.localeCompare(a);
  });
  return keys[0];
}

async function loadDNAForPerson(personId: string): Promise<{
  metadata: {
    uploadedAt: string;
    filename: string | null;
    snpsLoaded: number;
    traitsFound: number;
    healthFound: number;
    experimentalFound: number;
    apoeGenotyped: boolean;
  } | null;
  results: DNAParseResult | null;
}> {
  const dir = path.join(HEALTH_DATA_DIR, personId, 'dna');
  let metadata: Awaited<ReturnType<typeof loadDNAForPerson>>['metadata'] = null;
  try {
    const m = await fs.readFile(path.join(dir, 'metadata.json'), 'utf-8');
    metadata = JSON.parse(m);
  } catch {
    return { metadata: null, results: null };
  }
  let results: DNAParseResult | null = null;
  try {
    const cipher = await fs.readFile(path.join(dir, 'results.json.enc'));
    const plain = decryptBytesWithMasterKey(cipher);
    results = JSON.parse(plain.toString('utf-8')) as DNAParseResult;
  } catch (err) {
    log.warn(`DNA decrypt failed for ${personId}:`, String(err));
  }
  return { metadata, results };
}

// ---------------------------------------------------------------------------
// Trimmed shapes — what we surface per person. Daily arrays are excluded from
// the default response to keep payloads reasonable; caller opts back in with
// ?includeDaily=true (json format only).
// ---------------------------------------------------------------------------

interface ClinicalSurface {
  recordCount: number;
  dateRange: { start: string | null; end: string | null };
  labs: {
    name: string;
    unit: string | null;
    latest: {
      date: string | null;
      value: number | null;
      valueString: string | null;
      flag: string | null;
    };
    refLow: number | null;
    refHigh: number | null;
    pointCount: number;
  }[];
  conditions: ClinicalSummary['conditions'];
  medications: ClinicalSummary['medications'];
  immunizations: ClinicalSummary['immunizations'];
  allergies: ClinicalSummary['allergies'];
  procedures: ClinicalSummary['procedures'];
  documents: ClinicalSummary['documents'];
  schemaStale: boolean;
}

function buildNutritionSurface(entries: NutritionEntry[]): NutritionSurface {
  // Order: active → considering → past → never; within each group newest first.
  const order: Record<NutritionStatus, number> = {
    active: 0,
    considering: 1,
    past: 2,
    never: 3,
  };
  const sorted = [...entries].sort((a, b) => {
    const o = order[a.status] - order[b.status];
    if (o !== 0) return o;
    return b.uploadedAt.localeCompare(a.uploadedAt);
  });

  let activeCount = 0;
  let consideringCount = 0;
  let pastCount = 0;
  for (const e of entries) {
    if (e.status === 'active') activeCount++;
    else if (e.status === 'considering') consideringCount++;
    else if (e.status === 'past') pastCount++;
  }

  return {
    activeCount,
    consideringCount,
    pastCount,
    entries: sorted.map((e) => {
      const p = e.parsed;
      return {
        id: e.id,
        status: e.status,
        productName: p?.productName ?? null,
        brandName: p?.brandName ?? null,
        category: p?.category ?? null,
        dose: e.dose,
        notes: e.notes ?? null,
        research: e.research ?? null,
        citations: e.citations,
        parseError: e.parseError,
        summary: {
          servingSize: p?.servingSize
            ? `${p.servingSize.amount} ${p.servingSize.unit}${p.servingSize.description ? ` (${p.servingSize.description})` : ''}`
            : null,
          servingsPerContainer: p?.servingsPerContainer ?? null,
          calories: p?.macros?.calories ?? null,
          vitamins: (p?.vitamins ?? []).map((v) => ({
            name: v.name,
            amount: v.amount,
            unit: v.unit,
            dv: v.dv,
            form: v.form,
          })),
          minerals: (p?.minerals ?? []).map((v) => ({
            name: v.name,
            amount: v.amount,
            unit: v.unit,
            dv: v.dv,
            form: v.form,
          })),
          otherActive: (p?.otherActive ?? []).map((v) => ({
            name: v.name,
            amount: v.amount,
            unit: v.unit,
            dv: v.dv,
            form: v.form,
          })),
          proprietaryBlends: (p?.proprietaryBlends ?? []).map((b) => ({
            name: b.name,
            ingredients: b.ingredients,
          })),
          warnings: p?.warnings ?? [],
          allergenInfo: p?.allergenInfo ?? [],
        },
      };
    }),
  };
}

function surfaceClinical(c: ClinicalSummary): ClinicalSurface {
  return {
    recordCount: c.recordCount,
    dateRange: c.dateRange,
    labs: (c.labsByTest || []).map((t: LabTrend) => ({
      name: t.name,
      unit: t.unit,
      latest: {
        date: t.latest?.date ?? null,
        value: t.latest?.value ?? null,
        valueString: t.latest?.valueString ?? null,
        flag: t.latestFlag,
      },
      refLow: t.refLow,
      refHigh: t.refHigh,
      pointCount: t.points.length,
    })),
    conditions: c.conditions,
    medications: c.medications,
    immunizations: c.immunizations,
    allergies: c.allergies,
    procedures: c.procedures,
    documents: c.documents,
    schemaStale: c.schemaVersion !== CLINICAL_SCHEMA_VERSION,
  };
}

interface PersonSurface {
  id: string;
  name: string;
  color?: string;
  icon?: string;
  archived: boolean;
  sourceFilename: string | null;
  dateRange: { start: string | null; end: string | null } | null;
  snapshotStale: boolean;
  headlines: {
    activity: PersonSnapshots['activity']['headline'] | null;
    heart: PersonSnapshots['heart']['headline'] | null;
    sleep: PersonSnapshots['sleep']['headline'] | null;
    workouts: PersonSnapshots['workouts']['headline'] | null;
    body: PersonSnapshots['body']['headline'] | null;
  };
  insights: {
    activity: PersonSnapshots['activity']['insights'];
    heart: PersonSnapshots['heart']['insights'];
    sleep: PersonSnapshots['sleep']['insights'];
    workouts: PersonSnapshots['workouts']['insights'];
    body: PersonSnapshots['body']['insights'];
  };
  periods: {
    activity: PersonSnapshots['activity']['periods'];
    heart: PersonSnapshots['heart']['periods'];
    sleep: PersonSnapshots['sleep']['periods'];
    workouts: PersonSnapshots['workouts']['periods'];
    body: PersonSnapshots['body']['periods'];
  };
  illnessPeriods: IllnessPeriod[];
  illnessNotes: Record<string, IllnessNote>;
  /**
   * Full weight and height series from the Body snapshot. These are
   * duplicated here (rather than read from `snapshot.body.*`) so the
   * markdown and toon renderers can draw trend deltas without also
   * having to consume `snapshot.body.weightHistory[]` wholesale.
   */
  body: {
    weightHistory: PersonSnapshots['body']['weightHistory'];
    heightHistory: PersonSnapshots['body']['heightHistory'];
    heightCm: number | null;
    heightIn: number | null;
  } | null;
  /** Clinical vital-signs trends (BP, HR, temp, SpO2, resp, pain). */
  clinicalVitals: PersonSnapshots['clinicalVitals'];
  clinical: ClinicalSurface | null;
  dna: {
    uploadedAt: string;
    filename: string | null;
    snpsLoaded: number;
    chipCoverageEstimate: number;
    apoe: string | null;
    traits: TraitReading[];
    health: TraitReading[];
    experimental: TraitReading[];
    polygenic: DNAParseResult['polygenic'];
  } | null;
  reminders: Reminder[];
  nutrition: NutritionSurface | null;
  /** User-logged sickness episodes (distinct from auto-detected illnessPeriods). */
  sicknessLogs: SicknessLog[];
  // Only populated when ?includeDaily=true
  daily?: {
    activity: PersonSnapshots['activity']['daily'];
    heart: PersonSnapshots['heart']['daily'];
    sleep: PersonSnapshots['sleep']['daily'];
    workouts: PersonSnapshots['workouts']['recent'];
    weight: PersonSnapshots['body']['weightHistory'];
  };
}

interface NutritionSurface {
  activeCount: number;
  consideringCount: number;
  pastCount: number;
  /** All entries, sorted by status then uploadedAt desc. Each entry includes parsed label + dose/status. */
  entries: Array<{
    id: string;
    status: NutritionStatus;
    productName: string | null;
    brandName: string | null;
    category: string | null;
    dose: NutritionEntry['dose'];
    notes: string | null;
    /** Evidence-backed prose (markdown). Only rendered in MD format when ?includeResearch=true. */
    research: string | null;
    /** Structured citations that back the research prose. */
    citations: NutritionEntry['citations'];
    /** True if parsing failed or has never been attempted successfully. */
    parseError: string | null;
    /** Trimmed parsed label — servings, macros, vitamins+minerals+otherActive names only. */
    summary: {
      servingSize: string | null;
      servingsPerContainer: number | string | null;
      calories: number | null;
      vitamins: Array<{ name: string; amount?: number; unit?: string; dv?: number; form?: string }>;
      minerals: Array<{ name: string; amount?: number; unit?: string; dv?: number; form?: string }>;
      otherActive: Array<{
        name: string;
        amount?: number;
        unit?: string;
        dv?: number;
        form?: string;
      }>;
      proprietaryBlends: Array<{ name: string; ingredients?: string[] }>;
      warnings: string[];
      allergenInfo: string[];
    };
  }>;
}

export async function handleHealthSnapshotRoutes(
  req: Request,
  url: URL,
  pathname: string
): Promise<Response | null> {
  if (pathname !== '/api/health-snapshot' || req.method !== 'GET') return null;

  const format = (url.searchParams.get('format') || 'toon').toLowerCase();
  const personIdFilter = url.searchParams.get('personId');
  const includeArchived = url.searchParams.get('includeArchived') === 'true';
  const includeClinical = url.searchParams.get('includeClinical') !== 'false';
  const includeDNA = url.searchParams.get('includeDNA') !== 'false';
  const includeDaily = url.searchParams.get('includeDaily') === 'true';
  const includeResearch = url.searchParams.get('includeResearch') === 'true';

  try {
    const [store, allReminders] = await Promise.all([loadHealthStore(), loadReminders()]);
    const healthReminders = allReminders.filter(isHealthReminder);

    let people = store.people;
    if (!includeArchived) people = people.filter((p) => !p.archivedAt);
    if (personIdFilter) people = people.filter((p) => p.id === personIdFilter);

    const surfaces: PersonSurface[] = [];
    for (const person of people) {
      const snapKey = latestKeyFor(person.id, store.snapshots);
      const summaryKey = latestKeyFor(person.id, store.summaries);
      const snapshot = snapKey ? store.snapshots[snapKey] : null;
      const summary = summaryKey ? store.summaries[summaryKey] : null;

      const clinicalKey = includeClinical ? latestKeyFor(person.id, store.clinical ?? {}) : null;
      const clinical = clinicalKey && store.clinical ? store.clinical[clinicalKey] : null;

      // Filter illness notes to this person
      const notes: Record<string, IllnessNote> = {};
      const noteprefix = `${person.id}/`;
      for (const [k, v] of Object.entries(store.illnessNotes ?? {})) {
        if (k.startsWith(noteprefix)) notes[k.slice(noteprefix.length)] = v;
      }

      // Health-tagged reminders (no entity tie-in — keyword match)
      const personReminders = healthReminders; // global; not per-person

      // Nutrition entries for this person, rolled up into a snapshot summary
      const nutritionPrefix = `${person.id}/`;
      const personNutrition: NutritionEntry[] = Object.entries(store.nutrition ?? {})
        .filter(([k]) => k.startsWith(nutritionPrefix))
        .map(([, v]) => v);
      const nutritionSurface =
        personNutrition.length > 0 ? buildNutritionSurface(personNutrition) : null;

      // Sickness logs for this person, newest first
      const personSicknessLogs: SicknessLog[] = Object.entries(store.sicknessLogs ?? {})
        .filter(([k]) => k.startsWith(nutritionPrefix))
        .map(([, v]) => v)
        .sort((a, b) => b.startDate.localeCompare(a.startDate));

      const dna = includeDNA
        ? await loadDNAForPerson(person.id)
        : { metadata: null, results: null };

      const surface: PersonSurface = {
        id: person.id,
        name: person.name,
        color: person.color,
        icon: person.icon,
        archived: !!person.archivedAt,
        sourceFilename: snapshot?.sourceFilename ?? null,
        dateRange: summary?.dateRange ?? null,
        snapshotStale: snapshot ? snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION : false,
        headlines: {
          activity: snapshot?.activity.headline ?? null,
          heart: snapshot?.heart.headline ?? null,
          sleep: snapshot?.sleep.headline ?? null,
          workouts: snapshot?.workouts.headline ?? null,
          body: snapshot?.body.headline ?? null,
        },
        insights: {
          activity: snapshot?.activity.insights ?? [],
          heart: snapshot?.heart.insights ?? [],
          sleep: snapshot?.sleep.insights ?? [],
          workouts: snapshot?.workouts.insights ?? [],
          body: snapshot?.body.insights ?? [],
        },
        periods: {
          activity: snapshot?.activity.periods ?? [],
          heart: snapshot?.heart.periods ?? [],
          sleep: snapshot?.sleep.periods ?? [],
          workouts: snapshot?.workouts.periods ?? [],
          body: snapshot?.body.periods ?? [],
        },
        illnessPeriods: snapshot?.illnessPeriods ?? [],
        illnessNotes: notes,
        body: snapshot
          ? {
              weightHistory: snapshot.body.weightHistory,
              heightHistory: snapshot.body.heightHistory,
              heightCm: snapshot.body.heightCm,
              heightIn: snapshot.body.heightIn,
            }
          : null,
        clinicalVitals: snapshot?.clinicalVitals ?? null,
        clinical: clinical ? surfaceClinical(clinical) : null,
        dna:
          dna.metadata && dna.results
            ? {
                uploadedAt: dna.metadata.uploadedAt,
                filename: dna.metadata.filename,
                snpsLoaded: dna.metadata.snpsLoaded,
                chipCoverageEstimate: dna.results.chipCoverageEstimate,
                apoe: dna.results.apoe,
                traits: dna.results.traits,
                health: dna.results.health,
                experimental: dna.results.experimental,
                polygenic: dna.results.polygenic,
              }
            : null,
        reminders: personReminders,
        nutrition: nutritionSurface,
        sicknessLogs: personSicknessLogs,
      };

      if (includeDaily && snapshot) {
        surface.daily = {
          activity: snapshot.activity.daily,
          heart: snapshot.heart.daily,
          sleep: snapshot.sleep.daily,
          workouts: snapshot.workouts.recent,
          weight: snapshot.body.weightHistory,
        };
      }

      surfaces.push(surface);
    }

    // Aggregates across people
    const withExports = surfaces.filter((s) => s.sourceFilename).length;
    const withClinical = surfaces.filter((s) => s.clinical).length;
    const withDNA = surfaces.filter((s) => s.dna).length;
    const totalWorkouts = surfaces.reduce(
      (sum, s) => sum + (s.headlines.workouts?.totalWorkouts ?? 0),
      0
    );
    const totalSteps = surfaces.reduce(
      (sum, s) => sum + (s.headlines.activity?.totalSteps ?? 0),
      0
    );
    const rhrValues = surfaces
      .map((s) => s.headlines.heart?.latestRestingHR)
      .filter((v): v is number => typeof v === 'number');
    const avgRestingHR =
      rhrValues.length > 0 ? rhrValues.reduce((a, b) => a + b, 0) / rhrValues.length : null;
    const sleepValues = surfaces
      .map((s) => s.headlines.sleep?.avgSleepHours90d)
      .filter((v): v is number => typeof v === 'number');
    const avgSleepHours90d =
      sleepValues.length > 0 ? sleepValues.reduce((a, b) => a + b, 0) / sleepValues.length : null;

    const snapshot = {
      generatedAt: new Date().toISOString(),
      peopleCount: surfaces.length,
      people: surfaces,
      reminders: healthReminders,
      aggregates: {
        peopleCount: surfaces.length,
        withExports,
        withClinical,
        withDNA,
        totalWorkouts,
        totalSteps,
        avgRestingHR,
        avgSleepHours90d,
      },
    };

    if (format === 'toon') {
      return new Response(renderToon(snapshot), {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
    if (format === 'md' || format === 'markdown') {
      return new Response(renderMarkdown(snapshot, { includeResearch }), {
        headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
      });
    }
    return jsonResponse(snapshot);
  } catch (err) {
    log.error('Failed to generate health snapshot:', String(err));
    return jsonResponse({ error: 'Failed to generate health snapshot', details: String(err) }, 500);
  }
}

// ---------------------------------------------------------------------------
// TOON renderer — flat key:value lines, LLM-friendly
// ---------------------------------------------------------------------------

function renderToon(s: ReturnType<typeof packSnapshot>): string {
  const t: string[] = [];
  const n = (v: number | null | undefined, d = 1): string =>
    typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : '—';
  const i = (v: number | null | undefined): string =>
    typeof v === 'number' && Number.isFinite(v) ? String(Math.round(v)) : '—';
  const q = (v: string | null | undefined): string =>
    v == null ? '' : `"${String(v).replace(/"/g, '\\"')}"`;

  t.push(
    `HEALTH_SNAPSHOT date=${new Date().toISOString().split('T')[0]} people=${s.peopleCount} total_workouts=${s.aggregates.totalWorkouts} total_steps=${s.aggregates.totalSteps} avg_rhr=${i(s.aggregates.avgRestingHR)} avg_sleep_hrs=${n(s.aggregates.avgSleepHours90d, 2)}`
  );
  t.push('');

  for (const p of s.people) {
    t.push(
      `PERSON id=${p.id} name=${q(p.name)}${p.archived ? ' archived=true' : ''}${p.sourceFilename ? ` source=${q(p.sourceFilename)}` : ''}${p.snapshotStale ? ' STALE=true' : ''}`
    );
    if (p.dateRange?.start) {
      t.push(`  DATE_RANGE start=${p.dateRange.start} end=${p.dateRange.end ?? ''}`);
    }

    if (p.headlines.activity) {
      const h = p.headlines.activity;
      const most = h.mostActiveDay
        ? ` most_active=${h.mostActiveDay.date}:${h.mostActiveDay.steps}`
        : '';
      t.push(
        `  ACTIVITY steps_90d_avg=${i(h.avgDailySteps90d)} total_steps=${h.totalSteps} total_active_kcal=${i(h.totalActiveEnergy)} exercise_min=${i(h.totalExerciseMinutes)} ring_pct=${n(h.ringCompletionPct, 0)}${most}`
      );
    }
    if (p.headlines.heart) {
      const h = p.headlines.heart;
      t.push(
        `  HEART rhr_latest=${i(h.latestRestingHR)} rhr_90d=${i(h.avgRestingHR90d)} rhr_trend=${h.restingHRTrend} hrv_latest=${i(h.latestHRV)} hrv_90d=${i(h.avgHRV90d)} hrv_trend=${h.hrvTrend}`
      );
    }
    if (p.headlines.sleep) {
      const h = p.headlines.sleep;
      t.push(
        `  SLEEP avg_hrs_90d=${n(h.avgSleepHours90d, 2)} avg_hrs_all=${n(h.avgSleepHoursAll, 2)} nights_7plus=${h.nightsWith7Plus} nights_5plus=${h.nightsWith5Plus}${h.longestSleep ? ` longest=${h.longestSleep.date}:${(h.longestSleep.minutes / 60).toFixed(1)}h` : ''}${h.shortestSleep ? ` shortest=${h.shortestSleep.date}:${(h.shortestSleep.minutes / 60).toFixed(1)}h` : ''}`
      );
    }
    if (p.headlines.workouts) {
      const h = p.headlines.workouts;
      t.push(
        `  WORKOUTS total=${h.totalWorkouts} this_week=${h.thisWeekCount} this_week_min=${i(h.thisWeekMinutes)} streak=${h.currentStreakDays} longest_streak=${h.longestStreakDays}${h.favoriteType ? ` favorite=${q(h.favoriteType)}` : ''}`
      );
    }
    if (p.headlines.body) {
      const h = p.headlines.body;
      t.push(
        `  BODY weight_kg=${n(h.currentKg, 2)} weight_lb=${n(h.currentLb, 1)} change_30d=${n(h.change30d, 2)} change_1y=${n(h.change1y, 2)}`
      );
    }

    // Period summaries — pick one per segment (most recent / "This Week")
    for (const [seg, periods] of Object.entries(p.periods)) {
      for (const period of periods) {
        if (period.stats.length === 0) continue;
        const stats = period.stats
          .filter((st) => st.value != null)
          .map(
            (st) =>
              `${st.label}=${n(st.value, 1)}${st.deltaPct != null ? `(${st.deltaPct >= 0 ? '+' : ''}${st.deltaPct.toFixed(0)}%)` : ''}`
          )
          .join(' ');
        if (stats) {
          t.push(
            `  PERIOD seg=${seg} name=${q(period.name)} ${period.start}..${period.end} ${stats}`
          );
        }
      }
    }

    if (p.illnessPeriods.length > 0) {
      const likely = p.illnessPeriods.filter((x) => x.confidence === 'likely').length;
      const possible = p.illnessPeriods.filter((x) => x.confidence === 'possible').length;
      t.push(`  ILLNESS periods=${p.illnessPeriods.length} likely=${likely} possible=${possible}`);
      for (const ip of p.illnessPeriods.slice(-10)) {
        t.push(
          `    ${ip.startDate}..${ip.endDate} days=${ip.durationDays} conf=${ip.confidence} signals=${ip.signals.join(',')}`
        );
      }
    }

    if (p.clinical) {
      const c = p.clinical;
      t.push(
        `  CLINICAL records=${c.recordCount} labs=${c.labs.length} conditions=${c.conditions.length} meds=${c.medications.length} imm=${c.immunizations.length} allergies=${c.allergies.length} procs=${c.procedures.length} docs=${c.documents.length} range=${c.dateRange.start ?? ''}..${c.dateRange.end ?? ''}${c.schemaStale ? ' SCHEMA_STALE=true' : ''}`
      );
      for (const lab of c.labs.slice(0, 60)) {
        const val = lab.latest.value ?? lab.latest.valueString ?? '—';
        const unit = lab.unit ? ` ${lab.unit}` : '';
        const flag = lab.latest.flag ? ` flag=${lab.latest.flag}` : '';
        const ref =
          lab.refLow != null || lab.refHigh != null
            ? ` ref=${lab.refLow ?? ''}-${lab.refHigh ?? ''}`
            : '';
        t.push(
          `    LAB name=${q(lab.name)} latest=${val}${unit}${lab.latest.date ? ` date=${lab.latest.date}` : ''}${flag}${ref} n=${lab.pointCount}`
        );
      }
      for (const cond of c.conditions) {
        t.push(
          `    CONDITION name=${q(cond.name)}${cond.icd10 ? ` icd10=${cond.icd10}` : ''}${cond.clinicalStatus ? ` status=${cond.clinicalStatus}` : ''}${cond.onsetDate ? ` onset=${cond.onsetDate}` : ''}${cond.abatementDate ? ` abatement=${cond.abatementDate}` : ''}`
        );
      }
      for (const med of c.medications) {
        t.push(
          `    MEDICATION name=${q(med.name)}${med.status ? ` status=${med.status}` : ''}${med.startDate ? ` start=${med.startDate}` : ''}${med.endDate ? ` end=${med.endDate}` : ''}${med.dosageText ? ` dose=${q(med.dosageText)}` : ''}`
        );
      }
      for (const a of c.allergies) {
        t.push(
          `    ALLERGY name=${q(a.name)}${a.clinicalStatus ? ` status=${a.clinicalStatus}` : ''}${a.reactions.length ? ` reactions=${q(a.reactions.join(';'))}` : ''}`
        );
      }
      for (const im of c.immunizations.slice(-20)) {
        t.push(
          `    IMMUNIZATION name=${q(im.name)}${im.date ? ` date=${im.date}` : ''}${im.cvx ? ` cvx=${im.cvx}` : ''}`
        );
      }
      for (const pr of c.procedures.slice(-20)) {
        t.push(
          `    PROCEDURE name=${q(pr.name)}${pr.date ? ` date=${pr.date}` : ''}${pr.cpt ? ` cpt=${pr.cpt}` : ''}`
        );
      }
    }

    if (p.dna) {
      const d = p.dna;
      t.push(
        `  DNA snps=${d.snpsLoaded} coverage_pct=${n(d.chipCoverageEstimate, 1)} traits=${d.traits.length} health=${d.health.length} experimental=${d.experimental.length}${d.apoe ? ` apoe=${q(d.apoe)}` : ''}`
      );
      for (const tr of d.traits) {
        t.push(
          `    TRAIT cat=${q(tr.category)} name=${q(tr.trait)} gene=${tr.gene} rsid=${tr.rsid} geno=${tr.genotype} interp=${q(tr.interpretation)}`
        );
      }
      for (const tr of d.health) {
        t.push(
          `    HEALTH_TRAIT cat=${q(tr.category)} name=${q(tr.trait)} gene=${tr.gene} rsid=${tr.rsid} geno=${tr.genotype} interp=${q(tr.interpretation)}`
        );
      }
      for (const pg of d.polygenic) {
        t.push(
          `    POLYGENIC name=${q(pg.name)} score=${pg.score}/${pg.max} snps=${pg.snpsFound}/${pg.snpsTotal} interp=${q(pg.interpretation)}`
        );
      }
    }

    if (p.nutrition) {
      const n = p.nutrition;
      t.push(
        `  NUTRITION active=${n.activeCount} considering=${n.consideringCount} past=${n.pastCount}`
      );
      for (const e of n.entries) {
        const product = e.productName ?? '(unparsed)';
        const brand = e.brandName ? ` brand=${q(e.brandName)}` : '';
        const cat = e.category ? ` cat=${e.category}` : '';
        const doseBits: string[] = [];
        if (e.dose?.amount != null) doseBits.push(`${e.dose.amount}`);
        if (e.dose?.unit) doseBits.push(e.dose.unit);
        if (e.dose?.frequency) doseBits.push(e.dose.frequency);
        if (e.dose?.timeOfDay) doseBits.push(`@${e.dose.timeOfDay}`);
        if (e.dose?.frequencyCustom) doseBits.push(`"${e.dose.frequencyCustom}"`);
        const doseStr = doseBits.length > 0 ? ` dose=${q(doseBits.join(' '))}` : '';
        const notesStr = e.notes ? ` notes=${q(e.notes)}` : '';
        const errStr = e.parseError ? ' PARSE_ERROR=true' : '';
        t.push(
          `    ${e.status.toUpperCase()} product=${q(product)}${brand}${cat}${doseStr}${notesStr}${errStr}`
        );
        if (e.summary.servingSize) {
          t.push(`      serving=${q(e.summary.servingSize)}`);
        }
        for (const v of e.summary.vitamins) {
          const dvStr = v.dv != null ? ` dv=${v.dv}%` : '';
          t.push(`      VIT ${v.name} ${v.amount ?? ''}${v.unit ? v.unit : ''}${dvStr}`);
        }
        for (const m of e.summary.minerals) {
          const dvStr = m.dv != null ? ` dv=${m.dv}%` : '';
          t.push(`      MIN ${m.name} ${m.amount ?? ''}${m.unit ? m.unit : ''}${dvStr}`);
        }
        for (const a of e.summary.otherActive) {
          const dvStr = a.dv != null ? ` dv=${a.dv}%` : '';
          t.push(`      ACTIVE ${a.name} ${a.amount ?? ''}${a.unit ? a.unit : ''}${dvStr}`);
        }
        for (const b of e.summary.proprietaryBlends) {
          t.push(
            `      BLEND ${q(b.name)}${b.ingredients?.length ? ` items=${q(b.ingredients.join(';'))}` : ''}`
          );
        }
      }
    }

    if (p.sicknessLogs.length > 0) {
      const active = p.sicknessLogs.filter((l) => !l.endDate);
      t.push(
        `  SICKNESS logs=${p.sicknessLogs.length}${active.length > 0 ? ` active=${active.length}` : ''}`
      );
      for (const sl of p.sicknessLogs.slice(0, 20)) {
        const range = sl.endDate ? `${sl.startDate}..${sl.endDate}` : `${sl.startDate}..ongoing`;
        const symptoms = sl.symptoms.length > 0 ? ` symptoms=${q(sl.symptoms.join(','))}` : '';
        const meds =
          sl.medications.length > 0
            ? ` meds=${q(
                sl.medications
                  .map(
                    (m) =>
                      `${m.name}${m.doseText ? ' ' + m.doseText : ''}${m.count ? ' x' + m.count : ''}`
                  )
                  .join(';')
              )}`
            : '';
        const notes = sl.notes ? ` notes=${q(sl.notes.slice(0, 200))}` : '';
        t.push(
          `    ${sl.severity.toUpperCase()} ${range} cat=${sl.category} title=${q(sl.title)}${symptoms}${meds}${notes}`
        );
      }
    }

    t.push('');
  }

  if (s.reminders.length > 0) {
    const pending = s.reminders.filter((r) => r.status !== 'completed');
    t.push(`HEALTH_REMINDERS total=${s.reminders.length} pending=${pending.length}`);
    for (const r of s.reminders) {
      t.push(
        `  title=${q(r.title)} due=${r.dueDate} status=${r.status}${r.recurrence ? ` recur=${r.recurrence}` : ''}${r.notes ? ` notes=${q(r.notes)}` : ''}`
      );
    }
  }

  return t.join('\n');
}

// ---------------------------------------------------------------------------
// Markdown renderer — tables + prose for human reading
// ---------------------------------------------------------------------------

function renderMarkdown(
  s: ReturnType<typeof packSnapshot>,
  opts: { includeResearch?: boolean } = {}
): string {
  const L: string[] = [];
  const n = (v: number | null | undefined, d = 1): string =>
    typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : '—';
  const i = (v: number | null | undefined): string =>
    typeof v === 'number' && Number.isFinite(v) ? String(Math.round(v)) : '—';

  L.push(`# Health Snapshot`);
  L.push(`Generated: ${new Date().toISOString().split('T')[0]}`);
  L.push(
    `People: ${s.peopleCount} · With Exports: ${s.aggregates.withExports} · With Clinical: ${s.aggregates.withClinical} · With DNA: ${s.aggregates.withDNA}`
  );
  if (s.aggregates.avgRestingHR != null || s.aggregates.avgSleepHours90d != null) {
    L.push(
      `Averages across household: RHR ${i(s.aggregates.avgRestingHR)} bpm · Sleep ${n(s.aggregates.avgSleepHours90d, 2)} hrs (90d)`
    );
  }
  L.push('');

  for (const p of s.people) {
    L.push(`## ${p.name}${p.archived ? ' _(archived)_' : ''}`);
    if (p.sourceFilename) L.push(`_Source: ${p.sourceFilename}_`);
    if (p.dateRange?.start) L.push(`_Date range: ${p.dateRange.start} → ${p.dateRange.end}_`);
    if (p.snapshotStale) L.push(`> **Snapshot schema is stale — re-parse recommended.**`);
    L.push('');

    if (p.headlines.activity) {
      const h = p.headlines.activity;
      L.push(`### Activity`);
      L.push('| Metric | Value |');
      L.push('|--------|-------|');
      L.push(`| Steps (90d avg) | ${i(h.avgDailySteps90d)} |`);
      L.push(`| Total steps | ${h.totalSteps.toLocaleString()} |`);
      L.push(`| Active energy (kcal) | ${i(h.totalActiveEnergy)} |`);
      L.push(`| Exercise minutes | ${i(h.totalExerciseMinutes)} |`);
      if (h.ringCompletionPct != null)
        L.push(`| Ring completion | ${h.ringCompletionPct.toFixed(0)}% |`);
      if (h.mostActiveDay)
        L.push(`| Most active day | ${h.mostActiveDay.date} (${h.mostActiveDay.steps} steps) |`);
      L.push('');
    }

    if (p.headlines.heart) {
      const h = p.headlines.heart;
      L.push(`### Heart`);
      L.push('| Metric | Latest | 90d Avg | Trend |');
      L.push('|--------|--------|---------|-------|');
      L.push(
        `| Resting HR | ${i(h.latestRestingHR)} bpm | ${i(h.avgRestingHR90d)} bpm | ${h.restingHRTrend} |`
      );
      L.push(`| HRV | ${i(h.latestHRV)} ms | ${i(h.avgHRV90d)} ms | ${h.hrvTrend} |`);
      L.push('');
    }

    if (p.headlines.sleep) {
      const h = p.headlines.sleep;
      L.push(`### Sleep`);
      L.push(`- Avg hours (90d): **${n(h.avgSleepHours90d, 2)}**`);
      L.push(`- Avg hours (all time): ${n(h.avgSleepHoursAll, 2)}`);
      L.push(`- Nights ≥7 hours: ${h.nightsWith7Plus}`);
      L.push(`- Nights ≥5 hours: ${h.nightsWith5Plus}`);
      if (h.longestSleep)
        L.push(
          `- Longest night: ${(h.longestSleep.minutes / 60).toFixed(1)}h on ${h.longestSleep.date}`
        );
      if (h.shortestSleep)
        L.push(
          `- Shortest night: ${(h.shortestSleep.minutes / 60).toFixed(1)}h on ${h.shortestSleep.date}`
        );
      L.push('');
    }

    if (p.headlines.workouts) {
      const h = p.headlines.workouts;
      L.push(`### Workouts`);
      L.push(
        `- Total: **${h.totalWorkouts}** · This week: ${h.thisWeekCount} (${i(h.thisWeekMinutes)} min)`
      );
      L.push(`- Current streak: ${h.currentStreakDays}d · Longest streak: ${h.longestStreakDays}d`);
      if (h.favoriteType) L.push(`- Favorite: ${h.favoriteType}`);
      L.push('');
    }

    if (p.headlines.body || p.body) {
      const h = p.headlines.body;
      const body = p.body;
      const weights = body?.weightHistory ?? [];
      const hasWeights = weights.length > 0;
      if (hasWeights || (h && (h.currentKg != null || h.currentLb != null))) {
        L.push(`### Body`);
        if (h && (h.currentKg != null || h.currentLb != null)) {
          L.push(`- Weight: ${n(h.currentKg, 2)} kg / ${n(h.currentLb, 1)} lb`);
        }
        if (h?.change30d != null)
          L.push(`- 30d change: ${h.change30d >= 0 ? '+' : ''}${h.change30d.toFixed(2)} kg`);
        if (h?.change1y != null)
          L.push(`- 1y change: ${h.change1y >= 0 ? '+' : ''}${h.change1y.toFixed(2)} kg`);
        if (hasWeights) {
          const first = weights[0];
          const last = weights[weights.length - 1];
          const spanDays = Math.round(
            (new Date(`${last.date}T00:00:00Z`).getTime() -
              new Date(`${first.date}T00:00:00Z`).getTime()) /
              86_400_000
          );
          const years = spanDays / 365.25;
          const netLb = last.lb - first.lb;
          const clinicalCount = weights.filter((w) => w.source === 'clinical').length;
          const appleCount = weights.length - clinicalCount;
          L.push(
            `- Tracking span: ${first.date} → ${last.date} (${years >= 1 ? years.toFixed(1) + 'y' : spanDays + 'd'}) · ` +
              `${weights.length} points (${clinicalCount} clinical / ${appleCount} apple-health)`
          );
          L.push(
            `- Net since first reading: ${netLb >= 0 ? '+' : ''}${netLb.toFixed(1)} lb ` +
              `(${first.lb.toFixed(1)} → ${last.lb.toFixed(1)} lb)`
          );
        }
        if (body?.heightCm != null && body.heightIn != null) {
          L.push(`- Height: ${body.heightIn.toFixed(1)} in / ${body.heightCm.toFixed(1)} cm`);
          if (h?.currentKg != null) {
            const bmi = h.currentKg / Math.pow(body.heightCm / 100, 2);
            const tier =
              bmi < 18.5 ? 'underweight' : bmi < 25 ? 'normal' : bmi < 30 ? 'overweight' : 'obese';
            L.push(`- BMI: ${bmi.toFixed(1)} (${tier})`);
          }
        }
        // Compact recent weight trend table (last 6 readings) — exposes the
        // VA inflection without dumping the whole history.
        if (weights.length > 1) {
          const recent = weights.slice(-6);
          L.push('');
          L.push('| Date | Weight (lb) | Source |');
          L.push('|------|-------------|--------|');
          for (const w of recent) {
            L.push(`| ${w.date} | ${w.lb.toFixed(1)} | ${w.source} |`);
          }
        }
        L.push('');
      }
    }

    if (p.clinicalVitals) {
      const v = p.clinicalVitals;
      const hasAny =
        v.bp.length > 0 ||
        v.heartRate.length > 0 ||
        v.temperature.length > 0 ||
        v.oxygenSaturation.length > 0 ||
        v.respiratoryRate.length > 0 ||
        v.pain.length > 0;
      if (hasAny) {
        L.push(`### Clinical Vitals (VA / FHIR)`);
        if (v.headline.latestBP) {
          const b = v.headline.latestBP;
          L.push(`- Latest BP: **${b.systolic}/${b.diastolic}** mmHg (${b.date})`);
          if (v.headline.avgBP90d) {
            L.push(
              `- 90d avg BP: ${v.headline.avgBP90d.systolic}/${v.headline.avgBP90d.diastolic} mmHg`
            );
          }
        }
        if (v.headline.latestTemperatureF != null) {
          L.push(`- Latest temperature: ${v.headline.latestTemperatureF.toFixed(1)} °F`);
        }
        if (v.headline.latestSpO2 != null) {
          L.push(`- Latest SpO₂: ${v.headline.latestSpO2}%`);
        }

        // Per-vital trend summary: last 5 readings each. Keeps the markdown
        // compact while still showing cross-year movement at a glance.
        const renderSeries = (
          title: string,
          series: Array<{
            date: string;
            value?: number;
            systolic?: number;
            diastolic?: number;
            unit: string | null;
          }>,
          fmt: (p: {
            date: string;
            value?: number;
            systolic?: number;
            diastolic?: number;
            unit: string | null;
          }) => string
        ) => {
          if (series.length === 0) return;
          const recent = series.slice(-5);
          L.push('');
          L.push(`#### ${title} — ${series.length} reading${series.length === 1 ? '' : 's'}`);
          L.push('| Date | Value |');
          L.push('|------|-------|');
          for (const pt of recent) L.push(`| ${pt.date} | ${fmt(pt)} |`);
        };

        renderSeries('Blood pressure', v.bp, (pt) => `${pt.systolic}/${pt.diastolic} mmHg`);
        renderSeries('Heart rate', v.heartRate, (pt) => `${pt.value} bpm`);
        renderSeries('Temperature', v.temperature, (pt) => `${pt.value} ${pt.unit ?? ''}`.trim());
        renderSeries('SpO₂', v.oxygenSaturation, (pt) => `${pt.value}%`);
        renderSeries('Respiratory rate', v.respiratoryRate, (pt) => `${pt.value} /min`);
        renderSeries('Pain severity', v.pain, (pt) => `${pt.value}/10`);
        L.push('');
      }
    }

    if (p.illnessPeriods.length > 0) {
      L.push(`### Illness Periods`);
      L.push('| Start | End | Days | Confidence | Signals |');
      L.push('|-------|-----|------|------------|---------|');
      for (const ip of p.illnessPeriods) {
        L.push(
          `| ${ip.startDate} | ${ip.endDate} | ${ip.durationDays} | ${ip.confidence} | ${ip.signals.join(', ')} |`
        );
      }
      L.push('');
    }

    if (p.clinical) {
      const c = p.clinical;
      L.push(`### Clinical Records`);
      L.push(
        `_${c.recordCount} records · range ${c.dateRange.start ?? 'n/a'} → ${c.dateRange.end ?? 'n/a'}${c.schemaStale ? ' · **schema stale**' : ''}_`
      );
      if (c.labs.length > 0) {
        L.push('');
        L.push(`#### Labs (latest reading per test)`);
        L.push('| Test | Latest | Unit | Date | Flag | Ref Range | # |');
        L.push('|------|--------|------|------|------|-----------|---|');
        for (const lab of c.labs) {
          const val = lab.latest.value ?? lab.latest.valueString ?? '—';
          const ref =
            lab.refLow != null || lab.refHigh != null
              ? `${lab.refLow ?? ''}–${lab.refHigh ?? ''}`
              : '';
          L.push(
            `| ${lab.name} | ${val} | ${lab.unit ?? ''} | ${lab.latest.date ?? ''} | ${lab.latest.flag ?? ''} | ${ref} | ${lab.pointCount} |`
          );
        }
      }
      if (c.conditions.length > 0) {
        L.push('');
        L.push(`#### Conditions`);
        for (const cond of c.conditions) {
          const onset = cond.onsetDate ? ` (onset ${cond.onsetDate})` : '';
          L.push(
            `- **${cond.name}**${cond.icd10 ? ` [${cond.icd10}]` : ''}${onset} — ${cond.clinicalStatus ?? 'unknown'}`
          );
        }
      }
      if (c.medications.length > 0) {
        L.push('');
        L.push(`#### Medications`);
        for (const m of c.medications) {
          const range = m.startDate
            ? ` (${m.startDate}${m.endDate ? ` → ${m.endDate}` : ' → present'})`
            : '';
          L.push(
            `- **${m.name}**${range} — ${m.status ?? ''}${m.dosageText ? ` · ${m.dosageText}` : ''}`
          );
        }
      }
      if (c.allergies.length > 0) {
        L.push('');
        L.push(`#### Allergies`);
        for (const a of c.allergies) {
          L.push(`- ${a.name}${a.reactions.length ? ` — ${a.reactions.join(', ')}` : ''}`);
        }
      }
      if (c.immunizations.length > 0) {
        L.push('');
        L.push(`#### Immunizations (${c.immunizations.length})`);
        for (const im of c.immunizations.slice(-15)) {
          L.push(`- ${im.date ?? ''} — ${im.name}`);
        }
      }
      L.push('');
    }

    if (p.dna) {
      const d = p.dna;
      L.push(`### DNA`);
      L.push(
        `- **${d.snpsLoaded.toLocaleString()} SNPs loaded** (~${d.chipCoverageEstimate.toFixed(1)}% of common human variants)`
      );
      L.push(
        `- Traits: ${d.traits.length} · Health: ${d.health.length} · Experimental: ${d.experimental.length}`
      );
      if (d.apoe) L.push(`- APOE: ${d.apoe.replace(/\n/g, ' ')}`);
      if (d.health.length > 0) {
        L.push('');
        L.push(`#### Health traits`);
        L.push('| Category | Trait | Gene | Genotype | Interpretation |');
        L.push('|----------|-------|------|----------|-----------------|');
        for (const tr of d.health) {
          L.push(
            `| ${tr.category} | ${tr.trait} | ${tr.gene} | ${tr.genotype} | ${tr.interpretation} |`
          );
        }
      }
      if (d.polygenic.length > 0) {
        L.push('');
        L.push(`#### Polygenic scores`);
        for (const pg of d.polygenic) {
          L.push(`- **${pg.name}** · score ${pg.score}/${pg.max} · ${pg.interpretation}`);
        }
      }
      L.push('');
    }

    if (p.nutrition) {
      const n = p.nutrition;
      L.push(
        `### Nutrition & Supplements (${n.activeCount} active · ${n.consideringCount} considering · ${n.pastCount} past)`
      );
      // Active section first — the actual daily regimen
      const active = n.entries.filter((e) => e.status === 'active');
      if (active.length > 0) {
        L.push('');
        L.push('#### Active daily regimen');
        L.push('| Product | Category | Dose | Serving | Notes |');
        L.push('|---------|----------|------|---------|-------|');
        for (const e of active) {
          const product = e.productName ?? '_unparsed_';
          const brand = e.brandName ? ` (${e.brandName})` : '';
          const dose = formatDose(e.dose);
          const serving = e.summary.servingSize ?? '';
          const notes = e.notes ?? '';
          L.push(
            `| **${product}**${brand} | ${e.category ?? ''} | ${dose} | ${serving} | ${notes} |`
          );
        }
      }
      // Considering
      const considering = n.entries.filter((e) => e.status === 'considering');
      if (considering.length > 0) {
        L.push('');
        L.push(`#### Considering`);
        for (const e of considering) {
          L.push(
            `- ${e.productName ?? '_unparsed_'}${e.brandName ? ` (${e.brandName})` : ''}${e.notes ? ` — ${e.notes}` : ''}`
          );
        }
      }
      // Past — show briefly
      const past = n.entries.filter((e) => e.status === 'past');
      if (past.length > 0) {
        L.push('');
        L.push(`#### Past`);
        for (const e of past) {
          L.push(`- ${e.productName ?? '_unparsed_'}${e.notes ? ` — ${e.notes}` : ''}`);
        }
      }
      // Vitamin + mineral aggregate across active items
      const totals = sumMicronutrients(active);
      if (totals.length > 0) {
        L.push('');
        L.push(`#### Daily micronutrient totals (active supplements)`);
        L.push('| Nutrient | Total | Unit | Across products |');
        L.push('|----------|-------|------|-----------------|');
        for (const t of totals) {
          L.push(`| ${t.name} | ${t.total.toFixed(2)} | ${t.unit} | ${t.sources.join(', ')} |`);
        }
      }
      // Evidence per supplement — only when ?includeResearch=true, only for entries
      // that actually have research prose or a citations array populated.
      if (opts.includeResearch) {
        const withResearch = active.filter(
          (e) =>
            (e.research && e.research.trim().length > 0) || (e.citations && e.citations.length > 0)
        );
        if (withResearch.length > 0) {
          L.push('');
          L.push(`#### Evidence per supplement`);
          for (const e of withResearch) {
            const product = e.productName ?? '(unparsed)';
            const brand = e.brandName ? ` (${e.brandName})` : '';
            L.push('');
            L.push(`##### ${product}${brand}`);
            if (e.research && e.research.trim().length > 0) {
              L.push('');
              L.push(e.research.trim());
            }
            if (e.citations && e.citations.length > 0) {
              L.push('');
              L.push('**References:**');
              e.citations.forEach((c, i) => {
                const ref = formatCitation(c);
                L.push(`${i + 1}. ${ref}`);
              });
            }
          }
        }
      }
      L.push('');
    }

    if (p.sicknessLogs.length > 0) {
      const active = p.sicknessLogs.filter((l) => !l.endDate);
      L.push(
        `### Sickness Log (${p.sicknessLogs.length} total${active.length > 0 ? ` · ${active.length} active` : ''})`
      );
      L.push('');
      L.push('| Dates | Severity | Category | Title | Symptoms | Meds | Notes |');
      L.push('|-------|----------|----------|-------|----------|------|-------|');
      for (const sl of p.sicknessLogs.slice(0, 25)) {
        const range = sl.endDate ? `${sl.startDate} → ${sl.endDate}` : `${sl.startDate} → ongoing`;
        const symptoms = sl.symptoms.join(', ') || '—';
        const meds =
          sl.medications
            .map(
              (m) =>
                `${m.name}${m.doseText ? ` ${m.doseText}` : ''}${m.count ? ` ×${m.count}` : ''}`
            )
            .join(', ') || '—';
        const notes = sl.notes ? sl.notes.replace(/\n/g, ' ').slice(0, 120) : '';
        L.push(
          `| ${range} | ${sl.severity} | ${sl.category} | ${sl.title} | ${symptoms} | ${meds} | ${notes} |`
        );
      }
      L.push('');
    }
  }

  if (s.reminders.length > 0) {
    const pending = s.reminders.filter((r) => r.status !== 'completed');
    L.push(`## Health Reminders (${pending.length} pending / ${s.reminders.length} total)`);
    L.push('| Due | Title | Status | Recurrence | Notes |');
    L.push('|-----|-------|--------|-----------|-------|');
    for (const r of [...s.reminders].sort((a, b) => a.dueDate.localeCompare(b.dueDate))) {
      L.push(
        `| ${r.dueDate} | ${r.title} | ${r.status} | ${r.recurrence ?? ''} | ${r.notes ?? ''} |`
      );
    }
    L.push('');
  }

  return L.join('\n');
}

// ---------------------------------------------------------------------------
// Nutrition helpers for markdown rendering
// ---------------------------------------------------------------------------

function formatDose(dose: NutritionEntry['dose']): string {
  if (!dose) return '';
  const parts: string[] = [];
  if (dose.amount != null) parts.push(String(dose.amount));
  if (dose.unit) parts.push(dose.unit);
  if (dose.frequency) {
    if (dose.frequency === 'custom' && dose.frequencyCustom) parts.push(dose.frequencyCustom);
    else parts.push(dose.frequency);
  }
  if (dose.timeOfDay) parts.push(`@${dose.timeOfDay}`);
  return parts.join(' ');
}

/**
 * Render a structured citation as a Vancouver-ish markdown line.
 * Prefers explicit url, then PMID (links to PubMed), then DOI (links to doi.org).
 */
function formatCitation(c: NonNullable<NutritionEntry['citations']>[number]): string {
  const parts: string[] = [];
  parts.push(`${c.authors} ${c.year}.`);
  parts.push(`*${c.journal}*.`);
  if (c.pmid) {
    parts.push(`PMID [${c.pmid}](https://pubmed.ncbi.nlm.nih.gov/${c.pmid}/).`);
  } else if (c.doi) {
    parts.push(`DOI [${c.doi}](https://doi.org/${c.doi}).`);
  } else if (c.url) {
    parts.push(`[link](${c.url}).`);
  }
  parts.push(`${c.title}.`);
  if (c.findings) parts.push(c.findings);
  return parts.join(' ');
}

/**
 * Roll up vitamins + minerals + otherActive across multiple active supplements.
 * Groups by lowercased `name` + unit (so "Zinc 15mg" + "Zinc 15mg" = 30mg total).
 * Different units for the same nutrient (e.g. IU vs mcg) show up as separate rows
 * because we can't safely assume conversion factors without knowing the nutrient.
 */
function sumMicronutrients(
  active: NutritionSurface['entries']
): Array<{ name: string; total: number; unit: string; sources: string[] }> {
  const groups = new Map<
    string,
    { name: string; unit: string; total: number; sources: string[] }
  >();
  for (const entry of active) {
    const product = entry.productName ?? '(unparsed)';
    const allNutrients = [
      ...entry.summary.vitamins,
      ...entry.summary.minerals,
      ...entry.summary.otherActive,
    ];
    for (const n of allNutrients) {
      if (n.amount == null || !n.unit) continue;
      const key = `${n.name.toLowerCase()}|${n.unit.toLowerCase()}`;
      const existing = groups.get(key);
      if (existing) {
        existing.total += n.amount;
        if (!existing.sources.includes(product)) existing.sources.push(product);
      } else {
        groups.set(key, { name: n.name, unit: n.unit, total: n.amount, sources: [product] });
      }
    }
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// Type helper so renderers can pull the packed shape.
type SnapshotShape = {
  generatedAt: string;
  peopleCount: number;
  people: PersonSurface[];
  reminders: Reminder[];
  aggregates: {
    peopleCount: number;
    withExports: number;
    withClinical: number;
    withDNA: number;
    totalWorkouts: number;
    totalSteps: number;
    avgRestingHR: number | null;
    avgSleepHours90d: number | null;
  };
};
function packSnapshot(s: SnapshotShape): SnapshotShape {
  return s;
}
