import { createLogger } from './logger.js';

export interface EvmToken {
  contract: string;
  symbol: string;
  decimals: number;
}

/** Read-only fallback for a chain excluded from the explorer's API plan. Any
 * missing response fails the sweep; it must never become a saved zero balance. */
export async function fetchRpcBalances(
  endpoint: string,
  address: string,
  chainId: number,
  nativeSymbol: string,
  tokens: EvmToken[]
): Promise<Array<{ asset: string; amount: number }>> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('Invalid EVM wallet address');
  const log = createLogger(`Chain ${chainId}`);
  let id = 0;
  async function call(method: string, params: unknown[], label: string): Promise<bigint> {
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = (await response.json()) as {
          result?: unknown;
          error?: { code?: number; message?: string };
        };
        if (payload.error) throw new Error(`RPC ${payload.error.code}: ${payload.error.message}`);
        if (typeof payload.result !== 'string' || !/^0x[0-9a-f]+$/i.test(payload.result)) {
          throw new Error('RPC balance response missing a hexadecimal result');
        }
        log.info(`[rpc] asset=${label} method=${method} attempt=${attempt} completed`);
        return BigInt(payload.result);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (attempt === 3 || /HTTP 4(?!29)\d\d|missing a hexadecimal|RPC -3260/.test(reason)) {
          throw new Error(`Chain ${chainId} ${label} balance unavailable: ${reason}`);
        }
        log.warn(
          `[rpc] asset=${label} attempt=${attempt}/3 failed: ${reason}; retryInMs=${1000 * attempt}`
        );
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  const balances: Array<{ asset: string; amount: number }> = [];
  const native = Number(await call('eth_getBalance', [address, 'latest'], nativeSymbol)) / 1e18;
  if (native > 0) balances.push({ asset: nativeSymbol, amount: native });
  for (const token of tokens) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    // ERC-20 balanceOf(address), with the address padded to a 32-byte ABI word.
    const data = `0x70a08231${address.slice(2).padStart(64, '0')}`;
    const result = await call('eth_call', [{ to: token.contract, data }, 'latest'], token.symbol);
    const amount = Number(result) / 10 ** token.decimals;
    if (amount > 0.001) balances.push({ asset: token.symbol, amount });
  }
  log.info(`[rpc] balance scan completed via ${new URL(endpoint).host}; assets=${balances.length}`);
  return balances;
}
