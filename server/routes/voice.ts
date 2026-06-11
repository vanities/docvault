// Per-person voice profile routes — reference clips for TTS voice cloning.
//
// A person's "voice" is a small set of short reference audio clips (15–30 s of
// clean speech). Modern zero-shot TTS (Chatterbox et al.) conditions on a
// reference clip at inference time — there is no training step — so the clips
// ARE the voice. Clips live on disk under DATA_DIR/health/<personId>/voice/
// and the filesystem is the source of truth (no store entries to drift).
//
//   GET    /api/health/:personId/voice                  → { clips, ttsConfigured, voiceName }
//   POST   /api/health/:personId/voice/clips?filename=X — body: raw audio bytes
//   GET    /api/health/:personId/voice/clips/:filename  → audio bytes (for <audio> playback)
//   DELETE /api/health/:personId/voice/clips/:filename
//   POST   /api/health/:personId/voice/test             — { text? } → synthesized audio
//
// The test route pushes the newest clip to the configured TTS server as the
// named voice "docvault-<personId>", synthesizes a sample sentence with it,
// and returns the audio for in-browser playback.

import { promises as fs } from 'fs';
import path from 'path';
import { jsonResponse, ensureDir, DATA_DIR, getTtsConfig } from '../data.js';
import { requirePerson } from '../health-store.js';
import { readJsonBody } from '../http.js';
import { pushVoice, synthesizeSpeech } from '../tts.js';
import { createLogger } from '../logger.js';

const log = createLogger('Voice');

/** Known audio container extensions → content type. MediaRecorder produces
 *  webm (Chromium) or mp4 (Safari); uploads may be anything common. */
const AUDIO_TYPES: Record<string, string> = {
  '.webm': 'audio/webm',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
};

/** Reference clips are seconds long; even lossless WAV stays far under this. */
const MAX_CLIP_BYTES = 50 * 1024 * 1024;

/** Cap test-sentence length — the test button is a quality check, not a narrator. */
const MAX_TEST_TEXT_CHARS = 500;

/** Accepted tuning ranges, mirrored from the chatterbox TTSRequest schema. */
const EXAGGERATION_RANGE = [0.25, 2] as const;
const CFG_WEIGHT_RANGE = [0, 1] as const;

/** Clamp a tuning knob into the TTS server's accepted range; anything
 *  non-numeric → undefined (= use the server's own default). */
export function clampKnob(v: unknown, min: number, max: number): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return undefined;
  return Math.min(max, Math.max(min, n));
}

const DEFAULT_TEST_TEXT =
  'Good morning. This is your DocVault daily edition, read in a cloned voice. ' +
  'If this sounds like you, the narrator is ready.';

export interface VoiceClipInfo {
  filename: string;
  size: number;
  uploadedAt: string;
}

function voiceDir(personId: string): string {
  return path.join(DATA_DIR, 'health', personId, 'voice');
}

/** The person's voice name in the TTS server's library. */
function voiceNameFor(personId: string): string {
  return `docvault-${personId}`;
}

/** Sanitize a clip filename: basename only, safe charset, known audio
 *  extension required. Returns null when unusable. */
export function sanitizeClipFilename(raw: string | null): string | null {
  if (!raw) return null;
  const base = path
    .basename(raw)
    .trim()
    .replace(/[^a-zA-Z0-9._ -]/g, '_');
  if (!base || base.startsWith('.')) return null;
  const ext = path.extname(base).toLowerCase();
  if (!(ext in AUDIO_TYPES)) return null;
  return base;
}

/** Resolve a clip path, refusing anything that escapes the person's voice dir.
 *  Defense in depth — filenames are already sanitized to a bare basename. */
function clipPath(personId: string, filename: string): string | null {
  const dir = voiceDir(personId);
  const abs = path.resolve(dir, filename);
  if (!abs.startsWith(dir + path.sep)) return null;
  return abs;
}

