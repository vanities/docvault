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
import os from 'os';
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

/** Formats browsers record that TTS voice libraries refuse (chatterbox
 *  accepts .flac/.mp3/.ogg/.m4a/.wav only) — converted to WAV at upload,
 *  and defensively at push time for clips stored before this existed. */
const CONVERT_TO_WAV_EXTS = new Set(['.webm', '.mp4']);

/** Plenty for a ≤90 s clip; only catches a wedged ffmpeg. */
const FFMPEG_TIMEOUT_MS = 60_000;

export function needsWavConversion(filename: string): boolean {
  return CONVERT_TO_WAV_EXTS.has(path.extname(filename).toLowerCase());
}

/** Transcode a clip to 24 kHz mono 16-bit WAV via ffmpeg (bundled in the
 *  Docker image; same Bun.spawn pattern as media-transcribe). Throws with a
 *  user-facing message on failure. */
async function convertToWavBytes(input: Uint8Array, ext: string): Promise<Uint8Array> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dv-voice-'));
  const t0 = performance.now();
  try {
    const inPath = path.join(tempDir, `in${ext}`);
    const outPath = path.join(tempDir, 'out.wav');
    await fs.writeFile(inPath, input);
    const proc = Bun.spawn({
      cmd: [
        'ffmpeg',
        '-y',
        '-i',
        inPath,
        '-ac',
        '1',
        '-ar',
        '24000',
        '-sample_fmt',
        's16',
        outPath,
      ],
      stdout: 'ignore',
      stderr: 'pipe',
    });
    const watchdog = setTimeout(() => proc.kill(), FFMPEG_TIMEOUT_MS);
    const code = await proc.exited;
    clearTimeout(watchdog);
    if (code !== 0) {
      const stderr = await new Response(proc.stderr).text();
      log.error(`[convert] ffmpeg exit=${code}: ${stderr.slice(-300)}`);
      throw new Error('Could not convert recording to WAV (ffmpeg failed)');
    }
    const out = new Uint8Array(await fs.readFile(outPath));
    log.info(
      `[convert] ${ext} ${input.byteLength}B → wav ${out.byteLength}B in ${(performance.now() - t0).toFixed(0)}ms`
    );
    return out;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Could not convert')) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`[convert] failed: ${msg}`);
    throw new Error('Could not convert recording to WAV — is ffmpeg installed on the server?');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

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

/**
 * Load a person's current cloning reference — the newest clip, converted to a
 * format the TTS voice library accepts. Shared by the voice test route and
 * the newsstand narration pipeline. Null when the person has no clips.
 */
export async function loadVoiceReference(
  personId: string
): Promise<{ bytes: Uint8Array; filename: string; voiceName: string } | null> {
  const clips = await listClips(personId);
  if (clips.length === 0) return null;
  const newest = clips[0];
  const abs = clipPath(personId, newest.filename);
  if (!abs) return null;
  let bytes: Uint8Array = new Uint8Array(await fs.readFile(abs));
  let filename = newest.filename;
  if (needsWavConversion(filename)) {
    bytes = await convertToWavBytes(bytes, path.extname(filename).toLowerCase());
    filename = filename.slice(0, -path.extname(filename).length) + '.wav';
  }
  return { bytes, filename, voiceName: voiceNameFor(personId) };
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
    // Normalize webm/mp4 to WAV on the way in so every stored clip is
    // directly pushable to the TTS voice library.
    let storedBytes: Uint8Array = raw;
    let storedName = filename;
    if (needsWavConversion(filename)) {
      try {
        storedBytes = await convertToWavBytes(raw, path.extname(filename).toLowerCase());
        storedName = filename.slice(0, -path.extname(filename).length) + '.wav';
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 400);
      }
    }
    await ensureDir(voiceDir(personId));
    const finalName = await availableName(personId, storedName);
    const abs = clipPath(personId, finalName);
    if (!abs) return jsonResponse({ error: 'Invalid clip path' }, 400);
    await fs.writeFile(abs, storedBytes);
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
      let refBytes: Uint8Array = new Uint8Array(await fs.readFile(refAbs));
      let refName = reference.filename;
      // Legacy clips stored before upload-time normalization (e.g. .webm
      // recordings) get converted on the fly so they stay usable.
      if (needsWavConversion(refName)) {
        refBytes = await convertToWavBytes(refBytes, path.extname(refName).toLowerCase());
        refName = refName.slice(0, -path.extname(refName).length) + '.wav';
      }
      await pushVoice(voiceName, refBytes, refName);
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
