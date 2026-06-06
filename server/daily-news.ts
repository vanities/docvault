// Daily News engine — gathers a digest of everything that changed across
// DocVault since the last edition, then synthesizes a newspaper edition through
// the configured backend. The provider dispatch mirrors deep-research.ts
// (api / claude-agent / codex-agent) EXCEPT no web_search is used: the digest is
// the corpus, so an OpenAI API-mode pick works directly (no Anthropic fallback).
//
// gatherDigest reads everything IN-PROCESS (never self-HTTP) and is windowed by
// `sinceISO`; each source is soft-failed independently so one dead source never
// sinks the edition. generateEdition is a pure function of (type, date, since)
// for easy testing — the store computes the window and persists the result.

import { createRequire } from 'module';
import path from 'path';
import { promises as fs } from 'fs';
import os from 'os';
import type Anthropic from '@anthropic-ai/sdk';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { getClient } from './parsers/base.js';
import { openaiComplete } from './llm/openai.js';
import { CodexAppServerClient, type CodexNotification } from './llm/codex-app-server.js';
import { handleCodexServerRequest } from './llm/codex-chat.js';
import {
  getDailyNewsConfig,
  getDailyNewsTitle,
  getEmailConfig,
  getWeatherConfig,
  getCodexChatConfig,
  getAnthropicAuthToken,
  getAnthropicKey,
  loadSnapshots,
  loadReminders,
  loadSalesData,
  loadMileageData,
  loadTodos,
  loadConfig,
  scanDirectory,
  loadLiabilities,
  loadGoldData,
  loadPropertyData,
  DATA_DIR,
  BROKER_ACTIVITIES_FILE,
  CRYPTO_CACHE_FILE,
  DEFAULT_MODEL,
  type ModelRef,
} from './data.js';
import { fetchWeekForecast, forecastToLines, type WeatherForecast } from './weather.js';
import { listResearchEntries } from './routes/research.js';
import { getLatestStrategy } from './routes/strategy.js';
import { getLatestHealthAnalysis } from './routes/health-analysis.js';
import { loadHealthStore } from './health-store.js';
import { listRuns } from './deep-research-store.js';
import { loadQuantCache } from './routes/quant.js';
import { fetchTickerPrices } from './ticker-prices.js';
import { loadPoliticsFeedPayload } from './politics/feed-store.js';
import type { BillRecord, ExecutiveActionRecord, TradeRecord } from './politics/types.js';
import { readBrainContent } from './brain.js';
import { sendEmail } from './email.js';
import {
  renderEditionHtml,
  renderEditionEmailHtml,
  editionFilename,
  formatEditionDate,
} from './daily-news-report.js';
import { getThemePrompt, resolveTheme } from './daily-news-themes.js';
import { readEditionImage } from './daily-news-image.js';
import { logAiCall } from './ai/usage-log.js';
import { createLogger } from './logger.js';
import type { Edition, EditionType } from './daily-news-store.js';

const log = createLogger('DailyNews');

const MAX_OUTPUT_TOKENS = 8192;

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export interface DigestSection {
  /** The desk heading, e.g. "Markets & Macro". */
  desk: string;
  /** Pre-summarized bullet strings — the LLM does editorial synthesis, not parsing. */
  items: string[];
}

export interface Digest {
  editionType: EditionType;
  sinceISO: string;
  sections: DigestSection[];
  itemCount: number;
  /** Desk names that contributed at least one item. */
  sources: string[];
  /** Week-ahead forecast for the rendered weather box (Open-Meteo); optional. */
  weather?: WeatherForecast;
}

export interface GenerateResult {
  title: string;
  body: string;
  /** Theme id used — passed to the store so it can render a matching hero image. */
  theme: string;
  usage: { inputTokens: number; outputTokens: number };
  digestMeta: { sources: string[]; sinceISO: string; itemCount: number };
  /** Forecast carried through so the renderer can draw the weather box. */
  weather?: WeatherForecast;
}

// Claude Code binary resolution for the agent engine (mirrors deep-research.ts).
const CLAUDE_BINARY_PATH: string | undefined = (() => {
  const { platform, arch } = process;
  let pkg: string | undefined;
  if (platform === 'linux' && arch === 'x64') pkg = '@anthropic-ai/claude-agent-sdk-linux-x64';
  else if (platform === 'linux' && arch === 'arm64')
    pkg = '@anthropic-ai/claude-agent-sdk-linux-arm64';
  else if (platform === 'darwin' && arch === 'x64')
    pkg = '@anthropic-ai/claude-agent-sdk-darwin-x64';
  else if (platform === 'darwin' && arch === 'arm64')
    pkg = '@anthropic-ai/claude-agent-sdk-darwin-arm64';
  if (!pkg) return undefined;
  try {
    const requireFromHere = createRequire(import.meta.url);
    const pkgJsonPath = requireFromHere.resolve(`${pkg}/package.json`);
    return path.join(path.dirname(pkgJsonPath), 'claude');
  } catch {
    return undefined;
  }
})();

// ===========================================================================
// Digest gathering — each desk reads IN-PROCESS, windowed, and soft-fails.
// ===========================================================================

type AfterSince = (d?: string | null) => boolean;

/** Last element of an array (or undefined) — avoids relying on Array.prototype.at. */
function last<T>(a: readonly T[] | undefined): T | undefined {
  return a && a.length ? a[a.length - 1] : undefined;
}

/** Most-recent per-person record from a `${personId}/${file}`-keyed store map. */
function latestByPerson<T extends { generatedAt?: string }>(
  rec: Record<string, T> | undefined,
  personId: string
): T | undefined {
  if (!rec) return undefined;
  const prefix = `${personId}/`;
  const vals = Object.entries(rec)
    .filter(([k]) => k.startsWith(prefix))
    .map(([, v]) => v)
    .sort((a, b) => (a.generatedAt ?? '').localeCompare(b.generatedAt ?? ''));
  return last(vals);
}

