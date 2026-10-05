import { promises as fs } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { DATA_DIR } from './data.js';
import {
  customJobScheduleToMs,
  customJobScriptPath,
  ensureJobsLayout,
  jobsRoot,
  listCustomJobManifests,
  prepareCustomJobScript,
} from './jobs.js';
import type { CustomJobManifest } from './jobs.js';
import { captureLogs, createLogger, type LogEntry } from './logger.js';
import {
  listAutomationRuns,
  selectRunDiagnostics,
  type AutomationOutcome,
} from './automation-runs.js';
import { collectionCounts, type CollectionCounts } from './collection-summary.js';
export { collectionCounts } from './collection-summary.js';
import { seedExampleJobs } from './seed-example-jobs.js';

const logJobs = createLogger('Jobs');

type Timer = ReturnType<typeof setInterval>;

const timers = new Map<string, Timer>();

// Example jobs are seeded at most once per process (at boot), guarded here so
// the scheduler restarts triggered by every job CRUD op don't re-scan the
// bundle. The seeder is idempotent anyway; this just avoids redundant I/O.
let exampleSeedDone = false;

// Serializes every read-modify-write of the shared jobs files (status.json +
// runs.ndjson). All daily jobs share one boot time, so their timers fire in the
// same event-loop tick — without this lock, concurrent load→modify→write cycles
// on status.json lose each other's updates (a job reads before a peer's write
// lands, then clobbers it on write-back). One in-process promise chain suffices
// because every run lives in the same process.
let jobsFileChain: Promise<unknown> = Promise.resolve();

function withJobsFileLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = jobsFileChain.then(fn, fn);
  // Keep the chain alive but swallow its outcome so one failure can't poison it.
  jobsFileChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

// Floor between attempts — suppresses a "storm" of catch-up runs when the
// container is redeployed several times in quick succession.
const MIN_RETRY_MS = 10 * 60 * 1000;
// Cap on the re-check cadence: even a daily job is polled at least hourly so a
// missed run is recovered within the hour rather than a full interval later.
const MAX_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const RETRY_BASE_MS = 15 * 60 * 1000;
const RETRY_MAX_MS = 6 * 60 * 60 * 1000;
// Slack so an interval tick that lands a few ms early still counts as due.
const DUE_TOLERANCE_MS = 60 * 1000;

export type CustomJobStatus = {
  lastRanAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastDurationMs: number | null;
  running: boolean;
  lastRunPath: string | null;
  /**
   * Tail of stdout from the last *successful* run — the job's own summary of
   * what it fetched (e.g. "items=19 matched=19 posted=5 ..."). Preserved across
   * later failures (a failed run shows lastError instead), so this always
   * reflects the most recent good fetch. null until a job first succeeds.
   */
  lastSummary: string | null;
  lastOutcome?: AutomationOutcome;
  lastCollection?: CollectionCounts | null;
  lastAttemptSummary?: string | null;
  consecutiveFailures?: number;
  nextRetryAt?: string | null;
  lastWarning?: string | null;
  warningCount?: number;
  lastCleanSuccessAt?: string | null;
};

export type CustomJobStatusMap = Record<string, CustomJobStatus>;

export type CustomJobRunResult = {
  id: string;
  runId: string;
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  runPath: string;
  outcome: AutomationOutcome;
  collection: CollectionCounts | null;
  diagnostics: LogEntry[];
  warningCount: number;
  error?: string | null;
};

function emptyStatus(): CustomJobStatus {
  return {
    lastRanAt: null,
    lastSuccessAt: null,
    lastError: null,
    lastDurationMs: null,
    running: false,
    lastRunPath: null,
    lastSummary: null,
  };
}

const SUMMARY_MAX_CHARS = 240;

/**
 * Reduce a run's stdout to a one-line summary for the Jobs UI: the last
 * non-empty line (every bundled job ends with a rollup like
 * "[job ...] items=N posted=M ..."), trimmed to a card-friendly length.
 */
function summarizeStdout(stdout: string): string | null {
  const lines = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  const last = lines[lines.length - 1];
  return last.length > SUMMARY_MAX_CHARS ? `${last.slice(0, SUMMARY_MAX_CHARS - 1)}…` : last;
}

function incompleteMessage(counts: CollectionCounts): string {
  return `Collection incomplete: ${counts.collected} collected, ${counts.failed} failed, ${counts.skipped} skipped`;
}

