// Round-trip, migration, search and safety tests for the chat threads store.
// Uses only fabricated thread data — no personal content.

import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vite-plus/test';
import { promises as fs } from 'fs';
import path from 'path';

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
  createLogger: () => ({
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    timer: () => () => 0,
  }),
}));

import {
  CHAT_THREADS_DIR,
  CHAT_THREADS_PATH,
  deleteThread,
  extractText,
  importThreadsState,
  isChatThreadsState,
  isValidThreadId,
  loadIndex,
  loadThread,
  saveThread,
  searchThreads,
  setActiveThreadId,
} from './chat-threads-store.js';

beforeAll(async () => {
  await fs.mkdir(tmpDataDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(CHAT_THREADS_PATH, { force: true });
  await fs.rm(CHAT_THREADS_DIR, { recursive: true, force: true });
});

afterAll(async () => {
  await fs.rm(tmpDataDir, { recursive: true, force: true });
});

function thread(id: string, text: string, updatedAt = '2026-03-01T00:00:00.000Z') {
  return {
    id,
    title: `Thread ${id}`,
    resumeSessionId: null,
    stats: { inputTokens: 1, outputTokens: 2, costUsd: 0.03 },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt,
    messages: [
      { id: 'm1', role: 'user', content: text },
      { id: 'm2', role: 'assistant', blocks: [{ type: 'text', text: `re: ${text}` }] },
    ],
  };
}

describe('chat-threads-store', () => {
  test('load returns empty index when no file exists', async () => {
    expect(await loadIndex()).toEqual({ threads: {}, activeThreadId: null });
  });

  test('saveThread writes a transcript file and an index summary without messages', async () => {
    await saveThread('t1', thread('t1', 'hello world'));

    const loaded = await loadThread('t1');
    expect(loaded?.messages).toHaveLength(2);
    expect(loaded?.messageCount).toBe(2);

    const index = await loadIndex();
    expect(index.threads.t1.title).toBe('Thread t1');
    expect(index.threads.t1.messageCount).toBe(2);
    // The index must stay cheap to load — transcripts live in their own files.
    expect(index.threads.t1).not.toHaveProperty('messages');
  });

  test('save is atomic (no .tmp file left behind)', async () => {
    await saveThread('t1', thread('t1', 'hi'));
    await expect(fs.access(`${CHAT_THREADS_PATH}.tmp`)).rejects.toThrow();
    await expect(fs.access(path.join(CHAT_THREADS_DIR, 't1.json.tmp'))).rejects.toThrow();
  });

  test('migrates a legacy single-blob file into per-thread files', async () => {
    // The pre-split format: transcripts inline in the index file.
    await fs.writeFile(
      CHAT_THREADS_PATH,
      JSON.stringify({
        activeThreadId: 'old1',
        threads: { old1: thread('old1', 'legacy content'), old2: thread('old2', 'more legacy') },
      })
    );

    const index = await loadIndex();

    expect(Object.keys(index.threads).sort()).toEqual(['old1', 'old2']);
    expect(index.activeThreadId).toBe('old1');
    expect(index.threads.old1).not.toHaveProperty('messages');
    // Transcripts were split out and are still readable.
    expect((await loadThread('old1'))?.messages).toHaveLength(2);
    // ...and the index file itself no longer carries them.
    const onDisk = JSON.parse(await fs.readFile(CHAT_THREADS_PATH, 'utf-8'));
    expect(onDisk.threads.old1.messages).toBeUndefined();
  });

  test('load survives a corrupt file', async () => {
    await fs.writeFile(CHAT_THREADS_PATH, 'not json{{{');
    expect(await loadIndex()).toEqual({ threads: {}, activeThreadId: null });
  });

  test('load rejects a malformed-but-parseable file', async () => {
    await fs.writeFile(CHAT_THREADS_PATH, JSON.stringify({ threads: [1, 2, 3] }));
    expect(await loadIndex()).toEqual({ threads: {}, activeThreadId: null });
    expect(isChatThreadsState({ threads: [1, 2, 3] })).toBe(false);
  });

  test('thread ids that could escape the threads dir are rejected', async () => {
    for (const bad of ['../escape', 'a/b', '.', '..', '', 'x'.repeat(65), '-leading']) {
      expect(isValidThreadId(bad)).toBe(false);
      expect(await saveThread(bad, thread('x', 'nope'))).toBeNull();
      expect(await loadThread(bad)).toBeNull();
    }
    // Nothing was written outside the (still absent) threads dir.
    await expect(fs.access(path.join(tmpDataDir, 'escape.json'))).rejects.toThrow();
  });

  test('deleteThread removes the file and the index row', async () => {
    await saveThread('t1', thread('t1', 'bye'));
    await setActiveThreadId('t1');

    expect(await deleteThread('t1')).toBe(true);
    expect(await loadThread('t1')).toBeNull();
    const index = await loadIndex();
    expect(index.threads.t1).toBeUndefined();
    // Deleting the open thread must not leave the pointer dangling.
    expect(index.activeThreadId).toBeNull();
  });

  test('a bulk legacy PUT merges rather than replacing', async () => {
    await saveThread('keep', thread('keep', 'existing'));
    await importThreadsState({
      activeThreadId: 'incoming',
      threads: { incoming: thread('incoming', 'new') },
    });

    const index = await loadIndex();
    // A pruned client blob must never delete history it simply didn't mention.
    expect(Object.keys(index.threads).sort()).toEqual(['incoming', 'keep']);
  });

  test('an empty read never shares state with a later save', async () => {
    // Regression: the empty result used to be a shallow copy of a module-level
    // constant, so saveThread mutating `index.threads` welded the first thread
    // saved into every subsequent "empty" read for the life of the process —
    // meaning a deleted or corrupt index resurrected a stale row.
    expect(await loadIndex()).toEqual({ threads: {}, activeThreadId: null });
    await saveThread('t1', thread('t1', 'x'));
    await fs.rm(CHAT_THREADS_PATH, { force: true });
    expect(await loadIndex()).toEqual({ threads: {}, activeThreadId: null });
  });

  test('index rows keep messageCount and preview across re-reads', async () => {
    // Regression: index rows carry no `messages`, and re-normalizing them
    // recomputed messageCount from that absent array — zeroing it on every
    // read, which makes an unopened thread look empty instead of unfetched.
    await saveThread('t1', thread('t1', 'searchable body'));
    await loadIndex();
    const reread = await loadIndex();
    expect(reread.threads.t1.messageCount).toBe(2);
    expect(reread.threads.t1.preview).toContain('searchable body');
  });

  test('extractText reads both message shapes and ignores junk', () => {
    expect(
      extractText([
        { role: 'user', content: 'question' },
        { role: 'assistant', blocks: [{ type: 'text', text: 'answer' }, { type: 'tool_call' }] },
        null,
        'nonsense',
        { role: 'assistant' },
      ])
    ).toBe('question\nanswer');
  });
});

describe('searchThreads', () => {
  test('matches transcript text and returns a snippet with a match count', async () => {
    await saveThread('a', thread('a', 'the quick brown fox'));
    await saveThread('b', thread('b', 'totally unrelated'));

    const { hits, total } = await searchThreads({ query: 'brown' });

    expect(total).toBe(1);
    expect(hits[0].thread.id).toBe('a');
    expect(hits[0].snippet.toLowerCase()).toContain('brown');
    // 'brown' appears in the user message and is echoed in the assistant reply.
    expect(hits[0].matchCount).toBe(2);
  });

  test('search is case-insensitive and also matches titles', async () => {
    await saveThread('a', thread('a', 'payload'));
    expect((await searchThreads({ query: 'PAYLOAD' })).total).toBe(1);
    expect((await searchThreads({ query: 'thread a' })).total).toBe(1);
  });

  test('no query browses newest-first', async () => {
    await saveThread('old', thread('old', 'x', '2026-01-01T00:00:00.000Z'));
    await saveThread('new', thread('new', 'y', '2026-06-01T00:00:00.000Z'));

    const { hits } = await searchThreads({});

    expect(hits.map((h) => h.thread.id)).toEqual(['new', 'old']);
  });

  test('date bounds filter on updatedAt and `to` includes the whole day', async () => {
    await saveThread('jan', thread('jan', 'x', '2026-01-15T00:00:00.000Z'));
    await saveThread('jun', thread('jun', 'x', '2026-06-15T18:30:00.000Z'));

    expect((await searchThreads({ from: '2026-06-01' })).hits.map((h) => h.thread.id)).toEqual([
      'jun',
    ]);
    // An 18:30 timestamp must still fall inside a `to` of that same calendar day.
    expect((await searchThreads({ to: '2026-06-15' })).hits.map((h) => h.thread.id)).toEqual([
      'jun',
      'jan',
    ]);
  });

  test('paging returns a stable window over the result set', async () => {
    for (let i = 0; i < 5; i += 1) {
      await saveThread(`t${i}`, thread(`t${i}`, 'common', `2026-0${i + 1}-01T00:00:00.000Z`));
    }
    const page1 = await searchThreads({ query: 'common', limit: 2, offset: 0 });
    const page2 = await searchThreads({ query: 'common', limit: 2, offset: 2 });

    expect(page1.total).toBe(5);
    expect(page1.hits).toHaveLength(2);
    expect(page2.hits).toHaveLength(2);
    const ids = [...page1.hits, ...page2.hits].map((h) => h.thread.id);
    expect(new Set(ids).size).toBe(4);
  });
});
