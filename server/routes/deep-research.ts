// Deep Research routes — runs are background jobs the client starts + polls.
//
//   POST   /api/deep-research/run   { question, maxSearches? } → { id, status }
//   GET    /api/deep-research        → { runs: [summary...] }   (history)
//   GET    /api/deep-research/:id     → the full run (status + report + sources)
//   DELETE /api/deep-research/:id     → remove a run

import { jsonResponse } from '../data.js';
import { readJsonBody } from '../http.js';
import { startResearchRun, getRun, listRuns, deleteRun } from '../deep-research-store.js';
import { renderReportHtml } from '../deep-research-report.js';
import type { ResearchAttachment } from '../deep-research.js';

const RESEARCH_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10MB, matching the chat composer
const MAX_ATTACHMENTS = 8;

/** Validate client-supplied attachments — enforce image mime + size server-side
 *  rather than trusting the request. Base64 is ~4/3 the raw byte size. */
function parseAttachments(raw: unknown): ResearchAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: ResearchAttachment[] = [];
  for (const item of raw.slice(0, MAX_ATTACHMENTS)) {
    if (!item || typeof item !== 'object') continue;
    const { mimeType, dataUrl } = item as { mimeType?: unknown; dataUrl?: unknown };
    if (typeof mimeType !== 'string' || !RESEARCH_IMAGE_MIMES.has(mimeType)) continue;
    if (typeof dataUrl !== 'string') continue;
    const m = dataUrl.match(/^data:[^;]+;base64,(.+)$/s);
    if (!m) continue;
    // Approximate decoded size from the base64 length (3 bytes per 4 chars).
    if (Math.floor((m[1].length * 3) / 4) > MAX_ATTACHMENT_BYTES) continue;
    out.push({ mimeType, dataUrl });
  }
  return out;
}

export async function handleDeepResearchRoutes(
  req: Request,
  _url: URL,
  pathname: string
): Promise<Response | null> {
  if (!pathname.startsWith('/api/deep-research')) return null;

  // POST /api/deep-research/run — start a run, return its id immediately
  if (pathname === '/api/deep-research/run' && req.method === 'POST') {
    const body = await readJsonBody<{
      question?: unknown;
      maxSearches?: unknown;
      attachments?: unknown;
    }>(req).catch((): { question?: unknown; maxSearches?: unknown; attachments?: unknown } => ({}));
    const rawQuestion = typeof body.question === 'string' ? body.question.trim() : '';
    const attachments = parseAttachments(body.attachments);
    // A question OR an image is enough — an image-only run means "what is this?".
    if (!rawQuestion && attachments.length === 0) {
      return jsonResponse({ error: 'question or an image attachment is required' }, 400);
    }
    // An image with no text gets a default instruction so the model has a task
    // and the history rail has a non-blank label.
    const question = rawQuestion || 'Identify what this image shows, then research it thoroughly.';
    const requested = typeof body.maxSearches === 'number' ? body.maxSearches : 18;
    const maxSearches = Math.min(Math.max(Math.round(requested), 1), 30);
    const id = await startResearchRun(question, maxSearches, attachments);
    return jsonResponse({ id, status: 'running' }, 201);
  }

  // GET /api/deep-research — history
  if (pathname === '/api/deep-research' && req.method === 'GET') {
    return jsonResponse({ runs: await listRuns() });
  }

  // GET /api/deep-research/:id/report.html — downloadable self-contained report
  const reportMatch = pathname.match(/^\/api\/deep-research\/([^/]+)\/report\.html$/);
  if (reportMatch && req.method === 'GET') {
    const run = await getRun(decodeURIComponent(reportMatch[1]));
    if (!run || run.status !== 'done') return jsonResponse({ error: 'no completed run' }, 404);
    const slug =
      run.question
        .slice(0, 40)
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-+|-+$/g, '') || 'research';
    return new Response(renderReportHtml(run), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename="${slug}.html"`,
      },
    });
  }

  // /api/deep-research/:id
  const match = pathname.match(/^\/api\/deep-research\/([^/]+)$/);
  if (match) {
    const id = decodeURIComponent(match[1]);
    if (req.method === 'GET') {
      const run = await getRun(id);
      return run ? jsonResponse(run) : jsonResponse({ error: 'not found' }, 404);
    }
    if (req.method === 'DELETE') {
      await deleteRun(id);
      return jsonResponse({ ok: true });
    }
  }

  return null;
}
