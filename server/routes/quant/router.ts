import { jsonResponse, loadSettings } from '../../data.js';
import { fetchPredictionMarkets } from '../../prediction-markets.js';
import { CACHE, TTL } from './cache-policy.js';
import { cachedJsonResponse } from './http.js';
import {
  DAY_MS,
  computeAltcoinSeasonIndex,
  computeBtcDerivatives,
  computeBtcDrawdown,
  computeBtcLogRegression,
  computeBusinessCycle,
  computeCommodities,
  computeFearGreed,
  computeFedPolicy,
  computeFinancialConditions,
  computeFlippening,
  computeGdpGrowthDashboard,
  computeGlobalMarkets,
  computeHashRate,
  computeHousingDashboard,
  computeInflationDashboard,
  computeJobsDashboard,
  computeKronos,
  computeMacroDashboard,
  computeMidtermDrawdowns,
  computePresidentialCycle,
  computeRealRates,
  computeRunningRoi,
  computeSP500RiskMetric,
  computeSectorRotation,
  computeShillerValuation,
  computeVixTermStructure,
  computeYieldCurve,
  fetchBtcDominance,
  isFresh,
  loadCache,
  logQuant,
  readSnapshots,
  refreshAllQuantData,
  saveCache,
} from './engine.js';

// ---------------------------------------------------------------------------
// Route dispatcher
// ---------------------------------------------------------------------------

