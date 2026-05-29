import { describe, expect, test } from 'vite-plus/test';
import { loadCheckTheVoteStatus } from './check-the-vote';

describe('loadCheckTheVoteStatus', () => {
  test('reports unconfigured without making a network request', async () => {
    let called = false;
    const status = await loadCheckTheVoteStatus({}, async () => {
      called = true;
      return new Response('{}');
    });

    expect(called).toBe(false);
    expect(status).toEqual({
      configured: false,
      ok: false,
      reason: 'missing_base_url',
    });
  });

  test('calls Check the Vote health endpoint with bearer auth when configured', async () => {
    const calls: { url: string; authorization: string | null }[] = [];
    const status = await loadCheckTheVoteStatus(
      {
        CHECKTHEVOTE_BASE_URL: 'http://pi.local:3000/',
        CHECKTHEVOTE_API_KEY: 'secret',
      },
      async (input, init) => {
        const headers = new Headers(init?.headers);
        calls.push({ url: String(input), authorization: headers.get('authorization') });
        return Response.json({ ok: true, service: 'checkthevote' });
      }
    );

    expect(calls).toEqual([
      {
        url: 'http://pi.local:3000/api/v1/health',
        authorization: 'Bearer secret',
      },
    ]);
    expect(status).toMatchObject({
      configured: true,
      ok: true,
      baseUrl: 'http://pi.local:3000',
    });
  });
});
