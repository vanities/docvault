// The bundled DocVault health add-on, run as the real script (dry run) against a fake
// DocVault API on localhost. Fabricated jobs, syncs and sends; nothing is reported or sent.
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test';

const SCRIPT = path.join(import.meta.dirname, '../examples/jobs/scripts/docvault-health.local.ts');
const MIN = 60_000;
const HOUR = 60 * MIN;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

interface Check {
  id: string;
  active: boolean;
  value: string;
}
interface Report {
  checks: Check[];
  detail: { data: { jobs: Array<{ id: string; state: string }> } };
}

let api: unknown = {};
let server: http.Server;
let base: string;
let dataDir: string;

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'docvault-health-addon-'));
  server = http.createServer((req, res) => {
    const routes = api as Record<string, unknown>;
    const key = (req.url ?? '').split('?')[0];
    res.setHeader('content-type', 'application/json');
    if (!(key in routes)) {
      res.statusCode = 404;
      res.end('{}');
      return;
    }
    res.end(JSON.stringify(routes[key]));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
});

async function runAddon(): Promise<Report> {
  const { stdout } = await promisify(execFile)('bun', ['run', SCRIPT], {
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      DOCVAULT_API_BASE: base,
      DOCVAULT_DATA_DIR: dataDir,
      DOCVAULT_JOB_ID: 'docvault-health',
      DOCVAULT_DRY_RUN: '1',
      DOCVAULT_PRINT_REPORT: '1',
    },
    timeout: 30_000,
  });
  const line = stdout.split('\n').find((l) => l.startsWith('{'));
  if (!line) throw new Error(`no report printed:\n${stdout}`);
  return JSON.parse(line) as Report;
}

const check = (r: Report, id: string) => r.checks.find((c) => c.id === id)!;

/** A server that booted 30 min ago, after being off for hours, with the internet still down. */
function afterPowerCut(connectivity: Record<string, unknown> | undefined) {
  const offline = ago(28 * MIN);
  const status = (over: Record<string, unknown>) => ({
    lastRanAt: ago(29 * MIN),
    lastSuccessAt: ago(9 * HOUR),
    lastError: null,
    consecutiveFailures: 0,
    ...over,
  });
  return {
    '/api/sync-status': { status: 'error', lastSync: ago(20 * MIN), errors: 2 },
    '/api/jobs': {
      builtInJobs: [
        {
          id: 'dropbox-sync',
          label: 'Dropbox sync',
          enabled: true,
          schedule: 'every 15m',
          status: status({
            lastSuccessAt: ago(9 * HOUR),
            lastError:
              'Dropbox sync had 2 error(s): dial tcp: lookup example.invalid: no such host',
            offlineSince: offline,
          }),
        },
      ],
      customJobs: [
        {
          manifest: { id: 'feed-watch', label: 'Feed watch', enabled: true, schedule: 'every 15m' },
        },
        {
          manifest: {
            id: 'quiet-watch',
            label: 'Quiet watch',
            enabled: true,
            schedule: 'every 15m',
          },
        },
        { manifest: { id: 'broken-feed', label: 'Broken feed', enabled: true, schedule: 'daily' } },
      ],
      customJobStatuses: {
        'feed-watch': status({
          lastError: 'Script exited 1: getaddrinfo EAI_AGAIN feeds.example.invalid',
          offlineSince: offline,
        }),
        'quiet-watch': status({ lastRanAt: ago(9 * HOUR) }),
        'broken-feed': status({ lastError: 'HTTP 403', consecutiveFailures: 3 }),
      },
      ...(connectivity ? { connectivity } : {}),
    },
    '/api/email/log': {
      entries: [
        { at: ago(10 * MIN), ok: false, purpose: 'news', offline: true },
        { at: ago(20 * MIN), ok: false, purpose: 'news', offline: true },
        { at: ago(23 * HOUR), ok: true, purpose: 'news' },
      ],
    },
  };
}

describe('docvault-health add-on during an internet outage', () => {
  test('waiting is not failing, and time the server was off is not time stalled', async () => {
    api = afterPowerCut({
      online: false,
      bootedAt: ago(30 * MIN),
      offlineSince: ago(28 * MIN),
      lastOutageEnd: null,
      outages: [{ from: ago(28 * MIN), to: null }],
    });
    const r = await runAddon();

    expect(check(r, 'backup:errors')).toMatchObject({ active: false });
    expect(check(r, 'backup:errors').value).toContain('internet was down');
    // A job that hit a real refusal is still reported.
    expect(check(r, 'jobs:failing')).toMatchObject({
      active: true,
      value: '1 failing: Broken feed',
    });
    // Its last success was 9 h ago, but the server has only been up 30 min.
    expect(check(r, 'jobs:stale')).toMatchObject({ active: false });
    expect(check(r, 'email:failing')).toMatchObject({ active: false });
    expect(check(r, 'email:failing').value).toContain('2 more waited out an internet outage');
    expect(check(r, 'internet:down')).toMatchObject({ active: false });
    expect(check(r, 'internet:down').value).toMatch(/^down for 28 min; 2 job\(s\) waiting$/);
    const states = Object.fromEntries(r.detail.data.jobs.map((j) => [j.id, j.state]));
    expect(states).toMatchObject({
      'dropbox-sync': 'waiting',
      'feed-watch': 'waiting',
      'quiet-watch': 'ok',
      'broken-feed': 'failing',
    });
  }, 40_000);

  test('a long outage trips the Internet check', async () => {
    api = afterPowerCut({
      online: false,
      bootedAt: ago(8 * HOUR),
      offlineSince: ago(7 * HOUR),
      lastOutageEnd: null,
      outages: [{ from: ago(7 * HOUR), to: null }],
    });
    expect(check(await runAddon(), 'internet:down')).toMatchObject({
      active: true,
      value: 'down for 7.0 h; 2 job(s) waiting',
    });
  }, 40_000);

  test('a server without the connectivity report is judged as before', async () => {
    api = afterPowerCut(undefined);
    const r = await runAddon();
    expect(check(r, 'jobs:stale')).toMatchObject({ active: true, value: '1 stale: Quiet watch' });
    expect(check(r, 'internet:down').value).toBe('not reported by this server');
  }, 40_000);
});