export function customJobSourceWarnings(
  manifests: CustomJobManifest[],
  statuses: CustomJobStatusMap
): Array<{ source: string; message: string }> {
  return manifests.flatMap((manifest) => {
    if (!manifest.enabled) return [];
    const status = statuses[manifest.id];
    if (!status?.lastError) return [];
    const summary = status.lastCollection
      ? incompleteMessage(status.lastCollection)
      : status.lastError.replace(/\s+/g, ' ').slice(0, 200);
    const retry = status.running
      ? ' Retry is running.'
      : status.nextRetryAt
        ? ` Next retry: ${status.nextRetryAt}.`
        : '';
    return [
      { source: `collection/${manifest.id}`, message: `${manifest.label}: ${summary}.${retry}` },
    ];
  });
}

function customJobStatusPath(dataDir: string): string {
  return path.join(jobsRoot(dataDir), 'status.json');
}

function customJobRunsDir(dataDir: string): string {
  return path.join(jobsRoot(dataDir), 'runs');
}

function customJobLogsPath(dataDir: string): string {
  return path.join(jobsRoot(dataDir), 'logs', 'runs.ndjson');
}

export async function loadCustomJobStatus(dataDir: string = DATA_DIR): Promise<CustomJobStatusMap> {
  try {
    const statuses = JSON.parse(
      await fs.readFile(customJobStatusPath(dataDir), 'utf8')
    ) as CustomJobStatusMap;
    // Surface failures from old collector runs immediately on upgrade. Their
    // zero exit codes incorrectly advanced lastSuccessAt; don't trust that
    // timestamp to delay the next attempt for a full day.
    for (const [id, status] of Object.entries(statuses)) {
      const counts = collectionCounts(status.lastSummary ?? '');
      if (!status.lastOutcome && counts?.failed) {
        status.lastOutcome = counts.collected > 0 ? 'partial' : 'error';
        status.lastCollection = counts;
        status.lastError = incompleteMessage(counts);
        status.consecutiveFailures = 1;
        const previous = (
          await listAutomationRuns(dataDir, id, false, { hydrateDiagnostics: false })
        ).find((run) => run.outcome === 'success' || run.outcome === 'warning');
        status.lastSuccessAt = previous?.finishedAt ?? null;
        const lastRan = Date.parse(status.lastRanAt ?? '');
        if (Number.isFinite(lastRan)) {
          status.nextRetryAt = new Date(lastRan + RETRY_BASE_MS).toISOString();
        }
      }
    }
    return statuses;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    logJobs.error(
      `Could not read custom job status: ${err instanceof Error ? err.message : String(err)}`
    );
    throw err;
  }
}

async function writeCustomJobStatus(dataDir: string, status: CustomJobStatusMap): Promise<void> {
  await ensureJobsLayout(dataDir);
  const finalPath = customJobStatusPath(dataDir);
  // Write to a temp file then rename — rename is atomic on a single filesystem,
  // so a concurrent reader never observes a half-written status file.
  const tmpPath = `${finalPath}.${process.pid}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(status, null, 2)}\n`);
  await fs.rename(tmpPath, finalPath);
}

async function patchCustomJobStatus(
  dataDir: string,
  id: string,
  patch: Partial<CustomJobStatus>
): Promise<CustomJobStatus> {
  // Serialize the whole load→modify→write so simultaneous job runs can't lose
  // each other's updates to the shared status.json.
  return withJobsFileLock(async () => {
    const status = await loadCustomJobStatus(dataDir);
    status[id] = { ...emptyStatus(), ...status[id], ...patch };
    await writeCustomJobStatus(dataDir, status);
    return status[id];
  });
}

async function findCustomJobManifest(id: string, dataDir: string): Promise<CustomJobManifest> {
  const records = await listCustomJobManifests(dataDir);
  const record = records.find((candidate) =>
    candidate.status === 'valid' ? candidate.manifest.id === id : false
  );
  if (!record || record.status !== 'valid') throw new Error(`custom job not found: ${id}`);
  return record.manifest;
}

function commandForScript(scriptPath: string): { cmd: string; args: string[] } {
  if (scriptPath.endsWith('.local.sh')) return { cmd: 'bash', args: [scriptPath] };
  return { cmd: 'bun', args: ['run', scriptPath] };
}

const JOB_OUTPUT_RETAIN_BYTES = Number(process.env.DOCVAULT_JOB_OUTPUT_RETAIN_BYTES) || 64 * 1024;

