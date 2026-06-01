// Deep Research routes. Phase 1: run a research question and return the report.
// (Storage + history come next.)
//
//   POST /api/deep-research/run   { question, maxSearches? } → { report, sources, ... }

import { jsonResponse } from '../data.js';
import { runDeepResearch } from '../deep-research.js';

export async function handleDeepResearchRoutes(
  req: Request,
  _url: URL,
  pathname: string
): Promise<Response | null> {
  if (pathname === '/api/deep-research/run' && req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const question = typeof body.question === 'string' ? body.question.trim() : '';
    if (!question) return jsonResponse({ error: 'question is required' }, 400);
    const maxSearches = typeof body.maxSearches === 'number' ? body.maxSearches : undefined;
    try {
      return jsonResponse(await runDeepResearch(question, { maxSearches }));
    } catch (err) {
      return jsonResponse({ error: (err as Error).message }, 500);
    }
  }
  return null;
}
