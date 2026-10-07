// Prediction-market client — live finance/political odds from Kalshi and
// Polymarket, normalized into one shape for the Predictions view, the
// /api/quant/predictions endpoint, and the chat `get_prediction_markets` tool.
//
// Both providers expose public, no-auth, read-only market data. The hard part
// is NOT the HTTP — it's curation. Both exchanges are dominated by sports,
// weather, and novelty markets, and even their "Economics"/"Politics" buckets
// carry junk ("Kai Cenat billionaire by 2030"). So the WATCHLIST below is the
// *sole includer* (precision over recall): a market only surfaces if its
// question matches a watchlist topic and dodges the EXCLUDE list. Tune those
// two lists to broaden/narrow coverage — same idea as the ZeroHedge job's
// WATCHLIST. Category/volume are only cheap pre-filters and ranking signals.
//
// Representation: one row per *event*, showing the current favorite (the
// highest-"Yes" market). This collapses multi-outcome events ("2028 nominee"
// with 128 candidate markets) into a single "… → leader X%" row on both sides.

import { createLogger } from './logger.js';

const log = createLogger('Predictions');

export type PredictionDomain = 'finance' | 'politics';
export type PredictionSource = 'kalshi' | 'polymarket';

export interface PredictionMarket {
  id: string;
  source: PredictionSource;
  question: string;
  /** 0–100, probability of the favorite "Yes" outcome. */
  probability: number;
  /** Rough USD. Polymarket reports USD directly; Kalshi is contracts × price
   *  (a proxy — the two providers' volume is not strictly comparable). */
  volumeUsd: number;
  liquidityUsd?: number;
  closeTime: string | null;
  url: string;
  domain: PredictionDomain;
  topic: string;
  /** 24h move of the favorite, in percentage points (may be null). */
  change24h?: number | null;
}

/** Structural normalization shared by both providers; domain/topic are assigned
 *  later from the watchlist match. */
type NormalizedMarket = Omit<PredictionMarket, 'domain' | 'topic'>;

export interface PredictionMarketsResponse {
  finance: PredictionMarket[];
  politics: PredictionMarket[];
  fetchedAt: string;
  sources: { kalshi: boolean; polymarket: boolean };
  errors?: string[];
}

// ---------------------------------------------------------------------------
// Curation — tune these two lists to control what shows up.
// ---------------------------------------------------------------------------

interface WatchEntry {
  topic: string;
  domain: PredictionDomain;
  keywords: string[];
}

export const PREDICTION_WATCHLIST: WatchEntry[] = [
  // --- Finance ---
  {
    topic: 'Fed & rates',
    domain: 'finance',
    keywords: [
      'fed',
      'fomc',
      'rate cut',
      'rate hike',
      'interest rate',
      'federal funds',
      'powell',
      'basis points',
      'fed chair',
    ],
  },
  {
    topic: 'Inflation',
    domain: 'finance',
    keywords: ['inflation', 'cpi', 'pce', 'ppi', 'deflation'],
  },
  {
    topic: 'Recession & growth',
    domain: 'finance',
    keywords: [
      'recession',
      'gdp',
      'unemployment',
      'jobless',
      'soft landing',
      'nonfarm',
      'payrolls',
    ],
  },
  {
    topic: 'Equities',
    domain: 'finance',
    keywords: [
      's&p 500',
      'sp500',
      'nasdaq',
      'dow jones',
      'stock market',
      'all-time high',
      'all time high',
    ],
  },
  {
    topic: 'Crypto',
    domain: 'finance',
    keywords: [
      'bitcoin',
      'btc',
      'ethereum',
      'eth',
      'crypto',
      'microstrategy',
      'solana',
      'stablecoin',
      'strategy sells',
    ],
  },
  {
    topic: 'IPOs & companies',
    domain: 'finance',
    keywords: ['ipo', 'openai', 'anthropic', 'stripe', 'spacex', 'databricks', 'go public'],
  },
  {
    topic: 'Commodities',
    domain: 'finance',
    keywords: ['oil price', 'crude', 'wti', 'gold price', 'opec', 'natural gas'],
  },
  // --- Politics ---
  {
    topic: 'Congress & control',
    domain: 'politics',
    keywords: ['the house', 'the senate', 'congress', 'midterm', 'speaker of'],
  },
  {
    topic: 'Elections',
    domain: 'politics',
    keywords: [
      'election',
      'nominee',
      'nomination',
      'presidential',
      'primary',
      'governor',
      'electoral',
    ],
  },
  {
    topic: 'Government & fiscal',
    domain: 'politics',
    keywords: ['shutdown', 'debt ceiling', 'government funding', 'federal budget', 'default'],
  },
  {
    topic: 'Policy',
    domain: 'politics',
    keywords: [
      'tariff',
      'trade war',
      'executive order',
      'supreme court',
      'impeach',
      'sanction',
      'deportation',
    ],
  },
  {
    topic: 'Geopolitics',
    domain: 'politics',
    keywords: [
      'ukraine',
      'russia',
      'china',
      'taiwan',
      'israel',
      'iran',
      'gaza',
      'nato',
      'ceasefire',
      'north korea',
      'venezuela',
      'peace deal',
    ],
  },
  {
    topic: 'Leadership',
    domain: 'politics',
    keywords: ['prime minister', 'resign', 'cabinet', 'dnc chair', 'leave office'],
  },
];

