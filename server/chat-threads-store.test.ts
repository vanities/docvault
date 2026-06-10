// Round-trip + validation tests for the server-side chat threads store.
// Uses only fabricated thread data — no personal content.

import { afterAll, beforeAll, describe, expect, test, vi } from 'vite-plus/test';
import { promises as fs } from 'fs';

// Vi.hoisted fires before the import graph resolves — same pattern as the
// health-store roundtrip test. Must happen before any `./*.js` imports that
// read DATA_DIR.
const tmpDataDir = vi.hoisted(() => {
  const p = require('path') as typeof import('path');
  const o = require('os') as typeof import('os');
  const dir = p.join(o.tmpdir(), `docvault-chat-threads-${Date.now()}`);
  process.env.DOCVAULT_DATA_DIR = dir;
  return dir;
});

vi.mock('./logger.js', () => ({
  createLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

import {
  CHAT_THREADS_PATH,
  isChatThreadsState,
  loadChatThreads,
  saveChatThreads,
} from './chat-threads-store.js';

beforeAll(async () => {
  await fs.mkdir(tmpDataDir, { recursive: true });
});

afterAll(async () => {
  await fs.rm(tmpDataDir, { recursive: true, force: true });
});

describe('chat-threads-store', () => {
  test('load returns empty state when no file exists', async () => {
    const state = await loadChatThreads();
    expect(state).toEqual({ threads: {}, activeThreadId: null });
  });

  test('save → load round-trips the state', async () => {
    const state = {
      activeThreadId: 'thread-1',
      threads: {
        'thread-1': {
          id: 'thread-1',
          title: 'Test thread',
          messages: [{ role: 'user', content: 'hello' }],
        },
      },
    };
    await saveChatThreads(state);
    const loaded = await loadChatThreads();
    expect(loaded).toEqual(state);
  });

  test('save is atomic (no .tmp file left behind)', async () => {
    await saveChatThreads({ threads: {}, activeThreadId: null });
    await expect(fs.access(`${CHAT_THREADS_PATH}.tmp`)).rejects.toThrow();
  });

  test('load survives a corrupt file', async () => {
    await fs.writeFile(CHAT_THREADS_PATH, 'not json{{{');
    const state = await loadChatThreads();
    expect(state).toEqual({ threads: {}, activeThreadId: null });
  });

  test('load rejects a malformed-but-parseable file', async () => {
    await fs.writeFile(CHAT_THREADS_PATH, JSON.stringify({ threads: [1, 2, 3] }));
    const state = await loadChatThreads();
    expect(state).toEqual({ threads: {}, activeThreadId: null });
  });

  test('isChatThreadsState validates shapes', () => {
    expect(isChatThreadsState({ threads: {}, activeThreadId: null })).toBe(true);
    expect(isChatThreadsState({ threads: {}, activeThreadId: 'abc' })).toBe(true);
    expect(isChatThreadsState({ threads: [], activeThreadId: null })).toBe(false);
    expect(isChatThreadsState({ threads: {}, activeThreadId: 5 })).toBe(false);
    expect(isChatThreadsState(null)).toBe(false);
    expect(isChatThreadsState('x')).toBe(false);
    expect(isChatThreadsState({ activeThreadId: null })).toBe(false);
  });
});
