// Client for an OpenAI-compatible text-to-speech service (chatterbox-tts-api,
// mlx-audio, or any server exposing /v1/audio/speech).
//
// Two surfaces:
//   - POST {root}/v1/audio/speech — OpenAI-compatible synthesis ({input, voice})
//   - {root}/voices               — chatterbox's named voice library (multipart
//     upload / delete). Voice-library calls are chatterbox-specific; a plain
//     OpenAI endpoint still works for synthesis with its built-in voices.
//
// DocVault is the source of truth for reference clips
// (DATA_DIR/health/<personId>/voice/); the TTS server's voice library is a
// cache we re-push to before use, so a stale or wiped library self-heals.

import { getTtsConfig } from './data.js';
import { createLogger } from './logger.js';
import { safeHostHint } from './routes/transcribe.js';

const log = createLogger('TTS');

/** Ceiling on the voice-library delete+upload round trip. */
const VOICE_PUSH_TIMEOUT_MS = 60_000;
/** Ceiling on one synthesis request. Test sentences finish in seconds on a
 *  GPU box; the margin covers a cold model load or a busy card. */
const SYNTH_TIMEOUT_MS = 300_000;

/** Strip trailing slashes and a trailing /v1 so both "http://host:4123" and
 *  "http://host:4123/v1" configs work (same forgiveness as the transcribe URL). */
export function ttsRootUrl(url: string): string {
  return url.replace(/\/+$/, '').replace(/\/v1$/, '');
}

function authHeaders(apiKey?: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

async function requireTtsUrl(): Promise<{ root: string; apiKey?: string; language: string }> {
  const cfg = await getTtsConfig();
  if (!cfg.url) {
    throw new Error(
      'Text-to-speech service not configured. Set the TTS server URL in Settings → Voice (or DOCVAULT_TTS_URL env var).'
    );
  }
  return { root: ttsRootUrl(cfg.url), apiKey: cfg.apiKey, language: cfg.language };
}

/**
 * Replace-or-create a named voice on the TTS server from a reference clip.
 * Deletes any existing voice of the same name first so re-pushes always
 * reflect the newest reference clip (a 404 on delete just means it's new).
 */
export async function pushVoice(name: string, clip: Uint8Array, filename: string): Promise<void> {
  const { root, apiKey, language } = await requireTtsUrl();
  const t0 = performance.now();
  log.debug(
    `[voice] push start name="${name}" file=${filename} bytes=${clip.byteLength} lang=${language}`
  );
  try {
    const del = await fetch(`${root}/voices/${encodeURIComponent(name)}`, {
      method: 'DELETE',
      headers: authHeaders(apiKey),
      signal: AbortSignal.timeout(VOICE_PUSH_TIMEOUT_MS),
    });
    log.debug(`[voice] delete existing "${name}" → ${del.status}`);

    const form = new FormData();
    form.append('voice_name', name);
    form.append('language', language);
    form.append('voice_file', new Blob([new Uint8Array(clip)]), filename);
    const res = await fetch(`${root}/voices`, {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: form,
      signal: AbortSignal.timeout(VOICE_PUSH_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = (await res.text().catch(() => '')).slice(0, 200);
      throw new Error(`Voice upload failed: ${res.status} ${body}`);
    }
    log.info(
      `[voice] pushed "${name}" (${clip.byteLength} bytes) in ${(performance.now() - t0).toFixed(0)}ms`
    );
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Voice upload failed')) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to reach TTS service at ${safeHostHint(root)}: ${msg}`);
  }
}

export interface SynthesisResult {
  bytes: Uint8Array;
  contentType: string;
  /** Wall-clock synthesis time, for surfacing speed in the UI. */
  ms: number;
}

export interface SynthesisTuning {
  /** Emotion intensity, 0.25–2.0 (chatterbox default 0.5). */
  exaggeration?: number;
  /** Pace control, 0.0–1.0 (chatterbox default 0.5). Sent as `cfg_weight`. */
  cfgWeight?: number;
}

/** Synthesize speech. `voice` is a named voice in the server's library;
 *  omitted = the server's default voice. Undefined tuning fields fall back to
 *  the TTS server's own defaults. */
export async function synthesizeSpeech(
  text: string,
  voice?: string,
  tuning?: SynthesisTuning
): Promise<SynthesisResult> {
  const { root, apiKey } = await requireTtsUrl();
  const t0 = performance.now();
  log.debug(
    `[synth] start chars=${text.length} voice=${voice ?? '(default)'} ` +
      `exag=${tuning?.exaggeration ?? 'default'} cfg=${tuning?.cfgWeight ?? 'default'}`
  );
  const payload: Record<string, unknown> = { input: text };
  if (voice) payload.voice = voice;
  if (tuning?.exaggeration !== undefined) payload.exaggeration = tuning.exaggeration;
  if (tuning?.cfgWeight !== undefined) payload.cfg_weight = tuning.cfgWeight;
  let res: Response;
  try {
    res = await fetch(`${root}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(apiKey) },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(SYNTH_TIMEOUT_MS),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to reach TTS service at ${safeHostHint(root)}: ${msg}`);
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(`TTS synthesis failed: ${res.status} ${body}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const ms = performance.now() - t0;
  log.info(`[synth] done chars=${text.length} → ${bytes.byteLength} bytes in ${ms.toFixed(0)}ms`);
  return { bytes, contentType: res.headers.get('content-type') || 'audio/wav', ms };
}