function truncateOutput(value: string, label: 'stdout' | 'stderr'): string {
  if (Buffer.byteLength(value, 'utf8') <= JOB_OUTPUT_RETAIN_BYTES) return value;
  const bytes = Buffer.from(value, 'utf8');
  const half = Math.floor(JOB_OUTPUT_RETAIN_BYTES / 2);
  return `${bytes.subarray(0, half).toString('utf8')}\n[truncated ${label} to ${JOB_OUTPUT_RETAIN_BYTES} bytes]\n${bytes.subarray(-half).toString('utf8')}`;
}

function collectProcessOutput(
  child: ReturnType<typeof spawn>,
  timeoutMs: number
): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });
    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        /* Process already exited. */
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill('SIGTERM');
      killTimer = setTimeout(() => kill('SIGKILL'), 5_000);
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(killTimer);
    };
    child.on('error', (err) => {
      cleanup();
      reject(err);
    });
    child.on('close', (exitCode) => {
      cleanup();
      resolve({ exitCode, stdout, stderr, timedOut });
    });
  });
}

async function persistCustomRun(dataDir: string, result: CustomJobRunResult): Promise<void> {
  await fs.mkdir(path.dirname(result.runPath), { recursive: true });
  const temp = `${result.runPath}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temp, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temp, result.runPath);
  } finally {
    await fs.unlink(temp).catch(() => {});
  }
  await withJobsFileLock(() =>
    fs.appendFile(customJobLogsPath(dataDir), `${JSON.stringify(result)}\n`)
  );
}

const activeJobs = new Map<string, { dryRun: boolean; run: Promise<CustomJobRunResult> }>();

export function runCustomJobNow(
  id: string,
  options: { dataDir?: string; dryRun?: boolean; timeoutMs?: number } = {}
): Promise<CustomJobRunResult> {
  const key = `${path.resolve(options.dataDir ?? DATA_DIR)}:${id}`;
  const active = activeJobs.get(key);
  if (active) {
    if (active.dryRun !== (options.dryRun === true)) {
      return Promise.reject(
        new Error('Job is already running in a different mode; wait for it to finish')
      );
    }
    return active.run;
  }
  const run = executeCustomJob(id, options).finally(() => activeJobs.delete(key));
  activeJobs.set(key, { dryRun: options.dryRun === true, run });
  return run;
}

async function executeCustomJob(
  id: string,
  options: { dataDir?: string; dryRun?: boolean; timeoutMs?: number }
): Promise<CustomJobRunResult> {
  const dataDir = options.dataDir ?? DATA_DIR;
  const dryRun = options.dryRun === true;
  const manifest = await findCustomJobManifest(id, dataDir);
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const timeoutMs =
    options.timeoutMs ?? (Number(process.env.DOCVAULT_JOB_TIMEOUT_MS) || 60 * 60 * 1000);
  const runId = `${manifest.id}-${startedAt.replace(/[:.]/g, '-')}`;
  const runPath = path.join(customJobRunsDir(dataDir), manifest.id, `${runId}.json`);
  const previous = (await loadCustomJobStatus(dataDir))[id];
  await patchCustomJobStatus(dataDir, id, {
    ...(!dryRun ? { lastRanAt: startedAt } : {}),
    running: true,
  });
  const stopCapture = captureLogs(/^(Research|YouTubeTranscript)$/);
  logJobs.info(`[run] job=${id} startedAt=${startedAt} dryRun=${dryRun}`);

  try {
    const scriptPath = customJobScriptPath(dataDir, manifest.script);
    await prepareCustomJobScript({}, manifest, { dataDir, overwrite: true });
    await fs.access(scriptPath);
    const { cmd, args } = commandForScript(scriptPath);
    const child = spawn(cmd, args, {
      cwd: jobsRoot(dataDir),
      env: {
        ...process.env,
        DOCVAULT_DATA_DIR: dataDir,
        DOCVAULT_JOB_ID: manifest.id,
        DOCVAULT_JOB_LABEL: manifest.label,
        DOCVAULT_JOB_ENABLED: String(manifest.enabled),
        DOCVAULT_JOB_DRY_RUN: dryRun ? '1' : '0',
        DOCVAULT_DRY_RUN: dryRun ? '1' : '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    const {
      exitCode,
      stdout: rawStdout,
      stderr: rawStderr,
      timedOut,
    } = await collectProcessOutput(child, timeoutMs);
    const collection = collectionCounts(rawStdout);
    const stdout = truncateOutput(rawStdout, 'stdout');
    const stderr = truncateOutput(rawStderr, 'stderr');
    const finishedAt = new Date().toISOString();
    const diagnostics = selectRunDiagnostics(stopCapture(), {
      startedAt,
      finishedAt,
      stdout: rawStdout,
    });
    const warnings = diagnostics.filter(
      (entry) => entry.level === 'warn' || entry.level === 'error'
    );
    const warningCount = warnings.length + (rawStderr.trim() ? 1 : 0);
    const outcome: AutomationOutcome =
      timedOut || exitCode !== 0
        ? 'error'
        : collection?.failed
          ? collection.collected
            ? 'partial'
            : 'error'
          : warningCount
            ? 'warning'
            : 'success';
    const completed = outcome === 'success' || outcome === 'warning';
    const durationMs = Date.now() - t0;
    const detail = rawStderr.trim().split('\n').filter(Boolean).at(-1)?.slice(0, 400);
    const lastError = completed
      ? null
      : (timedOut
          ? `Job exceeded its ${Math.round(timeoutMs / 1000)}s time budget`
          : collection?.failed
            ? incompleteMessage(collection)
            : `Script exited ${exitCode}`) + (detail ? `: ${detail}` : '');
    const result: CustomJobRunResult = {
      id: manifest.id,
      runId,
      dryRun,
      startedAt,
      finishedAt,
      durationMs,
      exitCode,
      stdout,
      stderr,
      runPath,
      outcome,
      collection,
      diagnostics,
      warningCount,
      error: lastError,
    };
    await persistCustomRun(dataDir, result);

    const failures = completed ? 0 : (previous?.consecutiveFailures ?? 0) + 1;
    const nextRetryAt = failures
      ? new Date(
          Date.now() + Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(failures - 1, 5))
        ).toISOString()
      : null;
    await patchCustomJobStatus(
      dataDir,
      id,
      dryRun
        ? { running: false, lastRunPath: runPath }
        : {
            ...(completed ? { lastSuccessAt: finishedAt } : {}),
            ...(outcome === 'success' ? { lastCleanSuccessAt: finishedAt } : {}),
            lastError,
            lastDurationMs: durationMs,
            running: false,
            lastRunPath: runPath,
            lastOutcome: outcome,
            lastCollection: collection,
            lastAttemptSummary: summarizeStdout(rawStdout),
            consecutiveFailures: failures,
            nextRetryAt,
            warningCount,
            lastWarning: warningCount
              ? (warnings.at(-1)?.message ?? detail ?? 'Collector reported warnings').slice(0, 500)
              : null,
            // Only refresh the summary on success, so a later failure leaves the last
            // good fetch's summary intact (the UI surfaces lastError in that case).
            ...(completed ? { lastSummary: summarizeStdout(rawStdout) } : {}),
          }
    );
    const message =
      `[run] job=${id} runId=${runId} outcome=${outcome} exit=${exitCode} ` +
      `collected=${collection?.collected ?? 'unknown'} failed=${collection?.failed ?? 'unknown'} ` +
      `skipped=${collection?.skipped ?? 'unknown'} durationMs=${durationMs} retryAt=${nextRetryAt ?? 'none'}`;
    if (outcome === 'success') logJobs.info(message);
    else
      logJobs.warn(
        `${message} reason=${lastError ?? result.diagnostics.filter((entry) => entry.level !== 'info').at(-1)?.message ?? detail ?? 'Collector reported warnings'}`
      );
    return result;
  } catch (err) {
    const diagnostics = stopCapture();
    const durationMs = Date.now() - t0;
    const message = err instanceof Error ? err.message : String(err);
    const failedRun: CustomJobRunResult = {
      id,
      runId,
      dryRun,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs,
      exitCode: null,
      stdout: '',
      stderr: message,
      runPath,
      outcome: 'error',
      collection: null,
      diagnostics,
      warningCount: 1,
      error: message,
    };
    let persisted = false;
    try {
      await persistCustomRun(dataDir, failedRun);
      persisted = true;
    } catch (historyError) {
      logJobs.error(`Could not save failed run history for ${id}: ${String(historyError)}`);
    }
    await patchCustomJobStatus(
      dataDir,
      id,
      dryRun
        ? { running: false }
        : {
            lastError: message,
            lastDurationMs: durationMs,
            running: false,
            lastOutcome: 'error',
            lastCollection: null,
            lastWarning: null,
            warningCount: 1,
            ...(persisted ? { lastRunPath: runPath } : {}),
            consecutiveFailures: (previous?.consecutiveFailures ?? 0) + 1,
            nextRetryAt: new Date(
              Date.now() +
                Math.min(
                  RETRY_MAX_MS,
                  RETRY_BASE_MS * 2 ** Math.min(previous?.consecutiveFailures ?? 0, 5)
                )
            ).toISOString(),
          }
    );
    logJobs.error(`[run] job=${id} outcome=error durationMs=${durationMs} reason=${message}`);
    throw err;
  }
}

/**
 * A job is due when it has never succeeded, or its last success is at least one
 * interval old. A recent *attempt* (success or failure) within MIN_RETRY_MS
 * suppresses it, so rapid redeploys don't trigger a storm of catch-up runs and
 * a transient failure isn't retried tighter than that floor.
 */
export function isCustomJobDue(
  status: CustomJobStatus | undefined,
  intervalMs: number,
  now: number
): boolean {
  const lastRan = status?.lastRanAt ? Date.parse(status.lastRanAt) : NaN;
  if (!Number.isNaN(lastRan) && now - lastRan < MIN_RETRY_MS) return false;
  const retryAt = Date.parse(status?.nextRetryAt ?? '');
  if (status?.lastError && Number.isFinite(retryAt)) return now >= retryAt;
  const lastSuccess = status?.lastSuccessAt ? Date.parse(status.lastSuccessAt) : NaN;
  if (Number.isNaN(lastSuccess)) return true; // never succeeded → due
  return now - lastSuccess >= intervalMs - DUE_TOLERANCE_MS;
}

/** Runs a job iff it is currently due, deciding from the persisted status. */
function runIfDue(id: string, intervalMs: number, dataDir: string): void {
  loadCustomJobStatus(dataDir)
    .then((statusMap) => {
      if (!isCustomJobDue(statusMap[id], intervalMs, Date.now())) return undefined;
      return runCustomJobNow(id, { dataDir });
    })
    .catch((err) =>
      logJobs.error(`Custom job ${id} failed:`, err instanceof Error ? err.message : String(err))
    );
}

export async function startCustomJobScheduler(dataDir: string = DATA_DIR): Promise<void> {
  for (const timer of timers.values()) clearInterval(timer);
  timers.clear();
  const statuses = await loadCustomJobStatus(dataDir);
  for (const [id, status] of Object.entries(statuses)) {
    if (status.running && !activeJobs.has(`${path.resolve(dataDir)}:${id}`)) {
      await patchCustomJobStatus(dataDir, id, {
        running: false,
        lastOutcome: 'error',
        lastError: 'Interrupted by a server restart before completion',
        nextRetryAt: new Date(Date.now() + RETRY_BASE_MS).toISOString(),
      });
    }
  }

  // Seed bundled example jobs (disabled) before reading manifests, so a fresh
  // install surfaces them in Settings → Jobs immediately. Idempotent +
  // non-destructive (marker-tracked); never blocks scheduling.
  if (!exampleSeedDone) {
    exampleSeedDone = true;
    try {
      await seedExampleJobs(dataDir);
    } catch (err) {
      logJobs.warn(
        `Example job seeding failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  const records = await listCustomJobManifests(dataDir);
  for (const record of records) {
    if (record.status !== 'valid' || !record.manifest.enabled) continue;
    const intervalMs = customJobScheduleToMs(record.manifest.schedule);
    const id = record.manifest.id;

    // Catch-up on boot: an in-process setInterval resets to zero on every
    // restart and never fires on boot, so without this a job is silently
    // skipped whenever the container is recreated (deploys, NAS reboots) more
    // often than its interval. Run any overdue job immediately instead.
    runIfDue(id, intervalMs, dataDir);

    // Poll on a capped cadence and decide from the *persisted* lastSuccessAt
    // (not wall-clock-from-boot), so due-ness survives restarts and a missed
    // run is recovered within at most one check interval rather than drifting.
    const checkMs = Math.min(intervalMs, MAX_CHECK_INTERVAL_MS, RETRY_BASE_MS);
    timers.set(
      id,
      setInterval(() => runIfDue(id, intervalMs, dataDir), checkMs)
    );
    logJobs.info(
      `Custom job ${id}: every ${Math.round(intervalMs / 60000)}m (checked every ${Math.round(
        checkMs / 60000
      )}m)`
    );
  }
}
