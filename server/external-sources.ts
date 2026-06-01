// External Sources — clone git repositories of markdown into the data dir and
// expose them to the UI + Chat. Phase 1: the clone/pull engine + markdown
// indexing. Full-text search + Chat tools build on countMarkdown later.
//
// SECURITY MODEL
//   The GitHub token is handed to git per-invocation as an HTTP Authorization
//   header injected through GIT_CONFIG_* env vars — NOT embedded in the clone
//   URL. Consequences:
//     - The cloned repo's .git/config keeps the clean, credential-free remote,
//       so the token never leaks into the Dropbox mirror of DATA_DIR.
//     - The token never appears in process argv (visible via `ps`).
//     - All git stdout/stderr is token-redacted before it is surfaced or logged.

import { promises as fs, type Dirent } from 'fs';
import path from 'path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DATA_DIR } from './data.js';
import type { ExternalRepo } from './data.js';
import { createLogger } from './logger.js';

const execFileAsync = promisify(execFile);
const log = createLogger('ExternalSources');

/**
 * Working trees live here, one subdir per repo id. Under DATA_DIR so they
 * persist across container restarts (the only mounted volume).
 */
export const EXTERNAL_SOURCES_DIR = path.join(DATA_DIR, '.external-sources');

export interface SyncResult {
  commit: string;
  fileCount: number;
}

/** On-disk working-tree path for a repo id. */
export function repoDir(id: string, baseDir: string = EXTERNAL_SOURCES_DIR): string {
  return path.join(baseDir, id);
}

/**
 * Validate + normalize a user-supplied URL to a clean HTTPS clone URL with no
 * embedded credentials. Called at the boundary (when a source is added), so
 * everything stored and synced downstream is already clean. Throws on non-https
 * or malformed input.
 */
export function normalizeRepoUrl(input: string): string {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    throw new Error('Invalid repository URL');
  }
  if (u.protocol !== 'https:') {
    throw new Error('Only https:// repository URLs are supported');
  }
  u.username = '';
  u.password = '';
  return u.toString();
}

/** Redact every occurrence of `token` in `s` (for safe logs + error surfacing). */
export function redactToken(s: string, token?: string): string {
  if (!token) return s;
  return s.split(token).join('***');
}

/**
 * Env vars that inject an `Authorization: Basic` header into git WITHOUT
 * writing the token to .git/config or exposing it in argv. Scoped to the repo
 * URL (`http.<url>.extraHeader`) so the header is not forwarded if the request
 * is redirected to a different host. Returns {} when no token is supplied.
 */
export function gitAuthEnv(url: string, token?: string): Record<string, string> {
  if (!token) return {};
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  return {
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: `http.${url}.extraHeader`,
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
  };
}

async function runGit(
  args: string[],
  opts: { env?: Record<string, string>; token?: string } = {}
): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      env: { ...process.env, ...(opts.env ?? {}) },
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    const detail = String(e.stderr || e.message || 'git command failed').trim();
    throw new Error(redactToken(detail, opts.token));
  }
}

/** Recursively count markdown files in a working tree, skipping .git. */
export async function countMarkdown(dir: string): Promise<number> {
  let n = 0;
  async function walk(d: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === '.git') continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.name.toLowerCase().endsWith('.md')) n++;
    }
  }
  await walk(dir);
  return n;
}

/**
 * Clone (first run) or pull (subsequent runs) a repo into baseDir/<id>. The
 * repo's URL is assumed already normalized (see normalizeRepoUrl). Returns the
 * synced short commit + markdown file count. Throws (token-redacted) on failure.
 */
export async function syncRepo(
  repo: ExternalRepo,
  opts: { token?: string; baseDir?: string } = {}
): Promise<SyncResult> {
  const baseDir = opts.baseDir ?? EXTERNAL_SOURCES_DIR;
  await fs.mkdir(baseDir, { recursive: true });
  const dir = repoDir(repo.id, baseDir);
  const env = gitAuthEnv(repo.url, opts.token);

  const isRepo = await fs
    .stat(path.join(dir, '.git'))
    .then((s) => s.isDirectory())
    .catch(() => false);

  if (!isRepo) {
    // Clear any stale partial dir left by a previously-failed clone.
    await fs.rm(dir, { recursive: true, force: true });
    const args = ['clone', '--depth', '1', '--single-branch'];
    if (repo.branch) args.push('--branch', repo.branch);
    args.push(repo.url, dir);
    await runGit(args, { env, token: opts.token });
  } else {
    const fetchArgs = ['-C', dir, 'fetch', '--depth', '1', 'origin'];
    if (repo.branch) fetchArgs.push(repo.branch);
    await runGit(fetchArgs, { env, token: opts.token });
    const ref = repo.branch ? `origin/${repo.branch}` : 'FETCH_HEAD';
    await runGit(['-C', dir, 'reset', '--hard', ref], { env, token: opts.token });
  }

  const commit = (await runGit(['-C', dir, 'rev-parse', '--short', 'HEAD'])).trim();
  const fileCount = await countMarkdown(dir);
  log.info(`Synced "${repo.name}" @ ${commit} (${fileCount} markdown files)`);
  return { commit, fileCount };
}

