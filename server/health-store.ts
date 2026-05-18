// Shared health-data store — single source of truth for `.docvault-health.json`.
//
// Three route modules (routes/health.ts, routes/nutrition.ts, routes/sickness.ts)
// and one consumer (routes/health-snapshot.ts) all read/write this file. Before
// this module existed each of them had its own private loadHealthStore /
// saveHealthStore / requirePerson and its own narrow HealthStore-shape
// interface — four near-identical copies that drifted into a silent-wipe bug
// (see health-store-roundtrip.test.ts).
//
// Consolidating here:
//   - Atomic save (tmp + rename) lives in one place.
//   - The spread-first load pattern that preserves sibling-owned fields lives
//     in one place — there is no longer a way to forget the spread.
//   - The cross-module types (NutritionEntry, SicknessLog, …) live next to
//     the store that owns them, breaking the cycle that would otherwise form
//     if the canonical HealthStore tried to import them from the route files.
//     The route files re-export them for back-compat.

import { promises as fs } from 'fs';
import path from 'path';
import { DATA_DIR, ensureDir, type HealthPerson } from './data.js';
import type { AppleHealthSummary } from './parsers/apple-health.js';
import type { PersonSnapshots } from './parsers/apple-health-snapshots.js';
import type { ClinicalSummary } from './parsers/apple-health-clinical.js';
import type { ParsedNutritionLabel } from './parsers/nutrition-label.js';

// ---------------------------------------------------------------------------
// File location
// ---------------------------------------------------------------------------

export const HEALTH_STORE_FILE = path.join(DATA_DIR, '.docvault-health.json');

// ---------------------------------------------------------------------------
// Nutrition types — moved from routes/nutrition.ts so HealthStore can carry
// them with their proper narrow types without creating an import cycle.
// ---------------------------------------------------------------------------

export type NutritionStatus = 'considering' | 'active' | 'past' | 'never';

export interface NutritionDose {
  amount?: number;
  /** e.g. "capsules", "tablets", "tbsp", "scoops", "softgels" */
  unit?: string;
  frequency?: 'daily' | 'twice-daily' | 'as-needed' | 'weekly' | 'custom';
  /** Populated when frequency === 'custom'; free-form like "3× per week post-ruck". */
  frequencyCustom?: string;
  timeOfDay?: 'morning' | 'midday' | 'evening' | 'bedtime' | 'pre-workout' | 'post-workout';
}

export interface NutritionCitation {
  /** Short ref id like "dabos-2010" — stable across edits so prose can reference it. */
  id: string;
  pmid?: string;
  doi?: string;
  authors: string;
  year: number;
  title: string;
  journal: string;
  /** One-line key finding — renders inline in the References list. */
  findings?: string;
  url?: string;
}

export interface NutritionEntry {
  id: string;
  personId: string;
  /** Original filename uploaded, for display. May be null for text-only entries. */
  filename: string | null;
  /**
   * Front-of-bottle / packaging shot — used for the card thumbnail. Optional
   * in spirit: empty string means absent (the chat-MCP creation path and
   * facts-only uploads both leave it blank). Older entries created via the
   * image-upload path always have it set.
   */
  imagePath: string;
  imageMediaType: string;
  /**
   * Close-up of the Supplement Facts / Nutrition Facts panel — separate slot
   * so the card thumbnail can stay the recognizable front shot while the
   * parser feeds on the actual label text. When set, the reparse endpoint
   * reads bytes from this slot (a clean panel) instead of the primary
   * (glossy product photography that's noisier for OCR). Missing or empty
   * string means absent — readers should fall back to imagePath.
   */
  factsImagePath?: string;
  factsImageMediaType?: string;
  factsFilename?: string | null;
  uploadedAt: string;
  parsedAt: string | null;
  parsed: ParsedNutritionLabel | null;
  /** Error message if parse failed; null if it succeeded or hasn't been attempted. */
  parseError: string | null;
  status: NutritionStatus;
  dose?: NutritionDose;
  /** Short, personal, mutable — renders inline in the snapshot regimen table. */
  notes?: string;
  /** Evidence-backed prose (markdown). Only renders when snapshot called with ?includeResearch=true. */
  research?: string;
  /** Structured citations referenced by the research prose. */
  citations?: NutritionCitation[];
  lastUpdated: string;
}

