// Crypto route handlers.
// Extracted from server/index.ts.

import { promises as fs } from 'fs';
import path from 'path';
import { loadSettings, saveSettings, jsonResponse, CRYPTO_CACHE_FILE, DATA_DIR } from '../data.js';
import type { CryptoExchangeConfig, CryptoWalletConfig } from '../data.js';
import { fetchAllBalances, fetchSourceBalance, fetchCryptoGains } from '../crypto.js';
import { readJsonBody } from '../http.js';

export async function handleCryptoRoutes(
  req: Request,
  url: URL,
  pathname: string
): Promise<Response | null> {
  // GET /api/crypto/settings — get configured exchanges and wallets (keys masked)
  if (pathname === '/api/crypto/settings' && req.method === 'GET') {
    const settings = await loadSettings();
    const cryptoConfig = settings.crypto || { exchanges: [], wallets: [] };
    return jsonResponse({
      exchanges: cryptoConfig.exchanges.map((e) => ({
        id: e.id,
        enabled: e.enabled,
        hasKey: !!e.apiKey,
        keyHint: e.apiKey ? e.apiKey.slice(-4) : undefined,
      })),
      wallets: cryptoConfig.wallets.map((w) => ({
        id: w.id,
        address: w.address,
        chain: w.chain,
        label: w.label,
      })),
      // Manual holdings carry no secrets, so they're returned verbatim.
      manualHoldings: cryptoConfig.manualHoldings || [],
      hasEtherscanKey: !!cryptoConfig.etherscanKey,
      etherscanKeyHint: cryptoConfig.etherscanKey ? cryptoConfig.etherscanKey.slice(-4) : undefined,
    });
  }

  // POST /api/crypto/settings — save exchange keys and wallet addresses
  if (pathname === '/api/crypto/settings' && req.method === 'POST') {
    const body = await readJsonBody<{
      addExchange?: {
        id?: CryptoExchangeConfig['id'];
        apiKey?: string;
        apiSecret?: string;
        passphrase?: string;
      };
      removeExchange?: string;
      toggleExchange?: string;
      addWallet?: { address?: string; chain?: CryptoWalletConfig['chain']; label?: string };
      removeWallet?: string;
      addManualHolding?: { asset?: string; amount?: number; label?: string; note?: string };
      updateManualHolding?: {
        id?: string;
        asset?: string;
        amount?: number;
        label?: string;
        note?: string;
      };
      removeManualHolding?: string;
      etherscanKey?: string;
    }>(req);
    const settings = await loadSettings();

    if (!settings.crypto) {
      settings.crypto = { exchanges: [], wallets: [] };
    }

    // Handle exchange operations
    if (body.addExchange) {
      const { id, apiKey, apiSecret, passphrase } = body.addExchange;
      if (!id || !apiKey || !apiSecret) {
        return jsonResponse({ error: 'Missing exchange id, apiKey, or apiSecret' }, 400);
      }
      // Remove existing if updating
      settings.crypto.exchanges = settings.crypto.exchanges.filter((e) => e.id !== id);
      settings.crypto.exchanges.push({ id, apiKey, apiSecret, passphrase, enabled: true });
    }

    if (body.removeExchange) {
      settings.crypto.exchanges = settings.crypto.exchanges.filter(
        (e) => e.id !== body.removeExchange
      );
    }

    if (body.toggleExchange) {
      const exchange = settings.crypto.exchanges.find((e) => e.id === body.toggleExchange);
      if (exchange) exchange.enabled = !exchange.enabled;
    }

    // Handle wallet operations
    if (body.addWallet) {
      const { address, chain, label } = body.addWallet;
      if (!address || !chain) {
        return jsonResponse({ error: 'Missing wallet address or chain' }, 400);
      }
      const id = `${chain}-${Date.now()}`;
      settings.crypto.wallets.push({
        id,
        address,
        chain,
        label: label || `${chain.toUpperCase()} Wallet`,
      });
    }

    if (body.removeWallet) {
      settings.crypto.wallets = settings.crypto.wallets.filter((w) => w.id !== body.removeWallet);
    }

    // Handle manual holdings (assets with no fetchable source, e.g. Monero)
    if (body.addManualHolding) {
      const { asset, amount, label, note } = body.addManualHolding;
      if (!asset || typeof amount !== 'number' || !Number.isFinite(amount)) {
        return jsonResponse({ error: 'Missing or invalid holding asset/amount' }, 400);
      }
      if (!settings.crypto.manualHoldings) settings.crypto.manualHoldings = [];
      const id = `${String(asset).toLowerCase()}-${Date.now()}-${settings.crypto.manualHoldings.length}`;
      settings.crypto.manualHoldings.push({
        id,
        asset: String(asset).toUpperCase(),
        amount,
        label: label || undefined,
        note: note || undefined,
      });
    }

    if (body.updateManualHolding) {
      const { id, asset, amount, label, note } = body.updateManualHolding;
      const holding = (settings.crypto.manualHoldings || []).find((h) => h.id === id);
      if (holding) {
        if (asset !== undefined) holding.asset = String(asset).toUpperCase();
        if (amount !== undefined && Number.isFinite(amount)) holding.amount = amount;
        if (label !== undefined) holding.label = label || undefined;
        if (note !== undefined) holding.note = note || undefined;
      }
    }

    if (body.removeManualHolding) {
      settings.crypto.manualHoldings = (settings.crypto.manualHoldings || []).filter(
        (h) => h.id !== body.removeManualHolding
      );
    }

    // Handle Etherscan key
    if (body.etherscanKey !== undefined) {
      settings.crypto.etherscanKey = body.etherscanKey || undefined;
    }

    await saveSettings(settings);
    return jsonResponse({ ok: true });
  }

  // GET /api/crypto/balances — fetch live balances from all configured sources
  if (pathname === '/api/crypto/balances' && req.method === 'GET') {
    const settings = await loadSettings();
    const cryptoConfig = settings.crypto || { exchanges: [], wallets: [] };

    if (
      cryptoConfig.exchanges.length === 0 &&
      cryptoConfig.wallets.length === 0 &&
      (cryptoConfig.manualHoldings?.length ?? 0) === 0
    ) {
      return jsonResponse({
        sources: [],
        totalUsdValue: 0,
        byAsset: [],
        lastUpdated: new Date().toISOString(),
        message: 'No exchanges, wallets, or manual holdings configured. Add them in Settings.',
      });
    }

    // Return cached data without refetching (for page loads)
    const cached = url.searchParams.get('cached') === '1';
    if (cached) {
      try {
        const content = await fs.readFile(CRYPTO_CACHE_FILE, 'utf-8');
        return jsonResponse(JSON.parse(content));
      } catch {
        return jsonResponse({ sources: [], totalUsdValue: 0, byAsset: [], lastUpdated: '' }, 200);
      }
    }

    // Helper to save results to cache file
    const saveCryptoCache = async (portfolio: object) => {
      try {
        await fs.writeFile(CRYPTO_CACHE_FILE, JSON.stringify(portfolio, null, 2));
      } catch {
        // Non-critical — cache write failure doesn't block response
      }
    };

    // Check if client wants streaming progress
    const stream = url.searchParams.get('stream') === '1';

    if (stream) {
      // Stream NDJSON: emit each source as it completes, then final result
      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        async start(controller) {
          const send = (data: unknown) =>
            controller.enqueue(encoder.encode(JSON.stringify(data) + '\n'));
          const portfolio = await fetchAllBalances(
            cryptoConfig.exchanges,
            cryptoConfig.wallets,
            cryptoConfig.etherscanKey,
            cryptoConfig.manualHoldings,
            (current, total, label) => {
              send({ type: 'progress', current, total, label });
            },
            (source) => {
              send({ type: 'source', source });
            }
          );
          await saveCryptoCache(portfolio);
          send({ type: 'result', ...portfolio });
          controller.close();
        },
      });

      return new Response(readable, {
        headers: {
          'Content-Type': 'application/x-ndjson',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Cache-Control': 'no-cache',
        },
      });
    }

    // Non-streaming (backwards compatible)
    const portfolio = await fetchAllBalances(
      cryptoConfig.exchanges,
      cryptoConfig.wallets,
      cryptoConfig.etherscanKey,
      cryptoConfig.manualHoldings
    );
    await saveCryptoCache(portfolio);
    return jsonResponse(portfolio);
  }

  // GET /api/crypto/balances/:sourceId — refresh a single source
  if (pathname.startsWith('/api/crypto/balances/') && req.method === 'GET') {
    const sourceId = decodeURIComponent(pathname.split('/api/crypto/balances/')[1]);
    const settings = await loadSettings();
    const cryptoConfig = settings.crypto || { exchanges: [], wallets: [] };

    try {
      const source = await fetchSourceBalance(
        sourceId,
        cryptoConfig.exchanges,
        cryptoConfig.wallets,
        cryptoConfig.etherscanKey
      );
      // Update the source in the cache file
      try {
        const cacheRaw = await fs.readFile(CRYPTO_CACHE_FILE, 'utf-8');
        const cache = JSON.parse(cacheRaw);
        cache.sources = (cache.sources || []).map((s: { sourceId: string }) =>
          s.sourceId === sourceId ? source : s
        );
        cache.totalUsdValue = cache.sources.reduce(
          (sum: number, s: { totalUsdValue: number }) => sum + s.totalUsdValue,
          0
        );
        cache.lastUpdated = new Date().toISOString();
        await fs.writeFile(CRYPTO_CACHE_FILE, JSON.stringify(cache, null, 2));
      } catch {
        // Cache update is non-critical
      }
      return jsonResponse(source);
    } catch (err) {
      return jsonResponse({ error: err instanceof Error ? err.message : 'Unknown error' }, 404);
    }
  }

  // =========================================================================
  // Broker Portfolio Endpoints
  // =========================================================================

  // GET /api/crypto/gains — compute cost basis and gains from trade history
  if (pathname === '/api/crypto/gains' && req.method === 'GET') {
    const settings = await loadSettings();
    const exchanges = settings.crypto?.exchanges || [];
    const enabledExchanges = exchanges.filter((e) => e.enabled);

    if (enabledExchanges.length === 0) {
      return jsonResponse({ error: 'No exchanges configured' }, 400);
    }

    const cached = url.searchParams.get('cached');
    const GAINS_CACHE_FILE = path.join(DATA_DIR, '.docvault-crypto-gains.json');

    // Return cached if available and requested
    if (cached === '1') {
      try {
        const data = await fs.readFile(GAINS_CACHE_FILE, 'utf-8');
        return jsonResponse(JSON.parse(data));
      } catch {
        // No cache, fall through to compute
      }
    }

    // Stream progress or compute directly
    const stream = url.searchParams.get('stream') === '1';
    if (stream) {
      return new Response(
        new ReadableStream({
          async start(controller) {
            const encoder = new TextEncoder();
            const send = (data: unknown) => {
              controller.enqueue(encoder.encode(JSON.stringify(data) + '\n'));
            };

            try {
              const gains = await fetchCryptoGains(exchanges, (current, total, label) => {
                send({ type: 'progress', current, total, label });
              });
              await fs.writeFile(GAINS_CACHE_FILE, JSON.stringify(gains, null, 2));
              send({ type: 'result', data: gains });
            } catch (err) {
              send({ type: 'error', message: err instanceof Error ? err.message : 'Failed' });
            }
            controller.close();
          },
        }),
        { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' } }
      );
    }

    // Non-streaming
    try {
      const gains = await fetchCryptoGains(exchanges);
      await fs.writeFile(GAINS_CACHE_FILE, JSON.stringify(gains, null, 2));
      return jsonResponse(gains);
    } catch (err) {
      return jsonResponse(
        { error: err instanceof Error ? err.message : 'Failed to fetch gains' },
        500
      );
    }
  }
  return null;
}
