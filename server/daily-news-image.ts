// Headline image for a Daily News edition — an editorial hero illustration
// generated from the edition's top story + the selected theme's visual style.
//
// Anthropic has no image model, so this always uses OpenAI (gpt-image-1) via the
// configured OpenAI key. Best-effort: returns null when disabled, when no OpenAI
// key is set, or on any error — it never blocks or fails an edition. Images are
// saved under DATA_DIR (gitignored).

import { promises as fs } from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { DATA_DIR, getDailyNewsConfig, getOpenAIConfig } from './data.js';
import { getThemeVisual } from './daily-news-themes.js';
import { createLogger } from './logger.js';

const log = createLogger('DailyNewsImage');
const IMAGE_DIR = path.join(DATA_DIR, 'daily-news-images');
const IMAGE_MODEL = 'gpt-image-1';
const IMAGE_SIZE = '1536x1024';

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
  const { headlineImage } = await getDailyNewsConfig();
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
  try {
    const client = new OpenAI({ apiKey, baseURL: baseUrl || undefined, maxRetries: 1 });
    const res = await client.images.generate({
      model: IMAGE_MODEL,
      prompt,
      size: IMAGE_SIZE,
      n: 1,
    });
    const b64 = res.data?.[0]?.b64_json;
    if (!b64) {
      log.warn(`[image] no image data returned in ${Date.now() - startedAt}ms`);
      return null;
    }
    await fs.mkdir(IMAGE_DIR, { recursive: true });
    const file = editionImageFile(opts.editionId);
    await fs.writeFile(file, Buffer.from(b64, 'base64'));
    log.info(
      `[image] saved ${opts.editionId}.png (${Math.round(b64.length / 1365)}KB) in ${Date.now() - startedAt}ms`
    );
    return file;
  } catch (err) {
    log.error(
      `[image] failed in ${Date.now() - startedAt}ms — ${err instanceof Error ? err.message : String(err)}`
    );
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
