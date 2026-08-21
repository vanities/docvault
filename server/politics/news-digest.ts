// Politics trade digest — turns the raw PTR/278-T firehose into the RANKED,
// TIERED material the Daily News editor can actually lead a desk with.
//
// The problem this solves: the newspaper used to receive one identical line per
// disclosed transaction, so a $1,001 Treasury bill sat at the same weight as
// eight members buying the same chip stock in three weeks. Nothing told the
// editor what was notable, so nothing read as notable.
//
// Three tiers, in the order the desk should lead with them:
//   1. CONSENSUS — clusters (./clusters.ts) with at least one newly-disclosed
//      trade. Several members, same ticker, same direction. This is the signal.
//   2. NOTABLE — the largest / most copyable individual trades not already
//      accounted for by a consensus line.
//   3. TAIL — everything else collapsed into a single counting sentence, so the
//      volume is still reported without drowning the first two tiers.
//
// Plus STANDING COVERAGE: PTRs arrive in bursts, so a strict 24h window empties
// on quiet days and the whole Politics desk used to vanish from the edition.
// When the fresh window is empty we widen to a rolling view and LABEL it, so the
// desk always has material and the editor knows it isn't breaking news.
//
// Pure + deterministic (no I/O, no clock — `today` is passed in) so it unit-tests
// cleanly, same contract as clusters.ts.

import { detectTradeClusters } from './clusters.js';
import { normalizeTradesForAnalysis, politicianIdentityKey } from './identity.js';
import { formatOptionLabel } from './option-description.js';
import type { TradeRecord } from './types.js';

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// --- Asset classification ----------------------------------------------------

/** Asset classes worth differentiating. Fixed income is the noise floor: bills,
 *  CDs, municipal and corporate bonds dominate the raw feed by count and are
 *  almost never the story a reader wants led with. */
export type TradeAssetClass = 'option' | 'equity' | 'fixed-income' | 'other';

/** House PTR asset-type codes and Senate eFD labels that mean "fixed income". */
const FIXED_INCOME_TYPES = new Set([
  'GS', // government securities (T-bills, notes, agency paper)
  'CS', // corporate securities / notes
  'CT', // certificates of deposit
  'Corporate Bond',
  'Municipal Security',
]);

const EQUITY_TYPES = new Set(['ST', 'Stock', 'PS', 'Non-Public Stock']);

/** Last-resort name sniff for rows that carry no asset-type code at all — the
 *  bank-CD and muni-bond descriptions that make up most of the untyped tail. */
const FIXED_INCOME_NAME =
  /\b(treasur|tres\b|t-bill|bill int|ctf dep|cert.*of dep|municipal|muni\b|water\s*&?\s*swr|sewer|revenue bond|go bds|go utx)/i;

/** Classify a trade's underlying. Order matters: an explicit option contract or
 *  type code wins, then the filer's own type code, then a name sniff, then the
 *  mere presence of a ticker. */
export function classifyTradeAsset(t: TradeRecord): TradeAssetClass {
  if (t.option) return 'option';
  const type = (t.assetType ?? '').trim();
  if (/option/i.test(type) || type === 'OP') return 'option';
  if (FIXED_INCOME_TYPES.has(type)) return 'fixed-income';
  if (EQUITY_TYPES.has(type)) return 'equity';
  if (FIXED_INCOME_NAME.test(t.assetName ?? '')) return 'fixed-income';
  if (t.ticker) return 'equity';
  return 'other';
}

/** Newsworthiness of a single disclosed trade — bigger is more notable.
 *  Deliberately simple and explainable: dollar size dominates on a log scale
 *  (disclosure bands are exponential), with bumps for the detail that makes a
 *  trade actually copyable — a real ticker, and a parsed option contract.
 *  Fixed income and unidentifiable assets score 0 and fall to the tail. */
export function tradeNotability(t: TradeRecord): number {
  const cls = classifyTradeAsset(t);
  if (cls === 'fixed-income' || cls === 'other') return 0;
  const dollars = t.amountMax ?? t.amountMin ?? 0;
  const size = dollars > 0 ? Math.log10(dollars) : 0; // $1k → 3, $25M → 7.4
  return size + (cls === 'option' ? 1.5 : 0) + (t.ticker ? 0.5 : 0);
}

/** The date a trade became PUBLIC — the filing date when known, else the trade
 *  date. This, not `tradeDate`, is what "new this edition" means: a trade made
 *  six weeks ago is news on the day its PTR lands. */
export function disclosureDate(t: TradeRecord): string | null {
  const d = t.filingDate ?? t.tradeDate;
  return d && ISO_DATE.test(d) ? d : null;
}

// --- Formatting --------------------------------------------------------------

