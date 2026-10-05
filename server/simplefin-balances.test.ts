// Regression tests for the $0 bank craters in the portfolio history.
//
// SimpleFIN signals a broken bank connection IN THE RESPONSE BODY with HTTP
// 200: `errors` is populated and `accounts` comes back empty. The old code
// logged a warning and returned [], so the caller summed to $0, recorded that
// as the day's bank balance, AND overwrote the fallback cache with the empty
// list — destroying the only thing that could have covered the outage.
//
// All figures and institution names below are fabricated.
import { afterEach, describe, expect, test, vi } from 'vite-plus/test';
import { fetchBalances, fetchBalanceSnapshot } from './simplefin.js';

const CONFIG = { accessUrl: 'https://user:pass@example.invalid/simplefin' };

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function stub(body: unknown, status = 200) {
  globalThis.fetch = vi.fn(
    async () => new Response(JSON.stringify(body), { status })
  ) as unknown as typeof fetch;
}

describe('fetchBalances', () => {
  test('a 200 with errors and no accounts throws instead of reporting $0', async () => {
    stub({ errors: ['Connection to Acme Bank needs attention'], accounts: [] });
    await expect(fetchBalances(CONFIG)).rejects.toThrow(/no accounts/i);
  });

  test('the thrown message carries the connection error, so logs say why', async () => {
    stub({ errors: ['Connection to Acme Bank needs attention'], accounts: [] });
    await expect(fetchBalances(CONFIG)).rejects.toThrow(/Acme Bank needs attention/);
  });

  test('an empty account list with NO errors still throws', async () => {
    // A configured connection returning zero accounts is never a real $0 state.
    stub({ accounts: [] });
    await expect(fetchBalances(CONFIG)).rejects.toThrow(/no accounts/i);
  });

  test('a missing accounts key is treated as empty, not a crash', async () => {
    stub({});
    await expect(fetchBalances(CONFIG)).rejects.toThrow(/no accounts/i);
  });

  test('partial data still returns — some accounts beats none', async () => {
    stub({
      errors: ['Connection to Globex Credit Union needs attention'],
      accounts: [{ id: 'a1', name: 'Everyday Checking', currency: 'USD', balance: '1200.00' }],
    });
    const out = await fetchBalances(CONFIG);
    expect(out).toHaveLength(1);
    expect(out[0].balance).toBe(1200);
  });

  test('a healthy response maps balances through', async () => {
    stub({
      accounts: [
        {
          id: 'a1',
          name: 'Everyday Checking',
          currency: 'USD',
          balance: '1200.00',
          'available-balance': '1150.00',
          org: { id: 'o1', name: 'Acme Bank' },
        },
        { id: 'a2', name: 'Acme Rewards Visa', currency: 'USD', balance: '-321.00' },
      ],
    });
    const out = await fetchBalances(CONFIG);
    expect(out.map((a) => a.balance)).toEqual([1200, -321]);
    expect(out[0].availableBalance).toBe(1150);
    expect(out[0].connectionName).toBe('Acme Bank');
    // A card with no available-balance must be null, not 0 — 0 is a real value.
    expect(out[1].availableBalance).toBeNull();
  });

  test('an expired access URL (403) still throws its own message', async () => {
    stub('nope', 403);
    await expect(fetchBalances(CONFIG)).rejects.toThrow(/authentication failed/i);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  test('a successful partial response retains connection errors for cached admin views', async () => {
    stub({
      errors: ['Connection to Acme Bank needs attention. Auth required'],
      accounts: [{ id: 'a1', name: 'Checking', currency: 'USD', balance: '1234.56' }],
    });
    const snapshot = await fetchBalanceSnapshot(CONFIG);
    expect(snapshot.accounts).toHaveLength(1);
    expect(snapshot.connectionErrors).toEqual([
      'Connection to Acme Bank needs attention. Auth required',
    ]);
  });

  test('structured provider errors identify the affected connection too', async () => {
    stub({
      errlist: [
        { code: 'con.auth', msg: 'Authentication required', conn_id: 'example-connection' },
      ],
      connections: [{ conn_id: 'example-connection', name: 'Acme Bank' }],
      accounts: [
        {
          id: 'a1',
          name: 'Checking',
          currency: 'USD',
          balance: '1234.56',
          conn_id: 'example-connection',
        },
      ],
    });
    const snapshot = await fetchBalanceSnapshot(CONFIG);
    expect(snapshot.connectionErrors).toEqual(['Acme Bank: Authentication required']);
    expect(snapshot.accounts[0].connectionName).toBe('Acme Bank');
  });

  test('provider error IDs that differ from connection rows still map an unambiguous bank name', async () => {
    stub({
      errlist: [
        {
          code: 'con.auth',
          msg: 'Connection to Acme Bank may need attention. Auth required',
          conn_id: 'provider-error-id',
        },
      ],
      connections: [{ conn_id: 'synthetic-bank', name: 'Acme Bank' }],
      accounts: [
        {
          id: 'a1',
          name: 'Checking',
          currency: 'USD',
          balance: '1234.56',
          conn_id: 'synthetic-bank',
          'balance-date': 1767225600,
        },
      ],
    });
    const snapshot = await fetchBalanceSnapshot(CONFIG);
    expect(snapshot.connectionIssues?.[0]).toMatchObject({
      kind: 'reauth',
      code: 'con.auth',
      connectionName: 'Acme Bank',
      connectionId: 'synthetic-bank',
      lastBankDataAt: '2026-01-01T00:00:00.000Z',
    });
    const requested = new URL(String(vi.mocked(globalThis.fetch).mock.calls[0][0]));
    expect(requested.searchParams.get('version')).toBe('2');
    expect(requested.searchParams.get('balances-only')).toBe('1');
  });

  test('quota failures do not trigger more requests', async () => {
    stub({}, 429);
    await expect(fetchBalanceSnapshot(CONFIG)).rejects.toThrow(/quota reached/);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  test('an upstream 503 retries and records a healthy snapshot after recovery', async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({
          accounts: [{ id: 'a1', name: 'Checking', currency: 'USD', balance: '1234.56' }],
        })
      );
    const pending = fetchBalanceSnapshot(CONFIG);
    await vi.runAllTimersAsync();
    expect((await pending).connectionErrors).toEqual([]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});
