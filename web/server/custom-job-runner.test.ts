import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import process from 'node:process';
import { describe, expect, test } from 'vite-plus/test';
import { createCustomJobManifest, customJobScriptPath } from './jobs';
import {
  customJobSourceWarnings,
  isCustomJobDue,
  loadCustomJobStatus,
  runCustomJobNow,
} from './custom-job-runner';
import { listAutomationRuns } from './automation-runs';

async function withTempDataDir<T>(fn: (dataDir: string) => Promise<T>): Promise<T> {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'docvault-custom-job-runner-'));
  try {
    return await fn(dataDir);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
}

describe('runCustomJobNow', () => {
  test('records a hung worker as failed, stops it, and schedules a retry', async () => {
    await withTempDataDir(async (dataDir) => {
      await createCustomJobManifest(
        {
          id: 'hung-job',
          label: 'Example hung job',
          schedule: 'daily',
          script: 'scripts/hung.local.sh',
          enabled: true,
          tags: [],
        },
        { dataDir }
      );
      await writeFile(customJobScriptPath(dataDir, 'scripts/hung.local.sh'), 'sleep 30\n');
      const result = await runCustomJobNow('hung-job', { dataDir, timeoutMs: 30 });
      expect(result).toMatchObject({
        outcome: 'error',
        error: expect.stringContaining('time budget'),
      });
      expect((await loadCustomJobStatus(dataDir))['hung-job']).toMatchObject({
        running: false,
        lastSuccessAt: null,
        nextRetryAt: expect.any(String),
      });
      expect((await listAutomationRuns(dataDir, 'hung-job'))[0].error).toContain('time budget');
    });
  });

  test('persists setup failures in history even when no script can start', async () => {
    await withTempDataDir(async (dataDir) => {
      await createCustomJobManifest(
        {
          id: 'missing-job',
          label: 'Example missing script',
          schedule: 'daily',
          script: 'scripts/missing.local.sh',
          enabled: true,
          tags: [],
        },
        { dataDir }
      );
      await expect(runCustomJobNow('missing-job', { dataDir })).rejects.toThrow();
      const [run] = await listAutomationRuns(dataDir, 'missing-job');
      expect(run).toMatchObject({
        outcome: 'error',
        exitCode: null,
        error: expect.stringContaining('ENOENT'),
      });
      expect((await loadCustomJobStatus(dataDir))['missing-job'].running).toBe(false);
    });
  });

  test('reclassifies legacy false successes and recovers the actual previous completion', async () => {
    await withTempDataDir(async (dataDir) => {
      await createCustomJobManifest(
        {
          id: 'legacy-job',
          label: 'Example legacy collector',
          schedule: 'daily',
          script: 'scripts/legacy.local.sh',
          enabled: true,
          tags: [],
        },
        { dataDir }
      );
      const script = customJobScriptPath(dataDir, 'scripts/legacy.local.sh');
      await writeFile(script, 'printf "ingested=2 failed=0\\n"\n');
      const success = await runCustomJobNow('legacy-job', { dataDir });
      const statuses = await loadCustomJobStatus(dataDir);
      statuses['legacy-job'].lastSuccessAt = '2026-10-01T12:00:00.000Z';
      statuses['legacy-job'].lastRanAt = '2026-10-01T11:59:00.000Z';
      statuses['legacy-job'].lastSummary = 'ingested=1 failed=3';
      delete statuses['legacy-job'].lastOutcome;
      await writeFile(path.join(dataDir, 'jobs/status.json'), JSON.stringify(statuses));
      expect((await loadCustomJobStatus(dataDir))['legacy-job']).toMatchObject({
        lastOutcome: 'partial',
        lastSuccessAt: success.finishedAt,
        lastError: expect.stringContaining('3 failed'),
        nextRetryAt: '2026-10-01T12:14:00.000Z',
      });
    });
  });

  test('preserves the last successful run, backs off repeated failures, and keeps recovered warnings', async () => {
    await withTempDataDir(async (dataDir) => {
      await createCustomJobManifest(
        {
          id: 'retry-collector',
          label: 'Example retry collector',
          schedule: 'daily',
          script: 'scripts/retry.local.sh',
          enabled: true,
          tags: ['research'],
        },
        { dataDir }
      );
      const scriptPath = customJobScriptPath(dataDir, 'scripts/retry.local.sh');
      await writeFile(scriptPath, 'printf "ingested=2 failed=0\\n"\n');
      await runCustomJobNow('retry-collector', { dataDir });
      const clean = (await loadCustomJobStatus(dataDir))['retry-collector'];
      await writeFile(scriptPath, 'printf "ingested=1 failed=3\\n"\n');
      await runCustomJobNow('retry-collector', { dataDir });
      await runCustomJobNow('retry-collector', { dataDir });
      const failed = (await loadCustomJobStatus(dataDir))['retry-collector'];
      expect(failed.lastSuccessAt).toBe(clean.lastSuccessAt);
      expect(failed.consecutiveFailures).toBe(2);
      expect(
        Date.parse(failed.nextRetryAt!) - Date.parse(failed.lastRanAt!)
      ).toBeGreaterThanOrEqual(30 * 60 * 1000);
      await writeFile(
        scriptPath,
        'printf "temporary HTTP 503; retry succeeded\\n" >&2\nprintf "ingested=3 failed=0\\n"\n'
      );
      const recovered = await runCustomJobNow('retry-collector', { dataDir });
      const status = (await loadCustomJobStatus(dataDir))['retry-collector'];
      expect(status).toMatchObject({
        lastOutcome: 'warning',
        lastError: null,
        nextRetryAt: null,
        consecutiveFailures: 0,
        warningCount: 1,
        lastCleanSuccessAt: clean.lastCleanSuccessAt,
      });
      expect(status.lastWarning).toContain('retry succeeded');
      expect(
        (await listAutomationRuns(dataDir, 'retry-collector')).find(
          (r) => r.runId === recovered.runId
        )?.stderr
      ).toContain('503');
    });
  });

  test('coalesces overlapping manual and scheduled runs of the same job', async () => {
    await withTempDataDir(async (dataDir) => {
      await createCustomJobManifest(
        {
          id: 'single-run',
          label: 'Example single run',
          schedule: 'daily',
          script: 'scripts/single.local.sh',
          enabled: true,
          tags: [],
        },
        { dataDir }
      );
      await writeFile(
        customJobScriptPath(dataDir, 'scripts/single.local.sh'),
        'printf "one run\\n"\n'
      );
      const first = runCustomJobNow('single-run', { dataDir });
      const second = runCustomJobNow('single-run', { dataDir });
      expect(first).toBe(second);
      await Promise.all([first, second]);
      expect(await listAutomationRuns(dataDir, 'single-run')).toHaveLength(1);
    });
  });

  test('records incomplete collection even when the collector exits zero', async () => {
    await withTempDataDir(async (dataDir) => {
      await createCustomJobManifest(
        {
          id: 'example-collector',
          label: 'Example Collector',
          schedule: 'daily',
          script: 'scripts/collector.local.sh',
          enabled: true,
          tags: ['research'],
        },
        { dataDir }
      );
      await writeFile(
        customJobScriptPath(dataDir, 'scripts/collector.local.sh'),
        'printf "[example-collector] candidates=4 ingested=1 failed=3\\n"\n',
        { mode: 0o700 }
      );

      const result = await runCustomJobNow('example-collector', { dataDir });
      const status = (await loadCustomJobStatus(dataDir))['example-collector'];
      expect(result.exitCode).toBe(0);
      expect(status).toMatchObject({
        lastOutcome: 'partial',
        lastCollection: { collected: 1, failed: 3, skipped: 0 },
        lastSuccessAt: null,
        lastError: expect.stringContaining('3'),
        nextRetryAt: expect.any(String),
      });
    });
  });

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
      // Last successful run's stdout tail is captured for the Jobs UI.
      expect(status['smoke-job'].lastSummary).toBe('hello from custom job');
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
      expect(status['connector-check'].lastSuccessAt).toBeNull();
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
      const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
      await writeFile(
        scriptPath,
        shellQuote(process.execPath) +
          ' -e ' +
          shellQuote(
            'process.stdout.write("o".repeat(200000)); process.stderr.write("e".repeat(200000));'
          ) +
          '\n',
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
    lastSummary: null,
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

  test('a failed daily collection retries before the next daily window and respects its backoff', () => {
    const s = status({
      lastRanAt: iso(now - 20 * MINUTE),
      lastSuccessAt: iso(now - HOUR),
      lastError: 'Collection incomplete',
      nextRetryAt: iso(now + 10 * MINUTE),
    });
    expect(isCustomJobDue(s, DAY, now)).toBe(false);
    expect(isCustomJobDue(s, DAY, now + 10 * MINUTE)).toBe(true);
  });

  test('report notes include unresolved enabled collectors, with counts and retry time', () => {
    const manifests = [
      {
        id: 'example-feed',
        label: 'Example feed',
        kind: 'local-script' as const,
        schedule: 'daily' as const,
        script: 'scripts/example.local.sh',
        enabled: true,
        tags: [],
      },
    ];
    const statuses = {
      'example-feed': status({
        lastError: 'Collection incomplete',
        lastCollection: { collected: 1, failed: 3, skipped: 0 },
        nextRetryAt: iso(now),
      }),
    };
    expect(customJobSourceWarnings(manifests, statuses)[0]).toMatchObject({
      source: 'collection/example-feed',
      message: expect.stringContaining('1 collected, 3 failed'),
    });
    expect(customJobSourceWarnings([{ ...manifests[0], enabled: false }], statuses)).toEqual([]);
    expect(
      customJobSourceWarnings(manifests, {
        'example-feed': status({ lastWarning: 'Recovered after a retry' }),
      })
    ).toEqual([]);
  });
});
