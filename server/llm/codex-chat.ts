// Codex chat backend — drives `codex app-server` (via CodexAppServerClient) for
// one chat turn and translates its streamed notifications into DocVault's chat
// SSE events (the same {type:'text'|'tool_call'|'done'|…} shapes the Claude path
// emits). Codex uses its NATIVE file/grep tools against a read-only,
// secrets-excluded view of DATA_DIR — no MCP server, matching how t3code drives
// agents (its session calls pass mcpServers: []).

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  CodexAppServerClient,
  type CodexNotification,
  type CodexServerRequest,
  type CodexTurnInput,
} from './codex-app-server.js';
import { DATA_DIR } from '../data.js';
import { createLogger } from '../logger.js';

const log = createLogger('CodexChat');

// Files in DATA_DIR that codex must NOT see (secrets — exchange + provider API
// keys). Everything else (documents, parsed data, metadata, external sources)
// is fair game for the agent to read.
const SECRET_FILES = new Set(['.docvault-settings.json']);

// Codex item types that are NOT tool activity — don't surface them as tool
// calls. `userMessage` is the echo of the user's own message; the assistant
// text + reasoning have their own delta events.
const NON_TOOL_ITEMS = new Set(['agentMessage', 'reasoning', 'userMessage']);

/**
 * Build a read-only view of DATA_DIR that omits secret files, by symlinking
 * each non-secret top-level entry into a temp dir. Rebuilt per turn so newly
 * added entities/documents show up. Codex's cwd points here.
 */
