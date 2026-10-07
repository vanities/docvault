// Only fabricated files in an isolated temporary vault; never reads NAS data.
import { afterAll, beforeAll, describe, expect, test, vi } from 'vite-plus/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';

const dataDir = vi.hoisted(() => {
  const dir = require('path').join(require('os').tmpdir(), `docvault-selection-test-${Date.now()}`);
  process.env.DOCVAULT_DATA_DIR = dir;
  return dir;
});
import { handleDownloadRoutes } from './downloads.js';

beforeAll(async () => {
  await fs.mkdir(path.join(dataDir, 'acme', 'notes'), { recursive: true });
  await fs.writeFile(
    path.join(dataDir, '.docvault-config.json'),
    JSON.stringify({
      entities: [{ id: 'acme', path: 'acme', name: 'Acme Test Vault', color: 'blue' }],
    })
  );
  await fs.writeFile(path.join(dataDir, 'acme', 'notes', 'A #1.txt'), 'Synthetic first document');
  await fs.writeFile(path.join(dataDir, 'acme', '__proto__'), 'Synthetic second document');
  await fs.writeFile(path.join(dataDir, 'outside.txt'), 'Synthetic excluded document');
  await fs.symlink(path.join(dataDir, 'outside.txt'), path.join(dataDir, 'acme', 'link.txt'));
});
afterAll(() => fs.rm(dataDir, { recursive: true, force: true }));

async function call(body: unknown): Promise<Response> {
  const url = new URL('http://internal/api/download/files');
  return (await handleDownloadRoutes(
    new Request(url, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }),
    url,
    url.pathname
  ))!;
}

describe('selected document archives', () => {
  test('exports only selected files, preserving names and deduplicating paths', async () => {
    const response = await call({
      entity: 'acme',
      paths: ['notes/A #1.txt', '__proto__', 'notes/A #1.txt'],
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/zip');
    const zip = unzipSync(new Uint8Array(await response.arrayBuffer()));
    expect(Object.keys(zip).sort()).toEqual(['Documents/__proto__', 'Documents/notes/A #1.txt']);
    expect(new TextDecoder().decode(zip['Documents/notes/A #1.txt'])).toBe(
      'Synthetic first document'
    );
  });

  test('rejects traversal, invalid lists, directories and symlink escapes', async () => {
    for (const body of [
      null,
      {},
      { entity: 'acme', paths: [] },
      { entity: 'acme', paths: [123] },
      { entity: 'acme', paths: ['../outside.txt'] },
      { entity: 'acme', paths: ['/outside.txt'] },
      { entity: 'acme', paths: ['notes//A.txt'] },
      { entity: 'acme', paths: ['notes'] },
    ]) {
      expect((await call(body)).status).toBe(400);
    }
    expect((await call({ entity: 'acme', paths: ['link.txt'] })).status).toBe(403);
    expect((await call({ entity: 'missing', paths: ['notes/A #1.txt'] })).status).toBe(404);
  });

  test('reports a missing file instead of silently returning an incomplete ZIP', async () => {
    expect((await call({ entity: 'acme', paths: ['notes/A #1.txt', 'missing.txt'] })).status).toBe(
      404
    );
    expect((await call({ entity: 'acme', paths: Array(5001).fill('notes/A #1.txt') })).status).toBe(
      413
    );
  });
});
