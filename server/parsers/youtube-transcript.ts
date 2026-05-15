// YouTube transcript extractor.
//
// Shells out to `yt-dlp` (installed in the Dockerfile, self-updated by
// the container entrypoint) to fetch a video's captions and metadata in
// one round-trip. The library route (`youtubei.js`) is broken on
// `get_transcript` as of writing — yt-dlp is the only thing that
// reliably extracts captions, even though it's a binary subprocess.
//
// Two caption formats are handled by the cleaner:
//   • YouTube auto-captions — rolling-window VTT where only the "live"
//     line of each cue carries inline <c>word</c> timing tags. We keep
//     only those lines.
//   • Manual / uploaded captions — clean per-cue text, no <c> tags. We
//     keep every line with at least one letter.
// Auto-detected per file via the presence of any `<c>` tag.

import { mkdtemp, readdir, readFile, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { createLogger } from '../logger.js';

const log = createLogger('YouTubeTranscript');

export const YOUTUBE_EXTRACTOR_VERSION = '1.0.0';

/** Time budget for the yt-dlp subprocess — kills it if it stalls. */
const YT_DLP_TIMEOUT_MS = 60_000;

export interface YouTubeTranscriptResult {
  videoId: string;
  /** Canonical watch URL (from yt-dlp's webpage_url; falls back to input). */
  url: string;
  title: string;
  /** YouTube channel name (the uploader). */
  channel: string;
  /** YYYY-MM-DD; null if yt-dlp didn't report a date. */
  uploadDate: string | null;
  durationSec: number | null;
  /** Cleaned transcript: one `(M:SS) text` line per kept caption cue. */
  text: string;
  /** Number of caption lines after dedup. */
  segmentCount: number;
}

// ---------------------------------------------------------------------------
// URL → video ID
// ---------------------------------------------------------------------------

const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const URL_PATTERNS: RegExp[] = [
  /(?:youtube\.com\/watch\?(?:.*&)?v=)([A-Za-z0-9_-]{11})/i,
  /(?:youtu\.be\/)([A-Za-z0-9_-]{11})/i,
  /(?:youtube\.com\/(?:embed|v|shorts|live)\/)([A-Za-z0-9_-]{11})/i,
];

/**
 * Extract a YouTube video ID from a watch URL, `youtu.be` short link,
 * embed URL, shorts URL, or the bare 11-character ID. Returns null
 * when no recognizable ID can be found.
 */
export function extractVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (ID_RE.test(trimmed)) return trimmed;
  for (const re of URL_PATTERNS) {
    const m = trimmed.match(re);
    if (m) return m[1];
  }
  return null;
}

// ---------------------------------------------------------------------------
// VTT cleaning
// ---------------------------------------------------------------------------