async function buildDataView(): Promise<string> {
  const viewDir = path.join(os.tmpdir(), 'docvault-codex-view');
  await fs.rm(viewDir, { recursive: true, force: true });
  await fs.mkdir(viewDir, { recursive: true });
  for (const entry of await fs.readdir(DATA_DIR)) {
    if (SECRET_FILES.has(entry)) continue;
    await fs.symlink(path.join(DATA_DIR, entry), path.join(viewDir, entry));
  }
  return viewDir;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function obj(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}

export interface CodexChatOptions {
  userText: string;
  /** Codex model slug; omit to let codex pick its account/plan default. */
  model?: string;
  /** DocVault domain instructions, passed as codex developerInstructions. */
  systemPrompt: string;
  /** CODEX_HOME — dir with auth.json (from `codex login`). Default: codex's own. */
  codexHome?: string;
  /** Codex binary path; default 'codex' (PATH). */
  binaryPath?: string;
  /** Resume a prior codex thread to keep conversation continuity. */
  resumeThreadId?: string;
  /** Image attachments for this turn (data: URLs or file URLs). */
  images?: { url: string }[];
  signal?: AbortSignal;
  /** Emit an SSE event — same shapes as the Claude path's `send`. */
  send: (event: object) => void;
}

/** Run one chat turn through codex, streaming events via `opts.send`. */
export async function runCodexChat(opts: CodexChatOptions): Promise<void> {
  const { send } = opts;
  const cwd = await buildDataView();

  let done = false;
  let resolveDone!: () => void;
  const donePromise = new Promise<void>((r) => {
    resolveDone = r;
  });
  const finish = (extra: Record<string, unknown> = {}): void => {
    if (done) return;
    done = true;
    send({ type: 'done', stopReason: 'end_turn', isError: false, ...extra });
    resolveDone();
  };

  const client = new CodexAppServerClient({
    binaryPath: opts.binaryPath,
    cwd,
    codexHome: opts.codexHome,
    onNotification: (n) => translateNotification(n, send, finish),
    onServerRequest: (r) => handleServerRequest(r, opts.codexHome),
    onExit: (code) => {
      if (!done && code !== 0 && code !== null) {
        send({ type: 'error', message: `codex app-server exited (code ${code})` });
      }
      finish(code && code !== 0 ? { isError: true } : {});
    },
  });

  // Client abort (Stop button / disconnect) → kill the codex subprocess.
  opts.signal?.addEventListener('abort', () => client.kill());

  try {
    await client.initialize({ name: 'docvault', title: 'DocVault', version: '1.0.0' });

    const threadParams = {
      cwd,
      ...(opts.model ? { model: opts.model } : {}),
      modelProvider: 'openai',
      approvalPolicy: 'never' as const,
      sandbox: 'read-only' as const,
      developerInstructions: opts.systemPrompt,
    };
    const threadId = opts.resumeThreadId
      ? await client.resumeThread({ threadId: opts.resumeThreadId, ...threadParams })
      : await client.startThread(threadParams);

    send({ type: 'session', sessionId: threadId });

    const input: CodexTurnInput[] = [
      { type: 'text', text: opts.userText },
      ...(opts.images ?? []).map((img) => ({ type: 'image' as const, url: img.url })),
    ];
    await client.startTurn({ threadId, input });
    // Streaming + completion arrive via notifications; finish() resolves this.
    await donePromise;
  } catch (err) {
    log.warn(`codex chat failed: ${err instanceof Error ? err.message : String(err)}`);
    send({ type: 'error', message: err instanceof Error ? err.message : 'codex error' });
    finish({ isError: true });
  } finally {
    client.kill();
  }
}

/** Map a codex app-server notification onto DocVault chat SSE events. */
function translateNotification(
  n: CodexNotification,
  send: (event: object) => void,
  finish: (extra?: Record<string, unknown>) => void
): void {
  const p = obj(n.params);
  switch (n.method) {
    case 'item/agentMessage/delta': {
      const delta = str(p.delta);
      if (delta) send({ type: 'text', text: delta });
      break;
    }
    case 'item/started': {
      // Native tool activity (file read, command exec, grep) → surface to the UI
      // like Claude's tool calls. Skip the assistant-message / reasoning items.
      const item = obj(p.item);
      const type = str(item.type);
      if (type && !NON_TOOL_ITEMS.has(type)) {
        send({ type: 'tool_call', id: str(item.id) ?? '', toolName: type, input: item });
      }
      break;
    }
    case 'item/completed': {
      const item = obj(p.item);
      const type = str(item.type);
      if (type && !NON_TOOL_ITEMS.has(type)) {
        send({ type: 'tool_result', toolUseId: str(item.id) ?? '', result: item, isError: false });
      }
      break;
    }
    case 'turn/completed':
      finish();
      break;
    case 'error':
      send({ type: 'error', message: str(p.message) ?? 'codex error' });
      finish({ isError: true });
      break;
    default:
      // thread/started, item/reasoning/*, thread/tokenUsage/updated, … — ignored
      // for now (no UI surface). Token usage could feed `done` later.
      break;
  }
}

/**
 * Answer codex's server-requests. We run read-only with approvalPolicy 'never',
 * so approvals shouldn't fire — deny any that do, defensively. For the ChatGPT
 * auth-token refresh, we relay the current tokens from auth.json: codex
 * refreshes its own auth.json via the stored refresh_token (t3code implements
 * no OAuth flow of its own), and the client just hands the tokens back.
 */
async function handleServerRequest(r: CodexServerRequest, codexHome?: string): Promise<unknown> {
  if (r.method.endsWith('requestApproval') || r.method === 'applyPatchApproval') {
    return { decision: 'deny' };
  }
  if (r.method === 'account/chatgptAuthTokens/refresh') {
    try {
      const home = codexHome || path.join(os.homedir(), '.codex');
      const raw = await fs.readFile(path.join(home, 'auth.json'), 'utf-8');
      const auth = JSON.parse(raw) as { tokens?: { access_token?: string; account_id?: string } };
      const tok = auth.tokens;
      if (tok?.access_token) {
        return {
          accessToken: tok.access_token,
          chatgptAccountId: tok.account_id ?? null,
          chatgptPlanType: null,
        };
      }
    } catch (err) {
      log.warn(
        `codex auth-token relay failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    return null;
  }
  return null;
}
