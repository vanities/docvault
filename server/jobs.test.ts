import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { describe, expect, test } from 'vite-plus/test';
import {
  createCustomJobManifest,
  customJobManifestPath,
  customJobScheduleToMs,
  customJobScriptPath,
  listBuiltInJobRecords,
  listCustomJobManifests,
  parseCustomJobManifest,
  prepareCustomJobScript,
} from './jobs';
import type { ScheduleStatusMap } from './scheduler';

const exampleManifest = {
  id: 'benjamin-youtube-daily',
  label: 'Benjamin Cowen YouTube daily transcript pull',
  schedule: 'daily',
  script: 'scripts/benjamin-cowen-youtube.local.ts',
  enabled: true,
  tags: ['politics', 'macro', 'transcript', 'youtube'],
};

async function withTempDataDir<T>(fn: (dataDir: string) => Promise<T>): Promise<T> {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'docvault-jobs-'));
  try {
    return await fn(dataDir);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
}

function statusMap(): ScheduleStatusMap {
  return {
    snapshot: {
      lastRanAt: '2026-05-29T00:00:00.000Z',
      lastSuccessAt: '2026-05-29T00:01:00.000Z',
      lastError: null,
      lastDurationMs: 60_000,
      running: false,
    },
    dropboxSync: {
      lastRanAt: null,
      lastSuccessAt: null,
      lastError: 'rclone missing',
      lastDurationMs: null,
      running: false,
    },
    quantRefresh: {
      lastRanAt: null,
      lastSuccessAt: null,
      lastError: null,
      lastDurationMs: null,
      running: true,
    },
    encryptedBackup: {
      lastRanAt: null,
      lastSuccessAt: null,
      lastError: null,
      lastDurationMs: null,
      running: false,
    },
  };
}

describe('parseCustomJobManifest', () => {
  test('accepts a generic safe local manifest shape', () => {
    expect(parseCustomJobManifest(exampleManifest)).toEqual({
      ...exampleManifest,
      kind: 'local-script',
    });
  });

  test('rejects scripts outside the local scripts folder', () => {
    expect(() =>
      parseCustomJobManifest({
        id: 'bad',
        label: 'Bad',
        schedule: 'daily',
        script: '../steal.sh',
      })
    ).toThrow(/script must live under scripts\//);
  });
});

describe('custom job scheduling helpers', () => {
  test('converts supported schedules to milliseconds', () => {
    expect(customJobScheduleToMs('hourly')).toBe(60 * 60 * 1000);
    expect(customJobScheduleToMs('daily')).toBe(24 * 60 * 60 * 1000);
    expect(customJobScheduleToMs('every 6h')).toBe(6 * 60 * 60 * 1000);
  });

  test('resolves scripts under the generic jobs scripts directory', async () => {
    await withTempDataDir(async (dataDir) => {
      expect(customJobScriptPath(dataDir, 'scripts/example.local.ts')).toBe(
        path.join(dataDir, 'jobs', 'scripts', 'example.local.ts')
      );
      expect(() => customJobScriptPath(dataDir, '../steal.local.sh')).toThrow(/script must live/);
    });
  });
});

describe('custom job manifests', () => {
  test('creates and lists local manifests from the generic jobs directory', async () => {
    await withTempDataDir(async (dataDir) => {
      const manifest = await createCustomJobManifest(exampleManifest, { dataDir });
      const records = await listCustomJobManifests(dataDir);

      expect(manifest).toEqual({ ...exampleManifest, kind: 'local-script' });
      expect(records).toEqual([
        {
          status: 'valid',
          path: customJobManifestPath(dataDir, exampleManifest.id),
          manifest: { ...exampleManifest, kind: 'local-script' },
        },
      ]);
      expect(records[0].path).toContain(`${path.sep}jobs${path.sep}manifests${path.sep}`);
    });
  });

  test('lists invalid local manifest files without throwing', async () => {
    await withTempDataDir(async (dataDir) => {
      await createCustomJobManifest(exampleManifest, { dataDir });
      await writeFile(customJobManifestPath(dataDir, 'bad-job'), '{not json', 'utf8');

      const records = await listCustomJobManifests(dataDir);
      expect(records).toHaveLength(2);
      expect(records[0]).toMatchObject({ status: 'invalid' });
      expect(records[1]).toMatchObject({ status: 'valid' });
    });
  });

  test('prepares copied local scripts by normalizing line endings and chmodding runnable', async () => {
    await withTempDataDir(async (dataDir) => {
      const manifest = await createCustomJobManifest(
        { ...exampleManifest, script: 'scripts/copied.local.sh' },
        { dataDir }
      );
      const scriptPath = customJobScriptPath(dataDir, manifest.script);
      await mkdir(path.dirname(scriptPath), { recursive: true });
      await writeFile(scriptPath, '#!/usr/bin/env bash\r\nprintf "ok"\r\n', { mode: 0o600 });

      const scriptStatus = await prepareCustomJobScript({}, manifest, { dataDir });
      const mode = (await stat(scriptPath)).mode & 0o777;

      expect(scriptStatus).toMatchObject({ exists: true, runnable: true, repaired: true });
      expect(await readFile(scriptPath, 'utf8')).not.toContain('\r');
      expect(mode).toBe(0o700);
    });
  });

  test('can write scriptContent during manifest creation helper preparation', async () => {
    await withTempDataDir(async (dataDir) => {
      const manifest = await createCustomJobManifest(
        { ...exampleManifest, script: 'scripts/new-script.local.sh' },
        { dataDir }
      );
      const scriptStatus = await prepareCustomJobScript(
        { scriptContent: '#!/usr/bin/env bash\r\nprintf "created"\r\n' },
        manifest,
        { dataDir }
      );
      const scriptPath = customJobScriptPath(dataDir, manifest.script);

      expect(scriptStatus).toMatchObject({ exists: true, runnable: true, repaired: true });
      expect(await readFile(scriptPath, 'utf8')).toBe('#!/usr/bin/env bash\nprintf "created"\n');
      expect((await stat(scriptPath)).mode & 0o777).toBe(0o700);
    });
  });
});

describe('listBuiltInJobRecords', () => {
  test('projects built-in scheduled jobs into the same jobs surface', () => {
    const jobs = listBuiltInJobRecords(statusMap(), {
      snapshotEnabled: true,
      snapshotIntervalMinutes: 1440,
      dropboxSyncEnabled: false,
      dropboxSyncIntervalMinutes: 60,
      quantRefreshEnabled: true,
      quantRefreshIntervalMinutes: 720,
    });

    expect(jobs.map((j) => j.id)).toEqual([
      'snapshot',
      'dropbox-sync',
      'encrypted-backup',
      'quant-refresh',
      'politics-refresh',
      'daily-news',
    ]);
    expect(jobs[0]).toMatchObject({
      kind: 'built-in',
      label: 'Portfolio Snapshot',
      enabled: true,
      schedule: 'every 1440m',
      status: { lastSuccessAt: '2026-05-29T00:01:00.000Z' },
    });
    expect(jobs[1]).toMatchObject({
      id: 'dropbox-sync',
      enabled: false,
      status: { lastError: 'rclone missing' },
    });
    expect(jobs[2]).toMatchObject({
      id: 'encrypted-backup',
      enabled: false,
      schedule: 'with dropbox-sync',
    });
    expect(jobs[3]).toMatchObject({
      id: 'quant-refresh',
      enabled: true,
      schedule: 'every 720m',
      status: { running: true },
    });
  });
});
