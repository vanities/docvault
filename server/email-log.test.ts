// Sent-mail log store: append, newest-first read, purpose filter, cap, and
// tolerance for a corrupt file. Fabricated addresses only, in a tmpdir.

import { afterAll, beforeAll, describe, expect, test, vi } from 'vite-plus/test';
import { promises as fs } from 'fs';

// vi.hoisted fires before the import graph resolves, so DATA_DIR (read at
// import time by data.ts) points at the tmpdir — never the real data/.
const tmpDataDir = vi.hoisted(() => {
  const p = require('path') as typeof import('path');
  const o = require('os') as typeof import('os');
  const dir = p.join(o.tmpdir(), `docvault-email-log-${Date.now()}`);
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
  EMAIL_LOG_PATH,
  MAX_ENTRIES,
  appendEmailLog,
  isEmailLogEntry,
  readEmailLog,
  type EmailLogEntry,
} from './email-log.js';

function entry(n: number, over: Partial<EmailLogEntry> = {}): EmailLogEntry {
  return {
    id: `id-${n}`,
    at: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString(),
    purpose: 'client',
    from: 'Acme Billing <billing@example.com>',
    to: ['client@acme.test'],
    cc: ['me@example.com'],
    subject: `Invoice ${n}`,
    attachments: [{ filename: `Invoice_${n}.pdf`, bytes: 1234 }],
    ok: true,
    providerId: `re_${n}`,
    elapsedMs: 42,
    ref: `invoice:${n}`,
    ...over,
  };
}

beforeAll(async () => {
  await fs.mkdir(tmpDataDir, { recursive: true });
});

afterAll(async () => {
  await fs.rm(tmpDataDir, { recursive: true, force: true });
});

describe('email-log', () => {
  test('the store path lives inside the tmp DATA_DIR', () => {
    expect(EMAIL_LOG_PATH.startsWith(tmpDataDir)).toBe(true);
  });

  test('reads empty before anything was sent', async () => {
    expect(await readEmailLog()).toEqual([]);
  });

  test('append then read returns newest first with every field intact', async () => {
    await appendEmailLog(entry(1));
    await appendEmailLog(entry(2, { purpose: 'news', ok: false, error: 'Resend 422: nope' }));
    const rows = await readEmailLog();
    expect(rows.map((r) => r.id)).toEqual(['id-2', 'id-1']);
    expect(rows[1]).toEqual(entry(1));
    expect(rows[0].error).toBe('Resend 422: nope');
  });

  test('purpose filter narrows the slice', async () => {
    const news = await readEmailLog({ purpose: 'news' });
    expect(news.map((r) => r.id)).toEqual(['id-2']);
    expect(await readEmailLog({ purpose: 'test' })).toEqual([]);
  });

  test('limit applies after the filter and still returns newest first', async () => {
    await appendEmailLog(entry(3));
    const rows = await readEmailLog({ purpose: 'client', limit: 1 });
    expect(rows.map((r) => r.id)).toEqual(['id-3']);
  });

  test('concurrent appends all land (writes are serialized)', async () => {
    await Promise.all([10, 11, 12, 13].map((n) => appendEmailLog(entry(n))));
    const ids = (await readEmailLog()).map((r) => r.id);
    for (const n of [10, 11, 12, 13]) expect(ids).toContain(`id-${n}`);
  });

  test('the log is capped at MAX_ENTRIES, dropping the oldest', async () => {
    for (let n = 100; n < 100 + MAX_ENTRIES + 5; n++) await appendEmailLog(entry(n));
    const rows = await readEmailLog({ limit: MAX_ENTRIES });
    expect(rows).toHaveLength(MAX_ENTRIES);
    expect(rows[0].id).toBe(`id-${100 + MAX_ENTRIES + 4}`);
    // The very first entries of this file are gone.
    expect(rows.some((r) => r.id === 'id-1')).toBe(false);
  });

  test('a corrupt file reads as empty instead of throwing', async () => {
    await fs.writeFile(EMAIL_LOG_PATH, '{not json');
    expect(await readEmailLog()).toEqual([]);
    await appendEmailLog(entry(999));
    expect((await readEmailLog()).map((r) => r.id)).toEqual(['id-999']);
  });

  test('malformed rows are skipped, well-formed ones survive', async () => {
    await fs.writeFile(
      EMAIL_LOG_PATH,
      JSON.stringify({
        entries: [entry(1), { id: 'junk' }, entry(2, { purpose: 'bogus' as never })],
      })
    );
    expect((await readEmailLog()).map((r) => r.id)).toEqual(['id-1']);
  });

  test('isEmailLogEntry guards the fields the UI renders', () => {
    expect(isEmailLogEntry(entry(1))).toBe(true);
    expect(isEmailLogEntry({ ...entry(1), to: 'not-a-list' })).toBe(false);
    expect(isEmailLogEntry({ ...entry(1), purpose: 'marketing' })).toBe(false);
    expect(isEmailLogEntry(null)).toBe(false);
  });
});
