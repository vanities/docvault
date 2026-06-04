// Politics feed routes — the in-container replacement for the old
// `/api/check-the-vote/*` Pi bridge.
//
//   GET  /api/politics/feed     — read the cached feed (bills, executive actions,
//                                 trades, filings) in a consumer-compatible shape
//   POST /api/politics/refresh  — run the forward-only refresh now (verification +
//                                 the Jobs "Run now" affordance)

import { jsonResponse } from '../data.js';
import { loadScheduleStatus } from '../scheduler.js';
import { buildFeedPayload, loadPoliticsCache, type FeedSyncJob } from '../politics/feed-store.js';
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

export async function handlePoliticsRoutes(
  req: Request,
  _url: URL,
  pathname: string
): Promise<Response | null> {
  if (pathname === '/api/politics/feed' && req.method === 'GET') {
    const [cache, jobs] = await Promise.all([loadPoliticsCache(), syncJobsFromSchedule()]);
    const payload = buildFeedPayload(cache, { jobs });
    // Always 200 — an empty-but-configured feed (e.g. before the first run) is valid.
    return jsonResponse(payload);
  }

  if (pathname === '/api/politics/refresh' && req.method === 'POST') {
    const result = await refreshPolitics();
    return jsonResponse(result, result.errors.length > 0 ? 207 : 200);
  }

  return null;
}
