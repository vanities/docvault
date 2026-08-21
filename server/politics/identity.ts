// Trade normalization for cross-member analysis — the two identity problems
// that quietly corrupt consensus detection on real filing data.
//
// 1. MEMBER IDENTITY. The same person files under different name renderings
//    ("Hon. John McGuire" vs "Hon. John J Mr McGuire III"). Counting raw name
//    strings makes one member look like two, which manufactures consensus that
//    isn't there — the exact signal we most need to be right about.
//
// 2. TICKER RECOVERY. The Senate feed frequently leaves `ticker` null and puts
//    the symbol at the END of the asset name ("Vaneck ETF Tr Gold Miners GDX").
//    Cluster detection requires a ticker, so those positions — often sector ETFs
//    like defense or gold miners, which is precisely the rotation story worth
//    seeing — were invisible to it.
//
// Pure + deterministic, no I/O, so it unit-tests cleanly.

import type { TradeRecord } from './types.js';

// --- Member identity ---------------------------------------------------------

const TITLES = /\b(hon|rep|representative|sen|senator|mr|mrs|ms|dr)\b/g;
const SUFFIXES = /\b(jr|sr|ii|iii|iv|v)\b/g;

/** Collapse a filer name to a stable first+last identity key. Titles, suffixes,
 *  middle names/initials and punctuation are all dropped, so every rendering of
 *  one member maps to the same key. Distinct members sharing a first AND last
 *  name would collide, which is vanishingly rare in a 127-name chamber roster
 *  and far less damaging than splitting one member into two. */
export function politicianIdentityKey(name: string): string {
  const tokens = name
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(TITLES, ' ')
    .replace(SUFFIXES, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (tokens.length === 0) return '';
  if (tokens.length === 1) return tokens[0];
  return `${tokens[0]} ${tokens[tokens.length - 1]}`;
}

/** Pick the display name for a member from the variants seen in the data:
 *  most frequent wins, then shortest (the cleanest rendering), then
 *  lexicographic so the choice is fully deterministic. */
export function canonicalPoliticianName(variants: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const v of variants) {
    // Trailing separators survive the source parsers ("Jerry Moran,") and would
    // otherwise be printed. Internal periods are left alone — they belong to
    // titles and middle initials ("Hon. James A. Himes").
    const name = v
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[,;:]+$/, '')
      .trim();
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  let best = '';
  let bestCount = -1;
  for (const [name, count] of counts) {
    if (
      count > bestCount ||
      (count === bestCount &&
        (name.length < best.length || (name.length === best.length && name < best)))
    ) {
      best = name;
      bestCount = count;
    }
  }
  return best;
}

// --- Ticker recovery ---------------------------------------------------------

/** All-caps tokens that trail fund/issuer names but are NOT symbols. */
const NOT_A_TICKER = new Set([
  'LP',
  'LLC',
  'INC',
  'CORP',
  'CO',
  'TR',
  'ETF',
  'FD',
  'FDS',
  'SER',
  'ADR',
  'CL',
  'NA',
  'MAT',
  'DEP',
  'CTF',
  'BK',
  'GO',
  'USD',
  'ACT',
  'REIT',
  'PLC',
  'LTD',
  'COM',
  'PFD',
  'CD',
  'NV',
  'SA',
  'AG',
  'US',
  'UTX',
  'INT',
  'RATE',
  'BDS',
  'ETN',
]);

/** A plausible listed symbol: 2–5 letters, optionally a single dotted class
 *  suffix (BRK.B). One- and six-plus-letter tails are too noisy to trust. */
const TICKER_SHAPE = /^[A-Z]{2,5}(\.[A-Z])?$/;

/** Recover a symbol from the tail of an asset name, or null when the tail isn't
 *  confidently a ticker. Deliberately conservative — a wrong symbol would forge
 *  a consensus cluster, which is worse than missing one. */
export function tickerFromAssetName(assetName: string | null | undefined): string | null {
  if (!assetName) return null;
  const tokens = assetName.trim().split(/\s+/);
  const tail = tokens[tokens.length - 1];
  if (!tail || tokens.length < 2) return null;
  if (!TICKER_SHAPE.test(tail)) return null;
  if (NOT_A_TICKER.has(tail.replace(/\..*$/, ''))) return null;
  return tail;
}

/** The trade's symbol — the parsed field when the source populated it, else one
 *  recovered from the asset name. */
export function resolveTradeTicker(t: TradeRecord): string | null {
  if (t.ticker && t.ticker.trim()) return t.ticker.trim().toUpperCase();
  return tickerFromAssetName(t.assetName);
}

// --- Combined normalization --------------------------------------------------

/** Return the trade set with member names canonicalized and missing tickers
 *  recovered, so downstream cross-member analysis (clustering, member counts)
 *  sees one identity per person and every symbol the filings actually name.
 *  Non-mutating: originals are left untouched. */
export function normalizeTradesForAnalysis(trades: readonly TradeRecord[]): TradeRecord[] {
  // Group every observed name rendering under its identity key, then pick one
  // canonical display name per member.
  const variants = new Map<string, string[]>();
  for (const t of trades) {
    const key = politicianIdentityKey(t.politicianName);
    const bucket = variants.get(key);
    if (bucket) bucket.push(t.politicianName);
    else variants.set(key, [t.politicianName]);
  }
  const canonical = new Map<string, string>();
  for (const [key, names] of variants) canonical.set(key, canonicalPoliticianName(names));

  return trades.map((t) => {
    const key = politicianIdentityKey(t.politicianName);
    const name = canonical.get(key) ?? t.politicianName;
    const ticker = resolveTradeTicker(t);
    if (name === t.politicianName && ticker === t.ticker) return t;
    return { ...t, politicianName: name, ticker };
  });
}
