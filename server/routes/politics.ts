// Politics feed routes — the in-container replacement for the old
// `/api/check-the-vote/*` Pi bridge.
//
//   GET  /api/politics/feed          — cached feed (bills, exec actions, trades, filings)
//   GET  /api/politics/top-spenders  — politicians ranked by disclosed $ volume
//   GET  /api/politics/trades        — filtered trades (politician/chamber/category/ticker)
//   POST /api/politics/refresh       — forward-only refresh now
//   POST /api/politics/backfill      — one-time: parse the full current year

import { jsonResponse } from '../data.js';
import { createLogger } from '../logger.js';
import { loadScheduleStatus } from '../scheduler.js';
import {
  getFilingMeta,
  listFilings,
  readFilingPdf,
  readFilingText,
  searchFilings,
} from '../politics/filing-archive.js';
import {
  buildFeedPayload,
  filterTrades,
  loadPoliticsCache,
  topSpenders,
  type FeedSyncJob,
} from '../politics/feed-store.js';
import { refreshPolitics } from '../politics/refresh.js';
import { buildHeadshotResolver, getCachedHeadshot } from '../politics/legislators.js';
import { detectTradeClusters } from '../politics/clusters.js';
import { loadBacktest, runBacktest } from '../politics/backtest-runner.js';

