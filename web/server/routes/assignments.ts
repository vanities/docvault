// /api/assignments — long-running AI threads that check in on their own (server/assignments/).
//
//   GET    /api/assignments                list (every field the page filters on) + pause-all state
//   GET    /api/assignments/summary        unread total for the sidebar badge
//   POST   /api/assignments                create { title, brief, cadenceMinutes?, startNow? }
//   POST   /api/assignments/pause-all      { paused }
//   GET    /api/assignments/:id            assignment + transcript + recent runs
//   PATCH  /api/assignments/:id            { title?, brief?, status?, cadenceMinutes?, toolAllowlist? }
//   DELETE /api/assignments/:id
//   POST   /api/assignments/:id/run        Run now (202; the page polls)
//   POST   /api/assignments/:id/messages   { text } — reply in the thread (202)
//   POST   /api/assignments/:id/read       clear the unread count
import { jsonResponse } from '../data.js';
import { readJsonBody } from '../http.js';
import { createLogger } from '../logger.js';
import { defaultRunnerDeps, requestRun, type RunnerDeps } from '../assignments/runner.js';
import {
  appendEntries,
  blankAssignment,
  deleteAssignmentFiles,
  isValidAssignmentId,
  loadIndex,
  loadTranscript,
  newId,
  readRunLog,
  updateIndex,
} from '../assignments/store.js';
import {
  LIMITS,
  type Assignment,
  type AssignmentStatus,
  type RunTrigger,
} from '../assignments/types.js';

const log = createLogger('Assignments');

const MAX_TITLE = 120;
const MAX_BRIEF = 8000;
const MAX_MESSAGE = 8000;

class BadRequest extends Error {}

function text(v: unknown, field: string, max: number): string {
  if (typeof v !== 'string' || !v.trim()) throw new BadRequest(`${field} is required`);
  if (v.length > max) throw new BadRequest(`${field} must be at most ${max} characters`);
  return v.trim();
}

function cadence(v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    throw new BadRequest('cadenceMinutes must be a whole number');
  }
  if (v < LIMITS.minIntervalMinutes || v > LIMITS.maxIntervalMinutes) {
    throw new BadRequest(
      `cadenceMinutes must be between ${LIMITS.minIntervalMinutes} and ${LIMITS.maxIntervalMinutes}`
    );
  }
  return v;
}

function allowlist(v: unknown): string[] | null {
  if (v === null) return null;
  if (!Array.isArray(v) || v.some((n) => typeof n !== 'string' || !n.trim())) {
    throw new BadRequest('toolAllowlist must be null or a list of tool names');
  }
  return [...new Set(v.map((n: string) => n.trim()))];
}

async function body<T>(req: Request): Promise<T> {
  try {
    return await readJsonBody<T>(req);
  } catch {
    throw new BadRequest('Invalid JSON body');
  }
}

function startRun(id: string, trigger: RunTrigger, deps: RunnerDeps): void {
  void requestRun(id, trigger, deps).catch((err: Error) =>
    log.error(`[route] ${trigger} run failed to start assignment=${id}: ${err.message}`)
  );
}