function daysBefore(today: string, days: number): string {
  return new Date(Date.parse(`${today}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);
}

function usd(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

function usdRange(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null;
  if (min != null && max != null) return min === max ? usd(min) : `${usd(min)}–${usd(max)}`;
  return usd((min ?? max) as number);
}

/** "house" → "House", "executive" → "executive branch" — for prose. */
function chamberLabel(chamber: string): string {
  if (chamber === 'house') return 'House';
  if (chamber === 'senate') return 'Senate';
  if (chamber === 'executive') return 'executive branch';
  return 'unknown chamber';
}

const VERB: Record<string, string> = {
  buy: 'bought',
  sell: 'sold',
  exchange: 'exchanged',
  gift: 'gifted',
  other: 'transacted',
};

/** How the asset should be named in prose — ticker when we have one, else the
 *  filer's asset name (trimmed; these run long and noisy). */
function assetLabel(t: TradeRecord): string {
  if (t.option && t.ticker) return formatOptionLabel(t.ticker, t.option);
  if (t.ticker) return t.ticker;
  return (t.assetName ?? 'an undisclosed asset').replace(/\s+/g, ' ').trim().slice(0, 60);
}

// --- Digest ------------------------------------------------------------------

export interface PoliticsDigestOptions {
  /** Trades disclosed on/after this date are "new this edition" (YYYY-MM-DD). */
  since: string;
  /** Anchor for the standing fallback window (YYYY-MM-DD). Passed in, never read
   *  from the clock, so the output is reproducible. */
  today: string;
  /** Width of the standing fallback used when the fresh window is empty. */
  standingDays?: number;
  maxClusters?: number;
  maxNotable?: number;
  /** Passed through to detectTradeClusters. */
  clusterWindowDays?: number;
  /** Distinct members needed to call something consensus. 3 for the newspaper —
   *  2 is common enough to be noise in a lead. */
  minClusterPoliticians?: number;
  /** Drop consensus clusters whose last trade is older than this many days. A
   *  single late filing can otherwise resurrect a year-old cluster and have it
   *  read as today's news. */
  maxClusterAgeDays?: number;
  /** Cap on NOTABLE lines per member, so one member's portfolio liquidation
   *  can't take every slot in the tier. */
  maxNotablePerMember?: number;
}

export interface PoliticsDigestCounts {
  /** Trades disclosed inside the covered window. */
  disclosed: number;
  clusters: number;
  notable: number;
  tail: number;
  /** Distinct members with a disclosure in the window. */
  members: number;
}

export interface PoliticsTradeDigest {
  lines: string[];
  /** True when `since` yielded nothing and the window was widened. */
  standing: boolean;
  /** The disclosure window actually covered (YYYY-MM-DD). */
  windowStart: string;
  counts: PoliticsDigestCounts;
}

const EMPTY_COUNTS: PoliticsDigestCounts = {
  disclosed: 0,
  clusters: 0,
  notable: 0,
  tail: 0,
  members: 0,
};

export function buildPoliticsTradeDigest(
  rawTrades: TradeRecord[],
  opts: PoliticsDigestOptions
): PoliticsTradeDigest {
  const standingDays = opts.standingDays ?? 7;
  const maxClusters = opts.maxClusters ?? 5;
  const maxNotable = opts.maxNotable ?? 8;
  const maxNotablePerMember = opts.maxNotablePerMember ?? 2;
  const maxClusterAgeDays = opts.maxClusterAgeDays ?? 180;

  // One identity per member and a symbol on every row that names one — without
  // this, one member filing under two name renderings fakes a consensus, and
  // untickered ETF rows can't cluster at all. See ./identity.ts.
  const trades = normalizeTradesForAnalysis(rawTrades);

  const disclosedSince = (from: string): TradeRecord[] =>
    trades.filter((t) => {
      const d = disclosureDate(t);
      return d != null && d >= from;
    });

  let windowStart = opts.since;
  let disclosed = disclosedSince(windowStart);
  let standing = false;
  // An empty 24h window is normal (filings land in bursts), not a reason to drop
  // the desk from the edition. Widen and label rather than returning nothing.
  if (disclosed.length === 0) {
    standing = true;
    windowStart = daysBefore(opts.today, standingDays);
    disclosed = disclosedSince(windowStart);
  }
  if (disclosed.length === 0) {
    return { lines: [], standing, windowStart, counts: { ...EMPTY_COUNTS } };
  }

  const freshIds = new Set(disclosed.map((t) => t.externalId));
  const members = new Set(disclosed.map((t) => politicianIdentityKey(t.politicianName)));
  const clusterFloor = daysBefore(opts.today, maxClusterAgeDays);

  // --- Tier 1: consensus. Clusters are computed over the FULL trade history (a
  // cluster can span months) but only surface when part of one was disclosed in
  // this window — that's what makes an old cluster news today.
  const clusters = detectTradeClusters(trades, {
    windowDays: opts.clusterWindowDays ?? 60,
    minPoliticians: opts.minClusterPoliticians ?? 3,
  })
    .map((cluster) => ({
      cluster,
      freshCount: cluster.trades.filter((t) => freshIds.has(t.externalId)).length,
    }))
    .filter((c) => c.freshCount > 0 && c.cluster.lastDate >= clusterFloor)
    // Most newly-disclosed first — a cluster that mostly landed this window is
    // more the day's story than an older one grazed by a single late filing.
    .sort(
      (a, b) =>
        b.freshCount - a.freshCount ||
        b.cluster.politicianCount - a.cluster.politicianCount ||
        b.cluster.lastDate.localeCompare(a.cluster.lastDate)
    )
    .slice(0, maxClusters);

  // Trades already spoken for by a consensus line must not be repeated as
  // individual notables — the reader would see the same trade twice.
  const claimed = new Set<string>();
  for (const { cluster } of clusters) {
    for (const t of cluster.trades) claimed.add(t.externalId);
  }

  // --- Tier 2: notable individuals.
  const ranked = disclosed
    .filter((t) => !claimed.has(t.externalId))
    .map((t) => ({ trade: t, score: tradeNotability(t) }))
    .filter((x) => x.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (disclosureDate(b.trade) ?? '').localeCompare(disclosureDate(a.trade) ?? '') ||
        a.trade.externalId.localeCompare(b.trade.externalId)
    );
  // Cap per member: a single filer liquidating a portfolio produces a dozen
  // same-size sells on one day, which would otherwise crowd out every other
  // member's news. Their remainder falls to the tail and is still counted.
  const perMember = new Map<string, number>();
  const notable: typeof ranked = [];
  for (const entry of ranked) {
    if (notable.length >= maxNotable) break;
    const key = politicianIdentityKey(entry.trade.politicianName);
    const used = perMember.get(key) ?? 0;
    if (used >= maxNotablePerMember) continue;
    perMember.set(key, used + 1);
    notable.push(entry);
  }
  const shown = new Set(notable.map((x) => x.trade.externalId));

  // --- Tier 3: the tail.
  const tail = disclosed.filter((t) => !claimed.has(t.externalId) && !shown.has(t.externalId));

  // --- Render.
  const lines: string[] = [];

  if (standing) {
    lines.push(
      `No new trade disclosures landed in the edition window. The items below cover the rolling ` +
        `${standingDays} days since ${windowStart} and are NOT new today — report them as standing ` +
        `context, not breaking news.`
    );
  }

  for (const { cluster: c, freshCount } of clusters) {
    const total = usdRange(c.amountMin, c.amountMax);
    const span = c.spanDays === 0 ? 'the same day' : `${c.spanDays} days`;
    // Name each member WITH their chamber. Without it the editor infers one and
    // gets it wrong — two different McCormicks sit in the two chambers, and a
    // House member was published as a Senator.
    const chamberOf = new Map<string, string>();
    for (const t of c.trades) chamberOf.set(t.politicianName.trim(), chamberLabel(t.chamber));
    const roster = c.politicians
      .map((name) => {
        const ch = chamberOf.get(name.trim());
        return ch ? `${name} (${ch})` : name;
      })
      .join(', ');
    lines.push(
      `CONSENSUS ${c.direction.toUpperCase()} — ${c.politicianCount} members ${VERB[c.direction]} ` +
        `${c.ticker} within ${span} (${c.firstDate} to ${c.lastDate}), ${c.tradeCount} ` +
        `transaction${c.tradeCount === 1 ? '' : 's'}${total ? ` totaling ${total} disclosed` : ''}; ` +
        `${freshCount} newly disclosed this window. Members, earliest first: ${roster}.`
    );
  }

  for (const { trade: t } of notable) {
    const amount = t.amount ?? usdRange(t.amountMin, t.amountMax);
    const filed = t.filingDate && t.filingDate !== t.tradeDate ? `, disclosed ${t.filingDate}` : '';
    lines.push(
      `NOTABLE — ${t.politicianName} (${chamberLabel(t.chamber)}) ${VERB[t.category] ?? t.category} ` +
        `${assetLabel(t)}${amount ? `, ${amount}` : ''}; traded ${t.tradeDate}${filed}.`
    );
  }

  if (tail.length > 0) {
    const fixed = tail.filter((t) => classifyTradeAsset(t) === 'fixed-income').length;
    const rest = tail.length - fixed;
    const parts: string[] = [];
    if (fixed > 0)
      parts.push(`${fixed} fixed-income (Treasuries, CDs, municipal and corporate bonds)`);
    if (rest > 0) parts.push(`${rest} smaller or unidentified positions`);
    const tailMembers = new Set(tail.map((t) => politicianIdentityKey(t.politicianName))).size;
    lines.push(
      `Also disclosed in this window: ${tail.length} further transaction${tail.length === 1 ? '' : 's'} ` +
        `across ${tailMembers} member${tailMembers === 1 ? '' : 's'} — ${parts.join(' and ')} — ` +
        `none individually notable.`
    );
  }

  return {
    lines,
    standing,
    windowStart,
    counts: {
      disclosed: disclosed.length,
      clusters: clusters.length,
      notable: notable.length,
      tail: tail.length,
      members: members.size,
    },
  };
}
