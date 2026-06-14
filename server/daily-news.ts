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
  loadSettings,
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
  loadIncomeData,
  loadEstimatedTaxes,
  loadContributions,
  loadAssets,
  loadFederalTax,
  DATA_DIR,
  BROKER_ACTIVITIES_FILE,
  BROKER_CACHE_FILE,
  CRYPTO_CACHE_FILE,
  DEFAULT_MODEL,
  toAnthropicApiEffort,
  toClaudeAgentEffort,
  toOpenAIEffort,
  type ModelRef,
} from './data.js';
import { fetchWeekForecast, forecastToLines, type WeatherForecast } from './weather.js';
import { listResearchEntries, type ResearchEntry } from './routes/research.js';
import { getLatestStrategy } from './routes/strategy.js';
import { getLatestHealthAnalysis } from './routes/health-analysis.js';
import { renderNarrationAtSpeed } from './daily-news-narration.js';
import { handleHealthRoutes } from './routes/health.js';
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

type WarningSink = (source: string, err: unknown) => void;

function emitDigestWarning(warn: WarningSink | undefined, source: string, err: unknown): void {
  if (warn) {
    warn(source, err);
    return;
  }
  log.warn(`[digest] ${source} failed: ${errMsg(err)}`);
}

export interface DigestSection {
  /** The desk heading, e.g. "Markets & Macro". */
  desk: string;
  /** Pre-summarized bullet strings — the LLM does editorial synthesis, not parsing. */
  items: string[];
}

export interface DigestSourceWarning {
  /** Stable source id, e.g. "politics/feed" or "research/full-text". */
  source: string;
  /** User-safe failure note; no secrets, stack traces, or raw payloads. */
  message: string;
}

/** One ingested item (research filing, upload, deep-research run) — the
 *  debugging ledger of exactly what fed this edition. */
export interface PulledItem {
  /** Origin tag, e.g. 'research/finance', 'upload', 'deep-research'. */
  source: string;
  title: string;
  /** Original article/video URL when the item carries one — linkified in the
   *  "Sources pulled" appendix (web + email). */
  url?: string;
}

/** A digest source tag ([S1], [S2], …) → its original URL. The model cites
 *  with the short tag; the server joins the URL afterwards. */
export interface SourceCitation {
  ref: string;
  url: string;
}

/**
 * Replace model-emitted citations with inline markdown links. The model only
 * ever types short tags — `[key phrase][S12]` or a bare `[S12]` — so URLs
 * can't be mistyped or hallucinated; unknown tags are stripped. Inline links
 * (not reference-style) are written into the stored body so every renderer
 * (SafeMarkdown in-app, marked for HTML/email) handles them identically.
 */
export function applySourceCitations(body: string, citations: SourceCitation[]): string {
  if (!citations.length) {
    // Still strip stray tags so a model mistake never reaches readers.
    return body.replace(/\s?\[S\d+\]/g, '');
  }
  const byRef = new Map(citations.map((c) => [c.ref, c.url]));
  let out = body.replace(/\[([^\]\n]+)\]\[(S\d+)\]/g, (_m, text: string, ref: string) => {
    const url = byRef.get(ref);
    return url ? `[${text}](${url})` : text;
  });
  // Bare tags ("…shorts have tripled [S12].") become unobtrusive numbered
  // links — renumbered 1..N in reading order, since the internal S-numbers
  // follow digest order and would look arbitrary on the page.
  const displayN = new Map<string, number>();
  out = out.replace(/\s?\[(S\d+)\]/g, (_m, ref: string) => {
    const url = byRef.get(ref);
    if (!url) return '';
    const n = displayN.get(ref) ?? displayN.set(ref, displayN.size + 1).get(ref)!;
    return ` [[${n}]](${url})`;
  });
  return out;
}

export interface Digest {
  editionType: EditionType;
  sinceISO: string;
  sections: DigestSection[];
  itemCount: number;
  /** Desk names that contributed at least one item. */
  sources: string[];
  /** Every item ingested in-window — rendered as a "Sources pulled" appendix. */
  pulled: PulledItem[];
  /** [S#] → URL map for the research items tagged in this digest. */
  citations?: SourceCitation[];
  /** Ingestion/cache failures that were skipped while composing this edition. */
  sourceWarnings: DigestSourceWarning[];
  /** Week-ahead forecast for the rendered weather box (Open-Meteo); optional. */
  weather?: WeatherForecast;
}

