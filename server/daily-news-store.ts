// Daily News edition store + async orchestration. Mirrors deep-research-store:
// a generation takes 1-4 minutes, so startEdition() persists a `running`
// record, fires the generator WITHOUT awaiting, and patches it to `done`/
// `error` on completion. On `done` it emails the edition (best-effort). The
// client polls getEdition(id). Editions persist to .docvault-daily-news.json.
//
// One edition per LOCAL calendar day, keyed by `editionDate`. A `running`
// record younger than STALE_RUNNING_MS counts as "exists" so the hourly
// scheduler tick can't double-fire mid-generation; an older one is treated as
// crashed and a retry is allowed.

import { promises as fs } from 'fs';
import path from 'path';
import { DATA_DIR } from './data.js';
import { createLogger } from './logger.js';
import {
  generateEdition,
  gatherDigest,
  synthesizeEdition,
  notifyEditionReady,
  type GenerateResult,
  type Digest,
} from './daily-news.js';
import { generateHeadlineImage } from './daily-news-image.js';
import { listThemes } from './daily-news-themes.js';
import type { WeatherForecast } from './weather.js';

const log = createLogger('DailyNewsStore');
const STORE_PATH = path.join(DATA_DIR, '.docvault-daily-news.json');

/** A daily digest, or the heavier weekly deep-dive (chosen by the scheduler). */
export type EditionType = 'daily' | 'weekly';

