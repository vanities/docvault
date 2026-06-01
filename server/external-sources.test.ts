// Tests for server/external-sources.ts
//
// Committed to git (exception in .gitignore, same pattern as crypto-keys.test.ts):
// the URL/token/sync logic is generic infrastructure with no personal data. The
// integration tests clone a throwaway local `file://` repo — no network, no
// real GitHub, fully hermetic.

import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  countMarkdown,
  gitAuthEnv,
  listSourceFiles,
  normalizeRepoUrl,
  readSourceFile,
  redactToken,
  repoDir,
  searchMarkdown,
  syncRepo,
} from './external-sources.js';

const execFileAsync = promisify(execFile);

/** Run git inside `cwd` with a deterministic identity (no global config needed). */
async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  });
}

describe('normalizeRepoUrl', () => {
  test('strips embedded credentials', () => {
    expect(normalizeRepoUrl('https://user:tok@github.com/o/r.git')).toBe(
      'https://github.com/o/r.git'
    );
  });

  test('trims surrounding whitespace', () => {
    expect(normalizeRepoUrl('  https://github.com/o/r.git  ')).toBe('https://github.com/o/r.git');
  });

  test('rejects ssh and http URLs', () => {
    expect(() => normalizeRepoUrl('git@github.com:o/r.git')).toThrow();
    expect(() => normalizeRepoUrl('http://github.com/o/r.git')).toThrow(/https/);
  });

  test('rejects malformed input', () => {
    expect(() => normalizeRepoUrl('not a url')).toThrow(/Invalid/);
  });
});

describe('redactToken', () => {
  test('redacts every occurrence', () => {
    expect(redactToken('a SECRET b SECRET c', 'SECRET')).toBe('a *** b *** c');
  });

  test('is a no-op without a token', () => {
    expect(redactToken('unchanged', undefined)).toBe('unchanged');
  });
});

describe('gitAuthEnv', () => {
  test('returns an empty object without a token', () => {
    expect(gitAuthEnv('https://github.com/o/r.git')).toEqual({});
  });

  test('injects a URL-scoped Authorization header, token never verbatim', () => {
    const env = gitAuthEnv('https://github.com/o/r.git', 'ghp_TESTTOKEN');
    expect(env.GIT_CONFIG_COUNT).toBe('1');
    expect(env.GIT_CONFIG_KEY_0).toBe('http.https://github.com/o/r.git.extraHeader');
    expect(env.GIT_CONFIG_VALUE_0).toMatch(/^Authorization: Basic /);
    // Raw token must not appear; it is base64'd inside a Basic credential.
    expect(env.GIT_CONFIG_VALUE_0).not.toContain('ghp_TESTTOKEN');
    const b64 = env.GIT_CONFIG_VALUE_0.replace('Authorization: Basic ', '');
    expect(Buffer.from(b64, 'base64').toString()).toBe('x-access-token:ghp_TESTTOKEN');
  });
});

