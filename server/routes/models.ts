// Model discovery route — lists the models a provider currently offers by
// querying its live /v1/models endpoint (cached 12h, with a known-current
// fallback). This is what keeps the model pickers fresh without code changes.
//
//   GET /api/models?provider=anthropic|openai[&refresh=1]
//        → { models: string[], source: 'live' | 'cache' | 'fallback' }

import { jsonResponse } from '../data.js';
import { listModels } from '../llm/models.js';

export async function handleModelsRoutes(
  req: Request,
  url: URL,
  pathname: string
): Promise<Response | null> {
  if (pathname !== '/api/models' || req.method !== 'GET') return null;

  const provider = url.searchParams.get('provider');
  if (provider !== 'anthropic' && provider !== 'openai') {
    return jsonResponse({ error: 'provider must be "anthropic" or "openai"' }, 400);
  }
  const refresh = url.searchParams.get('refresh') === '1';
  return jsonResponse(await listModels(provider, { refresh }));
}
