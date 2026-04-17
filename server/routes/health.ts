// Health route handlers — Apple Health exports, people management, parsed
// summaries, segment snapshots.
//
// Routes:
//   GET    /api/health/people                            — list people
//   POST   /api/health/people                            — create a person
//   PATCH  /api/health/people/:id                        — rename/recolor
//   DELETE /api/health/people/:id?mode=archive|delete    — archive or hard delete
//   GET    /api/health/:personId/exports                 — list uploaded zips
//   POST   /api/health/:personId/upload-export           — upload zip + auto-unarchive + auto-parse + compute snapshots
//     (body: raw zip bytes, query: ?filename=export.zip)
//   POST   /api/health/:personId/parse-export            — re-parse a previously uploaded zip + recompute snapshots
//     (body: { filename: string })
//   GET    /api/health/:personId/summary/:filename       — read parsed summary for a zip
//   GET    /api/health/:personId/summaries               — list all parsed summaries for a person
//   GET    /api/health/:personId/snapshot/:segment       — read a single segment snapshot for this person's latest upload
//     (segment = activity|heart|sleep|workouts|body|all)
//   GET    /api/health/:personId/clinical                 — FHIR clinical summary (labs, panels, vitals, conditions, …)
//   POST   /api/health/:personId/ingest                   — daily delta POST from iOS Shortcut (auth: X-Docvault-Auth)
//   GET    /api/health/:personId/ingest-log?limit=100     — recent ingest audit entries (bootId-stamped NDJSON)
//
// Storage:
//   data/health/<personId>/exports/<name>.zip          — uploaded source exports (never deleted)
//   data/health/<personId>/exports/<name>.xml          — decompressed XML (persistent cache, backed up)
//   data/health/<personId>/clinical-records/*.json     — extracted FHIR resources from the zip (backed up)
//   data/health/<personId>/deltas/<YYYY-MM-DD>.json    — daily delta files from iOS Shortcut
//   data/health/<personId>/ingest.log                  — NDJSON audit log (append + 30-day trim)
//   data/.docvault-health.json                         — people list + parsed summaries + snapshots + clinical
//
// Health is NOT an entity — it's a global sidebar section. People, summaries,
// and snapshots all live together in .docvault-health.json and are decoupled
// from the entity system entirely. The decompressed XML is persisted next to
// the zip so DocVault's data-dir backup captures both the compressed source
// and the decompressed working copy, and re-parses skip the ~5-second unzip
// step.

import { promises as fs } from 'fs';
import path from 'path';
import { jsonResponse, ensureDir, getOrCreateHealthIngestToken, DATA_DIR } from '../data.js';
import type { HealthPerson } from '../data.js';
import {
  parseAppleHealthExport,
  PARSER_VERSION as CURRENT_PARSER_VERSION,
  type AppleHealthSummary,
} from '../parsers/apple-health.js';
import {
  computeSnapshots,
  SNAPSHOT_SCHEMA_VERSION,
  type DeltaFile,
  type PersonSnapshots,
  type HealthSegment,
} from '../parsers/apple-health-snapshots.js';
import {
  parseClinicalFromZip,
  CLINICAL_SCHEMA_VERSION,
  type ClinicalSummary,
} from '../parsers/apple-health-clinical.js';
// Lazy import — bplist-creator may not be in the Docker image
let buildHealthShortcut: typeof import('./shortcut-generator.js').buildHealthShortcut | null = null;
import('./shortcut-generator.js')
  .then((m) => {
    buildHealthShortcut = m.buildHealthShortcut;
  })
  .catch(() => {
    /* shortcut generation unavailable in this environment */
  });
import { createLogger, SERVER_BOOT_ID } from '../logger.js';

const log = createLogger('Health');

const HEALTH_STORE_FILE = path.join(DATA_DIR, '.docvault-health.json');
const HEALTH_DATA_DIR = path.join(DATA_DIR, 'health');

// Ingest-log rows are stamped with the same SERVER_BOOT_ID that the
// Application Log uses. Matching UUIDs across the two logs means you can
// correlate "what did the server log during the boot that received this
// ingest POST?" by searching for the bootId in both.
const INGEST_LOG_RETENTION_DAYS = 30;

// ---------------------------------------------------------------------------
// Store — people + parsed summaries live together in .docvault-health.json
// ---------------------------------------------------------------------------

/** User annotation on an auto-detected illness period. */
interface IllnessNote {
  note?: string;
  dismissed?: boolean;
  updatedAt: string;
}

interface HealthStore {
  version: 1;
  people: HealthPerson[];
  // key format: "<personId>/<filename>"
  summaries: Record<string, AppleHealthSummary>;
  snapshots: Record<string, PersonSnapshots>;
  /** Clinical (FHIR) summary per uploaded export. Same key format as summaries. */
  clinical?: Record<string, ClinicalSummary>;
  /** key format: "<personId>/<startDate>-<endDate>" */
  illnessNotes?: Record<string, IllnessNote>;
  /**
   * Fields owned by OTHER route modules (nutrition.ts, sickness.ts,
   * future additions). We preserve them via spread in loadHealthStore so
   * this module's saves don't silently clobber sibling modules' data.
   * A regression-preserving round-trip test lives in health-store.test.ts.
   */
  [key: string]: unknown;
}

async function loadHealthStore(): Promise<HealthStore> {
  try {
    const content = await fs.readFile(HEALTH_STORE_FILE, 'utf-8');
    const parsed = JSON.parse(content) as Partial<HealthStore>;
    return {
      // Spread FIRST so explicit fields below win type-wise, but any unknown
      // sibling-owned fields (nutrition, sicknessLogs, …) survive the
      // round-trip instead of being silently wiped on save.
      ...parsed,
      version: 1,
      people: parsed.people ?? [],
      summaries: parsed.summaries ?? {},
      snapshots: parsed.snapshots ?? {},
      clinical: parsed.clinical ?? {},
      illnessNotes: parsed.illnessNotes ?? {},
    };
  } catch {
    return {
      version: 1,
      people: [],
      summaries: {},
      snapshots: {},
      clinical: {},
      illnessNotes: {},
    };
  }
}

