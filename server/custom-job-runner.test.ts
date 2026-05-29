import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { describe, expect, test } from 'vite-plus/test';
import { createCustomJobManifest, customJobScriptPath } from './jobs';
import { loadCustomJobStatus, runCustomJobNow } from './custom-job-runner';

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
});