export const PREDICTION_EXCLUDE: string[] = [
  // sports
  'nfl',
  'nba',
  'mlb',
  'nhl',
  'super bowl',
  'world cup',
  'fifa',
  'uefa',
  'premier league',
  'champions league',
  'playoff',
  'world series',
  'stanley cup',
  'ncaa',
  'olympic',
  'grand prix',
  'formula 1',
  'golf',
  'tennis',
  'ufc',
  'boxing',
  'wimbledon',
  'nascar',
  'super bowl',
  'finals',
  // weather
  'temperature',
  'high temp',
  'rainfall',
  'snowfall',
  'hurricane',
  // novelty / entertainment
  'jesus',
  'alien',
  'rapture',
  'person of the year',
  'person of the decade',
  'grammy',
  'oscar',
  'emmy',
  'box office',
  'rotten tomatoes',
  'taylor swift',
  'kanye',
  'mrbeast',
  'kai cenat',
  'billionaire before',
  'trillionaire',
  'time magazine',
];

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested in prediction-markets.test.ts)
// ---------------------------------------------------------------------------

function matchKeyword(lowerText: string, keyword: string): boolean {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return false;
  // Phrases / keywords with non-alphanumerics: plain substring match.
  if (/[^a-z0-9]/.test(kw)) return lowerText.includes(kw);
  // Single tokens: word-boundary match so "fed" doesn't hit "federal".
  return new RegExp(`\\b${kw}\\b`).test(lowerText);
}

/** First watchlist topic whose keyword appears in `text`, or null. EXCLUDE
 *  wins: an excluded phrase drops the market even if it also matches. */
export function matchesWatchlist(text: string): { domain: PredictionDomain; topic: string } | null {
  const t = (text || '').toLowerCase();
  if (!t) return null;
  for (const ex of PREDICTION_EXCLUDE) {
    if (t.includes(ex)) return null;
  }
  for (const entry of PREDICTION_WATCHLIST) {
    for (const kw of entry.keywords) {
      if (matchKeyword(t, kw)) return { domain: entry.domain, topic: entry.topic };
    }
  }
  return null;
}

/** Drop intra-provider duplicates only (key `source:id`). We deliberately do
 *  NOT merge the same question across providers — wording and resolution
 *  criteria differ, and showing both lets the reader compare Kalshi vs
 *  Polymarket odds on the same event. */