// Minimal shapes for defensively reading the nested Apple Health snapshot +
// clinical store — their full types are large and versioned, so optional
// chaining against these keeps the digest robust to schema drift.
interface SnapMetrics {
  activity?: { daily?: Array<{ steps?: number | null }> };
  heart?: { daily?: Array<{ restingHR?: number | null; hrv?: number | null }> };
  sleep?: { daily?: Array<{ asleepMinutes?: number | null }> };
  body?: { headline?: { currentLb?: number | null } };
  workouts?: {
    headline?: {
      thisWeekCount?: number;
      thisWeekMinutes?: number;
      currentStreakDays?: number;
      favoriteType?: string | null;
    };
  };
}
interface ClinicalLabs {
  labsByTest?: Array<{
    latest?: {
      name?: string;
      value?: number | null;
      valueString?: string | null;
      unit?: string | null;
      date?: string | null;
      interpretation?: string | null;
    } | null;
  }>;
}

// Markets shows the CURRENT market state (signals, watchlist, net-worth delta),
// so it isn't windowed by sinceISO like the other desks.
async function gatherMarkets(): Promise<string[]> {
  const items: string[] = [];

  // Cached quant signals — read-only, never triggers a network refresh.
  try {
    const q = await loadQuantCache();
    const fg = q.fearGreed?.data?.latest;
    if (fg) {
      const ma = q.fearGreed?.data?.ma30;
      items.push(
        `Crypto Fear & Greed: ${fg.value}/100 (${fg.classification})${
          typeof ma === 'number' ? `, 30-day avg ${Math.round(ma)}` : ''
        }.`
      );
    }
    const dd = q.btcDrawdown?.data?.latest;
    if (dd) {
      items.push(
        `Bitcoin ${(dd.drawdown * 100).toFixed(1)}% from its all-time high ` +
          `($${Math.round(dd.price).toLocaleString()} vs ATH $${Math.round(dd.ath).toLocaleString()}), ` +
          `${dd.daysSinceAth}d since the peak.`
      );
    }
    const alt = q.altcoinSeason?.data;
    if (alt) {
      items.push(
        `Altcoin Season Index ${alt.indexValue}/100 (${alt.regime.replace(/-/g, ' ')}); ` +
          `BTC 90-day return ${(alt.btcReturn90d * 100).toFixed(0)}%.`
      );
    }
    // Prediction markets (Kalshi/Polymarket) — live cache, not daily-archived.
    const preds = q.predictions?.data;
    if (preds) {
      const top = [...(preds.finance ?? []), ...(preds.politics ?? [])]
        .filter((m) => typeof m.probability === 'number')
        .sort((a, b) => (b.volumeUsd ?? 0) - (a.volumeUsd ?? 0))
        .slice(0, 6);
      for (const m of top) {
        items.push(
          `Prediction (${m.source}): "${m.question}" — ${Math.round(m.probability)}% yes.`
        );
      }
    }
  } catch (err) {
    log.warn(`[digest] markets/quant failed: ${errMsg(err)}`);
  }

  // Watchlist — symbols tagged on finance research entries (cache-first quotes).
  try {
    const finance = await listResearchEntries('finance');
    const symbols = [...new Set(finance.flatMap((e) => e.tickers ?? []))].slice(0, 10);
    if (symbols.length) {
      const { quotes } = await fetchTickerPrices(symbols);
      const movers = quotes
        .filter((q) => q && q.price != null)
        .map(
          (q) =>
            `${q.symbol} $${q.price!.toLocaleString(undefined, { maximumFractionDigits: 2 })}` +
            (q.oneYearChangePct != null
              ? ` (${q.oneYearChangePct >= 0 ? '+' : ''}${q.oneYearChangePct.toFixed(0)}% 1y)`
              : '')
        );
      if (movers.length) items.push(`Watchlist: ${movers.join(', ')}.`);
    }
  } catch (err) {
    log.warn(`[digest] markets/tickers failed: ${errMsg(err)}`);
  }

  // Portfolio net-worth delta (last two snapshots).
  try {
    const snaps = await loadSnapshots();
    if (snaps.length >= 2) {
      const prev = snaps[snaps.length - 2];
      const cur = snaps[snaps.length - 1];
      const delta = cur.totalValue - prev.totalValue;
      const pct = prev.totalValue ? (delta / prev.totalValue) * 100 : 0;
      items.push(
        `Portfolio net worth ${delta >= 0 ? 'up' : 'down'} ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% ` +
          `since ${prev.date} (latest snapshot ${cur.date}).`
      );
    }
  } catch (err) {
    log.warn(`[digest] markets/snapshots failed: ${errMsg(err)}`);
  }

  return items;
}

async function gatherPolitics(afterSince: AfterSince): Promise<string[]> {
  const items: string[] = [];
  try {
    const feed = await loadPoliticsFeedPayload();
    const bills = ((feed.bills as BillRecord[] | undefined) ?? [])
      .filter((b) => afterSince(b.latestActionDate ?? b.introducedDate ?? b.updateDate))
      .slice(0, 8);
    for (const b of bills) {
      items.push(`${b.officialId}: ${b.title}${b.latestAction ? ` — ${b.latestAction}` : ''}.`);
    }
    const eos = ((feed.executiveActions as ExecutiveActionRecord[] | undefined) ?? [])
      .filter((a) => afterSince(a.issuedDate))
      .slice(0, 6);
    for (const a of eos) {
      items.push(`${a.type.replace(/_/g, ' ')}: ${a.title} (${a.issuedDate}).`);
    }
    const trades = ((feed.trades as { trades?: TradeRecord[] } | undefined)?.trades ?? [])
      .filter((t) => afterSince(t.filingDate ?? t.tradeDate))
      .slice(0, 12);
    for (const t of trades) {
      items.push(
        `${t.politicianName} (${t.chamber}) ${t.category} ${t.ticker ?? t.assetName}` +
          `${t.amount ? ` ${t.amount}` : ''} — traded ${t.tradeDate}` +
          `${t.filingDate ? `, filed ${t.filingDate}` : ''}.`
      );
    }
  } catch (err) {
    log.warn(`[digest] politics failed: ${errMsg(err)}`);
  }
  return items;
}

