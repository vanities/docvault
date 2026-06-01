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

const log = createLogger('Models');
const CACHE_PATH = path.join(DATA_DIR, '.docvault-model-cache.json');
const TTL_MS = 12 * 60 * 60 * 1000;

// Known-current fallbacks (June 2026) — only used when no key is set or the
// live call fails, so the dropdown is never empty.
const FALLBACKS: Record<ModelProvider, string[]> = {
  anthropic: ['claude-opus-4-8', 'claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  openai: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-4o', 'gpt-4o-mini'],
};

interface CacheEntry {
  models: string[];
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
async function saveCache(c: Cache): Promise<void> {
  await fs.writeFile(CACHE_PATH, JSON.stringify(c, null, 2));
}

/** Keep chat/vision-capable OpenAI models; drop embeddings, audio, image, etc. */
function looksLikeChatModel(id: string): boolean {
  if (
    /embedding|whisper|tts|audio|dall-e|image-|realtime|transcribe|moderation|babbage|davinci|sora/i.test(
      id
    )
  ) {
    return false;
  }
  return /^(gpt-|o\d|chatgpt)/i.test(id);
}

export interface ModelList {
  models: string[];
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
  if (!opts.refresh && cached && Date.now() - cached.fetchedAt < TTL_MS) {
    return { models: cached.models, source: 'cache' };
  }

  try {
    let models: string[];
    if (provider === 'anthropic') {
      const client = await getClient();
      const res = await client.models.list({ limit: 100 });
      models = res.data.map((m) => m.id).filter((id) => id.startsWith('claude'));
    } else {
      if (!apiKey) throw new Error('no OpenAI key configured');
      const client = new OpenAI({ apiKey, baseURL: baseUrl || undefined });
      const res = await client.models.list();
      const isLocal = !!baseUrl;
      models = res.data.map((m) => m.id).filter((id) => isLocal || looksLikeChatModel(id));
    }
    // Descending so the newest-named models (gpt-5.5, o4, opus-4-8) surface at
    // the top of the picker and legacy families (gpt-3.5, opus-4-1) sink down.
    models.sort((a, b) => b.localeCompare(a));
    cache[cacheKey] = { models, fetchedAt: Date.now() };
    await saveCache(cache);
    log.info(`Fetched ${models.length} ${provider} models (live)`);
    return { models, source: 'live' };
  } catch (err) {
    log.warn(`Model list for ${provider} failed: ${(err as Error).message}`);
    if (cached) return { models: cached.models, source: 'cache' };
    return { models: FALLBACKS[provider], source: 'fallback' };
  }
}