export interface GenerateResult {
  title: string;
  body: string;
  /** Theme id used — passed to the store so it can render a matching hero image. */
  theme: string;
  usage: { inputTokens: number; outputTokens: number };
  /** Which model wrote this edition and whether it ran on a subscription or
   *  billed API credits — surfaced in the Reader so the user can see it. */
  generatedBy?: { model: string; billing: 'subscription' | 'api'; backend: string };
  digestMeta: {
    sources: string[];
    sinceISO: string;
    itemCount: number;
    pulled?: PulledItem[];
    sourceWarnings?: DigestSourceWarning[];
  };
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

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Mean of the last `n` numeric values pulled from a daily series (skips
 *  null/undefined). Used to turn a daily metric into a weekly average so a
 *  weekly edition reports the week, not a single (possibly atypical) day. */
function avgLastN<T>(
  arr: readonly T[] | undefined,
  pick: (x: T) => number | null | undefined,
  n = 7
): number | undefined {
  if (!arr?.length) return undefined;
  const vals = arr
    .slice(-n)
    .map(pick)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (!vals.length) return undefined;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
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
  activity?: {
    daily?: Array<{ date?: string; steps?: number | null; steps7dAvg?: number | null }>;
  };
  heart?: { daily?: Array<{ restingHR?: number | null; hrv?: number | null }> };
  sleep?: {
    daily?: Array<{
      asleepMinutes?: number | null;
      deepMinutes?: number | null;
      remMinutes?: number | null;
    }>;
  };
  body?: { headline?: { currentLb?: number | null } };
  workouts?: {
    headline?: {
      thisWeekCount?: number;
      thisWeekMinutes?: number;
      currentStreakDays?: number;
      favoriteType?: string | null;
    };
    recent?: Array<{
      type?: string;
      start?: string;
      durationMinutes?: number;
      avgHR?: number | null;
    }>;
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

export function selectDailyNewsStepCount(
  dailyAct: NonNullable<SnapMetrics['activity']>['daily'] | undefined,
  opts: { useAverage: boolean; editionDate?: string }
): number | undefined {
  const lastAct = last(dailyAct);
  if (opts.useAverage) return lastAct?.steps7dAvg ?? avgLastN(dailyAct, (d) => d.steps);

  // Steps accumulate across the day, so the latest day is only partial at a
  // morning edition (e.g. a few hundred steps by 9am). Use the last COMPLETE
  // day — the most recent before the edition's date in the configured tz —
  // for the daily step count.
  const cutoff =
    opts.editionDate && /^\d{4}-\d{2}-\d{2}$/.test(opts.editionDate) ? opts.editionDate : undefined;
  const lastCompleteAct = cutoff
    ? (last((dailyAct ?? []).filter((d) => d.date != null && d.date < cutoff)) ?? lastAct)
    : lastAct;
  return lastCompleteAct?.steps ?? undefined;
}

// Markets shows the CURRENT market state (signals, watchlist) plus the net-worth
// change over the edition's window (weekly = the week, daily = since the last
// edition) — so it needs editionType + sinceISO for that delta.
async function gatherMarkets(
  editionType: EditionType,
  sinceISO: string,
  warn?: WarningSink
): Promise<string[]> {
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
      // No absolute price here — the live watchlist quote below is the single
      // source of BTC's spot price; printing this signal's (often staler) price
      // too produced two different BTC prices in the same edition.
      items.push(
        `Bitcoin ${Math.abs(dd.drawdown * 100).toFixed(1)}% below its all-time high ` +
          `of $${Math.round(dd.ath).toLocaleString()}, ${dd.daysSinceAth}d past the peak.`
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
      const all = [...(preds.finance ?? []), ...(preds.politics ?? [])]
        .filter((m) => typeof m.probability === 'number')
        .sort((a, b) => (b.volumeUsd ?? 0) - (a.volumeUsd ?? 0));
      // One market per watchlist topic, highest-volume first. Raw volume
      // ranking surfaces six election markets and nothing else — elections
      // dwarf every other market's volume on both providers.
      const byTopic = new Map<string, (typeof all)[number]>();
      for (const m of all) {
        const key = m.topic || m.question;
        if (!byTopic.has(key)) byTopic.set(key, m);
      }
      for (const m of [...byTopic.values()].slice(0, 6)) {
        items.push(
          `Prediction (${m.source}, ${m.topic}): "${m.question}" — ${Math.round(m.probability)}% yes.`
        );
      }
    }
  } catch (err) {
    emitDigestWarning(warn, 'markets/quant', err);
  }

  // Precious-metals spot — the owner holds physical gold/silver, so give metals
  // a market signal of their own (symmetric with the crypto signals above)
  // rather than letting them surface only as a balance-sheet holdings count.
  const METALS_SYMBOLS = ['GLD', 'SLV'] as const;
  const metalsLabel: Record<string, string> = { GLD: 'Gold (GLD)', SLV: 'Silver (SLV)' };
  try {
    const { quotes } = await fetchTickerPrices([...METALS_SYMBOLS]);
    const spot = quotes
      .filter((q) => q && q.price != null)
      .map(
        (q) =>
          `${metalsLabel[q.symbol] ?? q.symbol} ` +
          `$${q.price!.toLocaleString(undefined, { maximumFractionDigits: 2 })}` +
          (q.oneYearChangePct != null
            ? ` (${q.oneYearChangePct >= 0 ? '+' : ''}${q.oneYearChangePct.toFixed(0)}% 1y)`
            : '')
      );
    if (spot.length) items.push(`Precious metals spot: ${spot.join(', ')}.`);
  } catch (err) {
    emitDigestWarning(warn, 'markets/metals', err);
  }

  // Watchlist — symbols tagged on finance research entries (cache-first quotes).
  // Metals proxies are excluded here; they get their own signal line above.
  try {
    const finance = await listResearchEntries('finance');
    const symbols = [...new Set(finance.flatMap((e) => e.tickers ?? []))]
      .filter((s) => !METALS_SYMBOLS.includes(s as (typeof METALS_SYMBOLS)[number]))
      .slice(0, 10);
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
    emitDigestWarning(warn, 'markets/tickers', err);
  }

  // Portfolio net-worth change over the edition's WINDOW (weekly = the week,
  // daily = since the last edition). Baseline = the first snapshot on/after the
  // window start, NOT merely the previous snapshot — which for a weekly would
  // report a single overnight move as the whole week's story. Starting in-window
  // also sidesteps a pre-window data glitch (e.g. a partial-load outlier).
  try {
    const snaps = (await loadSnapshots()).slice().sort((a, b) => a.date.localeCompare(b.date));
    const cur = last(snaps);
    const sinceDate = sinceISO.slice(0, 10);
    let base = snaps.find((s) => s.date >= sinceDate);
    // Outlier guard: a baseline wildly off its next snapshot (>25%) is almost
    // certainly a bad snapshot (partial load) — step forward one.
    if (base) {
      const nxt = snaps[snaps.indexOf(base) + 1];
      if (
        nxt &&
        base.totalValue > 0 &&
        Math.abs(nxt.totalValue - base.totalValue) / base.totalValue > 0.25
      ) {
        base = nxt;
      }
    }
    if (cur && base && base !== cur && base.totalValue > 0) {
      const delta = cur.totalValue - base.totalValue;
      const pct = Math.abs((delta / base.totalValue) * 100);
      const span = editionType === 'weekly' ? 'this week' : 'since the last edition';
      items.push(
        `Portfolio net worth ${delta >= 0 ? 'up' : 'down'} ${pct.toFixed(1)}% ${span} ` +
          `($${Math.round(base.totalValue).toLocaleString()} on ${base.date} → ` +
          `$${Math.round(cur.totalValue).toLocaleString()} on ${cur.date}).`
      );
      // Per-sleeve moves so Markets & Macro covers EVERY asset class the owner
      // holds — crypto, equities, precious metals, real estate — not just the
      // loudest one. Without these deltas the desk only had crypto signals to
      // chew on, so editions read crypto-only even when metals/property moved.
      // Every sleeve that composes totalValue (scheduler.ts: crypto + brokerage
      // + bank + gold + property). Keep this list complete so "by asset class"
      // actually reconciles to the net-worth move above — a missing sleeve would
      // make the parts silently fail to sum to the whole.
      const sleeves: Array<[string, number | undefined, number | undefined]> = [
        ['crypto', base.cryptoValue, cur.cryptoValue],
        ['brokerage', base.brokerValue, cur.brokerValue],
        ['cash', base.bankValue, cur.bankValue],
        ['precious metals', base.goldValue, cur.goldValue],
        ['real estate equity', base.propertyValue, cur.propertyValue],
      ];
      const moves = sleeves
        .filter(([, b, c]) => typeof b === 'number' && b > 0 && typeof c === 'number')
        .map(([name, b, c]) => {
          const d = (c as number) - (b as number);
          const p = (d / (b as number)) * 100;
          const move = Math.abs(p) < 0.5 ? 'flat' : `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`;
          return (
            `${name} ${move} ` +
            `($${Math.round(b as number).toLocaleString()} → $${Math.round(c as number).toLocaleString()})`
          );
        });
      if (moves.length) {
        const lead =
          editionType === 'weekly'
            ? 'By asset class this week'
            : 'By asset class since the last edition';
        items.push(`${lead}: ${moves.join('; ')}.`);
      }
    }
  } catch (err) {
    emitDigestWarning(warn, 'markets/snapshots', err);
  }

  return items;
}

async function gatherPolitics(afterSince: AfterSince, warn?: WarningSink): Promise<string[]> {
  const items: string[] = [];
  try {
    const feed = await loadPoliticsFeedPayload();
    const bills = ((feed.bills as BillRecord[] | undefined) ?? []).filter((b) =>
      afterSince(b.latestActionDate ?? b.introducedDate ?? b.updateDate)
    );
    for (const b of bills) {
      const parts = [`${b.officialId}: ${b.title}`];
      if (b.latestAction) parts.push(`Action: ${b.latestAction}`);
      if (b.summary)
        parts.push(`CRS summary: ${b.summary.replace(/\s+/g, ' ').trim().slice(0, 900)}`);
      items.push(`${parts.join(' — ')}.`);
    }
    const eos = ((feed.executiveActions as ExecutiveActionRecord[] | undefined) ?? []).filter((a) =>
      afterSince(a.issuedDate)
    );
    for (const a of eos) {
      items.push(`${a.type.replace(/_/g, ' ')}: ${a.title} (${a.issuedDate}).`);
    }
    const trades = (feed.trades as { trades?: TradeRecord[] } | TradeRecord[] | undefined) ?? [];
    const tradeList = Array.isArray(trades) ? trades : (trades.trades ?? []);
    const recentTrades = tradeList.filter((t) => afterSince(t.filingDate ?? t.tradeDate));
    for (const t of recentTrades) {
      items.push(
        `${t.politicianName} (${t.chamber}) ${t.category} ${t.ticker ?? t.assetName}` +
          `${t.amount ? ` ${t.amount}` : ''} — traded ${t.tradeDate}` +
          `${t.filingDate ? `, filed ${t.filingDate}` : ''}.`
      );
    }
  } catch (err) {
    emitDigestWarning(warn, 'politics/feed', err);
  }
  return items;
}

/** Estimated-tax and contribution stores are keyed by `entity/year`
 *  (e.g. "personal/2026", "am2-llc/2025"); some legacy data may use a bare year.
 *  Collect every bucket for the target year so totals span all entities — this
 *  mirrors how the financial-snapshot route aggregates (it sums every bucket
 *  whose key ends with the year), so news figures reconcile with the app. */
function bucketsForYear<T>(data: Record<string, T>, year: number): T[] {
  const y = String(year);
  return Object.entries(data)
    .filter(([k]) => k === y || k.endsWith(`/${y}`))
    .map(([, v]) => v);
}

/** Next IRS quarterly estimated-tax due date on/after `now`, as YYYY-MM-DD.
 *  Standard calendar-year deadlines: Apr 15, Jun 15, Sep 15, and Jan 15 of the
 *  following year. Returns null once the final installment for the year passes. */
function nextEstimatedTaxDue(taxYear: number, now: Date = new Date()): string | null {
  const deadlines = [
    `${taxYear}-04-15`,
    `${taxYear}-06-15`,
    `${taxYear}-09-15`,
    `${taxYear + 1}-01-15`,
  ];
  const t = now.getTime();
  for (const d of deadlines) {
    if (new Date(`${d}T23:59:59`).getTime() >= t) return d;
  }
  return null;
}

async function gatherFinance(
  afterSince: AfterSince,
  includeBodies: boolean,
  includeState: boolean,
  warn?: WarningSink,
  editionDate?: string
): Promise<string[]> {
  const items: string[] = [];
  // Tax year for income/estimated-tax/contribution/return lookups — the
  // edition's own year, falling back to the current calendar year.
  const taxYear = (() => {
    const ymd = (editionDate ?? '').slice(0, 10);
    const d = new Date(`${ymd || new Date().toISOString().slice(0, 10)}T12:00:00`);
    return Number.isNaN(d.getTime()) ? new Date().getFullYear() : d.getFullYear();
  })();

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
    emitDigestWarning(warn, 'finance/sales', err);
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
    emitDigestWarning(warn, 'finance/mileage', err);
  }

  try {
    const strat = await getLatestStrategy();
    if (strat && afterSince(strat.createdAt)) {
      items.push(`New investment strategy filed: ${strat.title}.`);
      if (includeBodies) items.push(strat.body);
    }
  } catch (err) {
    emitDigestWarning(warn, 'finance/strategy', err);
  }

  // Broker activity — recent trades/dividends (read the activities cache directly).
  try {
    let raw: string | null = null;
    try {
      raw = await fs.readFile(BROKER_ACTIVITIES_FILE, 'utf-8');
    } catch (err) {
      // The activities cache only exists once a broker integration has synced
      // activity history — treat absence like an empty feed below.
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
    }
    const cache = raw
      ? (JSON.parse(raw) as {
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
        })
      : {};
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
    // An explicit quiet-period line beats silence — but only when broker
    // accounts are actually connected (the cache file the Brokers view keeps).
    if (acts.length === 0 && (await fileExists(BROKER_CACHE_FILE))) {
      items.push('No brokerage account trades or transfers this period.');
    }
  } catch (err) {
    emitDigestWarning(warn, 'finance/broker-activity', err);
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
    emitDigestWarning(warn, 'finance/crypto', err);
  }

  // Tax, income, retirement & other assets — the household money picture beyond
  // markets. These run for BOTH editions but report only what CHANGED in-window
  // (a new income source, an estimated-tax payment made, a 401k contribution, a
  // freshly filed return); the weekly adds the standing totals under state below.
  try {
    const { sources } = await loadIncomeData();
    for (const s of sources.filter((s) => afterSince(s.createdAt))) {
      items.push(
        `New income source: ${s.name} $${Math.round(s.amount).toLocaleString()}/${s.frequency}` +
          `${s.taxable ? '' : ' (tax-free)'}.`
      );
    }
  } catch (err) {
    emitDigestWarning(warn, 'finance/income', err);
  }

  try {
    const est = await loadEstimatedTaxes();
    const payments = bucketsForYear(est, taxYear).flatMap((b) => b.payments ?? []);
    for (const p of payments.filter((p) => afterSince(p.date))) {
      items.push(
        `Estimated tax payment: Q${p.quarter} ${taxYear} — ` +
          `$${Math.round(p.amount).toLocaleString()} paid ${p.date}.`
      );
    }
  } catch (err) {
    emitDigestWarning(warn, 'finance/estimated-taxes', err);
  }

  try {
    const contrib = await loadContributions();
    const entries = bucketsForYear(contrib, taxYear).flat();
    for (const c of entries.filter((c) => afterSince(c.date))) {
      items.push(
        `Retirement contribution: $${Math.round(c.amount).toLocaleString()} (${c.type}) on ${c.date}.`
      );
    }
  } catch (err) {
    emitDigestWarning(warn, 'finance/contributions', err);
  }

  try {
    const federal = await loadFederalTax();
    for (const [year, ret] of Object.entries(federal)) {
      if (ret.filed && ret.filedDate && afterSince(ret.filedDate)) {
        const bal = ret.balance.totalOwed;
        items.push(
          `Filed ${year} federal return: AGI $${Math.round(ret.agi).toLocaleString()}, ` +
            `total tax $${Math.round(ret.tax.totalTax).toLocaleString()}, ` +
            `${bal >= 0 ? 'owed' : 'refund'} $${Math.round(Math.abs(bal)).toLocaleString()}.`
        );
      }
    }
  } catch (err) {
    emitDigestWarning(warn, 'finance/federal-tax', err);
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
      emitDigestWarning(warn, 'finance/balance-sheet', err);
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
      emitDigestWarning(warn, 'finance/liabilities', err);
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
      emitDigestWarning(warn, 'finance/property', err);
    }

    // Precious metals holdings (weekly) — count + weight, no spot fetch.
    try {
      const { entries } = await loadGoldData();
      if (entries.length) {
        const oz = entries.reduce((s, g) => s + (g.weightOz ?? 0) * (g.quantity ?? 0), 0);
        items.push(`Precious metals: ${entries.length} holdings, ${oz.toFixed(2)} oz total.`);
      }
    } catch (err) {
      emitDigestWarning(warn, 'finance/gold', err);
    }

    // Income — annualized total across all configured sources (state).
    try {
      const { sources } = await loadIncomeData();
      if (sources.length) {
        const mult: Record<string, number> = {
          weekly: 52,
          biweekly: 26,
          monthly: 12,
          quarterly: 4,
          annually: 1,
        };
        const total = sources.reduce((sum, s) => sum + s.amount * (mult[s.frequency] ?? 1), 0);
        items.push(
          `Income sources (${sources.length}): ~$${Math.round(total).toLocaleString()}/yr.`
        );
      }
    } catch (err) {
      emitDigestWarning(warn, 'finance/income-state', err);
    }

    // Estimated taxes — paid-to-date vs. annual target + next quarterly due date,
    // summed across every entity bucket for the year.
    try {
      const buckets = bucketsForYear(await loadEstimatedTaxes(), taxYear);
      if (buckets.length) {
        const paid = buckets.flatMap((b) => b.payments ?? []).reduce((s, p) => s + p.amount, 0);
        const target = buckets.reduce((s, b) => s + (b.config?.annualTarget ?? 0), 0);
        const due = nextEstimatedTaxDue(taxYear);
        items.push(
          `Estimated taxes ${taxYear}: $${Math.round(paid).toLocaleString()} paid` +
            (target > 0
              ? ` of $${Math.round(target).toLocaleString()} target (${Math.round((paid / target) * 100)}%)`
              : '') +
            (due ? `; next installment due ${due}` : '') +
            '.'
        );
      }
    } catch (err) {
      emitDigestWarning(warn, 'finance/estimated-taxes-state', err);
    }

    // Retirement contributions — year-to-date by type, across all entity buckets.
    try {
      const entries = bucketsForYear(await loadContributions(), taxYear).flat();
      if (entries.length) {
        const ee = entries.filter((c) => c.type === 'employee').reduce((s, c) => s + c.amount, 0);
        const er = entries.filter((c) => c.type === 'employer').reduce((s, c) => s + c.amount, 0);
        items.push(
          `Retirement contributions ${taxYear}: $${Math.round(ee + er).toLocaleString()} ` +
            `(employee $${Math.round(ee).toLocaleString()}, employer $${Math.round(er).toLocaleString()}).`
        );
      }
    } catch (err) {
      emitDigestWarning(warn, 'finance/contributions-state', err);
    }

    // Other tracked assets (vehicles, equipment) — these are NOT part of the
    // net-worth snapshot, so the weekly's "state of things" would otherwise omit
    // them entirely.
    try {
      const assets = Object.values(await loadAssets()).flat();
      if (assets.length) {
        const total = assets.reduce((s, a) => s + (a.value ?? 0), 0);
        const top = assets
          .slice()
          .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
          .slice(0, 5)
          .map((a) => `${a.name} $${Math.round(a.value ?? 0).toLocaleString()}`);
        items.push(
          `Other assets (${assets.length}, $${Math.round(total).toLocaleString()}): ${top.join(', ')}.`
        );
      }
    } catch (err) {
      emitDigestWarning(warn, 'finance/assets', err);
    }

    // Most recent filed federal return — the standing tax picture.
    try {
      const federal = await loadFederalTax();
      const year = Object.keys(federal)
        .filter((y) => federal[y].filed)
        .sort()
        .reverse()[0];
      const ret = year ? federal[year] : undefined;
      if (ret && year) {
        items.push(
          `Most recent filed return (${year}): AGI $${Math.round(ret.agi).toLocaleString()}, ` +
            `taxable income $${Math.round(ret.taxableIncome).toLocaleString()}, ` +
            `total tax $${Math.round(ret.tax.totalTax).toLocaleString()}.`
        );
      }
    } catch (err) {
      emitDigestWarning(warn, 'finance/federal-tax-state', err);
    }
  }