async function gatherFinance(
  afterSince: AfterSince,
  includeBodies: boolean,
  includeState: boolean
): Promise<string[]> {
  const items: string[] = [];

  try {
    const sales = await loadSalesData();
    const productName = new Map(sales.products.map((p) => [p.id, p.name]));
    const recent = sales.sales.filter((s) => afterSince(s.date));
    if (recent.length) {
      const total = recent.reduce((sum, s) => sum + (s.total ?? 0), 0);
      const products = [
        ...new Set(recent.map((s) => productName.get(s.productId) ?? 'item')),
      ].slice(0, 5);
      items.push(
        `${recent.length} sale${recent.length === 1 ? '' : 's'} totaling ` +
          `$${total.toLocaleString()} (${products.join(', ')}).`
      );
    }
  } catch (err) {
    log.warn(`[digest] finance/sales failed: ${errMsg(err)}`);
  }

  try {
    const mileage = await loadMileageData();
    const recent = mileage.entries.filter((e) => afterSince(e.date));
    if (recent.length) {
      const miles = recent.reduce((s, e) => s + (e.tripMiles ?? 0), 0);
      items.push(
        `${recent.length} business trip${recent.length === 1 ? '' : 's'} logged, ` +
          `${miles.toFixed(0)} miles (~$${(miles * mileage.irsRate).toFixed(0)} deductible).`
      );
    }
  } catch (err) {
    log.warn(`[digest] finance/mileage failed: ${errMsg(err)}`);
  }

  try {
    const strat = await getLatestStrategy();
    if (strat && afterSince(strat.createdAt)) {
      items.push(`New investment strategy filed: ${strat.title}.`);
      if (includeBodies) items.push(strat.body);
    }
  } catch (err) {
    log.warn(`[digest] finance/strategy failed: ${errMsg(err)}`);
  }

  // Broker activity — recent trades/dividends (read the activities cache directly).
  try {
    const raw = await fs.readFile(BROKER_ACTIVITIES_FILE, 'utf-8');
    const cache = JSON.parse(raw) as {
      accounts?: Record<
        string,
        {
          activities?: Array<{
            type?: string;
            tradeDate?: string;
            ticker?: string | null;
            description?: string;
            amount?: number;
          }>;
        }
      >;
    };
    const acts = Object.values(cache.accounts ?? {})
      .flatMap((a) => a.activities ?? [])
      .filter((a) => afterSince(a.tradeDate))
      .slice(0, 10);
    for (const a of acts) {
      const sym = a.ticker ?? a.description ?? 'activity';
      const amt = typeof a.amount === 'number' ? ` $${Math.abs(a.amount).toLocaleString()}` : '';
      items.push(
        `Broker ${a.type ?? 'activity'}: ${sym}${amt} (${(a.tradeDate ?? '').slice(0, 10)}).`
      );
    }
  } catch (err) {
    log.warn(`[digest] finance/broker-activity failed: ${errMsg(err)}`);
  }

  // Crypto holdings snapshot (balances — no in-process tx history; the Markets
  // desk carries the net-worth delta). Included in both daily + weekly.
  try {
    const raw = await fs.readFile(CRYPTO_CACHE_FILE, 'utf-8');
    const portfolio = JSON.parse(raw) as {
      totalUsdValue?: number;
      byAsset?: Array<{ asset?: string; usdValue?: number }>;
    };
    if (typeof portfolio.totalUsdValue === 'number') {
      const top = (portfolio.byAsset ?? [])
        .slice()
        .sort((a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0))
        .slice(0, 4)
        .map((b) => b.asset)
        .filter(Boolean)
        .join(', ');
      items.push(
        `Crypto holdings ~$${Math.round(portfolio.totalUsdValue).toLocaleString()}${top ? ` (top: ${top})` : ''}.`
      );
    }
  } catch (err) {
    log.warn(`[digest] finance/crypto failed: ${errMsg(err)}`);
  }

  // Balance sheet — the current "state of things"; WEEKLY only (the
  // over-the-week review, not "stuff fetched today"). Assets from the latest
  // portfolio snapshot (already tracks crypto/broker/bank/gold/property), debts
  // from liabilities + property.
  if (includeState) {
    try {
      const snaps = await loadSnapshots();
      const cur = snaps[snaps.length - 1];
      if (cur) {
        const fmt = (n?: number) => `$${Math.round(n ?? 0).toLocaleString()}`;
        const parts = [
          `crypto ${fmt(cur.cryptoValue)}`,
          `brokerage ${fmt(cur.brokerValue)}`,
          typeof cur.bankValue === 'number' ? `bank ${fmt(cur.bankValue)}` : '',
          typeof cur.goldValue === 'number' && cur.goldValue > 0
            ? `metals ${fmt(cur.goldValue)}`
            : '',
          typeof cur.propertyValue === 'number' && cur.propertyValue > 0
            ? `property equity ${fmt(cur.propertyValue)}`
            : '',
        ].filter(Boolean);
        items.push(
          `Balance sheet (${cur.date}): net worth ${fmt(cur.totalValue)} — ${parts.join(', ')}.`
        );
      }
    } catch (err) {
      log.warn(`[digest] finance/balance-sheet failed: ${errMsg(err)}`);
    }

    try {
      const { entries } = await loadLiabilities();
      const debts = entries.filter((d) => (d.balance ?? 0) > 0);
      if (debts.length) {
        const total = debts.reduce((s, d) => s + (d.balance ?? 0), 0);
        const lines = debts
          .slice(0, 8)
          .map(
            (d) =>
              `${d.name} $${Math.round(d.balance).toLocaleString()} @ ${(d.rate * 100).toFixed(2)}%`
          );
        items.push(
          `Debts (${debts.length}, total $${Math.round(total).toLocaleString()}): ${lines.join('; ')}.`
        );
      }
    } catch (err) {
      log.warn(`[digest] finance/liabilities failed: ${errMsg(err)}`);
    }

    // Real estate detail (weekly).
    try {
      const { entries } = await loadPropertyData();
      for (const p of entries.slice(0, 4)) {
        const mort = p.mortgage
          ? `, mortgage $${Math.round(p.mortgage.balance).toLocaleString()}`
          : '';
        items.push(
          `Property: ${p.name} valued $${Math.round(p.currentValue).toLocaleString()}${mort}.`
        );
      }
    } catch (err) {
      log.warn(`[digest] finance/property failed: ${errMsg(err)}`);
    }

    // Precious metals holdings (weekly) — count + weight, no spot fetch.
    try {
      const { entries } = await loadGoldData();
      if (entries.length) {
        const oz = entries.reduce((s, g) => s + (g.weightOz ?? 0) * (g.quantity ?? 0), 0);
        items.push(`Precious metals: ${entries.length} holdings, ${oz.toFixed(2)} oz total.`);
      }
    } catch (err) {
      log.warn(`[digest] finance/gold failed: ${errMsg(err)}`);
    }
  }

  return items;
}

