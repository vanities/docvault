// Video/audio file → transcript, via local ffmpeg + the configured Parakeet service.
//
// The Research tabs let users upload a raw video or audio file (a Twitter/X
// clip, a downloaded talk, an 80-minute lecture). The file is kept in DocVault
// as media; this module turns it into a transcript:
//
//   1. ffmpeg demuxes + resamples the audio to 16 kHz mono 16-bit WAV (the
//      native input shape for Parakeet / Whisper ASR) AND splits it into short
//      chunks in a single pass (the `segment` muxer).
//   2. Each chunk is POSTed in its own request to the configured
//      OpenAI-compatible service (parakeet-mlx on the LAN) via the shared
//      `transcribeAudioBlob` helper, then the per-chunk texts are stitched.
//
// Why chunk? The parakeet-mlx HTTP server drops the socket on very long audio
// (an 83-min file failed after ~60s — its own request ceiling). Short chunks
// each finish well under that, so transcription scales to arbitrarily long
// media. Per-chunk start times also give the transcript coarse [MM:SS] markers.
//
// ffmpeg is installed in the Docker image (see Dockerfile). It's invoked the
// same way yt-dlp is in ./youtube-transcript.ts — Bun.spawn with a watchdog
// timeout and a temp working dir that's always cleaned up in `finally`.

import { mkdtemp, readdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { createLogger } from '../logger.js';
import { transcribeAudioBlob, safeHostHint } from '../routes/transcribe.js';
import { getTranscribeConfig } from '../data.js';

const log = createLogger('MediaTranscribe');

export const MEDIA_TRANSCRIBE_EXTRACTOR_VERSION = '1.1.0';

/** Watchdog for the ffmpeg extract+segment subprocess. It's a demux + resample
 *  (no video re-encode), so even hour-long inputs finish in seconds — this
 *  ceiling only catches a wedged process. */
const FFMPEG_TIMEOUT_MS = 600_000; // 10 min

/** Audio chunk length. Small enough that each parakeet request finishes well
 *  under the server's request ceiling (an 83-min single request died at ~60s),
 *  large enough to keep the chunk count and per-request overhead reasonable. */
const SEGMENT_SECONDS = 240; // 4 min

/** Per-chunk ceiling on the parakeet round-trip — generous for a 4-min chunk,
 *  bounded so a hung box can't wedge the caller's single-flight slot. */
const PER_CHUNK_TRANSCRIBE_TIMEOUT_MS = 180_000; // 3 min

/** One retry per chunk — a transient socket drop mid-way through a long file
 *  shouldn't throw away all the chunks already transcribed. */
const CHUNK_RETRIES = 1;

export interface MediaTranscriptResult {
  /** Transcript text returned by the service (chunks stitched, [MM:SS] marked). */
  text: string;
  /** Source media duration in seconds (parsed from ffmpeg), or null. */
  durationSec: number | null;
}

/**
 * Extract audio from a video/audio file and transcribe it. Throws with a
 * user-facing message on any failure (service not configured, ffmpeg
 * missing/failed, no audio track, upstream error) — the caller records the
 * message on the research entry's `transcribeError`.
 */
export async function transcribeMediaFile(absFilePath: string): Promise<MediaTranscriptResult> {
  // Fail fast with a clear message if the service isn't set up, before we
  // spend time extracting audio.
  const cfg = await getTranscribeConfig();
  if (!cfg.url) {
    throw new Error(
      'Transcription service not configured. Set transcribeUrl in Settings (or DOCVAULT_TRANSCRIBE_URL env var).'
    );
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), 'dv-media-'));
  try {
    // ---- 1. ffmpeg: any A/V → 16 kHz mono WAV, split into SEGMENT_SECONDS chunks ----
    const extractMs = log.timer();
    const proc = Bun.spawn({
      cmd: [
        'ffmpeg',
        '-nostdin', // never block waiting on stdin in a subprocess
        '-i',
        absFilePath,
        '-vn', // drop any video stream
        '-ac',
        '1', // mono
        '-ar',
        '16000', // 16 kHz — native ASR sample rate
        '-c:a',
        'pcm_s16le', // 16-bit PCM
        '-f',
        'segment', // split output into multiple files…
        '-segment_time',
        String(SEGMENT_SECONDS), // …each ~SEGMENT_SECONDS long
        '-reset_timestamps',
        '1', // each chunk starts at t=0 (clean standalone WAVs)
        '-y', // overwrite
        path.join(tempDir, 'chunk_%04d.wav'),
      ],
      stdout: 'pipe',
      stderr: 'pipe',
    });

    // Watchdog: kill the subprocess if it stalls past the budget.
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill();
      } catch {
        /* already exited */
      }
    }, FFMPEG_TIMEOUT_MS);

    // ffmpeg writes progress to stderr; drain both pipes to avoid a deadlock.
    const [, stderrText, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    clearTimeout(timer);

    if (timedOut) {
      throw new Error(`ffmpeg timed out after ${FFMPEG_TIMEOUT_MS / 1000}s`);
    }
    if (exitCode !== 0) {
      // Surface the last few lines of stderr — ffmpeg's last word is usually
      // the most useful (e.g. "Invalid data found", "no audio track").
      const tail = stderrText.trim().split('\n').slice(-3).join(' | ');
      throw new Error(`ffmpeg exited ${exitCode}: ${tail || '(no stderr)'}`);
    }

    const durationSec = parseFfmpegDuration(stderrText);
    const chunkFiles = (await readdir(tempDir))
      .filter((f) => f.startsWith('chunk_') && f.endsWith('.wav'))
      .sort(); // zero-padded names sort chronologically
    if (chunkFiles.length === 0) {
      throw new Error('ffmpeg produced no audio — the file may have no audio track');
    }
    log.info(
      `[ffmpeg] extracted ${chunkFiles.length} chunk(s)` +
        (durationSec ? ` (${durationSec}s audio)` : '') +
        ` in ${extractMs()}ms`
    );

    // ---- 2. Parakeet: transcribe each chunk in its own request, sequentially ----
    // Sequential, not parallel: parakeet is a single box, and the whole point
    // is to avoid overwhelming it. Chunks are stitched with a [MM:SS] marker
    // (only when there's more than one) so long transcripts stay navigable.
    const multi = chunkFiles.length > 1;
    const parts: string[] = [];
    const transcribeMs = log.timer();
    for (let i = 0; i < chunkFiles.length; i++) {
      const chunkPath = path.join(tempDir, chunkFiles[i]);
      const chunkMs = log.timer();
      const chunkText = (await transcribeChunk(chunkPath)).trim();
      log.info(
        `[parakeet] chunk ${i + 1}/${chunkFiles.length} → ${chunkText.length} chars in ${chunkMs()}ms`
      );
      if (chunkText) {
        parts.push(multi ? `[${formatTimestamp(i * SEGMENT_SECONDS)}]\n${chunkText}` : chunkText);
      }
      // Free disk as we go — long media can be hundreds of MB of chunks.
      await rm(chunkPath, { force: true }).catch(() => {});
    }

    const text = parts.join('\n\n');
    log.info(
      `[parakeet] ${chunkFiles.length} chunk(s) → ${text.length} chars in ${transcribeMs()}ms ` +
        `(${safeHostHint(cfg.url)})`
    );

    return { text, durationSec };
  } finally {
    // Always remove the temp dir, even on error.
    await rm(tempDir, { recursive: true, force: true }).catch(() => {
      /* best effort */
    });
  }
}

