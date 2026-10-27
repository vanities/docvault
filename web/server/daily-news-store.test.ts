// Synthetic editions and a temporary store; no generation, email, or NAS access.
import { afterAll, afterEach, describe, expect, test, vi } from 'vite-plus/test';
import { rm } from 'fs/promises';
import path from 'path';

const fixture = vi.hoisted(() => {
  const fs = require('fs') as typeof import('fs');
  const os = require('os') as typeof import('os');
  const p = require('path') as typeof import('path');
  return {
    dataDir: fs.mkdtempSync(p.join(os.tmpdir(), 'docvault-edition-completion-')),
    warn: vi.fn(),
  };
});
vi.mock('./data.js', () => ({ DATA_DIR: fixture.dataDir }));
vi.mock('./logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: fixture.warn,
    error: vi.fn(),
    debug: vi.fn(),
    timer: () => () => 0,
  }),
}));
vi.mock('./daily-news.js', () => ({
  generateEdition: vi.fn(),
  gatherDigest: vi.fn(),
  synthesizeEdition: vi.fn(),
  notifyEditionReady: vi.fn(),
}));
vi.mock('./daily-news-image.js', () => ({ generateHeadlineImage: vi.fn(async () => null) }));
vi.mock('./daily-news-narration.js', () => ({ narrateEdition: vi.fn(async () => null) }));
vi.mock('./daily-news-themes.js', () => ({ listThemes: () => [] }));

import {
  getEdition,
  MAX_FAILED_EDITIONS_PER_DAY,
  scheduledEditionSettled,
  startEdition,
  waitForEdition,
} from './daily-news-store';
import { narrateEdition } from './daily-news-narration';
import type { GenerateResult } from './daily-news';

const result: GenerateResult = {
  title: 'Example daily report',
  body: 'A synthetic report.',
  theme: 'example',
  usage: { inputTokens: 10, outputTokens: 20 },
  digestMeta: {
    sources: ['Example source'],
    sinceISO: '2026-06-01T00:00:00.000Z',
    itemCount: 1,
    sourceWarnings: [{ source: 'example', message: 'One collection source is unavailable' }],
  },
};
afterEach(async () => {
  await rm(path.join(fixture.dataDir, '.docvault-daily-news.json'), { force: true });
  vi.clearAllMocks();
});
afterAll(async () => {
  await rm(fixture.dataDir, { recursive: true, force: true });
});

describe('scheduled edition completion', () => {
  test('waits for generation and optional narration before declaring completion', async () => {
    let resolveGeneration!: (value: GenerateResult) => void;
    let resolveNarration!: (value: null) => void;
    const generation = new Promise<GenerateResult>((resolve) => {
      resolveGeneration = resolve;
    });
    vi.mocked(narrateEdition).mockImplementationOnce(
      () =>
        new Promise<null>((resolve) => {
          resolveNarration = resolve;
        })
    );
    const id = await startEdition('daily', '2026-06-02', () => generation, false);
    expect((await getEdition(id))?.status).toBe('running');
    let completed = false;
    const completion = waitForEdition(id).then((edition) => {
      completed = true;
      return edition;
    });
    resolveGeneration(result);
    await vi.waitFor(() => expect(narrateEdition).toHaveBeenCalled());
    expect(completed).toBe(false);
    resolveNarration(null);
    expect((await completion)?.status).toBe('done');
    expect(fixture.warn).toHaveBeenCalledWith(
      expect.stringContaining('One collection source is unavailable')
    );
  });

  test('exposes generation failure instead of treating a queued edition as success', async () => {
    const id = await startEdition(
      'daily',
      '2026-06-03',
      async () => {
        throw new Error('Example provider timeout');
      },
      false
    );
    expect(await waitForEdition(id)).toMatchObject({
      status: 'error',
      error: 'Example provider timeout',
    });
  });
});

describe('scheduled edition dedup', () => {
  const failOn = async (date: string) =>
    waitForEdition(
      await startEdition(
        'daily',
        date,
        async () => {
          throw new Error('Example DNS outage');
        },
        false
      )
    );

  test('a failed edition leaves its day open for a retry, until the daily cap', async () => {
    await failOn('2026-06-04');
    expect(await scheduledEditionSettled('2026-06-04')).toBe(false);
    for (let i = 1; i < MAX_FAILED_EDITIONS_PER_DAY; i++) await failOn('2026-06-04');
    expect(await scheduledEditionSettled('2026-06-04')).toBe(true);
    expect(await scheduledEditionSettled('2026-06-05')).toBe(false);
  });

  test('a finished edition settles its day', async () => {
    await waitForEdition(await startEdition('daily', '2026-06-06', async () => result, false));
    expect(await scheduledEditionSettled('2026-06-06')).toBe(true);
  });
});
