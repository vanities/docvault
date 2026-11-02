// Connectivity monitor: what counts as a network failure, when a probe says the
// internet is down, and how an outage is opened, saved, resumed and closed.
// Fake probes and a fake clock in a temp dir; nothing here touches the network.
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test';
import {
  CONNECTIVITY_FILE,
  DEFAULT_PROBE_URLS,
  createConnectivityMonitor,
  looksLikeNetworkFailure,
  probeUrls,
  type ConnectivityMonitor,
  type Probe,
} from './connectivity';

const URLS = ['https://probe-a.example/', 'https://probe-b.example/'];
const T0 = '2030-03-01T06:50:00.000Z';

let dir: string;
const monitors: ConnectivityMonitor[] = [];

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'docvault-connectivity-'));
});

afterEach(async () => {
  for (const m of monitors.splice(0)) m.stop();
  await rm(dir, { recursive: true, force: true });
});

function setup(opts: { up: boolean; pollMs?: number }) {
  let up = opts.up;
  let t = Date.parse(T0);
  const calls: string[] = [];
  const probe: Probe = async (url) => {
    calls.push(url);
    return up;
  };
  const monitor = createConnectivityMonitor({
    dataDir: dir,
    probe,
    urls: () => URLS,
    now: () => new Date(t),
    pollMs: opts.pollMs ?? 60 * 60 * 1000,
  });
  monitors.push(monitor);
  return {
    monitor,
    calls,
    setUp: (value: boolean) => {
      up = value;
    },
    advance: (ms: number) => {
      t += ms;
    },
    at: () => new Date(t).toISOString(),
  };
}

const saved = async () =>
  JSON.parse(await readFile(path.join(dir, CONNECTIVITY_FILE), 'utf8')) as {
    outages: Array<{ from: string; to: string | null }>;
  };

describe('looksLikeNetworkFailure', () => {
  test('matches failures that never reached their source', () => {
    for (const text of [
      'getaddrinfo EAI_AGAIN api.example.invalid',
      '[feed] fetch failed: getaddrinfo EAI_AGAIN feeds.example.invalid',
      'SnaptradeError: getaddrinfo ENOTFOUND api.example.invalid',
      'The operation timed out.',
      'Connection error.',
      'Unable to connect. Is the computer able to access the url?',
      'Post "https://api.example.invalid": dial tcp: lookup api.example.invalid: no such host',
      'read tcp 10.0.0.2:51515->10.0.0.9:443: i/o timeout',
    ]) {
      expect(looksLikeNetworkFailure(text), text).toBe(true);
    }
  });

  test('leaves a source that answered as a real failure', () => {
    for (const text of [
      'HTTP 403 Forbidden',
      '[feed] fetch failed: HTTP 403',
      'Resend 422: invalid from address',
      'Unexpected token < in JSON at position 0',
      'Script exited 1',
      '',
      null,
      undefined,
    ]) {
      expect(looksLikeNetworkFailure(text), String(text)).toBe(false);
    }
  });
});

describe('probeUrls', () => {
  test('the test run itself never probes the real internet (vite.config.ts test.env)', () => {
    expect(probeUrls()).toBe('off');
  });

  test('defaults, a custom list, and off', () => {
    expect(probeUrls('')).toEqual(DEFAULT_PROBE_URLS);
    expect(probeUrls('  ')).toEqual(DEFAULT_PROBE_URLS);
    expect(probeUrls(' off ')).toBe('off');
    expect(probeUrls('NONE')).toBe('off');
    expect(probeUrls('https://a.example/, https://b.example/')).toEqual([
      'https://a.example/',
      'https://b.example/',
    ]);
    expect(probeUrls(',')).toEqual(DEFAULT_PROBE_URLS);
  });
});

