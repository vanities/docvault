import { describe, expect, test } from 'vite-plus/test';
import { loadCheckTheVotePolitics } from './check-the-vote';

describe('loadCheckTheVotePolitics', () => {
  test('reports unconfigured without making a network request', async () => {
    let called = false;
    const result = await loadCheckTheVotePolitics({}, async () => {
      called = true;
      return new Response('{}');
    });

    expect(called).toBe(false);
    expect(result).toEqual({
      configured: false,
      ok: false,
      reason: 'missing_base_url',
    });
  });

  test('fetches politics primitives with bearer auth when configured', async () => {
    const calls: { url: string; authorization: string | null }[] = [];
    const payloads: Record<string, unknown> = {
      '/api/v1/health': { ok: true, service: 'checkthevote' },
      '/api/v1/sync': { jobs: [{ name: 'trades:house', status: 'done' }] },
      '/api/v1/votes/recent': { votes: [{ externalId: 'senate-119-2-44' }] },
      '/api/v1/trades/recent': { trades: [{ ticker: 'MSFT' }] },
      '/api/v1/trade-filings/recent': { filings: [{ sourceId: 'filing-1' }] },
    };

    const result = await loadCheckTheVotePolitics(
      {
        CHECKTHEVOTE_BASE_URL: 'http://pi.local:3000/',
        CHECKTHEVOTE_API_KEY: 'secret',
      },
      async (input, init) => {
        const url = new URL(String(input));
        const headers = new Headers(init?.headers);
        calls.push({ url: String(input), authorization: headers.get('authorization') });
        return Response.json(payloads[url.pathname] ?? { ok: false }, {
          status: payloads[url.pathname] ? 200 : 404,
        });
      }
    );

    expect(calls).toEqual([
      { url: 'http://pi.local:3000/api/v1/health', authorization: 'Bearer secret' },
      { url: 'http://pi.local:3000/api/v1/sync', authorization: 'Bearer secret' },
      { url: 'http://pi.local:3000/api/v1/votes/recent', authorization: 'Bearer secret' },
      { url: 'http://pi.local:3000/api/v1/trades/recent', authorization: 'Bearer secret' },
      {
        url: 'http://pi.local:3000/api/v1/trade-filings/recent',
        authorization: 'Bearer secret',
      },
    ]);
    expect(result).toMatchObject({
      configured: true,
      ok: true,
      baseUrl: 'http://pi.local:3000',
      health: { ok: true, service: 'checkthevote' },
      sync: { jobs: [{ name: 'trades:house', status: 'done' }] },
      votes: { votes: [{ externalId: 'senate-119-2-44' }] },
      trades: { trades: [{ ticker: 'MSFT' }] },
      filings: { filings: [{ sourceId: 'filing-1' }] },
    });
  });

  test('returns a safe error summary when an upstream primitive fails', async () => {
    const result = await loadCheckTheVotePolitics(
      {
        CHECKTHEVOTE_BASE_URL: 'http://pi.local:3000',
        CHECKTHEVOTE_API_KEY: 'secret',
      },
      async (input) => {
        const url = new URL(String(input));
        if (url.pathname === '/api/v1/trades/recent') {
          return new Response('nope', { status: 503 });
        }
        return Response.json({ ok: true });
      }
    );

    expect(result).toMatchObject({
      configured: true,
      ok: false,
      baseUrl: 'http://pi.local:3000',
      error: 'Check the Vote request failed for /api/v1/trades/recent: HTTP 503',
    });
    expect(JSON.stringify(result)).not.toContain('secret');
  });
});
