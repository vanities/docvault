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
import { createLogger } from './logger.js';
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
// Slack so an interval tick that lands a few ms early still counts as due.
const DUE_TOLERANCE_MS = 60 * 1000;

export type CustomJobStatus = {
  lastRanAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastDurationMs: number | null;
  running: boolean;
  lastRunPath: string | null;
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
};

function emptyStatus(): CustomJobStatus {
  return {
    lastRanAt: null,
    lastSuccessAt: null,
    lastError: null,
    lastDurationMs: null,
    running: false,
    lastRunPath: null,
  };
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
    return JSON.parse(
      await fs.readFile(customJobStatusPath(dataDir), 'utf8')
    ) as CustomJobStatusMap;
  } catch {
    return {};
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

function collectProcessOutput(child: ReturnType<typeof spawn>): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
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
    child.on('error', reject);
    child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

export async function runCustomJobNow(
  id: string,
  options: { dataDir?: string; dryRun?: boolean } = {}
): Promise<CustomJobRunResult> {
  const dataDir = options.dataDir ?? DATA_DIR;
  const dryRun = options.dryRun === true;
  const manifest = await findCustomJobManifest(id, dataDir);
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  await patchCustomJobStatus(dataDir, id, { lastRanAt: startedAt, running: true, lastError: null });

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
    });
    const { exitCode, stdout, stderr } = await collectProcessOutput(child);
    const finishedAt = new Date().toISOString();
    const durationMs = Date.now() - t0;
    const runId = `${manifest.id}-${startedAt.replace(/[:.]/g, '-')}`;
    const runDir = path.join(customJobRunsDir(dataDir), manifest.id);
    await fs.mkdir(runDir, { recursive: true });
    const runPath = path.join(runDir, `${runId}.json`);
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
    };
    await fs.writeFile(runPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
    // Serialize the shared NDJSON append too — large stdout/stderr payloads can
    // exceed the atomic-append size, so concurrent appends could interleave.
    await withJobsFileLock(() =>
      fs.appendFile(customJobLogsPath(dataDir), `${JSON.stringify(result)}\n`)
    );

    await patchCustomJobStatus(dataDir, id, {
      lastSuccessAt: exitCode === 0 ? finishedAt : null,
      lastError: exitCode === 0 ? null : `exit ${exitCode}: ${stderr.trim() || stdout.trim()}`,
      lastDurationMs: durationMs,
      running: false,
      lastRunPath: runPath,
    });
    if (exitCode !== 0) logJobs.warn(`Custom job ${id} exited ${exitCode}`);
    return result;
  } catch (err) {
    const durationMs = Date.now() - t0;
    const message = err instanceof Error ? err.message : String(err);
    await patchCustomJobStatus(dataDir, id, {
      lastError: message,
      lastDurationMs: durationMs,
      running: false,
    });
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
    const checkMs = Math.min(intervalMs, MAX_CHECK_INTERVAL_MS);
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
