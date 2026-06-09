import { promises as fs } from 'fs';
import {
  deleteSnapTradeUser,
  extractSnapTradeError,
  fetchAllSnapTradeHoldings,
  getSnapTradeConnectUrl,
  registerSnapTradeUser,
} from '../brokers.js';
import { claimSetupToken, fetchBalances as fetchSimplefinBalances } from '../simplefin.js';
import { createLogger } from '../logger.js';
import {
  SIMPLEFIN_CACHE_FILE,
  jsonResponse,
  loadSettings,
  saveSettings,
  loadSnapshots,
  loadSnapshotsForYear,
} from '../data.js';
import type { SimplefinBalanceCache } from '../simplefin.js';
import { takePortfolioSnapshot } from '../scheduler.js';

const logSnaptrade = createLogger('SnapTrade');
const logSimplefin = createLogger('SimpleFIN');

export async function handlePortfolioSnapshotRoutes(
  req: Request,
  url: URL,
  pathname: string
): Promise<Response | null> {
  // GET /api/portfolio/snapshots — get historical snapshots (?year=2025 or ?year=2025,2026)
  if (pathname === '/api/portfolio/snapshots' && req.method === 'GET') {
    const yearParam = url.searchParams.get('year');
    const years = yearParam
      ? yearParam
          .split(',')
          .map((y) => parseInt(y))
          .filter((y) => !isNaN(y))
      : undefined; // undefined = current + previous year (default)
    const snapshots = await loadSnapshots(years);
    return jsonResponse(snapshots);
  }

  // POST /api/portfolio/snapshot — take a snapshot now (also runs on schedule)
  if (pathname === '/api/portfolio/snapshot' && req.method === 'POST') {
    try {
      await takePortfolioSnapshot();
      const currentYear = new Date().getFullYear();
      const snapshots = await loadSnapshotsForYear(currentYear);
      const snapshot = snapshots[snapshots.length - 1];
      return jsonResponse({ ok: true, snapshot });
    } catch (err) {
      return jsonResponse({ error: err instanceof Error ? err.message : 'Snapshot failed' }, 500);
    }
  }

  return null;
}

