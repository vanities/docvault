// Quant server/client cache policy constants. Keep TTL and browser cache settings together
// so route dispatch can stay focused on request handling.

const DAY_MS = 86_400_000;
export const TTL = {
  presidentialCycle: 7 * DAY_MS, // monthly data — weekly refresh is plenty
  btcLogRegression: DAY_MS, // daily refresh
  sectorRotation: DAY_MS, // daily refresh (sector ETFs are end-of-day)
  shillerValuation: 7 * DAY_MS, // Shiller updates monthly; weekly refresh is plenty
  yieldCurve: DAY_MS, // FRED updates daily on business days
  btcDominance: 6 * 60 * 60 * 1000, // 6h — dominance changes slowly
  macroDashboard: DAY_MS, // FRED updates once per business day
  midtermDrawdowns: 7 * DAY_MS, // Shiller monthly — weekly refresh
  sp500RiskMetric: 7 * DAY_MS, // Shiller monthly — weekly refresh
  btcDerivatives: 30 * 60 * 1000, // 30 min — funding rate updates 3x/day
  altcoinSeason: 6 * 60 * 60 * 1000, // 6h — 90d return doesn't shift much hour-to-hour
  jobsDashboard: DAY_MS, // FRED labor data updates monthly
  fedPolicy: DAY_MS, // target range only moves on FOMC meetings
  businessCycle: DAY_MS, // monthly business cycle data
  inflation: DAY_MS, // monthly CPI/PCE/PPI releases
  financialConditions: DAY_MS, // weekly Fed stress indices
  btcDrawdown: 6 * 60 * 60 * 1000, // follows cached BTC prices
  fearGreed: 60 * 60 * 1000, // alternative.me updates daily, 1h cache
  flippening: 6 * 60 * 60 * 1000, // ETH/BTC ratio — follows cached prices
  realRates: DAY_MS, // FRED daily release for yields + breakevens
  hashRate: DAY_MS, // blockchain.info daily hash rate
  runningRoi: DAY_MS, // derived from cached BTC + Shiller
  housing: DAY_MS, // FRED housing indicators, monthly
  gdpGrowth: DAY_MS, // FRED GDP + growth series
  commodities: DAY_MS, // yahoo futures tickers
  vixTermStructure: 6 * 60 * 60 * 1000, // yahoo VIX variants
  globalMarkets: DAY_MS, // yahoo international indices
  kronos: 60 * 60 * 1000, // shiyu-coder Kronos demo refreshes hourly
  predictions: 30 * 60 * 1000, // Kalshi + Polymarket odds — 30 min cache
  macroCalendar: DAY_MS, // latest FOMC/CPI/NFP prints move monthly at most
};

