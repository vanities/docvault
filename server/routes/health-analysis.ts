// Health analysis history — stores AI-generated health analyses that combine
// snapshot data (labs, DNA, supplements, activity, illness) into actionable
// recommendations. Mirrors server/routes/strategy.ts in shape + behavior.
//
// Entries are created by Claude Code's /health-analysis skill and displayed
// in the app's Health Analysis tab. Append-only; immutable after creation
// (delete is the only mutation).

import * as fs from 'node:fs/promises';
import { HEALTH_ANALYSIS_HISTORY_FILE, jsonResponse } from '../data.js';
import { createLogger } from '../logger.js';

const log = createLogger('HealthAnalysis');

/**
 * Key indicators captured at analysis time so the UI can render a compact
 * grid of "state-of-health" tiles above the markdown body, exactly like
 * Strategy does for quant signals. All fields are optional — the skill
 * populates what's relevant to its particular analysis.
 */
export interface HealthAnalysisSignals {
  // Cardiovascular / lipids
  ldl?: number | null;
  hdl?: number | null;
  triglycerides?: number | null;
  totalCholesterol?: number | null;
  apoB?: number | null;
  lpA?: number | null;
  // Glucose / metabolic
  hba1c?: number | null;
  fastingGlucose?: number | null;
  // Hematology
  platelets?: number | null;
  // Activity / vitals
  restingHR?: number | null;
  hrv?: number | null;
  avgSleepHours?: number | null;
  avgDailySteps?: number | null;
  // Body
  weightKg?: number | null;
  // Catch-all for analysis-specific signals (vitamin D, B12, TSH, CRP, etc.)
  [key: string]: unknown;
}

export interface HealthAnalysisEntry {
  id: string;
  createdAt: string; // ISO 8601
  /** One-line headline, e.g. "Lipid-loaded genotype — prioritize ApoB + Lp(a) test before escalation" */
  title: string;
  /** Full markdown analysis body. */
  body: string;
  /** The person the analysis is about (DocVault Health person id). */
  personId?: string;
  /** Snapshot of key health metrics at the time of analysis. */
  signals: HealthAnalysisSignals;
  /** Optional tags — e.g. ["lipids", "supplements", "sleep"] — for filtering. */
  tags?: string[];
  /** Who/what generated this entry. */
  author: string;
}

interface HealthAnalysisHistoryFile {
  entries: HealthAnalysisEntry[];
}

async function loadHistory(): Promise<HealthAnalysisHistoryFile> {
  try {
    const raw = await fs.readFile(HEALTH_ANALYSIS_HISTORY_FILE, 'utf8');
    const parsed = JSON.parse(raw) as HealthAnalysisHistoryFile;
    return parsed.entries ? parsed : { entries: [] };
  } catch {
    return { entries: [] };
  }
}

async function saveHistory(data: HealthAnalysisHistoryFile): Promise<void> {
  await fs.writeFile(HEALTH_ANALYSIS_HISTORY_FILE, JSON.stringify(data, null, 2));
}

export async function handleHealthAnalysisRoutes(
  req: Request,
  _url: URL,
  pathname: string
): Promise<Response | null> {
  // GET /api/health-analysis — list all entries, newest first
  if (pathname === '/api/health-analysis' && req.method === 'GET') {
    const data = await loadHistory();
    return jsonResponse({
      entries: [...data.entries].reverse(),
      count: data.entries.length,
    });
  }

  // GET /api/health-analysis/latest — most recent entry only
  if (pathname === '/api/health-analysis/latest' && req.method === 'GET') {
    const data = await loadHistory();
    const latest = data.entries.length > 0 ? data.entries[data.entries.length - 1] : null;
    return jsonResponse({ entry: latest });
  }

  // POST /api/health-analysis — create a new entry
  if (pathname === '/api/health-analysis' && req.method === 'POST') {
    try {
      const body = (await req.json()) as Partial<HealthAnalysisEntry>;

      if (!body.title || !body.body) {
        return jsonResponse({ error: 'Missing required fields: title, body' }, 400);
      }

      const entry: HealthAnalysisEntry = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        title: body.title.trim(),
        body: body.body.trim(),
        personId: body.personId,
        signals: body.signals ?? {},
        tags: body.tags,
        author: body.author ?? 'Claude Code',
      };

      const data = await loadHistory();
      data.entries.push(entry);
      await saveHistory(data);

      log.info(`Health analysis saved: "${entry.title}" (${entry.id})`);
      return jsonResponse({ ok: true, entry });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`Health analysis save failed: ${msg}`);
      return jsonResponse({ error: `Failed to save health analysis: ${msg}` }, 500);
    }
  }

  // DELETE /api/health-analysis/:id — remove an entry
  const deleteMatch = pathname.match(/^\/api\/health-analysis\/([^/]+)$/);
  if (deleteMatch && req.method === 'DELETE') {
    const id = deleteMatch[1];
    const data = await loadHistory();
    const idx = data.entries.findIndex((e) => e.id === id);
    if (idx === -1) return jsonResponse({ error: 'Health analysis entry not found' }, 404);
    data.entries.splice(idx, 1);
    await saveHistory(data);
    log.info(`Health analysis deleted: ${id}`);
    return jsonResponse({ ok: true });
  }

  return null;
}
