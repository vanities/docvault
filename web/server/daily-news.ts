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
  getCalendarDisplayConfig,
  getDailyNewsTitle,
  getEmailConfig,
  getWeatherConfig,
  loadSettings,
  getCodexChatConfig,
  getAnthropicAuthToken,
  getAnthropicKey,
  DATA_DIR,
  SCHEDULE_STATUS_FILE,
  DEFAULT_MODEL,
  toAnthropicApiEffort,
  toClaudeAgentEffort,
  toOpenAIEffort,
  type ModelRef,
} from './data.js';
import { calendarToday } from './calendar-store.js';
import { buildSunAlmanac, type SunAlmanac } from './calendar-sky.js';
import { holidayForDate } from './almanac.js';
import { fetchWeekForecast, forecastToLines, type WeatherForecast } from './weather.js';
import { getConfiguredTimezone } from './tz.js';
import { renderNarrationAtSpeed } from './daily-news-narration.js';
import { loadCustomJobStatus, customJobSourceWarnings } from './custom-job-runner.js';
import { listCustomJobManifests } from './jobs.js';
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
import { CONTEXT_SOURCES } from './context/registry.js';
import { formatContextEvents } from './context/events.js';
import {
  buildCalendarDigest,
  calendarDigest,
  type WeekAheadCalendar,
} from './context/sources/calendar.js';
import {
  buildOvernightMetricBits,
  selectDailyNewsStepCount,
  snapshotFromAllResponseBody,
} from './context/sources/health.js';
import { buildResearchDigestItems } from './context/sources/research.js';
import { describeEstimatedTaxState } from './context/sources/finance.js';
import type {
  ContextGroup,
  ContextRead,
  ContextRequest,
  ContextSource,
  PulledItem,
  SourceCitation,
} from './context/types.js';

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

// Shared with every reader of context sources, so the shapes live there.
export type { PulledItem, SourceCitation } from './context/types.js';

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
  /** Sunrise/sunset/daylight for the edition's date, for the rendered sun strip. */
  sun?: SunAlmanac;
  /** Calendar week-ahead for the rendered box (exact dates, never through the LLM). */
  weekAhead?: WeekAheadCalendar;
  /** Holiday or observance falling ON the edition date (e.g. "Halloween").
   *  The editor prompt may only use digest facts, so holiday awareness has to
   *  ride in as data; this line is what licenses the seasonal nod. */
  todayHoliday?: string;
  /** The last completed edition, shown to the editor (dailies only) as "what the
   *  reader was already told" so standing facts and repeated recommendations
   *  aren't restated every morning. Not part of the digest's own item count. */
  previousEdition?: PreviousEdition;
}

/** The prior edition's text, for cross-edition dedup. */
export interface PreviousEdition {
  editionDate: string;
  editionType: EditionType;
  body: string;
}

/** Cap on how much of the previous edition goes into the prompt. A normal daily
 *  is ~20-25K chars; this only clips an unusually long weekly deep-dive. */
const PREVIOUS_EDITION_MAX_CHARS = 30_000;

export type { WeekAheadCalendar, WeekAheadItem } from './context/sources/calendar.js';

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
  /** Sun almanac carried through so the renderer can draw the sun strip. */
  sun?: SunAlmanac;
  /** Calendar week-ahead carried through so the renderer can draw its box. */
  weekAhead?: WeekAheadCalendar;
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
// Digest gathering. Every desk is built from the context sources
// (server/context/registry.ts), the same descriptions chat and assignments
// read; this file only assembles them. The weather box, sun strip and Week
// Ahead box are rendered pieces, so they are gathered here.
// ===========================================================================

// Moved to their context sources; re-exported for existing callers and tests.
export {
  buildCalendarDigest,
  buildOvernightMetricBits,
  buildResearchDigestItems,
  describeEstimatedTaxState,
  formatContextEvents,
  selectDailyNewsStepCount,
  snapshotFromAllResponseBody,
};

/** Week-ahead forecast for the configured location (Open-Meteo); null when
 *  weather is disabled or unconfigured, or the fetch fails. Not windowed: it's
 *  a forward forecast, the same in daily and weekly editions. */
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

