// Fabricated administrative records. Scripts only print deterministic test output.
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function seedNativeOperations(dataDir: string) {
  const root = path.join(dataDir, 'jobs');
  await rm(root, { recursive: true, force: true });
  await mkdir(path.join(root, 'manifests'), { recursive: true });
  await mkdir(path.join(root, 'scripts'), { recursive: true });
  const base = {
    lastRanAt: '2026-10-01T12:00:00Z',
    lastSuccessAt: '2026-09-30T12:00:00Z',
    lastCleanSuccessAt: '2026-09-29T12:00:00Z',
    lastDurationMs: 1250,
    running: false,
    lastError: null,
    lastOutcome: 'success',
  };
  const partial = {
    ...base,
    lastOutcome: 'partial',
    lastError: 'Synthetic collection incomplete: 1 collected, 1 failed, 1 skipped',
    lastCollection: { collected: 1, failed: 1, skipped: 1 },
    nextRetryAt: '2026-10-01T12:05:00Z',
    consecutiveFailures: 2,
    lastSummary: 'Previous synthetic clean collection',
    lastAttemptSummary: 'candidates=3 ingested=1 failed=1 skipped=1',
  };
  await writeFile(
    path.join(dataDir, '.docvault-schedule-status.json'),
    JSON.stringify({
      snapshot: base,
      dailyNewsRefresh: {
        ...base,
        lastOutcome: 'warning',
        lastWarning: 'Synthetic digest has a missing source.',
      },
    })
  );
  for (const [id, label] of [
    ['acme-collector', 'Acme source collector'],
    ['acme-clean', 'Acme clean task'],
  ]) {
    await writeFile(
      path.join(root, 'manifests', `${id}.json`),
      JSON.stringify({
        id,
        label,
        kind: 'local-script',
        schedule: 'daily',
        script: `scripts/${id}.local.sh`,
        enabled: false,
        tags: ['synthetic', 'research'],
      })
    );
    await writeFile(
      path.join(root, 'scripts', `${id}.local.sh`),
      id === 'acme-collector'
        ? "#!/bin/bash\nprintf 'Synthetic item unavailable.\\n' >&2\nprintf '[job acme-collector] candidates=3 ingested=1 failed=1 skipped=1\\n'\n"
        : "#!/bin/bash\nprintf 'Synthetic clean task completed.\\n'\n",
      { mode: 0o700 }
    );
  }
  await writeFile(path.join(root, 'manifests', 'invalid.json'), '{"id":"invalid"}');
  await writeFile(
    path.join(root, 'status.json'),
    JSON.stringify({ 'acme-collector': partial, 'acme-clean': base })
  );
  for (const [id, builtIn] of [
    ['acme-collector', false],
    ['snapshot', true],
  ] as const) {
    const dir = path.join(root, builtIn ? 'built-in-runs' : 'runs', id);
    await mkdir(dir, { recursive: true });
    for (const [day, outcome] of [
      ['01', 'partial'],
      ['02', 'warning'],
      ['03', 'success'],
    ]) {
      const runId = `${id}-2026-10-${day}T12-00-00Z`;
      await writeFile(
        path.join(dir, `${runId}.json`),
        JSON.stringify({
          id,
          runId,
          startedAt: `2026-10-${day}T12:00:00Z`,
          finishedAt: `2026-10-${day}T12:00:01Z`,
          durationMs: 1000,
          outcome,
          exitCode: 0,
          warningCount: outcome === 'success' ? 0 : 1,
          diagnostics:
            outcome === 'success'
              ? []
              : [
                  {
                    ts: `2026-10-${day}T12:00:00Z`,
                    level: 'warn',
                    namespace: 'Research',
                    message: 'Synthetic source unavailable; retry required.',
                  },
                ],
          collection: { collected: 1, failed: outcome === 'partial' ? 1 : 0, skipped: 1 },
          stderr: outcome === 'success' ? '' : 'Synthetic collector warning',
          stdout: 'Fabricated collector output',
          dryRun: day === '02',
        })
      );
    }
  }
  const entries = [
    {
      ts: '2026-10-01T12:00:00Z',
      model: 'claude-sonnet-4-6',
      purpose: 'parse-synthetic',
      latencyMs: 1500,
      usage: { inputTokens: 1200, outputTokens: 300, cacheReadInputTokens: 20 },
      cost: { input: 0.0036, output: 0.0045, cacheRead: 0.000006, cacheWrite: 0, total: 0.008106 },
      ok: true,
      error: null,
      requestId: 'synthetic-call-1',
      stopReason: 'end_turn',
    },
    {
      ts: '2026-10-02T12:00:00Z',
      model: 'unpriced-synthetic-model',
      purpose: 'synthetic-research',
      latencyMs: 0,
      usage: { inputTokens: 10, outputTokens: 0 },
      cost: null,
      ok: false,
      error: 'Synthetic provider failure',
      requestId: 'synthetic-call-2',
      stopReason: null,
    },
    {
      ts: '2026-10-03T12:00:00Z',
      model: 'claude-sonnet-4-6',
      purpose: 'parse-synthetic',
      latencyMs: 500,
      usage: { inputTokens: 100, outputTokens: 50, cacheCreationInputTokens: 30 },
      cost: {
        input: 0.0003,
        output: 0.00075,
        cacheWrite: 0.0001125,
        cacheRead: 0,
        total: 0.0011625,
      },
      ok: true,
      error: null,
      requestId: 'synthetic-call-3',
      stopReason: 'end_turn',
    },
  ];
  await writeFile(
    path.join(dataDir, '.docvault-ai-usage.ndjson'),
    entries.map((e) => JSON.stringify(e)).join('\n') + '\n'
  );
  await mkdir(path.join(dataDir, 'logs'), { recursive: true });
  await writeFile(
    path.join(dataDir, 'logs', '2026-10-01.ndjson'),
    [
      {
        ts: '2026-10-01T12:00:00Z',
        level: 'info',
        namespace: 'Acme',
        message: 'Synthetic collection started.',
      },
      {
        ts: '2026-10-01T12:00:01Z',
        level: 'warn',
        namespace: 'Research',
        message: 'Synthetic source unavailable; retry required.',
      },
      {
        ts: '2026-10-01T12:00:02Z',
        level: 'error',
        namespace: 'Acme',
        message: 'Synthetic collector could not read one item.',
      },
      {
        ts: '2026-10-01T12:00:03Z',
        level: 'debug',
        namespace: 'Acme',
        message: 'Synthetic diagnostic context.',
      },
    ]
      .map((e) => JSON.stringify(e))
      .join('\n') + '\n'
  );
}