async function gatherHealth(
  afterSince: AfterSince,
  includeBodies: boolean,
  includeState: boolean
): Promise<string[]> {
  const items: string[] = [];

  // Apple Health daily metrics + new labs + active sickness, per active person.
  try {
    const store = await loadHealthStore();
    const people = (store.people ?? []).filter((p) => !p.archivedAt).slice(0, 4);
    for (const person of people) {
      const parts: string[] = [];

      const snap = latestByPerson(store.snapshots, person.id) as unknown as SnapMetrics | undefined;
      if (snap) {
        const bits: string[] = [];
        const steps = last(snap.activity?.daily)?.steps;
        const rhr = last(snap.heart?.daily)?.restingHR;
        const hrv = last(snap.heart?.daily)?.hrv;
        const sleepMin = last(snap.sleep?.daily)?.asleepMinutes;
        const lb = snap.body?.headline?.currentLb;
        if (typeof steps === 'number') bits.push(`${steps.toLocaleString()} steps`);
        if (typeof rhr === 'number') bits.push(`resting HR ${rhr}`);
        if (typeof hrv === 'number') bits.push(`HRV ${Math.round(hrv)}`);
        if (typeof sleepMin === 'number') bits.push(`${(sleepMin / 60).toFixed(1)}h sleep`);
        if (typeof lb === 'number') bits.push(`${Math.round(lb)} lb`);
        const w = snap.workouts?.headline;
        if (w && typeof w.thisWeekCount === 'number' && w.thisWeekCount > 0) {
          bits.push(
            `${w.thisWeekCount} workout${w.thisWeekCount === 1 ? '' : 's'} this week` +
              `${typeof w.thisWeekMinutes === 'number' ? ` (${w.thisWeekMinutes} min)` : ''}` +
              `${w.favoriteType ? `, mostly ${w.favoriteType}` : ''}`
          );
        }
        if (bits.length) parts.push(bits.join(', '));
      }

      const clinical = latestByPerson(
        store.clinical as unknown as Record<string, { generatedAt?: string }>,
        person.id
      ) as unknown as ClinicalLabs | undefined;
      const newLabs = (clinical?.labsByTest ?? [])
        .map((t) => t.latest)
        .filter((l) => l && afterSince(l.date))
        .slice(0, 4);
      for (const l of newLabs) {
        if (!l) continue;
        const v =
          l.value != null ? `${l.value}${l.unit ? ` ${l.unit}` : ''}` : (l.valueString ?? '');
        const flag = l.interpretation && l.interpretation !== 'N' ? ` (${l.interpretation})` : '';
        parts.push(`new lab ${l.name ?? ''} ${v}${flag}`.replace(/\s+/g, ' ').trim());
      }

      const sickness = Object.values(store.sicknessLogs ?? {})
        .filter((s) => s.personId === person.id && !s.endDate)
        .sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
      if (sickness) {
        parts.push(
          `under the weather — ${sickness.title} (${sickness.severity}, since ${sickness.startDate})`
        );
      }

      if (parts.length) items.push(`${person.name}: ${parts.join('; ')}.`);
    }

    const activeSupps = Object.values(store.nutrition ?? {}).filter((n) => n.status === 'active');
    if (activeSupps.length) items.push(`${activeSupps.length} active supplements in the regimen.`);
  } catch (err) {
    log.warn(`[digest] health/store failed: ${errMsg(err)}`);
  }

  // Full supplement regimen + DNA metadata (no decode) — current "state of
  // things", WEEKLY only.
  if (includeState) {
    try {
      const store = await loadHealthStore();
      const supps = Object.values(store.nutrition ?? {})
        .filter((n) => n.status === 'active')
        .map((n) => {
          const p = n.parsed as { productName?: string; brandName?: string } | null;
          return p?.productName ?? p?.brandName ?? 'supplement';
        })
        .slice(0, 30);
      if (supps.length) items.push(`Active supplement regimen: ${supps.join(', ')}.`);

      for (const person of (store.people ?? []).filter((p) => !p.archivedAt).slice(0, 4)) {
        try {
          const metaRaw = await fs.readFile(
            path.join(DATA_DIR, 'health', person.id, 'dna', 'metadata.json'),
            'utf-8'
          );
          const meta = JSON.parse(metaRaw) as {
            snpsLoaded?: number;
            traitsFound?: number;
            apoeGenotyped?: boolean;
          };
          if (meta.snpsLoaded) {
            items.push(
              `${person.name} DNA on file: ${meta.snpsLoaded.toLocaleString()} SNPs, ` +
                `${meta.traitsFound ?? 0} traits${meta.apoeGenotyped ? ', APOE genotyped' : ''}.`
            );
          }
        } catch {
          /* no DNA for this person */
        }
      }
    } catch (err) {
      log.warn(`[digest] health/weekly-detail failed: ${errMsg(err)}`);
    }
  }

  try {
    const ha = await getLatestHealthAnalysis();
    if (ha && afterSince(ha.createdAt)) {
      items.push(`New health analysis: ${ha.title}.`);
      if (includeBodies) items.push(ha.body);
    }
  } catch (err) {
    log.warn(`[digest] health/analysis failed: ${errMsg(err)}`);
  }

  return items;
}

