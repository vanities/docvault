// Assignment files. The server is the only writer, so a stale browser tab can never overwrite a
// check-in (chat threads can't promise that: the client PUTs whole transcripts).
//
//   DATA_DIR/.docvault-assignments.json       index: every assignment's settings and state
//   DATA_DIR/assignments/<id>.json            transcript entries
//   DATA_DIR/assignments/<id>.runs.jsonl      run log; tool calls are appended as they happen
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DATA_DIR, ensureDir } from '../data.js';
import { createLogger } from '../logger.js';
import { createWriteLock, writeJsonAtomic } from '../write-lock.js';
import {
  LIMITS,
  type Assignment,
  type AssignmentsIndex,
  type RunLogLine,
  type TranscriptEntry,
} from './types.js';

const log = createLogger('Assignments');

export const ASSIGNMENTS_INDEX = '.docvault-assignments.json';
export const ASSIGNMENTS_DIR = 'assignments';

const withIndexLock = createWriteLock();
const withTranscriptLock = createWriteLock();
const withRunLogLock = createWriteLock();

const indexPath = (dataDir: string) => path.join(dataDir, ASSIGNMENTS_INDEX);
const transcriptPath = (dataDir: string, id: string) =>
  path.join(dataDir, ASSIGNMENTS_DIR, `${id}.json`);
const runLogPath = (dataDir: string, id: string) =>
  path.join(dataDir, ASSIGNMENTS_DIR, `${id}.runs.jsonl`);

export function isValidAssignmentId(id: string): boolean {
  return /^[0-9a-f-]{36}$/.test(id);
}

export function newId(): string {
  return randomUUID();
}

// A fresh object every call: callers mutate what they get back.
function emptyIndex(): AssignmentsIndex {
  return { version: 1, pausedAll: false, pausedAllReason: null, assignments: {} };
}

async function readIndex(dataDir: string): Promise<AssignmentsIndex> {
  try {
    const raw = JSON.parse(await fs.readFile(indexPath(dataDir), 'utf8')) as AssignmentsIndex;
    if (!raw || typeof raw !== 'object' || typeof raw.assignments !== 'object') return emptyIndex();
    return { ...emptyIndex(), ...raw, assignments: { ...raw.assignments } };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.error(`[store] unreadable index: ${(err as Error).message}`);
    }
    return emptyIndex();
  }
}

export function loadIndex(dataDir: string = DATA_DIR): Promise<AssignmentsIndex> {
  return readIndex(dataDir);
}

/** Read-modify-write the index under one lock, so concurrent runs and edits can't lose updates. */
export function updateIndex<T>(
  fn: (index: AssignmentsIndex) => T | Promise<T>,
  dataDir: string = DATA_DIR
): Promise<T> {
  return withIndexLock(async () => {
    const index = await readIndex(dataDir);
    const result = await fn(index);
    await writeJsonAtomic(indexPath(dataDir), index);
    return result;
  });
}

export async function loadTranscript(
  id: string,
  dataDir: string = DATA_DIR
): Promise<TranscriptEntry[]> {
  try {
    const raw = JSON.parse(await fs.readFile(transcriptPath(dataDir, id), 'utf8')) as {
      entries?: TranscriptEntry[];
    };
    return Array.isArray(raw.entries) ? raw.entries : [];
  } catch {
    return [];
  }
}

export function appendEntries(
  id: string,
  entries: TranscriptEntry[],
  dataDir: string = DATA_DIR
): Promise<void> {
  return withTranscriptLock(async () => {
    await ensureDir(path.join(dataDir, ASSIGNMENTS_DIR));
    const existing = await loadTranscript(id, dataDir);
    await writeJsonAtomic(transcriptPath(dataDir, id), { id, entries: [...existing, ...entries] });
  });
}

export function appendRunLog(
  id: string,
  line: RunLogLine,
  dataDir: string = DATA_DIR
): Promise<void> {
  return withRunLogLock(async () => {
    await ensureDir(path.join(dataDir, ASSIGNMENTS_DIR));
    const file = runLogPath(dataDir, id);
    await fs.appendFile(file, `${JSON.stringify(line)}\n`, 'utf8');
    if (line.event !== 'end') return;
    // Trim at run boundaries only, so an interrupted run's tool lines are never cut off.
    const lines = (await fs.readFile(file, 'utf8')).split('\n').filter(Boolean);
    if (lines.length > LIMITS.runLogMaxLines) {
      await fs.writeFile(file, `${lines.slice(-LIMITS.runLogMaxLines).join('\n')}\n`, 'utf8');
    }
  });
}

export async function readRunLog(id: string, dataDir: string = DATA_DIR): Promise<RunLogLine[]> {
  try {
    return (await fs.readFile(runLogPath(dataDir, id), 'utf8'))
      .split('\n')
      .filter(Boolean)
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as RunLogLine];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

export async function deleteAssignmentFiles(id: string, dataDir: string = DATA_DIR): Promise<void> {
  await Promise.all([
    fs.rm(transcriptPath(dataDir, id), { force: true }),
    fs.rm(runLogPath(dataDir, id), { force: true }),
  ]);
}

/** Defaults for a new assignment; the caller sets title, brief and cadence. */
export function blankAssignment(
  fields: Pick<Assignment, 'id' | 'title' | 'brief' | 'cadenceMinutes'>,
  nowIso: string
): Assignment {
  return {
    ...fields,
    status: 'active',
    notes: '',
    nextCheckAt: nowIso,
    running: null,
    pendingRun: null,
    unread: 0,
    lastRun: null,
    consecutiveFailures: 0,
    failureEmailedAt: null,
    counters: { day: '', runs: 0, emails: 0 },
    toolAllowlist: null,
    outcome: null,
    createdAt: nowIso,
    updatedAt: nowIso,
    closedAt: null,
  };
}
