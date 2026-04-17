// Nutrition routes — supplement/food label management per person.
//
// Routes:
//   POST   /api/health/:personId/nutrition/upload         — upload an image, parse immediately
//     body: raw image bytes; query: ?filename=<name>&status=considering|active|past
//   GET    /api/health/:personId/nutrition                — list all entries for a person
//   GET    /api/health/:personId/nutrition/:id            — get one parsed entry
//   GET    /api/health/:personId/nutrition/:id/image      — fetch the raw label image (PNG/JPG)
//   PATCH  /api/health/:personId/nutrition/:id            — update status, dose, notes, or parsed fields
//     body: partial { status?, dose?, notes?, parsed? }
//   POST   /api/health/:personId/nutrition/:id/reparse    — re-run the parser against the stored image
//   DELETE /api/health/:personId/nutrition/:id            — delete entry + image
//
// Storage:
//   data/health/<personId>/nutrition/<id>.<ext>           — raw label image (png/jpg)
//   .docvault-health.json → `nutrition` map                — parsed + user state (id → NutritionEntry)
//
// Labels are NOT encrypted at rest — they're public product info. The personal
// part (status, dose, notes) lives in the health store, which is protected by
// the data-dir permissions like the rest of DocVault.

import { promises as fs } from 'fs';
import path from 'path';
import { jsonResponse, ensureDir, DATA_DIR } from '../data.js';
import type { HealthPerson } from '../data.js';
import {
  parseNutritionLabel,
  NUTRITION_PARSER_VERSION,
  type ParsedNutritionLabel,
} from '../parsers/nutrition-label.js';
import { createLogger } from '../logger.js';

const log = createLogger('Nutrition');

const HEALTH_STORE_FILE = path.join(DATA_DIR, '.docvault-health.json');
const HEALTH_DATA_DIR = path.join(DATA_DIR, 'health');

// ---------------------------------------------------------------------------
// Types
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

export interface NutritionEntry {
  id: string;
  personId: string;
  /** Original filename uploaded, for display. */
  filename: string | null;
  /** Relative path under DATA_DIR. */
  imagePath: string;
  imageMediaType: string;
  uploadedAt: string;
  parsedAt: string | null;
  parsed: ParsedNutritionLabel | null;
  /** Error message if parse failed; null if it succeeded or hasn't been attempted. */
  parseError: string | null;
  status: NutritionStatus;
  dose?: NutritionDose;
  notes?: string;
  lastUpdated: string;
}