describe('createConnectivityMonitor', () => {
  test('one reachable endpoint means online, and nothing is written', async () => {
    const calls: string[] = [];
    const monitor = createConnectivityMonitor({
      dataDir: dir,
      urls: () => URLS,
      probe: async (url) => {
        calls.push(url);
        return url === URLS[1];
      },
    });
    monitors.push(monitor);
    expect(await monitor.internetIsDown()).toBe(false);
    expect(calls).toEqual(URLS);
    await expect(readFile(path.join(dir, CONNECTIVITY_FILE), 'utf8')).rejects.toThrow();
  });

  test('an outage opens on a failed probe, is cached, and closes on the first good probe', async () => {
    const { monitor, calls, setUp, advance, at } = setup({ up: false });
    let reconnects = 0;
    monitor.onReconnect(() => {
      reconnects++;
    });

    const from = at();
    expect(await monitor.internetIsDown()).toBe(true);
    expect(await monitor.status()).toMatchObject({ online: false, offlineSince: from });
    expect((await saved()).outages).toEqual([{ from, to: null }]);

    // Inside the cache window nobody probes again.
    advance(30_000);
    expect(await monitor.internetIsDown()).toBe(true);
    expect(calls).toHaveLength(URLS.length);

    advance(110 * 60_000);
    setUp(true);
    const to = at();
    expect(await monitor.checkNow()).toBe(true);
    await Promise.resolve();
    expect(reconnects).toBe(1);
    expect(await monitor.status()).toMatchObject({
      online: true,
      offlineSince: null,
      lastOutageEnd: to,
    });
    expect((await saved()).outages).toEqual([{ from, to }]);

    // Staying online doesn't fire the listeners again.
    advance(120_000);
    expect(await monitor.checkNow()).toBe(true);
    await Promise.resolve();
    expect(reconnects).toBe(1);
  });

  test('an "up" answer is never reused: the line can drop right after a good probe', async () => {
    const { monitor, calls, setUp, advance } = setup({ up: true });
    expect(await monitor.internetIsDown()).toBe(false);
    setUp(false);
    advance(10_000);
    expect(await monitor.internetIsDown()).toBe(true);
    expect(calls).toHaveLength(URLS.length * 2);
  });

  test('failures that land together share one probe', async () => {
    const { monitor, calls } = setup({ up: false });
    const results = await Promise.all(Array.from({ length: 6 }, () => monitor.internetIsDown()));
    expect(results).toEqual(Array(6).fill(true));
    expect(calls).toHaveLength(URLS.length);
    expect((await saved()).outages).toHaveLength(1);
  });

  test('an outage saved before a restart continues instead of starting over', async () => {
    const from = '2030-03-01T05:00:00.000Z';
    await writeFile(
      path.join(dir, CONNECTIVITY_FILE),
      JSON.stringify({ outages: [{ from, to: null }] })
    );
    const { monitor, calls, setUp, at } = setup({ up: false });
    await monitor.start();
    expect(await monitor.status()).toMatchObject({ online: false, offlineSince: from });
    await monitor.checkNow();
    expect(calls.length).toBeGreaterThan(0);
    expect((await saved()).outages).toEqual([{ from, to: null }]);

    setUp(true);
    await monitor.checkNow();
    expect((await saved()).outages).toEqual([{ from, to: at() }]);
  });

  test('while down, the poller finds the internet coming back on its own', async () => {
    const { monitor, setUp } = setup({ up: false, pollMs: 15 });
    const back = new Promise<void>((resolve) => monitor.onReconnect(resolve));
    expect(await monitor.internetIsDown()).toBe(true);
    setUp(true);
    await Promise.race([
      back,
      new Promise((_, reject) => setTimeout(() => reject(new Error('poller never fired')), 2000)),
    ]);
    expect((await monitor.status()).online).toBe(true);
  });

  test('probes turned off means always online, without probing', async () => {
    const calls: string[] = [];
    const monitor = createConnectivityMonitor({
      dataDir: dir,
      urls: () => 'off',
      probe: async (url) => {
        calls.push(url);
        return false;
      },
    });
    monitors.push(monitor);
    expect(await monitor.internetIsDown()).toBe(false);
    expect(calls).toEqual([]);
    expect((await monitor.status()).mode).toBe('off');
  });

  test('an unreadable file starts empty instead of throwing', async () => {
    await writeFile(path.join(dir, CONNECTIVITY_FILE), '{not json');
    const { monitor } = setup({ up: true });
    expect(await monitor.internetIsDown()).toBe(false);
    expect((await monitor.status()).outages).toEqual([]);
  });
});
