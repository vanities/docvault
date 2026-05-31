// Pure-math test for Kraken balance/earn reconciliation. No personal data —
// all figures are obviously-synthetic and only exercise the merge logic.
import { describe, expect, test } from 'vite-plus/test';
import { reconcileKrakenBalances } from './crypto.js';

describe('reconcileKrakenBalances', () => {
  test('surfaces earn that the /Balance response omits (vault asset)', () => {
    // Kraken removes "vault" funds from /Balance (leaving only dust) and reports
    // them solely via /Earn/Allocations. The reconciled total must include them.
    const balance = new Map<string, number>([['BTC', 0]]);
    const earn = new Map<string, number>([['BTC', 5]]);
    expect(reconcileKrakenBalances(balance, earn)).toEqual([{ asset: 'BTC', amount: 5 }]);
  });

  test('does not double-count earn already reflected in /Balance', () => {
    // Staked assets show up in BOTH /Balance (e.g. as a suffixed key) and
    // /Earn/Allocations — the same coins. Summing would double; max() keeps one.
    const balance = new Map<string, number>([['ETH', 10]]);
    const earn = new Map<string, number>([['ETH', 10]]);
    expect(reconcileKrakenBalances(balance, earn)).toEqual([{ asset: 'ETH', amount: 10 }]);
  });

  test('keeps spot-only assets that have no earn allocation', () => {
    const balance = new Map<string, number>([['SOL', 100]]);
    const earn = new Map<string, number>();
    expect(reconcileKrakenBalances(balance, earn)).toEqual([{ asset: 'SOL', amount: 100 }]);
  });

  test('uses the larger side when earn exceeds the /Balance figure', () => {
    const balance = new Map<string, number>([['USDC', 0]]);
    const earn = new Map<string, number>([['USDC', 250]]);
    expect(reconcileKrakenBalances(balance, earn)).toEqual([{ asset: 'USDC', amount: 250 }]);
  });

  test('filters dust below the threshold', () => {
    const balance = new Map<string, number>([['BTC', 0.0000000001]]);
    const earn = new Map<string, number>();
    expect(reconcileKrakenBalances(balance, earn)).toEqual([]);
  });

  test('handles assets present in only one of the two maps', () => {
    const balance = new Map<string, number>([['AVAX', 3]]);
    const earn = new Map<string, number>([['BTC', 5]]);
    const out = reconcileKrakenBalances(balance, earn).sort((a, b) =>
      a.asset.localeCompare(b.asset)
    );
    expect(out).toEqual([
      { asset: 'AVAX', amount: 3 },
      { asset: 'BTC', amount: 5 },
    ]);
  });
});