async function saveHealthStore(store: HealthStore): Promise<void> {
  // Write to a temp path then rename for atomicity (follows the project's
  // "never pipe output back to same file" rule indirectly — safer on crashes).
  await ensureDir(DATA_DIR);
  const tmp = `${HEALTH_STORE_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2));
  await fs.rename(tmp, HEALTH_STORE_FILE);
}

function storeKey(personId: string, filename: string): string {
  return `${personId}/${filename}`;
}

/** Update the people list inside the health store. */
async function updateHealthPeople(
  mutator: (people: HealthPerson[]) => HealthPerson[]
): Promise<HealthPerson[]> {
  const store = await loadHealthStore();
  store.people = mutator(store.people);
  await saveHealthStore(store);
  return store.people;
}

function newPersonId(): string {
  // Short random ID, human-visible but not meaningful. No PII.
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = 'person-';
  for (let i = 0; i < 6; i++) {
    id += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return id;
}

async function requirePerson(personId: string): Promise<HealthPerson> {
  const store = await loadHealthStore();
  const person = store.people.find((p) => p.id === personId);
  if (!person) {
    throw new Error(`Person "${personId}" not found`);
  }
  return person;
}

function getPersonExportsDir(personId: string): string {
  return path.join(HEALTH_DATA_DIR, personId, 'exports');
}

function getPersonDeltasDir(personId: string): string {
  return path.join(HEALTH_DATA_DIR, personId, 'deltas');
}

function getPersonIngestLog(personId: string): string {
  return path.join(HEALTH_DATA_DIR, personId, 'ingest.log');
}

interface IngestLogEntry {
  ts: string;
  bootId: string;
  status: 'ok' | 'error';
  http: number;
  date?: string;
  source?: string;
  metricCount?: number;
  metricKeys?: string[];
  bytes?: number;
  error?: string;
  preview?: string;
}

/**
 * Append one line of NDJSON to the person's ingest log, trimming any rows
 * older than INGEST_LOG_RETENTION_DAYS in the same pass. Ingest fires ~once
 * per day so the file stays ~30 rows max — read-filter-write is fine.
 *
 * Corruption-safe: writes a tmp file then renames. Never throws — a logging
 * failure should never break the real ingest response.
 */
async function appendIngestLog(personId: string, entry: IngestLogEntry): Promise<void> {
  const filePath = getPersonIngestLog(personId);
  try {
    await ensureDir(path.dirname(filePath));

    let existing: string[] = [];
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      existing = content.split('\n').filter(Boolean);
    } catch {
      // First write — file doesn't exist yet
    }

    const cutoff = Date.now() - INGEST_LOG_RETENTION_DAYS * 86_400_000;
    const kept = existing.filter((line) => {
      try {
        const parsed = JSON.parse(line) as { ts?: string };
        if (!parsed.ts) return false;
        return new Date(parsed.ts).getTime() >= cutoff;
      } catch {
        return false;
      }
    });

    kept.push(JSON.stringify(entry));

    const tmp = `${filePath}.tmp-${Date.now()}`;
    await fs.writeFile(tmp, kept.join('\n') + '\n');
    await fs.rename(tmp, filePath);
  } catch (err) {
    log.error(
      `Failed to write ingest log for ${personId}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Where we extract `apple_health_export/clinical-records/*.json` to on disk.
 * Kept under the person's directory so the data-dir backup captures them
 * automatically (server/index.ts recursively grabs everything under
 * `data/health/`). Inspectable: `ls data/health/<personId>/clinical-records/`
 * shows one JSON per FHIR resource (Observation, DiagnosticReport, etc.).
 */
function getPersonClinicalDir(personId: string): string {
  return path.join(HEALTH_DATA_DIR, personId, 'clinical-records');
}

/**
 * Load all delta JSON files for a person. Each file is named `<YYYY-MM-DD>.json`
 * and contains a DeltaFile body. Malformed or non-matching files are silently
 * skipped — the caller gets only valid entries.
 */
async function loadPersonDeltas(personId: string): Promise<DeltaFile[]> {
  const dir = getPersonDeltasDir(personId);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: DeltaFile[] = [];
  for (const name of entries) {
    if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(name)) continue;
    try {
      const content = await fs.readFile(path.join(dir, name), 'utf-8');
      const parsed = JSON.parse(content) as Partial<DeltaFile>;
      if (
        typeof parsed.date === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) &&
        parsed.metrics &&
        typeof parsed.metrics === 'object'
      ) {
        out.push(parsed as DeltaFile);
      }
    } catch {
      // skip corrupt files silently
    }
  }
  return out;
}

/**
 * Get the mtime of a person's deltas directory as an ISO string. Used as a
 * cheap "was anything added/removed from deltas since the last snapshot?"
 * check — when the dir mtime is newer than the cached snapshot's generatedAt,
 * the cache is invalid even if parser/schema versions both match. Returns
 * the epoch (1970-01-01) if the directory doesn't exist yet, so newly-created
 * deltas dirs always invalidate the cache.
 */