export function dedupeMarkets(markets: PredictionMarket[]): PredictionMarket[] {
  const seen = new Set<string>();
  const out: PredictionMarket[] = [];
  for (const m of markets) {
    const key = `${m.source}:${m.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

export function kalshiMarketUrl(ticker: string): string {
  // Kalshi's API returns no web URL, so we build one from the series ticker
  // (e.g. "KXFEDDECISION" → kalshi.com/markets/kxfeddecision). Prefers a
  // series_ticker; given an event_ticker we strip the "-suffix" as a fallback.
  const series = (ticker.split('-')[0] || ticker).toLowerCase();
  return `https://kalshi.com/markets/${series}`;
}

export function polymarketUrl(ev: { slug?: string; markets?: { slug?: string }[] }): string {
  if (ev.slug) return `https://polymarket.com/event/${ev.slug}`;
  const ms = ev.markets?.[0]?.slug;
  return ms ? `https://polymarket.com/market/${ms}` : 'https://polymarket.com';
}

function toNum(s: string | number | undefined | null): number {
  if (s == null || s === '') return NaN;
  const n = typeof s === 'number' ? s : Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ---- Kalshi ----------------------------------------------------------------

interface KalshiMarket {
  ticker?: string;
  yes_sub_title?: string;
  last_price_dollars?: string;
  yes_bid_dollars?: string;
  yes_ask_dollars?: string;
  previous_yes_bid_dollars?: string;
  volume_24h_fp?: string;
  volume_fp?: string;
  open_interest_fp?: string;
  status?: string;
  close_time?: string;
}

interface KalshiEvent {
  event_ticker: string;
  series_ticker?: string;
  category: string;
  title: string;
  sub_title?: string;
  markets?: KalshiMarket[];
}

/** "Yes" price of a Kalshi market in dollars (0–1): last trade if it has one,
 *  else the bid/ask midpoint. Null when the market has no usable price. */
function kalshiYesPrice(m: KalshiMarket): number | null {
  const last = toNum(m.last_price_dollars);
  if (Number.isFinite(last) && last > 0) return last;
  const bid = toNum(m.yes_bid_dollars);
  const ask = toNum(m.yes_ask_dollars);
  if (Number.isFinite(bid) && Number.isFinite(ask) && (bid > 0 || ask > 0)) return (bid + ask) / 2;
  if (Number.isFinite(ask) && ask > 0) return ask;
  return null;
}

export function normalizeKalshiEvent(ev: KalshiEvent): NormalizedMarket | null {
  const markets = (ev.markets ?? []).filter((m) => m.status === 'active');
  if (markets.length === 0) return null;

  let fav: KalshiMarket | null = null;
  let favPrice = -1;
  let volumeContracts = 0;
  for (const m of markets) {
    const v24 = toNum(m.volume_24h_fp);
    const oi = toNum(m.open_interest_fp);
    volumeContracts += Math.max(Number.isFinite(v24) ? v24 : 0, Number.isFinite(oi) ? oi : 0);
    const p = kalshiYesPrice(m);
    if (p != null && p > favPrice) {
      favPrice = p;
      fav = m;
    }
  }
  if (!fav || favPrice < 0) return null;

  const multi = markets.length > 1;
  const favLabel = (fav.yes_sub_title ?? '').trim();
  const question = multi && favLabel ? `${ev.title} — ${favLabel}` : ev.title;

  const prevBid = toNum(fav.previous_yes_bid_dollars);
  const change24h = Number.isFinite(prevBid) ? round1((favPrice - prevBid) * 100) : null;

  return {
    id: ev.event_ticker,
    source: 'kalshi',
    question,
    probability: round1(favPrice * 100),
    // Contracts → rough USD via the favorite's price (each contract settles $0–1).
    volumeUsd: Math.round(volumeContracts * favPrice),
    closeTime: fav.close_time ?? null,
    url: kalshiMarketUrl(ev.series_ticker ?? ev.event_ticker),
    change24h,
  };
}

// ---- Polymarket ------------------------------------------------------------

interface PolymarketMarket {
  id?: string;
  slug?: string;
  question?: string;
  groupItemTitle?: string;
  outcomes?: string;
  outcomePrices?: string;
  volumeNum?: number;
  oneDayPriceChange?: number | null;
  endDate?: string;
}

interface PolymarketEvent {
  id?: string;
  title?: string;
  slug?: string;
  volume?: number;
  liquidity?: number;
  endDate?: string;
  closed?: boolean;
  markets?: PolymarketMarket[];
}

/** Probability (0–1) of the "Yes" outcome from Polymarket's stringified
 *  `outcomes`/`outcomePrices` arrays. Binary Yes/No only — returns null for
 *  multi-outcome markets or when there's no "Yes" label (ordering is NOT
 *  guaranteed to be [Yes, No], so we locate "Yes" rather than trusting index 0). */
export function parsePolymarketOutcomePrices(
  outcomesJson?: string,
  pricesJson?: string
): number | null {
  let outcomes: unknown;
  let prices: unknown;
  try {
    outcomes = JSON.parse(outcomesJson ?? '');
    prices = JSON.parse(pricesJson ?? '');
  } catch {
    return null;
  }
  if (!Array.isArray(outcomes) || !Array.isArray(prices)) return null;
  if (outcomes.length !== 2 || prices.length !== 2) return null;
  const idx = outcomes.findIndex((o) => String(o).trim().toLowerCase() === 'yes');
  if (idx < 0) return null;
  const p = Number(prices[idx]);
  if (!Number.isFinite(p) || p < 0 || p > 1) return null;
  return p;
}

export function normalizePolymarketEvent(ev: PolymarketEvent): NormalizedMarket | null {
  const markets = ev.markets ?? [];
  if (markets.length === 0) return null;

  let fav: PolymarketMarket | null = null;
  let favProb = -1;
  for (const m of markets) {
    const p = parsePolymarketOutcomePrices(m.outcomes, m.outcomePrices);
    if (p != null && p > favProb) {
      favProb = p;
      fav = m;
    }
  }
  if (!fav || favProb < 0) return null;

  const title = (ev.title ?? fav.question ?? '').trim();
  if (!title) return null;
  const multi = markets.length > 1;
  const favLabel = (fav.groupItemTitle ?? '').trim();
  const question = multi && favLabel ? `${title} — ${favLabel}` : fav.question?.trim() || title;

  const change24h =
    typeof fav.oneDayPriceChange === 'number' ? round1(fav.oneDayPriceChange * 100) : null;

  return {
    id: ev.id ?? ev.slug ?? fav.id ?? title,
    source: 'polymarket',
    question,
    probability: round1(favProb * 100),
    volumeUsd: Math.round(toNum(ev.volume ?? fav.volumeNum ?? 0) || 0),
    liquidityUsd: ev.liquidity != null ? Math.round(ev.liquidity) : undefined,
    closeTime: ev.endDate ?? fav.endDate ?? null,
    url: polymarketUrl(ev),
    change24h,
  };
}

// ---------------------------------------------------------------------------
// Network fetch + orchestration
// ---------------------------------------------------------------------------

const KALSHI_BASE = 'https://api.elections.kalshi.com/trade-api/v2';
const POLY_BASE = 'https://gamma-api.polymarket.com';
const KALSHI_CATEGORIES = new Set([
  'Politics',
  'Elections',
  'Economics',
  'Financials',
  'Companies',
  'World',
]);
const CAP_PER_DOMAIN = 30;
const FETCH_TIMEOUT_MS = 8000;
const USER_AGENT = 'DocVault/1.0 (+https://github.com/vanities/docvault)';

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

/** Kalshi has no volume ordering, so we page through `status=open` events and
 *  keep only finance/political categories. maxPages bounds the work. */
async function fetchKalshiEvents(maxPages = 3): Promise<NormalizedMarket[]> {
  const out: NormalizedMarket[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const u = new URL(`${KALSHI_BASE}/events`);
    u.searchParams.set('status', 'open');
    u.searchParams.set('with_nested_markets', 'true');
    u.searchParams.set('limit', '200');
    if (cursor) u.searchParams.set('cursor', cursor);
    const data = await fetchJson<{ events?: KalshiEvent[]; cursor?: string }>(u.toString());
    const events = data.events ?? [];
    for (const ev of events) {
      if (!KALSHI_CATEGORIES.has(ev.category)) continue;
      const n = normalizeKalshiEvent(ev);
      if (n) out.push(n);
    }
    cursor = data.cursor || undefined;
    if (!cursor || events.length === 0) break;
  }
  return out;
}

/** Polymarket events ordered by volume — the high-signal questions come first,
 *  and the watchlist/EXCLUDE drop the sports/novelty events that ride along. */
async function fetchPolymarketEvents(maxPages = 3, pageSize = 100): Promise<NormalizedMarket[]> {
  const out: NormalizedMarket[] = [];
  for (let page = 0; page < maxPages; page++) {
    const u = new URL(`${POLY_BASE}/events`);
    u.searchParams.set('closed', 'false');
    u.searchParams.set('order', 'volume');
    u.searchParams.set('ascending', 'false');
    u.searchParams.set('limit', String(pageSize));
    u.searchParams.set('offset', String(page * pageSize));
    const events = await fetchJson<PolymarketEvent[]>(u.toString());
    if (!Array.isArray(events) || events.length === 0) break;
    for (const ev of events) {
      const n = normalizePolymarketEvent(ev);
      if (n) out.push(n);
    }
    if (events.length < pageSize) break;
  }
  return out;
}

function msgOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Pick the markets for one domain, interleaving the two providers. Their
 *  volume units aren't comparable (Polymarket = cumulative USD, Kalshi =
 *  contracts × price), so a raw cross-provider sort would always bury Kalshi.
 *  Instead we sort each provider by its own volume and alternate — Polymarket
 *  first (deeper markets) — so both stay visible up top. */
function selectForDomain(all: PredictionMarket[], domain: PredictionDomain): PredictionMarket[] {
  const byVolume = (a: PredictionMarket, b: PredictionMarket) => b.volumeUsd - a.volumeUsd;
  const inDomain = all.filter((m) => m.domain === domain);
  const poly = inDomain.filter((m) => m.source === 'polymarket').sort(byVolume);
  const kalshi = inDomain.filter((m) => m.source === 'kalshi').sort(byVolume);
  const out: PredictionMarket[] = [];
  for (let i = 0; out.length < CAP_PER_DOMAIN && (i < poly.length || i < kalshi.length); i++) {
    if (i < poly.length) out.push(poly[i]);
    if (i < kalshi.length && out.length < CAP_PER_DOMAIN) out.push(kalshi[i]);
  }
  return out;
}

/** Fetch + curate + normalize Kalshi and Polymarket into finance/politics
 *  buckets. Resilient: one provider failing still returns the other's data
 *  with the failure noted in `errors`. */
export async function fetchPredictionMarkets(): Promise<PredictionMarketsResponse> {
  const [kRes, pRes] = await Promise.allSettled([fetchKalshiEvents(), fetchPolymarketEvents()]);

  const errors: string[] = [];
  const normalized: NormalizedMarket[] = [];
  let kalshiOk = false;
  let polymarketOk = false;

  if (kRes.status === 'fulfilled') {
    normalized.push(...kRes.value);
    kalshiOk = true;
  } else {
    errors.push(`kalshi: ${msgOf(kRes.reason)}`);
  }
  if (pRes.status === 'fulfilled') {
    normalized.push(...pRes.value);
    polymarketOk = true;
  } else {
    errors.push(`polymarket: ${msgOf(pRes.reason)}`);
  }

  const matched: PredictionMarket[] = [];
  for (const n of normalized) {
    if (n.volumeUsd <= 0) continue; // drop dead/illiquid markets
    const hit = matchesWatchlist(n.question);
    if (!hit) continue;
    matched.push({ ...n, domain: hit.domain, topic: hit.topic });
  }

  const deduped = dedupeMarkets(matched);
  const finance = selectForDomain(deduped, 'finance');
  const politics = selectForDomain(deduped, 'politics');

  log.info(
    `predictions — finance=${finance.length} politics=${politics.length} ` +
      `(kalshi=${kalshiOk} polymarket=${polymarketOk}${errors.length ? `, errors=${errors.length}` : ''})`
  );

  const res: PredictionMarketsResponse = {
    finance,
    politics,
    fetchedAt: new Date().toISOString(),
    sources: { kalshi: kalshiOk, polymarket: polymarketOk },
  };
  if (errors.length) res.errors = errors;
  return res;
}
