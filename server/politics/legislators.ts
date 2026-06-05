// Congress member headshots — maps a disclosed filer name to a public-domain
// portrait from the unitedstates/images set (keyed by bioguide id). The
// name→bioguide map comes from unitedstates/congress-legislators, cached to disk
// weekly. Matching is fuzzy (the disclosure names carry "Hon." prefixes, middle
// initials, etc.) and falls back to a unique last-name; anything unmatched (e.g.
// Trump, who isn't in Congress) returns null → the UI shows an initials avatar.

import { promises as fs } from 'fs';
import path from 'path';
import { DATA_DIR } from '../data.js';
import { createLogger } from '../logger.js';
import { timeoutFetch } from './http.js';

const log = createLogger('PoliticsLegislators');

const CACHE_FILE = path.join(DATA_DIR, '.docvault-legislators.json');
const SOURCE_URL = 'https://unitedstates.github.io/congress-legislators/legislators-current.json';
const IMAGE_BASE = 'https://unitedstates.github.io/images/congress/225x275';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface LegislatorEntry {
  bioguide: string;
  first: string;
  last: string;
  official: string;
  nickname?: string;
}

interface LegislatorCache {
  fetchedAt: string;
  entries: LegislatorEntry[];
}

/** The external CDN portrait URL — used only as the DOWNLOAD source now; the UI
 *  is pointed at the self-hosted endpoint below. */
export function imageUrlForBioguide(bioguide: string): string {
  return `${IMAGE_BASE}/${bioguide}.jpg`;
}

/** DocVault-served portrait URL (what the resolver returns). Lazily backed by the
 *  on-disk cache in getCachedHeadshot — keeps the Politics view self-contained
 *  instead of hot-linking the GitHub-Pages CDN on every render. */
export function localHeadshotUrl(bioguide: string): string {
  return `/api/politics/headshot/${bioguide}`;
}

const HEADSHOT_DIR = path.join(DATA_DIR, '.docvault-headshots');
// Bioguide ids with no portrait in the set — avoid re-hammering the CDN this run.
const missingHeadshots = new Set<string>();

/** Read a member's portrait from the on-disk cache, downloading + storing it from
 *  the CDN on first request. Returns null (→ 404 → initials avatar) if there's no
 *  portrait. Only [A-Za-z0-9] ids are accepted (no path traversal). */
