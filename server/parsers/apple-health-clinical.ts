// Apple Health clinical-records parser.
//
// Apple Health exports ship clinical data separately from the HealthKit
// quantity/category records the XML parser handles. It lives in
// `apple_health_export/clinical-records/*.json` as FHIR R4 resources —
// Observation, DiagnosticReport, Condition, Immunization, MedicationRequest,
// AllergyIntolerance, Procedure, DocumentReference, Patient.
//
// Unlike the XML parser (which streams gigabytes via SAX), clinical-records
// is hundreds of small JSON files totalling a few MB — all safe to load
// and process in memory.
//
// What we produce: a ClinicalSummary with:
//   - Lab observations grouped by LOINC code (for trending)
//   - Panels (DiagnosticReports) with their result Observations resolved
//   - Vitals observations (BP, weight from visits, etc.)
//   - Conditions / problems list
//   - Medications
//   - Immunizations
//   - Allergies
//   - Procedures
//   - Document references (discharge summaries, notes)
//
// Design decisions:
//   - LOINC codes are the primary key for lab trending. `code.text` often
//     varies between providers ("HDL*" vs "HDL Cholesterol") so we key by
//     `coding[0].code` + system for stable cross-provider trending.
//   - Reference ranges travel with each observation. Labs sometimes change
//     their "normal" ranges, so we don't assume a global range per LOINC.
//   - DiagnosticReport.result[] holds URL-style references like
//     `https://.../Observation/<id>`. We extract the trailing segment and
//     match against each Observation's top-level `id`.
//   - Nothing in here touches the filesystem — the route layer does I/O,
//     we consume an already-loaded list of JSON blobs.

import { unzipSync } from 'fflate';
import { promises as fs } from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Output shape
// ---------------------------------------------------------------------------

export interface Coding {
  system?: string;
  code?: string;
  display?: string;
}

/** A single lab/vital measurement. LOINC-coded where available. */
export interface LabResult {
  /** FHIR resource id (used to link from DiagnosticReport.result[]). */
  id: string;
  /** Stable key for trending: prefers LOINC code, falls back to code.text. */
  loinc: string | null;
  /** Human-readable test name. */
  name: string;
  /** All codings (LOINC, provider-specific) for disambiguation. */
  codings: Coding[];
  /** Measured value — number for quantitative, string for qualitative. */
  value: number | null;
  valueString: string | null;
  unit: string | null;
  /** Reference range (per-observation, not per-LOINC — see file header). */
  refLow: number | null;
  refHigh: number | null;
  refText: string | null;
  /** YYYY-MM-DD (extracted from effectiveDateTime / issued). */
  date: string | null;
  /** Original ISO timestamp for precise ordering. */
  effectiveAt: string | null;
  /** FHIR status: preliminary | final | amended | corrected | cancelled. */
  status: string | null;
  /** H / L / N / A etc. — provider-reported flag. */
  interpretation: string | null;
  /** Auto-computed from value + refLow/refHigh when interpretation is missing. */
  derivedFlag: 'low' | 'high' | 'normal' | null;
  /** If this observation belongs to a DiagnosticReport, its id. */
  panelId: string | null;
}

/** A DiagnosticReport groups multiple LabResults into one visit's panel. */
export interface LabPanel {
  id: string;
  name: string;
  category: string | null;
  date: string | null;
  effectiveAt: string | null;
  issuedAt: string | null;
  status: string | null;
  conclusion: string | null;
  /** Observation ids referenced by this panel. */
  resultIds: string[];
}

/** One distinct lab test (keyed by LOINC) with its full history. */
export interface LabTrend {
  loinc: string | null;
  name: string;
  unit: string | null;
  /** Ordered oldest → newest. */
  points: LabResult[];
  latest: LabResult | null;
  /** Is the most recent reading out of range? */
  latestFlag: 'low' | 'high' | 'normal' | null;
  /** Most recent in-range / most recent reference range, when known. */
  refLow: number | null;
  refHigh: number | null;
}