export const CACHE = {
  // Presidential cycle data only changes monthly; browser can hold it for 6h.
  presidentialCycle: { maxAge: 6 * 3600, swr: 24 * 3600 },
  // BTC regression updates daily at the server; browser 1h + SWR 12h is snappy.
  btcLogRegression: { maxAge: 3600, swr: 12 * 3600 },
  // Sector rotation uses EOD data — 1h browser cache + 12h SWR.
  sectorRotation: { maxAge: 3600, swr: 12 * 3600 },
  // Shiller valuation is monthly data — 6h cache + 24h SWR.
  shillerValuation: { maxAge: 6 * 3600, swr: 24 * 3600 },
  // Yield curve FRED data updates daily on business days — 1h cache + 12h SWR.
  yieldCurve: { maxAge: 3600, swr: 12 * 3600 },
  // BTC dominance is low-frequency — 30min cache + 6h SWR.
  btcDominance: { maxAge: 30 * 60, swr: 6 * 3600 },
  // Macro dashboard = aggregated FRED series — 1h + 12h SWR.
  macroDashboard: { maxAge: 3600, swr: 12 * 3600 },
  // Midterm drawdowns = monthly Shiller data — 6h + 24h SWR.
  midtermDrawdowns: { maxAge: 6 * 3600, swr: 24 * 3600 },
  // SP500 risk metric = monthly composite — 6h + 24h SWR.
  sp500RiskMetric: { maxAge: 6 * 3600, swr: 24 * 3600 },
  // BTC derivatives = OKX funding/OI — 10 min + 2h SWR.
  btcDerivatives: { maxAge: 600, swr: 2 * 3600 },
  // Altcoin season = 90d returns via yahoo — 2h + 12h SWR.
  altcoinSeason: { maxAge: 2 * 3600, swr: 12 * 3600 },
  // Jobs dashboard — 2h + 12h SWR.
  jobsDashboard: { maxAge: 2 * 3600, swr: 12 * 3600 },
  // Fed policy — 2h + 24h SWR (target moves only on FOMC meetings).
  fedPolicy: { maxAge: 2 * 3600, swr: 24 * 3600 },
  // Business cycle — 2h + 12h SWR (monthly releases, staggered).
  businessCycle: { maxAge: 2 * 3600, swr: 12 * 3600 },
  // Inflation dashboard — 2h + 12h SWR (CPI/PCE monthly, WALCL weekly).
  inflation: { maxAge: 2 * 3600, swr: 12 * 3600 },
  // Financial conditions — 2h + 12h SWR (FRED weekly releases).
  financialConditions: { maxAge: 2 * 3600, swr: 12 * 3600 },
  // BTC drawdown — 1h + 6h SWR, derived from cached BTC history.
  btcDrawdown: { maxAge: 3600, swr: 6 * 3600 },
  // Fear & Greed — 30m + 6h SWR, alternative.me updates daily.
  fearGreed: { maxAge: 30 * 60, swr: 6 * 3600 },
  // Flippening (ETH/BTC ratio) — 1h + 6h SWR.
  flippening: { maxAge: 3600, swr: 6 * 3600 },
  // Real interest rates — 2h + 12h SWR (FRED daily yields).
  realRates: { maxAge: 2 * 3600, swr: 12 * 3600 },
  // Hash rate — 4h + 24h SWR (blockchain.info updates daily).
  hashRate: { maxAge: 4 * 3600, swr: 24 * 3600 },
  // Running ROI — derived, no upstream fetch cost. 2h + 12h SWR.
  runningRoi: { maxAge: 2 * 3600, swr: 12 * 3600 },
  // Housing — monthly FRED releases, 2h + 12h SWR.
  housing: { maxAge: 2 * 3600, swr: 12 * 3600 },
  // GDP & Growth — quarterly FRED releases, 2h + 12h SWR.
  gdpGrowth: { maxAge: 2 * 3600, swr: 12 * 3600 },
  // Commodities — yahoo futures EOD, 1h + 12h SWR.
  commodities: { maxAge: 3600, swr: 12 * 3600 },
  // VIX Term Structure — yahoo EOD, 1h + 12h SWR.
  vixTermStructure: { maxAge: 3600, swr: 12 * 3600 },
  // Global Markets — yahoo international indices, 2h + 12h SWR.
  globalMarkets: { maxAge: 2 * 3600, swr: 12 * 3600 },
  // Kronos forecast — upstream is hourly; 30m browser cache + 6h SWR keeps the
  // panel snappy without hammering shiyu-coder's GitHub Pages.
  kronos: { maxAge: 30 * 60, swr: 6 * 3600 },
  // Prediction markets — 15m browser cache + 30m SWR (server TTL is 30m).
  predictions: { maxAge: 900, swr: 1800 },
  // Macro calendar — latest realized prints, monthly cadence. 2h + 24h SWR.
  macroCalendar: { maxAge: 2 * 3600, swr: 24 * 3600 },
  // Snapshots grow one row per day; short cache so new snapshots appear fast.
  snapshots: { maxAge: 300, swr: 3600 },
};
