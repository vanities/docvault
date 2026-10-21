// Synthetic alert sources in an isolated directory; email is mocked, nothing is sent.
import { afterAll, beforeEach, describe, expect, test, vi } from 'vite-plus/test';
import { promises as fs } from 'node:fs';

const dataDir = vi.hoisted(() => {
  const os = require('node:os') as typeof import('node:os');
  const p = require('node:path') as typeof import('node:path');
  return p.join(os.tmpdir(), `docvault-alerts-test-${Date.now()}`);
});
const sendEmail = vi.hoisted(() =>
  vi.fn(async (_input: Record<string, unknown>) => ({
    ok: true as boolean,
    error: undefined as string | undefined,
  }))
);
vi.mock('./data.js', () => ({
  DATA_DIR: dataDir,
  ensureDir: (dir: string) => fs.mkdir(dir, { recursive: true }),
  getEmailConfig: async () => ({
    apiKey: 'test-key',
    toEmail: 'owner@example.com\nnewsletter-reader@example.com',
    cc: {},
  }),
  jsonResponse: (data: unknown, status = 200) => Response.json(data, { status }),
}));
vi.mock('./email.js', () => ({ sendEmail }));
vi.mock('./logger.js', () => ({
  createLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    timer: () => () => 0,
  }),
}));

import path from 'node:path';
import {
  alertSettingsForJob,
  checkStaleAlertSources,
  listAlerts,
  reportAlertFailure,
  reportAlerts,
  setAlertSourceSettings,
  type AlertCheckInput,
  type AlertReportInput,
} from './alerts.js';
import { createCustomJobManifest } from './jobs.js';
import { handleAlertsRoutes } from './routes/alerts.js';

const T0 = new Date('2030-01-01T00:00:00.000Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

function check(overrides: Partial<AlertCheckInput> = {}): AlertCheckInput {
  return {
    id: 'demo-vault:free-cash',
    label: 'Free cash',
    scope: 'Demo Vault',
    severity: 'critical',
    active: false,
    value: '42.0%',
    threshold: 'below 5%',
    ...overrides,
  };
}

function report(
  checks: AlertCheckInput[],
  extra: Partial<AlertReportInput> = {}
): AlertReportInput {
  return { sourceId: 'demo-source', label: 'Demo source', checks, ...extra };
}

const lastEmail = () => sendEmail.mock.calls.at(-1)?.[0] as Record<string, string>;

beforeEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
  sendEmail.mockClear();
  sendEmail.mockImplementation(async () => ({ ok: true, error: undefined }));
});
afterAll(() => fs.rm(dataDir, { recursive: true, force: true }));