async function gatherDocs(
  afterSince: AfterSince,
  editionType: EditionType,
  sinceMs: number
): Promise<string[]> {
  const items: string[] = [];

  // New research filed (any domain) — with a one-line intelligence snippet.
  try {
    const entries = await listResearchEntries();
    const recent = entries
      .filter((e) => afterSince(e.reportDate ? `${e.reportDate}T12:00:00` : e.uploadedAt))
      .slice(0, 14);
    for (const e of recent) {
      const snippet = e.intelligence?.summary?.[0]?.text;
      items.push(
        `Filed (${e.domain}): ${e.title ?? e.filename ?? 'untitled'}` +
          `${e.publisher ? ` — ${e.publisher}` : ''}${snippet ? ` — ${snippet}` : ''}.`
      );
    }
  } catch (err) {
    log.warn(`[digest] docs/research failed: ${errMsg(err)}`);
  }

  // Documents uploaded recently across EVERY entity (tax docs, receipts, etc.).
  try {
    const config = await loadConfig();
    const fileLines: string[] = [];
    for (const entity of config.entities) {
      const files = await scanDirectory(path.join(DATA_DIR, entity.path));
      for (const f of files) {
        if (f.lastModified >= sinceMs) fileLines.push(`${entity.name}/${f.name}`);
      }
    }
    if (fileLines.length) {
      items.push(
        `${fileLines.length} document(s) uploaded: ${fileLines.slice(0, 8).join(', ')}` +
          `${fileLines.length > 8 ? ', …' : ''}.`
      );
    }
  } catch (err) {
    log.warn(`[digest] docs/files failed: ${errMsg(err)}`);
  }

  // Deep Research reports finished in the window.
  try {
    const runs = await listRuns();
    const done = runs
      .filter((r) => r.status === 'done' && afterSince(r.completedAt ?? r.createdAt))
      .slice(0, 5);
    for (const r of done) items.push(`Deep Research completed: ${r.question}.`);
  } catch (err) {
    log.warn(`[digest] docs/deep-research failed: ${errMsg(err)}`);
  }

  // Open to-dos touched recently.
  try {
    const todos = await loadTodos();
    const recent = todos
      .filter((t) => t.status === 'pending' && afterSince(t.updatedAt))
      .slice(0, 8);
    for (const t of recent) items.push(`To-do: ${t.title}.`);
  } catch (err) {
    log.warn(`[digest] docs/todos failed: ${errMsg(err)}`);
  }

  // Upcoming reminders / deadlines.
  try {
    const reminders = await loadReminders();
    const horizonDays = editionType === 'weekly' ? 30 : 7;
    const now = Date.now();
    const cutoff = now + horizonDays * 24 * 60 * 60 * 1000;
    const due = reminders
      .filter((r) => r.status === 'pending')
      .filter((r) => {
        const t = new Date(`${r.dueDate}T12:00:00`).getTime();
        return Number.isFinite(t) && t >= now - 24 * 60 * 60 * 1000 && t <= cutoff;
      })
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .slice(0, 10);
    for (const r of due) items.push(`Due ${r.dueDate}: ${r.title}.`);
  } catch (err) {
    log.warn(`[digest] docs/reminders failed: ${errMsg(err)}`);
  }

  return items;
}

// The FULL text of research filed in-window, grouped by publisher (ZeroHedge,
// Lyn Alden, George Gammon, political transcripts, …) so the editor can actually
// read and synthesize the analysis, not just the titles. Runs for BOTH editions
// — the window scopes it: the day's filings for the daily, the week's for the
// weekly.
async function gatherResearchDeep(afterSince: AfterSince): Promise<string[]> {
  const items: string[] = [];
  try {
    const entries = (await listResearchEntries())
      .filter((e) => afterSince(e.reportDate ? `${e.reportDate}T12:00:00` : e.uploadedAt))
      .filter((e) => (e.text ?? '').trim().length > 0)
      .slice(0, 20);
    for (const e of entries) {
      const who = e.publisher ?? e.author ?? e.domain;
      const when = e.reportDate ?? e.uploadedAt.slice(0, 10);
      const body = (e.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 2800);
      items.push(`### ${e.title ?? 'Untitled'} — ${who} (${e.domain}, ${when})\n${body}`);
    }
    log.info(`[digest] research-deep: ${items.length} full-text entries`);
  } catch (err) {
    log.warn(`[digest] research-deep failed: ${errMsg(err)}`);
  }
  return items;
}

/** Week-ahead forecast for the configured location (Open-Meteo); null when
 *  weather is disabled/unconfigured or the fetch fails. Not windowed by sinceISO
 *  — it's a forward forecast, the same in daily and weekly editions. */
async function gatherWeather(): Promise<WeatherForecast | null> {
  try {
    const cfg = await getWeatherConfig();
    if (!cfg.enabled || cfg.latitude == null || cfg.longitude == null) return null;
    return await fetchWeekForecast({
      latitude: cfg.latitude,
      longitude: cfg.longitude,
      label: cfg.label,
      units: cfg.units,
    });
  } catch (err) {
    log.warn(`[digest] weather failed: ${errMsg(err)}`);
    return null;
  }
}

