import { mkdtemp, rm } from 'fs/promises';
import path from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, test, vi } from 'vite-plus/test';

const tempDirs: string[] = [];

async function importResearchRoutesWithTempData() {
  const dir = await mkdtemp(path.join(tmpdir(), 'docvault-research-politics-links-'));
  tempDirs.push(dir);
  vi.resetModules();
  vi.stubEnv('DOCVAULT_DATA_DIR', dir);
  vi.stubEnv('CHECKTHEVOTE_BASE_URL', 'http://pi.local:3000');
  vi.stubEnv('CHECKTHEVOTE_API_KEY', 'secret');
  return import('./research');
}

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('research politics links route', () => {
  test('links stored research intelligence to Check the Vote trades and votes without exposing the API key', async () => {
    const { handleResearchRoutes } = await importResearchRoutesWithTempData();
    const fetchCalls: { url: string; authorization: string | null }[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      fetchCalls.push({
        url: String(input),
        authorization: new Headers(init?.headers).get('authorization'),
      });
      const payloads: Record<string, unknown> = {
        '/api/v1/health': { ok: true, service: 'checkthevote' },
        '/api/v1/sync': { jobs: [] },
        '/api/v1/votes/recent': {
          votes: [
            {
              externalId: 'house-119-2-7',
              question: 'On passage: AI Accelerator Export Waiver Act',
              bill: { title: 'AI Accelerator Export Waiver Act' },
            },
          ],
        },
        '/api/v1/trades/recent': {
          trades: [{ politicianName: 'Donald J. Trump', ticker: 'NVDA', category: 'buy' }],
        },
        '/api/v1/trade-filings/recent': { filings: [] },
      };
      return Response.json(payloads[url.pathname] ?? {}, {
        status: payloads[url.pathname] ? 200 : 404,
      });
    });

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
    const created = (await createResponse!.json()) as { entry: { id: string } };
    await handleResearchRoutes(
      new Request(`http://localhost/api/research/${created.entry.id}/intelligence`, {
        method: 'POST',
      }),
      new URL(`http://localhost/api/research/${created.entry.id}/intelligence`),
      `/api/research/${created.entry.id}/intelligence`
    );

    const linksResponse = await handleResearchRoutes(
      new Request('http://localhost/api/research/politics-links'),
      new URL('http://localhost/api/research/politics-links'),
      '/api/research/politics-links'
    );
    expect(linksResponse?.status).toBe(200);
    const body = (await linksResponse!.json()) as {
      ok: boolean;
      links: Array<{ claimText: string; matchedTrades: unknown[]; matchedVotes: unknown[] }>;
      briefs: Array<{ key: string; label: string; claimCount: number; tradeMatchCount: number }>;
    };
    expect(body.ok).toBe(true);
    expect(body.links[0]).toEqual(
      expect.objectContaining({
        claimText:
          'NVDA demand will accelerate if export waivers remain in place for AI accelerators.',
        matchedTrades: [
          expect.objectContaining({ ticker: 'NVDA', politicianName: 'Donald J. Trump' }),
        ],
        matchedVotes: [expect.objectContaining({ label: 'AI Accelerator Export Waiver Act' })],
      })
    );
    expect(body.briefs[0]).toEqual(
      expect.objectContaining({
        key: 'ticker:NVDA',
        label: 'NVDA',
        claimCount: 1,
        tradeMatchCount: 1,
      })
    );
    expect(fetchCalls.every((call) => call.authorization === 'Bearer secret')).toBe(true);
    expect(JSON.stringify(body)).not.toContain('secret');
  });
});
