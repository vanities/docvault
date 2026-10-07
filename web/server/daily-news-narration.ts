// Edition narration — turns a finished Newsstand edition into an MP3 read by
// a cloned voice, automatically after generation (and on demand via
// POST /api/daily-news/:id/narrate).
//
// Pipeline: deterministic speech adaptation (pure code — no extra LLM call,
// so the unattended 8 AM run can't fail on a model hiccup) → push the
// narrator's newest reference clip to the TTS server's voice library →
// submit a chatterbox long-text job → poll the *download* endpoint until the
// MP3 is ready (the job-status endpoint 500s in current chatterbox-tts-api
// builds; downloads return 409 until done) → save under
// DATA_DIR/daily-news-audio/ with a fresh filename (the audio route allows
// day-long browser caching, so re-narrations must change the URL).
//
// Best-effort by design: any failure logs and returns null — an edition
// without audio is still an edition.

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { DATA_DIR, ensureDir, getTtsConfig, loadSettings } from './data.js';
import { loadVoiceReference } from './routes/voice.js';
import { pushVoice, ttsRootUrl } from './tts.js';
import { createLogger } from './logger.js';

const log = createLogger('Narration');

const AUDIO_DIR = path.join(DATA_DIR, 'daily-news-audio');

/** Submit + first-byte ceiling for the long-text job API. */
const SUBMIT_TIMEOUT_MS = 30_000;
/** A ~10-minute edition renders in ~3 min on a GPU box; this only catches a
 *  dead job or a CPU-bound box. */
const JOB_TIMEOUT_MS = 25 * 60_000;
const POLL_INTERVAL_MS = 15_000;
/** ffmpeg atempo render ceiling for the emailed copy. */
const FFMPEG_TIMEOUT_MS = 120_000;

/** The shape narrateEdition needs — structural so this module never imports
 *  the store (the store imports us). */
export interface NarratableEdition {
  id: string;
  editionType?: string;
  editionDate: string;
  title?: string;
  body?: string;
  audioPath?: string;
}

// ---------------------------------------------------------------------------
// Speech adaptation — markdown edition → read-aloud script.
// ---------------------------------------------------------------------------

/** Desk-heading → spoken transition. Unknown desks fall back to "Next: <desk>." */
const DESK_TRANSITIONS: Record<string, string> = {
  'Markets & Macro': 'First — markets and macro.',
  Politics: 'Turning to politics.',
  'Local News': 'In local news.',
  'Personal Finance & Business': 'On the personal ledger.',
  Health: 'Health check.',
  'Research & Analysis': 'Now, the research desk.',
  'Documents & Deadlines': 'And finally, the vault.',
};

/** ALL-CAPS tokens that read naturally as words — everything else 2–5 chars
 *  uppercase gets letterized ("ECB" → "E-C-B") so the TTS doesn't guess. */
const READ_AS_WORDS = new Set(['NATO', 'COVID', 'OPEC', 'HIMARS', 'REM', 'SPY', 'FED', 'OK']);

/** Exact replacements applied before the generic acronym pass. */
const SPOKEN_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bS&P\b/g, 'S and P'],
  [/\bBTC\b/g, 'Bitcoin'],
  [/\bETH\b/g, 'Ethereum'],
  [/\bstETH\b/g, 'staked Ethereum'],
  [/&/g, ' and '],
];

/** Normalize one prose chunk for the ear: strip markdown furniture, expand
 *  symbols, letterize opaque acronyms. */
