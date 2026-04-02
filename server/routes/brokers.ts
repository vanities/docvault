// Brokers route handlers.
// Extracted from server/index.ts.

import { promises as fs } from 'fs';
import path from 'path';
import {
  loadSettings,
  saveSettings,
  jsonResponse,
  BROKER_CACHE_FILE,
  SIMPLEFIN_CACHE_FILE,
  DATA_DIR,
} from '../data.js';
import {
  buildPortfolio,
  registerSnapTradeUser,
  getSnapTradeConnectUrl,
  fetchAllSnapTradeHoldings,
  deleteSnapTradeUser,
  initSnapTrade,
  extractSnapTradeError,
  type BrokerAccount,
  type SnapTradeConfig,
} from '../brokers.js';
import {
  claimSetupToken,
  fetchBalances as fetchSimplefinBalances,
  type SimplefinConfig,
  type SimplefinBalanceCache,
} from '../simplefin.js';

export async function handleBrokersRoutes(
  req: Request,
  url: URL,
  pathname: string
): Promise<Response | null> {
  // GET /api/brokers/accounts — list all broker accounts (no secrets to mask)
  if (pathname === '/api/brokers/accounts' && req.method === 'GET') {
    const settings = await loadSettings();
    return jsonResponse({ accounts: settings.brokers?.accounts || [] });
  }

  // POST /api/brokers/accounts — add a new broker account
  if (pathname === '/api/brokers/accounts' && req.method === 'POST') {
    const body = await req.json();
    const { broker, name, url, overrideValue } = body;
    if (!broker || !name) {
      return jsonResponse({ error: 'Missing broker or name' }, 400);
    }
    const settings = await loadSettings();
    if (!settings.brokers) settings.brokers = { accounts: [] };
    const id = `${broker}-${Date.now()}`;
    const account: BrokerAccount = {
      id,
      broker,
      name,
      holdings: [],
      ...(url ? { url } : {}),
      ...(overrideValue !== undefined ? { overrideValue: Number(overrideValue) } : {}),
    };
    settings.brokers.accounts.push(account);
    await saveSettings(settings);
    return jsonResponse({ ok: true, account });
  }

  // PUT /api/brokers/accounts/:id — update account (name, holdings)
  if (pathname.startsWith('/api/brokers/accounts/') && req.method === 'PUT') {
    const accountId = decodeURIComponent(pathname.split('/api/brokers/accounts/')[1]);
    const body = await req.json();
    const settings = await loadSettings();
    if (!settings.brokers) return jsonResponse({ error: 'No accounts' }, 404);
    const account = settings.brokers.accounts.find((a) => a.id === accountId);
    if (!account) return jsonResponse({ error: 'Account not found' }, 404);
    if (body.name !== undefined) account.name = body.name;
    if (body.url !== undefined) account.url = body.url || undefined;
    if (body.holdings !== undefined) account.holdings = body.holdings;
    if (body.overrideValue !== undefined)
      account.overrideValue = body.overrideValue === null ? undefined : Number(body.overrideValue);
    await saveSettings(settings);
    return jsonResponse({ ok: true, account });
  }

  // DELETE /api/brokers/accounts/:id — remove an account
  if (pathname.startsWith('/api/brokers/accounts/') && req.method === 'DELETE') {
    const accountId = decodeURIComponent(pathname.split('/api/brokers/accounts/')[1]);
    const settings = await loadSettings();
    if (!settings.brokers) return jsonResponse({ error: 'No accounts' }, 404);
    settings.brokers.accounts = settings.brokers.accounts.filter((a) => a.id !== accountId);
    await saveSettings(settings);
    return jsonResponse({ ok: true });
  }

  // GET /api/brokers/portfolio — get all accounts with live prices
  if (pathname === '/api/brokers/portfolio' && req.method === 'GET') {
    const settings = await loadSettings();
    const accounts = settings.brokers?.accounts || [];
    if (accounts.length === 0) {
      return jsonResponse({
        accounts: [],
        totalValue: 0,
        totalCostBasis: 0,
        totalGainLoss: 0,
        lastUpdated: new Date().toISOString(),
      });
    }

    // Return cached data without refetching (for page loads)
    const cached = url.searchParams.get('cached') === '1';
    if (cached) {
      try {
        const content = await fs.readFile(BROKER_CACHE_FILE, 'utf-8');
        return jsonResponse(JSON.parse(content));
      } catch {
        return jsonResponse(
          { accounts: [], totalValue: 0, totalCostBasis: 0, totalGainLoss: 0, lastUpdated: '' },
          200
        );
      }
    }

    const saveBrokerCache = async (portfolio: object) => {
      try {
        await fs.writeFile(BROKER_CACHE_FILE, JSON.stringify(portfolio, null, 2));
      } catch {
        // Non-critical
      }
    };

    // Check if client wants streaming progress
    const stream = url.searchParams.get('stream') === '1';

    if (stream) {
      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        async start(controller) {
          const portfolio = await buildPortfolio(accounts, (current, total, label) => {
            controller.enqueue(
              encoder.encode(JSON.stringify({ type: 'progress', current, total, label }) + '\n')
            );
          });
          await saveBrokerCache(portfolio);
          controller.enqueue(
            encoder.encode(JSON.stringify({ type: 'result', ...portfolio }) + '\n')
          );
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

    // Non-streaming
    const portfolio = await buildPortfolio(accounts);
    await saveBrokerCache(portfolio);
    return jsonResponse(portfolio);
  }
  return null;
}