  return items;
}

/**
 * Read a person's snapshot through the snapshot route's auto-heal path, which
 * recomputes when the deltas dir is newer than the cached snapshot. Reading
 * `store.snapshots` raw misses anything synced since the last recompute — the
 * 2026-06-12 edition omitted a person whose overnight backfill landed 45 min
 * before generation because of exactly that. Falls back to undefined (caller
 * keeps the raw-store read) on any failure.
 */
async function freshPersonSnapshot(personId: string): Promise<SnapMetrics | undefined> {
  try {
    const url = new URL(`http://internal/api/health/${encodeURIComponent(personId)}/snapshot/all`);
    const res = await handleHealthRoutes(new Request(url.toString()), url, url.pathname);
    if (!res || res.status !== 200) return undefined;
    const body = (await res.json()) as { data?: unknown };
    return (body.data ?? undefined) as SnapMetrics | undefined;
  } catch (err) {
    log.warn(
      `[health] fresh snapshot read failed for ${personId}: ${err instanceof Error ? err.message : String(err)}`
    );
    return undefined;
  }
}

async function gatherHealth(
  afterSince: AfterSince,
  includeBodies: boolean,
  includeState: boolean,
  editionType: EditionType,
  warn?: WarningSink,
  editionDate?: string
): Promise<string[]> {
  const items: string[] = [];

  // Apple Health daily metrics + new labs + active sickness, per active person.
  try {
    const store = await loadHealthStore();
    const people = (store.people ?? []).filter((p) => !p.archivedAt).slice(0, 4);
    for (const person of people) {
      const parts: string[] = [];

      const snap =
        (await freshPersonSnapshot(person.id)) ??
        (latestByPerson(store.snapshots, person.id) as unknown as SnapMetrics | undefined);
      if (snap) {
        const bits: string[] = [];
        const dailyAct = snap.activity?.daily;
        const lastAct = last(dailyAct);
        const healthDate = lastAct?.date ?? undefined;
        // Stale = the latest health day predates the edition's window (no data
        // arrived this period) — flag it instead of passing it off as current.
        const stale = healthDate ? !afterSince(healthDate) : false;
        // Weekly → 7-day averages (the week, not one possibly-atypical day);
        // daily → the latest single day. A stale snapshot keeps single-day
        // values but is labelled "as of <date>" rather than averaged.
        const useAvg = editionType === 'weekly' && !stale;
        // Daily editions use the last complete day for step count; overnight
        // metrics (sleep/RHR/HRV) stay latest.
        const steps = selectDailyNewsStepCount(dailyAct, { useAverage: useAvg, editionDate });
        const rhr = useAvg
          ? avgLastN(snap.heart?.daily, (d) => d.restingHR)
          : last(snap.heart?.daily)?.restingHR;
        const hrv = useAvg
          ? avgLastN(snap.heart?.daily, (d) => d.hrv)
          : last(snap.heart?.daily)?.hrv;
        const lastSleep = last(snap.sleep?.daily);
        const sleepMin = useAvg
          ? avgLastN(snap.sleep?.daily, (d) => d.asleepMinutes)
          : lastSleep?.asleepMinutes;
        const lb = snap.body?.headline?.currentLb;
        if (typeof steps === 'number')
          bits.push(`${Math.round(steps).toLocaleString()} steps${useAvg ? '/day' : ''}`);
        if (typeof rhr === 'number') bits.push(`resting HR ${Math.round(rhr)}`);
        if (typeof hrv === 'number') bits.push(`HRV ${Math.round(hrv)}`);
        if (typeof sleepMin === 'number') {
          let sleepBit = `${(sleepMin / 60).toFixed(1)}h sleep${useAvg ? '/night' : ''}`;
          // Daily editions report last night concretely, stages included.
          if (!useAvg) {
            const stages = [
              typeof lastSleep?.deepMinutes === 'number'
                ? `${(lastSleep.deepMinutes / 60).toFixed(1)}h deep`
                : null,
              typeof lastSleep?.remMinutes === 'number'
                ? `${(lastSleep.remMinutes / 60).toFixed(1)}h REM`
                : null,
            ].filter(Boolean);
            if (stages.length) sleepBit += ` (${stages.join(', ')})`;
          }
          bits.push(sleepBit);
        }
        if (typeof lb === 'number') bits.push(`${Math.round(lb)} lb`);
        if (editionType === 'weekly') {
          const w = snap.workouts?.headline;
          if (w && typeof w.thisWeekCount === 'number' && w.thisWeekCount > 0) {
            bits.push(
              `${w.thisWeekCount} workout${w.thisWeekCount === 1 ? '' : 's'} this week` +
                `${typeof w.thisWeekMinutes === 'number' ? ` (${Math.round(w.thisWeekMinutes)} min)` : ''}` +
                `${w.favoriteType ? `, mostly ${w.favoriteType}` : ''}`
            );
          }
        } else {
          // Daily editions list the actual sessions captured this period —
          // "what you did yesterday", not week-to-date aggregates.
          const sessions = (snap.workouts?.recent ?? [])
            .filter((s) => s.start && afterSince(s.start))
            .slice(0, 4)
            .map((s) => {
              const mins =
                typeof s.durationMinutes === 'number'
                  ? ` ${Math.round(s.durationMinutes)} min`
                  : '';
              const hr = typeof s.avgHR === 'number' ? ` (avg HR ${Math.round(s.avgHR)})` : '';
              return `${s.type ?? 'Workout'}${mins}${hr}`;
            });
          if (sessions.length) bits.push(`workouts logged: ${sessions.join(', ')}`);
        }
        if (bits.length) {
          const tag =
            stale && healthDate ? ` (as of ${healthDate})` : useAvg ? ' (7-day avgs)' : '';
          parts.push(bits.join(', ') + tag);
        }
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
    emitDigestWarning(warn, 'health/store', err);
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
      emitDigestWarning(warn, 'health/weekly-detail', err);
    }
  }

  try {
    const ha = await getLatestHealthAnalysis();
    if (ha && afterSince(ha.createdAt)) {
      items.push(`New health analysis: ${ha.title}.`);
      if (includeBodies) items.push(ha.body);
    }
  } catch (err) {
    emitDigestWarning(warn, 'health/analysis', err);
  }

  return items;
}

async function gatherDocs(
  afterSince: AfterSince,
  editionType: EditionType,
  sinceMs: number,
  warn?: WarningSink
): Promise<{ items: string[]; pulled: PulledItem[] }> {
  const items: string[] = [];
  // Structured twin of the prose items — the exact ledger of what was
  // ingested, surfaced verbatim in the edition's "Sources pulled" appendix.
  const pulled: PulledItem[] = [];

  // New research filed (any domain) — with a one-line intelligence snippet.
  // In-window when it was PULLED in-window OR published in-window: a scraper
  // backfilling slightly older pieces (e.g. a channel's last week of videos)
  // still counts as news to the vault the morning after the pull.
  try {
    const entries = await listResearchEntries();
    const recent = entries.filter(
      (e) =>
        afterSince(e.uploadedAt) ||
        afterSince(e.reportDate ? `${e.reportDate}T12:00:00` : undefined)
    );
    for (const e of recent) {
      const snippet = e.intelligence?.summary?.[0]?.text;
      const title = e.title ?? e.filename ?? 'untitled';
      items.push(
        `Filed (${e.domain}): ${title}` +
          `${e.publisher ? ` — ${e.publisher}` : ''}${snippet ? ` — ${snippet}` : ''}.`
      );
      pulled.push({
        source: `research/${e.domain}`,
        title: `${title}${e.publisher ? ` — ${e.publisher}` : ''}`,
        ...(e.sourceUrl?.trim() ? { url: e.sourceUrl.trim() } : {}),
      });
    }
  } catch (err) {
    emitDigestWarning(warn, 'docs/research', err);
  }

  // Documents uploaded recently across EVERY entity (tax docs, receipts, etc.).
  try {
    const config = await loadConfig();
    const fileLines: string[] = [];
    for (const entity of config.entities) {
      const files = await scanDirectory(path.join(DATA_DIR, entity.path));
      for (const f of files) {
        if (f.lastModified >= sinceMs) {
          fileLines.push(`${entity.name}/${f.name}`);
          pulled.push({ source: 'upload', title: `${entity.name}/${f.name}` });
        }
      }
    }
    if (fileLines.length) {
      items.push(`${fileLines.length} document(s) uploaded: ${fileLines.join(', ')}.`);
    }
  } catch (err) {
    emitDigestWarning(warn, 'docs/files', err);
  }

  // Deep Research reports finished in the window.
  try {
    const runs = await listRuns();
    const done = runs.filter(
      (r) => r.status === 'done' && afterSince(r.completedAt ?? r.createdAt)
    );
    for (const r of done) {
      items.push(`Deep Research completed: ${r.question}.`);
      pulled.push({ source: 'deep-research', title: r.question });
    }
  } catch (err) {
    emitDigestWarning(warn, 'docs/deep-research', err);
  }

  // Open to-dos touched recently.
  try {
    const todos = await loadTodos();
    const recent = todos.filter((t) => t.status === 'pending' && afterSince(t.updatedAt));
    for (const t of recent) items.push(`To-do: ${t.title}.`);
  } catch (err) {
    emitDigestWarning(warn, 'docs/todos', err);
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
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    for (const r of due) items.push(`Due ${r.dueDate}: ${r.title}.`);
  } catch (err) {
    emitDigestWarning(warn, 'docs/reminders', err);
  }

  return { items, pulled };
}

// The FULL text of research filed in-window, grouped by publisher (ZeroHedge,
// Lyn Alden, George Gammon, political transcripts, …) so the editor can actually
// read and synthesize the analysis, not just the titles. Runs for BOTH editions
// — the window scopes it: the day's filings for the daily, the week's for the
// weekly.
export function buildResearchDigestItems(
  entries: ResearchEntry[],
  afterSince: AfterSince,
  opts: { maxChars?: number; cite?: (e: ResearchEntry) => string } = {}
): string[] {
  const eligible = entries
    .filter(
      (e) =>
        afterSince(e.uploadedAt) ||
        afterSince(e.reportDate ? `${e.reportDate}T12:00:00` : undefined)
    )
    .filter((e) => (e.text ?? '').trim().length > 0);
  if (!eligible.length) return [];

  const maxChars = opts.maxChars ?? 70_000;
  const charsPerEntry = Math.max(350, Math.min(2800, Math.floor(maxChars / eligible.length)));
  return eligible.map((e) => {
    const who = e.publisher ?? e.author ?? e.domain;
    const when = e.reportDate ?? e.uploadedAt.slice(0, 10);
    const clean = (e.text ?? '').replace(/\s+/g, ' ').trim();
    const clipped = clean.length > charsPerEntry;
    const body = clean.slice(0, charsPerEntry);
    const suffix = clipped ? ' … [excerpt truncated; source text remains in Research]' : '';
    const tag = opts.cite?.(e) ?? '';
    return `### ${e.title ?? 'Untitled'} — ${who} (${e.domain}, ${when})${tag}\n${body}${suffix}`;
  });
}

async function gatherResearchDeep(
  afterSince: AfterSince,
  warn?: WarningSink
): Promise<{ research: string[]; local: string[]; citations: SourceCitation[] }> {
  try {
    const entries = await listResearchEntries();
    // Number every sourced entry across both desks ([S1], [S2], …) — the
    // model cites stories with these tags and the server links them after.
    const citations: SourceCitation[] = [];
    const cite = (e: ResearchEntry): string => {
      const url = e.sourceUrl?.trim();
      if (!url || !/^https?:\/\//i.test(url)) return '';
      const ref = `S${citations.length + 1}`;
      citations.push({ ref, url });
      return ` [${ref}]`;
    };
    // Local news gets its own desk in the edition — a newspaper has a local
    // section, and city announcements shouldn't be buried among macro research.
    const research = buildResearchDigestItems(
      entries.filter((e) => e.domain !== 'local'),
      afterSince,
      { cite }
    );
    const local = buildResearchDigestItems(
      entries.filter((e) => e.domain === 'local'),
      afterSince,
      { maxChars: 25_000, cite }
    );
    log.info(
      `[digest] research-deep: ${research.length} full-text entries, local: ${local.length}, ` +
        `${citations.length} linkable sources`
    );
    return { research, local, citations };
  } catch (err) {
    emitDigestWarning(warn, 'research/full-text', err);
    return { research: [], local: [], citations: [] };
  }
}

/** Week-ahead forecast for the configured location (Open-Meteo); null when
 *  weather is disabled/unconfigured or the fetch fails. Not windowed by sinceISO
 *  — it's a forward forecast, the same in daily and weekly editions. */
async function gatherWeather(warn?: WarningSink): Promise<WeatherForecast | null> {
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
    emitDigestWarning(warn, 'weather', err);
    return null;
  }
}

/** Gather the full digest across all desks, windowed by `sinceISO`. */
export async function gatherDigest(
  editionType: EditionType,
  sinceISO: string,
  editionDate?: string
): Promise<Digest> {
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
  const sourceWarnings: DigestSourceWarning[] = [];
  const warn: WarningSink = (source, err) => {
    const message = errMsg(err).replace(/\s+/g, ' ').trim().slice(0, 240) || 'unknown error';
    sourceWarnings.push({ source, message });
    log.warn(`[digest] ${source} failed: ${message}`);
  };
  const t0 = Date.now();

  const [markets, politics, finance, health, docsResult, researchDeep, weather] = await Promise.all(
    [
      gatherMarkets(editionType, sinceISO, warn),
      gatherPolitics(afterSince, warn),
      gatherFinance(afterSince, includeBodies, includeState, warn, editionDate),
      gatherHealth(afterSince, includeBodies, includeState, editionType, warn, editionDate),
      gatherDocs(afterSince, editionType, since, warn),
      gatherResearchDeep(afterSince, warn),
      gatherWeather(warn),
    ]
  );
  const docs = docsResult.items;

  const desks: Array<[string, string[]]> = [
    ['Markets & Macro', markets],
    ['Politics', politics],
    ['Local News', researchDeep.local],
    ['Personal Finance & Business', finance],
    ['Health', health],
    ['Research & Analysis', researchDeep.research],
    ['Documents & Deadlines', docs],
  ];
  const sections = desks
    .filter(([, list]) => list.length > 0)
    .map(([desk, list]) => ({ desk, items: list }));
  const itemCount = sections.reduce((n, s) => n + s.items.length, 0);
  const sources = sections.map((s) => s.desk);

  log.info(
    `[digest] type=${editionType} since=${sinceISO} ` +
      `markets=${markets.length} politics=${politics.length} local=${researchDeep.local.length} ` +
      `finance=${finance.length} health=${health.length} research=${researchDeep.research.length} ` +
      `docs=${docs.length} ` +
      `weather=${weather ? `${weather.days.length}d` : 'off'} ` +
      `(sections=${sections.length} items=${itemCount}) in ${Date.now() - t0}ms`
  );
  return {
    editionType,
    sinceISO,
    sections,
    itemCount,
    sources,
    pulled: docsResult.pulled,
    citations: researchDeep.citations,
    sourceWarnings,
    weather: weather ?? undefined,
  };
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
    'Write a cohesive newspaper edition in clean markdown. Open with a one-paragraph front-page lede summarizing the single most important development. Then write one `##` section per desk, in the order given, in tight journalistic prose (not bullet dumps) — lead with what changed and why it matters, cite the specific numbers, dates, and names from the digest. Digest items may carry a source tag like [S12] in their heading; when a story draws on a tagged item, hyperlink its most load-bearing phrase reference-style — [the phrase][S12] — using only tags that appear in the digest. Never write raw URLs or invent tags; at most one link per story. Cover EVERY desk that has material (the digest is comprehensive — markets, politics, local news, personal finance, health, research, documents); omit only a desk with genuinely no items. In the Local News section, report like a hometown paper: lead with what affects the reader directly (rates, closures, construction, schools), keep names and dates concrete.',
    'In the "Personal Finance & Business" section, treat tax and retirement items as the financially actionable content they are: when an estimated-tax installment due date, safe-harbor progress, retirement-contribution progress, a filed return, or a new income source/asset appears in the digest, report it concretely with the numbers and dates — an upcoming estimated-tax deadline in particular is worth a clear heads-up.',
    'In the "Markets & Macro" section, give proportional coverage to EVERY asset class the owner actually holds — crypto, equities, precious metals, and real estate — using the per-asset-class moves and metals/equity signals in the digest. Crypto is often the most volatile sleeve, but do not let it crowd out the others: when metals or real-estate equity moved (or held flat while crypto fell), say so explicitly, since that is the diversification story. Lead the section with whatever moved most, not crypto by default.',
    'END the edition with a "## Action Items" section: a short, prioritized list of the SPECIFIC financial moves the data suggests the owner consider right now — and for EACH one, state the WHY in the same sentence, citing the concrete data point that motivates it. Draw across ALL desks, e.g.: an estimated-tax installment due within the window (pay $X by DATE — safe-harbor shortfall is $Y); idle cash to deploy or a deductible-contribution headroom; an allocation that has drifted (one sleeve now N% of net worth) worth trimming/rebalancing; a high-rate debt to prioritize vs. a 0% one to leave; a funding-stress or yield-curve signal that argues for caution or duration; a deadline/renewal from reminders. Rank by urgency and dollar impact. Ground every item in a number or date that appears in the digest — if the data does not support a concrete action, write a brief honest "No pressing money moves" line rather than inventing one. Frame as reasoned considerations from the owner\'s own data, never as guaranteed advice.',
    'When the "Research & Analysis" desk is present it carries the FULL text of newly-filed research (ZeroHedge, Lyn Alden, George Gammon, political transcripts, etc.) — actually read it and synthesize the key arguments, attributing analysts by name, rather than merely noting that a piece was filed.',
    "In the Health section, be a supportive coach as well as a reporter: when someone's numbers are good (steps, workouts, resting heart rate, weight trend), say so plainly — one warm, specific affirmation per person is welcome. When sleep falls short (under ~7 hours total, or under ~1 hour of deep sleep), call it out directly with a gentle, actionable nudge (e.g. an earlier wind-down tonight) rather than burying it in neutral prose. Encouraging and concrete, never clinical or scolding.",
    editionType === 'weekly'
      ? 'This is the WEEKLY DEEP-DIVE, covering the whole week: be substantial and thorough. Draw connections across desks, surface the week\'s through-lines, weave in the "state of things" the digest provides (balance sheet, holdings, health baselines), then a "## The Week in Review" synthesis and a "## Looking Ahead" section, and finally close with the "## Action Items" list (described below) as the very last section. Let the length match the depth of the material — a rich week warrants a long edition.'
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
  const digest = await gatherDigest(editionType, sinceISO, editionDate);
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
    ({ body, usage } = await runDailyNewsCodexAgent(system, prompt, model));
  } else {
    ({ body, usage } = await runDailyNewsClaudeAgent(system, prompt, model));
  }

  // Billing path for the badge: agent mode runs on a subscription (Codex =
  // ChatGPT; Claude = the OAuth token when present), API mode bills credits.
  const billing: 'subscription' | 'api' =
    mode === 'agent' && (agentBackend === 'codex' || !!(await getAnthropicAuthToken()))
      ? 'subscription'
      : 'api';

  log.info(
    `[generate] done type=${editionType} theme=${theme} bodyChars=${body.length} in ${Date.now() - startedAt}ms`
  );
  return {
    title,
    body: applySourceCitations(body.trim(), digest.citations ?? []),
    theme,
    usage,
    generatedBy: { model: model.model, billing, backend },
    digestMeta: {
      sources: digest.sources,
      sinceISO,
      itemCount: digest.itemCount,
      ...(digest.pulled.length ? { pulled: digest.pulled } : {}),
      sourceWarnings: digest.sourceWarnings,
    },
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
        ...(ref.effort ? { effort: ref.effort } : {}),
      },
      ref.model
    );
  } else {
    const client = await getClient();
    const effort = toAnthropicApiEffort(ref.effort);
    response = await client.messages.create({
      model: ref.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system,
      messages: [{ role: 'user', content: prompt }],
      ...(effort ? { output_config: { effort } } : {}),
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
  prompt: string,
  ref?: ModelRef
): Promise<{ body: string; usage: { inputTokens: number; outputTokens: number } }> {
  const oauthToken = await getAnthropicAuthToken();
  const apiKey = await getAnthropicKey();
  // The scope's configured model applies when it's an Anthropic pick; a stale
  // OpenAI ref (left over from API mode) falls back to the default.
  const model = ref?.provider === 'anthropic' && ref.model ? ref.model : DEFAULT_MODEL;
  const effort = toClaudeAgentEffort(ref?.effort);
  const startedAt = Date.now();
  // Prefer the Claude.ai SUBSCRIPTION (OAuth token) over API credits: Claude
  // Code bills the API whenever ANTHROPIC_API_KEY is in the env, so it must be
  // removed (it can also be inherited from process.env) when a token exists.
  const env: Record<string, string | undefined> = { ...process.env };
  if (oauthToken) {
    env.CLAUDE_CODE_OAUTH_TOKEN = oauthToken;
    delete env.ANTHROPIC_API_KEY;
  } else if (apiKey) {
    env.ANTHROPIC_API_KEY = apiKey;
    delete env.CLAUDE_CODE_OAUTH_TOKEN;
  }
  log.info(
    `[ai-billing] daily-news → Claude ${oauthToken ? 'SUBSCRIPTION (Claude.ai OAuth token)' : 'API KEY (billed credits)'} · model=${model}`
  );

  let body = '';
  let inputTokens = 0;
  let outputTokens = 0;
  for await (const message of query({
    prompt,
    options: {
      model,
      ...(effort ? { effort } : {}),
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
    model: `agent:${model}`,
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
  prompt: string,
  ref?: ModelRef
): Promise<{ body: string; usage: { inputTokens: number; outputTokens: number } }> {
  const { codexHome, binaryPath, model: chatCodexModel } = await getCodexChatConfig();
  // The scope's configured model applies when it's an OpenAI pick; otherwise
  // fall back to the chat's codex model, then codex's account default.
  const model = ref?.provider === 'openai' && ref.model ? ref.model : chatCodexModel;
  const effort = toOpenAIEffort(ref?.effort);
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
    await client.startTurn({
      threadId,
      input: [{ type: 'text', text: prompt }],
      ...(effort ? { effort } : {}),
    });
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
/**
 * Email a finished edition. Best-effort; returns a small result so callers (the
 * manual "Email this edition" route) can surface success/failure.
 *
 * `force` bypasses the `email.enabled` AUTO-delivery toggle — that toggle only
 * governs *automatic* sends (scheduled editions). An explicit user click IS the
 * intent, so the manual route forces past it; the send still needs a configured
 * Resend key + recipient (sendEmail enforces that and returns a clear error).
 */
/** Resend's total-message cap is 40 MB; HTML + hero take a few. A 10-minute
 *  narration at 64 kbps baked at 1.5–2× is 2–4 MB, far under this guard. */
const MAX_EMAIL_AUDIO_BYTES = 18 * 1024 * 1024;

export async function notifyEditionReady(
  edition: Edition,
  opts: { force?: boolean } = {}
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  let cfg;
  try {
    cfg = await getEmailConfig();
  } catch (err) {
    log.warn(`[notify] could not read email config: ${errMsg(err)}`);
    return { ok: false, error: 'Could not read email config' };
  }
  if (!cfg.enabled && !opts.force) {
    log.info(`[notify] skipped (email disabled) id=${edition.id}`);
    return { ok: false, skipped: true, error: 'Email delivery is disabled in Settings → Email' };
  }

  const kind = edition.editionType === 'weekly' ? 'Weekly' : 'Daily';
  const subject = `${edition.title ?? 'Newsstand'} — ${kind}, ${formatEditionDate(edition.editionDate)}`;

  // Embed the headline image as a CID-backed inline attachment. Keep the full
  // HTML attachment self-contained with a data URI so it still opens correctly
  // outside the email client.
  const attachments: Parameters<typeof sendEmail>[0]['attachments'] = [];
  let emailHeroSrc: string | undefined;
  let attachmentHeroSrc: string | undefined;
  if (edition.imagePath) {
    const bytes = await readEditionImage(edition.id);
    if (bytes) {
      const b64 = bytes.toString('base64');
      const contentId = 'docvault-daily-news-hero';
      emailHeroSrc = `cid:${contentId}`;
      attachmentHeroSrc = `data:image/png;base64,${b64}`;
      attachments.push({
        filename: `${editionFilename(edition)}-hero.png`,
        content: b64,
        contentType: 'image/png',
        contentId,
      });
    } else {
      log.warn(`[notify] edition image missing on disk id=${edition.id}`);
    }
  }

  attachments.push({
    filename: `${editionFilename(edition)}.html`,
    content: Buffer.from(renderEditionHtml(edition, attachmentHeroSrc), 'utf-8').toString('base64'),
    contentType: 'text/html',
  });

  // Attach the narration baked at the default playback speed — mail clients
  // have no rate control, so the emailed file IS the speed. Never blocks the
  // email: any failure just ships the edition without audio.
  if (edition.audioPath) {
    try {
      const settings = await loadSettings();
      const speed = settings.dailyNews?.narration?.defaultSpeed ?? 1;
      const audio = await renderNarrationAtSpeed(edition.audioPath, speed);
      if (audio && audio.byteLength <= MAX_EMAIL_AUDIO_BYTES) {
        attachments.push({
          filename: `${editionFilename(edition)}-narration${speed !== 1 ? `-${speed}x` : ''}.mp3`,
          content: Buffer.from(audio).toString('base64'),
          contentType: 'audio/mpeg',
        });
        log.info(`[notify] narration attached (${audio.byteLength} bytes @${speed}x)`);
      } else if (audio) {
        log.warn(`[notify] narration too large to attach (${audio.byteLength} bytes)`);
      }
    } catch (err) {
      log.warn(
        `[notify] narration attach failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  const res = await sendEmail({
    subject,
    html: renderEditionEmailHtml(edition, emailHeroSrc),
    attachments,
  });
  if (res.ok) {
    log.info(`[notify] emailed id=${edition.id} resendId=${res.id ?? '?'}`);
    return { ok: true };
  }
  log.warn(`[notify] email failed id=${edition.id}: ${res.error}`);
  return { ok: false, error: res.error };
}
