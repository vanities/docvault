export interface ChatStats {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface PersistedThread {
  id: string;
  title: string;
  resumeSessionId: string | null;
  messages: unknown[];
  stats: ChatStats;
  createdAt: string;
  updatedAt: string;
}

export interface ThreadsState {
  threads: Record<string, PersistedThread>;
  activeThreadId: string | null;
}

export const EMPTY_CHAT_STATS: ChatStats = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

export const CHAT_PERSISTENCE_LIMITS = {
  /** Keep the most recently updated threads; older transcripts are dropped. */
  maxThreads: 20,
  /** Keep only the most recent messages in each persisted thread. */
  maxMessagesPerThread: 80,
  /** Bound the persisted blob (server file, or localStorage fallback) and reduce sensitive-at-rest retention. */
  maxSerializedChars: 900_000,
} as const;

interface PruneLimits {
  maxThreads: number;
  maxMessagesPerThread: number;
  maxSerializedChars: number;
}

function safeTime(value: string): number {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function normalizeThread(thread: PersistedThread, maxMessages: number): PersistedThread {
  const messages = Array.isArray(thread.messages) ? thread.messages.slice(-maxMessages) : [];
  return {
    id: typeof thread.id === 'string' && thread.id ? thread.id : crypto.randomUUID(),
    title: typeof thread.title === 'string' && thread.title ? thread.title : 'New chat',
    resumeSessionId: typeof thread.resumeSessionId === 'string' ? thread.resumeSessionId : null,
    messages,
    stats: {
      inputTokens: Number.isFinite(thread.stats?.inputTokens) ? thread.stats.inputTokens : 0,
      outputTokens: Number.isFinite(thread.stats?.outputTokens) ? thread.stats.outputTokens : 0,
      costUsd: Number.isFinite(thread.stats?.costUsd) ? thread.stats.costUsd : 0,
    },
    createdAt: typeof thread.createdAt === 'string' ? thread.createdAt : new Date().toISOString(),
    updatedAt: typeof thread.updatedAt === 'string' ? thread.updatedAt : new Date().toISOString(),
  };
}

function serializedLength(state: ThreadsState): number {
  return JSON.stringify(state).length;
}

/**
 * Privacy + quota guard for persisted chat transcripts.
 *
 * Chat can contain sensitive document details, so persistence is intentionally
 * bounded: only recent threads/messages are retained, and the whole serialized
 * payload must stay below a conservative localStorage budget.
 */
export function pruneThreadsState(
  state: ThreadsState,
  limits: PruneLimits = CHAT_PERSISTENCE_LIMITS
): ThreadsState {
  const sorted = Object.values(state.threads ?? {})
    .filter((thread): thread is PersistedThread => !!thread && typeof thread === 'object')
    .map((thread) => normalizeThread(thread, Math.max(0, limits.maxMessagesPerThread)))
    .sort((a, b) => safeTime(b.updatedAt) - safeTime(a.updatedAt))
    .slice(0, Math.max(0, limits.maxThreads));

  let next: ThreadsState = {
    threads: Object.fromEntries(sorted.map((thread) => [thread.id, thread])),
    activeThreadId:
      state.activeThreadId && sorted.some((thread) => thread.id === state.activeThreadId)
        ? state.activeThreadId
        : (sorted[0]?.id ?? null),
  };

  if (serializedLength(next) <= limits.maxSerializedChars) return next;

  // First reduce per-thread transcript depth while keeping thread metadata.
  let messageCap = Math.max(0, Math.floor(limits.maxMessagesPerThread / 2));
  while (serializedLength(next) > limits.maxSerializedChars && messageCap > 0) {
    const trimmed = Object.values(next.threads).map((thread) =>
      normalizeThread(thread, messageCap)
    );
    next = {
      threads: Object.fromEntries(trimmed.map((thread) => [thread.id, thread])),
      activeThreadId:
        next.activeThreadId && trimmed.some((thread) => thread.id === next.activeThreadId)
          ? next.activeThreadId
          : (trimmed[0]?.id ?? null),
    };
    messageCap = Math.floor(messageCap / 2);
  }

  // Then drop oldest threads if a single huge message still exceeds budget.
  while (
    serializedLength(next) > limits.maxSerializedChars &&
    Object.keys(next.threads).length > 1
  ) {
    const kept = Object.values(next.threads)
      .sort((a, b) => safeTime(b.updatedAt) - safeTime(a.updatedAt))
      .slice(0, -1);
    next = {
      threads: Object.fromEntries(kept.map((thread) => [thread.id, thread])),
      activeThreadId:
        next.activeThreadId && kept.some((thread) => thread.id === next.activeThreadId)
          ? next.activeThreadId
          : (kept[0]?.id ?? null),
    };
  }

  // Last-resort: keep only metadata for the newest thread.
  if (serializedLength(next) > limits.maxSerializedChars) {
    const newest = Object.values(next.threads).sort(
      (a, b) => safeTime(b.updatedAt) - safeTime(a.updatedAt)
    )[0];
    if (!newest) return { threads: {}, activeThreadId: null };
    const metadataOnly = { ...newest, messages: [] };
    next = { threads: { [metadataOnly.id]: metadataOnly }, activeThreadId: metadataOnly.id };
  }

  return serializedLength(next) <= limits.maxSerializedChars
    ? next
    : { threads: {}, activeThreadId: null };
}
