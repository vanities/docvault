// =============================================================================
// OpenFIGI CUSIP → human label enrichment
// =============================================================================
// SnapTrade often returns only the CUSIP (no description) for brokered CDs,
// Treasuries, and corporate bonds. OpenFIGI maps CUSIP → { name, ticker,
// securityDescription } and is free for anonymous use (25 req/min; up to 10
// CUSIPs per batch call).
//
// Results are cached on disk under DATA_DIR/.docvault-cusip-cache.json — CUSIPs
// are immutable identifiers, so no TTL is needed.

import { promises as fs } from 'fs';
import path from 'path';
import { DATA_DIR } from './data.js';
import { createLogger } from './logger.js';

const log = createLogger('OpenFIGI');
const CACHE_PATH = path.join(DATA_DIR, '.docvault-cusip-cache.json');
const CUSIP_PATTERN = /^[0-9A-Z]{8}[0-9]$/;
const BATCH_SIZE = 10;

type CusipCache = Record<string, string>;

let cachePromise: Promise<CusipCache> | null = null;

async function loadCache(): Promise<CusipCache> {
  if (cachePromise) return cachePromise;
  cachePromise = (async () => {
    try {
      return JSON.parse(await fs.readFile(CACHE_PATH, 'utf8')) as CusipCache;
    } catch {
      return {};
    }
  })();
  return cachePromise;
}

async function saveCache(cache: CusipCache): Promise<void> {
  await fs.writeFile(CACHE_PATH, JSON.stringify(cache, null, 2));
}

export function isCusip(value: string): boolean {
  return CUSIP_PATTERN.test(value.toUpperCase());
}

interface OpenFigiHit {
  name?: string;
  ticker?: string;
  securityDescription?: string;
}

async function openFigiBatch(cusips: string[]): Promise<Record<string, OpenFigiHit>> {
  const body = cusips.map((c) => ({ idType: 'ID_CUSIP', idValue: c }));
  const res = await fetch('https://api.openfigi.com/v3/mapping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`OpenFIGI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as Array<{ data?: OpenFigiHit[]; warning?: string }>;
  const out: Record<string, OpenFigiHit> = {};
  data.forEach((entry, i) => {
    const cusip = cusips[i];
    const hit = entry.data?.[0];
    if (hit) out[cusip] = hit;
  });
  return out;
}

function formatLabel(hit: OpenFigiHit, cusip: string): string {
  // Prefer "{NAME} — {securityDescription}" when both present (e.g.
  // "FIRST HORIZON BANK — FHN 3.85 07/07/26"). Fall back gracefully.
  const desc = hit.securityDescription || hit.ticker;
  if (hit.name && desc) return `${hit.name} — ${desc}`;
  return hit.name || desc || cusip;
}

// Resolve labels for any CUSIP-shaped ticker. Unknowns and non-CUSIPs are
// absent from the return map. Safe to call with any mix of tickers.
export async function enrichCusipLabels(tickers: string[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(tickers.map((t) => t.toUpperCase()))).filter(isCusip);
  if (unique.length === 0) return {};

  const cache = await loadCache();
  const result: Record<string, string> = {};
  const misses: string[] = [];
  for (const cusip of unique) {
    const cached = cache[cusip];
    if (cached) result[cusip] = cached;
    else misses.push(cusip);
  }
  if (misses.length === 0) return result;

  log.info(`Resolving ${misses.length} new CUSIP(s) via OpenFIGI`);
  let resolved = 0;
  for (let i = 0; i < misses.length; i += BATCH_SIZE) {
    const batch = misses.slice(i, i + BATCH_SIZE);
    try {
      const hits = await openFigiBatch(batch);
      for (const cusip of batch) {
        const hit = hits[cusip];
        if (hit) {
          const label = formatLabel(hit, cusip);
          cache[cusip] = label;
          result[cusip] = label;
          resolved++;
        }
      }
    } catch (err) {
      log.warn(`batch failed (${batch.join(',')}): ${(err as Error).message}`);
      // Don't block other batches — continue with partial results.
    }
  }

  if (resolved > 0) {
    try {
      await saveCache(cache);
    } catch (err) {
      log.warn(`cache write failed: ${(err as Error).message}`);
    }
  }
  log.info(`Resolved ${resolved}/${misses.length} new CUSIP labels`);
  return result;
}
