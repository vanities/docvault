// Crypto yields overlay — per-(source, asset) APY stored separately from the
// live balance cache so values survive exchange API refetches.
//
// Why this is a separate store rather than a field on CryptoBalance:
//   Balances are refetched live from exchanges on every sync. Anything stored
//   inline on a balance would be wiped. This overlay is keyed by `<sourceId>::<asset>`
//   and merged into the UI at render time.
//
// Routes:
//   GET    /api/crypto/yields                         — full overlay map
//   PUT    /api/crypto/yields/:sourceId/:asset        — set APY; body { yieldApy: number | null }
//   DELETE /api/crypto/yields/:sourceId/:asset        — remove override (alias for PUT null)
//
// Storage:
//   .docvault-crypto-yields.json → { version, entries: { "sourceId::asset" → YieldEntry } }

import { promises as fs } from 'fs';
import path from 'path';
import { jsonResponse, ensureDir, DATA_DIR } from '../data.js';
import { createLogger } from '../logger.js';
import { createWriteLock, writeJsonAtomic } from '../write-lock.js';
import { readJsonBody } from '../http.js';

const log = createLogger('CryptoYields');

const STORE_FILE = path.join(DATA_DIR, '.docvault-crypto-yields.json');
const withYieldMutation = createWriteLock();

export interface CryptoYieldEntry {
  sourceId: string;
  asset: string;
  /** Annual percentage yield as a whole number (e.g. 4.0 = 4% APY). */
  yieldApy: number;
  /** Optional user note — e.g. "Coinbase Rewards", "ETH2 staking via Kraken". */
  note?: string;
  updatedAt: string;
}

interface YieldStore {
  version: 1;
  entries: Record<string, CryptoYieldEntry>;
}

function keyFor(sourceId: string, asset: string): string {
  return `${sourceId}::${asset.toUpperCase()}`;
}

async function loadStore(): Promise<YieldStore> {
  try {
    const raw = await fs.readFile(STORE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<YieldStore>;
    return { version: 1, entries: parsed.entries ?? {} };
  } catch {
    return { version: 1, entries: {} };
  }
}

async function saveStore(store: YieldStore): Promise<void> {
  await ensureDir(DATA_DIR);
  await writeJsonAtomic(STORE_FILE, store);
}

export async function handleCryptoYieldsRoutes(
  req: Request,
  _url: URL,
  pathname: string
): Promise<Response | null> {
  const handle = () => handleCryptoYieldsRoutesUnlocked(req, pathname);
  return pathname.startsWith('/api/crypto/yields/') && ['PUT', 'DELETE'].includes(req.method)
    ? withYieldMutation(handle)
    : handle();
}

async function handleCryptoYieldsRoutesUnlocked(
  req: Request,
  pathname: string
): Promise<Response | null> {
  // GET /api/crypto/yields
  if (pathname === '/api/crypto/yields' && req.method === 'GET') {
    const store = await loadStore();
    return jsonResponse({ entries: store.entries });
  }

  // PUT / DELETE /api/crypto/yields/:sourceId/:asset
  const match = pathname.match(/^\/api\/crypto\/yields\/([^/]+)\/([^/]+)$/);
  if (match && (req.method === 'PUT' || req.method === 'DELETE')) {
    const sourceId = decodeURIComponent(match[1]);
    const asset = decodeURIComponent(match[2]).toUpperCase();
    const key = keyFor(sourceId, asset);
    const store = await loadStore();

    if (req.method === 'DELETE') {
      delete store.entries[key];
      await saveStore(store);
      log.info(`Cleared yield for ${key}`);
      return jsonResponse({ ok: true });
    }

    // PUT
    const body = await readJsonBody<unknown>(req).catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body) || !('yieldApy' in body)) {
      return jsonResponse({ error: 'A yieldApy number or explicit null is required' }, 400);
    }
    const note = 'note' in body ? body.note : undefined;
    if (note !== undefined && note !== null && typeof note !== 'string') {
      return jsonResponse({ error: 'note must be a string or null' }, 400);
    }

    // Allow null yieldApy to clear the override (same as DELETE).
    if (body.yieldApy === null) {
      delete store.entries[key];
      await saveStore(store);
      return jsonResponse({ ok: true });
    }

    const apy = body.yieldApy;
    if (typeof apy !== 'number' || !Number.isFinite(apy) || apy < 0 || apy > 1000) {
      return jsonResponse({ error: 'yieldApy must be a finite number between 0 and 1000' }, 400);
    }

    const entry: CryptoYieldEntry = {
      sourceId,
      asset,
      yieldApy: apy,
      note: note === null ? undefined : (note ?? store.entries[key]?.note),
      updatedAt: new Date().toISOString(),
    };
    store.entries[key] = entry;
    await saveStore(store);
    log.info(`Set yield ${apy}% for ${key}`);
    return jsonResponse({ entry });
  }

  return null;
}
