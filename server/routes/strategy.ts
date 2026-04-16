// Strategy history — stores AI-generated investment strategy analyses that
// combine portfolio data + quant signals into actionable recommendations.
// Entries are created by Claude Code's /strategy skill and displayed in the
// app's Strategy History view.

import * as fs from 'node:fs/promises';
import { STRATEGY_HISTORY_FILE, jsonResponse } from '../data.js';
import { createLogger } from '../logger.js';

const log = createLogger('Strategy');

export interface StrategySignals {
  btcPrice?: number;
  btcRisk?: number | null;
  btcDrawdown?: number;
  fearGreed?: number;
  sahmRule?: number | null;
  recessionProb?: number | null;
  tenYearReal?: number;
  yieldCurveRegime?: string;
  nfci?: number | null;
  fedStance?: string;
  sp500Risk?: number | null;
  hashRibbonRegime?: string;
  [key: string]: unknown;
}

export interface StrategyEntry {
  id: string;
  createdAt: string; // ISO 8601
  /** One-line headline, e.g. "Defensive — reduce crypto, hold cash, wait for hash ribbon recovery" */
  title: string;
  /** Full markdown analysis body. */
  body: string;
  /** Key signal values at the time the strategy was generated. */
  signals: StrategySignals;
  /** Optional portfolio context that was used. */
  portfolio?: {
    totalValue?: number;
    cryptoAllocation?: number;
    cashAllocation?: number;
    [key: string]: unknown;
  };
  /** Who/what generated this entry. */
  author: string;
}

interface StrategyHistoryFile {
  entries: StrategyEntry[];
}

async function loadHistory(): Promise<StrategyHistoryFile> {
  try {
    const raw = await fs.readFile(STRATEGY_HISTORY_FILE, 'utf8');
    const parsed = JSON.parse(raw) as StrategyHistoryFile;
    return parsed.entries ? parsed : { entries: [] };
  } catch {
    return { entries: [] };
  }
}

async function saveHistory(data: StrategyHistoryFile): Promise<void> {
  await fs.writeFile(STRATEGY_HISTORY_FILE, JSON.stringify(data, null, 2));
}

export async function handleStrategyRoutes(
  req: Request,
  _url: URL,
  pathname: string
): Promise<Response | null> {
  // GET /api/strategy — list all entries, newest first
  if (pathname === '/api/strategy' && req.method === 'GET') {
    const data = await loadHistory();
    return jsonResponse({
      entries: [...data.entries].reverse(),
      count: data.entries.length,
    });
  }

  // GET /api/strategy/latest — most recent entry only
  if (pathname === '/api/strategy/latest' && req.method === 'GET') {
    const data = await loadHistory();
    const latest = data.entries.length > 0 ? data.entries[data.entries.length - 1] : null;
    return jsonResponse({ entry: latest });
  }

  // POST /api/strategy — create a new entry
  if (pathname === '/api/strategy' && req.method === 'POST') {
    try {
      const body = (await req.json()) as Partial<StrategyEntry>;

      if (!body.title || !body.body) {
        return jsonResponse({ error: 'Missing required fields: title, body' }, 400);
      }

      const entry: StrategyEntry = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        title: body.title.trim(),
        body: body.body.trim(),
        signals: body.signals ?? {},
        portfolio: body.portfolio,
        author: body.author ?? 'Claude Code',
      };

      const data = await loadHistory();
      data.entries.push(entry);
      await saveHistory(data);

      log.info(`Strategy saved: "${entry.title}" (${entry.id})`);
      return jsonResponse({ ok: true, entry });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`Strategy save failed: ${msg}`);
      return jsonResponse({ error: `Failed to save strategy: ${msg}` }, 500);
    }
  }

  // DELETE /api/strategy/:id — remove an entry
  const deleteMatch = pathname.match(/^\/api\/strategy\/([^/]+)$/);
  if (deleteMatch && req.method === 'DELETE') {
    const id = deleteMatch[1];
    const data = await loadHistory();
    const idx = data.entries.findIndex((e) => e.id === id);
    if (idx === -1) return jsonResponse({ error: 'Strategy entry not found' }, 404);
    data.entries.splice(idx, 1);
    await saveHistory(data);
    log.info(`Strategy deleted: ${id}`);
    return jsonResponse({ ok: true });
  }

  return null;
}
