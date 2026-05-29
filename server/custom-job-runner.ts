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

const logJobs = createLogger('Jobs');

type Timer = ReturnType<typeof setInterval>;

const timers = new Map<string, Timer>();

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
  await fs.writeFile(customJobStatusPath(dataDir), `${JSON.stringify(status, null, 2)}\n`);
}

async function patchCustomJobStatus(
  dataDir: string,
  id: string,
  patch: Partial<CustomJobStatus>
): Promise<CustomJobStatus> {
  const status = await loadCustomJobStatus(dataDir);
  status[id] = { ...emptyStatus(), ...status[id], ...patch };
  await writeCustomJobStatus(dataDir, status);
  return status[id];
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
  options: { dataDir?: string } = {}
): Promise<CustomJobRunResult> {
  const dataDir = options.dataDir ?? DATA_DIR;
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
      startedAt,
      finishedAt,
      durationMs,
      exitCode,
      stdout,
      stderr,
      runPath,
    };
    await fs.writeFile(runPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
    await fs.appendFile(customJobLogsPath(dataDir), `${JSON.stringify(result)}\n`);

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

export async function startCustomJobScheduler(dataDir: string = DATA_DIR): Promise<void> {
  for (const timer of timers.values()) clearInterval(timer);
  timers.clear();

  const records = await listCustomJobManifests(dataDir);
  for (const record of records) {
    if (record.status !== 'valid' || !record.manifest.enabled) continue;
    const intervalMs = customJobScheduleToMs(record.manifest.schedule);
    const id = record.manifest.id;
    timers.set(
      id,
      setInterval(() => {
        runCustomJobNow(id, { dataDir }).catch((err) =>
          logJobs.error(
            `Custom job ${id} failed:`,
            err instanceof Error ? err.message : String(err)
          )
        );
      }, intervalMs)
    );
    logJobs.info(`Custom job ${id}: every ${Math.round(intervalMs / 60000)}m`);
  }
}