export interface Condition {
  id: string;
  name: string;
  icd10: string | null;
  clinicalStatus: string | null;
  verificationStatus: string | null;
  onsetDate: string | null;
  recordedDate: string | null;
  abatementDate: string | null;
}

export interface Medication {
  id: string;
  name: string;
  status: string | null;
  authoredOn: string | null;
  dosageText: string | null;
  route: string | null;
  startDate: string | null;
  endDate: string | null;
}

export interface Immunization {
  id: string;
  name: string;
  cvx: string | null;
  status: string | null;
  date: string | null;
  primarySource: boolean | null;
}

export interface Allergy {
  id: string;
  name: string;
  clinicalStatus: string | null;
  recordedDate: string | null;
  reactions: string[];
}

export interface Procedure {
  id: string;
  name: string;
  cpt: string | null;
  status: string | null;
  date: string | null;
}

export interface DocumentRef {
  id: string;
  name: string;
  category: string | null;
  date: string | null;
  description: string | null;
}

/**
 * Clinical summary schema version. Bump when the output shape changes
 * in a way that invalidates cached summaries.
 *
 * History:
 *   1 — initial: labs (with LOINC trends), panels, vitals, conditions,
 *       medications, immunizations, allergies, procedures, documents.
 */
export const CLINICAL_SCHEMA_VERSION = 1;

