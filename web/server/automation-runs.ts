import { promises as fs } from 'fs';
import path from 'path';
import { createLogger, readLogsForDate, type LogEntry } from './logger.js';
import { writeJsonAtomic } from './write-lock.js';
import { collectionCounts } from './collection-summary.js';
import type { AutomationOutcome, AutomationRun } from './automation-types.js';

export type { AutomationOutcome, AutomationRun };

const log = createLogger('Jobs');

/** Match each custom run's actual video ids, rather than all Research logs
 * from the same time window (other channel jobs can run concurrently). */
export function selectRunDiagnostics(
  entries: LogEntry[],
  run: { startedAt: string; finishedAt: string; stdout?: string },
  namespacePattern?: RegExp
): LogEntry[] {
  const ids = [...(run.stdout ?? '').matchAll(/(?:[?&]v=|youtu\.be\/)([A-Za-z0-9_-]{11})/g)].map(
    (m) => m[1]
  );
  return entries.filter((entry) => {
    if (entry.ts < run.startedAt || entry.ts > run.finishedAt) return false;
    if (namespacePattern) return namespacePattern.test(entry.namespace);
    return (
      ['Research', 'YouTubeTranscript'].includes(entry.namespace) &&
      ids.some((id) => entry.message.includes(id))
    );
  });
}

function runDirectory(dataDir: string, id: string, builtIn: boolean): string {
  if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(id)) throw new Error('Invalid job id');
  return path.join(dataDir, 'jobs', builtIn ? 'built-in-runs' : 'runs', id);
}

export async function saveAutomationRun(dataDir: string, run: AutomationRun): Promise<void> {
  const dir = runDirectory(dataDir, run.id, true);
  await fs.mkdir(dir, { recursive: true });
  await writeJsonAtomic(path.join(dir, `${run.runId}.json`), run);
}

/** Read-only history. Paths are derived from a validated job id, never from a
 * caller-supplied filename or the mutable lastRunPath field. */
export async function listAutomationRuns(
  dataDir: string,
  id: string,
  builtIn = false,
  options: { hydrateDiagnostics?: boolean } = {}
): Promise<AutomationRun[]> {
  const dir = runDirectory(dataDir, id, builtIn);
  let files;
  try {
    files = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const realDir = await fs.realpath(dir);
  const realRoot = await fs.realpath(path.dirname(dir));
  if (path.dirname(realDir) !== realRoot)
    throw new Error('Run history path escapes the jobs directory');
  const names = files
    .filter((f) => f.isFile() && f.name.startsWith(`${id}-`) && f.name.endsWith('.json'))
    .map((f) => f.name)
    .sort()
    .reverse()
    .slice(0, 20);
  const runs: AutomationRun[] = [];
  for (const name of names) {
    try {
      const realFile = await fs.realpath(path.join(dir, name));
      if (path.dirname(realFile) !== realDir) continue;
      const run = JSON.parse(await fs.readFile(realFile, 'utf8')) as AutomationRun;
      if (run.id !== id) continue;
      // Older custom runs already have stdout/stderr but no diagnostics. Join
      // them to the persisted source logs when an admin opens the history.
      if (!Array.isArray(run.diagnostics) && options.hydrateDiagnostics !== false) {
        const dates = [...new Set([run.startedAt.slice(0, 10), run.finishedAt.slice(0, 10)])];
        const entries = (await Promise.all(dates.map((date) => readLogsForDate(date)))).flat();
        run.diagnostics = selectRunDiagnostics(entries, run);
      }
      run.diagnostics ??= [];
      run.warningCount ??=
        run.diagnostics.filter((e) => e.level === 'warn' || e.level === 'error').length +
        (run.stderr?.trim() ? 1 : 0);
      const counts = collectionCounts(run.stdout ?? '');
      if (run.collection == null && counts) run.collection = counts;
      run.outcome ??=
        run.exitCode !== 0
          ? 'error'
          : run.collection?.failed
            ? run.collection.collected
              ? 'partial'
              : 'error'
            : run.warningCount
              ? 'warning'
              : 'success';
      runs.push(run);
    } catch (err) {
      log.warn(
        `Could not read run ${id}/${name}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  return runs;
}
