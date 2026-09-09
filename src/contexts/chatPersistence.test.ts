// Regression: chat history lives on the server (.docvault-chat-threads.json),
// and boot hydration has to fold the server's copy together with whatever the
// browser fallback is holding. Getting the precedence wrong either resurrects
// stale transcripts or drops messages typed while the server was unreachable,
// so the merge rule — newest write per thread id wins — is pinned here.

import { describe, expect, test } from 'vite-plus/test';
import {
  EMPTY_CHAT_STATS,
  mergeThreadsState,
  type PersistedThread,
  type ThreadsState,
} from './chatPersistence';

function thread(id: string, updatedAt: string, messageCount: number): PersistedThread {
  return {
    id,
    title: `Thread ${id}`,
    resumeSessionId: null,
    messages: Array.from({ length: messageCount }, (_, i) => ({ role: 'user', text: `m${i}` })),
    stats: EMPTY_CHAT_STATS,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt,
  };
}

function state(threads: PersistedThread[], activeThreadId: string | null = null): ThreadsState {
  return { threads: Object.fromEntries(threads.map((t) => [t.id, t])), activeThreadId };
}

describe('mergeThreadsState', () => {
  test('server copy wins over a stale browser fallback for the same thread', () => {
    const server = state([thread('a', '2026-03-02T00:00:00.000Z', 9)]);
    const stale = state([thread('a', '2026-03-01T00:00:00.000Z', 3)]);

    // Fallback as the base, server layered on top: the newer server copy wins.
    const merged = mergeThreadsState(stale, server);

    expect(merged.threads.a.messages).toHaveLength(9);
  });

  test('an edit made while the server was unreachable survives hydration', () => {
    const server = state([thread('a', '2026-03-01T00:00:00.000Z', 3)]);
    const offlineEdit = state([thread('a', '2026-03-05T00:00:00.000Z', 7)]);

    const merged = mergeThreadsState(server, offlineEdit);

    expect(merged.threads.a.messages).toHaveLength(7);
  });

  test('threads created during hydration are kept alongside the server set', () => {
    const server = state([thread('a', '2026-03-01T00:00:00.000Z', 2)]);
    const justCreated = state([thread('b', '2026-03-09T00:00:00.000Z', 1)], 'b');

    const merged = mergeThreadsState(server, justCreated);

    expect(Object.keys(merged.threads).sort()).toEqual(['a', 'b']);
    expect(merged.activeThreadId).toBe('b');
  });

  test('an empty overlay never erases the server set', () => {
    const server = state([thread('a', '2026-03-01T00:00:00.000Z', 4)], 'a');

    const merged = mergeThreadsState(server, { threads: {}, activeThreadId: null });

    expect(Object.keys(merged.threads)).toEqual(['a']);
    expect(merged.activeThreadId).toBe('a');
  });

  test('unparseable timestamps sort oldest rather than throwing', () => {
    const server = state([thread('a', '2026-03-01T00:00:00.000Z', 4)]);
    const corrupt = state([thread('a', 'not-a-date', 1)]);

    // Overlay timestamp is unreadable => treated as epoch 0, so it loses.
    expect(mergeThreadsState(server, corrupt).threads.a.messages).toHaveLength(4);
    // ...and as the base it still yields to a readable, newer copy.
    expect(mergeThreadsState(corrupt, server).threads.a.messages).toHaveLength(4);
  });
});
