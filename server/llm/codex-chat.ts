// Codex chat backend — drives `codex app-server` (via CodexAppServerClient) for
// one chat turn and translates its streamed notifications into DocVault's chat
// SSE events (the same {type:'text'|'tool_call'|'done'|…} shapes the Claude path
// emits). Codex uses its NATIVE file/grep tools against a read-only,
// secrets-excluded view of DATA_DIR. A private MCP bridge exposes browser,
// calculation, and research actions; those execute in the main DocVault process.

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'node:url';
import { openChatToolBridge } from './chat-tool-bridge.js';
import type { ExecutableChatTool } from '../chat-tool-definitions.js';
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
const SECRET_FILES = new Set(['.docvault-settings.json', '.codex', '.rclone.conf']);

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
  const viewDir = await fs.mkdtemp(path.join(os.tmpdir(), 'docvault-codex-view-'));
  try {
    for (const entry of await fs.readdir(DATA_DIR)) {
      if (SECRET_FILES.has(entry)) continue;
      await fs.symlink(path.join(DATA_DIR, entry), path.join(viewDir, entry));
    }
  } catch (error) {
    await fs.rm(viewDir, { recursive: true, force: true });
    throw error;
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
  /** Reasoning effort for this turn; omit for the account/plan default. */
  effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
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
  /** Shared app tools; execution remains in the main process via a private socket. */
  tools?: ExecutableChatTool[];
  /** Emit an SSE event — same shapes as the Claude path's `send`. */
  send: (event: object) => void;
}

/** Run one chat turn through codex, streaming events via `opts.send`. */
export async function runCodexChat(opts: CodexChatOptions): Promise<void> {
  const { send } = opts;
  // Codex authenticates via CODEX_HOME/auth.json (from `codex login`) — i.e. the
  // ChatGPT SUBSCRIPTION, never an OpenAI API key. Log it every run so billing
  // path is auditable alongside the Claude [ai-billing] lines.
  log.info(
    `[ai-billing] codex-chat → ChatGPT SUBSCRIPTION (CODEX_HOME auth.json) · model=${opts.model ?? 'default'}`
  );
  const cwd = await buildDataView();
  let bridge: Awaited<ReturnType<typeof openChatToolBridge>> | undefined;
  try {
    if (opts.tools?.length) bridge = await openChatToolBridge(opts.tools, opts.signal);
  } catch (error) {
    await fs.rm(cwd, { recursive: true, force: true });
    throw error;
  }

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
    // Override cached/disabled defaults for this subprocess, including resumes.
    extraArgs: [
      '-c',
      'web_search="live"',
      ...(bridge
        ? [
            '-c',
            `mcp_servers.docvault_research.command=${JSON.stringify(process.execPath)}`,
            '-c',
            `mcp_servers.docvault_research.args=${JSON.stringify(['run', fileURLToPath(new URL('./codex-research-mcp.ts', import.meta.url))])}`,
            '-c',
            `mcp_servers.docvault_research.env.DOCVAULT_TOOL_SOCKET=${JSON.stringify(bridge.socketPath)}`,
          ]
        : []),
    ],
    onNotification: (n) => translateNotification(n, send, finish),
    onServerRequest: (r) => handleCodexServerRequest(r, opts.codexHome),
    onExit: (code) => {
      if (!done && code !== 0 && code !== null) {
        send({ type: 'error', message: `codex app-server exited (code ${code})` });
      }
      finish(code && code !== 0 ? { isError: true } : {});
    },
  });

  // Client abort (Stop button / disconnect) → kill the codex subprocess.
  const abort = () => {
    client.kill();
    finish({ isError: true, stopReason: 'interrupted' });
  };
  opts.signal?.addEventListener('abort', abort, { once: true });

  try {
    opts.signal?.throwIfAborted();
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
    await client.startTurn({ threadId, input, ...(opts.effort ? { effort: opts.effort } : {}) });
    // Streaming + completion arrive via notifications; finish() resolves this.
    await donePromise;
  } catch (err) {
    log.warn(`codex chat failed: ${err instanceof Error ? err.message : String(err)}`);
    send({ type: 'error', message: err instanceof Error ? err.message : 'codex error' });
    finish({ isError: true });
  } finally {
    opts.signal?.removeEventListener('abort', abort);
    client.kill();
    await bridge?.close();
    await fs.rm(cwd, { recursive: true, force: true });
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
        send({
          type: 'tool_call',
          id: str(item.id) ?? '',
          toolName: type === 'mcpToolCall' ? (str(item.tool) ?? type) : type,
          input: type === 'mcpToolCall' ? item.arguments : item,
        });
      }
      break;
    }
    case 'item/completed': {
      const item = obj(p.item);
      const type = str(item.type);
      if (type && !NON_TOOL_ITEMS.has(type)) {
        let result: unknown = item;
        const mcpResult = obj(item.result);
        if (type === 'mcpToolCall' && Array.isArray(mcpResult.content)) {
          const text = mcpResult.content.map((c) => str(obj(c).text) ?? '').join('\n');
          try {
            result = JSON.parse(text);
          } catch {
            result = text || item;
          }
        }
        send({
          type: 'tool_result',
          toolUseId: str(item.id) ?? '',
          result,
          isError: item.status === 'failed' || !!mcpResult.isError || !!item.error,
        });
      }
      break;
    }
    case 'turn/completed':
      finish({
        isError: ['failed', 'interrupted'].includes(str(obj(p.turn).status) ?? ''),
        ...(str(obj(p.turn).status) === 'interrupted' ? { stopReason: 'interrupted' } : {}),
      });
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
export async function handleCodexServerRequest(
  r: CodexServerRequest,
  codexHome?: string
): Promise<unknown> {
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
