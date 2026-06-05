// Headline image for a Daily News edition — an editorial hero illustration
// generated from the edition's top story + the selected theme's visual style.
//
// Anthropic has no image model, so this always uses OpenAI via the configured
// OpenAI key. The model is user-selectable (Settings → Models → Daily News,
// populated from OpenAI's /v1/models), defaulting to gpt-image-2 (OpenAI's
// newest, released 2026-04-21); if the chosen model fails it falls back to
// gpt-image-2. Best-effort throughout: returns null when disabled, when no
// OpenAI key is set, or on any error — it never blocks an edition. Images are
// saved under DATA_DIR (gitignored).

import { promises as fs } from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { DATA_DIR, getDailyNewsConfig, getOpenAIConfig } from './data.js';
import { getThemeVisual } from './daily-news-themes.js';
import { createLogger } from './logger.js';

const log = createLogger('DailyNewsImage');
const IMAGE_DIR = path.join(DATA_DIR, 'daily-news-images');
const FALLBACK_MODEL = 'gpt-image-2'; // OpenAI's newest image model (released 2026-04-21)

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function editionImageFile(editionId: string): string {
  return path.join(IMAGE_DIR, `${editionId}.png`);
}

/** Strip markdown to a compact plain-text excerpt for the image prompt. */
function leadExcerpt(body: string): string {
  return body
    .replace(/^#+\s*/gm, '')
    .replace(/[*_`>#[\]()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600);
}

/** One image attempt — params shaped per model family (dall-e needs an explicit
 *  size + response_format; gpt-image-* returns base64 by default). */
async function generateOne(client: OpenAI, model: string, prompt: string): Promise<string | null> {
  const res = model.startsWith('dall-e')
    ? await client.images.generate({
        model,
        prompt,
        size: model === 'dall-e-2' ? '1024x1024' : '1792x1024',
        response_format: 'b64_json',
        n: 1,
      })
    : await client.images.generate({ model, prompt, size: '1536x1024', n: 1 });
  return res.data?.[0]?.b64_json ?? null;
}

/** Try the configured model, then dall-e-3 as a no-verification fallback. */
async function generateB64(
  client: OpenAI,
  prompt: string,
  primaryModel: string
): Promise<{ b64: string | null; model: string }> {
  const models = [primaryModel, FALLBACK_MODEL].filter((m, i, a) => m && a.indexOf(m) === i);
  for (const model of models) {
    try {
      const b64 = await generateOne(client, model, prompt);
      if (b64) return { b64, model };
      log.warn(`[image] ${model} returned no data`);
    } catch (err) {
      log.warn(`[image] ${model} failed — ${msg(err)}`);
    }
  }
  return { b64: null, model: 'none' };
}

/**
 * Generate + save a headline image for an edition. Returns the saved file path
 * on success, or null (disabled / no key / error — all best-effort).
 */
export async function generateHeadlineImage(opts: {
  editionId: string;
  title: string;
  body: string;
  themeId: string;
}): Promise<string | null> {
  const { headlineImage, imageModel } = await getDailyNewsConfig();
  if (!headlineImage) return null;
  const { apiKey, baseUrl } = await getOpenAIConfig();
  if (!apiKey) {
    log.warn('[image] skipped — headline image enabled but no OpenAI key configured');
    return null;
  }

  const prompt = [
    `Editorial front-page hero illustration for a personal newspaper titled "${opts.title}".`,
    `Top story: ${leadExcerpt(opts.body)}`,
    `Visual style: ${getThemeVisual(opts.themeId)}.`,
    'Wide cinematic banner, evocative and tasteful. Do NOT render any text, letters, words, logos, or numbers in the image.',
  ].join('\n');

  const startedAt = Date.now();
  const client = new OpenAI({ apiKey, baseURL: baseUrl || undefined, maxRetries: 1 });
  const { b64, model } = await generateB64(client, prompt, imageModel);
  if (!b64) {
    log.warn(`[image] no image produced in ${Date.now() - startedAt}ms`);
    return null;
  }
  try {
    await fs.mkdir(IMAGE_DIR, { recursive: true });
    const file = editionImageFile(opts.editionId);
    await fs.writeFile(file, Buffer.from(b64, 'base64'));
    log.info(
      `[image] saved ${opts.editionId}.png via ${model} (${Math.round(b64.length / 1365)}KB) in ${Date.now() - startedAt}ms`
    );
    return file;
  } catch (err) {
    log.error(`[image] write failed — ${msg(err)}`);
    return null;
  }
}

/** Read a saved edition image as raw PNG bytes (null if absent). */
export async function readEditionImage(editionId: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(editionImageFile(editionId));
  } catch {
    return null;
  }
}
