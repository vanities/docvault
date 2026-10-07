// Fabricated research documents only; all files go to a temporary directory.
import { afterAll, beforeEach, expect, test, vi } from 'vite-plus/test';
import { promises as fs } from 'node:fs';
const dataDir = vi.hoisted(() => {
  const os = require('node:os') as typeof import('node:os');
  const path = require('node:path') as typeof import('node:path');
  return path.join(os.tmpdir(), `docvault-research-test-${Date.now()}`);
});
vi.mock('../data.js', () => ({
  DATA_DIR: dataDir,
  ensureDir: (dir: string) => fs.mkdir(dir, { recursive: true }),
  jsonResponse: (data: unknown, status = 200) => Response.json(data, { status }),
}));
vi.mock('../parsers/research-report.js', () => ({
  RESEARCH_EXTRACTOR_VERSION: 'synthetic',
  extractResearchText: vi.fn(async () => ({ text: 'Synthetic extracted text', pageCount: 1 })),
}));
vi.mock('../parsers/youtube-transcript.js', () => ({
  YOUTUBE_EXTRACTOR_VERSION: 'synthetic',
  extractVideoId: vi.fn(),
  fetchYouTubeTranscript: vi.fn(),
}));
vi.mock('../parsers/media-transcribe.js', () => ({
  MEDIA_TRANSCRIBE_EXTRACTOR_VERSION: 'synthetic',
  transcribeMediaFile: vi.fn(),
}));
vi.mock('../politics/feed-store.js', () => ({ loadPoliticsFeedPayload: vi.fn() }));
vi.mock('../logger.js', () => ({
  createLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    timer: () => () => 0,
  }),
}));
import { handleResearchRoutes, type ResearchEntry } from './research.js';
import { extractResearchText } from '../parsers/research-report.js';
beforeEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
  vi.mocked(extractResearchText).mockClear();
});
afterAll(() => fs.rm(dataDir, { recursive: true, force: true }));
async function call(method: string, pathname: string, body?: unknown) {
  const url = new URL(`http://internal${pathname}`);
  const response = await handleResearchRoutes(
    new Request(url, {
      method,
      ...(body === undefined
        ? {}
        : {
            body: typeof body === 'string' ? body : JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' },
          }),
    }),
    url,
    pathname
  );
  if (!response) throw new Error('Missing response');
  return {
    status: response.status,
    data: (await response.json()) as { entry: ResearchEntry; entries: ResearchEntry[] },
  };
}
test('parallel research ingests retain every document', async () => {
  const results = await Promise.allSettled(
    Array.from({ length: 12 }, (_, i) =>
      call('POST', '/api/research/text', { text: `Synthetic research ${i}` })
    )
  );
  expect(
    results.every((result) => result.status === 'fulfilled' && result.value.status === 200)
  ).toBe(true);
  expect((await call('GET', '/api/research')).data.entries).toHaveLength(12);
});
test('re-extraction preserves newer metadata and other ingests', async () => {
  const created = await call('POST', '/api/research/upload', '%PDF-Synthetic fixture');
  const id = created.data.entry.id;
  expect(
    (await call('POST', `/api/research/${id}/intelligence`)).data.entry.intelligence
  ).toBeTruthy();
  let release!: () => void;
  let ready!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  vi.mocked(extractResearchText).mockImplementationOnce(async () => {
    ready();
    await waiting;
    return { text: 'Synthetic refreshed text', pageCount: 2, inferredTitle: undefined };
  });
  const extraction = call('POST', `/api/research/${id}/re-extract`);
  await started;
  expect(
    (await call('PATCH', `/api/research/${id}`, { notes: 'Synthetic newer note' })).status
  ).toBe(200);
  expect(
    (await call('POST', '/api/research/text', { text: 'Synthetic second document' })).status
  ).toBe(200);
  release();
  expect((await extraction).status).toBe(200);
  expect((await call('GET', `/api/research/${id}`)).data.entry).toMatchObject({
    notes: 'Synthetic newer note',
    text: 'Synthetic refreshed text',
    pageCount: 2,
  });
  expect((await call('GET', `/api/research/${id}`)).data.entry.intelligence).toBeUndefined();
  expect((await call('GET', '/api/research')).data.entries).toHaveLength(2);
});
