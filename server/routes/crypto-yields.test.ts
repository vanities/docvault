// Synthetic yield overrides in an isolated directory; no exchange calls or real balances.
import { afterAll, beforeEach, expect, test, vi } from 'vite-plus/test';
import { promises as fs } from 'node:fs';
const dataDir = vi.hoisted(() => {
  const os = require('node:os') as typeof import('node:os');
  const path = require('node:path') as typeof import('node:path');
  return path.join(os.tmpdir(), `docvault-yield-test-${Date.now()}`);
});
vi.mock('../data.js', () => ({
  DATA_DIR: dataDir,
  ensureDir: (dir: string) => fs.mkdir(dir, { recursive: true }),
  jsonResponse: (data: unknown, status = 200) => Response.json(data, { status }),
}));
vi.mock('../logger.js', () => ({
  createLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    timer: () => () => 0,
  }),
}));
import { handleCryptoYieldsRoutes } from './crypto-yields.js';
beforeEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});
afterAll(() => fs.rm(dataDir, { recursive: true, force: true }));
async function call(method: string, pathname: string, raw?: string) {
  const url = new URL(`http://internal${pathname}`);
  const response = await handleCryptoYieldsRoutes(
    new Request(url, {
      method,
      ...(raw === undefined ? {} : { body: raw, headers: { 'Content-Type': 'application/json' } }),
    }),
    url,
    pathname
  );
  if (!response) throw new Error('Missing response');
  return response;
}
test('parallel edits retain every synthetic override', async () => {
  const results = await Promise.allSettled(
    Array.from({ length: 12 }, (_, i) =>
      call('PUT', `/api/crypto/yields/demo/ASSET${i}`, JSON.stringify({ yieldApy: i }))
    )
  );
  expect(
    results.every((result) => result.status === 'fulfilled' && result.value.status === 200)
  ).toBe(true);
  const { entries } = await (await call('GET', '/api/crypto/yields')).json();
  expect(Object.keys(entries)).toHaveLength(12);
});
test('invalid or incomplete edits never clear an existing override', async () => {
  const endpoint = '/api/crypto/yields/demo/TEST';
  await call('PUT', endpoint, JSON.stringify({ yieldApy: 4 }));
  for (const raw of ['{invalid', '{}', 'null', '[]', '{"yieldApy":true}']) {
    expect((await call('PUT', endpoint, raw)).status).toBe(400);
    const { entries } = await (await call('GET', '/api/crypto/yields')).json();
    expect(entries['demo::TEST'].yieldApy).toBe(4);
  }
  expect((await call('PUT', endpoint, '{"yieldApy":null}')).status).toBe(200);
  const { entries } = await (await call('GET', '/api/crypto/yields')).json();
  expect(entries).toEqual({});
});