/** Sunrise/sunset/daylight for the edition's own date, at the configured
 *  location. Two deliberate gates, and only two:
 *   • settings.calendar.showSunTimes — the same layer switch the Calendar's
 *     agenda uses, so turning sun times off there turns them off in the paper.
 *   • coordinates being set at all (settings.weather is the single location
 *     source). NOT weather.enabled: this is local astronomical math, not an
 *     Open-Meteo fetch, so an off/failing forecast shouldn't take it down.
 *  Formatted in the household timezone, not the container's. */
async function gatherSun(editionDate?: string, warn?: WarningSink): Promise<SunAlmanac | null> {
  try {
    const [location, display, settings] = await Promise.all([
      getWeatherConfig(),
      getCalendarDisplayConfig(),
      loadSettings(),
    ]);
    if (location.latitude == null || location.longitude == null) return null;
    const date =
      editionDate && /^\d{4}-\d{2}-\d{2}$/.test(editionDate) ? editionDate : await calendarToday();
    return buildSunAlmanac(
      date,
      location.latitude,
      location.longitude,
      getConfiguredTimezone(settings),
      display
    );
  } catch (err) {
    emitDigestWarning(warn, 'sun', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Desks. Each context source lands on the desk its group maps to, in this
// order. null means the Newsstand reads that group outside the desks (the
// weather box, the owner's standing notes, the previous edition).
// coverage.test.ts fails when a source's group is missing here.
// ---------------------------------------------------------------------------

export const NEWSSTAND_GROUP_DESKS: Record<ContextGroup, string | null> = {
  markets: 'Markets & Macro',
  money: 'Money Movements',
  politics: 'Politics',
  local: 'Local News',
  finance: 'Personal Finance & Business',
  health: 'Health',
  research: 'Research & Analysis',
  calendar: 'Calendar',
  documents: 'Documents & Deadlines',
  activity: 'DocVault Activity',
  outlook: null,
  memory: null,
};

/** Shift a read's [S#] tags past the ones earlier reads already took, so the
 *  digest carries one sequence across sources. */
export function renumberCitations(read: ContextRead, offset: number): ContextRead {
  if (!offset || !read.citations?.length) return read;
  return {
    ...read,
    lines: read.lines.map((l) => l.replace(/\[S(\d+)\]/g, (_m, n) => `[S${Number(n) + offset}]`)),
    citations: read.citations.map((c) => ({ ...c, ref: `S${Number(c.ref.slice(1)) + offset}` })),
  };
}

/** Read every source for one edition. A source that throws costs only its own lines. */
async function readAllSources(
  req: ContextRequest
): Promise<Array<{ source: ContextSource; read: ContextRead }>> {
  return Promise.all(
    CONTEXT_SOURCES.map(async (source) => {
      const t0 = Date.now();
      try {
        const read = await source.read(req);
        log.debug(`[digest] ${source.id} lines=${read.lines.length} in ${Date.now() - t0}ms`);
        return { source, read };
      } catch (err) {
        const message = errMsg(err).replace(/\s+/g, ' ').trim().slice(0, 240) || 'unknown error';
        log.warn(`[digest] context/${source.id} failed: ${message}`);
        return {
          source,
          read: { lines: [], warnings: [{ source: `context/${source.id}`, message }] },
        };
      }
    })
  );
}

/** Gather the full digest across all desks, windowed by `sinceISO`. */
export async function gatherDigest(
  editionType: EditionType,
  sinceISO: string,
  editionDate?: string,
  previousEdition?: PreviousEdition
): Promise<Digest> {
  const sourceWarnings: DigestSourceWarning[] = [];
  const warn: WarningSink = (source, err) => {
    const message = errMsg(err).replace(/\s+/g, ' ').trim().slice(0, 240) || 'unknown error';
    sourceWarnings.push({ source, message });
    log.warn(`[digest] ${source} failed: ${message}`);
  };
  const t0 = Date.now();

  try {
    const [records, statuses] = await Promise.all([
      listCustomJobManifests(DATA_DIR),
      loadCustomJobStatus(),
    ]);
    sourceWarnings.push(
      ...customJobSourceWarnings(
        records.flatMap((record) => (record.status === 'valid' ? [record.manifest] : [])),
        statuses
      )
    );
    const status = JSON.parse(await fs.readFile(SCHEDULE_STATUS_FILE, 'utf8')) as Record<
      string,
      { lastError?: string | null; lastWarning?: string | null }
    >;
    for (const name of ['snapshot', 'quantRefresh', 'politicsRefresh']) {
      const message = status[name]?.lastError ?? status[name]?.lastWarning;
      if (message)
        sourceWarnings.push({
          source: `collection/${name}`,
          message: message.replace(/\s+/g, ' ').slice(0, 240),
        });
    }
  } catch (err) {
    // A fresh install has no status file yet; do not invent a collection failure.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') warn('collection/status', err);
  }

  const today =
    editionDate && /^\d{4}-\d{2}-\d{2}$/.test(editionDate) ? editionDate : await calendarToday();
  // The full text of in-window items goes into both editions; the window
  // (narrow for a daily, 7 days for a weekly) scopes it. The standing picture
  // (balance sheet, debts, property, metals, DNA, supplement roster) is weekly
  // only: the over-the-week review, not "stuff fetched that day".
  const req: ContextRequest = {
    since: sinceISO,
    today,
    purpose: editionType,
    full: editionType === 'weekly',
  };
  const [reads, weather, sun, weekAhead] = await Promise.all([
    readAllSources(req),
    gatherWeather(warn),
    gatherSun(editionDate, warn),
    // The calendar source already reports a failure; the box just goes empty.
    calendarDigest(editionType, today)
      .then((d) => d.weekAhead)
      .catch(() => null),
  ]);

  const citations: SourceCitation[] = [];
  const pulled: PulledItem[] = [];
  const byDesk = new Map<string, string[]>();
  for (const { source, read } of reads) {
    sourceWarnings.push(...(read.warnings ?? []));
    const desk = NEWSSTAND_GROUP_DESKS[source.group];
    if (!desk) continue;
    const shifted = renumberCitations(read, citations.length);
    citations.push(...(shifted.citations ?? []));
    pulled.push(...(shifted.pulled ?? []));
    if (shifted.lines.length) byDesk.set(desk, [...(byDesk.get(desk) ?? []), ...shifted.lines]);
  }
  const deskOrder = Object.values(NEWSSTAND_GROUP_DESKS).filter((d): d is string => !!d);
  const sections = [...new Set(deskOrder)]
    .filter((desk) => byDesk.has(desk))
    .map((desk) => ({ desk, items: byDesk.get(desk)! }));
  const itemCount = sections.reduce((n, s) => n + s.items.length, 0);
  const sources = sections.map((s) => s.desk);

  log.info(
    `[digest] type=${editionType} since=${sinceISO} ` +
      `desks=${sections.map((s) => `${s.desk}:${s.items.length}`).join(',') || 'none'} ` +
      `citations=${citations.length} pulled=${pulled.length} warnings=${sourceWarnings.length} ` +
      `weather=${weather ? `${weather.days.length}d` : 'off'} ` +
      `sun=${sun ? `${sun.sunrise}/${sun.sunset}` : 'off'} ` +
      `previous=${editionType === 'daily' && previousEdition ? `${previousEdition.editionDate}(${previousEdition.body.length}ch)` : 'none'} ` +
      `(sections=${sections.length} items=${itemCount}) in ${Date.now() - t0}ms`
  );
  return {
    editionType,
    sinceISO,
    sections,
    itemCount,
    sources,
    pulled,
    citations,
    sourceWarnings,
    weather: weather ?? undefined,
    sun: sun ?? undefined,
    weekAhead: weekAhead ?? undefined,
    todayHoliday: editionDate ? holidayForDate(editionDate) : undefined,
    // Dailies only: the weekly deep-dive is the one edition that SHOULD restate
    // the standing state of things, so it gets no "already told" context.
    previousEdition:
      editionType === 'daily' && previousEdition?.body.trim() ? previousEdition : undefined,
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
    'In the "Personal Finance & Business" section, treat tax and retirement items as the financially actionable content they are: when an estimated-tax installment due date, safe-harbor progress, retirement-contribution progress, a filed return, or a new income source/asset appears in the digest, report it concretely with the numbers and dates — an upcoming estimated-tax deadline in particular is worth a clear heads-up. When NONE of those appear, say nothing about them — do not write "no installment / no contribution / no return arrived" lines.',
    'In the "Politics" section, LEAD with congressional and executive-branch trading whenever the digest carries it, and lead that with CONSENSUS: a digest item prefixed "CONSENSUS BUY"/"CONSENSUS SELL" means several different members traded the SAME ticker the SAME direction inside a short window — that is the story, so name the ticker, the member count, the window, and several of the members by name. Items prefixed "NOTABLE" are individually significant single trades (size, or an actual option contract) — give the biggest ones a sentence each with the member, ticker, direction, dollar band, and the gap between the trade date and the disclosure date. A collapsed "Also disclosed" line is background volume: mention it in at most one clause, never expand it. If an item says the trades are NOT new today, say plainly that no fresh filings landed and frame the material as standing context. Never present a disclosure date as the date the trade happened — under the STOCK Act these lag by up to 45 days, and that lag is itself worth noting when it is long. Use ONLY the chamber the digest states for each member, verbatim — never infer or add a title ("Sen.", "Rep.") that the digest did not give you, since members with similar names sit in different chambers and a wrong attribution discredits the whole desk.',
    'In the "Markets & Macro" section, give proportional coverage to EVERY asset class the owner actually holds — crypto, equities, precious metals, and real estate — using the per-asset-class moves and metals/equity signals in the digest. Crypto is often the most volatile sleeve, but do not let it crowd out the others: when metals or real-estate equity moved (or held flat while crypto fell), say so explicitly, since that is the diversification story. Lead the section with whatever moved most, not crypto by default.',
    'When the "Money Movements" desk is present it lists dated bank transactions, large one-day account moves and debt balance changes, starting a few days before this period (those lines say "before this period") so both sides of a transfer appear; on the weekly it also carries every bank account and debt as they stand now. Use it to explain every large move in cash or debt. Money moving between the owner\'s own accounts (a loan paydown, a deposit into an investment or crypto account, a transfer between bank accounts) is neither a gain nor a loss: say where it went, and do not describe it as a drop in net worth. A debt balance that went down is a paydown, not a revaluation. Owners often lower a loan balance in DocVault when they send a payment, days before it clears: a property-equity or debt change and a matching bank payment a few days apart are one transfer, already recorded once. Do not count it twice, and do not ask the owner to record it again. When cash fell and nothing in the digest shows where it went, say so once, plainly. Never call money lost, drained or spent unless a transaction shows it, and never make "find where the money went" an action item when a listed transaction or debt change accounts for it.',
    'When the "DocVault Activity" desk is present it lists what DocVault itself already did and told the owner: alert emails and checks tripped right now, assignment check-ins, chats, emails sent, and anything broken (failing jobs, a bank connection that needs signing in again). Use it so the edition never tells the owner to do something an alert or assignment already handled, and refer to those by name when a story connects to them. Give broken things one short, plain paragraph; leave routine activity out.',
    'Immediately before the "## Action Items" list, include a "## Forecast & Opportunities" section — the edition\'s one FORWARD-looking desk. Synthesize across ALL desks (markets, politics, tech, health, local, research, finance) the most important things LIKELY to happen in the next day-to-week and what the owner could do about them. For EACH opportunity give, in tight prose: (1) the forward call and rough timeframe — what is likely, and by when; (2) a concrete option the owner could take; (3) sizing proportional to the owner\'s actual situation (a starter position, a dollar amount, or "watch only"); (4) the bull case AND the key risk / bear case in the same breath; (5) a confidence read — low, medium, or high. Prefer a few high-quality calls over a long list. This is the one place you may reason FORWARD beyond the literal digest, but every forecast must be built on a fact, date, signal, holding, or prediction-market probability that appears in the digest — never invent an event, price, or number. When an opportunity could be expressed through a risky instrument (e.g. far-out-of-the-money or short-dated options), name the risk plainly and prefer the lower-risk expression (shares, a longer horizon, or a smaller size) — surface the option, do not cheerlead it. If nothing forward-looking is well-supported, write one honest line saying so rather than padding. Frame everything as reasoned possibilities from the owner\'s own data and the odds, never as guaranteed advice.',
    'END the edition with a "## Action Items" section: a short, prioritized list of the SPECIFIC financial moves the data suggests the owner consider right now — and for EACH one, state the WHY in the same sentence, citing the concrete data point that motivates it. Draw across ALL desks, e.g.: an estimated-tax installment due within the window (pay $X by DATE — safe-harbor shortfall is $Y); idle cash to deploy or a deductible-contribution headroom; an allocation that has drifted (one sleeve now N% of net worth) worth trimming/rebalancing; a high-rate debt to prioritize vs. a 0% one to leave; a funding-stress or yield-curve signal that argues for caution or duration; a due or overdue calendar task or deadline. Rank by urgency and dollar impact. Ground every item in a number or date that appears in the digest — if the data does not support a concrete action, write a brief honest "No pressing money moves" line rather than inventing one. Frame as reasoned considerations from the owner\'s own data, never as guaranteed advice.',
    'When the "Research & Analysis" desk is present it carries the FULL text of newly-filed research (ZeroHedge, Lyn Alden, George Gammon, political transcripts, etc.) — actually read it and synthesize the key arguments, attributing analysts by name, rather than merely noting that a piece was filed.',
    "In the Health section, give EVERY person who appears in the digest their OWN paragraph — never blend two people into one paragraph. Start each person's paragraph with their name in bold (e.g. `**<name>** — ...`) and separate paragraphs with a blank line, so each reads as a distinct mini-report citing that person's actual numbers. Do NOT let one person's story (e.g. an active illness) crowd the others out of the section; a sick household member leads the section but still gets only their own paragraph, not the whole desk. Be a supportive coach as well as a reporter: when someone's numbers are good (steps, workouts, resting heart rate, weight trend), say so plainly — one warm, specific affirmation per person is welcome. When sleep falls short (under ~7 hours total, or under ~1 hour of deep sleep), call it out directly with a gentle, actionable nudge (e.g. an earlier wind-down tonight) rather than burying it in neutral prose. Encouraging and concrete, never clinical or scolding. STALENESS: a metric carrying a 'from YYYY-MM-DD' note (e.g. `6.9h sleep — from 2026-08-09, not last night`) is data the phone has NOT synced since that date. Attribute it to that date explicitly, NEVER present it as last night's or today's reading, skip the sleep-shortfall coaching for it, and instead mention once, briefly, that that person's health sync is behind.",
    'SAY EACH THING ONCE. Within this edition, every fact, number, and recommendation appears in exactly one place: the lede may headline a story, but the desk that carries it owns the numbers, and "## Forecast & Opportunities" / "## Action Items" refer back to a fact briefly instead of re-citing every figure again. Do not restate the same statistic (e.g. a sleeve\'s share of net worth, a prediction-market probability) in multiple sections. "Documents & Deadlines" lists only filings not already covered by another desk — never re-count or re-summarize the research. Do not narrate absences ("nothing arrived", "no X appeared", "the regimen is unchanged") — if a topic has nothing new, leave it out; the only permitted absence line is the Action Items fallback.',
    editionType === 'weekly'
      ? 'This is the WEEKLY DEEP-DIVE, covering the whole week: be substantial and thorough. Draw connections across desks, surface the week\'s through-lines, weave in the "state of things" the digest provides (balance sheet, holdings, health baselines), then a "## The Week in Review" synthesis, then the "## Forecast & Opportunities" section (described below) as the week-ahead outlook, and finally close with the "## Action Items" list (described below) as the very last section. Let the length match the depth of the material — a rich week warrants a long edition.'
      : "This is the DAILY edition, covering only what arrived since the last edition — the day's developments. Be substantive about that day: read and synthesize the full research filed today and report the concrete new items with their numbers and names. Keep the scope to the day — do not recap the whole week or restate standing balances (the weekly deep-dive does the week-in-review). Long-horizon context in the digest — 1-year returns (e.g. gold or silver up N% on the year), distance below an all-time high and days since it, sentiment/season indexes, prediction markets, a sleeve's share of net worth — is STANDING context, not news: mention it only when it moved materially or is the direct point of a new story, never as daily filler.",
    'When a "PREVIOUS EDITION" block follows the digest, it is what the reader was already told in the last edition. Do NOT repeat its standing facts, framing, background explanations, or recommendations. Carry something forward only when it CHANGED materially (say what changed: "up from 12% yesterday"), when a date it flagged is now imminent, or when the digest carries genuinely new information about it. A Forecast or Action Item the previous edition already made is omitted unless its underlying numbers moved materially — do not re-issue the same advice every morning. A research story it already covered gets only its new developments, not a re-summary. Never quote or mention the previous edition itself.',
    'When the "Calendar" desk is present it carries the household\'s upcoming birthdays, recurring tasks, and deadlines with exact dates. Do NOT write a standalone schedule section (a "Week Ahead" box is rendered separately with the exact dates) — instead fold due/overdue tasks into Action Items, and give any birthday in the window a brief warm mention in the lede or a relevant desk, using only the ages ("turns N") given in the digest.',
    'Use ONLY facts present in the digest — do not invent data, prices, or events, and do not speculate beyond what is given (the "## Forecast & Opportunities" section is the sole exception, and even there you may reason forward only from facts, signals, dates, and odds that appear in the digest). If the digest is sparse, write a short edition; never pad.',
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

export function renderDigestPrompt(digest: Digest, title: string, dateLabel: string): string {
  const lines: string[] = [
    `Edition: ${title} — ${digest.editionType === 'weekly' ? 'WEEKLY DEEP-DIVE' : 'DAILY'} for ${dateLabel}.`,
    `Digest window: changes since ${digest.sinceISO}.`,
    '',
    ...(digest.todayHoliday
      ? [
          `Today is ${digest.todayHoliday}. Give it one warm, brief nod in the lede and let a light ${digest.todayHoliday} flavor color the edition's voice where it fits naturally. Tone only: every fact, number, and name stays exact, and do not invent holiday-related events or news.`,
          '',
        ]
      : []),
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
  if (digest.sun) {
    // Same contract as the weather box: rendered separately, so the editor gets
    // it only as optional seasonal color — never as its own section.
    lines.push(
      `Almanac — sunrise ${digest.sun.sunrise}, sunset ${digest.sun.sunset}, ` +
        `${digest.sun.daylight} of daylight` +
        (digest.sun.delta ? ` (${digest.sun.delta} vs. yesterday)` : '') +
        `. A sun strip is rendered separately, so do NOT write a dedicated ` +
        `almanac/daylight section; you MAY use it for one line of seasonal ` +
        `color in the lede if it's genuinely relevant.`
    );
    lines.push('');
  }
  if (digest.weekAhead && digest.weekAhead.items.length > 0) {
    lines.push(
      'Calendar note — a "Week Ahead" box with these exact dates is rendered separately, ' +
        'so do NOT write a dedicated calendar/schedule section; fold due dates into Action ' +
        'Items and mention birthdays warmly where relevant.'
    );
    lines.push('');
  }
  const prev = digest.previousEdition;
  if (prev) {
    const body =
      prev.body.length > PREVIOUS_EDITION_MAX_CHARS
        ? `${prev.body.slice(0, PREVIOUS_EDITION_MAX_CHARS)}\n[…truncated]`
        : prev.body;
    lines.push(
      `PREVIOUS EDITION (${prev.editionType}, ${prev.editionDate}) — already read by the ` +
        `owner. Reference only, NOT a source of new facts: use it to avoid repeating ` +
        `what it already said.`,
      '<<<PREVIOUS_EDITION',
      body.trim(),
      'PREVIOUS_EDITION>>>',
      ''
    );
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
  sinceISO: string,
  previousEdition?: PreviousEdition
): Promise<GenerateResult> {
  const digest = await gatherDigest(editionType, sinceISO, editionDate, previousEdition);
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
    sun: digest.sun,
    weekAhead: digest.weekAhead,
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
    purpose: 'news',
    ref: `edition:${edition.id}`,
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
