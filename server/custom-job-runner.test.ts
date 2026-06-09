import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { describe, expect, test } from 'vite-plus/test';
import { createCustomJobManifest, customJobScriptPath } from './jobs';
import { isCustomJobDue, loadCustomJobStatus, runCustomJobNow } from './custom-job-runner';

async function withTempDataDir<T>(fn: (dataDir: string) => Promise<T>): Promise<T> {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'docvault-custom-job-runner-'));
  try {
    return await fn(dataDir);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
}

describe('runCustomJobNow', () => {
  test('runs a safe local shell script and records status/log output', async () => {
    await withTempDataDir(async (dataDir) => {
      await createCustomJobManifest(
        {
          id: 'smoke-job',
          label: 'Smoke Job',
          schedule: 'hourly',
          script: 'scripts/smoke.local.sh',
          enabled: true,
          tags: ['smoke'],
        },
        { dataDir }
      );
      const scriptPath = customJobScriptPath(dataDir, 'scripts/smoke.local.sh');
      await mkdir(path.dirname(scriptPath), { recursive: true });
      await writeFile(scriptPath, 'printf "hello from custom job"\n', { mode: 0o700 });

      const result = await runCustomJobNow('smoke-job', { dataDir });
      const status = await loadCustomJobStatus(dataDir);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('hello from custom job');
      expect(status['smoke-job']).toMatchObject({
        lastSuccessAt: expect.any(String),
        lastError: null,
        running: false,
      });
      expect(status['smoke-job'].lastRunPath).toBeTruthy();
      const runRecord = JSON.parse(await readFile(status['smoke-job'].lastRunPath!, 'utf8'));
      expect(runRecord.stdout).toContain('hello from custom job');
    });
  });

  test('can run a connector in explicit dry-run mode without enabling the schedule', async () => {
    await withTempDataDir(async (dataDir) => {
      await createCustomJobManifest(
        {
          id: 'connector-check',
          label: 'Connector Check',
          schedule: 'daily',
          script: 'scripts/connector-check.local.sh',
          enabled: false,
          tags: ['politics', 'connector'],
        },
        { dataDir }
      );
      const scriptPath = customJobScriptPath(dataDir, 'scripts/connector-check.local.sh');
      await mkdir(path.dirname(scriptPath), { recursive: true });
      await writeFile(
        scriptPath,
        'printf "dry=%s scheduled=%s" "$DOCVAULT_JOB_DRY_RUN" "$DOCVAULT_JOB_ENABLED"\n',
        { mode: 0o700 }
      );

      const result = await runCustomJobNow('connector-check', { dataDir, dryRun: true });
      const status = await loadCustomJobStatus(dataDir);

      expect(result.dryRun).toBe(true);
      expect(result.stdout).toContain('dry=1 scheduled=false');
      expect(status['connector-check']).toMatchObject({
        lastError: null,
        running: false,
      });
      expect(status['connector-check'].lastRunPath).toBeTruthy();
      const runRecord = JSON.parse(await readFile(status['connector-check'].lastRunPath!, 'utf8'));
      expect(runRecord.dryRun).toBe(true);
    });
  });

  test('concurrent runs do not lose status updates (lost-update race)', async () => {
    await withTempDataDir(async (dataDir) => {
      const ids = ['job-a', 'job-b', 'job-c', 'job-d'];
      for (const id of ids) {
        await createCustomJobManifest(
          {
            id,
            label: id,
            schedule: 'daily',
            script: `scripts/${id}.local.sh`,
            enabled: true,
            tags: [],
          },
          { dataDir }
        );
        const scriptPath = customJobScriptPath(dataDir, `scripts/${id}.local.sh`);
        await mkdir(path.dirname(scriptPath), { recursive: true });
        await writeFile(scriptPath, 'printf "ok"\n', { mode: 0o700 });
      }

      // Fire all four in the same tick — mirrors the daily timers firing
      // together. Before the lock this clobbered keys and left lastRanAt
      // stranded behind lastSuccessAt.
      await Promise.all(ids.map((id) => runCustomJobNow(id, { dataDir })));

      const status = await loadCustomJobStatus(dataDir);
      for (const id of ids) {
        expect(status[id]).toBeTruthy();
        expect(status[id].lastSuccessAt).toEqual(expect.any(String));
        expect(status[id].lastError).toBeNull();
        // The production bug: lastRanAt got overwritten with an older value
        // than lastSuccessAt. Within a single run it must never be later.
        expect(Date.parse(status[id].lastRanAt!)).toBeLessThanOrEqual(
          Date.parse(status[id].lastSuccessAt!)
        );
      }
    });
  });

  test('caps retained stdout and stderr in run records', async () => {
    await withTempDataDir(async (dataDir) => {
      await createCustomJobManifest(
        {
          id: 'noisy-job',
          label: 'Noisy Job',
          schedule: 'hourly',
          script: 'scripts/noisy.local.sh',
          enabled: false,
          tags: [],
        },
        { dataDir }
      );
      const scriptPath = customJobScriptPath(dataDir, 'scripts/noisy.local.sh');
      await mkdir(path.dirname(scriptPath), { recursive: true });
      await writeFile(
        scriptPath,
        'python3 - <<\'PY\'\nimport sys\nsys.stdout.write("o" * 200000)\nsys.stderr.write("e" * 200000)\nPY\n',
        { mode: 0o700 }
      );

      const result = await runCustomJobNow('noisy-job', { dataDir });
      const runRecord = JSON.parse(await readFile(result.runPath, 'utf8'));

      expect(result.stdout.length).toBeLessThanOrEqual(70_000);
      expect(result.stderr.length).toBeLessThanOrEqual(70_000);
      expect(result.stdout).toContain('[truncated');
      expect(result.stderr).toContain('[truncated');
      expect(runRecord.stdout).toBe(result.stdout);
    });
  });
});

describe('isCustomJobDue', () => {
  const HOUR = 60 * 60 * 1000;
  const MINUTE = 60 * 1000;
  const DAY = 24 * HOUR;
  const now = Date.parse('2026-06-01T12:00:00Z');
  const iso = (ms: number) => new Date(ms).toISOString();
  const status = (over: Partial<Parameters<typeof isCustomJobDue>[0]> = {}) => ({
    lastRanAt: null,
    lastSuccessAt: null,
    lastError: null,
    lastDurationMs: null,
    running: false,
    lastRunPath: null,
    ...over,
  });

  test('a job that has never run is due', () => {
    expect(isCustomJobDue(undefined, DAY, now)).toBe(true);
  });

  test('a job whose last success is older than the interval is due (restart catch-up)', () => {
    const s = status({ lastRanAt: iso(now - 25 * HOUR), lastSuccessAt: iso(now - 25 * HOUR) });
    expect(isCustomJobDue(s, DAY, now)).toBe(true);
  });

  test('a job that succeeded within the interval is not due', () => {
    const s = status({ lastRanAt: iso(now - HOUR), lastSuccessAt: iso(now - HOUR) });
    expect(isCustomJobDue(s, DAY, now)).toBe(false);
  });

  test('a very recent attempt suppresses a catch-up storm even if it never succeeded', () => {
    const s = status({ lastRanAt: iso(now - 2 * MINUTE), lastSuccessAt: null });
    expect(isCustomJobDue(s, DAY, now)).toBe(false);
  });

  test('an earlier failure is retried once past the retry floor', () => {
    const s = status({ lastRanAt: iso(now - 20 * MINUTE), lastSuccessAt: null });
    expect(isCustomJobDue(s, DAY, now)).toBe(true);
  });
});
