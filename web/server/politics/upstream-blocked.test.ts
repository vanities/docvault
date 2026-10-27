// Synthetic HTTP responses and mocked sources: no network, filings, or NAS data.
import { describe, expect, test, vi } from 'vite-plus/test';

const fixture = vi.hoisted(() => {
  const fs = require('fs') as typeof import('fs');
  const os = require('os') as typeof import('os');
  const p = require('path') as typeof import('path');
  return {
    dataDir: fs.mkdtempSync(p.join(os.tmpdir(), 'docvault-politics-blocked-')),
    ingestSenatePtr: vi.fn(),
  };
});
vi.mock('../logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    timer: () => () => 0,
  }),
}));
vi.mock('../data.js', () => ({ DATA_DIR: fixture.dataDir, loadSettings: vi.fn(async () => ({})) }));
vi.mock('./congress-bills.js', () => ({ fetchRecentBills: vi.fn(), enrichBillSummaries: vi.fn() }));
vi.mock('./federal-register.js', () => ({
  fetchRecentExecutiveActions: vi.fn(async () => ({ actions: [], newestIssuedDate: null })),
}));
vi.mock('./house-ptr.js', () => ({ ingestHousePtr: vi.fn(async () => ({ added: 0 })) }));
vi.mock('./oge-278t.js', () => ({ ingestOge278t: vi.fn(async () => ({ added: 0 })) }));
vi.mock('./backtest-runner.js', () => ({ runBacktest: vi.fn(async () => undefined) }));
vi.mock('./feed-store.js', () => ({
  loadPoliticsCache: vi.fn(async () => ({
    cursors: {},
    bills: [],
    executiveActions: [],
    trades: [],
    filings: [],
    seen: {},
  })),
  savePoliticsCache: vi.fn(async () => undefined),
  mergeBills: vi.fn(),
  mergeExecutiveActions: vi.fn(),
}));
vi.mock('./senate-ptr.js', () => ({ ingestSenatePtr: fixture.ingestSenatePtr }));

import type { Settings } from '../data';
import { UpstreamBlockedError } from './http';
import { refreshPolitics } from './refresh';

const settings = {} as Settings;

describe('a provider that refuses automated access', () => {
  test('the Senate handshake reports an Akamai edge deny as blocked, an app 403 as a failure', async () => {
    const { establishSenateSession } =
      await vi.importActual<typeof import('./senate-ptr')>('./senate-ptr');
    const handshake = (denied: Response) =>
      establishSenateSession((async (_url: unknown, init?: RequestInit) =>
        init?.method === 'POST'
          ? denied
          : new Response(
              '<input name="csrfmiddlewaretoken" value="example-token">'
            )) as unknown as typeof fetch);

    await expect(
      handshake(new Response('Access Denied', { status: 403, headers: { server: 'AkamaiGHost' } }))
    ).rejects.toBeInstanceOf(UpstreamBlockedError);
    const appDenied = handshake(new Response('CSRF verification failed', { status: 403 }));
    await expect(appDenied).rejects.toThrow('agreement POST failed: 403');
    await expect(appDenied).rejects.not.toBeInstanceOf(UpstreamBlockedError);
  });

  test('a blocked source is reported apart from errors, so the run is not partial', async () => {
    fixture.ingestSenatePtr.mockRejectedValueOnce(
      new UpstreamBlockedError('Senate eFD refuses automated access')
    );
    const blocked = await refreshPolitics({ settings });
    expect(blocked.blocked).toEqual(['senate-ptr: Senate eFD refuses automated access']);
    expect(blocked.errors.some((e) => e.startsWith('senate-ptr'))).toBe(false);
    expect(blocked.results.find((r) => r.source === 'senate-ptr')).toMatchObject({
      ok: false,
      blocked: true,
    });

    fixture.ingestSenatePtr.mockRejectedValueOnce(
      new Error('Senate eFD report data fetch failed: 500')
    );
    const broken = await refreshPolitics({ settings });
    expect(broken.blocked).toEqual([]);
    expect(broken.errors).toContain('senate-ptr: Senate eFD report data fetch failed: 500');
  });
});
