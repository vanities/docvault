// Deep Research routes — runs are background jobs the client starts + polls.
//
//   POST   /api/deep-research/run   { question, maxSearches? } → { id, status }
//   GET    /api/deep-research        → { runs: [summary...] }   (history)
//   GET    /api/deep-research/:id     → the full run (status + report + sources)
//   DELETE /api/deep-research/:id     → remove a run

import { jsonResponse } from '../data.js';
import { startResearchRun, getRun, listRuns, deleteRun } from '../deep-research-store.js';
import { renderReportHtml } from '../deep-research-report.js';

export async function handleDeepResearchRoutes(
  req: Request,
  _url: URL,
  pathname: string
): Promise<Response | null> {
  if (!pathname.startsWith('/api/deep-research')) return null;

  // POST /api/deep-research/run — start a run, return its id immediately
  if (pathname === '/api/deep-research/run' && req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const question = typeof body.question === 'string' ? body.question.trim() : '';
    if (!question) return jsonResponse({ error: 'question is required' }, 400);
    const requested = typeof body.maxSearches === 'number' ? body.maxSearches : 18;
    const maxSearches = Math.min(Math.max(Math.round(requested), 1), 30);
    const id = await startResearchRun(question, maxSearches);
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