// Subset of the HealthStore shape this module touches. We intentionally
// re-declare the minimal surface instead of importing HealthStore from
// routes/health.ts (it's not exported, and duplicating the shape here keeps
// routes decoupled — same pattern used in routes/health-snapshot.ts).
interface HealthStoreShape {
  version: 1;
  people: HealthPerson[];
  summaries?: Record<string, unknown>;
  snapshots?: Record<string, unknown>;
  clinical?: Record<string, unknown>;
  illnessNotes?: Record<string, unknown>;
  nutrition?: Record<string, NutritionEntry>;
  /** Preserve fields owned by other route modules (sickness, …). */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Store helpers
// ---------------------------------------------------------------------------

async function loadHealthStore(): Promise<HealthStoreShape> {
  try {
    const raw = await fs.readFile(HEALTH_STORE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<HealthStoreShape>;
    return {
      // Spread first so sibling-owned fields (sicknessLogs, future additions)
      // survive this module's saves instead of getting silently wiped.
      ...parsed,
      version: 1,
      people: parsed.people ?? [],
      summaries: parsed.summaries ?? {},
      snapshots: parsed.snapshots ?? {},
      clinical: parsed.clinical ?? {},
      illnessNotes: parsed.illnessNotes ?? {},
      nutrition: parsed.nutrition ?? {},
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
    };
  }
}

async function saveHealthStore(store: HealthStoreShape): Promise<void> {
  // Atomic write via tmp rename — matches the existing health.ts pattern.
  // Prevents partial writes on crash (the user's "never pipe output back to
  // same file" rule applied at the serialization layer).
  await ensureDir(DATA_DIR);
  const tmp = `${HEALTH_STORE_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2));
  await fs.rename(tmp, HEALTH_STORE_FILE);
}

async function requirePerson(personId: string): Promise<HealthPerson> {
  const store = await loadHealthStore();
  const person = store.people.find((p) => p.id === personId);
  if (!person) throw new Error(`Person "${personId}" not found`);
  return person;
}

function nutritionDir(personId: string): string {
  return path.join(HEALTH_DATA_DIR, personId, 'nutrition');
}

function newEntryId(): string {
  // 10-char base36 — human-visible, collision-free enough for per-person use.
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 10; i++) {
    id += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return id;
}

function mediaTypeFromFilename(
  filename: string | null
): 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' {
  const ext = (filename ?? '').toLowerCase().split('.').pop();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  return 'image/png';
}

function extFromMediaType(mediaType: string): string {
  if (mediaType === 'image/jpeg') return 'jpg';
  if (mediaType === 'image/gif') return 'gif';
  if (mediaType === 'image/webp') return 'webp';
  return 'png';
}

function mediaTypeFromBuffer(buf: Buffer): 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' {
  // Magic-byte sniffing as a fallback when filename doesn't disambiguate.
  if (buf.length >= 4) {
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
      return 'image/png';
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
    if (buf.length >= 12 && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  }
  return 'image/png';
}

function relImagePath(entry: Pick<NutritionEntry, 'imagePath'>): string {
  return entry.imagePath;
}

// Validate + normalize a status string.
function normalizeStatus(raw: unknown): NutritionStatus | null {
  if (raw === 'active' || raw === 'considering' || raw === 'past' || raw === 'never') return raw;
  return null;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function handleNutritionRoutes(
  req: Request,
  url: URL,
  pathname: string
): Promise<Response | null> {
  // Match /api/health/:personId/nutrition[...]
  const match = pathname.match(/^\/api\/health\/([^/]+)\/nutrition(\/[^?]*)?$/);
  if (!match) return null;
  const personId = match[1];
  const sub = match[2] ?? '';

  // POST /api/health/:personId/nutrition/upload — body: raw image bytes
  if (sub === '/upload' && req.method === 'POST') {
    try {
      await requirePerson(personId);
    } catch (err) {
      return jsonResponse({ error: String(err instanceof Error ? err.message : err) }, 404);
    }

    const filename = url.searchParams.get('filename');
    const statusParam = normalizeStatus(url.searchParams.get('status')) ?? 'considering';
    const raw = Buffer.from(await req.arrayBuffer());
    if (raw.length === 0) {
      return jsonResponse({ error: 'Empty upload' }, 400);
    }

    // Prefer filename extension, fall back to magic bytes
    const mediaType =
      filename && /\.(png|jpe?g|gif|webp)$/i.test(filename)
        ? mediaTypeFromFilename(filename)
        : mediaTypeFromBuffer(raw);
    const ext = extFromMediaType(mediaType);
    const id = newEntryId();

    await ensureDir(nutritionDir(personId));
    const absPath = path.join(nutritionDir(personId), `${id}.${ext}`);
    const relPath = path.relative(DATA_DIR, absPath);
    await fs.writeFile(absPath, raw);

    // Parse (non-blocking from the user's POV — they wait, but if it fails
    // we still store the image and the partial entry so they can retry later).
    const now = new Date().toISOString();
    let parsed: ParsedNutritionLabel | null = null;
    let parseError: string | null = null;
    let parsedAt: string | null = null;
    try {
      parsed = await parseNutritionLabel(raw, mediaType);
      parsedAt = new Date().toISOString();
      if (!parsed) {
        parseError = 'Parser returned null (no tool result from Claude)';
      }
    } catch (err) {
      parseError = err instanceof Error ? err.message : String(err);
      log.error(`Parse failed for ${personId}/${id}:`, parseError);
    }

    const entry: NutritionEntry = {
      id,
      personId,
      filename,
      imagePath: relPath,
      imageMediaType: mediaType,
      uploadedAt: now,
      parsedAt,
      parsed,
      parseError,
      status: statusParam,
      lastUpdated: now,
    };

    const store = await loadHealthStore();
    if (!store.nutrition) store.nutrition = {};
    store.nutrition[`${personId}/${id}`] = entry;
    await saveHealthStore(store);

    log.info(
      `Nutrition upload for ${personId}: id=${id} parsed=${parsed !== null} product="${parsed?.productName ?? '?'}"`
    );

    return jsonResponse({ entry });
  }

  // GET /api/health/:personId/nutrition — list all entries for a person
  if (sub === '' && req.method === 'GET') {
    try {
      await requirePerson(personId);
    } catch (err) {
      return jsonResponse({ error: String(err instanceof Error ? err.message : err) }, 404);
    }

    const store = await loadHealthStore();
    const prefix = `${personId}/`;
    const entries = Object.entries(store.nutrition ?? {})
      .filter(([k]) => k.startsWith(prefix))
      .map(([, v]) => v)
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
    return jsonResponse({ entries });
  }

  // GET /api/health/:personId/nutrition/:id — single entry
  // GET /api/health/:personId/nutrition/:id/image — raw image bytes
  // PATCH /api/health/:personId/nutrition/:id — update fields
  // DELETE /api/health/:personId/nutrition/:id — remove
  // POST /api/health/:personId/nutrition/:id/reparse — re-run the parser
  const idMatch = sub.match(/^\/([a-z0-9]+)(?:\/(image|reparse))?$/i);
  if (idMatch) {
    const id = idMatch[1];
    const action = idMatch[2];
    const key = `${personId}/${id}`;

    const store = await loadHealthStore();
    const entry = store.nutrition?.[key];
    if (!entry) {
      return jsonResponse({ error: `No nutrition entry "${id}" for ${personId}` }, 404);
    }

    // GET /api/health/:personId/nutrition/:id/image
    if (action === 'image' && req.method === 'GET') {
      const abs = path.join(DATA_DIR, entry.imagePath);
      try {
        const bytes = await fs.readFile(abs);
        return new Response(new Uint8Array(bytes), {
          headers: {
            'Content-Type': entry.imageMediaType || 'image/png',
            'Cache-Control': 'private, max-age=3600',
          },
        });
      } catch {
        return jsonResponse({ error: 'Image file missing on disk' }, 410);
      }
    }

    // POST /api/health/:personId/nutrition/:id/reparse
    if (action === 'reparse' && req.method === 'POST') {
      const abs = path.join(DATA_DIR, entry.imagePath);
      let raw: Buffer;
      try {
        raw = await fs.readFile(abs);
      } catch {
        return jsonResponse({ error: 'Image file missing on disk' }, 410);
      }
      const mediaType =
        (entry.imageMediaType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp') ||
        mediaTypeFromBuffer(raw);

      let parsed: ParsedNutritionLabel | null = null;
      let parseError: string | null = null;
      try {
        parsed = await parseNutritionLabel(raw, mediaType);
        if (!parsed) parseError = 'Parser returned null (no tool result from Claude)';
      } catch (err) {
        parseError = err instanceof Error ? err.message : String(err);
      }

      const now = new Date().toISOString();
      entry.parsed = parsed;
      entry.parseError = parseError;
      entry.parsedAt = parsed ? now : entry.parsedAt;
      entry.lastUpdated = now;
      await saveHealthStore(store);
      return jsonResponse({ entry });
    }

    // GET /api/health/:personId/nutrition/:id
    if (!action && req.method === 'GET') {
      return jsonResponse({ entry });
    }

    // PATCH /api/health/:personId/nutrition/:id
    if (!action && req.method === 'PATCH') {
      const body = (await req.json().catch(() => ({}))) as Partial<{
        status: NutritionStatus;
        dose: NutritionDose | null;
        notes: string | null;
        parsed: ParsedNutritionLabel | null;
      }>;

      if (body.status !== undefined) {
        const s = normalizeStatus(body.status);
        if (!s) return jsonResponse({ error: `Invalid status: ${String(body.status)}` }, 400);
        entry.status = s;
      }
      if (body.dose !== undefined) {
        entry.dose = body.dose ?? undefined;
      }
      if (body.notes !== undefined) {
        entry.notes = body.notes ?? undefined;
      }
      if (body.parsed !== undefined) {
        // Allow manual correction of parsed fields — reviewer edits after auto-parse
        entry.parsed = body.parsed;
        entry.parsedAt = new Date().toISOString();
      }
      entry.lastUpdated = new Date().toISOString();
      await saveHealthStore(store);
      return jsonResponse({ entry });
    }

    // DELETE /api/health/:personId/nutrition/:id
    if (!action && req.method === 'DELETE') {
      const abs = path.join(DATA_DIR, entry.imagePath);
      try {
        await fs.unlink(abs);
      } catch {
        /* file already gone — fine */
      }
      delete store.nutrition![key];
      await saveHealthStore(store);
      log.info(`Nutrition entry ${key} deleted`);
      return jsonResponse({ ok: true });
    }
  }

  return null;
}

// Export for the health-snapshot consolidator
export { relImagePath as nutritionImageRelPath };
export { NUTRITION_PARSER_VERSION };