/** Gather the full digest across all desks, windowed by `sinceISO`. */
export async function gatherDigest(editionType: EditionType, sinceISO: string): Promise<Digest> {
  const since = new Date(sinceISO).getTime();
  // Date-only values (YYYY-MM-DD) are treated as end-of-day so a same-day item
  // counts. Soft-returns false for unparseable/missing dates.
  const afterSince: AfterSince = (d) => {
    if (!d) return false;
    const iso = d.length === 10 ? `${d}T23:59:59` : d;
    const t = new Date(iso).getTime();
    return Number.isFinite(t) && t >= since;
  };
  // Two independent axes of depth:
  //  • includeBodies — the FULL TEXT of items fetched in-window (research full
  //    text, strategy + health-analysis bodies). ON for BOTH editions so the
  //    DAILY treats the day's fetched items with real depth, not just headlines;
  //    the window (narrow for daily, 7d for weekly) is what scopes it.
  //  • includeState — the current "state of things" (balance sheet, debts,
  //    property, metals, DNA, full supplement roster). WEEKLY only — that's the
  //    over-the-week review, not "stuff fetched that day".
  const includeBodies = true;
  const includeState = editionType === 'weekly';
  const t0 = Date.now();

  const [markets, politics, finance, health, docs, researchDeep, weather] = await Promise.all([
    gatherMarkets(),
    gatherPolitics(afterSince),
    gatherFinance(afterSince, includeBodies, includeState),
    gatherHealth(afterSince, includeBodies, includeState),
    gatherDocs(afterSince, editionType, since),
    gatherResearchDeep(afterSince),
    gatherWeather(),
  ]);

  const desks: Array<[string, string[]]> = [
    ['Markets & Macro', markets],
    ['Politics', politics],
    ['Personal Finance & Business', finance],
    ['Health', health],
    ['Research & Analysis', researchDeep],
    ['Documents & Deadlines', docs],
  ];
  const sections = desks
    .filter(([, list]) => list.length > 0)
    .map(([desk, list]) => ({ desk, items: list }));
  const itemCount = sections.reduce((n, s) => n + s.items.length, 0);
  const sources = sections.map((s) => s.desk);

  log.info(
    `[digest] type=${editionType} since=${sinceISO} ` +
      `markets=${markets.length} politics=${politics.length} finance=${finance.length} ` +
      `health=${health.length} research=${researchDeep.length} docs=${docs.length} ` +
      `weather=${weather ? `${weather.days.length}d` : 'off'} ` +
      `(sections=${sections.length} items=${itemCount}) in ${Date.now() - t0}ms`
  );
  return { editionType, sinceISO, sections, itemCount, sources, weather: weather ?? undefined };
}

// ===========================================================================
// Prompt construction
// ===========================================================================

function buildSystem(
  editionType: EditionType,
  title: string,
  brain: string,
  themePrompt: string
): string {
  const parts = [
    `You are the editor-in-chief of "${title}", a personal daily newspaper for a single reader (the owner of this data).`,
    "You are given a structured digest of everything that changed across the owner's data since the last edition, organized by desk.",
    'Write a cohesive newspaper edition in clean markdown. Open with a one-paragraph front-page lede summarizing the single most important development. Then write one `##` section per desk, in the order given, in tight journalistic prose (not bullet dumps) — lead with what changed and why it matters, cite the specific numbers, dates, and names from the digest. Cover EVERY desk that has material (the digest is comprehensive — markets, politics, personal finance, health, research, documents); omit only a desk with genuinely no items.',
    'When the "Research & Analysis" desk is present it carries the FULL text of newly-filed research (ZeroHedge, Lyn Alden, George Gammon, political transcripts, etc.) — actually read it and synthesize the key arguments, attributing analysts by name, rather than merely noting that a piece was filed.',
    editionType === 'weekly'
      ? 'This is the WEEKLY DEEP-DIVE, covering the whole week: be substantial and thorough. Draw connections across desks, surface the week\'s through-lines, weave in the "state of things" the digest provides (balance sheet, holdings, health baselines), and end with a "## The Week in Review" synthesis and a "## Looking Ahead" section. Let the length match the depth of the material — a rich week warrants a long edition.'
      : "This is the DAILY edition, covering only what arrived since the last edition — the day's developments. Be substantive about that day: read and synthesize the full research filed today and report the concrete new items with their numbers and names. Keep the scope to the day — do not recap the whole week or restate standing balances (the weekly deep-dive does the week-in-review).",
    'Use ONLY facts present in the digest — do not invent data, prices, or events, and do not speculate beyond what is given. If the digest is sparse, write a short edition; never pad.',
    'Output clean markdown only — no preamble like "Here is the edition".',
    'Do NOT write your own masthead, publication name, dateline, or "Edition" header — the page already renders the title and date. Start directly with the front-page lede.',
  ];
  if (themePrompt.trim()) {
    parts.push(`House style — write it ${themePrompt.trim()}`);
  }
  if (brain.trim()) {
    parts.push(
      '\n--- Standing context about the owner (weave in for relevance; do not quote verbatim) ---\n' +
        brain.trim()
    );
  }
  return parts.join('\n');
}

function renderDigestPrompt(digest: Digest, title: string, dateLabel: string): string {
  const lines: string[] = [
    `Edition: ${title} — ${digest.editionType === 'weekly' ? 'WEEKLY DEEP-DIVE' : 'DAILY'} for ${dateLabel}.`,
    `Digest window: changes since ${digest.sinceISO}.`,
    '',
  ];
  if (!digest.sections.length) {
    lines.push('(No material changes were detected across the data sources in this window.)');
  }
  for (const s of digest.sections) {
    lines.push(`## ${s.desk}`);
    for (const item of s.items) lines.push(`- ${item}`);
    lines.push('');
  }
  if (digest.weather) {
    lines.push(
      `Weather — week ahead for ${digest.weather.label} (a weather box is rendered ` +
        `separately, so do NOT write a dedicated weather section; you MAY work it into ` +
        `one brief line of the lede if it's relevant):`
    );
    for (const line of forecastToLines(digest.weather)) lines.push(`- ${line}`);
    lines.push('');
  }
  return lines.join('\n');
}

// ===========================================================================
// Generation — dispatches to the configured backend (api / claude / codex).
// ===========================================================================

/** Synthesize an edition. Pure function of its inputs (the store supplies the
 *  window) so it is trivially testable with a fake backend. */
export async function generateEdition(
  editionType: EditionType,
  editionDate: string,
  sinceISO: string
): Promise<GenerateResult> {
  const digest = await gatherDigest(editionType, sinceISO);
  return synthesizeEdition(editionType, editionDate, sinceISO, digest);
}

/** Synthesize one edition from an ALREADY-GATHERED digest. `themeOverride`
 *  forces a specific theme's voice + hero-image style; without it the configured
 *  theme is used. Gathering is split out so the theme sampler can gather ONCE
 *  and synthesize the same digest in every house style. */
