import { mkdir, rm, writeFile } from 'fs/promises';
import path from 'path';
import { beforeEach, describe, expect, test, vi } from 'vite-plus/test';

// Vi.hoisted fires before the import graph resolves — isolates this suite's
// synthetic fixtures (settings `{}` + health store) in a tmpdir. Without it
// resetHealthData() overwrites the real local .docvault-settings.json.
vi.hoisted(() => {
  const p = require('path') as typeof import('path');
  const o = require('os') as typeof import('os');
  const f = require('fs') as typeof import('fs');
  const dir = p.join(o.tmpdir(), `docvault-health-security-${Date.now()}`);
  f.mkdirSync(dir, { recursive: true });
  process.env.DOCVAULT_DATA_DIR = dir;
  return dir;
});

import { DATA_DIR, SETTINGS_PATH, getOrCreateHealthIngestToken } from '../data.js';
import { HEALTH_STORE_FILE } from '../health-store.js';
import { handleHealthRoutes } from './health.js';

async function resetHealthData(): Promise<void> {
  process.env.DOCVAULT_MASTER_KEY = Buffer.alloc(32, 1).toString('base64');
  await rm(path.join(DATA_DIR, 'health', 'person-a'), { recursive: true, force: true });
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(SETTINGS_PATH, '{}');
  await writeFile(
    HEALTH_STORE_FILE,
    JSON.stringify({
      version: 1,
      people: [
        {
          id: 'person-a',
          name: 'Test Person',
          color: 'blue',
          createdAt: '2026-06-01T00:00:00.000Z',
          archivedAt: null,
        },
      ],
      summaries: {},
      snapshots: {},
    })
  );
}

describe('health ingest parse error handling', () => {
  beforeEach(resetHealthData);

  test('invalid JSON response and ingest log do not include a raw body preview', async () => {
    const token = await getOrCreateHealthIngestToken();
    const badBody = '{"sensitive":"do not echo",';
    const req = new Request('http://localhost:3005/api/health/person-a/ingest', {
      method: 'POST',
      headers: { 'X-Docvault-Auth': token, 'Content-Type': 'application/json' },
      body: badBody,
    });

    const response = await handleHealthRoutes(req, new URL(req.url), '/api/health/person-a/ingest');

    expect(response!.status).toBe(400);
    const bodyText = await response!.text();
    expect(bodyText).not.toContain('do not echo');
    expect(bodyText).not.toContain('sensitive');

    const logText = await import('fs/promises').then((fs) =>
      fs.readFile(path.join(DATA_DIR, 'health', 'person-a', 'ingest.log'), 'utf8')
    );
    expect(logText).not.toContain('do not echo');
    expect(logText).not.toContain('preview');
  });
});
