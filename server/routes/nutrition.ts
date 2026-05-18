// Nutrition routes — supplement/food label management per person.
//
// Routes:
//   POST   /api/health/:personId/nutrition/upload         — upload an image, parse immediately
//     body: raw image bytes; query: ?filename=<name>&status=considering|active|past
//   GET    /api/health/:personId/nutrition                — list all entries for a person
//   GET    /api/health/:personId/nutrition/:id            — get one parsed entry
//   GET    /api/health/:personId/nutrition/:id/image      — fetch the raw label image (PNG/JPG)
//   PUT    /api/health/:personId/nutrition/:id/replace-image — swap the stored image bytes, keep entry id/dose/notes/parsed/etc.
//     body: raw image bytes; query: ?filename=<name>
//   PATCH  /api/health/:personId/nutrition/:id            — update status, dose, notes, research, citations, or parsed fields
//     body: partial { status?, dose?, notes?, research?, citations?, parsed? }
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
import {
  loadHealthStore,
  saveHealthStore,
  requirePerson,
  type NutritionEntry,
  type NutritionStatus,
  type NutritionDose,
  type NutritionCitation,
} from '../health-store.js';
import {
  parseNutritionLabel,
  NUTRITION_PARSER_VERSION,
  type ParsedNutritionLabel,
} from '../parsers/nutrition-label.js';
import { createLogger } from '../logger.js';

const log = createLogger('Nutrition');

const HEALTH_DATA_DIR = path.join(DATA_DIR, 'health');

// ---------------------------------------------------------------------------
// Types — owned by health-store.ts now, re-exported for back-compat with
// existing consumers (frontend types/index, sibling routes, tests).
// ---------------------------------------------------------------------------