async function getDeltasDirMtime(personId: string): Promise<string> {
  try {
    const stat = await fs.stat(getPersonDeltasDir(personId));
    return stat.mtime.toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

/** Is `date` within ±2 calendar days of the server's local date?
 *  Widened from ±1 because timezone differences between the phone
 *  (CST) and the server's UTC-based Date can push "yesterday" to
 *  2 days apart in UTC terms. */
function isDateWithinRange(date: string, now: Date = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const target = new Date(`${date}T00:00:00Z`);
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const deltaDays = Math.abs(target.getTime() - today.getTime()) / 86_400_000;
  return deltaDays <= 2;
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

export async function handleHealthRoutes(
  req: Request,
  url: URL,
  pathname: string
): Promise<Response | null> {
  // -------------------------------------------------------------------------
  // People CRUD
  // -------------------------------------------------------------------------

  // GET /api/health/people — list all (non-archived by default, ?archived=true to include)
  if (pathname === '/api/health/people' && req.method === 'GET') {
    const store = await loadHealthStore();
    const includeArchived = url.searchParams.get('archived') === 'true';
    const people = includeArchived ? store.people : store.people.filter((p) => !p.archivedAt);
    return jsonResponse({ people });
  }

  // POST /api/health/people — create person { name, color?, icon? }
  if (pathname === '/api/health/people' && req.method === 'POST') {
    const body = (await req.json()) as { name?: string; color?: string; icon?: string };
    const name = body.name?.trim();
    if (!name) {
      return jsonResponse({ error: 'Missing name' }, 400);
    }
    const person: HealthPerson = {
      id: newPersonId(),
      name,
      color: body.color,
      icon: body.icon,
      createdAt: new Date().toISOString(),
      archivedAt: null,
    };
    await updateHealthPeople((people) => [...people, person]);

    // Pre-create the person's exports directory so uploads land cleanly
    await ensureDir(getPersonExportsDir(person.id));

    log.info(`Created person ${person.id} "${person.name}"`);
    return jsonResponse({ person });
  }

  // PATCH /api/health/people/:id — rename/recolor
  const peoplePatchMatch = pathname.match(/^\/api\/health\/people\/([^/]+)$/);
  if (peoplePatchMatch && req.method === 'PATCH') {
    const personId = peoplePatchMatch[1];
    const body = (await req.json()) as { name?: string; color?: string; icon?: string };

    const people = await updateHealthPeople((current) =>
      current.map((p) =>
        p.id === personId
          ? {
              ...p,
              name: body.name?.trim() || p.name,
              color: body.color !== undefined ? body.color : p.color,
              icon: body.icon !== undefined ? body.icon : p.icon,
            }
          : p
      )
    );

    const updated = people.find((p) => p.id === personId);
    if (!updated) return jsonResponse({ error: 'Person not found' }, 404);
    log.info(`Updated person ${personId}`);
    return jsonResponse({ person: updated });
  }

  // DELETE /api/health/people/:id?mode=archive|delete
  if (peoplePatchMatch && req.method === 'DELETE') {
    const personId = peoplePatchMatch[1];
    const mode = url.searchParams.get('mode') ?? 'archive';

    if (mode === 'archive') {
      await updateHealthPeople((current) =>
        current.map((p) => (p.id === personId ? { ...p, archivedAt: new Date().toISOString() } : p))
      );
      log.info(`Archived person ${personId}`);
      return jsonResponse({ ok: true, mode: 'archive' });
    }

    if (mode === 'delete') {
      // Remove from store and drop their summaries + clinical in one write
      const store = await loadHealthStore();
      store.people = store.people.filter((p) => p.id !== personId);
      const filtered: Record<string, AppleHealthSummary> = {};
      for (const [k, v] of Object.entries(store.summaries)) {
        if (!k.startsWith(`${personId}/`)) filtered[k] = v;
      }
      store.summaries = filtered;
      if (store.clinical) {
        const filteredClinical: Record<string, ClinicalSummary> = {};
        for (const [k, v] of Object.entries(store.clinical)) {
          if (!k.startsWith(`${personId}/`)) filteredClinical[k] = v;
        }
        store.clinical = filteredClinical;
      }
      await saveHealthStore(store);

      // Remove all files on disk for this person
      const personDir = path.join(HEALTH_DATA_DIR, personId);
      await fs.rm(personDir, { recursive: true, force: true });

      log.info(`Hard-deleted person ${personId} and all their data`);
      return jsonResponse({ ok: true, mode: 'delete' });
    }

    return jsonResponse({ error: 'Invalid mode (expected archive|delete)' }, 400);
  }

  // -------------------------------------------------------------------------
  // Ingest token (for iOS Shortcuts auth)
  // -------------------------------------------------------------------------

  // GET /api/health/ingest-token — returns the stored token, generating one
  // on first request. The standard /api/* auth layer (session cookie) already
  // guards this route, so callers must already be logged in to DocVault.
  if (pathname === '/api/health/ingest-token' && req.method === 'GET') {
    const token = await getOrCreateHealthIngestToken();
    return jsonResponse({ token });
  }

  // GET /api/health/:personId/shortcut-config — everything the iOS Shortcut
  // needs in one response: the full ingest URL (including host), the auth
  // token, and a structured list of metrics to capture. The UI uses this
  // to render a copy-paste-friendly setup guide next to the Automation
  // building steps.
  const shortcutConfigMatch = pathname.match(/^\/api\/health\/([^/]+)\/shortcut-config$/);
  if (shortcutConfigMatch && req.method === 'GET') {
    const personId = shortcutConfigMatch[1];
    await requirePerson(personId);
    const token = await getOrCreateHealthIngestToken();
    // Build the URL from the incoming Host header so it works whether the
    // user is accessing DocVault via LAN IP, hostname, or Tailscale/Wireguard.
    const host = req.headers.get('host') ?? 'docvault.local';
    const proto = req.headers.get('x-forwarded-proto') ?? 'http';
    const ingestUrl = `${proto}://${host}/api/health/${personId}/ingest`;

    // Also include the download URL for the generated .shortcut file
    const shortcutDownloadUrl = `${proto}://${host}/api/health/${personId}/shortcut.shortcut`;

    return jsonResponse({
      personId,
      ingestUrl,
      shortcutDownloadUrl,
      authHeader: 'X-Docvault-Auth',
      authToken: token,
      scheduleTime: '06:00', // 6 AM user-local, configurable
      // Metric list for the shortcut to capture. Order matters for the
      // UI walkthrough since each is one "Find Health Samples" action.
      metrics: [
        { hkType: 'StepCount', healthAppName: 'Steps', aggregate: 'Sum' },
        { hkType: 'ActiveEnergyBurned', healthAppName: 'Active Calories', aggregate: 'Sum' },
        { hkType: 'AppleExerciseTime', healthAppName: 'Exercise Minutes', aggregate: 'Sum' },
        { hkType: 'AppleStandHour', healthAppName: 'Stand Hours', aggregate: 'Count' },
        {
          hkType: 'DistanceWalkingRunning',
          healthAppName: 'Walking + Running Distance',
          aggregate: 'Sum',
        },
        { hkType: 'FlightsClimbed', healthAppName: 'Flights Climbed', aggregate: 'Sum' },
        { hkType: 'HeartRate', healthAppName: 'Heart Rate', aggregate: 'Min/Avg/Max/Count' },
        {
          hkType: 'RestingHeartRate',
          healthAppName: 'Resting Heart Rate',
          aggregate: 'Latest Sample',
        },
        {
          hkType: 'HeartRateVariabilitySDNN',
          healthAppName: 'Heart Rate Variability',
          aggregate: 'Average',
        },
      ],
    });
  }

  // GET /api/health/:personId/shortcut.shortcut — generate and serve a
  // .shortcut binary plist file that the user can open on their iPhone to
  // import the pre-configured "Sync Health → DocVault" shortcut.
  //
  // The file is unsigned — on iOS 15+ this may fail to import. The manual
  // walkthrough remains the reliable fallback.
  const shortcutFileMatch = pathname.match(/^\/api\/health\/([^/]+)\/shortcut\.shortcut$/);
  if (shortcutFileMatch && req.method === 'GET') {
    const personId = shortcutFileMatch[1];
    await requirePerson(personId);
    const token = await getOrCreateHealthIngestToken();
    const host = req.headers.get('host') ?? 'docvault.local';
    const proto = req.headers.get('x-forwarded-proto') ?? 'http';
    const ingestUrl = `${proto}://${host}/api/health/${personId}/ingest`;

    try {
      // Serve the pre-built signed .shortcut file. Users edit the URL +
      // token in the Shortcuts editor after importing.
      const shortcutDir = path.dirname(new URL(import.meta.url).pathname);
      const staticPath = path.join(shortcutDir, 'Sync-Health-DocVault.shortcut');
      const shortcutBuffer = await fs.readFile(staticPath);

      return new Response(shortcutBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/x-apple-shortcut',
          'Content-Disposition': 'attachment; filename="Sync-Health-DocVault.shortcut"',
          'Content-Length': String(shortcutBuffer.length),
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`Shortcut file not found: ${msg}`);
      return jsonResponse({ error: 'Shortcut file not available', details: msg }, 404);
    }
  }

  // -------------------------------------------------------------------------
  // Ingest (POST daily health metrics from iOS Shortcut)
  // -------------------------------------------------------------------------

  // POST /api/health/:personId/ingest
  //
  // Headers: X-Docvault-Auth: <token>
  // Body: { date, source, metrics: { <HKType>: {sum|avg|min|max|count|last|unit?} } }
  //
  // Writes `data/health/<personId>/deltas/<date>.json` with the raw body.
  // Each subsequent POST for the same date overwrites the file. Snapshot is
  // bumped via schema-version mismatch so the next read auto-heals with the
  // new delta overlaid on the baseline summary.
  const ingestMatch = pathname.match(/^\/api\/health\/([^/]+)\/ingest$/);
  if (ingestMatch && req.method === 'POST') {
    const personId = ingestMatch[1];
    const ts = new Date().toISOString();

    // Auth: header vs stored token
    const providedToken = req.headers.get('x-docvault-auth') ?? '';
    const expectedToken = await getOrCreateHealthIngestToken();
    if (!providedToken || providedToken !== expectedToken) {
      log.warn(`Ingest auth rejected for ${personId}`);
      await appendIngestLog(personId, {
        ts,
        bootId: SERVER_BOOT_ID,
        status: 'error',
        http: 401,
        error: 'auth',
      });
      return jsonResponse(
        { ok: false, error: 'Unauthorized — bad or missing X-Docvault-Auth header' },
        401
      );
    }

    try {
      await requirePerson(personId);
    } catch {
      await appendIngestLog(personId, {
        ts,
        bootId: SERVER_BOOT_ID,
        status: 'error',
        http: 404,
        error: 'person-not-found',
      });
      return jsonResponse({ ok: false, error: 'Person not found' }, 404);
    }

    let body: Partial<DeltaFile & { raw?: boolean }>;
    let rawBody: string | undefined;
    try {
      rawBody = await req.text();
      // Shortcuts interpolates health sample values as multiline text with
      // raw newlines inside JSON string values, e.g. "StepCount": "234\n567".
      // These literal newlines break JSON parsing. Fix: inside quoted strings,
      // replace raw newlines with \n escape sequences.
      const fixedBody = rawBody.replace(
        /"([^"]*?)"/g,
        (_match, content: string) => `"${content.replace(/\n/g, '\\n')}"`
      );
      body = JSON.parse(fixedBody) as Partial<DeltaFile & { raw?: boolean }>;
    } catch (parseErr) {
      const preview = rawBody ? rawBody.slice(0, 1000).replace(/\n/g, '↵') : '(empty)';
      const errMsg = parseErr instanceof Error ? parseErr.message : String(parseErr);
      log.error(
        `Ingest JSON parse failed for ${personId}: ${errMsg} | len=${rawBody?.length ?? 0} | body: ${preview}`
      );
      await appendIngestLog(personId, {
        ts,
        bootId: SERVER_BOOT_ID,
        status: 'error',
        http: 400,
        bytes: rawBody?.length ?? 0,
        error: `json-parse: ${errMsg}`,
        preview: preview.slice(0, 200),
      });
      return jsonResponse({ ok: false, error: 'Invalid JSON body', preview }, 400);
    }

    log.info(
      `Ingest body for ${personId}: date=${body.date}, source=${body.source}, ` +
        `raw=${(body as Record<string, unknown>).raw}, ` +
        `metricKeys=${body.metrics ? Object.keys(body.metrics).join(',') : 'none'}`
    );

    const date = body.date;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      log.warn(`Ingest rejected for ${personId}: bad date "${date}"`);
      await appendIngestLog(personId, {
        ts,
        bootId: SERVER_BOOT_ID,
        status: 'error',
        http: 400,
        bytes: rawBody?.length ?? 0,
        source: body.source,
        error: `bad-date: "${date}"`,
      });
      return jsonResponse(
        { ok: false, error: 'Missing or invalid `date` — expected YYYY-MM-DD' },
        400
      );
    }
    if (!isDateWithinRange(date)) {
      log.warn(
        `Ingest rejected for ${personId}: date "${date}" out of range (server: ${new Date().toISOString()})`
      );
      await appendIngestLog(personId, {
        ts,
        bootId: SERVER_BOOT_ID,
        status: 'error',
        http: 400,
        bytes: rawBody?.length ?? 0,
        date,
        source: body.source,
        error: 'date-out-of-range',
      });
      return jsonResponse(
        { ok: false, error: `Date "${date}" is not within ±2 days of server time` },
        400
      );
    }
    if (!body.metrics || typeof body.metrics !== 'object') {
      log.warn(`Ingest rejected for ${personId}: missing metrics`);
      await appendIngestLog(personId, {
        ts,
        bootId: SERVER_BOOT_ID,
        status: 'error',
        http: 400,
        bytes: rawBody?.length ?? 0,
        date,
        source: body.source,
        error: 'missing-metrics',
      });
      return jsonResponse({ ok: false, error: 'Missing or invalid `metrics` object' }, 400);
    }

    // If `raw: true`, the shortcut sent newline-separated value strings
    // instead of pre-aggregated {sum, avg, ...} objects. Parse + aggregate
    // them into DeltaMetric objects before storing. This keeps the stored
    // delta format consistent regardless of whether the data came from a
    // shortcut (raw text) or a manual curl (pre-aggregated).
    let metrics = body.metrics;
    if (body.raw === true && metrics) {
      const parsed: Record<
        string,
        { sum?: number; avg?: number; min?: number; max?: number; count?: number; last?: number }
      > = {};
      for (const [key, rawValue] of Object.entries(metrics)) {
        if (typeof rawValue === 'string') {
          // Parse newline-separated numeric values
          const nums = rawValue
            .split('\n')
            .map((s: string) => Number(s.trim()))
            .filter((n: number) => Number.isFinite(n) && !Number.isNaN(n));
          if (nums.length === 0) continue;
          const sum = nums.reduce((a: number, b: number) => a + b, 0);
          const avg = sum / nums.length;
          const min = Math.min(...nums);
          const max = Math.max(...nums);
          parsed[key] = { sum, avg, min, max, count: nums.length, last: nums[nums.length - 1] };
        } else if (typeof rawValue === 'object' && rawValue !== null) {
          // Already structured — pass through
          parsed[key] = rawValue as Record<string, number>;
        }
      }
      metrics = parsed;
    }

    // Normalize the stored shape so merge logic can rely on known fields
    const normalized: DeltaFile = {
      date,
      source: body.source ?? 'unknown',
      receivedAt: new Date().toISOString(),
      metrics: metrics as DeltaFile['metrics'],
    };
    const metricKeys = Object.keys(normalized.metrics);

    try {
      const dir = getPersonDeltasDir(personId);
      await ensureDir(dir);
      const targetPath = path.join(dir, `${date}.json`);
      const tmp = `${targetPath}.tmp-${Date.now()}`;
      await fs.writeFile(tmp, JSON.stringify(normalized, null, 2));
      await fs.rename(tmp, targetPath);

      // Drop the cached snapshot so the next read re-computes with the delta
      const store = await loadHealthStore();
      for (const k of Object.keys(store.snapshots)) {
        if (k.startsWith(`${personId}/`)) delete store.snapshots[k];
      }
      await saveHealthStore(store);
    } catch (writeErr) {
      const errMsg = writeErr instanceof Error ? writeErr.message : String(writeErr);
      log.error(`Ingest write failed for ${personId}/${date}: ${errMsg}`);
      await appendIngestLog(personId, {
        ts,
        bootId: SERVER_BOOT_ID,
        status: 'error',
        http: 500,
        bytes: rawBody?.length ?? 0,
        date,
        source: normalized.source,
        metricCount: metricKeys.length,
        metricKeys,
        error: `write-fail: ${errMsg}`,
      });
      return jsonResponse({ ok: false, error: 'Failed to persist delta', details: errMsg }, 500);
    }

    log.info(
      `Ingested ${personId}/${date} with ${metricKeys.length} metric(s) from "${normalized.source}"`
    );
    await appendIngestLog(personId, {
      ts,
      bootId: SERVER_BOOT_ID,
      status: 'ok',
      http: 200,
      bytes: rawBody?.length ?? 0,
      date,
      source: normalized.source,
      metricCount: metricKeys.length,
      metricKeys,
    });
    return jsonResponse({
      ok: true,
      message: `Synced ${date} — ${metricKeys.length} metrics`,
      filename: `deltas/${date}.json`,
      updated: metricKeys,
    });
  }

  // GET /api/health/:personId/ingest-log?limit=100
  //
  // Returns the last N parsed NDJSON entries from the ingest audit log.
  // Survives container restarts (unlike Docker's log ring buffer) and is
  // auto-trimmed to INGEST_LOG_RETENTION_DAYS. Useful for retroactively
  // answering "did the shortcut fire this morning?" and "was the server
  // up when it fired?" (group by bootId).
  const ingestLogMatch = pathname.match(/^\/api\/health\/([^/]+)\/ingest-log$/);
  if (ingestLogMatch && req.method === 'GET') {
    const personId = ingestLogMatch[1];
    await requirePerson(personId);

    const rawLimit = Number(url.searchParams.get('limit') ?? '100');
    const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 100, 1), 500);

    let entries: IngestLogEntry[] = [];
    try {
      const content = await fs.readFile(getPersonIngestLog(personId), 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          entries.push(JSON.parse(line) as IngestLogEntry);
        } catch {
          // Skip corrupt line
        }
      }
    } catch {
      // No log yet — return empty
    }

    // Newest first, then trim to limit
    entries.reverse();
    entries = entries.slice(0, limit);

    return jsonResponse({
      personId,
      bootId: SERVER_BOOT_ID,
      retentionDays: INGEST_LOG_RETENTION_DAYS,
      count: entries.length,
      entries,
    });
  }

  // -------------------------------------------------------------------------
  // Exports (uploaded zip files per person)
  // -------------------------------------------------------------------------

  // GET /api/health/:personId/exports — list uploaded zips
  const listExportsMatch = pathname.match(/^\/api\/health\/([^/]+)\/exports$/);
  if (listExportsMatch && req.method === 'GET') {
    const personId = listExportsMatch[1];
    await requirePerson(personId); // throws 404 handled below

    const dir = getPersonExportsDir(personId);
    await ensureDir(dir);
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter((e) => e.isFile() && e.name.endsWith('.zip'))
        .map(async (e) => {
          const stat = await fs.stat(path.join(dir, e.name));
          return {
            filename: e.name,
            size: stat.size,
            uploadedAt: stat.mtime.toISOString(),
          };
        })
    );

    // Merge with store: which ones have been parsed?
    const store = await loadHealthStore();
    const enriched = files.map((f) => ({
      ...f,
      parsed: Boolean(store.summaries[storeKey(personId, f.filename)]),
    }));

    return jsonResponse({ exports: enriched });
  }

  // POST /api/health/:personId/parse-export — parse a zip that's already uploaded
  // Body: { filename: string }
  const parseExportMatch = pathname.match(/^\/api\/health\/([^/]+)\/parse-export$/);
  if (parseExportMatch && req.method === 'POST') {
    const personId = parseExportMatch[1];
    await requirePerson(personId);

    const body = (await req.json()) as { filename?: string };
    const filename = body.filename;
    if (!filename || !filename.endsWith('.zip')) {
      return jsonResponse({ error: 'Missing or invalid filename' }, 400);
    }

    const dir = getPersonExportsDir(personId);
    const zipPath = path.join(dir, filename);

    // Safety: ensure the resolved path is still under the exports dir
    if (!zipPath.startsWith(dir + path.sep) && zipPath !== path.join(dir, filename)) {
      return jsonResponse({ error: 'Access denied' }, 403);
    }

    try {
      await fs.access(zipPath);
    } catch {
      return jsonResponse({ error: 'Export file not found' }, 404);
    }

    try {
      log.info(`Parsing ${personId}/${filename}`);
      const summary = await parseAppleHealthExport(zipPath);

      // Clinical records live in a different subtree of the zip
      // (`apple_health_export/clinical-records/`). Parse them before
      // computing snapshots so FHIR vitals (VA weights, BP, etc.) can be
      // merged into the Body segment in a single pass.
      let clinical: ClinicalSummary | null = null;
      try {
        clinical = await parseClinicalFromZip(zipPath, getPersonClinicalDir(personId));
        log.info(
          `Clinical ${personId}/${filename}: ${clinical.recordCount} FHIR resources, ` +
            `${clinical.labsByTest.length} lab tests, ${clinical.labPanels.length} panels, ` +
            `${clinical.conditions.length} conditions`
        );
      } catch (clinicalErr) {
        // Non-fatal: clinical-records is optional (user may have no linked
        // providers). Fall through and save the HealthKit summary anyway.
        log.warn(
          `Clinical parse skipped for ${personId}/${filename}: ${clinicalErr instanceof Error ? clinicalErr.message : String(clinicalErr)}`
        );
      }

      const snapshots = computeSnapshots(summary, filename, new Date(), [], clinical);

      // Persist to store
      const store = await loadHealthStore();
      store.summaries[storeKey(personId, filename)] = summary;
      store.snapshots[storeKey(personId, filename)] = snapshots;
      if (clinical) {
        if (!store.clinical) store.clinical = {};
        store.clinical[storeKey(personId, filename)] = clinical;
      }
      await saveHealthStore(store);

      log.info(
        `Parsed ${personId}/${filename}: ${summary.recordCounts.totalRecords} records, ` +
          `${summary.recordCounts.totalWorkouts} workouts in ${summary.parseDurationMs} ms; ` +
          `snapshots: ${snapshots.activity.daily.length} activity days, ` +
          `${snapshots.sleep.daily.length} sleep nights, ${snapshots.workouts.headline.totalWorkouts} workouts`
      );

      return jsonResponse({ ok: true, summary });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`Parse failed for ${personId}/${filename}: ${msg}`);
      return jsonResponse({ error: 'Parse failed', details: msg }, 500);
    }
  }

  // POST /api/health/:personId/upload-export — one-shot upload + unarchive + parse
  //
  // Body is the raw zip bytes (application/zip). The filename comes from the
  // `filename` query param (so clients can preserve the original name) or
  // falls back to `export.zip`. On success the full parsed summary is
  // returned, so the UI can display the dashboard without a follow-up fetch.
  const uploadExportMatch = pathname.match(/^\/api\/health\/([^/]+)\/upload-export$/);
  if (uploadExportMatch && req.method === 'POST') {
    const personId = uploadExportMatch[1];
    await requirePerson(personId);

    const rawFilename = url.searchParams.get('filename') ?? 'export.zip';
    // Basic path-safety: strip any directory components
    const filename = path.basename(rawFilename);
    if (!filename.toLowerCase().endsWith('.zip')) {
      return jsonResponse({ error: 'Only .zip files are accepted' }, 400);
    }

    const dir = getPersonExportsDir(personId);
    await ensureDir(dir);
    const zipPath = path.join(dir, filename);

    try {
      // 1. Save the uploaded zip to disk
      const body = await req.arrayBuffer();
      await fs.writeFile(zipPath, Buffer.from(body));
      log.info(
        `Uploaded ${personId}/${filename} (${(body.byteLength / 1024 / 1024).toFixed(1)} MB)`
      );

      // 2. parseAppleHealthExport extracts + persists the XML next to the zip
      //    and runs the parser against it. The XML is kept on disk so future
      //    re-parses skip the unzip step AND so the data-dir backup captures
      //    both the compressed source and the decompressed working copy.
      log.info(`Unarchiving + parsing ${personId}/${filename}`);
      const summary = await parseAppleHealthExport(zipPath);

      // 3. Clinical records (FHIR) — extracted and parsed BEFORE snapshot
      //    compute, so VA vitals (weight, BP, etc.) merge into the Body
      //    segment on the same pass. Non-fatal if absent.
      let clinical: ClinicalSummary | null = null;
      try {
        clinical = await parseClinicalFromZip(zipPath, getPersonClinicalDir(personId));
        log.info(
          `Clinical ${personId}/${filename}: ${clinical.recordCount} FHIR resources, ` +
            `${clinical.labsByTest.length} lab tests, ${clinical.labPanels.length} panels`
        );
      } catch (clinicalErr) {
        log.warn(
          `Clinical parse skipped for ${personId}/${filename}: ${clinicalErr instanceof Error ? clinicalErr.message : String(clinicalErr)}`
        );
      }

      // 4. Compute segment snapshots (pure, ~8ms for 8 years of data)
      const snapshots = computeSnapshots(summary, filename, new Date(), [], clinical);

      // 5. Persist summary + snapshots + clinical to store in a single write
      const store = await loadHealthStore();
      store.summaries[storeKey(personId, filename)] = summary;
      store.snapshots[storeKey(personId, filename)] = snapshots;
      if (clinical) {
        if (!store.clinical) store.clinical = {};
        store.clinical[storeKey(personId, filename)] = clinical;
      }
      await saveHealthStore(store);

      log.info(
        `Parsed ${personId}/${filename}: ${summary.recordCounts.totalRecords} records, ` +
          `${summary.recordCounts.totalWorkouts} workouts in ${summary.parseDurationMs} ms`
      );

      return jsonResponse({ ok: true, filename, summary });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`Upload+parse failed for ${personId}/${filename}: ${msg}`);
      return jsonResponse({ error: 'Upload+parse failed', details: msg }, 500);
    }
  }

  // GET /api/health/:personId/summary/:filename — read a single parsed summary
  const summaryMatch = pathname.match(/^\/api\/health\/([^/]+)\/summary\/(.+)$/);
  if (summaryMatch && req.method === 'GET') {
    const personId = summaryMatch[1];
    const filename = decodeURIComponent(summaryMatch[2]);
    const store = await loadHealthStore();
    const summary = store.summaries[storeKey(personId, filename)];
    if (!summary) {
      return jsonResponse({ error: 'Summary not found' }, 404);
    }
    return jsonResponse({ summary });
  }

  // GET /api/health/:personId/snapshot/:segment — read one segment snapshot
  //
  // Returns the snapshot for the most recently parsed zip for this person.
  // If the person has a parsed summary but no snapshot yet (e.g. older data
  // from before snapshots were introduced), we backfill by computing the
  // snapshot on demand and writing it to the store.
  //
  // `segment` is one of: activity, heart, sleep, workouts, body, all.
  // Returning the single segment keeps typical responses small (20 KB – 700 KB
  // instead of the full 1.3 MB when you pass "all").
  const snapshotMatch = pathname.match(/^\/api\/health\/([^/]+)\/snapshot\/([^/]+)$/);
  if (snapshotMatch && req.method === 'GET') {
    const personId = snapshotMatch[1];
    const segment = snapshotMatch[2];
    const validSegments: HealthSegment[] = ['activity', 'heart', 'sleep', 'workouts', 'body'];
    if (segment !== 'all' && !validSegments.includes(segment as HealthSegment)) {
      return jsonResponse(
        {
          error: `Invalid segment "${segment}". Expected one of: ${validSegments.join(', ')}, all`,
        },
        400
      );
    }

    await requirePerson(personId);

    const store = await loadHealthStore();

    // Find the most recent key for this person (by filename ordering — the
    // upload flow writes "export.zip" per person, so typically one entry)
    const prefix = `${personId}/`;
    const keys = Object.keys(store.summaries).filter((k) => k.startsWith(prefix));
    if (keys.length === 0) {
      return jsonResponse({ error: 'No parsed summary for this person yet' }, 404);
    }
    // Pick the newest summary by `generatedAt` on the snapshot, or by filename
    // as a tiebreaker.
    keys.sort((a, b) => {
      const sa = store.snapshots[a]?.generatedAt ?? '';
      const sb = store.snapshots[b]?.generatedAt ?? '';
      if (sa !== sb) return sb.localeCompare(sa);
      return b.localeCompare(a);
    });
    const key = keys[0];

    // Auto-heal four separate cases (all ~8ms and invisible to user):
    //   (a) snapshot absent entirely → backfill from summary
    //   (b) snapshot's parserVersion doesn't match the summary's
    //       (summary was re-parsed with a newer parser)
    //   (c) snapshot's schemaVersion is older than the current snapshot
    //       computer's SNAPSHOT_SCHEMA_VERSION
    //   (d) the person's deltas directory has an mtime newer than the
    //       cached snapshot's generatedAt — i.e., deltas were added or
    //       removed since the last compute. One `fs.stat` per read,
    //       catches both new POSTs and hand-deletions uniformly.
    // The ingest endpoint ALSO drops the cached snapshot explicitly on
    // every POST for belt-and-suspenders — (d) handles the cases the
    // explicit drop misses (manual file edits, out-of-band deletions).
    let snapshots = store.snapshots[key];
    const summary = store.summaries[key];
    const filename = key.slice(prefix.length);
    const deltas = await loadPersonDeltas(personId);
    const deltasMtime = await getDeltasDirMtime(personId);
    const deltasChanged = snapshots !== undefined && deltasMtime > snapshots.generatedAt;
    // Load the persisted clinical summary (if any) so vitals merge into
    // the recomputed Body segment. When no clinical export was ever parsed
    // for this key, `clinicalForSnapshot` stays null and snapshot.clinicalVitals
    // is null on the output.
    const clinicalForSnapshot: ClinicalSummary | null = store.clinical?.[key] ?? null;
    if (!snapshots) {
      log.info(`Backfilling snapshot for ${key} (${deltas.length} delta(s) overlaid)`);
      snapshots = computeSnapshots(summary, filename, new Date(), deltas, clinicalForSnapshot);
      store.snapshots[key] = snapshots;
      await saveHealthStore(store);
    } else if (snapshots.parserVersion !== summary.parserVersion) {
      log.info(
        `Re-computing snapshot for ${key}: cached was v${snapshots.parserVersion}, ` +
          `summary is v${summary.parserVersion} (${deltas.length} delta(s))`
      );
      snapshots = computeSnapshots(summary, filename, new Date(), deltas, clinicalForSnapshot);
      store.snapshots[key] = snapshots;
      await saveHealthStore(store);
    } else if (snapshots.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
      log.info(
        `Re-computing snapshot for ${key}: cached schema v${snapshots.schemaVersion}, ` +
          `current schema v${SNAPSHOT_SCHEMA_VERSION} (${deltas.length} delta(s))`
      );
      snapshots = computeSnapshots(summary, filename, new Date(), deltas, clinicalForSnapshot);
      store.snapshots[key] = snapshots;
      await saveHealthStore(store);
    } else if (deltasChanged) {
      log.info(
        `Re-computing snapshot for ${key}: deltas dir mtime ${deltasMtime} ` +
          `newer than cached snapshot generatedAt ${snapshots.generatedAt} ` +
          `(${deltas.length} delta(s))`
      );
      snapshots = computeSnapshots(summary, filename, new Date(), deltas, clinicalForSnapshot);
      store.snapshots[key] = snapshots;
      await saveHealthStore(store);
    }

    // Staleness = the SUMMARY itself was produced by an older parser than
    // we're currently running. This is user-gated because re-parsing the
    // XML takes ~20-60 seconds (unlike recomputing snapshots, which is ~8ms
    // and happens automatically above).
    const cachedParserVersion = summary.parserVersion;
    const stale = cachedParserVersion !== CURRENT_PARSER_VERSION;

    if (segment === 'all') {
      // Merge user illness notes into the snapshot response
      const notes = store.illnessNotes ?? {};
      const personNotes: Record<string, IllnessNote> = {};
      const notePrefix = `${personId}/`;
      for (const [k, v] of Object.entries(notes)) {
        if (k.startsWith(notePrefix)) {
          personNotes[k.slice(notePrefix.length)] = v;
        }
      }
      return jsonResponse({
        snapshot: snapshots,
        illnessNotes: personNotes,
        stale,
        cachedParserVersion,
        currentParserVersion: CURRENT_PARSER_VERSION,
      });
    }
    return jsonResponse({
      segment,
      generatedAt: snapshots.generatedAt,
      sourceFilename: snapshots.sourceFilename,
      data: snapshots[segment as HealthSegment],
      stale,
      cachedParserVersion,
      currentParserVersion: CURRENT_PARSER_VERSION,
    });
  }

  // GET /api/health/:personId/clinical
  //
  // Returns the FHIR clinical summary for this person's most recent upload:
  // lab trends (grouped by LOINC), panels, vitals, conditions, medications,
  // immunizations, allergies, procedures, documents.
  //
  // Auto-heals on schema-version mismatch the same way /snapshot/ does for
  // the HealthKit snapshots. On parser version mismatch we don't re-parse
  // here (the user explicitly triggers /parse-export for that); instead we
  // surface `stale: true` so the UI can prompt.
  const clinicalMatch = pathname.match(/^\/api\/health\/([^/]+)\/clinical$/);
  if (clinicalMatch && req.method === 'GET') {
    const personId = clinicalMatch[1];
    await requirePerson(personId);

    const store = await loadHealthStore();
    const prefix = `${personId}/`;
    const clinical = store.clinical ?? {};
    const keys = Object.keys(clinical).filter((k) => k.startsWith(prefix));
    if (keys.length === 0) {
      return jsonResponse({ error: 'No clinical records parsed for this person yet' }, 404);
    }
    // Pick the newest by generatedAt timestamp (tiebreaker: key ordering).
    keys.sort((a, b) => {
      const ga = clinical[a]?.generatedAt ?? '';
      const gb = clinical[b]?.generatedAt ?? '';
      if (ga !== gb) return gb.localeCompare(ga);
      return b.localeCompare(a);
    });
    const key = keys[0];
    const data = clinical[key];
    const stale = data.schemaVersion !== CLINICAL_SCHEMA_VERSION;
    return jsonResponse({
      clinical: data,
      sourceFilename: key.slice(prefix.length),
      stale,
      cachedSchemaVersion: data.schemaVersion,
      currentSchemaVersion: CLINICAL_SCHEMA_VERSION,
    });
  }

  // GET /api/health/:personId/summaries — list all parsed summaries for a person
  const summariesMatch = pathname.match(/^\/api\/health\/([^/]+)\/summaries$/);
  if (summariesMatch && req.method === 'GET') {
    const personId = summariesMatch[1];
    const store = await loadHealthStore();
    const summaries: Array<{
      filename: string;
      exportDate?: string;
      dateRange: AppleHealthSummary['dateRange'];
      recordCounts: AppleHealthSummary['recordCounts'];
      parserVersion: string;
    }> = [];
    const prefix = `${personId}/`;
    for (const [k, v] of Object.entries(store.summaries)) {
      if (!k.startsWith(prefix)) continue;
      summaries.push({
        filename: k.slice(prefix.length),
        exportDate: v.exportDate,
        dateRange: v.dateRange,
        recordCounts: v.recordCounts,
        parserVersion: v.parserVersion,
      });
    }
    return jsonResponse({ summaries });
  }

  // PUT /api/health/:personId/illness-notes/:key — add/update/delete an illness note
  //   key format: "startDate-endDate"  (e.g. "2023-02-27-2023-02-28")
  //   body: { note?: string, dismissed?: boolean }
  //   To delete: send { dismissed: false, note: "" } or just re-detect will recreate
  const illnessNoteMatch = pathname.match(/^\/api\/health\/([^/]+)\/illness-notes\/([^/]+)$/);
  if (illnessNoteMatch && req.method === 'PUT') {
    const personId = illnessNoteMatch[1];
    const noteKey = illnessNoteMatch[2];
    await requirePerson(personId);

    const body = (await req.json()) as { note?: string; dismissed?: boolean };
    const store = await loadHealthStore();
    if (!store.illnessNotes) store.illnessNotes = {};
    const storeKey = `${personId}/${noteKey}`;

    // If both note and dismissed are empty/false, remove the entry
    if ((!body.note || body.note.trim() === '') && !body.dismissed) {
      delete store.illnessNotes[storeKey];
    } else {
      store.illnessNotes[storeKey] = {
        note: body.note?.trim() || undefined,
        dismissed: body.dismissed || undefined,
        updatedAt: new Date().toISOString(),
      };
    }

    await saveHealthStore(store);
    return jsonResponse({ ok: true });
  }

  return null;
}
