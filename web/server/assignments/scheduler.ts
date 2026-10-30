// Wakes assignments when their next check is due. Each run's own state lives in the index, so the
// poll just reads it; started from index.ts at boot, never on import.
import { createLogger } from '../logger.js';
import { chatTurnsRunning } from '../routes/chat.js';
import {
  defaultRunnerDeps,
  isRunInFlight,
  recoverInterruptedRuns,
  requestRun,
  type RunnerDeps,
} from './runner.js';
import { loadIndex } from './store.js';
import type { Assignment } from './types.js';

const log = createLogger('Assignments');

const TICK_MS = 60_000;

export function isAssignmentDue(a: Assignment, now: number, pausedAll: boolean): boolean {
  if (pausedAll || a.status !== 'active' || a.running || a.pendingRun) return false;
  const next = Date.parse(a.nextCheckAt ?? '');
  return Number.isFinite(next) && now >= next;
}

let ticking = false;

/** One scheduler pass; returns how many assignments it ran. */
export async function runDueAssignments(deps: RunnerDeps = defaultRunnerDeps()): Promise<number> {
  if (ticking) return 0;
  ticking = true;
  const t0 = performance.now();
  try {
    const index = await loadIndex(deps.dataDir);
    // A run marked running with nothing behind it threw past its own cleanup.
    if (Object.values(index.assignments).some((a) => a.running && !isRunInFlight(a.id))) {
      await recoverInterruptedRuns(deps);
    }
    const now = deps.now().getTime();
    const due = Object.values(index.assignments)
      .filter((a) => isAssignmentDue(a, now, index.pausedAll))
      .sort((x, y) => (x.nextCheckAt ?? '').localeCompare(y.nextCheckAt ?? ''));
    let ran = 0;
    for (const a of due) {
      // The owner's own chat draws on the same subscription; let it finish first.
      if (chatTurnsRunning() > 0) {
        log.debug(`[tick] waiting: a chat turn is in progress (${due.length - ran} due)`);
        break;
      }
      await requestRun(a.id, 'scheduled', deps);
      ran += 1;
    }
    if (ran > 0) {
      log.info(`[tick] ran ${ran}/${due.length} due in ${(performance.now() - t0).toFixed(0)}ms`);
    }
    return ran;
  } catch (err) {
    log.error(`[tick] failed: ${(err as Error).message}`);
    return 0;
  } finally {
    ticking = false;
  }
}

export function startAssignmentScheduler(deps: RunnerDeps = defaultRunnerDeps()): () => void {
  void recoverInterruptedRuns(deps)
    .then((n) => {
      if (n > 0) log.warn(`[boot] recovered ${n} interrupted run(s)`);
    })
    .catch((err: Error) => log.error(`[boot] recovery failed: ${err.message}`))
    .finally(() => void runDueAssignments(deps));
  const timer = setInterval(() => void runDueAssignments(deps), TICK_MS);
  log.info(`[boot] scheduler polling every ${TICK_MS / 1000}s`);
  return () => clearInterval(timer);
}