export async function synthesizeEdition(
  editionType: EditionType,
  editionDate: string,
  sinceISO: string,
  digest: Digest,
  themeOverride?: string
): Promise<GenerateResult> {
  const startedAt = Date.now();
  const [{ mode, agentBackend, model, theme: configTheme }, title, brain] = await Promise.all([
    getDailyNewsConfig(),
    getDailyNewsTitle(),
    readBrainContent().catch(() => ''),
  ]);
  // A sampler override wins; otherwise resolve the config theme — which turns
  // the special 'cycle' pick into a concrete style based on the edition date.
  const theme = themeOverride ?? resolveTheme(configTheme, editionDate);

  const system = buildSystem(editionType, title, brain, getThemePrompt(theme));
  const prompt = renderDigestPrompt(digest, title, formatEditionDate(editionDate));
  const backend =
    mode === 'agent' ? `agent/${agentBackend}` : `api/${model.provider}:${model.model}`;
  log.info(
    `[generate] type=${editionType} theme=${theme} backend=${backend} digestItems=${digest.itemCount}`
  );

  let body: string;
  let usage: { inputTokens: number; outputTokens: number };
  if (mode !== 'agent') {
    ({ body, usage } = await runDailyNewsApi(system, prompt, model));
  } else if (agentBackend === 'codex') {
    ({ body, usage } = await runDailyNewsCodexAgent(system, prompt));
  } else {
    ({ body, usage } = await runDailyNewsClaudeAgent(system, prompt));
  }

  log.info(
    `[generate] done type=${editionType} theme=${theme} bodyChars=${body.length} in ${Date.now() - startedAt}ms`
  );
  return {
    title,
    body: body.trim(),
    theme,
    usage,
    digestMeta: { sources: digest.sources, sinceISO, itemCount: digest.itemCount },
    weather: digest.weather,
  };
}

function textOf(response: Anthropic.Messages.Message): string {
  let body = '';
  for (const block of response.content) if (block.type === 'text') body += block.text;
  return body;
}

/** API engine — a single messages.create. Provider-flexible (no web_search). */
async function runDailyNewsApi(
  system: string,
  prompt: string,
  ref: ModelRef
): Promise<{ body: string; usage: { inputTokens: number; outputTokens: number } }> {
  const startedAt = Date.now();
  let response: Anthropic.Messages.Message;
  if (ref.provider === 'openai') {
    response = await openaiComplete(
      {
        system,
        userContent: [{ type: 'text', text: prompt }],
        maxTokens: MAX_OUTPUT_TOKENS,
        purpose: 'daily-news',
      },
      ref.model
    );
  } else {
    const client = await getClient();
    response = await client.messages.create({
      model: ref.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system,
      messages: [{ role: 'user', content: prompt }],
    });
  }
  const usage = {
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
  };
  void logAiCall({
    model: `${ref.provider}:${ref.model}`,
    purpose: 'daily-news',
    latencyMs: Date.now() - startedAt,
    usage,
    ok: true,
    requestId: response.id ?? null,
    stopReason: response.stop_reason ?? null,
  });
  return { body: textOf(response), usage };
}

/** Claude agent engine — Claude Code on the subscription, NO web tools. */
async function runDailyNewsClaudeAgent(
  system: string,
  prompt: string
): Promise<{ body: string; usage: { inputTokens: number; outputTokens: number } }> {
  const oauthToken = await getAnthropicAuthToken();
  const apiKey = await getAnthropicKey();
  const startedAt = Date.now();
  const env: Record<string, string | undefined> = {
    ...process.env,
    ...(oauthToken ? { CLAUDE_CODE_OAUTH_TOKEN: oauthToken } : {}),
    ...(apiKey ? { ANTHROPIC_API_KEY: apiKey } : {}),
  };

  let body = '';
  let inputTokens = 0;
  let outputTokens = 0;
  for await (const message of query({
    prompt,
    options: {
      model: DEFAULT_MODEL,
      systemPrompt: { type: 'preset', preset: 'claude_code', append: system },
      // Synthesis only — the digest is the corpus, so no tools.
      allowedTools: [],
      disallowedTools: [
        'Bash',
        'Read',
        'Edit',
        'Write',
        'Glob',
        'Grep',
        'NotebookEdit',
        'WebSearch',
        'WebFetch',
      ],
      env,
      cwd: '/tmp',
      ...(CLAUDE_BINARY_PATH ? { pathToClaudeCodeExecutable: CLAUDE_BINARY_PATH } : {}),
    },
  })) {
    if (message.type === 'assistant') {
      for (const block of message.message.content) if (block.type === 'text') body += block.text;
    } else if (message.type === 'result') {
      inputTokens = message.usage?.input_tokens ?? 0;
      outputTokens = message.usage?.output_tokens ?? 0;
    }
  }

  const usage = { inputTokens, outputTokens };
  void logAiCall({
    model: `agent:${DEFAULT_MODEL}`,
    purpose: 'daily-news',
    latencyMs: Date.now() - startedAt,
    usage,
    ok: true,
    requestId: null,
    stopReason: null,
  });
  return { body, usage };
}

/** Defensively pull input/output token counts out of a codex app-server
 *  notification — the token-usage payload shape has varied across codex
 *  versions, so try the common wrapper keys + field names. */
function readCodexUsage(p: Record<string, unknown>): { input: number; output: number } | null {
  const numOf = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  const fromObj = (o: unknown): { input: number; output: number } | null => {
    if (!o || typeof o !== 'object') return null;
    const r = o as Record<string, unknown>;
    const input = numOf(r.input_tokens) ?? numOf(r.inputTokens) ?? numOf(r.prompt_tokens);
    const output = numOf(r.output_tokens) ?? numOf(r.outputTokens) ?? numOf(r.completion_tokens);
    return input != null || output != null ? { input: input ?? 0, output: output ?? 0 } : null;
  };
  const rec = p as Record<string, unknown>;
  // codex v0.136 shape: params.tokenUsage.total.{inputTokens,outputTokens,...}
  // (inputTokens already includes cachedInputTokens). Prefer the cumulative
  // `total`; fall back through `last` and older/looser shapes.
  const tu = (rec.tokenUsage ?? {}) as Record<string, unknown>;
  return (
    fromObj(tu.total) ??
    fromObj(tu.last) ??
    fromObj(rec.tokenUsage) ??
    fromObj(rec.usage) ??
    fromObj(rec.total_token_usage) ??
    fromObj(rec.last_token_usage) ??
    fromObj(rec.info) ??
    fromObj(rec) ??
    null
  );
}

