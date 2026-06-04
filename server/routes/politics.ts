// Politics feed routes — the in-container replacement for the old
// `/api/check-the-vote/*` Pi bridge.
//
//   GET  /api/politics/feed          — cached feed (bills, exec actions, trades, filings)
//   GET  /api/politics/top-spenders  — politicians ranked by disclosed $ volume
//   GET  /api/politics/trades        — filtered trades (politician/chamber/category/ticker)
//   POST /api/politics/refresh       — forward-only refresh now
//   POST /api/politics/backfill      — one-time: parse the full current year

import { jsonResponse } from '../data.js';
import { loadScheduleStatus } from '../scheduler.js';
import {
  buildFeedPayload,
  filterTrades,
  loadPoliticsCache,
  topSpenders,
  type FeedSyncJob,
} from '../politics/feed-store.js';
import { refreshPolitics } from '../politics/refresh.js';

async function syncJobsFromSchedule(): Promise<FeedSyncJob[]> {
  const status = await loadScheduleStatus();
  const politics = status.politicsRefresh;
  if (!politics) return [];
  return [
    {
      name: 'politicsRefresh',
      status: politics.lastError ? 'error' : politics.lastSuccessAt ? 'ok' : 'pending',
      error: politics.lastError,
      ranAt: politics.lastRanAt,
    },
  ];
}

function intParam(url: URL, name: string, fallback: number, max: number): number {
  const raw = Number(url.searchParams.get(name));
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, max) : fallback;
}

export async function handlePoliticsRoutes(
  req: Request,
  url: URL,
  pathname: string
): Promise<Response | null> {
  if (pathname === '/api/politics/feed' && req.method === 'GET') {
    const [cache, jobs] = await Promise.all([loadPoliticsCache(), syncJobsFromSchedule()]);
    // Always 200 — an empty-but-configured feed (e.g. before the first run) is valid.
    return jsonResponse(buildFeedPayload(cache, { jobs }));
  }

  if (pathname === '/api/politics/top-spenders' && req.method === 'GET') {
    const cache = await loadPoliticsCache();
    return jsonResponse({ spenders: topSpenders(cache, intParam(url, 'limit', 25, 200)) });
  }

  if (pathname === '/api/politics/trades' && req.method === 'GET') {
    const cache = await loadPoliticsCache();
    const trades = filterTrades(cache, {
      politician: url.searchParams.get('politician') ?? undefined,
      chamber: url.searchParams.get('chamber') ?? undefined,
      category: url.searchParams.get('category') ?? undefined,
      ticker: url.searchParams.get('ticker') ?? undefined,
      limit: intParam(url, 'limit', 200, 2000),
    });
    return jsonResponse({ trades });
  }

  if (pathname === '/api/politics/refresh' && req.method === 'POST') {
    const result = await refreshPolitics();
    return jsonResponse(result, result.errors.length > 0 ? 207 : 200);
  }

  if (pathname === '/api/politics/backfill' && req.method === 'POST') {
    // One-time: parse the full current year of House/Senate/OGE filings. This
    // takes minutes — far longer than the socket idle timeout — so fire it
    // server-side and return immediately. refreshPolitics serializes internally,
    // so this queues behind any in-flight refresh. Poll /api/politics/feed
    // (checkedAt / trades count) for completion. Idempotent (dedup by externalId).
    void refreshPolitics({ backfill: true }).catch(() => {});
    return jsonResponse(
      {
        ok: true,
        started: true,
        note: 'Backfill running; poll /api/politics/feed for the result.',
      },
      202
    );
  }

  return null;
}
