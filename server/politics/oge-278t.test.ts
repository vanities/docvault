// Synthetic disclosure responses only; no personal data or live network.
import { afterEach, describe, expect, test, vi } from 'vite-plus/test';
import { fetchTrumpOgePdfs, ingestOge278t } from './oge-278t.js';
import { emptyPoliticsCache } from './feed-store.js';

afterEach(() => vi.useRealTimers());

const row = {
  type: "<a href='/201/Presiden.nsf/PAS+Index/example-doc/$FILE/example.pdf'>278 Transaction</a>",
  name: 'Doe, John',
  docDate: '2026-06-01T00:00:00',
};

describe('OGE disclosure discovery', () => {
  test('uses the current v3 service; the retired v2 service serves HTML with HTTP 200', async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes('/v3/rest?')
        ? Response.json({ data: [row, row] })
        : new Response('<html>This page is used to allow access to REST Services.</html>')
    );
    const pdfs = await fetchTrumpOgePdfs(fetchFn as typeof fetch);
    expect(pdfs).toEqual([
      {
        docId: 'example-doc',
        url: 'https://extapps2.oge.gov/201/Presiden.nsf/PAS+Index/example-doc/$FILE/example.pdf',
        docDate: row.docDate,
        name: row.name,
      },
    ]);
    const url = new URL(String(fetchFn.mock.calls[0][0]));
    expect(url.searchParams.get('columns[3][search][value]')).toBe('Trump, Donald');
  });

  test('reports the endpoint, HTTP status and content type when HTML replaces JSON', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response('<html>REST service unavailable</html>', {
          headers: { 'content-type': 'text/html' },
        })
    );
    await expect(fetchTrumpOgePdfs(fetchFn as typeof fetch)).rejects.toThrow(
      /OGE.*non-JSON.*HTTP 200.*text\/html.*v3\/rest/
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  test('rejects a changed JSON schema instead of reporting an empty successful collection', async () => {
    await expect(
      fetchTrumpOgePdfs((async () =>
        Response.json({ error: 'service unavailable' })) as typeof fetch)
    ).rejects.toThrow(/OGE.*missing data array/);
  });

  test('a transient discovery error retries, but repeated errors stop after three attempts', async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn(async () => new Response('busy', { status: 503 }));
    const assertion = expect(fetchTrumpOgePdfs(fetchFn as typeof fetch)).rejects.toThrow(
      /OGE HTTP 503/
    );
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  test('an HTML PDF response reports the reason and remains eligible for a future retry', async () => {
    const cache = emptyPoliticsCache();
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ data: [row] }))
      .mockResolvedValueOnce(
        new Response('<html>Service unavailable</html>', {
          headers: { 'content-type': 'text/html' },
        })
      );
    const extractText = vi.fn();
    const result = await ingestOge278t(cache, { fetchFn: fetchFn as typeof fetch, extractText });
    expect(result.error).toMatch(/example-doc.*non-PDF.*HTTP 200.*text\/html/);
    expect(extractText).not.toHaveBeenCalled();
    expect(cache.seen.ogeDocIds).not.toContain('example-doc');
  });
});
