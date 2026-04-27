// Brokers route handlers.
// Extracted from server/index.ts.

import { promises as fs } from 'fs';
import path from 'path';
import {
  loadSettings,
  saveSettings,
  jsonResponse,
  BROKER_CACHE_FILE,
  BROKER_ACTIVITIES_FILE,
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
  syncAllSnapTradeActivities,
  type BrokerAccount,
  type SnapTradeConfig,
  type ActivitiesCache,
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

  // ---------------------------------------------------------------------------
  // Activity History (BUYs/SELLs/dividends/transfers — via SnapTrade)
  // ---------------------------------------------------------------------------

  const loadActivitiesCache = async (): Promise<ActivitiesCache> => {
    try {
      const content = await fs.readFile(BROKER_ACTIVITIES_FILE, 'utf-8');
      return JSON.parse(content) as ActivitiesCache;
    } catch {
      return { accounts: {}, updatedAt: '' };
    }
  };

  // POST /api/brokers/activities/sync — fetch activities for all SnapTrade
  // accounts (incremental: re-fetches the trailing 7 days each run).
  if (pathname === '/api/brokers/activities/sync' && req.method === 'POST') {
    const settings = await loadSettings();
    if (!settings.snaptrade?.userId || !settings.snaptrade?.userSecret) {
      return jsonResponse({ error: 'SnapTrade not registered' }, 400);
    }

    const existing = await loadActivitiesCache();
    const stream = url.searchParams.get('stream') === '1';

    const persist = async (next: ActivitiesCache) => {
      await fs.writeFile(BROKER_ACTIVITIES_FILE, JSON.stringify(next, null, 2));
    };

    const counts = (cache: ActivitiesCache) => {
      const result: Record<string, number> = {};
      for (const [accountId, info] of Object.entries(cache.accounts)) {
        result[accountId] = info.activities.length;
      }
      return result;
    };

    if (stream) {
      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        async start(controller) {
          try {
            const next = await syncAllSnapTradeActivities(
              settings.snaptrade as SnapTradeConfig,
              existing,
              (current, total, label) => {
                controller.enqueue(
                  encoder.encode(JSON.stringify({ type: 'progress', current, total, label }) + '\n')
                );
              }
            );
            await persist(next);
            controller.enqueue(
              encoder.encode(
                JSON.stringify({
                  type: 'result',
                  ok: true,
                  updatedAt: next.updatedAt,
                  counts: counts(next),
                }) + '\n'
              )
            );
            controller.close();
          } catch (err) {
            const detail = extractSnapTradeError(err);
            controller.enqueue(
              encoder.encode(JSON.stringify({ type: 'error', error: detail }) + '\n')
            );
            controller.close();
          }
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

    try {
      const next = await syncAllSnapTradeActivities(
        settings.snaptrade as SnapTradeConfig,
        existing
      );
      await persist(next);
      return jsonResponse({ ok: true, updatedAt: next.updatedAt, counts: counts(next) });
    } catch (err) {
      return jsonResponse({ error: extractSnapTradeError(err) }, 500);
    }
  }

  // GET /api/brokers/activities — filterable read from the cache. Filters:
  //   accountId — match BrokerAccount.snaptradeAccountId (exact)
  //   type      — exact match on activity.type
  //   startDate / endDate — inclusive ISO date bounds against tradeDate
  //   q         — case-insensitive substring on description or ticker
  //   limit     — defaults to 500, capped at 5000
  if (pathname === '/api/brokers/activities' && req.method === 'GET') {
    const cache = await loadActivitiesCache();
    const accountId = url.searchParams.get('accountId');
    const type = url.searchParams.get('type');
    const startDate = url.searchParams.get('startDate');
    const endDate = url.searchParams.get('endDate');
    const q = url.searchParams.get('q')?.toLowerCase() ?? '';
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 500) || 500, 5000);

    const sources = accountId
      ? cache.accounts[accountId]
        ? [{ accountId, info: cache.accounts[accountId] }]
        : []
      : Object.entries(cache.accounts).map(([id, info]) => ({ accountId: id, info }));

    const filtered = [];
    for (const { info } of sources) {
      for (const a of info.activities) {
        if (type && a.type !== type) continue;
        if (startDate && a.tradeDate.slice(0, 10) < startDate) continue;
        if (endDate && a.tradeDate.slice(0, 10) > endDate) continue;
        if (q) {
          const haystack = `${a.ticker ?? ''} ${a.description}`.toLowerCase();
          if (!haystack.includes(q)) continue;
        }
        filtered.push(a);
      }
    }
    filtered.sort((a, b) => (a.tradeDate < b.tradeDate ? 1 : a.tradeDate > b.tradeDate ? -1 : 0));

    return jsonResponse({
      activities: filtered.slice(0, limit),
      total: filtered.length,
      truncated: filtered.length > limit,
      updatedAt: cache.updatedAt,
    });
  }

  // GET /api/brokers/activities/types — type histogram across the cache, so
  // the UI filter dropdown is data-driven (handles undocumented types like
  // "REI" automatically).
  if (pathname === '/api/brokers/activities/types' && req.method === 'GET') {
    const cache = await loadActivitiesCache();
    const hist: Record<string, number> = {};
    for (const info of Object.values(cache.accounts)) {
      for (const a of info.activities) {
        hist[a.type] = (hist[a.type] ?? 0) + 1;
      }
    }
    const types = Object.entries(hist)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);
    return jsonResponse({ types });
  }

  return null;
}