describe('reportAlerts email policy', () => {
  test('a new trip emails once, to the first configured address only', async () => {
    const tripped = [check({ active: true, value: '2.0%' })];
    expect((await reportAlerts(report(tripped), { now: at(0) })).emailed).toBe('trip');
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(lastEmail()).toMatchObject({
      to: 'owner@example.com',
      cc: '',
      purpose: 'news',
      subject: 'ACT NOW: Free cash',
      ref: 'alerts:demo-source:trip',
    });
    expect(lastEmail().text).toContain('Just tripped');

    expect((await reportAlerts(report(tripped), { now: at(15) })).emailed).toBeNull();
    expect((await reportAlerts(report(tripped), { now: at(359) })).emailed).toBeNull();
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  test('a check still tripped 6 hours after the last email gets a reminder', async () => {
    const tripped = [check({ active: true })];
    await reportAlerts(report(tripped), { now: at(0) });
    expect((await reportAlerts(report(tripped), { now: at(360) })).emailed).toBe('reminder');
    expect(lastEmail().text).toContain('Still tripped');
    expect((await reportAlerts(report(tripped), { now: at(375) })).emailed).toBeNull();
    expect((await reportAlerts(report(tripped), { now: at(720) })).emailed).toBe('reminder');
    expect(sendEmail).toHaveBeenCalledTimes(3);
  });

  test('recoveries and all-good reports never email; cleared checks ride along with bad news', async () => {
    const a = check({ id: 'a', label: 'Check A', scope: '' });
    const b = check({ id: 'b', label: 'Check B', scope: '' });
    expect((await reportAlerts(report([a, b]), { now: at(0) })).emailed).toBeNull();
    expect((await reportAlerts(report([{ ...a, active: true }, b]), { now: at(15) })).emailed).toBe(
      'trip'
    );
    expect((await reportAlerts(report([a, b]), { now: at(30) })).emailed).toBeNull();
    expect((await reportAlerts(report([a, b]), { now: at(45) })).emailed).toBeNull();
    expect(sendEmail).toHaveBeenCalledTimes(1);

    await reportAlerts(report([{ ...a, active: true }, b]), { now: at(60) });
    await reportAlerts(
      report([
        { ...a, value: '50.0%' },
        { ...b, active: true },
      ]),
      { now: at(75) }
    );
    expect(lastEmail().text).toContain('Cleared');
    expect(lastEmail().text).toContain('Check A is back to 50.0%');
  });

  test('warning subjects name the scope unless the label already does', async () => {
    await reportAlerts(report([check({ severity: 'warning', active: true })]), { now: at(0) });
    expect(lastEmail().subject).toBe('Alert warning: Free cash (Demo Vault)');
    await reportAlerts(
      report(
        [check({ id: 'x', severity: 'warning', active: true, label: 'Demo Vault free cash' })],
        {
          sourceId: 'other-source',
        }
      ),
      { now: at(0) }
    );
    expect(lastEmail().subject).toBe('Alert warning: Demo Vault free cash');
  });

  test('a failed send is not stamped and is retried at most hourly', async () => {
    sendEmail.mockImplementationOnce(async () => ({ ok: false, error: 'provider down' }));
    const tripped = [check({ active: true })];
    expect(await reportAlerts(report(tripped), { now: at(0) })).toMatchObject({
      emailed: null,
      emailError: 'provider down',
    });
    expect((await reportAlerts(report(tripped), { now: at(15) })).emailed).toBeNull();
    expect((await reportAlerts(report(tripped), { now: at(61) })).emailed).toBe('trip');
    expect(sendEmail).toHaveBeenCalledTimes(2);
    const { sources } = await listAlerts();
    expect(sources[0].checks[0].lastAlertAt).toBe(at(61).toISOString());
    expect(sources[0].checks[0].since).toBe(at(0).toISOString());
  });
});

describe('blind alerts', () => {
  test('the third consecutive failure emails once; a successful report resets the streak', async () => {
    await reportAlerts(report([check()]), { now: at(0) });
    for (const n of [1, 2]) {
      expect(await reportAlertFailure('demo-source', `timeout ${n}`, { now: at(n) })).toMatchObject(
        {
          emailed: null,
          failures: n,
        }
      );
    }
    expect((await reportAlertFailure('demo-source', 'timeout 3', { now: at(3) })).emailed).toBe(
      'blind'
    );
    expect(lastEmail().subject).toBe("Alert blind: Demo source can't see its data");
    expect(
      (await reportAlertFailure('demo-source', 'timeout 4', { now: at(4) })).emailed
    ).toBeNull();
    expect(sendEmail).toHaveBeenCalledTimes(1);

    await reportAlerts(report([check()]), { now: at(5) });
    expect((await listAlerts()).sources[0].failures).toBe(0);
    for (const n of [6, 7]) await reportAlertFailure('demo-source', 'again', { now: at(n) });
    expect((await reportAlertFailure('demo-source', 'again', { now: at(8) })).emailed).toBe(
      'blind'
    );
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  test('a source whose enabled job stops reporting emails once per stale episode', async () => {
    const job = {
      id: 'demo-job',
      label: 'Demo job',
      schedule: 'every 15m',
      script: 'scripts/demo.local.ts',
      enabled: true,
    };
    await createCustomJobManifest(job, { dataDir });
    await reportAlerts(report([check()], { jobId: 'demo-job' }), { now: at(0) });

    expect((await checkStaleAlertSources({ now: at(30) })).notified).toEqual([]);
    expect((await checkStaleAlertSources({ now: at(46) })).notified).toEqual(['demo-source']);
    expect(lastEmail().subject).toBe('Alert blind: Demo source stopped reporting');
    expect((await checkStaleAlertSources({ now: at(90) })).notified).toEqual([]);

    await reportAlerts(report([check()], { jobId: 'demo-job' }), { now: at(100) });
    expect((await checkStaleAlertSources({ now: at(146) })).notified).toEqual(['demo-source']);

    await createCustomJobManifest({ ...job, enabled: false }, { dataDir, overwrite: true });
    await reportAlerts(report([check()], { jobId: 'demo-job' }), { now: at(200) });
    expect((await checkStaleAlertSources({ now: at(2000) })).notified).toEqual([]);
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });
});

describe('owner email switch', () => {
  test('muted trips send nothing; turning emails back on mails what is still tripped', async () => {
    await reportAlerts(report([check()]), { now: at(0) });
    expect(await setAlertSourceSettings('demo-source', { emails: false })).not.toBeNull();
    const tripped = [check({ active: true })];
    expect((await reportAlerts(report(tripped), { now: at(15) })).emailed).toBeNull();
    expect((await reportAlerts(report(tripped), { now: at(30) })).emailed).toBeNull();
    expect(sendEmail).not.toHaveBeenCalled();
    expect((await listAlerts()).sources[0].emails).toBe(false);

    await setAlertSourceSettings('demo-source', { emails: true });
    expect((await reportAlerts(report(tripped), { now: at(45) })).emailed).toBe('trip');
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect((await listAlerts()).sources[0].emails).toBeUndefined();
  });

  test('muted sources send no blind emails either', async () => {
    await createCustomJobManifest(
      {
        id: 'demo-job',
        label: 'Demo job',
        schedule: 'every 15m',
        script: 'scripts/demo.local.ts',
        enabled: true,
      },
      { dataDir }
    );
    await reportAlerts(report([check()], { jobId: 'demo-job' }), { now: at(0) });
    await setAlertSourceSettings('demo-source', { emails: false });
    for (const n of [1, 2, 3, 4]) await reportAlertFailure('demo-source', 'down', { now: at(n) });
    expect((await checkStaleAlertSources({ now: at(500) })).notified).toEqual([]);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test('unknown sources have no settings to change', async () => {
    expect(await setAlertSourceSettings('missing-source', { emails: false })).toBeNull();
  });
});

describe('owner settings', () => {
  const specs = [
    { key: 'lineHigh', label: 'Trip above', unit: '%', default: 90, min: 50, max: 100 },
    { key: 'graceRuns', label: 'Grace runs', default: 3, min: 1, max: 10 },
  ];

  test('values validate against what the job declared; only real changes are stored', async () => {
    await reportAlerts(report([check()], { settings: specs }), { now: at(0) });
    const saved = await setAlertSourceSettings('demo-source', {
      values: { lineHigh: 80, graceRuns: 3 },
    });
    expect(saved?.values).toEqual({ lineHigh: 80 });
    await expect(
      setAlertSourceSettings('demo-source', { values: { lineHigh: 101 } })
    ).rejects.toThrow('Trip above must be between 50 and 100');
    await expect(
      setAlertSourceSettings('demo-source', { values: { lineHigh: 70, nope: 1 } })
    ).rejects.toThrow('Unknown setting "nope"');
    expect((await listAlerts()).sources[0].values, 'a rejected edit saves nothing').toEqual({
      lineHigh: 80,
    });
    const reset = await setAlertSourceSettings('demo-source', { values: { lineHigh: null } });
    expect(reset?.values).toBeUndefined();
  });

  test('values outlive reports until the job stops declaring them or narrows the range', async () => {
    await reportAlerts(report([check()], { settings: specs }), { now: at(0) });
    await setAlertSourceSettings('demo-source', { values: { lineHigh: 60, graceRuns: 5 } });
    await reportAlerts(report([check()], { settings: specs }), { now: at(15) });
    expect((await listAlerts()).sources[0].values).toEqual({ lineHigh: 60, graceRuns: 5 });

    await reportAlerts(report([check()]), { now: at(30) });
    const bare = (await listAlerts()).sources[0];
    expect(bare.values, 'a report without a settings list keeps values').toEqual({
      lineHigh: 60,
      graceRuns: 5,
    });
    expect(bare.settings).toBeUndefined();

    await reportAlerts(report([check()], { settings: [{ ...specs[0], min: 70 }] }), {
      now: at(45),
    });
    expect((await listAlerts()).sources[0].values).toBeUndefined();
  });

  test("a job run gets the owner's values for its own sources only", async () => {
    await reportAlerts(report([check()], { jobId: 'demo-job', settings: specs }), { now: at(0) });
    await reportAlerts(
      {
        ...report([check()], { jobId: 'other-job', settings: specs }),
        sourceId: 'other-source',
        label: 'Other source',
      },
      { now: at(0) }
    );
    await setAlertSourceSettings('demo-source', { values: { lineHigh: 75 } });
    await setAlertSourceSettings('other-source', { values: { graceRuns: 2 } });
    expect(await alertSettingsForJob('demo-job')).toEqual({ 'demo-source': { lineHigh: 75 } });
    expect(await alertSettingsForJob('missing-job')).toEqual({});
  });

  test('a source that declares no settings refuses values', async () => {
    await reportAlerts(report([check()]), { now: at(0) });
    await expect(
      setAlertSourceSettings('demo-source', { values: { lineHigh: 80 } })
    ).rejects.toThrow('This alert has no settings to change');
  });
});

describe('one outage, one blind email', () => {
  test('after the failure-streak email, the stale watchdog stays quiet', async () => {
    await createCustomJobManifest(
      {
        id: 'demo-job',
        label: 'Demo job',
        schedule: 'every 15m',
        script: 'scripts/demo.local.ts',
        enabled: true,
      },
      { dataDir }
    );
    await reportAlerts(report([check()], { jobId: 'demo-job' }), { now: at(0) });
    for (const n of [15, 30, 45]) await reportAlertFailure('demo-source', 'down', { now: at(n) });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect((await checkStaleAlertSources({ now: at(60) })).notified).toEqual([]);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
});

describe('stored history', () => {
  test('series keeps 14 days and detail is stored as sent', async () => {
    const detail = { kind: 'example-kind', data: { items: [1, 2, 3] } };
    await reportAlerts(report([check()], { series: { 'demo.value': 1 }, detail }), { now: at(0) });
    await reportAlerts(report([check()], { series: { 'demo.value': 2 } }), {
      now: at(15 * 24 * 60),
    });
    const [source] = (await listAlerts()).sources;
    expect(source.series.map((p) => p.values['demo.value'])).toEqual([2]);
    expect(source.detail).toBeUndefined();
  });
});

describe('alert jobs that have never reported', () => {
  test('are listed from their manifest until the first report takes the row over', async () => {
    await createCustomJobManifest(
      {
        id: 'demo-job',
        label: 'Demo alert job',
        schedule: 'every 6h',
        script: 'scripts/demo.local.ts',
        tags: ['alerts', 'demo'],
      },
      { dataDir }
    );
    await createCustomJobManifest(
      { id: 'plain-job', label: 'Plain job', schedule: 'daily', script: 'scripts/plain.local.ts' },
      { dataDir }
    );
    const folder = path.join(dataDir, 'alerts', 'demo-job');
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, 'dashboard.html'), '<p>demo dashboard</p>');

    const before = (await listAlerts()).sources;
    expect(
      before.map((s) => s.id),
      'a job without the alerts tag is not an alert'
    ).toEqual(['demo-job']);
    expect(before[0]).toMatchObject({
      label: 'Demo alert job',
      placeholder: true,
      reportedAt: null,
      failures: 0,
      checks: [],
      series: [],
      hasDashboard: true,
      job: { id: 'demo-job', enabled: false, schedule: 'every 6h' },
    });
    expect(
      await setAlertSourceSettings('demo-job', { emails: false }),
      'nothing is stored for it'
    ).toBeNull();

    await reportAlerts(report([check()], { jobId: 'demo-job' }), { now: at(0) });
    const after = (await listAlerts()).sources;
    expect(
      after.map((s) => s.id),
      'its report replaces it, even under another source id'
    ).toEqual(['demo-source']);
    expect(after[0].placeholder).toBeUndefined();
  });

  test('a stored source that already uses the job id is not listed twice', async () => {
    await createCustomJobManifest(
      {
        id: 'demo-source',
        label: 'Demo alert job',
        schedule: 'hourly',
        script: 'scripts/demo.local.ts',
        tags: ['alerts'],
      },
      { dataDir }
    );
    await reportAlerts(report([check()]), { now: at(0) });
    expect((await listAlerts()).sources.map((s) => [s.id, s.placeholder])).toEqual([
      ['demo-source', undefined],
    ]);
  });
});

describe('alerts routes', () => {
  async function call(method: string, pathname: string, body?: unknown) {
    const url = new URL(`http://internal${pathname}`);
    const init: RequestInit = { method };
    if (body !== undefined) {
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
      init.headers = { 'Content-Type': 'application/json' };
    }
    const response = await handleAlertsRoutes(new Request(url, init), url, pathname);
    if (!response) throw new Error('route did not handle request');
    return response;
  }

  const valid = {
    sourceId: 'demo-source',
    label: 'Demo source',
    jobId: 'demo-job',
    checks: [check({ active: true })],
    series: { 'demo.value': 1.5 },
    detail: { kind: 'example-kind', data: { note: 'synthetic' } },
  };

  test('rejects malformed reports with a readable 400', async () => {
    const bad: unknown[] = [
      { ...valid, sourceId: 'Bad_Source' },
      { ...valid, surprise: true },
      { ...valid, checks: [{ ...check(), severity: 'panic' }] },
      { ...valid, checks: [{ ...check(), active: 'yes' }] },
      { ...valid, checks: [check(), check()] },
      { ...valid, checks: Array.from({ length: 101 }, (_, i) => check({ id: `c${i}` })) },
      { ...valid, label: 'x'.repeat(121) },
      { ...valid, detail: { kind: 'example-kind', data: 'x'.repeat(300 * 1024) } },
      { ...valid, series: { 'demo.value': 'high' } },
      { ...valid, settings: [{ key: 'bad key', label: 'Bad', default: 1 }] },
      { ...valid, settings: [{ key: 'line', label: 'Line', default: '1' }] },
      { ...valid, settings: [{ key: 'line', label: 'Line', default: 5, min: 10 }] },
      { ...valid, settings: [{ key: 'line', label: 'Line', default: 1, step: 0 }] },
      { ...valid, settings: [{ key: 'line', label: 'Line', default: 1, surprise: true }] },
      {
        ...valid,
        settings: [
          { key: 'line', label: 'A', default: 1 },
          { key: 'line', label: 'B', default: 2 },
        ],
      },
      '{"sourceId":"demo-source","label":"Demo","checks":[],"series":{"demo.value":1e400}}',
      '{not json',
    ];
    for (const body of bad) {
      const response = await call('POST', '/api/alerts/report', body);
      expect(response.status, JSON.stringify(body).slice(0, 80)).toBe(400);
      expect((await response.json()).ok).toBe(false);
    }
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test('accepts a valid report and lists it with its job', async () => {
    await createCustomJobManifest(
      { id: 'demo-job', label: 'Demo job', schedule: 'hourly', script: 'scripts/demo.local.ts' },
      { dataDir }
    );
    const response = await call('POST', '/api/alerts/report', valid);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, emailed: 'trip' });

    const listed = await (await call('GET', '/api/alerts')).json();
    expect(listed.sources).toHaveLength(1);
    expect(listed.sources[0]).toMatchObject({
      id: 'demo-source',
      job: { id: 'demo-job', enabled: false, schedule: 'hourly' },
      detail: valid.detail,
    });
    expect(listed.log[0]).toMatchObject({ sourceId: 'demo-source', kind: 'trip', ok: true });

    const failure = await call('POST', '/api/alerts/report-failure', {
      sourceId: 'demo-source',
      error: 'synthetic timeout',
    });
    expect(await failure.json()).toEqual({ ok: true, emailed: null, failures: 1 });

    expect((await call('DELETE', '/api/alerts/sources/demo-source')).status).toBe(200);
    expect((await call('DELETE', '/api/alerts/sources/demo-source')).status).toBe(404);
    expect((await (await call('GET', '/api/alerts')).json()).sources).toEqual([]);
  });

  test('the emails setting is a strict boolean and needs a known source', async () => {
    await call('POST', '/api/alerts/report', valid);
    const off = await call('PUT', '/api/alerts/sources/demo-source/settings', { emails: false });
    expect(await off.json()).toEqual({ ok: true, emails: false, values: {} });
    for (const body of [{ emails: 'no' }, { emails: false, extra: 1 }, '{oops']) {
      expect((await call('PUT', '/api/alerts/sources/demo-source/settings', body)).status).toBe(
        400
      );
    }
    const missing = await call('PUT', '/api/alerts/sources/missing/settings', { emails: true });
    expect(missing.status).toBe(404);
  });

  test('a dashboard file is served sandboxed, with no network, and only from its own folder', async () => {
    await call('POST', '/api/alerts/report', valid);
    expect((await call('GET', '/api/alerts/sources/demo-source/dashboard')).status).toBe(404);
    expect((await (await call('GET', '/api/alerts')).json()).sources[0].hasDashboard).toBe(false);

    const folder = path.join(dataDir, 'alerts', 'demo-source');
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, 'dashboard.html'), '<p>demo dashboard</p>');

    const response = await call('GET', '/api/alerts/sources/demo-source/dashboard');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('<p>demo dashboard</p>');
    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp).toContain('sandbox allow-scripts');
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).not.toContain('allow-same-origin');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await (await call('GET', '/api/alerts')).json()).sources[0].hasDashboard).toBe(true);

    for (const id of ['..%2F..%2Fsecret', '%2E%2E', 'Demo_Source']) {
      expect((await call('GET', `/api/alerts/sources/${id}/dashboard`)).status).toBe(404);
    }
  });

  test('setting values save through the route; bad ones get a readable 400', async () => {
    await call('POST', '/api/alerts/report', {
      ...valid,
      settings: [
        { key: 'lineHigh', label: 'Trip above', unit: '%', default: 90, min: 50, max: 100 },
      ],
    });
    const saved = await call('PUT', '/api/alerts/sources/demo-source/settings', {
      values: { lineHigh: 75 },
    });
    expect(await saved.json()).toEqual({ ok: true, emails: true, values: { lineHigh: 75 } });
    const bad: Array<[unknown, string]> = [
      [{ values: { lineHigh: 120 } }, 'Trip above must be between 50 and 100'],
      [{ values: { unknown: 1 } }, 'Unknown setting "unknown"'],
      [{ values: { lineHigh: 'high' } }, 'values.lineHigh must be a finite number or null'],
      [{ values: { 'bad key': 1 } }, 'has an invalid format'],
      [{}, 'body must set emails, values, or both'],
    ];
    for (const [body, message] of bad) {
      const response = await call('PUT', '/api/alerts/sources/demo-source/settings', body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect((await response.json()).error).toContain(message);
    }
    const listed = await (await call('GET', '/api/alerts')).json();
    expect(listed.sources[0]).toMatchObject({
      values: { lineHigh: 75 },
      settings: [{ key: 'lineHigh', default: 90 }],
    });
  });

  test('a dashboard symlinked out of the alerts folder is refused', async () => {
    await call('POST', '/api/alerts/report', valid);
    const outside = path.join(dataDir, 'outside.html');
    await fs.writeFile(outside, '<p>not yours</p>');
    const folder = path.join(dataDir, 'alerts', 'demo-source');
    await fs.mkdir(folder, { recursive: true });
    await fs.symlink(outside, path.join(folder, 'dashboard.html'));
    expect((await call('GET', '/api/alerts/sources/demo-source/dashboard')).status).toBe(404);
  });
});