describe('syncRepo (integration, local file:// repo)', () => {
  let tmp: string;
  let srcDir: string;
  let baseDir: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'extsrc-'));
    srcDir = path.join(tmp, 'src');
    baseDir = path.join(tmp, 'clones');
    await fs.mkdir(srcDir, { recursive: true });
    await git(srcDir, 'init', '-b', 'main');
    await fs.writeFile(path.join(srcDir, 'README.md'), '# Hello\n');
    await fs.mkdir(path.join(srcDir, 'notes'), { recursive: true });
    await fs.writeFile(path.join(srcDir, 'notes', 'a.md'), '# A\n');
    await fs.writeFile(path.join(srcDir, 'ignore.txt'), 'not markdown\n');
    await git(srcDir, 'add', '-A');
    await git(srcDir, 'commit', '-m', 'initial');
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test('clones a repo and counts only markdown files', async () => {
    const repo = { id: 'vault', name: 'Vault', url: `file://${srcDir}`, enabled: true };
    const res = await syncRepo(repo, { baseDir });
    expect(res.fileCount).toBe(2); // README.md + notes/a.md, not ignore.txt
    expect(res.commit).toMatch(/^[0-9a-f]{7,}$/);
    const cloned = await fs.readFile(path.join(repoDir('vault', baseDir), 'README.md'), 'utf-8');
    expect(cloned).toBe('# Hello\n');
  });

  test('pulls new commits on a second sync', async () => {
    const repo = { id: 'vault', name: 'Vault', url: `file://${srcDir}`, enabled: true };
    const first = await syncRepo(repo, { baseDir });
    await fs.writeFile(path.join(srcDir, 'notes', 'b.md'), '# B\n');
    await git(srcDir, 'add', '-A');
    await git(srcDir, 'commit', '-m', 'add b');
    const second = await syncRepo(repo, { baseDir });
    expect(second.fileCount).toBe(3);
    expect(second.commit).not.toBe(first.commit);
  });

  test('never writes the token into the cloned repo .git/config', async () => {
    const repo = { id: 'vault', name: 'Vault', url: `file://${srcDir}`, enabled: true };
    await syncRepo(repo, { baseDir, token: 'ghp_SHOULD_NOT_PERSIST' });
    const cfg = await fs.readFile(path.join(repoDir('vault', baseDir), '.git', 'config'), 'utf-8');
    expect(cfg).not.toContain('ghp_SHOULD_NOT_PERSIST');
    expect(cfg).not.toContain('x-access-token');
  });
});

describe('countMarkdown', () => {
  test('returns 0 for a missing directory', async () => {
    expect(await countMarkdown('/no/such/dir/anywhere')).toBe(0);
  });
});

describe('searchMarkdown + readSourceFile', () => {
  let tmp: string;
  let baseDir: string;
  const id = 'vault';

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'extsrc-rs-'));
    baseDir = path.join(tmp, 'clones');
    const repo = path.join(baseDir, id);
    await fs.mkdir(path.join(repo, 'notes'), { recursive: true });
    await fs.writeFile(path.join(repo, 'README.md'), '# Vault\nApples and oranges\n');
    await fs.writeFile(
      path.join(repo, 'notes', 'fruit.md'),
      'line one\nbananas are yellow\nApples again\n'
    );
    await fs.writeFile(path.join(repo, 'notes', 'ignore.txt'), 'apples here but not markdown\n');
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test('finds case-insensitive matches across markdown files only', async () => {
    const hits = await searchMarkdown([{ id, name: 'Vault' }], 'apples', { baseDir });
    // "Apples and oranges" + "Apples again" = 2 hits; the .txt is excluded.
    expect(hits.length).toBe(2);
    expect(hits.every((h) => h.path.endsWith('.md'))).toBe(true);
    expect(hits.map((h) => h.text)).toContain('Apples and oranges');
  });

  test('respects maxResults', async () => {
    const hits = await searchMarkdown([{ id, name: 'Vault' }], 'a', { baseDir, maxResults: 1 });
    expect(hits.length).toBe(1);
  });

  test('readSourceFile returns markdown content', async () => {
    const res = await readSourceFile(id, 'notes/fruit.md', { baseDir });
    expect(res.content).toContain('bananas are yellow');
    expect(res.truncated).toBe(false);
  });

  test('readSourceFile blocks path traversal', async () => {
    await expect(readSourceFile(id, '../../etc/passwd', { baseDir })).rejects.toThrow(/escapes/);
  });

  test('readSourceFile rejects non-markdown files', async () => {
    await expect(readSourceFile(id, 'notes/ignore.txt', { baseDir })).rejects.toThrow(/markdown/);
  });

  test('listSourceFiles returns sorted markdown paths only', async () => {
    const files = await listSourceFiles(id, { baseDir });
    // localeCompare is case-insensitive primary, so "notes" (n) sorts before "README" (r).
    expect(files).toEqual(['notes/fruit.md', 'README.md']);
  });
});
