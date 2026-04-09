// Account annotation route handlers — overlay metadata (rates, types) on SimpleFIN accounts.

import { promises as fs } from 'fs';
import {
  loadAccountAnnotations,
  saveAccountAnnotations,
  SIMPLEFIN_CACHE_FILE,
  jsonResponse,
} from '../data.js';
import type { AccountAnnotation } from '../data.js';

export async function handleAccountAnnotationRoutes(
  req: Request,
  _url: URL,
  pathname: string
): Promise<Response | null> {
  // GET /api/account-annotations - Get all annotations (optionally merged with SimpleFIN accounts)
  if (pathname === '/api/account-annotations' && req.method === 'GET') {
    const annotations = await loadAccountAnnotations();
    return jsonResponse(annotations);
  }

  // GET /api/account-annotations/merged - Annotations merged with SimpleFIN account data
  if (pathname === '/api/account-annotations/merged' && req.method === 'GET') {
    const annotations = await loadAccountAnnotations();
    let simplefinAccounts: {
      id: string;
      name: string;
      balance: number;
      connectionName?: string;
    }[] = [];
    try {
      const raw = await fs.readFile(SIMPLEFIN_CACHE_FILE, 'utf-8');
      const cache = JSON.parse(raw);
      simplefinAccounts = cache.accounts || [];
    } catch {
      /* no SimpleFIN data */
    }

    const merged = simplefinAccounts.map((account) => ({
      ...account,
      annotation: annotations[account.id] || null,
    }));

    return jsonResponse({ accounts: merged });
  }

  // PUT /api/account-annotations/:accountId - Set/update annotation for an account
  const updateMatch = pathname.match(/^\/api\/account-annotations\/([^/]+)$/);
  if (updateMatch && req.method === 'PUT') {
    const accountId = decodeURIComponent(updateMatch[1]);
    const body: AccountAnnotation = await req.json();

    const annotations = await loadAccountAnnotations();
    annotations[accountId] = {
      ...annotations[accountId],
      ...body,
    };

    // Clean up undefined/null fields
    const annotation = annotations[accountId];
    for (const [key, value] of Object.entries(annotation)) {
      if (value === null || value === undefined) {
        delete (annotation as Record<string, unknown>)[key];
      }
    }

    await saveAccountAnnotations(annotations);
    return jsonResponse({ ok: true, annotation: annotations[accountId] });
  }

  // DELETE /api/account-annotations/:accountId - Remove annotation for an account
  const deleteMatch = pathname.match(/^\/api\/account-annotations\/([^/]+)$/);
  if (deleteMatch && req.method === 'DELETE') {
    const accountId = decodeURIComponent(deleteMatch[1]);
    const annotations = await loadAccountAnnotations();
    if (!annotations[accountId]) {
      return jsonResponse({ error: 'Annotation not found' }, 404);
    }
    delete annotations[accountId];
    await saveAccountAnnotations(annotations);
    return jsonResponse({ ok: true });
  }

  return null;
}
