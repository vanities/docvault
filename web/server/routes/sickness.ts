// Sickness logs — per-person manually-entered illness episodes with
// structured symptoms, medications, and severity. Complements the
// auto-detected illness periods (from apple-health-snapshots.ts) with
// user-observed data that the wearable can't capture on its own
// (e.g. "took Claritin-D", "congestion felt worse in mornings").
//
// Storage: `.docvault-health.json` → `sicknessLogs: Record<string, SicknessLog>`
// where key = `<personId>/<id>`. Immutable `id` assigned at creation; content
// is editable via PATCH.
//
// Routes:
//   GET    /api/health/:personId/sickness              — list all logs
//   POST   /api/health/:personId/sickness              — create a new log
//   GET    /api/health/:personId/sickness/:id          — get one log
//   PATCH  /api/health/:personId/sickness/:id          — update fields
//   DELETE /api/health/:personId/sickness/:id          — delete a log

import { jsonResponse } from '../data.js';
import {
  loadHealthStore,
  saveHealthStore,
  requirePerson,
  type SicknessLog,
  type SicknessCategory,
  type SicknessSeverity,
  type MedicationDose,
} from '../health-store.js';
import { createLogger } from '../logger.js';

const log = createLogger('Sickness');

// ---------------------------------------------------------------------------
// Types — owned by health-store.ts now, re-exported here so existing
// consumers (frontend, tests, sibling routes) keep working unchanged.
// ---------------------------------------------------------------------------

export type { SicknessLog, SicknessCategory, SicknessSeverity, MedicationDose };

function newLogId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 10; i++) id += alphabet[Math.floor(Math.random() * alphabet.length)];
  return id;
}

const VALID_CATEGORIES: SicknessCategory[] = [
  'cold',
  'flu',
  'covid',
  'allergies',
  'sinus',
  'stomach',
  'injury',
  'migraine',
  'other',
];
const VALID_SEVERITIES: SicknessSeverity[] = ['mild', 'moderate', 'severe'];

function isValidCategory(c: unknown): c is SicknessCategory {
  return typeof c === 'string' && VALID_CATEGORIES.includes(c as SicknessCategory);
}
function isValidSeverity(s: unknown): s is SicknessSeverity {
  return typeof s === 'string' && VALID_SEVERITIES.includes(s as SicknessSeverity);
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function handleSicknessRoutes(
  req: Request,
  _url: URL,
  pathname: string
): Promise<Response | null> {
  const match = pathname.match(/^\/api\/health\/([^/]+)\/sickness(\/[^?]*)?$/);
  if (!match) return null;
  const personId = match[1];
  const sub = match[2] ?? '';

  try {
    await requirePerson(personId);
  } catch (err) {
    return jsonResponse({ error: String(err instanceof Error ? err.message : err) }, 404);
  }

  // GET /api/health/:personId/sickness — list all logs for a person
  if (sub === '' && req.method === 'GET') {
    const store = await loadHealthStore();
    const prefix = `${personId}/`;
    const logs = Object.entries(store.sicknessLogs ?? {})
      .filter(([k]) => k.startsWith(prefix))
      .map(([, v]) => v)
      .sort((a, b) => b.startDate.localeCompare(a.startDate));
    return jsonResponse({ logs });
  }

  // POST /api/health/:personId/sickness — create a new log
  if (sub === '' && req.method === 'POST') {
    const body = (await req.json().catch(() => ({}))) as Partial<SicknessLog>;

    if (!body.title || !body.startDate) {
      return jsonResponse({ error: 'Missing required fields: title, startDate' }, 400);
    }
    if (!isValidCategory(body.category ?? 'other')) {
      return jsonResponse({ error: `Invalid category: ${body.category}` }, 400);
    }
    if (!isValidSeverity(body.severity ?? 'mild')) {
      return jsonResponse({ error: `Invalid severity: ${body.severity}` }, 400);
    }

    const id = newLogId();
    const now = new Date().toISOString();
    const logEntry: SicknessLog = {
      id,
      personId,
      startDate: body.startDate,
      endDate: body.endDate,
      category: (body.category as SicknessCategory) ?? 'other',
      severity: (body.severity as SicknessSeverity) ?? 'mild',
      title: body.title.trim(),
      symptoms: Array.isArray(body.symptoms) ? body.symptoms : [],
      medications: Array.isArray(body.medications) ? body.medications : [],
      notes: body.notes,
      linkToAutoDetection: body.linkToAutoDetection,
      createdAt: now,
      updatedAt: now,
    };

    const store = await loadHealthStore();
    if (!store.sicknessLogs) store.sicknessLogs = {};
    store.sicknessLogs[`${personId}/${id}`] = logEntry;
    await saveHealthStore(store);

    log.info(
      `Sickness log created for ${personId}: id=${id} "${logEntry.title}" (${logEntry.category}, ${logEntry.severity})`
    );
    return jsonResponse({ log: logEntry });
  }

  // /api/health/:personId/sickness/:id
  const idMatch = sub.match(/^\/([a-z0-9]+)$/i);
  if (idMatch) {
    const id = idMatch[1];
    const key = `${personId}/${id}`;
    const store = await loadHealthStore();
    const entry = store.sicknessLogs?.[key];
    if (!entry) {
      return jsonResponse({ error: `No sickness log "${id}" for ${personId}` }, 404);
    }

    if (req.method === 'GET') {
      return jsonResponse({ log: entry });
    }

    if (req.method === 'PATCH') {
      const body = (await req.json().catch(() => ({}))) as Partial<SicknessLog>;

      if (body.category !== undefined && !isValidCategory(body.category)) {
        return jsonResponse({ error: `Invalid category: ${body.category}` }, 400);
      }
      if (body.severity !== undefined && !isValidSeverity(body.severity)) {
        return jsonResponse({ error: `Invalid severity: ${body.severity}` }, 400);
      }

      const updated: SicknessLog = {
        ...entry,
        ...(body.title !== undefined ? { title: body.title.trim() } : {}),
        ...(body.startDate !== undefined ? { startDate: body.startDate } : {}),
        ...(body.endDate !== undefined ? { endDate: body.endDate ?? undefined } : {}),
        ...(body.category !== undefined ? { category: body.category as SicknessCategory } : {}),
        ...(body.severity !== undefined ? { severity: body.severity as SicknessSeverity } : {}),
        ...(body.symptoms !== undefined
          ? { symptoms: Array.isArray(body.symptoms) ? body.symptoms : [] }
          : {}),
        ...(body.medications !== undefined
          ? { medications: Array.isArray(body.medications) ? body.medications : [] }
          : {}),
        ...(body.notes !== undefined ? { notes: body.notes ?? undefined } : {}),
        ...(body.linkToAutoDetection !== undefined
          ? { linkToAutoDetection: body.linkToAutoDetection }
          : {}),
        updatedAt: new Date().toISOString(),
      };
      store.sicknessLogs![key] = updated;
      await saveHealthStore(store);
      return jsonResponse({ log: updated });
    }

    if (req.method === 'DELETE') {
      delete store.sicknessLogs![key];
      await saveHealthStore(store);
      log.info(`Sickness log ${key} deleted`);
      return jsonResponse({ ok: true });
    }
  }

  return null;
}
