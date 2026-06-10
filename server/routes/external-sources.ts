// HTTP routes for External Sources — git repos of markdown that DocVault clones
// into DATA_DIR/.external-sources/ and exposes to the UI + Chat.
//
//   GET    /api/external-sources           list sources + whether a token is set
//   POST   /api/external-sources           add a source { name?, url, branch? }
//   PUT    /api/external-sources/token      set/clear the GitHub token { token }
//   POST   /api/external-sources/:id/sync   clone or pull one source
//   DELETE /api/external-sources/:id        remove a source + its working tree
//
// The GitHub token is stored encrypted (Settings.externalSources.githubToken)
// and is NEVER returned to the client — only a `tokenConfigured` boolean.

import { loadSettings, saveSettings, jsonResponse } from '../data.js';
import type { ExternalRepo, ExternalSourcesConfig } from '../data.js';
import { readJsonBody } from '../http.js';
import {
  listSourceFiles,
  normalizeRepoUrl,
  readSourceFile,
  removeRepoDir,
  syncRepo,
} from '../external-sources.js';

function emptyConfig(): ExternalSourcesConfig {
  return { repos: [] };
}

/** Friendly default name from a clone URL, e.g. "owner/repo". */
function deriveNameFromUrl(url: string): string {
  try {
    const parts = new URL(url).pathname
      .replace(/\.git$/, '')
      .split('/')
      .filter(Boolean);
    if (parts.length >= 2) return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
    return parts[parts.length - 1] || url;
  } catch {
    return url;
  }
}

export async function handleExternalSourcesRoutes(
  req: Request,
  url: URL,
  pathname: string
): Promise<Response | null> {
  if (pathname !== '/api/external-sources' && !pathname.startsWith('/api/external-sources/')) {
    return null;
  }

  // GET /api/external-sources — list sources (the token never leaves the server)
  if (pathname === '/api/external-sources' && req.method === 'GET') {
    const settings = await loadSettings();
    const cfg = settings.externalSources ?? emptyConfig();
    return jsonResponse({ repos: cfg.repos, tokenConfigured: !!cfg.githubToken });
  }

  // POST /api/external-sources — add a source
  if (pathname === '/api/external-sources' && req.method === 'POST') {
    const body = await readJsonBody<{ url?: string; name?: string; branch?: string }>(req).catch(
      (): { url?: string; name?: string; branch?: string } => ({})
    );
    if (!body.url || typeof body.url !== 'string') {
      return jsonResponse({ error: 'url is required' }, 400);
    }
    let cleanUrl: string;
    try {
      cleanUrl = normalizeRepoUrl(body.url);
    } catch (err) {
      return jsonResponse({ error: (err as Error).message }, 400);
    }
    const settings = await loadSettings();
    const cfg = settings.externalSources ?? emptyConfig();
    if (cfg.repos.some((r) => r.url === cleanUrl)) {
      return jsonResponse({ error: 'That repository is already a source' }, 409);
    }
    const repo: ExternalRepo = {
      id: crypto.randomUUID(),
      name: (typeof body.name === 'string' && body.name.trim()) || deriveNameFromUrl(cleanUrl),
      url: cleanUrl,
      branch:
        typeof body.branch === 'string' && body.branch.trim() ? body.branch.trim() : undefined,
      enabled: true,
      lastError: null,
    };
    cfg.repos.push(repo);
    settings.externalSources = cfg;
    await saveSettings(settings);
    return jsonResponse(repo, 201);
  }

  // PUT /api/external-sources/token — set or clear the GitHub token
  if (pathname === '/api/external-sources/token' && req.method === 'PUT') {
    const body = await readJsonBody<{ token?: string }>(req).catch((): { token?: string } => ({}));
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    const settings = await loadSettings();
    const cfg = settings.externalSources ?? emptyConfig();
    cfg.githubToken = token || undefined;
    settings.externalSources = cfg;
    await saveSettings(settings);
    return jsonResponse({ tokenConfigured: !!cfg.githubToken });
  }

  // GET /api/external-sources/:id/files — list markdown file paths in a source
  const filesMatch = pathname.match(/^\/api\/external-sources\/([^/]+)\/files$/);
  if (filesMatch && req.method === 'GET') {
    const id = decodeURIComponent(filesMatch[1]);
    const settings = await loadSettings();
    const repo = (settings.externalSources?.repos ?? []).find((r) => r.id === id);
    if (!repo) return jsonResponse({ error: 'Source not found' }, 404);
    return jsonResponse({ id, name: repo.name, files: await listSourceFiles(id) });
  }

  // GET /api/external-sources/:id/file?path=… — read one markdown file
  const fileMatch = pathname.match(/^\/api\/external-sources\/([^/]+)\/file$/);
  if (fileMatch && req.method === 'GET') {
    const id = decodeURIComponent(fileMatch[1]);
    const relPath = url.searchParams.get('path') ?? '';
    if (!relPath) return jsonResponse({ error: 'path query param is required' }, 400);
    const settings = await loadSettings();
    const repo = (settings.externalSources?.repos ?? []).find((r) => r.id === id);
    if (!repo) return jsonResponse({ error: 'Source not found' }, 404);
    try {
      const file = await readSourceFile(id, relPath);
      return jsonResponse({ id, name: repo.name, ...file });
    } catch (err) {
      return jsonResponse({ error: (err as Error).message }, 400);
    }
  }

  // /api/external-sources/:id  and  /api/external-sources/:id/sync
  const match = pathname.match(/^\/api\/external-sources\/([^/]+?)(\/sync)?$/);
  if (match) {
    const id = decodeURIComponent(match[1]);
    const isSync = Boolean(match[2]);
    const settings = await loadSettings();
    const cfg = settings.externalSources ?? emptyConfig();
    const repo = cfg.repos.find((r) => r.id === id);
    if (!repo) return jsonResponse({ error: 'Source not found' }, 404);

    // POST /api/external-sources/:id/sync — clone or pull
    if (isSync && req.method === 'POST') {
      try {
        const result = await syncRepo(repo, { token: cfg.githubToken });
        repo.commit = result.commit;
        repo.fileCount = result.fileCount;
        repo.lastSyncedAt = new Date().toISOString();
        repo.lastError = null;
      } catch (err) {
        // Message is already token-redacted by external-sources.ts.
        repo.lastError = (err as Error).message;
      }
      settings.externalSources = cfg;
      await saveSettings(settings);
      return jsonResponse(repo);
    }

    // DELETE /api/external-sources/:id — remove source + working tree
    if (!isSync && req.method === 'DELETE') {
      cfg.repos = cfg.repos.filter((r) => r.id !== id);
      settings.externalSources = cfg;
      await saveSettings(settings);
      await removeRepoDir(id);
      return jsonResponse({ ok: true });
    }
  }

  return null;
}
