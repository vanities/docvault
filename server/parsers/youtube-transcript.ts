// YouTube transcript extractor.
//
// Shells out to `yt-dlp` (installed in the Dockerfile, self-updated by
// the container entrypoint) to fetch a video's captions and metadata in
// paced metadata + single-caption requests. The library route (`youtubei.js`) is broken on
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

import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { createLogger } from '../logger.js';

const log = createLogger('YouTubeTranscript');

export const YOUTUBE_EXTRACTOR_VERSION = '1.1.0';

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
  captionSource: 'manual' | 'automatic';
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

export interface YtDlpMetadata {
  id: string;
  title?: string;
  channel?: string;
  uploader?: string;
  upload_date?: string; // YYYYMMDD
  duration?: number;
  webpage_url?: string;
  subtitles?: Record<string, unknown[]>;
  automatic_captions?: Record<string, unknown[]>;
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

export type YouTubeFailureCode =
  | 'rate-limited'
  | 'timeout'
  | 'network'
  | 'unavailable'
  | 'no-captions'
  | 'extractor';

export class YouTubeTranscriptError extends Error {
  readonly code: YouTubeFailureCode;
  readonly retryable: boolean;
  readonly attempts: number;
  readonly retryAt?: string;
  constructor(
    message: string,
    code: YouTubeFailureCode,
    retryable: boolean,
    attempts: number,
    retryAt?: string
  ) {
    super(message);
    this.name = 'YouTubeTranscriptError';
    this.code = code;
    this.retryable = retryable;
    this.attempts = attempts;
    this.retryAt = retryAt;
  }
}

export interface YtDlpProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut?: boolean;
}

type ProcessRunner = (cmd: string[]) => Promise<YtDlpProcessResult>;

async function runYtDlp(cmd: string[]): Promise<YtDlpProcessResult> {
  const proc = Bun.spawn({ cmd, stdout: 'pipe', stderr: 'pipe' });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, YT_DLP_TIMEOUT_MS);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout, stderr, exitCode, timedOut };
  } finally {
    clearTimeout(timer);
  }
}

/** Download one English track, preferring uploaded captions and then the
 * original auto-caption track. en.* also downloads translated variants. */
export function selectEnglishCaption(meta: YtDlpMetadata): {
  language: string;
  automatic: boolean;
} | null {
  for (const [tracks, automatic] of [
    [meta.subtitles, false],
    [meta.automatic_captions, true],
  ] as const) {
    const languages = Object.keys(tracks ?? {}).filter(
      (lang) => /^en(?:-[A-Za-z0-9]+)*$/.test(lang) && (tracks?.[lang]?.length ?? 0) > 0
    );
    const preferred = automatic ? ['en-orig', 'en', 'en-US', 'en-GB'] : ['en', 'en-US', 'en-GB'];
    const language = preferred.find((lang) => languages.includes(lang)) ?? languages.sort()[0];
    if (language) return { language, automatic };
  }
  return null;
}

function processFailure(result: YtDlpProcessResult, attempts: number): YouTubeTranscriptError {
  const reason =
    result.stderr.trim().split('\n').filter(Boolean).at(-1)?.slice(0, 500) ||
    `yt-dlp exited ${result.exitCode}`;
  if (/429|too many requests/i.test(result.stderr)) {
    return new YouTubeTranscriptError(
      'YouTube rate limited caption requests (HTTP 429)',
      'rate-limited',
      true,
      attempts
    );
  }
  if (result.timedOut || /timed? out|timeout/i.test(result.stderr)) {
    return new YouTubeTranscriptError(
      `yt-dlp timed out after ${YT_DLP_TIMEOUT_MS / 1000}s`,
      'timeout',
      true,
      attempts
    );
  }
  if (
    /private video|members.only|available to this channel|video unavailable|removed by the uploader|age.restricted|sign in to confirm/i.test(
      result.stderr
    )
  ) {
    return new YouTubeTranscriptError(reason, 'unavailable', false, attempts);
  }
  const retryable =
    /HTTP (?:Error )?5\d\d|connection|network|temporary|remote end closed|unable to download/i.test(
      result.stderr
    );
  return new YouTubeTranscriptError(
    reason,
    retryable ? 'network' : 'extractor',
    retryable,
    attempts
  );
}

/** One queue across all channel jobs and manual imports. A 429 opens a shared
 * 15-minute cooldown: queued videos fail fast with a retry time, instead of
 * making every channel hit the same throttled endpoint. Other transient
 * failures get up to three attempts, with exponential backoff and jitter. */