const log = createLogger('PoliticsRoutes');

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
  if (pathname.startsWith('/api/politics/headshot/') && req.method === 'GET') {
    // Self-hosted member portrait: served from the on-disk cache, lazily filled
    // from the CDN on first hit. 404 → the UI falls back to an initials avatar.
    const bioguide = decodeURIComponent(pathname.slice('/api/politics/headshot/'.length));
    const img = await getCachedHeadshot(bioguide);
    if (!img) return new Response(null, { status: 404 });
    return new Response(new Uint8Array(img), {
      headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=604800' },
    });
  }

  // --- Filings archive (raw PDF + extracted text + parse metadata) ---
  if (pathname === '/api/politics/filings/search' && req.method === 'GET') {
    const q = url.searchParams.get('q') ?? '';
    const results = await searchFilings(q, intParam(url, 'limit', 50, 200));
    log.info(`filings full-text search ${JSON.stringify(q)} → ${results.length} hit(s)`);
    return jsonResponse({ query: q, count: results.length, filings: results });
  }

  const filingMatch = pathname.match(
    /^\/api\/politics\/filings\/([^/]+)\/([^/]+?)(\/pdf|\/text)?$/
  );
  if (filingMatch && req.method === 'GET') {
    const source = decodeURIComponent(filingMatch[1]);
    const docId = decodeURIComponent(filingMatch[2]);
    const sub = filingMatch[3];
    if (sub === '/pdf') {
      const pdf = await readFilingPdf(source, docId);
      if (!pdf) {
        log.warn(`filing PDF not in archive: ${source}/${docId}`);
        return new Response(null, { status: 404 });
      }
      log.info(`served archived PDF ${source}/${docId} (${pdf.length}B)`);
      return new Response(new Uint8Array(pdf), {
        headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'public, max-age=86400' },
      });
    }
    if (sub === '/text') {
      const text = await readFilingText(source, docId);
      if (text == null) return new Response(null, { status: 404 });
      return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    const meta = await getFilingMeta(source, docId);
    if (!meta) {
      log.warn(`filing metadata not in archive: ${source}/${docId}`);
      return jsonResponse({ error: 'filing not found in archive' }, 404);
    }
    const cache = await loadPoliticsCache();
    const trades = cache.trades.filter((t) => t.filingDocId === docId && t.source === source);
    log.info(`filing detail ${source}/${docId} → ${trades.length} linked trade(s)`);
    return jsonResponse({ filing: meta, trades });
  }

  if (pathname === '/api/politics/filings' && req.method === 'GET') {
    const filings = await listFilings({
      source: url.searchParams.get('source') ?? undefined,
      chamber: url.searchParams.get('chamber') ?? undefined,
      filer: url.searchParams.get('filer') ?? undefined,
      year: url.searchParams.get('year') ? Number(url.searchParams.get('year')) : undefined,
      hasTrades: url.searchParams.get('hasTrades') === 'true' ? true : undefined,
      limit: intParam(url, 'limit', 200, 5000),
    });
    log.info(`filings list → ${filings.length} filing(s)`);
    return jsonResponse({ count: filings.length, filings });
  }

  if (pathname === '/api/politics/feed' && req.method === 'GET') {
    const [cache, jobs] = await Promise.all([loadPoliticsCache(), syncJobsFromSchedule()]);
    // Always 200 — an empty-but-configured feed (e.g. before the first run) is valid.
    return jsonResponse(buildFeedPayload(cache, { jobs }));
  }

  if (pathname === '/api/politics/top-spenders' && req.method === 'GET') {
    const [cache, resolveHeadshot] = await Promise.all([
      loadPoliticsCache(),
      buildHeadshotResolver(),
    ]);
    const spenders = topSpenders(cache, intParam(url, 'limit', 25, 200)).map((s) => ({
      ...s,
      imageUrl: resolveHeadshot(s.politician),
    }));
    return jsonResponse({ spenders });
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

  if (pathname === '/api/politics/clusters' && req.method === 'GET') {
    // Consensus activity: ≥N distinct politicians trading the same ticker in the
    // same direction within a window. ?direction=buy|sell, ?windowDays, ?minPoliticians.
    const [cache, resolveHeadshot] = await Promise.all([
      loadPoliticsCache(),
      buildHeadshotResolver(),
    ]);
    let clusters = detectTradeClusters(cache.trades, {
      windowDays: intParam(url, 'windowDays', 60, 365),
      minPoliticians: intParam(url, 'minPoliticians', 2, 50),
    });
    const direction = url.searchParams.get('direction');
    if (direction === 'buy' || direction === 'sell') {
      clusters = clusters.filter((c) => c.direction === direction);
    }
    const enriched = clusters.slice(0, intParam(url, 'limit', 50, 500)).map((c) => ({
      ...c,
      politicianImages: c.politicians.map((name) => ({ name, imageUrl: resolveHeadshot(name) })),
    }));
    return jsonResponse({ clusters: enriched });
  }

  if (pathname === '/api/politics/backtest' && req.method === 'GET') {
    // Copy-trade backtest: per-politician P&L leaderboard, or one politician's
    // per-trade simulations via ?politician=. Recomputed daily with the refresh.
    const result = await loadBacktest();
    if (!result) {
      return jsonResponse({
        generatedAt: null,
        leaderboard: [],
        note: 'Backtest not computed yet — runs with the daily refresh (or POST /backtest/run).',
      });
    }
    const politician = url.searchParams.get('politician');
    if (politician) {
      const perf = result.leaderboard.find((p) => p.politician === politician) ?? null;
      log.info(`backtest detail ${politician} → ${(result.trades[politician] ?? []).length} sims`);
      return jsonResponse({
        generatedAt: result.generatedAt,
        politician,
        performance: perf,
        trades: result.trades[politician] ?? [],
      });
    }
    const resolveHeadshot = await buildHeadshotResolver();
    const leaderboard = result.leaderboard
      .slice(0, intParam(url, 'limit', 200, 500))
      .map((p) => ({ ...p, imageUrl: resolveHeadshot(p.politician) }));
    return jsonResponse({
      generatedAt: result.generatedAt,
      pricedTickers: result.pricedTickers,
      totalTickers: result.totalTickers,
      leaderboard,
    });
  }

  if (pathname === '/api/politics/backtest/run' && req.method === 'POST') {
    // Fetches a year of prices for every disclosed ticker — minutes — so fire it
    // server-side and return immediately.
    void runBacktest().catch(() => {});
    return jsonResponse(
      {
        ok: true,
        started: true,
        note: 'Backtest running; GET /api/politics/backtest for the result.',
      },
      202
    );
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
