// Chat thread persistence — server-side store for the multi-thread chat UI.
// Replaces browser localStorage persistence: chat transcripts routinely
// contain tax/health details, and the app is served over plain HTTP on the
// LAN where client-side encryption isn't available (no secure context). In
// DATA_DIR the history rides along with the encrypted backup bundle and
// survives across browsers/devices.
//
// The client owns pruning (src/contexts/chatPersistence.ts) and PUTs the
// whole pruned state blob; the server validates shape and stores it as-is.
// `messages` stays unknown[] here — only ChatView interprets transcripts.

import { promises as fs } from 'fs';
import path from 'path';
import { DATA_DIR } from './data.js';
import { createLogger } from './logger.js';

const log = createLogger('ChatThreads');

export const CHAT_THREADS_PATH = path.join(DATA_DIR, '.docvault-chat-threads.json');

export interface ChatThreadsState {
  threads: Record<string, unknown>;
  activeThreadId: string | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isChatThreadsState(value: unknown): value is ChatThreadsState {
  if (!isPlainObject(value)) return false;
  if (!isPlainObject(value.threads)) return false;
  return value.activeThreadId === null || typeof value.activeThreadId === 'string';
}

export async function loadChatThreads(): Promise<ChatThreadsState> {
  try {
    const raw = await fs.readFile(CHAT_THREADS_PATH, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (isChatThreadsState(parsed)) return parsed;
    log.warn('[load] stored chat threads malformed — returning empty state');
  } catch {
    // Missing file (first run) or unreadable JSON — start empty either way.
  }
  return { threads: {}, activeThreadId: null };
}

export async function saveChatThreads(state: ChatThreadsState): Promise<void> {
  const t0 = performance.now();
  // Write-then-rename so a crash mid-write can't truncate the history file.
  const tmpPath = `${CHAT_THREADS_PATH}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(state, null, 2));
  await fs.rename(tmpPath, CHAT_THREADS_PATH);
  log.debug(
    `[save] threads=${Object.keys(state.threads).length} in ${(performance.now() - t0).toFixed(1)}ms`
  );
}
