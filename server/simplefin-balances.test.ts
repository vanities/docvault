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
import { fetchBalances } from './simplefin.js';

const CONFIG = { accessUrl: 'https://user:pass@example.invalid/simplefin' };

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
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
  });
});
