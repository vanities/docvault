import { afterEach, expect, test, vi } from 'vite-plus/test';
import { promises as fs } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { createSimplefinSync } from './simplefin-sync.js';
import { SimplefinFetchError, type SimplefinBalanceCache } from './simplefin.js';

const dirs: string[] = [];
const config = { accessUrl: 'https://synthetic:secret@example.invalid/simplefin' };
const snapshot = (): SimplefinBalanceCache => ({
  accounts: [
    {
      id: 'synthetic-account',
      name: 'Checking',
      connId: 'synthetic-bank',
      currency: 'USD',
      balance: 1234.56,
      availableBalance: null,
      balanceDate: null,
    },
  ],
  lastUpdated: new Date().toISOString(),
  connectionErrors: [],
});
async function directory() {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'simplefin-sync-'));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

test('concurrent scheduler and manual refresh share one provider request', async () => {
  const fetcher = vi.fn(async () => snapshot());
  const service = createSimplefinSync(await directory(), fetcher);
  await Promise.all([service.sync(config), service.sync(config, true)]);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test('restarts reuse recent balances; an explicit refresh after reconnect still checks the bank', async () => {
  const dir = await directory();
  const fetcher = vi.fn(async () => snapshot());
  await createSimplefinSync(dir, fetcher).sync(config);
  await createSimplefinSync(dir, fetcher).sync(config);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await createSimplefinSync(dir, fetcher).sync(config, true);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test('all-account authentication failure persists a warning without clobbering cached balances', async () => {
  const dir = await directory();
  const fetcher = vi.fn(async () => snapshot());
  const service = createSimplefinSync(dir, fetcher);
  await service.sync(config);
  fetcher.mockRejectedValueOnce(
    new SimplefinFetchError('Bank sign-in required', [
      {
        id: 'reauth:synthetic-bank',
        kind: 'reauth',
        message: 'Acme Bank: Authentication required',
      },
    ])
  );
  await expect(service.sync(config, true)).rejects.toThrow('Bank sign-in required');
  expect((await service.getHealth()).issues[0].kind).toBe('reauth');
  expect(
    JSON.parse(await fs.readFile(path.join(dir, '.docvault-simplefin-cache.json'), 'utf8'))
      .accounts[0].balance
  ).toBe(1234.56);
  await service.sync(config, true);
  const health = await service.getHealth();
  expect(health.issues).toEqual([]);
  expect(health.history).toHaveLength(1);
});

test('cached status reads do not spend provider requests', async () => {
  const fetcher = vi.fn(async () => snapshot());
  const service = createSimplefinSync(await directory(), fetcher);
  await service.sync(config);
  await Promise.all([service.getHealth(), service.getHealth()]);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