/** Transcribe one chunk, retrying once on a transient upstream failure (the
 *  parakeet box occasionally drops a socket). Throws after the last attempt. */
async function transcribeChunk(chunkPath: string, attempt = 1): Promise<string> {
  try {
    const { text } = await transcribeAudioBlob(Bun.file(chunkPath), 'audio.wav', {
      timeoutMs: PER_CHUNK_TRANSCRIBE_TIMEOUT_MS,
    });
    return text;
  } catch (err) {
    if (attempt <= CHUNK_RETRIES) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(
        `[parakeet] ${path.basename(chunkPath)} attempt ${attempt} failed: ${msg}; retrying`
      );
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return transcribeChunk(chunkPath, attempt + 1);
    }
    throw err;
  }
}

/** Seconds → "M:SS" (or "H:MM:SS" past an hour) for the per-chunk marker. */
function formatTimestamp(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

/**
 * Pull the source duration out of ffmpeg's stderr banner —
 * "  Duration: 00:12:34.56, start: 0.000000, bitrate: …" → 754. Returns null
 * when ffmpeg didn't print a parseable duration (e.g. some streamed inputs).
 */
function parseFfmpegDuration(stderr: string): number | null {
  const m = stderr.match(/Duration:\s*(\d+):(\d{2}):(\d{2})(?:\.\d+)?/);
  if (!m) return null;
  const total = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return Number.isFinite(total) ? Math.floor(total) : null;
}
