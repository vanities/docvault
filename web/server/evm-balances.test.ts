// Fabricated wallet/token addresses and balances only.
import { afterEach, describe, expect, test, vi } from 'vite-plus/test';
import { fetchRpcBalances } from './evm-balances.js';

const address = '0x0000000000000000000000000000000000000001';
const token = {
  contract: '0x0000000000000000000000000000000000000002',
  symbol: 'TEST',
  decimals: 6,
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('RPC balance fallback', () => {
  test('reads native and token balances and encodes balanceOf for the wallet', async () => {
    vi.useFakeTimers();
    const calls: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const call = JSON.parse(init.body as string);
        calls.push(call);
        return Response.json({
          jsonrpc: '2.0',
          id: call.id,
          result: calls.length === 1 ? '0xde0b6b3a7640000' : '0x1e8480',
        });
      })
    );
    const pending = fetchRpcBalances('https://rpc.example.invalid', address, 10, 'ETH', [token]);
    await vi.runAllTimersAsync();
    expect(await pending).toEqual([
      { asset: 'ETH', amount: 1 },
      { asset: 'TEST', amount: 2 },
    ]);
    expect(calls[1].params).toEqual([
      { to: token.contract, data: `0x70a08231${address.slice(2).padStart(64, '0')}` },
      'latest',
    ]);
  });

  test('a malformed token response fails instead of silently excluding its balance', async () => {
    vi.useFakeTimers();
    let count = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(++count === 1 ? { result: '0x0' } : {}))
    );
    const assertion = expect(
      fetchRpcBalances('https://rpc.example.invalid', address, 10, 'ETH', [token])
    ).rejects.toThrow(/TEST balance unavailable.*missing a hexadecimal/);
    await vi.runAllTimersAsync();
    await assertion;
  });

  test('transient RPC errors retry and preserve the recovered result', async () => {
    vi.useFakeTimers();
    const spy = vi
      .fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(Response.json({ result: '0x0' }));
    vi.stubGlobal('fetch', spy);
    const pending = fetchRpcBalances('https://rpc.example.invalid', address, 10, 'ETH', []);
    await vi.runAllTimersAsync();
    expect(await pending).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
