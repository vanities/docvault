// Real Chromium, fake public pages: no web server or external network required.
import { expect, test } from 'vite-plus/test';
import { readBrowserPage } from './chat-browser.js';
import { resolvePublicUrl, type PublicResponse } from './public-web.js';

const response = (
  body: string,
  status = 200,
  headers = { 'content-type': 'text/html' }
): PublicResponse => ({ status, headers, body: Buffer.from(body) });
test('reads JavaScript-rendered content and follows public redirects', async () => {
  const seen: string[] = [];
  const result = await readBrowserPage('https://fixture.example.test/start', {
    fetchResource: async (url) => {
      seen.push(url);
      if (url.endsWith('/start'))
        return response('', 302, {
          location: 'https://fixture.example.test/article',
          'content-type': 'text/html',
        });
      if (url.endsWith('/data'))
        return response('{"text":"Rendered synthetic article"}', 200, {
          'content-type': 'application/json',
        });
      return response(
        `<title>Dynamic fixture</title><main>Loading</main><script>fetch('/data').then(r=>r.json()).then(d=>{document.querySelector('main').innerHTML=d.text+'<a href="https://example.org/source">Primary source</a><span style="display:none">hidden fixture</span>'})</script>`
      );
    },
  });
  expect(result).toMatchObject({
    title: 'Dynamic fixture',
    url: 'https://fixture.example.test/article',
    truncated: false,
  });
  expect(result.text).toContain('Rendered synthetic article');
  expect(result.text).not.toContain('hidden fixture');
  expect(result.links).toContainEqual({
    text: 'Primary source',
    url: 'https://example.org/source',
  });
  expect(seen).toContain('https://fixture.example.test/data');
}, 20_000);
test('blocks private redirects, POSTs, and websocket connections', async () => {
  const requests: string[] = [];
  const result = await readBrowserPage('https://fixture.example.test/', {
    fetchResource: async (url) => {
      await resolvePublicUrl(url, async () => [{ address: '93.184.216.34', family: 4 }]);
      requests.push(url);
      if (url.endsWith('/redirect'))
        return response('', 302, {
          location: 'http://127.0.0.1:3005/private',
          'content-type': 'text/html',
        });
      return response(
        `<main>Safe fixture</main><script>fetch('/redirect').catch(()=>{});fetch('/write',{method:'POST',body:'x'}).catch(()=>{});new WebSocket('ws://127.0.0.1:3005');</script>`
      );
    },
  });
  expect(result.text).toBe('Safe fixture');
  expect(result.blockedRequests).toBeGreaterThanOrEqual(2);
  expect(requests.some((url) => url.includes('/write') || url.includes('/private'))).toBe(false);
}, 20_000);
test('rejects local URLs and honours cancellation', async () => {
  await expect(readBrowserPage('http://127.0.0.1/')).rejects.toThrow(/blocked/);
  const controller = new AbortController();
  controller.abort();
  await expect(
    readBrowserPage('https://fixture.example.test/', {
      signal: controller.signal,
      fetchResource: async () => response('<main>unused</main>'),
    })
  ).rejects.toThrow();
});