export function speakableText(text: string): string {
  let t = text;
  // Markdown furniture: images, citation links ([[3]](url)), inline links.
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  t = t.replace(/\s?\[\[\d+\]\]\([^)]*\)/g, '');
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  t = t.replace(/[*_`#>]+/g, ' ');
  // Money / units / symbols.
  t = t.replace(/\$([\d][\d,.]*)(?:\s+(thousand|million|billion|trillion))?/gi, (_m, num, scale) =>
    scale ? `${num} ${scale.toLowerCase()} dollars` : `${num} dollars`
  );
  t = t.replace(/€([\d][\d,.]*)(?:\s+(thousand|million|billion|trillion))?/gi, (_m, num, scale) =>
    scale ? `${num} ${scale.toLowerCase()} euros` : `${num} euros`
  );
  t = t.replace(/(\d)\s?%/g, '$1 percent');
  for (const [re, sub] of SPOKEN_REPLACEMENTS) t = t.replace(re, sub);
  // Opaque acronyms → letterized ("ECB" → "E-C-B"); known word-reads pass through.
  t = t.replace(/\b([A-Z]{2,5})\b/g, (m: string) =>
    READ_AS_WORDS.has(m) ? m : m.split('').join('-')
  );
  return t
    .replace(/[ \t]+/g, ' ')
    .replace(/ \./g, '.')
    .trim();
}

/** Spoken date for the masthead line ("Friday, June 12, 2026"). */
function spokenDate(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Deterministic edition → narration script. Headers become spoken
 * transitions; the weather box, tables, and sources appendix never reach the
 * script (they're not in the body); symbols and acronyms get verbalized.
 */
export function buildNarrationScript(edition: NarratableEdition): string {
  const title = edition.title?.trim() || 'the daily edition';
  const date = spokenDate(edition.editionDate);
  const body = edition.body ?? '';

  const parts: string[] = [`Good morning. This is ${title}, for ${date}.`];

  // Split on section headings; chunk 0 is the front-page lede.
  const chunks = body.split(/^## +/m);
  const lede = speakableText(chunks[0] ?? '');
  if (lede) parts.push(lede);
  for (const chunk of chunks.slice(1)) {
    const newline = chunk.indexOf('\n');
    const desk = (newline === -1 ? chunk : chunk.slice(0, newline)).trim();
    const text = speakableText(newline === -1 ? '' : chunk.slice(newline + 1));
    if (!text) continue;
    const transition = DESK_TRANSITIONS[desk] ?? `Next: ${speakableText(desk)}.`;
    parts.push(`${transition} ${text}`);
  }

  parts.push(
    edition.editionType === 'weekly'
      ? `That's the weekly deep-dive. Back tomorrow morning.`
      : `That's ${title} for ${date.split(',')[0]}. Same time tomorrow.`
  );
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Synthesis — long-text job submit + download polling.
// ---------------------------------------------------------------------------

function authHeaders(apiKey?: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Narrate a finished edition in the configured narrator's cloned voice.
 * Returns the saved audio filename (for Edition.audioPath), or null when
 * narration is off, unconfigured, or fails — never throws.
 */
export async function narrateEdition(edition: NarratableEdition): Promise<string | null> {
  const t0 = performance.now();
  try {
    const settings = await loadSettings();
    const narration = settings.dailyNews?.narration;
    const tts = await getTtsConfig();
    if (!narration?.personId) {
      log.debug(`[narrate] skipped id=${edition.id} — no narrator configured`);
      return null;
    }
    if (!tts.url) {
      log.warn(`[narrate] skipped id=${edition.id} — narrator set but no TTS server URL`);
      return null;
    }
    if (!edition.body?.trim()) {
      log.warn(`[narrate] skipped id=${edition.id} — empty body`);
      return null;
    }

    // 1. Reference clip → TTS voice library (re-pushed every run; self-heals).
    const ref = await loadVoiceReference(narration.personId);
    if (!ref) {
      log.warn(
        `[narrate] skipped id=${edition.id} — narrator ${narration.personId} has no voice clips`
      );
      return null;
    }
    await pushVoice(ref.voiceName, ref.bytes, ref.filename);

    // 2. Speech script.
    const script = buildNarrationScript(edition);
    log.info(
      `[narrate] start id=${edition.id} narrator=${narration.personId} ` +
        `bodyChars=${edition.body.length} scriptChars=${script.length} ` +
        `exag=${narration.exaggeration ?? 'default'} cfg=${narration.cfgWeight ?? 'default'}`
    );

    // 3. Submit the long-text job.
    const root = ttsRootUrl(tts.url);
    const payload: Record<string, unknown> = {
      input: script,
      voice: ref.voiceName,
      response_format: 'mp3',
    };
    if (narration.exaggeration !== undefined) payload.exaggeration = narration.exaggeration;
    if (narration.cfgWeight !== undefined) payload.cfg_weight = narration.cfgWeight;
    const submit = await fetch(`${root}/audio/speech/long`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(tts.apiKey) },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
    });
    if (!submit.ok) {
      const text = (await submit.text().catch(() => '')).slice(0, 200);
      log.error(`[narrate] submit failed id=${edition.id}: ${submit.status} ${text}`);
      return null;
    }
    const { job_id: jobId } = (await submit.json()) as { job_id?: string };
    if (!jobId) {
      log.error(`[narrate] submit returned no job_id id=${edition.id}`);
      return null;
    }
    log.info(`[narrate] job=${jobId} submitted id=${edition.id}`);

    // 4. Poll the download endpoint (409 while processing, 200 when done).
    const deadline = Date.now() + JOB_TIMEOUT_MS;
    let bytes: Uint8Array | null = null;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const res = await fetch(`${root}/audio/speech/long/${jobId}/download`, {
        headers: authHeaders(tts.apiKey),
        signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
      }).catch(() => null);
      if (res?.ok) {
        bytes = new Uint8Array(await res.arrayBuffer());
        break;
      }
      log.debug(`[narrate] job=${jobId} not ready (${res?.status ?? 'unreachable'})`);
    }
    if (!bytes || bytes.byteLength === 0) {
      log.error(`[narrate] job=${jobId} timed out after ${JOB_TIMEOUT_MS / 60000}min`);
      return null;
    }

    // 5. Save with a fresh filename (cache-busting); drop the previous take.
    await ensureDir(AUDIO_DIR);
    const filename = `${edition.id}-${Date.now().toString(36)}.mp3`;
    await fs.writeFile(path.join(AUDIO_DIR, filename), bytes);
    if (edition.audioPath && edition.audioPath !== filename) {
      await fs.unlink(path.join(AUDIO_DIR, path.basename(edition.audioPath))).catch(() => {});
    }
    log.info(
      `[narrate] done id=${edition.id} → ${filename} (${bytes.byteLength} bytes) ` +
        `in ${((performance.now() - t0) / 1000).toFixed(0)}s`
    );
    return filename;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`[narrate] failed id=${edition.id}: ${msg}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Email copy — bake the default playback speed into a smaller MP3.
// ---------------------------------------------------------------------------

/** atempo only accepts 0.5–2 per filter instance; chain for higher rates. */
export function atempoChain(speed: number): string {
  const parts: string[] = [];
  let s = speed;
  while (s > 2) {
    parts.push('atempo=2.0');
    s /= 2;
  }
  parts.push(`atempo=${s.toFixed(4).replace(/0+$/, '').replace(/\.$/, '.0')}`);
  return parts.join(',');
}

/**
 * Render the narration at the given speed (pitch-preserving) for the email
 * attachment — mail clients have no rate control, so the file IS the speed.
 * Returns null on any failure (the email then ships without audio).
 */
export async function renderNarrationAtSpeed(
  audioFilename: string,
  speed: number
): Promise<Uint8Array | null> {
  const src = path.join(AUDIO_DIR, path.basename(audioFilename));
  try {
    if (speed === 1) return new Uint8Array(await fs.readFile(src));
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dv-narration-'));
    try {
      const out = path.join(tempDir, 'out.mp3');
      const t0 = performance.now();
      const proc = Bun.spawn({
        cmd: ['ffmpeg', '-y', '-i', src, '-filter:a', atempoChain(speed), '-b:a', '64k', out],
        stdout: 'ignore',
        stderr: 'pipe',
      });
      const watchdog = setTimeout(() => proc.kill(), FFMPEG_TIMEOUT_MS);
      const code = await proc.exited;
      clearTimeout(watchdog);
      if (code !== 0) {
        const stderr = await new Response(proc.stderr).text();
        log.error(`[atempo] ffmpeg exit=${code}: ${stderr.slice(-200)}`);
        return null;
      }
      const bytes = new Uint8Array(await fs.readFile(out));
      log.info(
        `[atempo] ${audioFilename} @${speed}x → ${bytes.byteLength} bytes in ${(performance.now() - t0).toFixed(0)}ms`
      );
      return bytes;
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  } catch (err) {
    log.error(`[atempo] failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