/** Codex agent engine — codex app-server on the OpenAI subscription, NO web_search. */
async function runDailyNewsCodexAgent(
  system: string,
  prompt: string
): Promise<{ body: string; usage: { inputTokens: number; outputTokens: number } }> {
  const { codexHome, binaryPath, model } = await getCodexChatConfig();
  const startedAt = Date.now();
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'docvault-dailynews-'));

  let body = '';
  let turnError: string | null = null;
  let inputTokens = 0;
  let outputTokens = 0;
  let done = false;
  let resolveDone!: () => void;
  const donePromise = new Promise<void>((r) => {
    resolveDone = r;
  });
  const finish = () => {
    if (!done) {
      done = true;
      resolveDone();
    }
  };

  const onNotification = (n: CodexNotification) => {
    const p = (n.params ?? {}) as Record<string, unknown>;
    if (n.method === 'item/agentMessage/delta') {
      if (typeof p.delta === 'string') body += p.delta;
    } else if (n.method === 'item/completed') {
      // Fallback: a turn can deliver the message as one completed item rather
      // than streamed deltas — capture it if no deltas arrived.
      const item = (p.item ?? {}) as { type?: string; text?: string };
      if (!body && item.type === 'agentMessage' && typeof item.text === 'string') {
        body += item.text;
      }
    } else if (/token/i.test(n.method)) {
      // Token usage — codex streams this (e.g. thread/tokenUsage/updated) as the
      // turn runs; keep the latest. Log the raw shape so readCodexUsage's field
      // mapping can be confirmed/extended for this codex version.
      const u = readCodexUsage(p);
      if (u) {
        inputTokens = u.input;
        outputTokens = u.output;
      }
      log.info(`[codex] tokenUsage in=${inputTokens} out=${outputTokens}`);
    } else if (n.method === 'error') {
      turnError = typeof p.message === 'string' ? p.message : 'codex error';
      log.warn(`[codex] error notification: ${turnError}`);
      finish();
    } else if (n.method === 'turn/completed') {
      // Final usage sometimes rides on turn/completed rather than a separate event.
      const u = readCodexUsage(p);
      if (u) {
        inputTokens = u.input;
        outputTokens = u.output;
      }
      finish();
    }
  };

  const client = new CodexAppServerClient({
    binaryPath,
    cwd,
    codexHome,
    onNotification,
    // Answer codex's server-requests — crucially the ChatGPT auth-token refresh
    // (relayed from auth.json). Returning null here is what made codex fail fast
    // with an empty turn; reuse the working chat path's handler.
    onServerRequest: (r) => handleCodexServerRequest(r, codexHome),
    onExit: (code) => {
      if (!done && code != null && code !== 0) {
        turnError = turnError ?? `codex app-server exited (code ${code})`;
      }
      finish();
    },
  });

  try {
    await client.initialize({ name: 'docvault', title: 'DocVault', version: '1.0.0' });
    const threadId = await client.startThread({
      cwd,
      ...(model ? { model } : {}),
      modelProvider: 'openai',
      approvalPolicy: 'never',
      sandbox: 'read-only',
      developerInstructions: system,
    });
    await client.startTurn({ threadId, input: [{ type: 'text', text: prompt }] });
    await donePromise;
  } finally {
    client.kill();
    await fs.rm(cwd, { recursive: true, force: true }).catch(() => undefined);
  }

  const usage = { inputTokens, outputTokens };
  const ok = body.trim().length > 0;
  void logAiCall({
    model: 'codex-agent',
    purpose: 'daily-news',
    latencyMs: Date.now() - startedAt,
    usage,
    ok,
    requestId: null,
    stopReason: turnError,
  });
  // An empty edition is never useful — surface it as an error instead of
  // completing a blank paper (which would still trigger an image + email).
  if (!ok) {
    throw new Error(turnError ?? 'codex returned an empty edition (no text emitted)');
  }
  return { body, usage };
}

// ===========================================================================
// Delivery — email the finished edition (best-effort, never throws).
// ===========================================================================

/** Email a completed edition if email is enabled. The fully-formatted edition
 *  rides along as an .html attachment; the body is an email-safe summary. */
export async function notifyEditionReady(edition: Edition): Promise<void> {
  let cfg;
  try {
    cfg = await getEmailConfig();
  } catch (err) {
    log.warn(`[notify] could not read email config: ${errMsg(err)}`);
    return;
  }
  if (!cfg.enabled) {
    log.info(`[notify] skipped (email disabled) id=${edition.id}`);
    return;
  }

  const kind = edition.editionType === 'weekly' ? 'Weekly' : 'Daily';
  const subject = `${edition.title ?? 'Daily News'} — ${kind}, ${formatEditionDate(edition.editionDate)}`;

  // Inline the headline image (if any) as a data URI so both the email body and
  // the self-contained .html attachment carry it.
  let heroSrc: string | undefined;
  if (edition.imagePath) {
    const bytes = await readEditionImage(edition.id);
    if (bytes) heroSrc = `data:image/png;base64,${bytes.toString('base64')}`;
  }

  const attachment = {
    filename: `${editionFilename(edition)}.html`,
    content: Buffer.from(renderEditionHtml(edition, heroSrc), 'utf-8').toString('base64'),
    contentType: 'text/html',
  };
  const res = await sendEmail({
    subject,
    html: renderEditionEmailHtml(edition, heroSrc),
    attachments: [attachment],
  });
  if (res.ok) log.info(`[notify] emailed id=${edition.id} resendId=${res.id ?? '?'}`);
  else log.warn(`[notify] email failed id=${edition.id}: ${res.error}`);
}
