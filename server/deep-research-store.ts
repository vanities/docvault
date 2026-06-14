// Deep Research run store + async orchestration.
//
// A thorough run takes 1-4 minutes, so it can't be a blocking request. Instead
// a run is a background job: startResearchRun() persists a `running` record,
// fires the actual research without awaiting, and patches the record to `done`
// or `error` on completion. The client polls getRun(id). Runs persist to
// .docvault-deep-research.json so you can navigate away and come back.
//
// Caveat (v1): runs live in-process. If the server restarts mid-run the record
// is left `running` — acceptable for a single-user app; a job queue would fix it.

import { promises as fs } from 'fs';
import path from 'path';
import { DATA_DIR } from './data.js';
import { createLogger } from './logger.js';
import { runDeepResearch, type ResearchSource } from './deep-research.js';

const log = createLogger('DeepResearchStore');
const STORE_PATH = path.join(DATA_DIR, '.docvault-deep-research.json');

export interface ResearchRun {
  id: string;
  question: string;
  status: 'running' | 'done' | 'error';
  maxSearches: number;
  report?: string;
  sources?: ResearchSource[];
  searchCount?: number;
  usage?: { inputTokens: number; outputTokens: number };
  generatedBy?: { model: string; billing: 'subscription' | 'api'; backend: string };
  error?: string;
  createdAt: string;
  completedAt?: string;
}

/** A run minus the heavy fields — for the history list. */
export interface ResearchRunSummary {
  id: string;
  question: string;
  status: ResearchRun['status'];
  searchCount?: number;
  sourceCount: number;
  usage?: ResearchRun['usage'];
  error?: string;
  createdAt: string;
  completedAt?: string;
}

/** The research runner — injectable so tests can drive the store without Claude. */
export type Runner = typeof runDeepResearch;

async function loadRuns(): Promise<Record<string, ResearchRun>> {
  try {
    return JSON.parse(await fs.readFile(STORE_PATH, 'utf-8')) as Record<string, ResearchRun>;
  } catch {
    return {};
  }
}

async function saveRuns(runs: Record<string, ResearchRun>): Promise<void> {
  await fs.writeFile(STORE_PATH, JSON.stringify(runs, null, 2));
}

async function patchRun(id: string, patch: Partial<ResearchRun>): Promise<void> {
  const runs = await loadRuns();
  if (runs[id]) {
    runs[id] = { ...runs[id], ...patch };
    await saveRuns(runs);
  }
}

/** Persist a `running` record, fire the research in the background, return its id. */
export async function startResearchRun(
  question: string,
  maxSearches: number,
  runner: Runner = runDeepResearch
): Promise<string> {
  const id = crypto.randomUUID();
  const runs = await loadRuns();
  runs[id] = {
    id,
    question,
    status: 'running',
    maxSearches,
    createdAt: new Date().toISOString(),
  };
  await saveRuns(runs);

  // Background — the caller does not await this; the client polls getRun(id).
  void runner(question, { maxSearches })
    .then((result) =>
      patchRun(id, {
        status: 'done',
        report: result.report,
        sources: result.sources,
        searchCount: result.searchCount,
        usage: result.usage,
        generatedBy: result.generatedBy,
        completedAt: new Date().toISOString(),
      })
    )
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`Run ${id} failed: ${message}`);
      return patchRun(id, {
        status: 'error',
        error: message,
        completedAt: new Date().toISOString(),
      });
    });

  return id;
}

export async function getRun(id: string): Promise<ResearchRun | null> {
  return (await loadRuns())[id] ?? null;
}

export async function listRuns(): Promise<ResearchRunSummary[]> {
  const runs = await loadRuns();
  return Object.values(runs)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((r) => ({
      id: r.id,
      question: r.question,
      status: r.status,
      searchCount: r.searchCount,
      sourceCount: r.sources?.length ?? 0,
      usage: r.usage,
      error: r.error,
      createdAt: r.createdAt,
      completedAt: r.completedAt,
    }));
}

export async function deleteRun(id: string): Promise<void> {
  const runs = await loadRuns();
  delete runs[id];
  await saveRuns(runs);
}
