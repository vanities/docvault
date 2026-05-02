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
// Configure transcribeUrl + transcribeModel in settings, or via the
// DOCVAULT_TRANSCRIBE_URL / DOCVAULT_TRANSCRIBE_MODEL env vars. The route
// keeps the audio in memory rather than writing to disk — privacy-sensitive
// content shouldn't leave bytes on the NAS unnecessarily.
//
// Routes:
//   GET  /api/transcribe  → { configured, hasUrl, urlHint, model }
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
    inboundForm = await req.formData();
  } catch {
    return jsonResponse({ error: 'Expected multipart/form-data' }, 400);
  }

  const audio = inboundForm.get('file');
  if (!(audio instanceof File) || audio.size === 0) {
    return jsonResponse({ error: 'Missing "file" upload' }, 400);
  }

  // Forward to the OpenAI-compatible service. Most servers require the
  // exact field names "file" and "model"; we add "response_format=json"
  // so we can cleanly read .text out of the JSON response.
  const outbound = new FormData();
  outbound.append('file', audio, audio.name || 'audio.webm');
  if (cfg.model) outbound.append('model', cfg.model);
  outbound.append('response_format', 'json');

  // Honour an optional language hint from the client (English-only models
  // like Parakeet ignore it but it's harmless).
  const language = inboundForm.get('language');
  if (typeof language === 'string' && language.length > 0) {
    outbound.append('language', language);
  }

  const target = normalizeTranscribeUrl(cfg.url);
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: 'POST',
      body: outbound,
      // No "Authorization" header — these are typically self-hosted on the
      // user's NAS. Add bearer support later if a remote service needs it.
    });
  } catch (err) {
    log.error(`Upstream fetch failed: ${err}`);
    return jsonResponse(
      {
        error: `Failed to reach transcription service at ${safeHostHint(cfg.url)}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      502
    );
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    log.warn(`Upstream ${upstream.status}: ${detail.slice(0, 200)}`);
    return jsonResponse(
      {
        error: `Transcription service returned ${upstream.status}`,
        detail: detail.slice(0, 500),
      },
      502
    );
  }

  // Most OpenAI-compatible servers return { text: "..." }. whisper.cpp's
  // newer server also returns that shape with response_format=json.
  const ct = upstream.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    const data = (await upstream.json()) as { text?: string };
    return jsonResponse({ text: data.text ?? '' });
  }
  // Fallback for plain-text servers.
  const text = await upstream.text();
  return jsonResponse({ text });
}

// Append /v1/audio/transcriptions if the user gave us only a host root —
// most users will paste "http://nas:8000" and expect it to work.
function normalizeTranscribeUrl(url: string): string {
  if (/\/audio\/transcriptions\/?$/.test(url)) return url;
  if (/\/v1\/?$/.test(url)) return url.replace(/\/?$/, '/audio/transcriptions');
  return url.replace(/\/?$/, '/v1/audio/transcriptions');
}

function safeHostHint(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return '<invalid-url>';
  }
}
