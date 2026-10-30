// The chat's get_alerts tool over a fabricated alerts response: checks and advice for every source,
// detail only when asked for (and capped), never the series history.
import { afterAll, describe, expect, test, vi } from 'vite-plus/test';
import { rmSync } from 'node:fs';

const dataDir = vi.hoisted(() => {
  const os = require('node:os') as typeof import('node:os');
  const p = require('node:path') as typeof import('node:path');
  const dir = p.join(os.tmpdir(), `docvault-chat-get-alerts-${Date.now()}`);
  process.env.DOCVAULT_DATA_DIR = dir;
  return dir;
});
const alerts = vi.hoisted(() => ({
  detailData: { vaults: [{ name: 'Acme Vault', exitPct: 7 }] } as unknown,
}));

vi.mock('../alerts.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../alerts.js')>()),
  listAlerts: async () => ({
    log: [],
    sources: [
      {
        id: 'acme-watch',
        label: 'Acme watch',
        reportedAt: '2030-01-02T15:00:00.000Z',
        failures: 0,
        job: null,
        hasDashboard: false,
        checks: [
          {
            id: 'acme:exit',
            label: 'Exit closing',
            scope: 'Acme Vault',
            severity: 'critical',
            active: true,
            value: '4.2%',
            threshold: 'under 5%',
            since: '2030-01-02T14:00:00.000Z',
            lastAlertAt: '2030-01-02T14:00:00.000Z',
          },
        ],
        advice: { critical: 'Withdraw from Acme Vault.' },
        detail: { kind: 'acme', data: alerts.detailData },
        series: [{ t: '2030-01-02T14:00:00.000Z', values: { exit: 4.2 } }],
      },
      {
        id: 'unconfigured',
        label: 'Not set up yet',
        reportedAt: null,
        failures: 0,
        job: null,
        hasDashboard: false,
        placeholder: true,
        checks: [],
        series: [],
      },
    ],
  }),
}));
vi.mock('../ai/usage-log.js', () => ({ logAiCall: vi.fn(async () => {}) }));

import { docVaultTools } from './chat.js';

const getAlerts = docVaultTools({ config: { entities: [] } }).find((t) => t.name === 'get_alerts')!;
const call = async (args: Record<string, unknown>) =>
  JSON.parse(
    ((await getAlerts.handler(args, {})) as { content: { text: string }[] }).content[0].text
  ) as Record<string, unknown>;

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('get_alerts', () => {
  test('lists real sources with checks and advice, without detail or series', async () => {
    const out = await call({});
    const sources = out.sources as Record<string, unknown>[];
    expect(sources.map((s) => s.id)).toEqual(['acme-watch']);
    expect(sources[0]).toEqual({
      id: 'acme-watch',
      label: 'Acme watch',
      description: null,
      reportedAt: '2030-01-02T15:00:00.000Z',
      failures: 0,
      checks: [
        {
          id: 'acme:exit',
          label: 'Exit closing',
          scope: 'Acme Vault',
          severity: 'critical',
          active: true,
          value: '4.2%',
          threshold: 'under 5%',
          since: '2030-01-02T14:00:00.000Z',
        },
      ],
      advice: { critical: 'Withdraw from Acme Vault.', warning: null },
    });
  });

  test('a named source includes its detail, capped when large', async () => {
    const byLabel = await call({ source: 'acme watch' });
    expect((byLabel.sources as Record<string, unknown>[])[0].detail).toEqual(alerts.detailData);

    alerts.detailData = { blob: 'x'.repeat(30_000) };
    const big = await call({ source: 'acme-watch' });
    const detail = (big.sources as Record<string, unknown>[])[0].detail as string;
    expect(detail.endsWith('…(truncated)')).toBe(true);
    expect(detail.length).toBeLessThan(20_100);
  });

  test('an unknown source says how to list them', async () => {
    expect((await call({ source: 'nope' })).error).toBe(
      'No alert source "nope". Call get_alerts without a source to list them.'
    );
  });
});