export interface ClinicalSummary {
  schemaVersion: 1;
  /** Number of clinical-records files ingested. */
  recordCount: number;
  /** Date range of the ingested data (earliest/latest observation). */
  dateRange: { start: string | null; end: string | null };
  /** Every lab test keyed by LOINC (or display name fallback), trend-ready. */
  labsByTest: LabTrend[];
  /** Every DiagnosticReport with resolved result ids. */
  labPanels: LabPanel[];
  /** Vitals Observations from clinical visits (BP, weight, etc.). */
  vitals: LabResult[];
  conditions: Condition[];
  medications: Medication[];
  immunizations: Immunization[];
  allergies: Allergy[];
  procedures: Procedure[];
  documents: DocumentRef[];
  /** ISO timestamp this summary was produced. */
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// FHIR shape hints — loose typing, FHIR has way more fields than we care about
// ---------------------------------------------------------------------------

interface FhirCoding {
  system?: string;
  code?: string;
  display?: string;
}
interface FhirCodeableConcept {
  text?: string;
  coding?: FhirCoding[];
}
interface FhirQuantity {
  value?: number;
  unit?: string;
  system?: string;
  code?: string;
}
interface FhirReference {
  reference?: string;
  display?: string;
}
interface FhirRange {
  low?: FhirQuantity;
  high?: FhirQuantity;
  text?: string;
}
interface FhirObservation {
  resourceType: 'Observation';
  id?: string;
  status?: string;
  category?: FhirCodeableConcept[];
  code?: FhirCodeableConcept;
  valueQuantity?: FhirQuantity;
  valueString?: string;
  valueCodeableConcept?: FhirCodeableConcept;
  referenceRange?: FhirRange[];
  effectiveDateTime?: string;
  issued?: string;
  interpretation?: FhirCodeableConcept[] | FhirCodeableConcept | null;
}
interface FhirDiagnosticReport {
  resourceType: 'DiagnosticReport';
  id?: string;
  status?: string;
  category?: FhirCodeableConcept[];
  code?: FhirCodeableConcept;
  effectiveDateTime?: string;
  issued?: string;
  conclusion?: string;
  result?: FhirReference[];
}
interface FhirCondition {
  resourceType: 'Condition';
  id?: string;
  code?: FhirCodeableConcept;
  clinicalStatus?: FhirCodeableConcept;
  verificationStatus?: FhirCodeableConcept;
  onsetDateTime?: string;
  recordedDate?: string;
  abatementDateTime?: string;
}
interface FhirMedicationRequest {
  resourceType: 'MedicationRequest';
  id?: string;
  status?: string;
  authoredOn?: string;
  medicationCodeableConcept?: FhirCodeableConcept | null;
  medicationReference?: FhirReference;
  dosageInstruction?: Array<{
    text?: string;
    route?: FhirCodeableConcept;
    timing?: {
      code?: FhirCodeableConcept;
      repeat?: {
        boundsPeriod?: { start?: string; end?: string };
      };
    };
  }>;
}
interface FhirImmunization {
  resourceType: 'Immunization';
  id?: string;
  status?: string;
  occurrenceDateTime?: string;
  vaccineCode?: FhirCodeableConcept;
  primarySource?: boolean;
}
interface FhirAllergyIntolerance {
  resourceType: 'AllergyIntolerance';
  id?: string;
  code?: FhirCodeableConcept;
  clinicalStatus?: FhirCodeableConcept;
  recordedDate?: string;
  reaction?:
    | Array<{
        manifestation?: FhirCodeableConcept[];
      }>
    | {
        manifestation?: FhirCodeableConcept[];
      };
}
interface FhirProcedure {
  resourceType: 'Procedure';
  id?: string;
  status?: string;
  code?: FhirCodeableConcept;
  performedDateTime?: string;
  performedPeriod?: { start?: string; end?: string };
}
interface FhirDocumentReference {
  resourceType: 'DocumentReference';
  id?: string;
  status?: string;
  type?: FhirCodeableConcept;
  category?: FhirCodeableConcept[];
  date?: string;
  description?: string;
}

type FhirResource =
  | FhirObservation
  | FhirDiagnosticReport
  | FhirCondition
  | FhirMedicationRequest
  | FhirImmunization
  | FhirAllergyIntolerance
  | FhirProcedure
  | FhirDocumentReference
  | { resourceType: string; id?: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractDate(iso: string | undefined | null): string | null {
  if (!iso) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  return match ? match[1] : null;
}

/** Extract the resource id from a FHIR reference URL like `.../Observation/<id>`. */
export function extractRefId(ref: string | undefined): string | null {
  if (!ref) return null;
  const slash = ref.lastIndexOf('/');
  if (slash === -1) return null;
  const tail = ref.slice(slash + 1);
  return tail || null;
}

function firstCoding(cc: FhirCodeableConcept | undefined): FhirCoding | null {
  return cc?.coding?.[0] ?? null;
}

function isLoincCoding(c: FhirCoding | undefined): boolean {
  return c?.system === 'http://loinc.org' && typeof c.code === 'string' && c.code.length > 0;
}

function pickLoinc(cc: FhirCodeableConcept | undefined): string | null {
  if (!cc?.coding) return null;
  for (const c of cc.coding) {
    if (isLoincCoding(c)) return c.code ?? null;
  }
  return null;
}

function codingsOf(cc: FhirCodeableConcept | undefined): Coding[] {
  return (cc?.coding ?? []).map((c) => ({
    system: c.system,
    code: c.code,
    display: c.display,
  }));
}

function displayName(cc: FhirCodeableConcept | undefined, fallback = '—'): string {
  if (!cc) return fallback;
  if (cc.text && cc.text.trim()) return cc.text.trim();
  const first = firstCoding(cc);
  if (first?.display && first.display.trim()) return first.display.trim();
  if (first?.code && first.code.trim()) return first.code.trim();
  return fallback;
}

function clinicalStatusCode(cc: FhirCodeableConcept | undefined): string | null {
  const code = firstCoding(cc)?.code;
  if (code) return code;
  if (cc?.text) return cc.text;
  return null;
}

/**
 * Normalize provider-reported interpretation codes (H, L, N, A, etc.).
 * Returns the raw interpretation code/text or null.
 */
function interpretationCode(
  i: FhirCodeableConcept[] | FhirCodeableConcept | null | undefined
): string | null {
  if (!i) return null;
  const cc = Array.isArray(i) ? i[0] : i;
  if (!cc) return null;
  return firstCoding(cc)?.code ?? cc.text ?? null;
}

function derivedFlag(
  value: number | null,
  refLow: number | null,
  refHigh: number | null
): 'low' | 'high' | 'normal' | null {
  if (value === null) return null;
  if (refLow !== null && value < refLow) return 'low';
  if (refHigh !== null && value > refHigh) return 'high';
  if (refLow === null && refHigh === null) return null;
  return 'normal';
}

function isLabObservation(o: FhirObservation): boolean {
  return o.category?.some((c) => c.coding?.some((cc) => cc.code === 'laboratory')) ?? false;
}
function isVitalsObservation(o: FhirObservation): boolean {
  return o.category?.some((c) => c.coding?.some((cc) => cc.code === 'vital-signs')) ?? false;
}

// ---------------------------------------------------------------------------
// Resource → normalized shape
// ---------------------------------------------------------------------------

function normalizeObservation(o: FhirObservation): LabResult {
  const range = o.referenceRange?.[0];
  const refLow = range?.low?.value ?? null;
  const refHigh = range?.high?.value ?? null;
  const refText = range?.text ?? null;
  const value = o.valueQuantity?.value ?? null;
  const unit = o.valueQuantity?.unit ?? null;
  const valueString = o.valueString ?? (displayName(o.valueCodeableConcept, '') || null);
  const interp = interpretationCode(o.interpretation);
  const effectiveAt = o.effectiveDateTime ?? o.issued ?? null;

  return {
    id: o.id ?? '',
    loinc: pickLoinc(o.code),
    name: displayName(o.code),
    codings: codingsOf(o.code),
    value: typeof value === 'number' ? value : null,
    valueString: valueString || null,
    unit,
    refLow,
    refHigh,
    refText,
    date: extractDate(effectiveAt),
    effectiveAt,
    status: o.status ?? null,
    interpretation: interp,
    derivedFlag: derivedFlag(typeof value === 'number' ? value : null, refLow, refHigh),
    panelId: null, // filled in later during panel linking
  };
}

function normalizeDiagnosticReport(d: FhirDiagnosticReport): LabPanel {
  const categoryCode = firstCoding(d.category?.[0])?.code ?? d.category?.[0]?.text ?? null;
  const effectiveAt = d.effectiveDateTime ?? d.issued ?? null;
  const resultIds = (d.result ?? [])
    .map((r) => extractRefId(r.reference))
    .filter((x): x is string => x !== null);
  return {
    id: d.id ?? '',
    name: displayName(d.code, 'Report'),
    category: categoryCode,
    date: extractDate(effectiveAt),
    effectiveAt,
    issuedAt: d.issued ?? null,
    status: d.status ?? null,
    conclusion: d.conclusion ?? null,
    resultIds,
  };
}

function normalizeCondition(c: FhirCondition): Condition {
  const icd10 =
    c.code?.coding?.find((x) => x.system === 'http://hl7.org/fhir/sid/icd-10-cm')?.code ?? null;
  return {
    id: c.id ?? '',
    name: displayName(c.code),
    icd10,
    clinicalStatus: clinicalStatusCode(c.clinicalStatus),
    verificationStatus: clinicalStatusCode(c.verificationStatus),
    onsetDate: extractDate(c.onsetDateTime),
    recordedDate: extractDate(c.recordedDate),
    abatementDate: extractDate(c.abatementDateTime),
  };
}

function normalizeMedication(m: FhirMedicationRequest): Medication {
  const dose = m.dosageInstruction?.[0];
  // VA exports often leave medicationCodeableConcept null and stash the med
  // name inside dosageInstruction.timing.code.text or dosageInstruction.text.
  // Try the canonical field first, then cascade to VA-style locations.
  const canonicalName = m.medicationCodeableConcept
    ? displayName(m.medicationCodeableConcept, '')
    : '';
  const fallbackName =
    dose?.timing?.code?.text || m.medicationReference?.display || dose?.text || '';
  const name = canonicalName || fallbackName || 'Medication';
  const bounds = dose?.timing?.repeat?.boundsPeriod;
  return {
    id: m.id ?? '',
    name,
    status: m.status ?? null,
    authoredOn: extractDate(m.authoredOn),
    dosageText: dose?.text ?? null,
    route: dose?.route?.text ?? firstCoding(dose?.route)?.display ?? null,
    startDate: extractDate(bounds?.start),
    endDate: extractDate(bounds?.end),
  };
}

function normalizeImmunization(i: FhirImmunization): Immunization {
  const cvx =
    i.vaccineCode?.coding?.find((x) => x.system === 'http://hl7.org/fhir/sid/cvx')?.code ?? null;
  return {
    id: i.id ?? '',
    name: displayName(i.vaccineCode),
    cvx,
    status: i.status ?? null,
    date: extractDate(i.occurrenceDateTime),
    primarySource: i.primarySource ?? null,
  };
}

function normalizeAllergy(a: FhirAllergyIntolerance): Allergy {
  // FHIR allows reaction as array OR object — normalize to array first.
  const reactionArr = Array.isArray(a.reaction) ? a.reaction : a.reaction ? [a.reaction] : [];
  const reactions: string[] = [];
  for (const r of reactionArr) {
    for (const m of r.manifestation ?? []) {
      const name = displayName(m, '');
      if (name) reactions.push(name);
    }
  }
  return {
    id: a.id ?? '',
    name: displayName(a.code),
    clinicalStatus: clinicalStatusCode(a.clinicalStatus),
    recordedDate: extractDate(a.recordedDate),
    reactions,
  };
}

function normalizeProcedure(p: FhirProcedure): Procedure {
  const cpt =
    p.code?.coding?.find((x) => x.system === 'http://www.ama-assn.org/go/cpt')?.code ?? null;
  const date = extractDate(p.performedDateTime) ?? extractDate(p.performedPeriod?.start);
  return {
    id: p.id ?? '',
    name: displayName(p.code),
    cpt,
    status: p.status ?? null,
    date,
  };
}

function normalizeDocumentRef(d: FhirDocumentReference): DocumentRef {
  return {
    id: d.id ?? '',
    name: displayName(d.type, 'Document'),
    category: firstCoding(d.category?.[0])?.display ?? d.category?.[0]?.text ?? null,
    date: extractDate(d.date),
    description: d.description ?? null,
  };
}

// ---------------------------------------------------------------------------
// Aggregate lab observations into per-test trends
// ---------------------------------------------------------------------------

/** Key for grouping observations into trends: LOINC first, then name. */
function trendKey(r: LabResult): string {
  return r.loinc ? `loinc:${r.loinc}` : `name:${r.name.toLowerCase()}`;
}

function buildTrends(labs: LabResult[]): LabTrend[] {
  const groups = new Map<string, LabResult[]>();
  for (const r of labs) {
    const key = trendKey(r);
    const existing = groups.get(key);
    if (existing) existing.push(r);
    else groups.set(key, [r]);
  }

  const trends: LabTrend[] = [];
  for (const [, points] of groups) {
    points.sort((a, b) => (a.effectiveAt ?? '').localeCompare(b.effectiveAt ?? ''));
    const latest = points[points.length - 1] ?? null;
    // Prefer the latest observation's range as the "current" range for trending.
    // Fall back to the most recent non-null range if the latest is missing one.
    let refLow = latest?.refLow ?? null;
    let refHigh = latest?.refHigh ?? null;
    if (refLow === null && refHigh === null) {
      for (let i = points.length - 1; i >= 0; i--) {
        if (points[i].refLow !== null || points[i].refHigh !== null) {
          refLow = points[i].refLow;
          refHigh = points[i].refHigh;
          break;
        }
      }
    }
    trends.push({
      loinc: latest?.loinc ?? null,
      name: latest?.name ?? points[0]?.name ?? 'Unknown',
      unit: latest?.unit ?? points.find((p) => p.unit)?.unit ?? null,
      points,
      latest,
      latestFlag: latest?.interpretation
        ? latest.interpretation === 'H'
          ? 'high'
          : latest.interpretation === 'L'
            ? 'low'
            : latest.interpretation === 'N'
              ? 'normal'
              : (latest.derivedFlag ?? null)
        : (latest?.derivedFlag ?? null),
      refLow,
      refHigh,
    });
  }

  // Sort trends: out-of-range first, then by most-recent-reading desc.
  trends.sort((a, b) => {
    const aFlag = a.latestFlag && a.latestFlag !== 'normal' ? 0 : 1;
    const bFlag = b.latestFlag && b.latestFlag !== 'normal' ? 0 : 1;
    if (aFlag !== bFlag) return aFlag - bFlag;
    const aDate = a.latest?.effectiveAt ?? '';
    const bDate = b.latest?.effectiveAt ?? '';
    return bDate.localeCompare(aDate);
  });
  return trends;
}

// ---------------------------------------------------------------------------
// Build the full summary from a list of FHIR resources
// ---------------------------------------------------------------------------

/** Pure function: given loaded FHIR resources, produce a ClinicalSummary. */
export function buildClinicalSummary(resources: FhirResource[]): ClinicalSummary {
  const labs: LabResult[] = [];
  const vitals: LabResult[] = [];
  const conditions: Condition[] = [];
  const medications: Medication[] = [];
  const immunizations: Immunization[] = [];
  const allergies: Allergy[] = [];
  const procedures: Procedure[] = [];
  const documents: DocumentRef[] = [];
  const panels: LabPanel[] = [];
  const observationById = new Map<string, LabResult>();

  for (const r of resources) {
    switch (r.resourceType) {
      case 'Observation': {
        const o = r as FhirObservation;
        const normalized = normalizeObservation(o);
        if (normalized.id) observationById.set(normalized.id, normalized);
        if (isLabObservation(o)) {
          labs.push(normalized);
        } else if (isVitalsObservation(o)) {
          vitals.push(normalized);
        }
        // Observations in other categories are ignored (imaging, social, etc.)
        break;
      }
      case 'DiagnosticReport': {
        panels.push(normalizeDiagnosticReport(r as FhirDiagnosticReport));
        break;
      }
      case 'Condition':
        conditions.push(normalizeCondition(r as FhirCondition));
        break;
      case 'MedicationRequest':
        medications.push(normalizeMedication(r as FhirMedicationRequest));
        break;
      case 'Immunization':
        immunizations.push(normalizeImmunization(r as FhirImmunization));
        break;
      case 'AllergyIntolerance':
        allergies.push(normalizeAllergy(r as FhirAllergyIntolerance));
        break;
      case 'Procedure':
        procedures.push(normalizeProcedure(r as FhirProcedure));
        break;
      case 'DocumentReference':
        documents.push(normalizeDocumentRef(r as FhirDocumentReference));
        break;
      default:
        // Patient, Encounter, Organization, Practitioner, etc. — skipped.
        break;
    }
  }

  // Link observations → panels (second pass)
  for (const panel of panels) {
    for (const rid of panel.resultIds) {
      const obs = observationById.get(rid);
      if (obs) obs.panelId = panel.id;
    }
  }

  // Sort collections by date descending (most recent first)
  const byDateDesc = <T extends { date: string | null }>(a: T, b: T): number =>
    (b.date ?? '').localeCompare(a.date ?? '');
  panels.sort((a, b) => (b.effectiveAt ?? '').localeCompare(a.effectiveAt ?? ''));
  vitals.sort((a, b) => (b.effectiveAt ?? '').localeCompare(a.effectiveAt ?? ''));
  conditions.sort((a, b) =>
    (b.onsetDate ?? b.recordedDate ?? '').localeCompare(a.onsetDate ?? a.recordedDate ?? '')
  );
  medications.sort((a, b) => (b.authoredOn ?? '').localeCompare(a.authoredOn ?? ''));
  immunizations.sort(byDateDesc);
  allergies.sort((a, b) => (b.recordedDate ?? '').localeCompare(a.recordedDate ?? ''));
  procedures.sort(byDateDesc);
  documents.sort(byDateDesc);

  const labsByTest = buildTrends(labs);

  // Date range across all dated resources
  const allDates: string[] = [];
  for (const l of labs) if (l.date) allDates.push(l.date);
  for (const v of vitals) if (v.date) allDates.push(v.date);
  for (const c of conditions) {
    if (c.onsetDate) allDates.push(c.onsetDate);
    if (c.recordedDate) allDates.push(c.recordedDate);
  }
  for (const i of immunizations) if (i.date) allDates.push(i.date);
  for (const p of procedures) if (p.date) allDates.push(p.date);
  allDates.sort();

  return {
    schemaVersion: 1,
    recordCount: resources.length,
    dateRange: {
      start: allDates[0] ?? null,
      end: allDates[allDates.length - 1] ?? null,
    },
    labsByTest,
    labPanels: panels,
    vitals,
    conditions,
    medications,
    immunizations,
    allergies,
    procedures,
    documents,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Extraction from zip onto disk + full parse pipeline
// ---------------------------------------------------------------------------

/**
 * Extract every `apple_health_export/clinical-records/*.json` file from a
 * DocVault-managed export zip into `<recordsDir>/*.json`.
 *
 * - Safe to call repeatedly. Rewrites files that changed; leaves the rest.
 * - Returns the number of files written so the caller can log parity.
 *
 * The extraction mirrors `extractAppleHealthXml` in sibling `apple-health.ts`:
 * decompress only the subtree we care about (not the full zip) to avoid
 * loading workout-routes or export_cda.xml into memory.
 */
export async function extractClinicalRecords(zipPath: string, recordsDir: string): Promise<number> {
  const zipBuffer = await fs.readFile(zipPath);
  const prefix = 'apple_health_export/clinical-records/';
  const extracted = unzipSync(new Uint8Array(zipBuffer), {
    filter: (file) => file.name.startsWith(prefix) && file.name.endsWith('.json'),
  });

  await fs.mkdir(recordsDir, { recursive: true });

  let written = 0;
  for (const [name, bytes] of Object.entries(extracted)) {
    const basename = name.slice(prefix.length);
    if (!basename) continue;
    const outPath = path.join(recordsDir, basename);
    // Atomic write: tmp + rename so partial failure never leaves truncated JSON.
    const tmp = `${outPath}.tmp-${Date.now()}`;
    await fs.writeFile(tmp, Buffer.from(bytes));
    await fs.rename(tmp, outPath);
    written++;
  }
  return written;
}

/** Load every `*.json` file from a clinical-records directory and parse them. */
export async function loadClinicalRecords(recordsDir: string): Promise<FhirResource[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(recordsDir);
  } catch {
    return [];
  }
  const out: FhirResource[] = [];
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    try {
      const buf = await fs.readFile(path.join(recordsDir, name), 'utf-8');
      const parsed = JSON.parse(buf) as FhirResource;
      if (parsed && typeof parsed.resourceType === 'string') out.push(parsed);
    } catch {
      // Skip malformed files — the export occasionally ships bad JSON;
      // better to degrade gracefully than fail the whole parse.
    }
  }
  return out;
}

/**
 * Convenience: extract clinical-records from the zip into
 * `data/health/<personId>/clinical-records/` and return the parsed summary.
 *
 * @param zipPath     Absolute path to the export.zip
 * @param recordsDir  Absolute path to where extracted JSONs should live
 */
export async function parseClinicalFromZip(
  zipPath: string,
  recordsDir: string
): Promise<ClinicalSummary> {
  await extractClinicalRecords(zipPath, recordsDir);
  const resources = await loadClinicalRecords(recordsDir);
  return buildClinicalSummary(resources);
}
