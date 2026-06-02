// Codex sign-in — drive `codex login --device-auth` from the UI. Device-auth is
// codex's headless login: it prints a verification URL + code, the user
// authorizes in any browser, and codex writes auth.json to CODEX_HOME. There's
// no localhost callback, so this works from the NAS container. We stream codex's
// output to the browser over SSE and signal completion when the process exits.
//
//   GET /api/codex/login  → SSE: {type:'line',text} … {type:'done',ok,code}

import { spawn } from 'node:child_process';
import { getCodexChatConfig, jsonResponse } from '../data.js';
import { createLogger } from '../logger.js';

const log = createLogger('CodexAuth');

// Only one interactive login at a time — codex writes a single auth.json.
let inFlight = false;

export async function handleCodexAuthRoutes(
  req: Request,
  _url: URL,
  pathname: string
): Promise<Response | null> {
  if (pathname !== '/api/codex/login') return null;
  if (req.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405);
  if (inFlight) return jsonResponse({ error: 'A codex login is already in progress' }, 409);

  const cfg = await getCodexChatConfig();
  const bin = cfg.binaryPath || 'codex';
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...(cfg.codexHome ? { CODEX_HOME: cfg.codexHome } : {}),
  };

  inFlight = true;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: object) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          /* stream already closed */
        }
      };

      const proc = spawn(bin, ['login', '--device-auth'], { env });
      // codex prints the verification URL + code to stdout or stderr depending
      // on version — forward both as lines.
      const onData = (d: Buffer | string) => {
        for (const raw of d.toString().split('\n')) {
          const text = raw.replace(/\r$/, '').trimEnd();
          if (text.trim()) send({ type: 'line', text });
        }
      };
      proc.stdout.on('data', onData);
      proc.stderr.on('data', onData);

      const finish = (ok: boolean, code: number | null) => {
        if (!inFlight) return;
        inFlight = false;
        send({ type: 'done', ok, code });
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      proc.on('exit', (code) => {
        log.info(`codex login exited (code ${code})`);
        finish(code === 0, code);
      });
      proc.on('error', (err) => {
        log.warn(`codex login failed to start: ${err.message}`);
        send({ type: 'error', message: err.message });
        finish(false, null);
      });

      // Client closed the page / cancelled → kill the pending login.
      req.signal.addEventListener('abort', () => {
        try {
          proc.kill();
        } catch {
          /* already gone */
        }
      });
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
