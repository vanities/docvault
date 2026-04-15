// Health route handlers — Apple Health exports, people management, parsed summaries.
//
// Routes:
//   GET    /api/health/people                                  — list people
//   POST   /api/health/people                                  — create a person
//   PATCH  /api/health/people/:id                              — rename/recolor
//   DELETE /api/health/people/:id?mode=archive|delete          — archive or hard delete
//   GET    /api/health/:personId/exports                       — list uploaded zips
//   POST   /api/health/:personId/parse-export                  — parse a previously uploaded zip
//     (body: { filename: string })
//   GET    /api/health/:personId/summary/:filename             — read parsed summary for a zip
//   GET    /api/health/:personId/summaries                     — list all parsed summaries for a person
//
// Storage:
//   data/health/<personId>/exports/*.zip        — uploaded source exports (never deleted)
//   data/health/.tmp/                           — scratch for decompressed XML during parse
//   data/.docvault-health.json                  — parsed summaries keyed by `<personId>/<filename>`
//
// The Health entity (id: "health", type: "health") lives in .docvault-config.json and
// its `people` array is the source of truth for person records.

import { promises as fs } from 'fs';
import path from 'path';
import {
  loadConfig,
  saveConfig,
  jsonResponse,
  ensureDir,
  getEntityPath,
  DATA_DIR,
} from '../data.js';
import type { HealthPerson, EntityConfig } from '../data.js';
import { parseAppleHealthExport, type AppleHealthSummary } from '../parsers/apple-health.js';
import { createLogger } from '../logger.js';

const log = createLogger('Health');

const HEALTH_STORE_FILE = path.join(DATA_DIR, '.docvault-health.json');
const HEALTH_ENTITY_ID = 'health';

// ---------------------------------------------------------------------------
// Store (parsed summaries) — keyed by "<personId>/<filename>"
// ---------------------------------------------------------------------------

interface HealthStore {
  version: 1;
  // key format: "<personId>/<filename>"
  summaries: Record<string, AppleHealthSummary>;
}

async function loadHealthStore(): Promise<HealthStore> {
  try {
    const content = await fs.readFile(HEALTH_STORE_FILE, 'utf-8');
    const parsed = JSON.parse(content) as Partial<HealthStore>;
    return {
      version: 1,
      summaries: parsed.summaries ?? {},
    };
  } catch {
    return { version: 1, summaries: {} };
  }
}

async function saveHealthStore(store: HealthStore): Promise<void> {
  // Write to a temp path then rename for atomicity (follows the project's
  // "never pipe output back to same file" rule indirectly — safer on crashes).
  const tmp = `${HEALTH_STORE_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2));
  await fs.rename(tmp, HEALTH_STORE_FILE);
}

function storeKey(personId: string, filename: string): string {
  return `${personId}/${filename}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Load the Health entity from config. Throws if missing (unexpected). */
async function requireHealthEntity(): Promise<EntityConfig> {
  const config = await loadConfig();
  const entity = config.entities.find((e) => e.id === HEALTH_ENTITY_ID);
  if (!entity) {
    throw new Error('Health entity not found in config — run the Health feature migration');
  }
  if (entity.type !== 'health') {
    throw new Error(`Entity "${HEALTH_ENTITY_ID}" has unexpected type "${entity.type}"`);
  }
  return entity;
}

/** Update the `people` array on the health entity and save config. */
async function updateHealthPeople(
  mutator: (people: HealthPerson[]) => HealthPerson[]
): Promise<HealthPerson[]> {
  const config = await loadConfig();
  const entity = config.entities.find((e) => e.id === HEALTH_ENTITY_ID);
  if (!entity) {
    throw new Error('Health entity not found');
  }
  const current = entity.people ?? [];
  const next = mutator(current);
  entity.people = next;
  await saveConfig(config);
  return next;
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

function requirePerson(entity: EntityConfig, personId: string): HealthPerson {
  const person = (entity.people ?? []).find((p) => p.id === personId);
  if (!person) {
    throw new Error(`Person "${personId}" not found`);
  }
  return person;
}

async function getPersonExportsDir(personId: string): Promise<string> {
  const entityPath = await getEntityPath(HEALTH_ENTITY_ID);
  if (!entityPath) {
    throw new Error('Health entity path not resolvable');
  }
  return path.join(entityPath, personId, 'exports');
}

function healthTmpDir(): string {
  return path.join(DATA_DIR, 'health', '.tmp');
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
    const entity = await requireHealthEntity();
    const includeArchived = url.searchParams.get('archived') === 'true';
    const all = entity.people ?? [];
    const people = includeArchived ? all : all.filter((p) => !p.archivedAt);
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
    const exportsDir = await getPersonExportsDir(person.id);
    await ensureDir(exportsDir);

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
      // Remove from config
      await updateHealthPeople((current) => current.filter((p) => p.id !== personId));

      // Remove all files on disk for this person
      const entityPath = await getEntityPath(HEALTH_ENTITY_ID);
      if (entityPath) {
        const personDir = path.join(entityPath, personId);
        await fs.rm(personDir, { recursive: true, force: true });
      }

      // Remove any parsed summaries for this person from the store
      const store = await loadHealthStore();
      const filtered: Record<string, AppleHealthSummary> = {};
      for (const [k, v] of Object.entries(store.summaries)) {
        if (!k.startsWith(`${personId}/`)) filtered[k] = v;
      }
      store.summaries = filtered;
      await saveHealthStore(store);

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
    const entity = await requireHealthEntity();
    requirePerson(entity, personId); // throws 404 handled below

    const dir = await getPersonExportsDir(personId);
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
    const entity = await requireHealthEntity();
    requirePerson(entity, personId);

    const body = (await req.json()) as { filename?: string };
    const filename = body.filename;
    if (!filename || !filename.endsWith('.zip')) {
      return jsonResponse({ error: 'Missing or invalid filename' }, 400);
    }

    const dir = await getPersonExportsDir(personId);
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
      const tmp = healthTmpDir();
      const summary = await parseAppleHealthExport(zipPath, tmp);

      // Persist to store
      const store = await loadHealthStore();
      store.summaries[storeKey(personId, filename)] = summary;
      await saveHealthStore(store);

      log.info(
        `Parsed ${personId}/${filename}: ${summary.recordCounts.totalRecords} records, ` +
          `${summary.recordCounts.totalWorkouts} workouts in ${summary.parseDurationMs} ms`
      );

      return jsonResponse({ ok: true, summary });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`Parse failed for ${personId}/${filename}: ${msg}`);
      return jsonResponse({ error: 'Parse failed', details: msg }, 500);
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
