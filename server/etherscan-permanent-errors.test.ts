// Etherscan reports permanent misconfiguration exactly like a transient rate
// limit: HTTP 200, `{status:"0", message:"NOTOK"}`, with the real reason in
// `result`. Treating those as retryable cost ~31s of exponential backoff per
// asset per chain — 943 retry log lines in a single boot, and a portfolio
// snapshot that took 32 minutes while silently reporting no on-chain balances.
//
// Strings below are the verbatim API responses, no credentials.
import { afterEach, describe, expect, test, vi } from 'vite-plus/test';
import {
  ETHERSCAN_KEYED_RATE_DELAY_MS,
  classifyPermanentEtherscanError,
  etherscanRateDelayMs,
  fetchChainBalances,
  resetEtherscanFailureReports,
} from './crypto.js';

describe('classifyPermanentEtherscanError', () => {
  test('a rejected API key is permanent', () => {
    expect(classifyPermanentEtherscanError('NOTOK Invalid API Key (#err2)')).toBe('invalid-key');
  });

  test('an unentitled chain is permanent', () => {
    expect(
      classifyPermanentEtherscanError(
        'NOTOK Free API access is not supported for this chain. Please upgrade your api plan for full chain coverage.'
      )
    ).toBe('chain-not-entitled');
  });

  test('matching is case-insensitive', () => {
    expect(classifyPermanentEtherscanError('invalid api key')).toBe('invalid-key');
    expect(classifyPermanentEtherscanError('UPGRADE YOUR API PLAN')).toBe('chain-not-entitled');
  });

  test('a rate limit is NOT permanent — it must keep retrying', () => {
    // The whole reason the retry loop exists. Misclassifying this would drop
    // real balances on a transient burst collision.
    expect(classifyPermanentEtherscanError('NOTOK Max rate limit reached')).toBeNull();
  });

  test('a bare NOTOK with no detail is treated as transient', () => {
    // Ambiguous — retrying is the safe default when we cannot tell.
    expect(classifyPermanentEtherscanError('NOTOK')).toBeNull();
  });

  test('empty input is transient, not permanent', () => {
    expect(classifyPermanentEtherscanError('')).toBeNull();
  });

  test('a normal "no data" message is not classified as permanent', () => {
    // Handled earlier as a terminal success; must not be mistaken for a fault.
    expect(classifyPermanentEtherscanError('No transactions found')).toBeNull();
  });
});

describe('fetchChainBalances — fail fast on permanent errors', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    resetEtherscanFailureReports();
    vi.restoreAllMocks();
  });

  function stubAll(body: unknown) {
    const spy = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    globalThis.fetch = spy as unknown as typeof fetch;
    return spy;
  }

  test('an unentitled chain costs ONE request per lookup, not six', async () => {
    const spy = stubAll({
      status: '0',
      message: 'NOTOK',
      result: 'Free API access is not supported for this chain. Please upgrade your api plan.',
    });
    // One native lookup, no tokens — the old loop burned 6 attempts on it.
    await fetchChainBalances('0xabc', 10, 'ETH', []);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('a rejected key also costs ONE request', async () => {
    const spy = stubAll({ status: '0', message: 'NOTOK', result: 'Invalid API Key (#err2)' });
    await fetchChainBalances('0xabc', 1, 'ETH', []);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('a permanent failure yields no balances rather than bogus zeros', async () => {
    stubAll({ status: '0', message: 'NOTOK', result: 'Invalid API Key (#err2)' });
    const out = await fetchChainBalances('0xabc', 1, 'ETH', []);
    // Missing data must not be reported as a real zero balance.
    expect(out).toEqual([]);
  });
}, 20_000);

describe('etherscanRateDelayMs', () => {
  // The keyed plan permits 3 calls/sec. Pacing above that ceiling rate-limits
  // the sweep against itself and then pays exponential backoff to recover —
  // 103 self-inflicted retries in a single boot at the old 210ms.
  const PLAN_CALLS_PER_SEC = 3;
  const MIN_SAFE_MS = 1000 / PLAN_CALLS_PER_SEC; // 333.33

  test('the keyed delay stays under the documented 3 calls/sec ceiling', () => {
    expect(ETHERSCAN_KEYED_RATE_DELAY_MS).toBeGreaterThan(MIN_SAFE_MS);
  });

  test('but is not needlessly slow — a sweep still has to finish', () => {
    expect(ETHERSCAN_KEYED_RATE_DELAY_MS).toBeLessThan(MIN_SAFE_MS * 2);
  });

  test('unkeyed access is paced for the 1-per-5s limit', () => {
    expect(etherscanRateDelayMs(false)).toBeGreaterThanOrEqual(5000);
  });

  test('both call sites derive from one constant, so they cannot disagree', () => {
    // They previously hardcoded 210 and 250 independently.
    expect(etherscanRateDelayMs(true)).toBe(ETHERSCAN_KEYED_RATE_DELAY_MS);
  });
});
