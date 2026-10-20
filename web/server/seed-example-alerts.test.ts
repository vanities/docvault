// Fabricated dashboards copied between temporary directories; nothing touches real data.
import { afterAll, beforeEach, describe, expect, test, vi } from 'vite-plus/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const base = vi.hoisted(() => {
  const os = require('node:os') as typeof import('node:os');
  const p = require('node:path') as typeof import('node:path');
  return p.join(os.tmpdir(), `docvault-seed-alerts-test-${Date.now()}`);
});
vi.mock('./data.js', () => ({
  DATA_DIR: `${base}/fallback-data`,
  ensureDir: (dir: string) => fs.mkdir(dir, { recursive: true }),
  getEmailConfig: async () => ({ toEmail: '', cc: {} }),
  jsonResponse: (data: unknown, status = 200) => Response.json(data, { status }),
}));
vi.mock('./email.js', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('./logger.js', () => ({
  createLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    timer: () => () => 0,
  }),
}));

import { EXAMPLE_ALERTS_DIR, seedExampleAlertDashboards } from './seed-example-alerts.js';

const dataDir = path.join(base, 'data');
const examplesDir = path.join(base, 'examples');
const dashboard = (id: string) => path.join(dataDir, 'alerts', id, 'dashboard.html');

async function writeExample(id: string, html: string) {
  await fs.mkdir(path.join(examplesDir, id), { recursive: true });
  await fs.writeFile(path.join(examplesDir, id, 'dashboard.html'), html);
}

beforeEach(async () => {
  await fs.rm(base, { recursive: true, force: true });
  await writeExample('demo-one', '<p>demo one v1</p>');
  await writeExample('demo-two', '<p>demo two v1</p>');
  // A folder without a dashboard, like the shared kit, is not an add-on.
  await fs.mkdir(path.join(examplesDir, 'kit'), { recursive: true });
  await fs.writeFile(path.join(examplesDir, 'kit', 'kit.html'), '<p>kit</p>');
});
afterAll(() => fs.rm(base, { recursive: true, force: true }));

describe('seedExampleAlertDashboards', () => {
  test('copies each bundled dashboard that is missing, and skips folders without one', async () => {
    expect((await seedExampleAlertDashboards(dataDir, examplesDir)).sort()).toEqual([
      'demo-one',
      'demo-two',
    ]);
    expect(await fs.readFile(dashboard('demo-one'), 'utf8')).toBe('<p>demo one v1</p>');
    await expect(fs.access(path.join(dataDir, 'alerts', 'kit'))).rejects.toThrow();
  });

  test("never overwrites the owner's dashboard, even on a later boot with a newer bundle", async () => {
    await fs.mkdir(path.dirname(dashboard('demo-one')), { recursive: true });
    await fs.writeFile(dashboard('demo-one'), '<p>my own page</p>');
    expect(await seedExampleAlertDashboards(dataDir, examplesDir)).toEqual(['demo-two']);
    await writeExample('demo-one', '<p>demo one v2</p>');
    expect(await seedExampleAlertDashboards(dataDir, examplesDir)).toEqual([]);
    expect(await fs.readFile(dashboard('demo-one'), 'utf8')).toBe('<p>my own page</p>');
  });

  test('a dashboard the owner deleted is not brought back', async () => {
    await seedExampleAlertDashboards(dataDir, examplesDir);
    await fs.rm(dashboard('demo-two'));
    expect(await seedExampleAlertDashboards(dataDir, examplesDir)).toEqual([]);
    await expect(fs.access(dashboard('demo-two'))).rejects.toThrow();
  });

  test('skips cleanly when no examples are shipped', async () => {
    expect(await seedExampleAlertDashboards(dataDir, path.join(base, 'missing'))).toEqual([]);
    await expect(fs.access(path.join(dataDir, 'alerts'))).rejects.toThrow();
  });

  test('the bundled add-ons ship a dashboard for every alert example', async () => {
    const copied = await seedExampleAlertDashboards(dataDir, EXAMPLE_ALERTS_DIR);
    expect(copied).toEqual(expect.arrayContaining(['docvault-health', 'overdue-invoices']));
    const html = await fs.readFile(dashboard('docvault-health'), 'utf8');
    expect(html).toContain('function render(source)');
    expect(html).not.toContain('/*__RENDER__*/');
  });
});