// ---------------------------------------------------------------------------
// Sickness types — moved from routes/sickness.ts for the same reason.
// ---------------------------------------------------------------------------

/** Broad category — coarse filter, not a clinical diagnosis. */
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
  name: string; // "Claritin-D", "Ibuprofen", etc.
  doseText?: string; // "10mg", "2 tabs", free-form
  count?: number; // how many doses taken over the episode
  notes?: string;
}

export interface SicknessLog {
  id: string;
  personId: string;
  /** ISO date (YYYY-MM-DD) — when symptoms started. */
  startDate: string;
  /** ISO date, inclusive. If omitted, episode is still active. */
  endDate?: string;
  category: SicknessCategory;
  severity: SicknessSeverity;
  /** Free-form one-line title, e.g. "Spring sinus congestion". */
  title: string;
  /** Symptom tags — "congestion", "fatigue", "headache", "sore throat", etc. */
  symptoms: string[];
  /** Medications taken during this episode. */
  medications: MedicationDose[];
  /** Long-form notes, markdown OK. */
  notes?: string;
  /**
   * Whether to link this log to auto-detected illness periods the parser
   * flagged during the same date range. The link is resolved at render
   * time by the frontend + snapshot — no persistent join.
   */
  linkToAutoDetection?: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Illness annotation — small enough that health.ts owned it inline, moved
// here so the HealthStore shape is fully typed.
// ---------------------------------------------------------------------------

/** User annotation on an auto-detected illness period. */
export interface IllnessNote {
  note?: string;
  dismissed?: boolean;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// The canonical store shape. Index signature preserved so unknown
// future fields written by other modules survive a save round-trip — this is
// the property guarded by health-store-roundtrip.test.ts.
// ---------------------------------------------------------------------------

export interface HealthStore {
  version: 1;
  people: HealthPerson[];
  /** key format: "<personId>/<filename>" */
  summaries: Record<string, AppleHealthSummary>;
  snapshots: Record<string, PersonSnapshots>;
  clinical?: Record<string, ClinicalSummary>;
  /** key format: "<personId>/<startDate>-<endDate>" */
  illnessNotes?: Record<string, IllnessNote>;
  /** key format: "<personId>/<entryId>" */
  nutrition?: Record<string, NutritionEntry>;
  /** key format: "<personId>/<logId>" */
  sicknessLogs?: Record<string, SicknessLog>;
  /**
   * Preserve fields owned by modules outside this file. Adding a new top-level
   * field in another module no longer requires editing this one — the index
   * signature makes the round-trip transparent.
   */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Loader / saver
// ---------------------------------------------------------------------------

/**
 * Load the health store, defaulting empty if the file doesn't exist yet.
 * Spreads the parsed object first so any unknown sibling-owned fields survive
 * the round-trip — see health-store-roundtrip.test.ts for the regression that
 * forced this contract.
 */
export async function loadHealthStore(): Promise<HealthStore> {
  try {
    const raw = await fs.readFile(HEALTH_STORE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<HealthStore>;
    return {
      // Spread first so explicit fields below win type-wise, but any unknown
      // sibling-owned fields survive instead of being silently wiped on save.
      ...parsed,
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

/**
 * Atomic save — write to a temp file then rename. Prevents partial writes on
 * crash (the user's "never pipe output back to same file" rule applied at the
 * serialization layer).
 */
export async function saveHealthStore(store: HealthStore): Promise<void> {
  await ensureDir(DATA_DIR);
  const tmp = `${HEALTH_STORE_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2));
  await fs.rename(tmp, HEALTH_STORE_FILE);
}

/** Compose the "<personId>/<filename>" key used for the per-person record maps. */
export function storeKey(personId: string, filename: string): string {
  return `${personId}/${filename}`;
}

/**
 * Look up a person by id, throwing if absent. The chat MCP layer relies on the
 * throw to surface a clean error back to the agent (which turns it into a
 * user-facing message instead of crashing the stream).
 */
export async function requirePerson(personId: string): Promise<HealthPerson> {
  const store = await loadHealthStore();
  const person = store.people.find((p) => p.id === personId);
  if (!person) {
    throw new Error(`Person "${personId}" not found`);
  }
  return person;
}