export async function handleAssignmentsRoutes(
  req: Request,
  _url: URL,
  pathname: string,
  deps: RunnerDeps = defaultRunnerDeps()
): Promise<Response | null> {
  if (pathname !== '/api/assignments' && !pathname.startsWith('/api/assignments/')) return null;
  const dataDir = deps.dataDir;
  const nowIso = () => deps.now().toISOString();
  try {
    if (pathname === '/api/assignments' && req.method === 'GET') {
      const index = await loadIndex(dataDir);
      const assignments = Object.values(index.assignments).sort((x, y) =>
        y.updatedAt.localeCompare(x.updatedAt)
      );
      return jsonResponse({
        assignments,
        pausedAll: index.pausedAll,
        pausedAllReason: index.pausedAllReason,
      });
    }

    if (pathname === '/api/assignments/summary' && req.method === 'GET') {
      const index = await loadIndex(dataDir);
      const all = Object.values(index.assignments);
      return jsonResponse({
        unread: all.reduce((n, a) => n + a.unread, 0),
        active: all.filter((a) => a.status === 'active').length,
        running: all.filter((a) => a.running).length,
        pausedAll: index.pausedAll,
      });
    }

    if (pathname === '/api/assignments' && req.method === 'POST') {
      const input = await body<{
        title?: unknown;
        brief?: unknown;
        cadenceMinutes?: unknown;
        startNow?: unknown;
      }>(req);
      const id = newId();
      const created = blankAssignment(
        {
          id,
          title: text(input.title, 'title', MAX_TITLE),
          brief: text(input.brief, 'brief', MAX_BRIEF),
          cadenceMinutes:
            input.cadenceMinutes === undefined
              ? LIMITS.defaultIntervalMinutes
              : cadence(input.cadenceMinutes),
        },
        nowIso()
      );
      await updateIndex((index) => {
        index.assignments[id] = created;
      }, dataDir);
      log.info(`[route] created assignment=${id} cadence=${created.cadenceMinutes}m`);
      if (input.startNow !== false) startRun(id, 'manual', deps);
      return jsonResponse({ assignment: created }, 201);
    }

    if (pathname === '/api/assignments/pause-all' && req.method === 'POST') {
      const input = await body<{ paused?: unknown }>(req);
      if (typeof input.paused !== 'boolean') throw new BadRequest('paused must be true or false');
      await updateIndex((index) => {
        index.pausedAll = input.paused as boolean;
        if (!index.pausedAll) index.pausedAllReason = null;
      }, dataDir);
      log.info(`[route] pausedAll=${input.paused}`);
      return jsonResponse({ ok: true, pausedAll: input.paused });
    }

    const match = /^\/api\/assignments\/([^/]+)(\/[a-z-]+)?$/.exec(pathname);
    if (!match || !isValidAssignmentId(match[1])) return null;
    const id = match[1];
    const sub = match[2] ?? '';
    const notFound = () => jsonResponse({ error: 'Assignment not found' }, 404);

    if (sub === '' && req.method === 'GET') {
      const assignment = (await loadIndex(dataDir)).assignments[id];
      if (!assignment) return notFound();
      const [entries, runLog] = await Promise.all([
        loadTranscript(id, dataDir),
        readRunLog(id, dataDir),
      ]);
      return jsonResponse({
        assignment,
        entries: entries.slice(-LIMITS.transcriptEntriesReturned),
        runs: runLog
          .filter((l) => l.event === 'end')
          .slice(-50)
          .reverse(),
      });
    }

    if (sub === '' && req.method === 'PATCH') {
      const input = await body<{
        title?: unknown;
        brief?: unknown;
        status?: unknown;
        cadenceMinutes?: unknown;
        toolAllowlist?: unknown;
      }>(req);
      const status = input.status as AssignmentStatus | undefined;
      if (status !== undefined && !['active', 'paused', 'closed'].includes(status)) {
        throw new BadRequest('status must be active, paused or closed');
      }
      const title = input.title === undefined ? undefined : text(input.title, 'title', MAX_TITLE);
      const brief = input.brief === undefined ? undefined : text(input.brief, 'brief', MAX_BRIEF);
      const cadenceMinutes =
        input.cadenceMinutes === undefined ? undefined : cadence(input.cadenceMinutes);
      const tools = input.toolAllowlist === undefined ? undefined : allowlist(input.toolAllowlist);
      const now = nowIso();
      const updated = await updateIndex((index): Assignment | null => {
        const a = index.assignments[id];
        if (!a) return null;
        if (title !== undefined) a.title = title;
        if (brief !== undefined) a.brief = brief;
        if (cadenceMinutes !== undefined) a.cadenceMinutes = cadenceMinutes;
        if (tools !== undefined) a.toolAllowlist = tools;
        if (status !== undefined && status !== a.status) {
          if (status === 'active') {
            // Resume or reopen: check in at the next tick.
            a.nextCheckAt = now;
            a.closedAt = null;
            if (a.status === 'closed') a.outcome = null;
          } else {
            a.nextCheckAt = null;
            if (status === 'closed') {
              a.closedAt = now;
              a.outcome = 'Closed by you';
            }
          }
          a.status = status;
        }
        a.updatedAt = now;
        return structuredClone(a);
      }, dataDir);
      if (!updated) return notFound();
      log.info(`[route] updated assignment=${id} fields=${Object.keys(input).join(',')}`);
      return jsonResponse({ assignment: updated });
    }

    if (sub === '' && req.method === 'DELETE') {
      const removed = await updateIndex((index) => {
        const a = index.assignments[id];
        if (!a) return 'missing' as const;
        if (a.running) return 'running' as const;
        delete index.assignments[id];
        return 'removed' as const;
      }, dataDir);
      if (removed === 'missing') return notFound();
      if (removed === 'running') {
        return jsonResponse({ error: 'A check-in is running; wait for it to finish' }, 409);
      }
      await deleteAssignmentFiles(id, dataDir);
      log.info(`[route] deleted assignment=${id}`);
      return jsonResponse({ ok: true });
    }

    if (sub === '/run' && req.method === 'POST') {
      const a = (await loadIndex(dataDir)).assignments[id];
      if (!a) return notFound();
      if (a.running || a.pendingRun) {
        return jsonResponse({ error: 'A check-in is already running or queued' }, 409);
      }
      startRun(id, 'manual', deps);
      return jsonResponse({ queued: true }, 202);
    }

    if (sub === '/messages' && req.method === 'POST') {
      const input = await body<{ text?: unknown }>(req);
      const message = text(input.text, 'text', MAX_MESSAGE);
      const a = (await loadIndex(dataDir)).assignments[id];
      if (!a) return notFound();
      await appendEntries(
        id,
        [{ id: newId(), at: nowIso(), kind: 'you', markdown: message }],
        dataDir
      );
      // A queued run reads every message since the last run, so one is enough. A run already in
      // progress built its prompt before this message, so a reply run queues behind it.
      if (!a.pendingRun) startRun(id, 'message', deps);
      return jsonResponse({ queued: true }, 202);
    }

    if (sub === '/read' && req.method === 'POST') {
      const found = await updateIndex((index) => {
        const a = index.assignments[id];
        if (!a) return false;
        a.unread = 0;
        return true;
      }, dataDir);
      return found ? jsonResponse({ ok: true }) : notFound();
    }

    return null;
  } catch (err) {
    if (err instanceof BadRequest) return jsonResponse({ error: err.message }, 400);
    log.error(`[route] ${req.method} ${pathname} failed: ${(err as Error).message}`);
    return jsonResponse({ error: 'Assignments request failed' }, 500);
  }
}