/** Remove a repo's working tree from disk (on source removal). */
export async function removeRepoDir(
  id: string,
  baseDir: string = EXTERNAL_SOURCES_DIR
): Promise<void> {
  await fs.rm(repoDir(id, baseDir), { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Read + search (Phase 2: consumed by the Chat MCP tools)
// ---------------------------------------------------------------------------

export interface SourceSearchHit {
  sourceId: string;
  sourceName: string;
  /** Path relative to the repo root. */
  path: string;
  line: number;
  /** The matching line, trimmed and length-capped. */
  text: string;
}

/** Yield every markdown file in a working tree as {rel, full}, skipping .git. */
async function* walkMarkdownFiles(
  root: string,
  dir: string = root
): AsyncGenerator<{ rel: string; full: string }> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name === '.git') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      yield* walkMarkdownFiles(root, full);
    } else if (e.name.toLowerCase().endsWith('.md')) {
      yield { rel: path.relative(root, full), full };
    }
  }
}

/**
 * Case-insensitive substring search of markdown line content across the given
 * synced repos. Returns up to maxResults hits with file path + line number +
 * the matching line text.
 */
export async function searchMarkdown(
  repos: Array<Pick<ExternalRepo, 'id' | 'name'>>,
  query: string,
  opts: { baseDir?: string; maxResults?: number } = {}
): Promise<SourceSearchHit[]> {
  const baseDir = opts.baseDir ?? EXTERNAL_SOURCES_DIR;
  const maxResults = opts.maxResults ?? 50;
  const needle = query.toLowerCase();
  const hits: SourceSearchHit[] = [];
  for (const repo of repos) {
    const root = repoDir(repo.id, baseDir);
    for await (const file of walkMarkdownFiles(root)) {
      if (hits.length >= maxResults) return hits;
      let content: string;
      try {
        content = await fs.readFile(file.full, 'utf-8');
      } catch {
        continue;
      }
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(needle)) {
          hits.push({
            sourceId: repo.id,
            sourceName: repo.name,
            path: file.rel,
            line: i + 1,
            text: lines[i].trim().slice(0, 300),
          });
          if (hits.length >= maxResults) return hits;
        }
      }
    }
  }
  return hits;
}

/** List markdown file paths (relative to the repo root) in a synced source, sorted. */
export async function listSourceFiles(
  id: string,
  opts: { baseDir?: string } = {}
): Promise<string[]> {
  const baseDir = opts.baseDir ?? EXTERNAL_SOURCES_DIR;
  const root = repoDir(id, baseDir);
  const files: string[] = [];
  for await (const f of walkMarkdownFiles(root)) files.push(f.rel);
  files.sort((a, b) => a.localeCompare(b));
  return files;
}

const MAX_SOURCE_FILE_BYTES = 256 * 1024;

/**
 * Read a single markdown file from a synced repo, with a path-traversal guard.
 * Returns the (possibly truncated) content. Throws if the path escapes the repo
 * working tree or is not a .md file.
 */
export async function readSourceFile(
  id: string,
  relPath: string,
  opts: { baseDir?: string } = {}
): Promise<{ path: string; content: string; truncated: boolean }> {
  const baseDir = opts.baseDir ?? EXTERNAL_SOURCES_DIR;
  const root = repoDir(id, baseDir);
  const resolved = path.resolve(root, relPath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('Path escapes the source repository');
  }
  if (!resolved.toLowerCase().endsWith('.md')) {
    throw new Error('Only markdown (.md) files can be read');
  }
  const raw = await fs.readFile(resolved, 'utf-8');
  const truncated = raw.length > MAX_SOURCE_FILE_BYTES;
  return {
    path: relPath,
    content: truncated ? raw.slice(0, MAX_SOURCE_FILE_BYTES) : raw,
    truncated,
  };
}
