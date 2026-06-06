// Video/audio file → transcript, via local ffmpeg + the configured Parakeet service.
//
// The Research tabs let users upload a raw video or audio file (a Twitter/X
// clip, a downloaded talk, a podcast). The file is kept in DocVault as media;
// this module turns it into a transcript in two steps:
//
//   1. ffmpeg demuxes + resamples the audio track to a 16 kHz mono 16-bit WAV
//      (the native input shape for Parakeet / Whisper ASR). Only the small
//      audio file ever leaves the box — never the whole video.
//   2. The WAV is POSTed to the configured OpenAI-compatible transcription
//      service (parakeet-mlx on the LAN) through the shared `transcribeAudioBlob`
//      helper, so there's exactly one place that knows the upstream contract.
//
// ffmpeg is installed in the Docker image (see Dockerfile). It's invoked the
// same way yt-dlp is in ./youtube-transcript.ts — Bun.spawn with a watchdog
// timeout and a temp working dir that's always cleaned up in `finally`.

import { mkdtemp, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { createLogger } from '../logger.js';
import { transcribeAudioBlob, safeHostHint } from '../routes/transcribe.js';
import { getTranscribeConfig } from '../data.js';

const log = createLogger('MediaTranscribe');

export const MEDIA_TRANSCRIBE_EXTRACTOR_VERSION = '1.0.0';

/** Watchdog for the ffmpeg audio-extraction subprocess. Extraction is just a
 *  demux + resample (no video re-encode), so even hour-long inputs finish well
 *  under a minute — this ceiling only catches a wedged process. */
const FFMPEG_TIMEOUT_MS = 600_000; // 10 min

/** Upper bound on the Parakeet round-trip. Generous (long lectures take a
 *  while) but bounded so a hung box can't hold the caller's single-flight slot
 *  forever — the slot is released when this throws. */
const TRANSCRIBE_TIMEOUT_MS = 900_000; // 15 min

export interface MediaTranscriptResult {
  /** Transcript text returned by the service. */
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
  const wavPath = path.join(tempDir, 'audio.wav');
  try {
    // ---- 1. ffmpeg: any A/V container → 16 kHz mono 16-bit PCM WAV ----
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
        'wav',
        '-y', // overwrite
        wavPath,
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
      // the most useful (e.g. "Invalid data found", "no such file").
      const tail = stderrText.trim().split('\n').slice(-3).join(' | ');
      throw new Error(`ffmpeg exited ${exitCode}: ${tail || '(no stderr)'}`);
    }

    const durationSec = parseFfmpegDuration(stderrText);
    let wavBytes = 0;
    try {
      wavBytes = (await stat(wavPath)).size;
    } catch {
      /* stat is best-effort, only used for logging + the empty-audio guard */
    }
    if (wavBytes === 0) {
      throw new Error('ffmpeg produced no audio — the file may have no audio track');
    }
    log.info(
      `[ffmpeg] extracted ${(wavBytes / 1024 / 1024).toFixed(1)}MB WAV` +
        (durationSec ? ` (${durationSec}s audio)` : '') +
        ` in ${extractMs()}ms`
    );

    // ---- 2. Parakeet: WAV → transcript (only the small audio leaves the box) ----
    const transcribeMs = log.timer();
    const { text } = await transcribeAudioBlob(Bun.file(wavPath), 'audio.wav', {
      timeoutMs: TRANSCRIBE_TIMEOUT_MS,
    });
    log.info(
      `[parakeet] transcribed → ${text.length} chars in ${transcribeMs()}ms ` +
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