export async function handleQuantRoutes(
  req: Request,
  url: URL,
  pathname: string
): Promise<Response | null> {
  logQuant.info(`${req.method} ${pathname}`);

  // POST /api/quant/refresh — force re-fetch all quant data now
  if (pathname === '/api/quant/refresh' && req.method === 'POST') {
    const result = await refreshAllQuantData();
    return jsonResponse({
      ok:
        result.btc ||
        result.spxCycle ||
        result.sectorRotation ||
        result.shillerValuation ||
        result.yieldCurve ||
        result.btcDominance ||
        result.predictions,
      btcRefreshed: result.btc,
      spxCycleRefreshed: result.spxCycle,
      sectorRotationRefreshed: result.sectorRotation,
      shillerValuationRefreshed: result.shillerValuation,
      yieldCurveRefreshed: result.yieldCurve,
      btcDominanceRefreshed: result.btcDominance,
      predictionsRefreshed: result.predictions,
      errors: result.errors,
      refreshedAt: Date.now(),
    });
  }

  // GET /api/quant/snapshots?days=365 — return the snapshot history
  if (pathname === '/api/quant/snapshots' && req.method === 'GET') {
    const days = Math.max(1, Math.min(Number(url.searchParams.get('days')) || 365, 3650));
    const file = await readSnapshots();
    const cutoff = Date.now() - days * DAY_MS;
    const filtered = file.snapshots.filter((s) => s.takenAt >= cutoff);
    return cachedJsonResponse(
      req,
      {
        snapshots: filtered,
        totalAll: file.snapshots.length,
        returned: filtered.length,
        days,
      },
      CACHE.snapshots
    );
  }

  // GET /api/quant/cycle/presidential
  if (pathname === '/api/quant/cycle/presidential' && req.method === 'GET') {
    const cache = await loadCache();
    if (isFresh(cache.presidentialCycle, TTL.presidentialCycle)) {
      return cachedJsonResponse(
        req,
        {
          ...cache.presidentialCycle!.data,
          cached: true,
          fetchedAt: cache.presidentialCycle!.fetchedAt,
        },
        CACHE.presidentialCycle
      );
    }
    try {
      logQuant.info('presidential-cycle — computing fresh');
      const data = await computePresidentialCycle();
      cache.presidentialCycle = { fetchedAt: Date.now(), data };
      await saveCache(cache);
      return cachedJsonResponse(
        req,
        { ...data, cached: false, fetchedAt: cache.presidentialCycle.fetchedAt },
        CACHE.presidentialCycle
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logQuant.warn('presidential-cycle failed:', msg);
      // Fall back to stale cache if a fetch fails
      if (cache.presidentialCycle) {
        return cachedJsonResponse(
          req,
          {
            ...cache.presidentialCycle.data,
            cached: true,
            stale: true,
            fetchedAt: cache.presidentialCycle.fetchedAt,
            fetchError: msg,
          },
          CACHE.presidentialCycle
        );
      }
      return jsonResponse({ error: `Presidential cycle fetch failed: ${msg}` }, 502);
    }
  }

  // GET /api/quant/macro/business-cycle — recession prob + leading/coincident indicators
  if (pathname === '/api/quant/macro/business-cycle' && req.method === 'GET') {
    const cache = await loadCache();
    if (isFresh(cache.businessCycle, TTL.businessCycle)) {
      return cachedJsonResponse(
        req,
        { ...cache.businessCycle!.data, cached: true },
        CACHE.businessCycle
      );
    }
    try {
      logQuant.info('business-cycle — computing fresh');
      const settings = await loadSettings();
      const fredKey = settings.fredApiKey;
      if (!fredKey) {
        return jsonResponse(
          { error: 'FRED API key not configured. Add one in Settings → Quant.' },
          400
        );
      }
      const data = await computeBusinessCycle(fredKey);
      cache.businessCycle = { fetchedAt: Date.now(), data };
      await saveCache(cache);
      return cachedJsonResponse(req, { ...data, cached: false }, CACHE.businessCycle);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logQuant.warn('business-cycle failed:', msg);
      if (cache.businessCycle) {
        return cachedJsonResponse(
          req,
          { ...cache.businessCycle.data, cached: true, stale: true, fetchError: msg },
          CACHE.businessCycle
        );
      }
      return jsonResponse({ error: `Business cycle fetch failed: ${msg}` }, 502);
    }
  }

  // GET /api/quant/macro/inflation — CPI / PCE / PPI / breakevens / WALCL / oil
  if (pathname === '/api/quant/macro/inflation' && req.method === 'GET') {
    const cache = await loadCache();
    if (isFresh(cache.inflation, TTL.inflation)) {
      return cachedJsonResponse(req, { ...cache.inflation!.data, cached: true }, CACHE.inflation);
    }
    try {
      logQuant.info('inflation — computing fresh');
      const settings = await loadSettings();
      const fredKey = settings.fredApiKey;
      if (!fredKey) {
        return jsonResponse(
          { error: 'FRED API key not configured. Add one in Settings → Quant.' },
          400
        );
      }
      const data = await computeInflationDashboard(fredKey);
      cache.inflation = { fetchedAt: Date.now(), data };
      await saveCache(cache);
      return cachedJsonResponse(req, { ...data, cached: false }, CACHE.inflation);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logQuant.warn('inflation failed:', msg);
      if (cache.inflation) {
        return cachedJsonResponse(
          req,
          { ...cache.inflation.data, cached: true, stale: true, fetchError: msg },
          CACHE.inflation
        );
      }
      return jsonResponse({ error: `Inflation dashboard fetch failed: ${msg}` }, 502);
    }
  }

  // GET /api/quant/macro/financial-conditions — NFCI / ANFCI / STLFSI4 / KCFSI
  if (pathname === '/api/quant/macro/financial-conditions' && req.method === 'GET') {
    const cache = await loadCache();
    if (isFresh(cache.financialConditions, TTL.financialConditions)) {
      return cachedJsonResponse(
        req,
        { ...cache.financialConditions!.data, cached: true },
        CACHE.financialConditions
      );
    }
    try {
      logQuant.info('financial-conditions — computing fresh');
      const settings = await loadSettings();
      const fredKey = settings.fredApiKey;
      if (!fredKey) {
        return jsonResponse(
          { error: 'FRED API key not configured. Add one in Settings → Quant.' },
          400
        );
      }
      const data = await computeFinancialConditions(fredKey);
      cache.financialConditions = { fetchedAt: Date.now(), data };
      await saveCache(cache);
      return cachedJsonResponse(req, { ...data, cached: false }, CACHE.financialConditions);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logQuant.warn('financial-conditions failed:', msg);
      if (cache.financialConditions) {
        return cachedJsonResponse(
          req,
          { ...cache.financialConditions.data, cached: true, stale: true, fetchError: msg },
          CACHE.financialConditions
        );
      }
      return jsonResponse({ error: `Financial conditions fetch failed: ${msg}` }, 502);
    }
  }

  // GET /api/quant/macro/housing — 6-series housing dashboard from FRED
  if (pathname === '/api/quant/macro/housing' && req.method === 'GET') {
    const cache = await loadCache();
    if (isFresh(cache.housing, TTL.housing)) {
      return cachedJsonResponse(req, { ...cache.housing!.data, cached: true }, CACHE.housing);
    }
    try {
      logQuant.info('housing — computing fresh');
      const settings = await loadSettings();
      const fredKey = settings.fredApiKey;
      if (!fredKey) {
        return jsonResponse(
          { error: 'FRED API key not configured. Add one in Settings → Quant.' },
          400
        );
      }
      const data = await computeHousingDashboard(fredKey);
      cache.housing = { fetchedAt: Date.now(), data };
      await saveCache(cache);
      return cachedJsonResponse(req, { ...data, cached: false }, CACHE.housing);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logQuant.warn('housing failed:', msg);
      if (cache.housing) {
        return cachedJsonResponse(
          req,
          { ...cache.housing.data, cached: true, stale: true, fetchError: msg },
          CACHE.housing
        );
      }
      return jsonResponse({ error: `Housing fetch failed: ${msg}` }, 502);
    }
  }

  // GET /api/quant/macro/gdp-growth — 6-series growth dashboard from FRED
  if (pathname === '/api/quant/macro/gdp-growth' && req.method === 'GET') {
    const cache = await loadCache();
    if (isFresh(cache.gdpGrowth, TTL.gdpGrowth)) {
      return cachedJsonResponse(req, { ...cache.gdpGrowth!.data, cached: true }, CACHE.gdpGrowth);
    }
    try {
      logQuant.info('gdp-growth — computing fresh');
      const settings = await loadSettings();
      const fredKey = settings.fredApiKey;
      if (!fredKey) {
        return jsonResponse(
          { error: 'FRED API key not configured. Add one in Settings → Quant.' },
          400
        );
      }
      const data = await computeGdpGrowthDashboard(fredKey);
      cache.gdpGrowth = { fetchedAt: Date.now(), data };
      await saveCache(cache);
      return cachedJsonResponse(req, { ...data, cached: false }, CACHE.gdpGrowth);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logQuant.warn('gdp-growth failed:', msg);
      if (cache.gdpGrowth) {
        return cachedJsonResponse(
          req,
          { ...cache.gdpGrowth.data, cached: true, stale: true, fetchError: msg },
          CACHE.gdpGrowth
        );
      }
      return jsonResponse({ error: `GDP growth fetch failed: ${msg}` }, 502);
    }
  }

  // GET /api/quant/tradfi/commodities — gold/silver/oil/copper/nat gas/platinum
  if (pathname === '/api/quant/tradfi/commodities' && req.method === 'GET') {
    const cache = await loadCache();
    if (isFresh(cache.commodities, TTL.commodities)) {
      return cachedJsonResponse(
        req,
        { ...cache.commodities!.data, cached: true },
        CACHE.commodities
      );
    }
    try {
      logQuant.info('commodities — computing fresh');
      const data = await computeCommodities();
      cache.commodities = { fetchedAt: Date.now(), data };
      await saveCache(cache);
      return cachedJsonResponse(req, { ...data, cached: false }, CACHE.commodities);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logQuant.warn('commodities failed:', msg);
      if (cache.commodities) {
        return cachedJsonResponse(
          req,
          { ...cache.commodities.data, cached: true, stale: true, fetchError: msg },
          CACHE.commodities
        );
      }
      return jsonResponse({ error: `Commodities fetch failed: ${msg}` }, 502);
    }
  }

  // GET /api/quant/tradfi/vix-term — VIX, VIX3M, VIX6M, VXN
  if (pathname === '/api/quant/tradfi/vix-term' && req.method === 'GET') {
    const cache = await loadCache();
    if (isFresh(cache.vixTermStructure, TTL.vixTermStructure)) {
      return cachedJsonResponse(
        req,
        { ...cache.vixTermStructure!.data, cached: true },
        CACHE.vixTermStructure
      );
    }
    try {
      logQuant.info('vix-term — computing fresh');
      const data = await computeVixTermStructure();
      cache.vixTermStructure = { fetchedAt: Date.now(), data };
      await saveCache(cache);
      return cachedJsonResponse(req, { ...data, cached: false }, CACHE.vixTermStructure);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logQuant.warn('vix-term failed:', msg);
      if (cache.vixTermStructure) {
        return cachedJsonResponse(
          req,
          { ...cache.vixTermStructure.data, cached: true, stale: true, fetchError: msg },
          CACHE.vixTermStructure
        );
      }
      return jsonResponse({ error: `VIX term structure fetch failed: ${msg}` }, 502);
    }
  }

  // GET /api/quant/tradfi/global-markets — international indices + EM/EAFE ETFs
  if (pathname === '/api/quant/tradfi/global-markets' && req.method === 'GET') {
    const cache = await loadCache();
    if (isFresh(cache.globalMarkets, TTL.globalMarkets)) {
      return cachedJsonResponse(
        req,
        { ...cache.globalMarkets!.data, cached: true },
        CACHE.globalMarkets
      );
    }
    try {
      logQuant.info('global-markets — computing fresh');
      const data = await computeGlobalMarkets();
      cache.globalMarkets = { fetchedAt: Date.now(), data };
      await saveCache(cache);
      return cachedJsonResponse(req, { ...data, cached: false }, CACHE.globalMarkets);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logQuant.warn('global-markets failed:', msg);
      if (cache.globalMarkets) {
        return cachedJsonResponse(
          req,
          { ...cache.globalMarkets.data, cached: true, stale: true, fetchError: msg },
          CACHE.globalMarkets
        );
      }
      return jsonResponse({ error: `Global markets fetch failed: ${msg}` }, 502);
    }
  }

  // GET /api/quant/btc/drawdown — running drawdown from ATH + episodes
  if (pathname === '/api/quant/btc/drawdown' && req.method === 'GET') {
    const cache = await loadCache();
    if (isFresh(cache.btcDrawdown, TTL.btcDrawdown)) {
      return cachedJsonResponse(
        req,
        { ...cache.btcDrawdown!.data, cached: true },
        CACHE.btcDrawdown
      );
    }
    try {
      logQuant.info('btc-drawdown — computing fresh');
      const data = await computeBtcDrawdown();
      cache.btcDrawdown = { fetchedAt: Date.now(), data };
      await saveCache(cache);
      return cachedJsonResponse(req, { ...data, cached: false }, CACHE.btcDrawdown);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logQuant.warn('btc-drawdown failed:', msg);
      if (cache.btcDrawdown) {
        return cachedJsonResponse(
          req,
          { ...cache.btcDrawdown.data, cached: true, stale: true, fetchError: msg },
          CACHE.btcDrawdown
        );
      }
      return jsonResponse({ error: `BTC drawdown fetch failed: ${msg}` }, 502);
    }
  }

  // GET /api/quant/btc/fear-greed — alternative.me Crypto Fear & Greed Index
  if (pathname === '/api/quant/btc/fear-greed' && req.method === 'GET') {
    const cache = await loadCache();
    if (isFresh(cache.fearGreed, TTL.fearGreed)) {
      return cachedJsonResponse(req, { ...cache.fearGreed!.data, cached: true }, CACHE.fearGreed);
    }
    try {
      logQuant.info('fear-greed — computing fresh');
      const data = await computeFearGreed();
      cache.fearGreed = { fetchedAt: Date.now(), data };
      await saveCache(cache);
      return cachedJsonResponse(req, { ...data, cached: false }, CACHE.fearGreed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logQuant.warn('fear-greed failed:', msg);
      if (cache.fearGreed) {
        return cachedJsonResponse(
          req,
          { ...cache.fearGreed.data, cached: true, stale: true, fetchError: msg },
          CACHE.fearGreed
        );
      }
      return jsonResponse({ error: `Fear & Greed fetch failed: ${msg}` }, 502);
    }
  }

  // GET /api/quant/btc/flippening — ETH/BTC price ratio + progress to flip
  if (pathname === '/api/quant/btc/flippening' && req.method === 'GET') {
    const cache = await loadCache();
    if (isFresh(cache.flippening, TTL.flippening)) {
      return cachedJsonResponse(req, { ...cache.flippening!.data, cached: true }, CACHE.flippening);
    }
    try {
      logQuant.info('flippening — computing fresh');
      const data = await computeFlippening();
      cache.flippening = { fetchedAt: Date.now(), data };
      await saveCache(cache);
      return cachedJsonResponse(req, { ...data, cached: false }, CACHE.flippening);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logQuant.warn('flippening failed:', msg);
      if (cache.flippening) {
        return cachedJsonResponse(
          req,
          { ...cache.flippening.data, cached: true, stale: true, fetchError: msg },
          CACHE.flippening
        );
      }
      return jsonResponse({ error: `Flippening fetch failed: ${msg}` }, 502);
    }
  }

  // GET /api/quant/macro/real-rates — DGS10 − T10YIE and DGS5 − T5YIE
  if (pathname === '/api/quant/macro/real-rates' && req.method === 'GET') {
    const cache = await loadCache();
    if (isFresh(cache.realRates, TTL.realRates)) {
      return cachedJsonResponse(req, { ...cache.realRates!.data, cached: true }, CACHE.realRates);
    }
    try {
      logQuant.info('real-rates — computing fresh');
      const settings = await loadSettings();
      const fredKey = settings.fredApiKey;
      if (!fredKey) {
        return jsonResponse(
          { error: 'FRED API key not configured. Add one in Settings → Quant.' },
          400
        );
      }
      const data = await computeRealRates(fredKey);
      cache.realRates = { fetchedAt: Date.now(), data };
      await saveCache(cache);
      return cachedJsonResponse(req, { ...data, cached: false }, CACHE.realRates);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logQuant.warn('real-rates failed:', msg);
      if (cache.realRates) {
        return cachedJsonResponse(
          req,
          { ...cache.realRates.data, cached: true, stale: true, fetchError: msg },
          CACHE.realRates
        );
      }
      return jsonResponse({ error: `Real rates fetch failed: ${msg}` }, 502);
    }
  }

  // GET /api/quant/btc/hash-rate — blockchain.info hash rate + hash ribbons
  if (pathname === '/api/quant/btc/hash-rate' && req.method === 'GET') {
    const cache = await loadCache();
    if (isFresh(cache.hashRate, TTL.hashRate)) {
      return cachedJsonResponse(req, { ...cache.hashRate!.data, cached: true }, CACHE.hashRate);
    }
    try {
      logQuant.info('hash-rate — computing fresh');
      const data = await computeHashRate();
      cache.hashRate = { fetchedAt: Date.now(), data };
      await saveCache(cache);
      return cachedJsonResponse(req, { ...data, cached: false }, CACHE.hashRate);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logQuant.warn('hash-rate failed:', msg);
      if (cache.hashRate) {
        return cachedJsonResponse(
          req,
          { ...cache.hashRate.data, cached: true, stale: true, fetchError: msg },
          CACHE.hashRate
        );
      }
      return jsonResponse({ error: `Hash rate fetch failed: ${msg}` }, 502);
    }
  }

  // GET /api/quant/running-roi — rolling holding-period returns for BTC + SPX
  if (pathname === '/api/quant/running-roi' && req.method === 'GET') {
    const cache = await loadCache();
    if (isFresh(cache.runningRoi, TTL.runningRoi)) {
      return cachedJsonResponse(req, { ...cache.runningRoi!.data, cached: true }, CACHE.runningRoi);
    }
    try {
      logQuant.info('running-roi — computing fresh');
      const data = await computeRunningRoi();
      cache.runningRoi = { fetchedAt: Date.now(), data };
      await saveCache(cache);
      return cachedJsonResponse(req, { ...data, cached: false }, CACHE.runningRoi);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logQuant.warn('running-roi failed:', msg);
      if (cache.runningRoi) {
        return cachedJsonResponse(
          req,
          { ...cache.runningRoi.data, cached: true, stale: true, fetchError: msg },
          CACHE.runningRoi
        );
      }
      return jsonResponse({ error: `Running ROI fetch failed: ${msg}` }, 502);
    }
  }

  // GET /api/quant/macro/jobs — labor dashboard from FRED
  if (pathname === '/api/quant/macro/jobs' && req.method === 'GET') {
    const cache = await loadCache();
    if (isFresh(cache.jobsDashboard, TTL.jobsDashboard)) {
      return cachedJsonResponse(
        req,
        { ...cache.jobsDashboard!.data, cached: true },
        CACHE.jobsDashboard
      );
    }
    try {
      logQuant.info('jobs — computing fresh');
      const settings = await loadSettings();
      const fredKey = settings.fredApiKey;
      if (!fredKey) {
        return jsonResponse(
          { error: 'FRED API key not configured. Add one in Settings → Quant.' },
          400
        );
      }
      const data = await computeJobsDashboard(fredKey);
      cache.jobsDashboard = { fetchedAt: Date.now(), data };
      await saveCache(cache);
      return cachedJsonResponse(req, { ...data, cached: false }, CACHE.jobsDashboard);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logQuant.warn('jobs failed:', msg);
      if (cache.jobsDashboard) {
        return cachedJsonResponse(
          req,
          { ...cache.jobsDashboard.data, cached: true, stale: true, fetchError: msg },
          CACHE.jobsDashboard
        );
      }
      return jsonResponse({ error: `Jobs dashboard fetch failed: ${msg}` }, 502);
    }
  }

  // GET /api/quant/macro/fed-policy — DFF + target range + rate change events
  if (pathname === '/api/quant/macro/fed-policy' && req.method === 'GET') {
    const cache = await loadCache();
    if (isFresh(cache.fedPolicy, TTL.fedPolicy)) {
      return cachedJsonResponse(req, { ...cache.fedPolicy!.data, cached: true }, CACHE.fedPolicy);
    }
    try {
      logQuant.info('fed-policy — computing fresh');
      const settings = await loadSettings();
      const fredKey = settings.fredApiKey;
      if (!fredKey) {
        return jsonResponse(
          { error: 'FRED API key not configured. Add one in Settings → Quant.' },
          400
        );
      }
      const data = await computeFedPolicy(fredKey);
      cache.fedPolicy = { fetchedAt: Date.now(), data };
      await saveCache(cache);
      return cachedJsonResponse(req, { ...data, cached: false }, CACHE.fedPolicy);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logQuant.warn('fed-policy failed:', msg);
      if (cache.fedPolicy) {
        return cachedJsonResponse(
          req,
          { ...cache.fedPolicy.data, cached: true, stale: true, fetchError: msg },
          CACHE.fedPolicy
        );
      }
      return jsonResponse({ error: `Fed policy fetch failed: ${msg}` }, 502);
    }
  }

  // GET /api/quant/macro/dashboard — 10Y, DFF, M2, DXY, Core CPI from FRED
  if (pathname === '/api/quant/macro/dashboard' && req.method === 'GET') {
    const cache = await loadCache();
    if (isFresh(cache.macroDashboard, TTL.macroDashboard)) {
      return cachedJsonResponse(
        req,
        { ...cache.macroDashboard!.data, cached: true },
        CACHE.macroDashboard
      );
    }
    try {
      logQuant.info('macro-dashboard — computing fresh');
      const settings = await loadSettings();
      const fredKey = settings.fredApiKey;
      if (!fredKey) {
        return jsonResponse(
          {
            error:
              'FRED API key not configured. Add one in Settings → Quant (free, 30-second signup).',
          },
          400
        );
      }
      const data = await computeMacroDashboard(fredKey);
      cache.macroDashboard = { fetchedAt: Date.now(), data };
      await saveCache(cache);
      return cachedJsonResponse(req, { ...data, cached: false }, CACHE.macroDashboard);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logQuant.warn('macro-dashboard failed:', msg);
      if (cache.macroDashboard) {
        return cachedJsonResponse(
          req,
          { ...cache.macroDashboard.data, cached: true, stale: true, fetchError: msg },
          CACHE.macroDashboard
        );
      }
      return jsonResponse({ error: `Macro dashboard fetch failed: ${msg}` }, 502);
    }
  }

  // GET /api/quant/macro/yield-curve — T10Y2Y and T10Y3M from FRED
  if (pathname === '/api/quant/macro/yield-curve' && req.method === 'GET') {
    const cache = await loadCache();
    if (isFresh(cache.yieldCurve, TTL.yieldCurve)) {
      return cachedJsonResponse(
        req,
        {
          ...cache.yieldCurve!.data,
          cached: true,
          fetchedAt: cache.yieldCurve!.fetchedAt,
        },
        CACHE.yieldCurve
      );
    }
    try {
      logQuant.info('yield-curve — computing fresh');
      const settings = await loadSettings();
      const fredKey = settings.fredApiKey;
      if (!fredKey) {
        return jsonResponse(
          {
            error:
              'FRED API key not configured. Add one in Settings → Quant (free, 30-second signup).',
          },
          400
        );
      }
      const data = await computeYieldCurve(fredKey);
      cache.yieldCurve = { fetchedAt: Date.now(), data };
      await saveCache(cache);
      return cachedJsonResponse(
        req,
        { ...data, cached: false, fetchedAt: cache.yieldCurve.fetchedAt },
        CACHE.yieldCurve
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logQuant.warn('yield-curve failed:', msg);
      if (cache.yieldCurve) {
        return cachedJsonResponse(
          req,
          {
            ...cache.yieldCurve.data,
            cached: true,
            stale: true,
            fetchedAt: cache.yieldCurve.fetchedAt,
            fetchError: msg,
          },
          CACHE.yieldCurve
        );
      }
      return jsonResponse({ error: `Yield curve fetch failed: ${msg}` }, 502);
    }
  }

  // GET /api/quant/tradfi/sp500-risk-metric — monthly Cowen-style composite
  if (pathname === '/api/quant/tradfi/sp500-risk-metric' && req.method === 'GET') {
    const cache = await loadCache();
    if (isFresh(cache.sp500RiskMetric, TTL.sp500RiskMetric)) {
      return cachedJsonResponse(
        req,
        { ...cache.sp500RiskMetric!.data, cached: true },
        CACHE.sp500RiskMetric
      );
    }
    try {
      logQuant.info('sp500-risk-metric — computing fresh');
      const data = await computeSP500RiskMetric();
      cache.sp500RiskMetric = { fetchedAt: Date.now(), data };
      await saveCache(cache);
      return cachedJsonResponse(req, { ...data, cached: false }, CACHE.sp500RiskMetric);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logQuant.warn('sp500-risk-metric failed:', msg);
      if (cache.sp500RiskMetric) {
        return cachedJsonResponse(
          req,
          { ...cache.sp500RiskMetric.data, cached: true, stale: true, fetchError: msg },
          CACHE.sp500RiskMetric
        );
      }
      return jsonResponse({ error: `SP500 risk metric fetch failed: ${msg}` }, 502);
    }
  }

  // GET /api/quant/tradfi/midterm-drawdowns — historical midterm drawdown curves
  if (pathname === '/api/quant/tradfi/midterm-drawdowns' && req.method === 'GET') {
    const cache = await loadCache();
    if (isFresh(cache.midtermDrawdowns, TTL.midtermDrawdowns)) {
      return cachedJsonResponse(
        req,
        { ...cache.midtermDrawdowns!.data, cached: true },
        CACHE.midtermDrawdowns
      );
    }
    try {
      logQuant.info('midterm-drawdowns — computing fresh');
      const data = await computeMidtermDrawdowns();
      cache.midtermDrawdowns = { fetchedAt: Date.now(), data };
      await saveCache(cache);
      return cachedJsonResponse(req, { ...data, cached: false }, CACHE.midtermDrawdowns);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logQuant.warn('midterm-drawdowns failed:', msg);
      if (cache.midtermDrawdowns) {
        return cachedJsonResponse(
          req,
          { ...cache.midtermDrawdowns.data, cached: true, stale: true, fetchError: msg },
          CACHE.midtermDrawdowns
        );
      }
      return jsonResponse({ error: `Midterm drawdowns fetch failed: ${msg}` }, 502);
    }
  }

  // GET /api/quant/tradfi/shiller-valuation — CAPE + SP500 dividend yield
  if (pathname === '/api/quant/tradfi/shiller-valuation' && req.method === 'GET') {
    const cache = await loadCache();
    if (isFresh(cache.shillerValuation, TTL.shillerValuation)) {
      return cachedJsonResponse(
        req,
        {
          ...cache.shillerValuation!.data,
          cached: true,
          fetchedAt: cache.shillerValuation!.fetchedAt,
        },
        CACHE.shillerValuation
      );
    }
    try {
      logQuant.info('shiller-valuation — computing fresh');
      const data = await computeShillerValuation();
      cache.shillerValuation = { fetchedAt: Date.now(), data };
      await saveCache(cache);
      return cachedJsonResponse(
        req,
        { ...data, cached: false, fetchedAt: cache.shillerValuation.fetchedAt },
        CACHE.shillerValuation
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logQuant.warn('shiller-valuation failed:', msg);
      if (cache.shillerValuation) {
        return cachedJsonResponse(
          req,
          {
            ...cache.shillerValuation.data,
            cached: true,
            stale: true,
            fetchedAt: cache.shillerValuation.fetchedAt,
            fetchError: msg,
          },
          CACHE.shillerValuation
        );
      }
      return jsonResponse({ error: `Shiller valuation fetch failed: ${msg}` }, 502);
    }
  }

  // GET /api/quant/predictions — Kalshi + Polymarket finance/political odds
  if (pathname === '/api/quant/predictions' && req.method === 'GET') {
    const cache = await loadCache();
    if (isFresh(cache.predictions, TTL.predictions)) {
      return cachedJsonResponse(
        req,
        { ...cache.predictions!.data, cached: true },
        CACHE.predictions
      );
    }
    try {
      logQuant.info('predictions — computing fresh');
      const data = await fetchPredictionMarkets();
      cache.predictions = { fetchedAt: Date.now(), data };
      await saveCache(cache);
      return cachedJsonResponse(req, { ...data, cached: false }, CACHE.predictions);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logQuant.warn('predictions failed:', msg);
      if (cache.predictions) {
        return cachedJsonResponse(
          req,
          { ...cache.predictions.data, cached: true, stale: true, fetchError: msg },
          CACHE.predictions
        );
      }
      return jsonResponse({ error: `Predictions fetch failed: ${msg}` }, 502);
    }
  }

  // GET /api/quant/tradfi/sectors/rotation
  if (pathname === '/api/quant/tradfi/sectors/rotation' && req.method === 'GET') {
    const cache = await loadCache();
    if (isFresh(cache.sectorRotation, TTL.sectorRotation)) {
      return cachedJsonResponse(
        req,
        {
          ...cache.sectorRotation!.data,
          cached: true,
          fetchedAt: cache.sectorRotation!.fetchedAt,
        },
        CACHE.sectorRotation
      );
    }
    try {
      logQuant.info('sector-rotation — computing fresh');
      const data = await computeSectorRotation();
      cache.sectorRotation = { fetchedAt: Date.now(), data };
      await saveCache(cache);
      return cachedJsonResponse(
        req,
        { ...data, cached: false, fetchedAt: cache.sectorRotation.fetchedAt },
        CACHE.sectorRotation
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logQuant.warn('sector-rotation failed:', msg);
      if (cache.sectorRotation) {
        return cachedJsonResponse(
          req,
          {
            ...cache.sectorRotation.data,
            cached: true,
            stale: true,
            fetchedAt: cache.sectorRotation.fetchedAt,
            fetchError: msg,
          },
          CACHE.sectorRotation
        );
      }
      return jsonResponse({ error: `Sector rotation fetch failed: ${msg}` }, 502);
    }
  }

  // GET /api/quant/btc/altcoin-season — Altcoin Season Index
  if (pathname === '/api/quant/btc/altcoin-season' && req.method === 'GET') {
    const cache = await loadCache();
    if (isFresh(cache.altcoinSeason, TTL.altcoinSeason)) {
      return cachedJsonResponse(
        req,
        { ...cache.altcoinSeason!.data, cached: true },
        CACHE.altcoinSeason
      );
    }
    try {
      logQuant.info('altcoin-season — computing fresh');
      const data = await computeAltcoinSeasonIndex();
      cache.altcoinSeason = { fetchedAt: Date.now(), data };
      await saveCache(cache);
      return cachedJsonResponse(req, { ...data, cached: false }, CACHE.altcoinSeason);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logQuant.warn('altcoin-season failed:', msg);
      if (cache.altcoinSeason) {
        return cachedJsonResponse(
          req,
          { ...cache.altcoinSeason.data, cached: true, stale: true, fetchError: msg },
          CACHE.altcoinSeason
        );
      }
      return jsonResponse({ error: `Altcoin season fetch failed: ${msg}` }, 502);
    }
  }

  // GET /api/quant/btc/derivatives — OKX funding/OI/LS ratio
  if (pathname === '/api/quant/btc/derivatives' && req.method === 'GET') {
    const cache = await loadCache();
    if (isFresh(cache.btcDerivatives, TTL.btcDerivatives)) {
      return cachedJsonResponse(
        req,
        { ...cache.btcDerivatives!.data, cached: true },
        CACHE.btcDerivatives
      );
    }
    try {
      logQuant.info('btc-derivatives — computing fresh');
      const data = await computeBtcDerivatives();
      cache.btcDerivatives = { fetchedAt: Date.now(), data };
      await saveCache(cache);
      return cachedJsonResponse(req, { ...data, cached: false }, CACHE.btcDerivatives);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logQuant.warn('btc-derivatives failed:', msg);
      if (cache.btcDerivatives) {
        return cachedJsonResponse(
          req,
          { ...cache.btcDerivatives.data, cached: true, stale: true, fetchError: msg },
          CACHE.btcDerivatives
        );
      }
      return jsonResponse({ error: `BTC derivatives fetch failed: ${msg}` }, 502);
    }
  }

  // GET /api/quant/btc/dominance — CoinGecko /global
  if (pathname === '/api/quant/btc/dominance' && req.method === 'GET') {
    const cache = await loadCache();
    if (isFresh(cache.btcDominance, TTL.btcDominance)) {
      return cachedJsonResponse(
        req,
        { ...cache.btcDominance!.data, cached: true },
        CACHE.btcDominance
      );
    }
    try {
      logQuant.info('btc-dominance — computing fresh');
      const data = await fetchBtcDominance();
      cache.btcDominance = { fetchedAt: Date.now(), data };
      await saveCache(cache);
      return cachedJsonResponse(req, { ...data, cached: false }, CACHE.btcDominance);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logQuant.warn('btc-dominance failed:', msg);
      if (cache.btcDominance) {
        return cachedJsonResponse(
          req,
          { ...cache.btcDominance.data, cached: true, stale: true, fetchError: msg },
          CACHE.btcDominance
        );
      }
      return jsonResponse({ error: `BTC dominance fetch failed: ${msg}` }, 502);
    }
  }

  // GET /api/quant/btc/log-regression
  if (pathname === '/api/quant/btc/log-regression' && req.method === 'GET') {
    const cache = await loadCache();
    if (isFresh(cache.btcLogRegression, TTL.btcLogRegression)) {
      return cachedJsonResponse(
        req,
        {
          ...cache.btcLogRegression!.data,
          cached: true,
          fetchedAt: cache.btcLogRegression!.fetchedAt,
        },
        CACHE.btcLogRegression
      );
    }
    try {
      logQuant.info('btc-log-regression — computing fresh');
      const data = await computeBtcLogRegression();
      cache.btcLogRegression = { fetchedAt: Date.now(), data };
      await saveCache(cache);
      return cachedJsonResponse(
        req,
        { ...data, cached: false, fetchedAt: cache.btcLogRegression.fetchedAt },
        CACHE.btcLogRegression
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logQuant.warn('btc-log-regression failed:', msg);
      if (cache.btcLogRegression) {
        return cachedJsonResponse(
          req,
          {
            ...cache.btcLogRegression.data,
            cached: true,
            stale: true,
            fetchedAt: cache.btcLogRegression.fetchedAt,
            fetchError: msg,
          },
          CACHE.btcLogRegression
        );
      }
      return jsonResponse({ error: `BTC log regression fetch failed: ${msg}` }, 502);
    }
  }

  // GET /api/quant/btc/kronos — Kronos foundation-model forecast, scraped
  // from shiyu-coder.github.io/Kronos-demo (BTC/USDT 1h, 24h horizon).
  if (pathname === '/api/quant/btc/kronos' && req.method === 'GET') {
    const cache = await loadCache();
    if (isFresh(cache.kronos, TTL.kronos)) {
      return cachedJsonResponse(req, { ...cache.kronos!.data, cached: true }, CACHE.kronos);
    }
    try {
      logQuant.info('kronos — computing fresh');
      const data = await computeKronos();
      cache.kronos = { fetchedAt: Date.now(), data };
      await saveCache(cache);
      return cachedJsonResponse(req, { ...data, cached: false }, CACHE.kronos);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logQuant.warn('kronos failed:', msg);
      if (cache.kronos) {
        return cachedJsonResponse(
          req,
          { ...cache.kronos.data, cached: true, stale: true, fetchError: msg },
          CACHE.kronos
        );
      }
      return jsonResponse({ error: `Kronos forecast fetch failed: ${msg}` }, 502);
    }
  }

  return null;
}
