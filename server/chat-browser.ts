import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { fetchPublicResource, type PublicResponse } from './public-web.js';

export function browserExecutable(): string {
  const candidates = [
    process.env.DOCVAULT_BROWSER_EXECUTABLE,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  const found = candidates.find((v) => v && existsSync(v));
  if (!found)
    throw new Error(
      'Chromium is not installed. Set DOCVAULT_BROWSER_EXECUTABLE to a Chromium executable.'
    );
  return found;
}

export interface BrowserReadResult {
  url: string;
  title: string;
  text: string;
  truncated: boolean;
  links: { text: string; url: string }[];
  blockedRequests: number;
}
interface BrowserReadOptions {
  signal?: AbortSignal;
  /** Test transport: every resource still passes through routing, never Chromium's network. */
  fetchResource?: (url: string, signal: AbortSignal) => Promise<PublicResponse>;
}

export async function readBrowserPage(
  url: string,
  options: BrowserReadOptions = {}
): Promise<BrowserReadResult> {
  const fetchResource =
    options.fetchResource ?? ((raw, signal) => fetchPublicResource(raw, { signal }));
  options.signal?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, 15_000);
  options.signal?.addEventListener('abort', abort, { once: true });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let closeOnAbort: (() => void) | undefined;
  try {
    let requests = 0,
      totalBytes = 0,
      blockedRequests = 0;
    const loadResource = async (raw: string) => {
      for (let redirects = 0; redirects <= 5; redirects++) {
        controller.signal.throwIfAborted();
        if (++requests > 80) throw new Error('Page request limit exceeded');
        const resource = await fetchResource(raw, controller.signal);
        totalBytes += resource.body.length;
        if (totalBytes > 10_000_000) throw new Error('Page exceeds total size limit');
        if ([301, 302, 303, 307, 308].includes(resource.status) && resource.headers.location) {
          raw = new URL(resource.headers.location, raw).href;
          continue;
        }
        return { resource, url: raw };
      }
      throw new Error('Too many redirects');
    };
    // Playwright routing does not intercept every hop of Chromium-followed
    // redirects. Follow and validate them ourselves, never fulfill a redirect.
    const initial = await loadResource(url);
    browser = await chromium.launch({
      executablePath: browserExecutable(),
      headless: true,
      args: [
        ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : []),
        '--disable-dev-shm-usage',
        '--disable-background-networking',
        '--disable-quic',
        '--dns-prefetch-disable',
        '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
        '--host-resolver-rules=MAP * ~NOTFOUND',
      ],
      timeout: 10_000,
    });
    closeOnAbort = () => {
      void browser?.close();
    };
    controller.signal.addEventListener('abort', closeOnAbort, { once: true });
    controller.signal.throwIfAborted();
    const context = await browser.newContext({ acceptDownloads: false, serviceWorkers: 'block' });
    await context.routeWebSocket('**/*', (route) => route.close());
    await context.route('**/*', async (route) => {
      const req = route.request();
      try {
        if (
          !['GET', 'HEAD'].includes(req.method()) ||
          ['image', 'media', 'font'].includes(req.resourceType())
        )
          throw new Error('Blocked resource');
        const { resource } =
          req.isNavigationRequest() && req.url() === initial.url
            ? initial
            : await loadResource(req.url());
        if (resource.status >= 300 && resource.status < 400)
          throw new Error('Unsupported redirect');
        await route.fulfill({
          status: resource.status,
          headers: resource.headers,
          body: req.method() === 'HEAD' ? Buffer.alloc(0) : resource.body,
        });
      } catch {
        blockedRequests++;
        await route.abort('blockedbyclient').catch(() => {});
      }
    });
    const page = await context.newPage();
    const response = await page.goto(initial.url, {
      waitUntil: 'domcontentloaded',
      timeout: 10_000,
    });
    if (!response || response.status() >= 400)
      throw new Error(`Page could not be read (HTTP ${response?.status() ?? 'unknown'})`);
    await page.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => {});
    controller.signal.throwIfAborted();
    const extracted = await page.evaluate(() => {
      // Structural browser types keep the backend's Node/Bun typecheck free of DOM globals.
      interface ReadableElement {
        innerText: string;
        querySelectorAll(selector: string): { innerText: string; href: string }[];
      }
      const document = (
        globalThis as unknown as {
          document: {
            title: string;
            body: ReadableElement;
            querySelector(selector: string): ReadableElement | null;
          };
        }
      ).document;
      const root = document.querySelector('article, main') ?? document.body;
      const text = root?.innerText ?? '';
      const links = Array.from(root?.querySelectorAll('a[href]') ?? [])
        .filter((a) => /^https?:/.test(a.href))
        .slice(0, 50)
        .map((a) => ({ text: a.innerText.trim().slice(0, 200), url: a.href }));
      return {
        title: document.title,
        text: text.slice(0, 30_000),
        truncated: text.length > 30_000,
        links,
      };
    });
    return { url: page.url(), ...extracted, blockedRequests };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    if (closeOnAbort) controller.signal.removeEventListener('abort', closeOnAbort);
    controller.abort();
    await browser?.close();
  }
}