async function listClips(personId: string): Promise<VoiceClipInfo[]> {
  let names: string[];
  try {
    names = await fs.readdir(voiceDir(personId));
  } catch {
    return []; // no dir yet = no clips
  }
  const clips: VoiceClipInfo[] = [];
  for (const name of names) {
    const ext = path.extname(name).toLowerCase();
    if (!(ext in AUDIO_TYPES)) continue;
    const abs = clipPath(personId, name);
    if (!abs) continue;
    const stat = await fs.stat(abs);
    if (!stat.isFile()) continue;
    clips.push({ filename: name, size: stat.size, uploadedAt: stat.mtime.toISOString() });
  }
  // Newest first — the test route uses [0] as the cloning reference.
  return clips.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

/** Find a free filename, suffixing "-2", "-3", … before the extension. */
async function availableName(personId: string, filename: string): Promise<string> {
  const ext = path.extname(filename);
  const stem = filename.slice(0, -ext.length);
  let candidate = filename;
  for (let i = 2; ; i++) {
    const abs = clipPath(personId, candidate);
    if (!abs) return filename; // unreachable post-sanitize; keep TS happy
    try {
      await fs.stat(abs);
      candidate = `${stem}-${i}${ext}`;
    } catch {
      return candidate;
    }
  }
}

export async function handleVoiceRoutes(
  req: Request,
  url: URL,
  pathname: string
): Promise<Response | null> {
  // Match /api/health/:personId/voice[...]
  const match = pathname.match(/^\/api\/health\/([^/]+)\/voice(\/[^?]*)?$/);
  if (!match) return null;
  const personId = decodeURIComponent(match[1]);
  const sub = match[2] ?? '';

  // Unknown people 404 before any path is built from the id.
  try {
    await requirePerson(personId);
  } catch (err) {
    return jsonResponse({ error: String(err instanceof Error ? err.message : err) }, 404);
  }

  // GET /api/health/:personId/voice — clip list + TTS readiness
  if (sub === '' && req.method === 'GET') {
    const [clips, cfg] = await Promise.all([listClips(personId), getTtsConfig()]);
    return jsonResponse({
      clips,
      ttsConfigured: !!cfg.url,
      voiceName: voiceNameFor(personId),
    });
  }

  // POST /api/health/:personId/voice/clips?filename=X — body: raw audio bytes
  if (sub === '/clips' && req.method === 'POST') {
    const filename = sanitizeClipFilename(url.searchParams.get('filename'));
    if (!filename) {
      return jsonResponse(
        {
          error: `filename query param with an audio extension is required (${Object.keys(AUDIO_TYPES).join(', ')})`,
        },
        400
      );
    }
    const raw = new Uint8Array(await req.arrayBuffer());
    if (raw.byteLength === 0) return jsonResponse({ error: 'Empty upload' }, 400);
    if (raw.byteLength > MAX_CLIP_BYTES) {
      return jsonResponse(
        { error: 'Clip too large — reference clips should be seconds long' },
        413
      );
    }
    await ensureDir(voiceDir(personId));
    const finalName = await availableName(personId, filename);
    const abs = clipPath(personId, finalName);
    if (!abs) return jsonResponse({ error: 'Invalid clip path' }, 400);
    await fs.writeFile(abs, raw);
    const stat = await fs.stat(abs);
    log.info(`[upload] ${personId}/${finalName} bytes=${raw.byteLength}`);
    return jsonResponse({
      clip: { filename: finalName, size: stat.size, uploadedAt: stat.mtime.toISOString() },
    });
  }

  // GET|DELETE /api/health/:personId/voice/clips/:filename
  const clipMatch = sub.match(/^\/clips\/([^/]+)$/);
  if (clipMatch && (req.method === 'GET' || req.method === 'DELETE')) {
    const filename = sanitizeClipFilename(decodeURIComponent(clipMatch[1]));
    if (!filename) return jsonResponse({ error: 'Invalid clip filename' }, 400);
    const abs = clipPath(personId, filename);
    if (!abs) return jsonResponse({ error: 'Invalid clip path' }, 400);

    if (req.method === 'GET') {
      try {
        const bytes = await fs.readFile(abs);
        const ext = path.extname(filename).toLowerCase();
        return new Response(bytes, {
          headers: {
            'Content-Type': AUDIO_TYPES[ext] ?? 'application/octet-stream',
            'Cache-Control': 'no-store',
          },
        });
      } catch {
        return jsonResponse({ error: 'Clip not found' }, 404);
      }
    }

    try {
      await fs.unlink(abs);
    } catch {
      return jsonResponse({ error: 'Clip not found' }, 404);
    }
    log.info(`[delete] ${personId}/${filename}`);
    return jsonResponse({ ok: true });
  }

  // POST /api/health/:personId/voice/test — synthesize a sample in this voice
  if (sub === '/test' && req.method === 'POST') {
    // Body is optional — an empty POST tests with the default sentence and
    // the TTS server's own tuning defaults.
    let requestedText = '';
    let rawTuning: { exaggeration?: unknown; cfgWeight?: unknown } = {};
    try {
      const body = await readJsonBody<{
        text?: string;
        exaggeration?: unknown;
        cfgWeight?: unknown;
      }>(req);
      requestedText = typeof body?.text === 'string' ? body.text : '';
      rawTuning = body ?? {};
    } catch {
      /* empty or non-JSON body → defaults */
    }
    const exaggeration = clampKnob(rawTuning.exaggeration, ...EXAGGERATION_RANGE);
    const cfgWeight = clampKnob(rawTuning.cfgWeight, ...CFG_WEIGHT_RANGE);

    const cfg = await getTtsConfig();
    if (!cfg.url) {
      return jsonResponse(
        {
          error:
            'Text-to-speech service not configured. Set the TTS server URL in Settings → Voice.',
        },
        400
      );
    }
    const clips = await listClips(personId);
    if (clips.length === 0) {
      return jsonResponse({ error: 'No reference clips yet — record or upload one first.' }, 400);
    }

    const reference = clips[0]; // newest clip wins
    const voiceName = voiceNameFor(personId);
    const text = (requestedText.trim() || DEFAULT_TEST_TEXT).slice(0, MAX_TEST_TEXT_CHARS);
    const t0 = performance.now();
    log.info(
      `[test] start person=${personId} ref=${reference.filename} chars=${text.length} ` +
        `exag=${exaggeration ?? 'default'} cfg=${cfgWeight ?? 'default'}`
    );
    try {
      const refAbs = clipPath(personId, reference.filename);
      if (!refAbs) return jsonResponse({ error: 'Invalid clip path' }, 400);
      const refBytes = new Uint8Array(await fs.readFile(refAbs));
      await pushVoice(voiceName, refBytes, reference.filename);
      const result = await synthesizeSpeech(text, voiceName, { exaggeration, cfgWeight });
      log.info(
        `[test] done person=${personId} in ${(performance.now() - t0).toFixed(0)}ms (synthesis ${result.ms.toFixed(0)}ms)`
      );
      return new Response(result.bytes, {
        headers: {
          'Content-Type': result.contentType,
          'Cache-Control': 'no-store',
          'X-Generation-Ms': String(Math.round(result.ms)),
          'X-Reference-Clip': encodeURIComponent(reference.filename),
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`[test] failed person=${personId}: ${msg}`);
      return jsonResponse({ error: msg }, 502);
    }
  }

  return null;
}
