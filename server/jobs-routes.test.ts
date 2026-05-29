import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { describe, expect, test } from 'vite-plus/test';
import { handleJobRoutes } from './routes/jobs';
import { customJobScriptPath } from './jobs';
import type { ScheduleStatusMap } from './scheduler';

async function withTempDataDir<T>(fn: (dataDir: string) => Promise<T>): Promise<T> {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'docvault-job-routes-'));
  try {
    return await fn(dataDir);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
}

const scheduleStatus: ScheduleStatusMap = {
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
    lastError: null,
    lastDurationMs: null,
    running: false,
  },
  quantRefresh: {
    lastRanAt: null,
    lastSuccessAt: null,
    lastError: null,
    lastDurationMs: null,
    running: false,
  },
  encryptedBackup: {
    lastRanAt: null,
    lastSuccessAt: null,
    lastError: null,
    lastDurationMs: null,
    running: false,
  },
};

describe('handleJobRoutes', () => {
  test('GET /api/jobs returns built-in and custom job records', async () => {
    await withTempDataDir(async (dataDir) => {
      const createResponse = await handleJobRoutes(
        new Request('https://example.test/api/jobs', {
          method: 'POST',
          body: JSON.stringify({
            id: 'benjamin-youtube-daily',
            label: 'Benjamin Cowen YouTube daily transcript pull',
            schedule: 'daily',
            script: 'scripts/benjamin-cowen-youtube.local.ts',
            enabled: true,
            tags: ['politics'],
          }),
        }),
        new URL('https://example.test/api/jobs'),
        '/api/jobs',
        {
          dataDir,
          loadScheduleStatus: async () => scheduleStatus,
          loadSettings: async () => ({
            schedules: { snapshotEnabled: true, snapshotIntervalMinutes: 1440 },
          }),
          restartCustomJobScheduler: async () => {},
        }
      );

      expect(createResponse?.status).toBe(201);

      const listResponse = await handleJobRoutes(
        new Request('https://example.test/api/jobs'),
        new URL('https://example.test/api/jobs'),
        '/api/jobs',
        {
          dataDir,
          loadScheduleStatus: async () => scheduleStatus,
          loadSettings: async () => ({
            schedules: { snapshotEnabled: true, snapshotIntervalMinutes: 1440 },
          }),
        }
      );

      expect(listResponse?.status).toBe(200);
      const body = await listResponse!.json();
      expect(body.builtInJobs.map((j: { id: string }) => j.id)).toContain('snapshot');
      expect(body.customJobs).toHaveLength(1);
      expect(body.customJobStatuses).toEqual({});
      expect(body.customJobs[0].manifest).toMatchObject({
        id: 'benjamin-youtube-daily',
        kind: 'local-script',
      });
    });
  });

  test('POST /api/jobs/:id/run executes a local custom job', async () => {
    await withTempDataDir(async (dataDir) => {
      await handleJobRoutes(
        new Request('https://example.test/api/jobs', {
          method: 'POST',
          body: JSON.stringify({
            id: 'smoke-job',
            label: 'Smoke Job',
            schedule: 'hourly',
            script: 'scripts/smoke.local.sh',
            enabled: false,
          }),
        }),
        new URL('https://example.test/api/jobs'),
        '/api/jobs',
        { dataDir, restartCustomJobScheduler: async () => {} }
      );
      const scriptPath = customJobScriptPath(dataDir, 'scripts/smoke.local.sh');
      await mkdir(path.dirname(scriptPath), { recursive: true });
      await writeFile(scriptPath, 'printf "route runner ok"\n', { mode: 0o700 });

      const response = await handleJobRoutes(
        new Request('https://example.test/api/jobs/smoke-job/run', { method: 'POST' }),
        new URL('https://example.test/api/jobs/smoke-job/run'),
        '/api/jobs/smoke-job/run',
        { dataDir }
      );

      expect(response?.status).toBe(200);
      const body = await response!.json();
      expect(body.ok).toBe(true);
      expect(body.result.stdout).toContain('route runner ok');
    });
  });

  test('POST /api/jobs restarts custom scheduler after manifest changes', async () => {
    await withTempDataDir(async (dataDir) => {
      const restarts: string[] = [];
      const response = await handleJobRoutes(
        new Request('https://example.test/api/jobs', {
          method: 'POST',
          body: JSON.stringify({
            id: 'scheduled-smoke-job',
            label: 'Scheduled Smoke Job',
            schedule: 'hourly',
            script: 'scripts/scheduled-smoke.local.sh',
            enabled: true,
          }),
        }),
        new URL('https://example.test/api/jobs'),
        '/api/jobs',
        {
          dataDir,
          restartCustomJobScheduler: async (restartDataDir: string) => {
            restarts.push(restartDataDir);
          },
        }
      );

      expect(response?.status).toBe(201);
      expect(restarts).toEqual([dataDir]);
    });
  });

  test('POST /api/jobs can create and chmod a local script body', async () => {
    await withTempDataDir(async (dataDir) => {
      const response = await handleJobRoutes(
        new Request('https://example.test/api/jobs', {
          method: 'POST',
          body: JSON.stringify({
            id: 'body-script-job',
            label: 'Body Script Job',
            schedule: 'hourly',
            script: 'scripts/body-script.local.sh',
            scriptContent: '#!/usr/bin/env bash\r\nprintf "body ok"\r\n',
            enabled: false,
          }),
        }),
        new URL('https://example.test/api/jobs'),
        '/api/jobs',
        { dataDir, restartCustomJobScheduler: async () => {} }
      );

      expect(response?.status).toBe(201);
      const body = await response!.json();
      const scriptPath = customJobScriptPath(dataDir, 'scripts/body-script.local.sh');
      expect(body.scriptStatus).toMatchObject({ exists: true, runnable: true, repaired: true });
      expect(await readFile(scriptPath, 'utf8')).toBe('#!/usr/bin/env bash\nprintf "body ok"\n');
      expect((await stat(scriptPath)).mode & 0o777).toBe(0o700);
    });
  });

  test('POST /api/jobs?overwrite=true edits a cron and keeps its script runnable', async () => {
    await withTempDataDir(async (dataDir) => {
      await handleJobRoutes(
        new Request('https://example.test/api/jobs', {
          method: 'POST',
          body: JSON.stringify({
            id: 'editable-job',
            label: 'Editable Job',
            schedule: 'hourly',
            script: 'scripts/editable.local.sh',
            scriptContent: '#!/usr/bin/env bash\nprintf "old"\n',
            enabled: false,
          }),
        }),
        new URL('https://example.test/api/jobs'),
        '/api/jobs',
        { dataDir, restartCustomJobScheduler: async () => {} }
      );

      const response = await handleJobRoutes(
        new Request('https://example.test/api/jobs?overwrite=true', {
          method: 'POST',
          body: JSON.stringify({
            id: 'editable-job',
            label: 'Editable Job Updated',
            schedule: 'daily',
            script: 'scripts/editable.local.sh',
            scriptContent: '#!/usr/bin/env bash\r\nprintf "new"\r\n',
            enabled: true,
          }),
        }),
        new URL('https://example.test/api/jobs?overwrite=true'),
        '/api/jobs',
        { dataDir, restartCustomJobScheduler: async () => {} }
      );

      expect(response?.status).toBe(201);
      const body = await response!.json();
      const scriptPath = customJobScriptPath(dataDir, 'scripts/editable.local.sh');
      expect(body.manifest).toMatchObject({ label: 'Editable Job Updated', schedule: 'daily' });
      expect(body.scriptStatus).toMatchObject({ exists: true, runnable: true, repaired: true });
      expect(await readFile(scriptPath, 'utf8')).toBe('#!/usr/bin/env bash\nprintf "new"\n');
      expect((await stat(scriptPath)).mode & 0o777).toBe(0o700);
    });
  });

  test('returns null for unrelated paths', async () => {
    await expect(
      handleJobRoutes(
        new Request('https://example.test/nope'),
        new URL('https://example.test/nope'),
        '/nope'
      )
    ).resolves.toBeNull();
  });
});