export interface Edition {
  id: string;
  editionType: EditionType;
  /** 'YYYY-MM-DD' local date this edition is FOR — the per-day dedup key. */
  editionDate: string;
  status: 'running' | 'done' | 'error';
  title?: string;
  /** House style this edition was written + illustrated in (themes.ts id). */
  theme?: string;
  /** True for theme-sampler editions — excluded from dedup, never emailed. */
  sample?: boolean;
  /** Week-ahead weather forecast for the rendered box (Open-Meteo); optional. */
  weather?: WeatherForecast;
  /** Synthesized newspaper markdown. */
  body?: string;
  digestMeta?: {
    sources: string[];
    sinceISO: string;
    itemCount: number;
    /** Exact ledger of ingested items — the "Sources pulled" appendix. */
    pulled?: Array<{ source: string; title: string }>;
    sourceWarnings?: Array<{ source: string; message: string }>;
  };
  usage?: { inputTokens: number; outputTokens: number };
  /** Saved headline-image filename (set when headline images are enabled). */
  imagePath?: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

/** An edition minus the heavy body — for the history rail. */
export interface EditionSummary {
  id: string;
  editionType: EditionType;
  editionDate: string;
  status: Edition['status'];
  title?: string;
  theme?: string;
  sample?: boolean;
  itemCount: number;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

/** The generator — injectable so tests can drive the store without an LLM. */
export type Generator = (
  editionType: EditionType,
  editionDate: string,
  sinceISO: string
) => Promise<GenerateResult>;

/** A `running` edition older than this is treated as crashed (retry allowed). */
const STALE_RUNNING_MS = 30 * 60 * 1000;

async function loadEditions(): Promise<Record<string, Edition>> {
  try {
    return JSON.parse(await fs.readFile(STORE_PATH, 'utf-8')) as Record<string, Edition>;
  } catch {
    return {};
  }
}

async function saveEditions(editions: Record<string, Edition>): Promise<void> {
  const tmp = `${STORE_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(editions, null, 2));
  await fs.rename(tmp, STORE_PATH); // atomic swap — never truncate the live file
}

async function patchEdition(id: string, patch: Partial<Edition>): Promise<void> {
  const editions = await loadEditions();
  if (editions[id]) {
    editions[id] = { ...editions[id], ...patch };
    await saveEditions(editions);
  }
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** Most recent COMPLETED edition's timestamp (excludes the just-persisted
 *  running record) — the lower bound for "what changed since last time". */
async function lastDoneEditionTimestamp(): Promise<string | null> {
  const editions = await loadEditions();
  const stamps = Object.values(editions)
    .filter((e) => e.status === 'done' && !e.sample)
    .map((e) => e.completedAt ?? e.createdAt)
    .sort();
  return stamps.length ? stamps[stamps.length - 1] : null;
}

/**
 * Persist a `running` edition, fire the generator in the background, return its
 * id. When `notify` (default true — the scheduler's behavior), the finished
 * edition is auto-emailed (notifyEditionReady, best-effort). The manual UI
 * generate button passes `notify:false` so on-demand editions do NOT auto-send;
 * the user emails them explicitly via the "Email" button (POST /:id/email).
 */
export async function startEdition(
  editionType: EditionType,
  editionDate: string,
  generator: Generator = generateEdition,
  notify = true
): Promise<string> {
  // Window: weekly always looks back 7 days; daily picks up since the last
  // completed edition (fallback 48h on a fresh install). Resolved BEFORE we
  // persist this run so it reflects the PREVIOUS edition, not this one.
  const sinceISO =
    editionType === 'weekly'
      ? isoDaysAgo(7)
      : ((await lastDoneEditionTimestamp()) ?? isoDaysAgo(2));

  const id = crypto.randomUUID();
  const editions = await loadEditions();
  editions[id] = {
    id,
    editionType,
    editionDate,
    status: 'running',
    createdAt: new Date().toISOString(),
  };
  await saveEditions(editions);
  log.info(`[start] id=${id} type=${editionType} date=${editionDate} since=${sinceISO}`);

  // Background — the caller does not await this; the client polls getEdition(id).
  void generator(editionType, editionDate, sinceISO)
    .then(async (result) => {
      await patchEdition(id, {
        status: 'done',
        title: result.title,
        body: result.body,
        theme: result.theme,
        weather: result.weather,
        digestMeta: result.digestMeta,
        usage: result.usage,
        completedAt: new Date().toISOString(),
      });
      log.info(
        `[done] id=${id} bodyChars=${result.body.length} items=${result.digestMeta.itemCount}`
      );
      // Generate the headline image (best-effort) before emailing so the edition carries it.
      const imagePath = await generateHeadlineImage({
        editionId: id,
        title: result.title,
        body: result.body,
        themeId: result.theme,
      }).catch(() => null);
      if (imagePath) await patchEdition(id, { imagePath });
      if (notify) {
        const edition = await getEdition(id);
        if (edition) await notifyEditionReady(edition);
      }
    })
    .catch(async (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`[error] id=${id} ${message}`);
      await patchEdition(id, {
        status: 'error',
        error: message,
        completedAt: new Date().toISOString(),
      });
    });

  return id;
}

/**
 * Generate one SAMPLE edition per theme from a single shared digest — a "taste"
 * of every house style. Persists a `running` record per theme up front (so the
 * UI shows them immediately), then runs SERIALLY in ONE background task: gather
 * the digest ONCE, synthesize each theme's voice over that same digest, render
 * its theme-styled hero image (if headline images are enabled), and patch each
 * to `done`. Samples are NEVER emailed and are excluded from per-day dedup, so
 * they never block (or masquerade as) the real scheduled edition.
 */
export async function startThemeSamples(
  editionType: EditionType,
  editionDate: string
): Promise<{ ids: string[] }> {
  const themes = listThemes();
  // Same window logic as startEdition — resolved before persisting the records.
  const sinceISO =
    editionType === 'weekly'
      ? isoDaysAgo(7)
      : ((await lastDoneEditionTimestamp()) ?? isoDaysAgo(2));

  const editions = await loadEditions();
  const now = new Date().toISOString();
  const entries = themes.map((t) => {
    const id = crypto.randomUUID();
    editions[id] = {
      id,
      editionType,
      editionDate,
      status: 'running',
      sample: true,
      theme: t.id,
      createdAt: now,
    };
    return { id, theme: t.id };
  });
  await saveEditions(editions);
  log.info(
    `[samples] start n=${entries.length} type=${editionType} date=${editionDate} since=${sinceISO}`
  );

  // Background — the caller does not await; the client polls listEditions().
  void (async () => {
    let digest: Digest;
    try {
      digest = await gatherDigest(editionType, sinceISO, editionDate);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`[samples] shared digest failed, erroring all: ${message}`);
      for (const e of entries) {
        await patchEdition(e.id, {
          status: 'error',
          error: message,
          completedAt: new Date().toISOString(),
        });
      }
      return;
    }

    for (const e of entries) {
      const t0 = Date.now();
      try {
        // Same digest, this theme's voice.
        const result = await synthesizeEdition(editionType, editionDate, sinceISO, digest, e.theme);
        await patchEdition(e.id, {
          status: 'done',
          title: result.title,
          body: result.body,
          theme: result.theme,
          weather: result.weather,
          digestMeta: result.digestMeta,
          usage: result.usage,
          completedAt: new Date().toISOString(),
        });
        // Theme-styled hero (best-effort, no-ops if headline images are disabled).
        const imagePath = await generateHeadlineImage({
          editionId: e.id,
          title: result.title,
          body: result.body,
          themeId: result.theme,
        }).catch(() => null);
        if (imagePath) await patchEdition(e.id, { imagePath });
        log.info(
          `[samples] done theme=${e.theme} bodyChars=${result.body.length} image=${imagePath ? 'yes' : 'no'} in ${Date.now() - t0}ms`
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error(`[samples] theme=${e.theme} failed: ${message}`);
        await patchEdition(e.id, {
          status: 'error',
          error: message,
          completedAt: new Date().toISOString(),
        });
      }
    }
    log.info(`[samples] all complete n=${entries.length}`);
  })();

  return { ids: entries.map((e) => e.id) };
}

export async function getEdition(id: string): Promise<Edition | null> {
  return (await loadEditions())[id] ?? null;
}

export async function listEditions(): Promise<EditionSummary[]> {
  const editions = await loadEditions();
  return Object.values(editions)
    .sort(
      (a, b) => b.editionDate.localeCompare(a.editionDate) || b.createdAt.localeCompare(a.createdAt)
    )
    .map((e) => ({
      id: e.id,
      editionType: e.editionType,
      editionDate: e.editionDate,
      status: e.status,
      title: e.title,
      theme: e.theme,
      sample: e.sample,
      itemCount: e.digestMeta?.itemCount ?? 0,
      error: e.error,
      createdAt: e.createdAt,
      completedAt: e.completedAt,
    }));
}

export async function deleteEdition(id: string): Promise<void> {
  const editions = await loadEditions();
  delete editions[id];
  await saveEditions(editions);
}

/** True if an edition already exists for `date`. A `running` record younger
 *  than STALE_RUNNING_MS counts (prevents the hourly tick double-firing); an
 *  older `running` is treated as crashed so a retry can proceed. */
export async function editionExistsForDate(date: string): Promise<boolean> {
  const editions = await loadEditions();
  return Object.values(editions).some((e) => {
    if (e.sample) return false; // sampler editions never count as "the day's edition"
    if (e.editionDate !== date) return false;
    if (e.status === 'running' && Date.now() - new Date(e.createdAt).getTime() > STALE_RUNNING_MS) {
      return false;
    }
    return true;
  });
}

/** True if a (non-errored) weekly edition already exists on/after `weekStart`. */
export async function weeklyEditionExistsForWeek(weekStart: string): Promise<boolean> {
  const editions = await loadEditions();
  return Object.values(editions).some(
    (e) =>
      !e.sample && e.editionType === 'weekly' && e.status !== 'error' && e.editionDate >= weekStart
  );
}