export function createYouTubeTranscriptFetcher(
  deps: {
    run?: ProcessRunner;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    random?: () => number;
  } = {}
): (url: string) => Promise<YouTubeTranscriptResult> {
  const run = deps.run ?? runYtDlp;
  const now = deps.now ?? Date.now;
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = deps.random ?? Math.random;
  let queue = Promise.resolve();
  let nextRequestAt = 0;
  let cooldownUntil = 0;
  const pending = new Map<string, Promise<YouTubeTranscriptResult>>();

  async function request(cmd: string[], videoId: string, stage: string): Promise<string> {
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (now() < cooldownUntil) {
        const retryAt = new Date(cooldownUntil).toISOString();
        log.warn(`[cooldown] videoId=${videoId} stage=${stage} retryAt=${retryAt}`);
        throw new YouTubeTranscriptError(
          `YouTube requests paused until ${retryAt} after a rate limit`,
          'rate-limited',
          true,
          0,
          retryAt
        );
      }
      if (now() < nextRequestAt) await sleep(nextRequestAt - now());
      log.info(`[attempt] videoId=${videoId} stage=${stage} attempt=${attempt}/3`);
      const t0 = now();
      let result: YtDlpProcessResult;
      try {
        result = await run(cmd);
      } catch (err) {
        result = {
          stdout: '',
          stderr: err instanceof Error ? err.message : String(err),
          exitCode: null,
        };
      }
      nextRequestAt = now() + 3_000;
      if (result.exitCode === 0 && !result.timedOut) {
        if (result.stderr.trim()) {
          log.warn(
            `[extractor-warning] videoId=${videoId} stage=${stage} ${result.stderr.trim().split('\n').at(-1)?.slice(0, 400)}`
          );
        }
        log.info(
          `[success] videoId=${videoId} stage=${stage} attempt=${attempt} durationMs=${now() - t0}`
        );
        return result.stdout;
      }
      const error = processFailure(result, attempt);
      if (error.code === 'rate-limited') {
        cooldownUntil = now() + 15 * 60 * 1000;
        const retryAt = new Date(cooldownUntil).toISOString();
        log.warn(
          `[rate-limit] videoId=${videoId} stage=${stage} attempt=${attempt} retryAt=${retryAt}`
        );
        throw new YouTubeTranscriptError(error.message, error.code, true, attempt, retryAt);
      }
      if (!error.retryable || attempt === 3) {
        log.error(
          `[failed] videoId=${videoId} stage=${stage} attempts=${attempt} code=${error.code} reason=${error.message}`
        );
        throw error;
      }
      const delay = Math.round(5_000 * 2 ** (attempt - 1) * (0.8 + random() * 0.4));
      log.warn(
        `[retry] videoId=${videoId} stage=${stage} attempt=${attempt}/3 code=${error.code} delayMs=${delay} reason=${error.message}`
      );
      await sleep(delay);
    }
    throw new Error('Unreachable retry state');
  }

  async function fetchOne(videoId: string): Promise<YouTubeTranscriptResult> {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const tempDir = await mkdtemp(path.join(tmpdir(), 'dv-yt-'));
    const common = [
      'yt-dlp',
      '--ignore-config',
      '--no-playlist',
      '--js-runtimes',
      'deno',
      '--socket-timeout',
      '15',
      '--retries',
      '0',
      '--extractor-retries',
      '0',
    ];
    try {
      const raw = await request(
        [...common, '--skip-download', '--dump-single-json', url],
        videoId,
        'metadata'
      );
      let meta: YtDlpMetadata;
      try {
        meta = JSON.parse(raw) as YtDlpMetadata;
      } catch {
        throw new YouTubeTranscriptError(
          'yt-dlp metadata JSON parse failed',
          'extractor',
          false,
          1
        );
      }
      if (meta.id !== videoId) {
        throw new YouTubeTranscriptError(
          'yt-dlp returned metadata for a different video',
          'extractor',
          false,
          1
        );
      }
      const caption = selectEnglishCaption(meta);
      if (!caption) {
        throw new YouTubeTranscriptError(
          'Video has no English captions available',
          'no-captions',
          false,
          1
        );
      }
      const infoPath = path.join(tempDir, 'video.info.json');
      await writeFile(infoPath, raw, { mode: 0o600 });
      await request(
        [
          ...common,
          '--load-info-json',
          infoPath,
          '--no-simulate',
          '--skip-download',
          caption.automatic ? '--write-auto-subs' : '--write-subs',
          '--sub-langs',
          `^${caption.language}$`,
          '--sub-format',
          'vtt',
          '-o',
          path.join(tempDir, '%(id)s.%(ext)s'),
        ],
        videoId,
        'captions'
      );
      const chosen = await pickPreferredVtt(tempDir, videoId);
      if (!chosen) {
        throw new YouTubeTranscriptError(
          'Caption download completed without a caption file',
          'extractor',
          true,
          1
        );
      }
      const { text, segmentCount } = cleanVtt(await readFile(path.join(tempDir, chosen), 'utf-8'));
      if (!segmentCount) {
        throw new YouTubeTranscriptError(
          'Caption file has no readable text',
          'extractor',
          false,
          1
        );
      }
      return {
        videoId,
        url: meta.webpage_url ?? url,
        title: meta.title ?? `Untitled (${videoId})`,
        channel: meta.channel ?? meta.uploader ?? 'Unknown',
        uploadDate: parseUploadDate(meta.upload_date),
        durationSec: typeof meta.duration === 'number' ? Math.floor(meta.duration) : null,
        text,
        segmentCount,
        captionSource: caption.automatic ? 'automatic' : 'manual',
      };
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  return (url) => {
    const videoId = extractVideoId(url);
    if (!videoId)
      return Promise.reject(
        new YouTubeTranscriptError('Not a recognized YouTube URL', 'unavailable', false, 0)
      );
    const existing = pending.get(videoId);
    if (existing) return existing;
    const work = queue.then(() => fetchOne(videoId));
    queue = work.then(
      () => undefined,
      () => undefined
    );
    const result = work.finally(() => pending.delete(videoId));
    pending.set(videoId, result);
    return result;
  };
}

export const fetchYouTubeTranscript = createYouTubeTranscriptFetcher();
