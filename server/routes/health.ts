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
//
// Storage:
//   data/health/<personId>/exports/<name>.zip   — uploaded source exports (never deleted)
//   data/health/<personId>/exports/<name>.xml   — decompressed XML (persistent cache, backed up)
//   data/.docvault-health.json                  — people list + parsed summaries + computed snapshots
//
// Health is NOT an entity — it's a global sidebar section. People, summaries,
// and snapshots all live together in .docvault-health.json and are decoupled
// from the entity system entirely. The decompressed XML is persisted next to
// the zip so DocVault's data-dir backup captures both the compressed source
// and the decompressed working copy, and re-parses skip the ~5-second unzip
// step.

import { promises as fs } from 'fs';
import path from 'path';
import { jsonResponse, ensureDir, DATA_DIR } from '../data.js';
import type { HealthPerson } from '../data.js';
import {
  parseAppleHealthExport,
  PARSER_VERSION as CURRENT_PARSER_VERSION,
  type AppleHealthSummary,
} from '../parsers/apple-health.js';
import {
  computeSnapshots,
  type PersonSnapshots,
  type HealthSegment,
} from '../parsers/apple-health-snapshots.js';
import { createLogger } from '../logger.js';

const log = createLogger('Health');

const HEALTH_STORE_FILE = path.join(DATA_DIR, '.docvault-health.json');
const HEALTH_DATA_DIR = path.join(DATA_DIR, 'health');

// ---------------------------------------------------------------------------
// Store — people + parsed summaries live together in .docvault-health.json
// ---------------------------------------------------------------------------

interface HealthStore {
  version: 1;
  people: HealthPerson[];
  // key format: "<personId>/<filename>"
  summaries: Record<string, AppleHealthSummary>;
  snapshots: Record<string, PersonSnapshots>;
}

async function loadHealthStore(): Promise<HealthStore> {
  try {
    const content = await fs.readFile(HEALTH_STORE_FILE, 'utf-8');
    const parsed = JSON.parse(content) as Partial<HealthStore>;
    return {
      version: 1,
      people: parsed.people ?? [],
      summaries: parsed.summaries ?? {},
      snapshots: parsed.snapshots ?? {},
    };
  } catch {
    return { version: 1, people: [], summaries: {}, snapshots: {} };
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
      // Remove from store and drop their summaries in one write
      const store = await loadHealthStore();
      store.people = store.people.filter((p) => p.id !== personId);
      const filtered: Record<string, AppleHealthSummary> = {};
      for (const [k, v] of Object.entries(store.summaries)) {
        if (!k.startsWith(`${personId}/`)) filtered[k] = v;
      }
      store.summaries = filtered;
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
      const snapshots = computeSnapshots(summary, filename);

      // Persist to store
      const store = await loadHealthStore();
      store.summaries[storeKey(personId, filename)] = summary;
      store.snapshots[storeKey(personId, filename)] = snapshots;
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

      // 3. Compute segment snapshots (pure, ~8ms for 8 years of data)
      const snapshots = computeSnapshots(summary, filename);

      // 4. Persist summary + snapshots to store in a single write
      const store = await loadHealthStore();
      store.summaries[storeKey(personId, filename)] = summary;
      store.snapshots[storeKey(personId, filename)] = snapshots;
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

    // Lazily backfill if the summary is present but the snapshot isn't
    let snapshots = store.snapshots[key];
    if (!snapshots) {
      const summary = store.summaries[key];
      const filename = key.slice(prefix.length);
      log.info(`Backfilling snapshot for ${key}`);
      snapshots = computeSnapshots(summary, filename);
      store.snapshots[key] = snapshots;
      await saveHealthStore(store);
    }

    // Staleness: if the cached snapshot was produced by an older parser
    // than we're currently running, the data is likely missing fields or
    // using older aggregation rules. Flag it so the UI can prompt a re-parse.
    const cachedParserVersion = snapshots.parserVersion;
    const stale = cachedParserVersion !== CURRENT_PARSER_VERSION;

    if (segment === 'all') {
      return jsonResponse({
        snapshot: snapshots,
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

  return null;
}