const HTML_ESCAPES: Array<[RegExp, string]> = [
  [/&amp;/g, '&'],
  [/&lt;/g, '<'],
  [/&gt;/g, '>'],
  [/&#39;/g, "'"],
  [/&quot;/g, '"'],
  [/&nbsp;/g, ' '],
];

function htmlUnescape(s: string): string {
  let out = s;
  for (const [re, repl] of HTML_ESCAPES) out = out.replace(re, repl);
  return out;
}

function formatTime(vttTs: string): string {
  // vttTs like "00:01:23.456"
  const parts = vttTs.split(':');
  if (parts.length !== 3) return '(?)';
  const total = Math.floor(Number(parts[0]) * 3600 + Number(parts[1]) * 60 + parseFloat(parts[2]));
  return `(${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')})`;
}

/**
 * Clean a VTT file into `(M:SS) text` lines, deduped and HTML-unescaped.
 * Auto-detects between YouTube auto-caption rolling-window format and
 * clean manual captions.
 */
export function cleanVtt(vtt: string): { text: string; segmentCount: number } {
  const lines = vtt.split('\n');
  // The "live" line of each auto-caption cue carries inline <c>word</c>
  // timing tags; manual captions never do. Presence of `<c>` is the
  // tell — flips the cleaner into rolling-window-dedup mode.
  const hasInlineTimingTags = vtt.includes('<c>');

  const out: string[] = [];
  let curStart: string | null = null;

  for (const line of lines) {
    const ts = line.match(/^(\d\d:\d\d:\d\d\.\d\d\d) -->/);
    if (ts) {
      curStart = ts[1];
      continue;
    }
    if (!curStart) continue; // header / pre-cue noise

    // Skip pure-digit cue identifier lines (sometimes present in uploaded VTT).
    if (/^\d+$/.test(line.trim())) continue;

    if (hasInlineTimingTags) {
      // Auto-captions: only the <c>-tagged "live" line counts.
      if (!line.includes('<c>')) continue;
    } else {
      // Manual: require at least one letter to count as content.
      if (!/[A-Za-z]/.test(line)) continue;
    }

    const stripped = htmlUnescape(line.replace(/<[^>]+>/g, ''))
      .replace(/\s+/g, ' ')
      .trim();
    if (!stripped) continue;

    // Dedup against the immediately previous kept line — belt-and-suspenders
    // for any boundary case the format-specific filter let through.
    const prevText = out.length > 0 ? out[out.length - 1].replace(/^\(\d+:\d\d\) /, '') : null;
    if (stripped === prevText) continue;

    out.push(`${formatTime(curStart)} ${stripped}`);
  }

  return { text: out.join('\n'), segmentCount: out.length };
}

// ---------------------------------------------------------------------------
// yt-dlp subprocess
// ---------------------------------------------------------------------------

interface YtDlpMetadata {
  id: string;
  title?: string;
  channel?: string;
  uploader?: string;
  upload_date?: string; // YYYYMMDD
  duration?: number;
  webpage_url?: string;
}

/** Parse YYYYMMDD into YYYY-MM-DD, or null. */
function parseUploadDate(raw: string | undefined): string | null {
  if (!raw || !/^\d{8}$/.test(raw)) return null;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

/**
 * Pick the smallest matching `.vtt` from the temp dir. Manual captions
 * are dramatically smaller than auto-caption VTT (~5× for a 10-minute
 * video), so size is a reliable proxy for "this is the cleaner source."
 */
async function pickPreferredVtt(tempDir: string, videoId: string): Promise<string | null> {
  const files = await readdir(tempDir);
  const candidates = files.filter((f) => f.startsWith(videoId) && f.endsWith('.vtt'));
  if (candidates.length === 0) return null;
  let chosen: string | null = null;
  let chosenSize = Infinity;
  for (const f of candidates) {
    const s = await stat(path.join(tempDir, f));
    if (s.size < chosenSize) {
      chosenSize = s.size;
      chosen = f;
    }
  }
  return chosen;
}

/**
 * Fetch a YouTube video's captions + metadata via yt-dlp and return a
 * cleaned, structured result. Throws with a user-facing message on
 * failure (private video, no captions, network down, yt-dlp missing).
 */
export async function fetchYouTubeTranscript(url: string): Promise<YouTubeTranscriptResult> {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error('Not a recognized YouTube URL');

  const tempDir = await mkdtemp(path.join(tmpdir(), 'dv-yt-'));
  try {
    const proc = Bun.spawn({
      cmd: [
        'yt-dlp',
        '--no-simulate',
        '--skip-download',
        '--write-auto-subs',
        '--write-subs',
        '--sub-langs',
        'en.*',
        '--sub-format',
        'vtt',
        '--dump-json',
        '-o',
        path.join(tempDir, '%(id)s.%(ext)s'),
        url,
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
    }, YT_DLP_TIMEOUT_MS);

    const [stdoutText, stderrText, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    clearTimeout(timer);

    if (timedOut) {
      throw new Error(`yt-dlp timed out after ${YT_DLP_TIMEOUT_MS / 1000}s`);
    }
    if (exitCode !== 0) {
      // Surface just the last few lines of stderr — yt-dlp's last word is
      // usually the most useful (e.g. "Video unavailable", "Private video").
      const tail = stderrText.trim().split('\n').slice(-3).join(' | ');
      throw new Error(`yt-dlp exited ${exitCode}: ${tail || '(no stderr)'}`);
    }

    let meta: YtDlpMetadata;
    try {
      meta = JSON.parse(stdoutText) as YtDlpMetadata;
    } catch {
      throw new Error('yt-dlp metadata JSON parse failed');
    }
    if (meta.id !== videoId) {
      log.warn(`yt-dlp returned id=${meta.id} for url=${url} (expected ${videoId})`);
    }

    const chosen = await pickPreferredVtt(tempDir, meta.id);
    if (!chosen) {
      throw new Error('Video has no English captions available');
    }
    const vtt = await readFile(path.join(tempDir, chosen), 'utf-8');
    const { text, segmentCount } = cleanVtt(vtt);

    if (segmentCount === 0) {
      throw new Error('Caption file present but no readable text after cleaning');
    }

    return {
      videoId: meta.id,
      url: meta.webpage_url ?? url,
      title: meta.title ?? `Untitled (${meta.id})`,
      channel: meta.channel ?? meta.uploader ?? 'Unknown',
      uploadDate: parseUploadDate(meta.upload_date),
      durationSec: typeof meta.duration === 'number' ? Math.floor(meta.duration) : null,
      text,
      segmentCount,
    };
  } finally {
    // Cleanup temp dir even on error.
    await rm(tempDir, { recursive: true, force: true }).catch(() => {
      /* best effort */
    });
  }
}
