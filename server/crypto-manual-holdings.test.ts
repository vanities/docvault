// Pure test for manual-holdings → synthetic-source conversion. No personal data —
// all symbols, amounts, and prices are obviously-synthetic and only exercise the
// pricing + source-shaping logic (the same code path Monero holdings flow through).
import { describe, expect, test } from 'vite-plus/test';
import { manualHoldingsToSources } from './crypto.js';

const NOW = '2020-01-01T00:00:00.000Z';
const PRICES = { XMR: 200, BTC: 50000 };

describe('manualHoldingsToSources', () => {
  test('prices a holding and shapes it as a manual source', () => {
    const out = manualHoldingsToSources(
      [{ id: 'h1', asset: 'XMR', amount: 2, label: 'Cold wallet' }],
      PRICES,
      NOW
    );
    expect(out).toEqual([
      {
        sourceId: 'h1',
        sourceType: 'manual',
        label: 'Cold wallet',
        balances: [{ asset: 'XMR', amount: 2, usdValue: 400 }],
        totalUsdValue: 400,
        lastUpdated: NOW,
      },
    ]);
  });

  test('falls back to "<ASSET> (manual)" when no label is given', () => {
    const [src] = manualHoldingsToSources([{ id: 'h2', asset: 'XMR', amount: 1 }], PRICES, NOW);
    expect(src.label).toBe('XMR (manual)');
  });

  test('prices to 0 when the asset is absent from the price map', () => {
    const [src] = manualHoldingsToSources([{ id: 'h3', asset: 'ZZZ', amount: 9 }], PRICES, NOW);
    expect(src.totalUsdValue).toBe(0);
    expect(src.balances[0].usdValue).toBe(0);
  });

  test('resolves price case-insensitively (lowercase symbol → uppercase key)', () => {
    const [src] = manualHoldingsToSources([{ id: 'h4', asset: 'xmr', amount: 3 }], PRICES, NOW);
    expect(src.totalUsdValue).toBe(600);
  });

  test('emits one source per holding so same-asset wallets stay distinct', () => {
    const out = manualHoldingsToSources(
      [
        { id: 'a', asset: 'XMR', amount: 1.5, label: 'Wallet A' },
        { id: 'b', asset: 'XMR', amount: 0.5, label: 'Wallet B' },
      ],
      PRICES,
      NOW
    );
    expect(out.map((s) => s.sourceId)).toEqual(['a', 'b']);
    // The two stay separate here; the per-asset rollup in fetchAllBalances is what
    // sums them (1.5 + 0.5 = 2.0 XMR) downstream.
    expect(out.reduce((sum, s) => sum + s.totalUsdValue, 0)).toBe(400);
  });

  test('returns an empty array for no holdings', () => {
    expect(manualHoldingsToSources([], PRICES, NOW)).toEqual([]);
  });
});
