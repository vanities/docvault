import { mkdtemp, rm } from 'fs/promises';
import path from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, test, vi } from 'vite-plus/test';

const tempDirs: string[] = [];

async function importResearchRoutesWithTempData() {
  const dir = await mkdtemp(path.join(tmpdir(), 'docvault-research-intel-'));
  tempDirs.push(dir);
  vi.resetModules();
  vi.stubEnv('DOCVAULT_DATA_DIR', dir);
  return import('./research');
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('research intelligence route', () => {
  test('stores generated summary and claims on a research entry without losing provenance', async () => {
    const { handleResearchRoutes } = await importResearchRoutesWithTempData();
    const createResponse = await handleResearchRoutes(
      new Request('http://localhost/api/research/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'politics',
          title: 'AI export waiver transcript',
          sourceUrl: 'https://example.test/video',
          tickers: ['NVDA'],
          text: 'NVDA demand will accelerate if export waivers remain in place for AI accelerators.',
        }),
      }),
      new URL('http://localhost/api/research/text'),
      '/api/research/text'
    );
    expect(createResponse?.status).toBe(200);
    const created = (await createResponse!.json()) as { entry: { id: string } };

    const intelligenceResponse = await handleResearchRoutes(
      new Request(`http://localhost/api/research/${created.entry.id}/intelligence`, {
        method: 'POST',
      }),
      new URL(`http://localhost/api/research/${created.entry.id}/intelligence`),
      `/api/research/${created.entry.id}/intelligence`
    );
    expect(intelligenceResponse?.status).toBe(200);
    const payload = (await intelligenceResponse!.json()) as {
      entry: {
        intelligence?: {
          claims: Array<{ text: string; provenance: { sourceUrl?: string; lineStart: number } }>;
        };
      };
    };
    expect(payload.entry.intelligence?.claims[0]).toEqual(
      expect.objectContaining({
        text: 'NVDA demand will accelerate if export waivers remain in place for AI accelerators.',
        provenance: expect.objectContaining({
          sourceUrl: 'https://example.test/video',
          lineStart: 1,
        }),
      })
    );

    const getResponse = await handleResearchRoutes(
      new Request(`http://localhost/api/research/${created.entry.id}`),
      new URL(`http://localhost/api/research/${created.entry.id}`),
      `/api/research/${created.entry.id}`
    );
    const persisted = (await getResponse!.json()) as { entry: { intelligence?: unknown } };
    expect(persisted.entry.intelligence).toEqual(payload.entry.intelligence);
  });
});
