import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { expect, test, describe, vi } from 'vite-plus/test';

// Vi.hoisted fires before the import graph resolves — points SETTINGS_PATH
// (and everything else derived from DATA_DIR) at a tmpdir. Without it the
// settings-persistence tests unlink and rewrite the real local settings file.
vi.hoisted(() => {
  const p = require('path') as typeof import('path');
  const o = require('os') as typeof import('os');
  const f = require('fs') as typeof import('fs');
  const dir = p.join(o.tmpdir(), `docvault-data-test-${Date.now()}`);
  f.mkdirSync(dir, { recursive: true });
  process.env.DOCVAULT_DATA_DIR = dir;
  return dir;
});

import {
  getMimeType,
  loadSettings,
  monthsBetween,
  jsonResponse,
  corsHeaders,
  resolveUnder,
  saveSettings,
  scanDirectory,
  createSession,
  isValidSession,
  getSessionToken,
  sessionCookie,
  sessions,
  SESSION_COOKIE,
  SETTINGS_PATH,
  parseAuthConfig,
} from './data.js';

// --- getMimeType ---

describe('getMimeType', () => {
  test('returns correct MIME for common file types', () => {
    expect(getMimeType('document.pdf')).toBe('application/pdf');
    expect(getMimeType('photo.png')).toBe('image/png');
    expect(getMimeType('photo.jpg')).toBe('image/jpeg');
    expect(getMimeType('photo.jpeg')).toBe('image/jpeg');
    expect(getMimeType('animation.gif')).toBe('image/gif');
    expect(getMimeType('image.webp')).toBe('image/webp');
    expect(getMimeType('data.csv')).toBe('text/csv');
    expect(getMimeType('spreadsheet.xlsx')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(getMimeType('page.html')).toBe('text/html');
    expect(getMimeType('data.json')).toBe('application/json');
    expect(getMimeType('file.txt')).toBe('text/plain');
  });

  test('returns octet-stream for unknown extensions', () => {
    expect(getMimeType('file.xyz')).toBe('application/octet-stream');
    expect(getMimeType('file.unknown')).toBe('application/octet-stream');
  });

  test('handles uppercase extensions', () => {
    // getMimeType lowercases the extension
    expect(getMimeType('FILE.PDF')).toBe('application/pdf');
    expect(getMimeType('FILE.PNG')).toBe('image/png');
  });

  test('handles no extension', () => {
    expect(getMimeType('README')).toBe('application/octet-stream');
  });

  test('handles office document formats', () => {
    expect(getMimeType('file.doc')).toBe('application/msword');
    expect(getMimeType('file.docx')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
  });

  test('handles font types', () => {
    expect(getMimeType('font.woff')).toBe('font/woff');
    expect(getMimeType('font.woff2')).toBe('font/woff2');
    expect(getMimeType('font.ttf')).toBe('font/ttf');
  });

  test('handles Apple iWork formats', () => {
    expect(getMimeType('file.numbers')).toBe('application/x-iwork-numbers-sffnumbers');
    expect(getMimeType('file.pages')).toBe('application/x-iwork-pages-sffpages');
  });
});

// --- monthsBetween ---

describe('resolveUnder', () => {
  test('resolves normal relative paths under the base directory', () => {
    expect(resolveUnder('/tmp/docvault/personal', '2026/receipt.pdf')).toBe(
      '/tmp/docvault/personal/2026/receipt.pdf'
    );
  });

  test('allows the base directory itself', () => {
    expect(resolveUnder('/tmp/docvault/personal', '.')).toBe('/tmp/docvault/personal');
  });

  test('rejects traversal into sibling-prefix directories', () => {
    expect(resolveUnder('/tmp/docvault/personal', '../personal2/file.pdf')).toBeNull();
    expect(resolveUnder('/tmp/docvault/personal', '../../docvault-personal/file.pdf')).toBeNull();
  });

  test('rejects absolute paths outside the base directory', () => {
    expect(resolveUnder('/tmp/docvault/personal', '/tmp/docvault/personal2/file.pdf')).toBeNull();
  });
});

describe('scanDirectory symlink handling', () => {
  test('skips symlinked files and directories instead of following them', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'docvault-scan-symlink-'));
    const outside = await mkdtemp(path.join(os.tmpdir(), 'docvault-scan-outside-'));
    try {
      await mkdir(path.join(root, 'docs'), { recursive: true });
      await writeFile(path.join(root, 'docs', 'safe.txt'), 'safe');
      await writeFile(path.join(outside, 'secret.txt'), 'secret');
      await symlink(path.join(outside, 'secret.txt'), path.join(root, 'docs', 'linked-secret.txt'));
      await symlink(outside, path.join(root, 'docs', 'linked-dir'));

      const files = await scanDirectory(path.join(root, 'docs'), 'docs');

      expect(files.map((f) => f.path).sort()).toEqual(['docs/safe.txt']);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe('settings persistence reliability', () => {
  test('loadSettings returns empty only when the settings file is absent', async () => {
    await rm(SETTINGS_PATH, { force: true });
    await expect(loadSettings()).resolves.toEqual({});
  });

  test('loadSettings throws on malformed JSON instead of silently resetting settings', async () => {
    await mkdir(path.dirname(SETTINGS_PATH), { recursive: true });
    await writeFile(SETTINGS_PATH, '{not json');

    await expect(loadSettings()).rejects.toThrow();
  });

  test('saveSettings writes through a temp file and leaves no temp artifacts', async () => {
    await rm(SETTINGS_PATH, { force: true });

    await saveSettings({ claudeModel: 'test-model' });

    expect(JSON.parse(await readFile(SETTINGS_PATH, 'utf8'))).toMatchObject({
      claudeModel: 'test-model',
    });
    const files = await readdir(path.dirname(SETTINGS_PATH));
    expect(files.filter((name) => name.includes('.docvault-settings.json.tmp'))).toEqual([]);
  });
});

// --- monthsBetween ---

describe('monthsBetween', () => {
  test('same month returns 0', () => {
    expect(monthsBetween('2025-01', '2025-01')).toBe(0);
  });

  test('one month apart', () => {
    expect(monthsBetween('2025-01', '2025-02')).toBe(1);
  });

  test('across years', () => {
    expect(monthsBetween('2024-11', '2025-02')).toBe(3);
  });

  test('full year', () => {
    expect(monthsBetween('2024-01', '2025-01')).toBe(12);
  });

  test('negative result for reversed dates', () => {
    expect(monthsBetween('2025-06', '2025-01')).toBe(-5);
  });

  test('multi-year span', () => {
    expect(monthsBetween('2023-01', '2026-03')).toBe(38);
  });
});

// --- jsonResponse ---

describe('jsonResponse', () => {
  test('returns JSON with CORS headers', () => {
    const res = jsonResponse({ foo: 'bar' });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  test('respects custom status code', () => {
    const res = jsonResponse({ error: 'not found' }, 404);
    expect(res.status).toBe(404);
  });

  test('body is valid JSON', async () => {
    const res = jsonResponse({ test: 123 });
    const body = await res.json();
    expect(body.test).toBe(123);
  });
});

// --- corsHeaders ---

describe('corsHeaders', () => {
  test('returns expected CORS headers', () => {
    const headers = corsHeaders();
    expect(headers['Access-Control-Allow-Origin']).toBe('*');
    expect(headers['Access-Control-Allow-Methods']).toContain('GET');
    expect(headers['Access-Control-Allow-Methods']).toContain('POST');
    expect(headers['Access-Control-Allow-Methods']).toContain('PUT');
    expect(headers['Access-Control-Allow-Methods']).toContain('DELETE');
    expect(headers['Access-Control-Allow-Headers']).toContain('Content-Type');
  });
});

// --- Authentication config ---

describe('parseAuthConfig', () => {
  test('requires authentication at startup when no password and no explicit unauthenticated opt-in are configured', () => {
    const cfg = parseAuthConfig({});

    expect(cfg.enabled).toBe(false);
    expect(cfg.allowUnauthenticated).toBe(false);
    expect(cfg.startupAllowed).toBe(false);
    expect(cfg.startupError).toContain('DOCVAULT_PASSWORD');
  });

  test('enables auth with default admin username when only DOCVAULT_PASSWORD is configured', () => {
    const cfg = parseAuthConfig({ DOCVAULT_PASSWORD: 'dev-password' });

    expect(cfg.enabled).toBe(true);
    expect(cfg.username).toBe('admin');
    expect(cfg.password).toBe('dev-password');
    expect(cfg.startupAllowed).toBe(true);
  });

  test('allows unauthenticated mode only with explicit opt-in', () => {
    const cfg = parseAuthConfig({ DOCVAULT_ALLOW_UNAUTHENTICATED: 'true' });

    expect(cfg.enabled).toBe(false);
    expect(cfg.allowUnauthenticated).toBe(true);
    expect(cfg.startupAllowed).toBe(true);
  });
});

// --- Session Management ---

describe('createSession', () => {
  test('creates a valid UUID token', () => {
    const token = createSession();
    expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  test('creates unique tokens', () => {
    const token1 = createSession();
    const token2 = createSession();
    expect(token1).not.toBe(token2);
  });

  test('token is stored in sessions map', () => {
    const token = createSession();
    expect(sessions.has(token)).toBe(true);
  });
});

describe('isValidSession', () => {
  test('returns true for valid, unexpired session', () => {
    const token = createSession();
    expect(isValidSession(token)).toBe(true);
  });

  test('returns false for unknown token', () => {
    expect(isValidSession('nonexistent-token')).toBe(false);
  });

  test('returns false for expired session', () => {
    const token = 'expired-test-token';
    sessions.set(token, Date.now() - 1000); // expired 1 second ago
    expect(isValidSession(token)).toBe(false);
    // Should also clean up the expired session
    expect(sessions.has(token)).toBe(false);
  });
});

describe('getSessionToken', () => {
  test('extracts token from cookie header', () => {
    const req = new Request('http://localhost', {
      headers: { cookie: `${SESSION_COOKIE}=abc123; other=def456` },
    });
    expect(getSessionToken(req)).toBe('abc123');
  });

  test('returns null when no cookie header', () => {
    const req = new Request('http://localhost');
    expect(getSessionToken(req)).toBeNull();
  });

  test('returns null when session cookie not present', () => {
    const req = new Request('http://localhost', {
      headers: { cookie: 'other_cookie=value' },
    });
    expect(getSessionToken(req)).toBeNull();
  });
});

describe('sessionCookie', () => {
  test('generates valid cookie string', () => {
    const cookie = sessionCookie('test-token');
    expect(cookie).toContain(`${SESSION_COOKIE}=test-token`);
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Max-Age=');
  });

  test('respects custom maxAge', () => {
    const cookie = sessionCookie('token', 3600);
    expect(cookie).toContain('Max-Age=3600');
  });
});
