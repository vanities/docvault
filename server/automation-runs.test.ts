import { mkdir, mkdtemp, rm, writeFile, symlink } from 'fs/promises';
import os from 'os';
import path from 'path';
import { describe, expect, test, vi } from 'vite-plus/test';
import { captureLogs, createLogger, getRecentLogs } from './logger';
import {
  listAutomationRuns,
  saveAutomationRun,
  selectRunDiagnostics,
  type AutomationRun,
} from './automation-runs';

const run: AutomationRun = {
  id: 'example-job',
  runId: 'example-job-2026-06-01T12-00-00-000Z',
  startedAt: '2026-06-01T12:00:00.000Z',
  finishedAt: '2026-06-01T12:01:00.000Z',
  durationMs: 60000,
  outcome: 'warning',
  warningCount: 1,
  stdout: 'Ingesting https://www.youtube.com/watch?v=abcdefghijk',
  diagnostics: [
    {
      ts: '2026-06-01T12:00:10.000Z',
      namespace: 'YouTubeTranscript',
      level: 'warn',
      message: '[retry] videoId=abcdefghijk HTTP 503; recovered on attempt 2',
    },
  ],
};

describe('automation run history', () => {
  test('retains early warnings after the live log buffer rolls over', () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stop = captureLogs(/^YouTubeTranscript$/);
    try {
      createLogger('YouTubeTranscript').warn('videoId=abcdefghijk early recovered timeout');
      const other = createLogger('UnrelatedExample');
      for (let i = 0; i < 1001; i++) other.info(`Synthetic unrelated event ${i}`);
      expect(
        getRecentLogs().some((entry) => entry.message.includes('early recovered timeout'))
      ).toBe(false);
      expect(
        selectRunDiagnostics(stop(), {
          ...run,
          startedAt: '2000-01-01T00:00:00.000Z',
          finishedAt: '2099-01-01T00:00:00.000Z',
        })
      ).toEqual([
        expect.objectContaining({
          level: 'warn',
          message: expect.stringContaining('early recovered timeout'),
        }),
      ]);
    } finally {
      stop();
      output.mockRestore();
      warnings.mockRestore();
    }
  });
  test('keeps recovered warnings after persistence and excludes concurrent unrelated source logs', async () => {
    const relevant = selectRunDiagnostics(
      [
        ...run.diagnostics,
        { ...run.diagnostics[0], message: 'videoId=lmnopqrstuv other channel error' },
        { ...run.diagnostics[0], ts: '2026-06-01T11:00:00.000Z' },
        { ...run.diagnostics[0], namespace: 'Chat' },
      ],
      run
    );
    expect(relevant).toEqual(run.diagnostics);
    const dir = await mkdtemp(path.join(os.tmpdir(), 'docvault-run-history-'));
    try {
      await saveAutomationRun(dir, run);
      expect(await listAutomationRuns(dir, run.id, true)).toEqual([run]);
      await expect(listAutomationRuns(dir, '../private', true)).rejects.toThrow('Invalid job id');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('does not expose symlinked files through run history', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'docvault-run-path-'));
    try {
      const runs = path.join(dir, 'jobs/runs/example-job');
      await mkdir(runs, { recursive: true });
      await writeFile(path.join(dir, 'private.json'), JSON.stringify(run));
      await symlink(path.join(dir, 'private.json'), path.join(runs, run.runId + '.json'));
      expect(await listAutomationRuns(dir, run.id)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