export async function getCachedHeadshot(bioguide: string): Promise<Buffer | null> {
  const safe = bioguide.replace(/[^A-Za-z0-9]/g, '');
  if (!safe || missingHeadshots.has(safe)) return null;
  const file = path.join(HEADSHOT_DIR, `${safe}.jpg`);
  try {
    return await fs.readFile(file);
  } catch {
    /* not cached yet */
  }
  try {
    const res = await timeoutFetch(15_000)(imageUrlForBioguide(safe), {
      headers: { Accept: 'image/jpeg' },
    });
    if (!res.ok) {
      if (res.status === 404) missingHeadshots.add(safe);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    await fs.mkdir(HEADSHOT_DIR, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, buf);
    await fs.rename(tmp, file);
    return buf;
  } catch (err) {
    log.warn(
      `headshot fetch failed for ${safe}: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

/** Strip titles/suffixes/punctuation → lowercase token string for matching. */
function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(hon|rep|representative|sen|senator|mr|mrs|ms|dr)\.?\b/g, ' ')
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type HeadshotResolver = (politicianName: string) => string | null;

/** Pure: build a name→headshot resolver from legislator entries (no I/O). */
export function buildResolverFromEntries(entries: LegislatorEntry[]): HeadshotResolver {
  const byFull = new Map<string, string>();
  const byFirstLast = new Map<string, string>();
  const byLast = new Map<string, Set<string>>();
  for (const e of entries) {
    if (byFull.has(normalize(e.official))) {
      // keep first
    } else if (e.official) {
      byFull.set(normalize(e.official), e.bioguide);
    }
    byFirstLast.set(normalize(`${e.first} ${e.last}`), e.bioguide);
    if (e.nickname) byFirstLast.set(normalize(`${e.nickname} ${e.last}`), e.bioguide);
    // Also index the OFFICIAL name's first+last. Disclosures use the legal first
    // name ("David") while `first` may hold a nickname ("Dave"), so this is what
    // catches e.g. "David H McCormick" → Sen. Dave McCormick.
    const officialTokens = normalize(e.official).split(' ').filter(Boolean);
    if (officialTokens.length >= 2) {
      byFirstLast.set(
        `${officialTokens[0]} ${officialTokens[officialTokens.length - 1]}`,
        e.bioguide
      );
    }
    const last = normalize(e.last);
    byLast.set(last, (byLast.get(last) ?? new Set()).add(e.bioguide));
  }

  return (name: string): string | null => {
    const norm = normalize(name);
    if (!norm) return null;
    const tokens = norm.split(' ');
    const firstLast = tokens.length >= 2 ? `${tokens[0]} ${tokens[tokens.length - 1]}` : norm;
    const lastOnly = tokens[tokens.length - 1];
    const lastMatches = byLast.get(lastOnly);
    const bioguide =
      byFull.get(norm) ??
      byFirstLast.get(norm) ??
      byFirstLast.get(firstLast) ??
      (lastMatches && lastMatches.size === 1 ? [...lastMatches][0] : undefined);
    return bioguide ? localHeadshotUrl(bioguide) : null;
  };
}

let memo: { at: number; entries: LegislatorEntry[] } | null = null;

async function fetchLegislators(): Promise<LegislatorEntry[]> {
  const res = await timeoutFetch(20_000)(SOURCE_URL, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`legislators fetch failed: HTTP ${res.status}`);
  const raw = (await res.json()) as Array<{
    id?: { bioguide?: string };
    name?: { first?: string; last?: string; official_full?: string; nickname?: string };
  }>;
  return raw
    .filter((r) => r.id?.bioguide && r.name?.last)
    .map((r) => ({
      bioguide: r.id!.bioguide!,
      first: r.name!.first ?? '',
      last: r.name!.last ?? '',
      official: r.name!.official_full ?? `${r.name!.first ?? ''} ${r.name!.last ?? ''}`.trim(),
      nickname: r.name!.nickname,
    }));
}

async function loadLegislators(): Promise<LegislatorEntry[]> {
  if (memo && Date.now() - memo.at < 60 * 60 * 1000) return memo.entries;

  // Fresh disk cache?
  try {
    const cache = JSON.parse(await fs.readFile(CACHE_FILE, 'utf8')) as LegislatorCache;
    if (cache.entries?.length && Date.now() - Date.parse(cache.fetchedAt) < TTL_MS) {
      memo = { at: Date.now(), entries: cache.entries };
      return cache.entries;
    }
  } catch {
    /* miss */
  }

  // Refresh from source.
  try {
    const entries = await fetchLegislators();
    const tmp = `${CACHE_FILE}.${process.pid}.tmp`;
    await fs.writeFile(
      tmp,
      `${JSON.stringify({ fetchedAt: new Date().toISOString(), entries })}\n`
    );
    await fs.rename(tmp, CACHE_FILE);
    memo = { at: Date.now(), entries };
    return entries;
  } catch (err) {
    log.warn(`legislators refresh failed: ${err instanceof Error ? err.message : String(err)}`);
    // Fall back to stale cache if we have one.
    try {
      const stale = JSON.parse(await fs.readFile(CACHE_FILE, 'utf8')) as LegislatorCache;
      return stale.entries ?? [];
    } catch {
      return [];
    }
  }
}

export async function buildHeadshotResolver(): Promise<HeadshotResolver> {
  return buildResolverFromEntries(await loadLegislators());
}
