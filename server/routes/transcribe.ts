// Voice transcription proxy.
//
// Browsers POST recorded audio (multipart) to /api/transcribe; this route
// forwards it to a configurable HTTP service that exposes an
// OpenAI-compatible /audio/transcriptions endpoint. Any of these work:
//
//   - whisper.cpp (`./server` binary, `--port 8000`)
//   - faster-whisper-server (https://github.com/fedirz/faster-whisper-server)
//   - parakeet-mlx server (Apple Silicon, English-only, very fast)
//   - lightning-whisper-mlx HTTP wrapper
//   - any OpenAI-compatible local server (vllm, llama-server with whisper, …)
//
// Configure transcribeUrl + transcribeModel + (optional) transcribeApiKey in
// settings, or via DOCVAULT_TRANSCRIBE_URL / DOCVAULT_TRANSCRIBE_MODEL /
// DOCVAULT_TRANSCRIBE_API_KEY env vars. When an API key is configured it is
// forwarded as `Authorization: Bearer <key>` — matches Parakeet's
// PARAKEET_API_KEY contract and OpenAI Whisper's Bearer auth. The route
// keeps the audio in memory rather than writing to disk — privacy-sensitive
// content shouldn't leave bytes on the NAS unnecessarily.
//
// Routes:
//   GET  /api/transcribe  → { configured, hasUrl, urlHint, model, hasApiKey }
//   POST /api/transcribe  → forwards multipart "file" to the service,
//                           returns { text }

import { jsonResponse, getTranscribeConfig } from '../data.js';
import { createLogger } from '../logger.js';

const log = createLogger('Transcribe');

export async function handleTranscribeRoutes(
  req: Request,
  _url: URL,
  pathname: string
): Promise<Response | null> {
  if (pathname !== '/api/transcribe') return null;

  if (req.method === 'GET') {
    const cfg = await getTranscribeConfig();
    return jsonResponse({
      configured: !!cfg.url,
      hasUrl: !!cfg.url,
      urlHint: cfg.url ? safeHostHint(cfg.url) : null,
      model: cfg.model ?? null,
      hasApiKey: !!cfg.apiKey,
    });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const cfg = await getTranscribeConfig();
  if (!cfg.url) {
    return jsonResponse(
      {
        error:
          'Transcription service not configured. Set transcribeUrl in Settings (or DOCVAULT_TRANSCRIBE_URL env var).',
      },
      400
    );
  }

  let inboundForm: FormData;
  try {
    inboundForm = (await req.formData()) as FormData;
  } catch {
    return jsonResponse({ error: 'Expected multipart/form-data' }, 400);
  }

  const audio = inboundForm.get('file');
  if (!(audio instanceof File) || audio.size === 0) {
    return jsonResponse({ error: 'Missing "file" upload' }, 400);
  }

  // Honour an optional language hint from the client (English-only models
  // like Parakeet ignore it but it's harmless).
  const languageRaw = inboundForm.get('language');
  const language =
    typeof languageRaw === 'string' && languageRaw.length > 0 ? languageRaw : undefined;

  // Forward to the OpenAI-compatible service via the shared helper (also used
  // by the background video/audio research transcription path). The helper
  // throws on any upstream problem; map that onto a 502 for this proxy.
  try {
    const { text } = await transcribeAudioBlob(audio, audio.name || 'audio.webm', { language });
    return jsonResponse({ text });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`Transcription failed: ${msg}`);
    return jsonResponse({ error: msg }, 502);
  }
}

/**
 * Forward an audio Blob to the configured OpenAI-compatible transcription
 * service (parakeet-mlx, whisper.cpp, faster-whisper-server, …) and return the
 * transcript text. Shared by the `/api/transcribe` proxy above and the
 * background video/audio research job (server/parsers/media-transcribe.ts), so
 * there's exactly one place that knows the upstream contract.
 *
 * Throws on any failure — not configured, unreachable upstream, or a non-2xx
 * response — with a message safe to surface. Callers decide how to map that
 * onto an HTTP status (proxy → 502) or an entry error (background job).
 *
 * `opts.timeoutMs` aborts the upstream fetch so a hung transcription box can't
 * wedge a caller indefinitely (the background job holds a single-flight slot).
 */
export async function transcribeAudioBlob(
  file: Blob,
  filename: string,
  opts?: { language?: string; timeoutMs?: number }
): Promise<{ text: string }> {
  const cfg = await getTranscribeConfig();
  if (!cfg.url) {
    throw new Error(
      'Transcription service not configured. Set transcribeUrl in Settings (or DOCVAULT_TRANSCRIBE_URL env var).'
    );
  }

  // Most servers require the exact field names "file" and "model"; we add
  // "response_format=json" so we can cleanly read .text out of the response.
  const outbound = new FormData();
  outbound.append('file', file, filename);
  if (cfg.model) outbound.append('model', cfg.model);
  outbound.append('response_format', 'json');
  if (opts?.language) outbound.append('language', opts.language);

  const target = normalizeTranscribeUrl(cfg.url);
  // Only set Authorization when an API key is configured so we don't break
  // unauthenticated upstream servers that reject any auth header.
  const headers: Record<string, string> = {};
  if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: 'POST',
      body: outbound,
      headers,
      signal: opts?.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to reach transcription service at ${safeHostHint(cfg.url)}: ${msg}`);
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    throw new Error(
      `Transcription service returned ${upstream.status}` +
        (detail ? `: ${detail.slice(0, 500)}` : '')
    );
  }

  // Most OpenAI-compatible servers return { text: "..." }. whisper.cpp's
  // newer server also returns that shape with response_format=json.
  const ct = upstream.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    const data = (await upstream.json()) as { text?: string };
    return { text: data.text ?? '' };
  }
  // Fallback for plain-text servers.
  return { text: await upstream.text() };
}

// Append /v1/audio/transcriptions if the user gave us only a host root —
// most users will paste "http://nas:8000" and expect it to work.
export function normalizeTranscribeUrl(url: string): string {
  if (/\/audio\/transcriptions\/?$/.test(url)) return url;
  if (/\/v1\/?$/.test(url)) return url.replace(/\/?$/, '/audio/transcriptions');
  return url.replace(/\/?$/, '/v1/audio/transcriptions');
}

export function safeHostHint(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return '<invalid-url>';
  }
}
