// Append-only NDJSON log of every Claude API call made by DocVault.
// One line per call — safe for concurrent writers because Node/Bun's
// `appendFile` is atomic at the syscall level for small buffers.
//
// Location: $DATA_DIR/.docvault-ai-usage.ndjson
//
// Use cases:
//  - "How much did that batch parse cost me?"  -> summarizeUsage()
//  - "What did Claude actually return?"        -> readRecentAiCalls()
//  - Model comparison when switching later     -> filter by entry.model

import { promises as fs } from 'fs';
import path from 'path';
import { DATA_DIR } from '../data.js';
import { createLogger } from '../logger.js';
import { calculateCost, type UsageTokens, type CostBreakdown } from './pricing.js';

const log = createLogger('AIUsage');

export const AI_USAGE_LOG_FILE = path.join(DATA_DIR, '.docvault-ai-usage.ndjson');

export interface AiUsageEntry {
  ts: string;
  model: string;
  /** Logical label: e.g. "parse-w2", "detect-type", "parse-receipt". */
  purpose: string;
  latencyMs: number;
  usage: UsageTokens;
  cost: CostBreakdown | null;
  ok: boolean;
  error: string | null;
  requestId: string | null;
  stopReason: string | null;
}

export interface LogAiCallInput {
  model: string;
  purpose: string;
  latencyMs: number;
  usage: UsageTokens;
  ok: boolean;
  error?: string | null;
  requestId?: string | null;
  stopReason?: string | null;
}

/**
 * Append a single usage entry. Never throws — a logging failure must
 * not fail the underlying Claude call the caller is recording.
 * `filePath` is for tests; production always uses AI_USAGE_LOG_FILE.
 */
export async function logAiCall(
  input: LogAiCallInput,
  filePath: string = AI_USAGE_LOG_FILE
): Promise<void> {
  try {
    const cost = calculateCost(input.model, input.usage);
    const entry: AiUsageEntry = {
      ts: new Date().toISOString(),
      model: input.model,
      purpose: input.purpose,
      latencyMs: input.latencyMs,
      usage: input.usage,
      cost,
      ok: input.ok,
      error: input.error ?? null,
      requestId: input.requestId ?? null,
      stopReason: input.stopReason ?? null,
    };
    await fs.appendFile(filePath, JSON.stringify(entry) + '\n');
    if (cost) {
      log.debug(
        `${input.purpose} ${input.model} ${input.usage.inputTokens}→${input.usage.outputTokens}tok $${cost.total.toFixed(4)} ${input.latencyMs}ms`
      );
    }
  } catch (err) {
    log.warn(`Failed to write usage log: ${err}`);
  }
}

/**
 * Read the last N entries. Returns newest-first. Skips malformed lines.
 * For large files we still read the whole file — acceptable for the
 * expected volume (thousands of entries over months, not millions).
 */
export async function readRecentAiCalls(
  limit = 100,
  filePath: string = AI_USAGE_LOG_FILE
): Promise<AiUsageEntry[]> {
  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf-8');
  } catch {
    return [];
  }
  const lines = content.split('\n').filter((l) => l.trim().length > 0);
  const entries: AiUsageEntry[] = [];
  for (let i = lines.length - 1; i >= 0 && entries.length < limit; i--) {
    try {
      entries.push(JSON.parse(lines[i]) as AiUsageEntry);
    } catch {
      // skip malformed line
    }
  }
  return entries;
}

export interface UsageSummary {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheWriteTokens: number;
  totalCacheReadTokens: number;
  byModel: Record<
    string,
    {
      calls: number;
      inputTokens: number;
      outputTokens: number;
      cacheWriteTokens: number;
      cacheReadTokens: number;
      costUsd: number;
    }
  >;
  byPurpose: Record<string, { calls: number; costUsd: number }>;
  firstTs: string | null;
  lastTs: string | null;
}

/**
 * Aggregate every entry in the log. Pure function over entries — the
 * file read is isolated so this is trivially testable.
 */
export function summarize(entries: AiUsageEntry[]): UsageSummary {
  const s: UsageSummary = {
    totalCalls: 0,
    successfulCalls: 0,
    failedCalls: 0,
    totalCostUsd: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheWriteTokens: 0,
    totalCacheReadTokens: 0,
    byModel: {},
    byPurpose: {},
    firstTs: null,
    lastTs: null,
  };
  for (const e of entries) {
    s.totalCalls++;
    if (e.ok) s.successfulCalls++;
    else s.failedCalls++;
    const cacheWrite =
      (e.usage.cacheCreationInputTokens ?? 0) +
      (e.usage.cacheCreationEphemeral5mInputTokens ?? 0) +
      (e.usage.cacheCreationEphemeral1hInputTokens ?? 0);
    const cacheRead = e.usage.cacheReadInputTokens ?? 0;
    s.totalInputTokens += e.usage.inputTokens;
    s.totalOutputTokens += e.usage.outputTokens;
    s.totalCacheWriteTokens += cacheWrite;
    s.totalCacheReadTokens += cacheRead;
    s.totalCostUsd += e.cost?.total ?? 0;

    const m = (s.byModel[e.model] ??= {
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      costUsd: 0,
    });
    m.calls++;
    m.inputTokens += e.usage.inputTokens;
    m.outputTokens += e.usage.outputTokens;
    m.cacheWriteTokens += cacheWrite;
    m.cacheReadTokens += cacheRead;
    m.costUsd += e.cost?.total ?? 0;

    const p = (s.byPurpose[e.purpose] ??= { calls: 0, costUsd: 0 });
    p.calls++;
    p.costUsd += e.cost?.total ?? 0;

    if (!s.firstTs || e.ts < s.firstTs) s.firstTs = e.ts;
    if (!s.lastTs || e.ts > s.lastTs) s.lastTs = e.ts;
  }
  return s;
}

/** Read the full log and return a summary. */
export async function summarizeUsage(filePath: string = AI_USAGE_LOG_FILE): Promise<UsageSummary> {
  const entries = await readRecentAiCalls(Number.POSITIVE_INFINITY, filePath);
  return summarize(entries);
}
