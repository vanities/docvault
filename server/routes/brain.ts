// HTTP routes for the DocVault Brain — the user-owned markdown long-term memory
// surfaced in Settings → Brain and always given to the chat assistant.
//
//   GET    /api/brain          read the brain { content, bytes, updatedAt, exists }
//   PUT    /api/brain          replace the whole brain { content }
//   DELETE /api/brain          clear the brain (equivalent to PUT with '')
//   POST   /api/brain/append   append one entry { text, tag? }

import { jsonResponse } from '../data.js';
import { readBrain, writeBrain, appendBrainEntry } from '../brain.js';
import { readJsonBody } from '../http.js';

export async function handleBrainRoutes(
  req: Request,
  _url: URL,
  pathname: string
): Promise<Response | null> {
  if (pathname !== '/api/brain' && pathname !== '/api/brain/append') return null;

  if (pathname === '/api/brain') {
    if (req.method === 'GET') {
      return jsonResponse(await readBrain());
    }
    if (req.method === 'PUT') {
      const body = await readJsonBody<{ content?: string }>(req).catch(
        (): { content?: string } => ({})
      );
      if (typeof body.content !== 'string') {
        return jsonResponse({ error: 'content (string) is required' }, 400);
      }
      return jsonResponse(await writeBrain(body.content));
    }
    if (req.method === 'DELETE') {
      return jsonResponse(await writeBrain(''));
    }
  }

  if (pathname === '/api/brain/append' && req.method === 'POST') {
    const body = await readJsonBody<{ text?: string; tag?: string }>(req).catch(
      (): { text?: string; tag?: string } => ({})
    );
    const text = typeof body.text === 'string' ? body.text : '';
    if (!text.trim()) {
      return jsonResponse({ error: 'text (non-empty string) is required' }, 400);
    }
    const tag = typeof body.tag === 'string' ? body.tag : undefined;
    try {
      return jsonResponse(await appendBrainEntry(text, { tag }));
    } catch (err) {
      return jsonResponse({ error: (err as Error).message }, 400);
    }
  }

  return null;
}