export type { NutritionEntry, NutritionStatus, NutritionDose, NutritionCitation };

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

  // POST /api/health/:personId/nutrition — create a text-only entry (no label image)
  //
  // Used by the chat MCP layer when the agent recommends a supplement based on
  // web research rather than scanning a physical label. The entry carries a
  // synthesized ParsedNutritionLabel built from the request body so it looks
  // identical to image-parsed entries in the regimen table.
  //
  // Required: brandName, productName. Everything else optional — the agent fills
  // in what it knows. Status defaults to 'considering' so a chat-created
  // recommendation never silently joins the active stack.
  if (sub === '' && req.method === 'POST') {
    try {
      await requirePerson(personId);
    } catch (err) {
      return jsonResponse({ error: String(err instanceof Error ? err.message : err) }, 404);
    }

    const body = (await req.json().catch(() => null)) as Partial<{
      brandName: string;
      productName: string;
      category: ParsedNutritionLabel['category'];
      servingSize: ParsedNutritionLabel['servingSize'];
      servingsPerContainer: ParsedNutritionLabel['servingsPerContainer'];
      macros: ParsedNutritionLabel['macros'];
      vitamins: ParsedNutritionLabel['vitamins'];
      minerals: ParsedNutritionLabel['minerals'];
      otherActive: ParsedNutritionLabel['otherActive'];
      ingredients: ParsedNutritionLabel['ingredients'];
      directions: ParsedNutritionLabel['directions'];
      warnings: ParsedNutritionLabel['warnings'];
      status: NutritionStatus;
      dose: NutritionDose;
      notes: string;
      research: string;
      citations: NutritionCitation[];
    }> | null;

    if (!body || typeof body !== 'object') {
      return jsonResponse({ error: 'Body must be JSON' }, 400);
    }
    if (typeof body.brandName !== 'string' || body.brandName.trim().length === 0) {
      return jsonResponse({ error: 'brandName is required' }, 400);
    }
    if (typeof body.productName !== 'string' || body.productName.trim().length === 0) {
      return jsonResponse({ error: 'productName is required' }, 400);
    }

    const status = normalizeStatus(body.status) ?? 'considering';
    const now = new Date().toISOString();
    const id = newEntryId();

    // Synthesized "parsed" label — same shape the image parser produces, so the
    // snapshot renderer and regimen table treat this entry identically.
    const parsed: ParsedNutritionLabel = {
      schemaVersion: 1,
      parserVersion: `${NUTRITION_PARSER_VERSION}+text`,
      brandName: body.brandName.trim(),
      productName: body.productName.trim(),
      ...(body.category !== undefined && { category: body.category }),
      ...(body.servingSize !== undefined && { servingSize: body.servingSize }),
      ...(body.servingsPerContainer !== undefined && {
        servingsPerContainer: body.servingsPerContainer,
      }),
      ...(body.macros !== undefined && { macros: body.macros }),
      ...(body.vitamins !== undefined && { vitamins: body.vitamins }),
      ...(body.minerals !== undefined && { minerals: body.minerals }),
      ...(body.otherActive !== undefined && { otherActive: body.otherActive }),
      ...(body.ingredients !== undefined && { ingredients: body.ingredients }),
      ...(body.directions !== undefined && { directions: body.directions }),
      ...(body.warnings !== undefined && { warnings: body.warnings }),
    };

    const entry: NutritionEntry = {
      id,
      personId,
      filename: null,
      // Empty imagePath — readers that try to fetch the image get a 410 (already
      // handled by the image GET route), which is the correct behaviour for a
      // text-only entry.
      imagePath: '',
      imageMediaType: '',
      uploadedAt: now,
      parsedAt: now,
      parsed,
      parseError: null,
      status,
      ...(body.dose !== undefined && { dose: body.dose }),
      ...(body.notes !== undefined && { notes: body.notes }),
      ...(body.research !== undefined && { research: body.research }),
      ...(body.citations !== undefined && { citations: body.citations }),
      lastUpdated: now,
    };

    const store = await loadHealthStore();
    if (!store.nutrition) store.nutrition = {};
    store.nutrition[`${personId}/${id}`] = entry;
    await saveHealthStore(store);

    log.info(
      `Nutrition entry created from text for ${personId}: id=${id} brand="${entry.parsed?.brandName ?? '?'}" product="${entry.parsed?.productName ?? '?'}"`
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
  // GET /api/health/:personId/nutrition/:id/image?slot=primary|facts — raw image bytes
  // PUT /api/health/:personId/nutrition/:id/replace-image?slot=primary|facts — swap bytes for that slot
  // PATCH /api/health/:personId/nutrition/:id — update fields
  // DELETE /api/health/:personId/nutrition/:id — remove
  // POST /api/health/:personId/nutrition/:id/reparse — re-run the parser
  const idMatch = sub.match(/^\/([a-z0-9]+)(?:\/(image|reparse|replace-image))?$/i);
  if (idMatch) {
    const id = idMatch[1];
    const action = idMatch[2];
    const key = `${personId}/${id}`;

    const store = await loadHealthStore();
    const entry = store.nutrition?.[key];
    if (!entry) {
      return jsonResponse({ error: `No nutrition entry "${id}" for ${personId}` }, 404);
    }

    // Resolve which slot a request is targeting. Both image GET and the
    // replace-image PUT use the same `?slot=primary|facts` convention, with
    // `primary` as the default so existing URL callers keep working.
    const slotParam = url.searchParams.get('slot');
    const slot: 'primary' | 'facts' = slotParam === 'facts' ? 'facts' : 'primary';
    const slotImagePath = slot === 'facts' ? (entry.factsImagePath ?? '') : entry.imagePath;
    const slotMediaType =
      slot === 'facts' ? (entry.factsImageMediaType ?? '') : entry.imageMediaType;

    // GET /api/health/:personId/nutrition/:id/image
    if (action === 'image' && req.method === 'GET') {
      if (!slotImagePath) {
        return jsonResponse({ error: `Slot "${slot}" has no image attached` }, 404);
      }
      const abs = path.join(DATA_DIR, slotImagePath);
      try {
        const bytes = await fs.readFile(abs);
        return new Response(new Uint8Array(bytes), {
          headers: {
            'Content-Type': slotMediaType || 'image/png',
            'Cache-Control': 'private, max-age=3600',
          },
        });
      } catch {
        return jsonResponse({ error: 'Image file missing on disk' }, 410);
      }
    }

    // PUT /api/health/:personId/nutrition/:id/replace-image
    //
    // Writes raw image bytes to the slot's path on disk, then mutates the
    // slot's three fields (imagePath, imageMediaType, filename — or the
    // facts-prefixed counterparts) and bumps lastUpdated. Crucially, it
    // does NOT touch parsed/dose/notes/research/citations/status — those
    // survive intact across an image swap. The caller can choose to follow
    // up with a /reparse POST if the new image changes the parsed facts.
    //
    // The previous file in the slot (if any) is unlinked best-effort. If
    // the slot was empty (text-only entry attaching a first image, or
    // attaching a facts panel for the first time), unlink is a no-op.
    if (action === 'replace-image' && req.method === 'PUT') {
      const filename = url.searchParams.get('filename');
      const raw = Buffer.from(await req.arrayBuffer());
      if (raw.length === 0) {
        return jsonResponse({ error: 'Empty upload' }, 400);
      }

      const mediaType =
        filename && /\.(png|jpe?g|gif|webp)$/i.test(filename)
          ? mediaTypeFromFilename(filename)
          : mediaTypeFromBuffer(raw);
      const ext = extFromMediaType(mediaType);

      // Unlink the old file (if any). The suffix `-facts` keeps the two
      // slots' bytes on disk distinguishable when both are populated.
      const oldRel = slot === 'facts' ? (entry.factsImagePath ?? '') : entry.imagePath;
      if (oldRel) {
        const oldAbs = path.join(DATA_DIR, oldRel);
        try {
          await fs.unlink(oldAbs);
        } catch {
          /* already gone — fine */
        }
      }

      await ensureDir(nutritionDir(personId));
      const baseName = slot === 'facts' ? `${id}-facts` : id;
      const newAbs = path.join(nutritionDir(personId), `${baseName}.${ext}`);
      const newRel = path.relative(DATA_DIR, newAbs);
      await fs.writeFile(newAbs, raw);

      const now = new Date().toISOString();
      if (slot === 'facts') {
        entry.factsImagePath = newRel;
        entry.factsImageMediaType = mediaType;
        entry.factsFilename = filename;
      } else {
        entry.imagePath = newRel;
        entry.imageMediaType = mediaType;
        entry.filename = filename;
      }
      entry.lastUpdated = now;
      await saveHealthStore(store);

      log.info(`Nutrition image replaced for ${key} slot=${slot}`);
      return jsonResponse({ entry });
    }

    // POST /api/health/:personId/nutrition/:id/reparse
    //
    // Prefer the facts-panel image when present — that's the close-up of the
    // actual label text the parser can actually read. Fall back to the
    // primary (bottle/front) shot if the facts slot is empty, which keeps
    // older single-image entries working unchanged.
    if (action === 'reparse' && req.method === 'POST') {
      const sourceRel = entry.factsImagePath || entry.imagePath;
      const sourceMediaType = entry.factsImagePath
        ? entry.factsImageMediaType || ''
        : entry.imageMediaType;
      if (!sourceRel) {
        return jsonResponse({ error: 'No image attached to reparse' }, 400);
      }
      const abs = path.join(DATA_DIR, sourceRel);
      let raw: Buffer;
      try {
        raw = await fs.readFile(abs);
      } catch {
        return jsonResponse({ error: 'Image file missing on disk' }, 410);
      }
      const mediaType =
        (sourceMediaType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp') ||
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
        research: string | null;
        citations: NutritionCitation[] | null;
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
      if (body.research !== undefined) {
        entry.research = body.research ?? undefined;
      }
      if (body.citations !== undefined) {
        entry.citations = body.citations ?? undefined;
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
    //
    // Remove both image slots from disk best-effort, then drop the store
    // entry. The two unlinks are tolerant of missing files so the JSON
    // entry always gets cleared even if disk state is inconsistent (e.g.,
    // someone removed files out-of-band).
    if (!action && req.method === 'DELETE') {
      for (const rel of [entry.imagePath, entry.factsImagePath]) {
        if (!rel) continue;
        try {
          await fs.unlink(path.join(DATA_DIR, rel));
        } catch {
          /* file already gone — fine */
        }
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