export async function handleBrokerIntegrationRoutes(
  req: Request,
  url: URL,
  pathname: string
): Promise<Response | null> {
  // GET /api/snaptrade/status — check if SnapTrade is configured
  if (pathname === '/api/snaptrade/status' && req.method === 'GET') {
    const settings = await loadSettings();
    const st = settings.snaptrade;
    return jsonResponse({
      configured: !!(st?.clientId && st?.consumerKey),
      registered: !!(st?.userId && st?.userSecret),
      clientId: st?.clientId ? st.clientId.slice(0, 8) + '...' : undefined,
    });
  }

  // POST /api/snaptrade/setup — save SnapTrade credentials and register user
  if (pathname === '/api/snaptrade/setup' && req.method === 'POST') {
    const body = await req.json();
    const { clientId, consumerKey } = body;
    if (!clientId || !consumerKey) {
      return jsonResponse({ error: 'Missing clientId or consumerKey' }, 400);
    }

    const settings = await loadSettings();
    settings.snaptrade = { clientId, consumerKey };

    try {
      const { userId, userSecret } = await registerSnapTradeUser(settings.snaptrade);
      settings.snaptrade.userId = userId;
      settings.snaptrade.userSecret = userSecret;
      await saveSettings(settings);
      return jsonResponse({ ok: true, userId });
    } catch (err) {
      await saveSettings(settings);
      const detail = extractSnapTradeError(err);
      logSnaptrade.error(`Setup failed: ${detail}`);
      return jsonResponse({ error: detail }, 500);
    }
  }

  // GET /api/snaptrade/connect — get connection portal URL
  if (pathname === '/api/snaptrade/connect' && req.method === 'GET') {
    const settings = await loadSettings();
    if (!settings.snaptrade?.clientId) {
      return jsonResponse({ error: 'SnapTrade not configured' }, 400);
    }

    try {
      const redirectUrl = await getSnapTradeConnectUrl(settings.snaptrade);
      return jsonResponse({ redirectUrl });
    } catch (err) {
      const detail = extractSnapTradeError(err);
      logSnaptrade.error(`Connect failed: ${detail}`);
      return jsonResponse({ error: detail }, 500);
    }
  }

  // POST /api/snaptrade/sync — fetch holdings from all SnapTrade-connected accounts
  if (pathname === '/api/snaptrade/sync' && req.method === 'POST') {
    const settings = await loadSettings();
    if (!settings.snaptrade?.userId) {
      return jsonResponse({ error: 'SnapTrade not registered' }, 400);
    }

    try {
      const snapAccounts = await fetchAllSnapTradeHoldings(settings.snaptrade);

      // Merge with existing manual accounts (replace snap- accounts, keep manual)
      if (!settings.brokers) settings.brokers = { accounts: [] };
      const manualAccounts = settings.brokers.accounts.filter((a) => !a.id.startsWith('snap-'));
      settings.brokers.accounts = [...manualAccounts, ...snapAccounts];
      await saveSettings(settings);

      return jsonResponse({ ok: true, synced: snapAccounts.length });
    } catch (err) {
      const detail = extractSnapTradeError(err);
      logSnaptrade.error(`Sync failed: ${detail}`);
      return jsonResponse({ error: detail }, 500);
    }
  }

  // DELETE /api/snaptrade — remove SnapTrade config and user
  if (pathname === '/api/snaptrade' && req.method === 'DELETE') {
    const settings = await loadSettings();
    if (settings.snaptrade?.clientId) {
      try {
        await deleteSnapTradeUser(settings.snaptrade);
      } catch {
        // Best effort cleanup
      }
    }
    delete settings.snaptrade;
    // Also remove snap- accounts
    if (settings.brokers) {
      settings.brokers.accounts = settings.brokers.accounts.filter(
        (a) => !a.id.startsWith('snap-')
      );
    }
    await saveSettings(settings);
    return jsonResponse({ ok: true });
  }

  // GET /api/simplefin/status — check if SimpleFIN is configured
  if (pathname === '/api/simplefin/status' && req.method === 'GET') {
    const settings = await loadSettings();
    return jsonResponse({
      configured: !!settings.simplefin?.accessUrl,
    });
  }

  // POST /api/simplefin/setup — claim a setup token and save access URL
  if (pathname === '/api/simplefin/setup' && req.method === 'POST') {
    const body = await req.json();
    const { setupToken } = body;
    if (!setupToken) {
      return jsonResponse({ error: 'Missing setupToken' }, 400);
    }
    try {
      const accessUrl = await claimSetupToken(setupToken);
      const settings = await loadSettings();
      settings.simplefin = { accessUrl };
      await saveSettings(settings);
      return jsonResponse({ ok: true });
    } catch (err) {
      logSimplefin.error(`Setup failed: ${err instanceof Error ? err.message : err}`);
      return jsonResponse({ error: err instanceof Error ? err.message : 'Setup failed' }, 500);
    }
  }

  // GET /api/simplefin/balances — fetch balances
  if (pathname === '/api/simplefin/balances' && req.method === 'GET') {
    const settings = await loadSettings();
    if (!settings.simplefin?.accessUrl) {
      return jsonResponse({ accounts: [], lastUpdated: '' });
    }

    const cached = url.searchParams.get('cached') === '1';
    if (cached) {
      try {
        const content = await fs.readFile(SIMPLEFIN_CACHE_FILE, 'utf-8');
        return jsonResponse(JSON.parse(content));
      } catch {
        return jsonResponse({ accounts: [], lastUpdated: '' });
      }
    }

    try {
      const accounts = await fetchSimplefinBalances(settings.simplefin);
      const cache: SimplefinBalanceCache = {
        accounts,
        lastUpdated: new Date().toISOString(),
      };
      await fs.writeFile(SIMPLEFIN_CACHE_FILE, JSON.stringify(cache, null, 2)).catch(() => {});
      return jsonResponse(cache);
    } catch (err) {
      logSimplefin.error(`Balances fetch failed: ${err instanceof Error ? err.message : err}`);
      return jsonResponse(
        { error: err instanceof Error ? err.message : 'Failed to fetch balances' },
        500
      );
    }
  }

  // DELETE /api/simplefin — remove SimpleFIN config
  if (pathname === '/api/simplefin' && req.method === 'DELETE') {
    const settings = await loadSettings();
    delete settings.simplefin;
    await saveSettings(settings);
    try {
      await fs.unlink(SIMPLEFIN_CACHE_FILE);
    } catch {
      /* ignore */
    }
    return jsonResponse({ ok: true });
  }

  return null;
}
