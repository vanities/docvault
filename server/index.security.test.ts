import { mkdir, readFile, rm, symlink, writeFile } from 'fs/promises';
import path from 'path';
import { beforeEach, describe, expect, test, vi } from 'vite-plus/test';

// Vi.hoisted fires before the import graph resolves — isolates this suite's
// synthetic fixtures (config/parsed/metadata + entity dirs) in a tmpdir.
// Without it these writes land in the real local ./data and wipe state.
vi.hoisted(() => {
  const p = require('path') as typeof import('path');
  const o = require('os') as typeof import('os');
  const f = require('fs') as typeof import('fs');
  const dir = p.join(o.tmpdir(), `docvault-index-security-${Date.now()}`);
  f.mkdirSync(dir, { recursive: true });
  process.env.DOCVAULT_DATA_DIR = dir;
  return dir;
});

import { handleRequest } from './index.js';
import { DATA_DIR, METADATA_FILE, PARSED_DATA_FILE } from './data.js';

async function resetDataDir(): Promise<void> {
  await rm(path.join(DATA_DIR, 'entity-a'), { recursive: true, force: true });
  await rm(path.join(DATA_DIR, 'entity-b'), { recursive: true, force: true });
  await rm(path.join(DATA_DIR, 'outside-secret.txt'), { force: true });
  await mkdir(path.join(DATA_DIR, 'entity-a', '2026'), { recursive: true });
  await mkdir(path.join(DATA_DIR, 'entity-b', 'docs'), { recursive: true });
  await writeFile(
    path.join(DATA_DIR, '.docvault-config.json'),
    JSON.stringify({
      entities: [
        { id: 'entity-a', name: 'Entity A', color: 'blue', path: 'entity-a' },
        { id: 'entity-b', name: 'Entity B', color: 'green', path: 'entity-b' },
      ],
    })
  );
  await writeFile(PARSED_DATA_FILE, '{}');
  await writeFile(METADATA_FILE, '{}');
}

async function postJson(pathname: string, body: unknown): Promise<Response> {
  return handleRequest(
    new Request(`http://localhost:3005${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

describe('file serving security', () => {
  beforeEach(resetDataDir);

  test('/api/file adds nosniff and forces active content to download as octet-stream', async () => {
    await writeFile(
      path.join(DATA_DIR, 'entity-a', '2026', 'unsafe.html'),
      '<script>alert(1)</script>'
    );

    const response = await handleRequest(
      new Request('http://localhost:3005/api/file/entity-a/2026/unsafe.html')
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(response.headers.get('Content-Disposition')).toContain('attachment');
  });

  test('/api/file allows PDFs inline with nosniff', async () => {
    await writeFile(path.join(DATA_DIR, 'entity-a', '2026', 'safe.pdf'), '%PDF-1.7');

    const response = await handleRequest(
      new Request('http://localhost:3005/api/file/entity-a/2026/safe.pdf')
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Type')).toBe('application/pdf');
    expect(response.headers.get('Content-Disposition')).toBeNull();
  });

  test('/api/file rejects symlinks that resolve outside the entity directory', async () => {
    const outside = path.join(DATA_DIR, 'outside-secret.txt');
    await writeFile(outside, 'secret');
    await symlink(outside, path.join(DATA_DIR, 'entity-a', '2026', 'linked-secret.txt'));

    const response = await handleRequest(
      new Request('http://localhost:3005/api/file/entity-a/2026/linked-secret.txt')
    );

    expect(response.status).toBe(403);
  });
});

describe('move route reliability', () => {
  beforeEach(resetDataDir);

  test('/api/move rejects destination collisions by default', async () => {
    await writeFile(path.join(DATA_DIR, 'entity-a', '2026', 'from.pdf'), 'from');
    await writeFile(path.join(DATA_DIR, 'entity-a', '2026', 'to.pdf'), 'to');

    const response = await postJson('/api/move', {
      entity: 'entity-a',
      from: '2026/from.pdf',
      to: '2026/to.pdf',
    });

    expect(response.status).toBe(409);
    expect(await readFile(path.join(DATA_DIR, 'entity-a', '2026', 'from.pdf'), 'utf8')).toBe(
      'from'
    );
    expect(await readFile(path.join(DATA_DIR, 'entity-a', '2026', 'to.pdf'), 'utf8')).toBe('to');
  });

  test('/api/move updates parsed data and metadata keys like rename', async () => {
    await writeFile(path.join(DATA_DIR, 'entity-a', '2026', 'from.pdf'), 'from');
    await writeFile(
      PARSED_DATA_FILE,
      JSON.stringify({ 'entity-a/2026/from.pdf': { parsed: true, amount: 12 } })
    );
    await writeFile(
      METADATA_FILE,
      JSON.stringify({ 'entity-a/2026/from.pdf': { tags: ['tax'], notes: 'note' } })
    );

    const response = await postJson('/api/move', {
      entity: 'entity-a',
      from: '2026/from.pdf',
      to: '2026/moved.pdf',
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(await readFile(PARSED_DATA_FILE, 'utf8'))).toEqual({
      'entity-a/2026/moved.pdf': { parsed: true, amount: 12 },
    });
    expect(JSON.parse(await readFile(METADATA_FILE, 'utf8'))).toEqual({
      'entity-a/2026/moved.pdf': { tags: ['tax'], notes: 'note' },
    });
  });

  test('/api/move-between rejects destination collisions by default', async () => {
    await writeFile(path.join(DATA_DIR, 'entity-a', '2026', 'from.pdf'), 'from');
    await writeFile(path.join(DATA_DIR, 'entity-b', 'docs', 'to.pdf'), 'to');

    const response = await postJson('/api/move-between', {
      fromEntity: 'entity-a',
      fromPath: '2026/from.pdf',
      toEntity: 'entity-b',
      toPath: 'docs/to.pdf',
    });

    expect(response.status).toBe(409);
    expect(await readFile(path.join(DATA_DIR, 'entity-a', '2026', 'from.pdf'), 'utf8')).toBe(
      'from'
    );
    expect(await readFile(path.join(DATA_DIR, 'entity-b', 'docs', 'to.pdf'), 'utf8')).toBe('to');
  });
});

describe('request body limits', () => {
  test('rejects oversized JSON-style route bodies before parsing', async () => {
    const response = await handleRequest(
      new Request('http://localhost:3005/api/move', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(10 * 1024 * 1024 + 1),
        },
        body: '{}',
      })
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: 'Request body too large' });
  });
});
