// Live model lists per provider — the automated, non-stale way to "get the
// newest models": query the provider's /v1/models endpoint (both Anthropic and
// OpenAI expose it; a local Ollama/vLLM does too). New models appear
// automatically. Cached 12h; falls back to a small known-current list when
// there's no key or the call fails.

import OpenAI from 'openai';
import { promises as fs } from 'fs';
import path from 'path';
import { getClient } from '../parsers/base.js';
import { DATA_DIR, getOpenAIConfig, type ModelProvider } from '../data.js';
import { createLogger } from '../logger.js';
import { createWriteLock, writeJsonAtomic } from '../write-lock.js';

const log = createLogger('Models');
const CACHE_PATH = path.join(DATA_DIR, '.docvault-model-cache.json');
const TTL_MS = 12 * 60 * 60 * 1000;

// Known-current fallbacks (June 2026) — only used when no key is set or the
// live call fails, so the dropdown is never empty.
const FALLBACKS: Record<ModelProvider, string[]> = {
  anthropic: ['claude-opus-4-8', 'claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  openai: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-4o', 'gpt-4o-mini'],
};
// Image-generation fallbacks, verified against OpenAI's /v1/models on
// 2026-10-01. Anthropic has no image model.
const IMAGE_FALLBACKS: Record<ModelProvider, string[]> = {
  anthropic: [],
  openai: [
    'gpt-image-2.5-sunburst',
    'gpt-image-2.5-flare',
    'gpt-image-2',
    'gpt-image-1.5',
    'gpt-image-1-mini',
    'gpt-image-1',
  ],
};

interface CacheEntry {
  models: string[];
  /** Image-generation models. Absent from entries cached before image listing
   *  existed — those count as stale, so the next request refetches. */
  imageModels?: string[];
  fetchedAt: number;
}
type Cache = Record<string, CacheEntry>;

async function loadCache(): Promise<Cache> {
  try {
    return JSON.parse(await fs.readFile(CACHE_PATH, 'utf-8')) as Cache;
  } catch {
    return {};
  }
}
// The Settings page lists both providers in parallel. Saving the whole snapshot
// each call read before its network round-trip let the slower call clobber the
// faster one's fresh entry, so a save re-reads and merges its one key under a lock.
const withCacheLock = createWriteLock();
async function saveCacheEntry(key: string, entry: CacheEntry): Promise<void> {
  await withCacheLock(async () => {
    const cache = await loadCache();
    cache[key] = entry;
    await writeJsonAtomic(CACHE_PATH, cache);
  });
}

/** Image-generation models. Matches any id mentioning image/dall-e, so a future
 *  name (gpt-image-3, gpt-6-image) lists with no code change; the image
 *  generator falls back if a pick can't draw. Video models (sora-*) stay out. */
function looksLikeImageModel(id: string): boolean {
  return /image|dall-?e/i.test(id);
}

/** Keep chat/vision-capable OpenAI models; drop embeddings, audio, image, etc. */
function looksLikeChatModel(id: string): boolean {
  if (
    looksLikeImageModel(id) ||
    /embedding|whisper|tts|audio|realtime|transcribe|moderation|babbage|davinci|sora/i.test(id)
  ) {
    return false;
  }
  return /^(gpt-|o\d|chatgpt)/i.test(id);
}

export interface ModelList {
  models: string[];
  /** Image-generation models (OpenAI only) — the Daily News headline-image picker. */
  imageModels: string[];
  source: 'live' | 'cache' | 'fallback';
}

export async function listModels(
  provider: ModelProvider,
  opts: { refresh?: boolean } = {}
): Promise<ModelList> {
  const { apiKey, baseUrl } =
    provider === 'openai'
      ? await getOpenAIConfig()
      : { apiKey: undefined as string | undefined, baseUrl: undefined as string | undefined };
  const cacheKey = provider === 'openai' && baseUrl ? `openai:${baseUrl}` : provider;

  const cache = await loadCache();
  const cached = cache[cacheKey];
  if (!opts.refresh && cached?.imageModels && Date.now() - cached.fetchedAt < TTL_MS) {
    return { models: cached.models, imageModels: cached.imageModels, source: 'cache' };
  }

  const startedAt = Date.now();
  try {
    let models: string[];
    let imageModels: string[] = [];
    if (provider === 'anthropic') {
      const client = await getClient();
      const res = await client.models.list({ limit: 100 });
      models = res.data.map((m) => m.id).filter((id) => id.startsWith('claude'));
    } else {
      if (!apiKey) throw new Error('no OpenAI key configured');
      const client = new OpenAI({ apiKey, baseURL: baseUrl || undefined });
      const res = await client.models.list();
      const isLocal = !!baseUrl;
      const ids = res.data.map((m) => m.id);
      models = ids.filter((id) => isLocal || looksLikeChatModel(id));
      imageModels = ids.filter((id) => isLocal || looksLikeImageModel(id));
    }
    // Descending so the newest-named models (gpt-5.5, o4, opus-4-8,
    // gpt-image-2.5) surface at the top of the picker and legacy families
    // (gpt-3.5, opus-4-1, gpt-image-1) sink down.
    models.sort((a, b) => b.localeCompare(a));
    imageModels.sort((a, b) => b.localeCompare(a));
    await saveCacheEntry(cacheKey, { models, imageModels, fetchedAt: Date.now() });
    log.info(
      `Fetched ${models.length} ${provider} models + ${imageModels.length} image models (live) in ${Date.now() - startedAt}ms`
    );
    return { models, imageModels, source: 'live' };
  } catch (err) {
    log.warn(
      `Model list for ${provider} failed in ${Date.now() - startedAt}ms: ${(err as Error).message}`
    );
    if (cached) {
      return {
        models: cached.models,
        imageModels: cached.imageModels ?? IMAGE_FALLBACKS[provider],
        source: 'cache',
      };
    }
    return {
      models: FALLBACKS[provider],
      imageModels: IMAGE_FALLBACKS[provider],
      source: 'fallback',
    };
  }
}
