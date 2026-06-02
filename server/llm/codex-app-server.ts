// Codex app-server transport — a plain-TypeScript port of t3code's
// `effect-codex-app-server` (github.com/pingdotgg/t3code), with the Effect
// machinery replaced by Promises/EventEmitter. Same wire behavior, no Effect.
//
// Wire protocol ("patched" JSON-RPC over newline-delimited JSON on the codex
// CLI's `app-server` stdio). It deliberately OMITS the `jsonrpc` field that
// standard JSON-RPC requires — codex neither sends nor expects it.
//
//   request      (us → codex):  {id, method, params?}   id = incrementing int ≥ 1
//   notification (us → codex):  {method, params?}        (no id)
//   response     (us → codex):  {id, result} | {id, error}   (answers codex's requests)
//
// Inbound classification (mirrors protocol.ts isIncoming* helpers):
//   • method + id        → server request  (codex asks us something; we must respond)
//   • method, no id      → notification    (streaming events)
//   • no method, has id  → response        (correlate to a pending request via id)
//
// Reference: t3code packages/effect-codex-app-server/src/protocol.ts (wire
// framing + pending-map correlation) and client.ts (typed method wrappers).

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createLogger } from '../logger.js';

const log = createLogger('Codex');

export interface CodexJsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface CodexNotification {
  method: string;
  params?: unknown;
}

export interface CodexServerRequest {
  id: string | number;
  method: string;
  params?: unknown;
}

export interface CodexClientOptions {
  /** Codex binary, default 'codex' (resolved on PATH). */
  binaryPath?: string;
  /** Working directory for the agent. */
  cwd?: string;
  /** Extra env on top of process.env. */
  env?: Record<string, string>;
  /** CODEX_HOME — dir holding auth.json (from `codex login`) and config.toml. */
  codexHome?: string;
  /** Extra args after `app-server` (e.g. `-c tools.web_search=true` for research). */
  extraArgs?: string[];
  /** Streaming events (item/agentMessage/delta, turn/completed, …). */
  onNotification?: (n: CodexNotification) => void;
  /** Codex asks us something (approvals, auth refresh, …); resolve to the result. */
  onServerRequest?: (r: CodexServerRequest) => Promise<unknown> | unknown;
  /** Process exit. */
  onExit?: (code: number | null) => void;
  /** Log every wire message (verbose). */
  logWire?: boolean;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

/**
 * A live connection to a `codex app-server` subprocess. Construct it, await
 * `initialize()`, then drive conversations with `startThread`/`startTurn`.
 */
export class CodexAppServerClient {
  private readonly proc: ChildProcessWithoutNullStreams;
  private readonly opts: CodexClientOptions;
  private nextId = 1;
  private readonly pending = new Map<string, Pending>();
  private buffer = '';
  private closed = false;

  constructor(opts: CodexClientOptions = {}) {
    this.opts = opts;
    const bin = opts.binaryPath ?? 'codex';
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...(opts.env ?? {}),
      ...(opts.codexHome ? { CODEX_HOME: opts.codexHome } : {}),
    };
    this.proc = spawn(bin, ['app-server', ...(opts.extraArgs ?? [])], { cwd: opts.cwd, env });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk: string) => this.onStdout(chunk));
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', (d: string) => {
      if (opts.logWire) log.debug(`codex stderr: ${d.trimEnd()}`);
    });
    this.proc.on('exit', (code) => this.onExit(code));
    this.proc.on('error', (err) => this.failAll(err));
  }

  // ── transport ────────────────────────────────────────────────────────────

  private onStdout(chunk: string): void {
    // Buffer chunks, split on \n, strip trailing \r, parse each non-empty line.
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    for (const raw of lines) {
      const line = raw.replace(/\r$/, '');
      if (line.trim().length === 0) continue;
      let msg: unknown;
      try {
        msg = JSON.parse(line);
      } catch {
        log.warn(`codex: undecodable wire line: ${line.slice(0, 200)}`);
        continue;
      }
      if (this.opts.logWire) log.debug(`← codex: ${line.slice(0, 300)}`);
      this.route(msg);
    }
  }

  private route(msg: unknown): void {
    if (typeof msg !== 'object' || msg === null) return;
    const m = msg as Record<string, unknown>;
    const hasMethod = typeof m.method === 'string';
    const hasId = 'id' in m && (typeof m.id === 'string' || typeof m.id === 'number');
    if (hasMethod && hasId) {
      void this.handleServerRequest({
        id: m.id as string | number,
        method: m.method as string,
        params: m.params,
      });
    } else if (hasMethod) {
      this.opts.onNotification?.({ method: m.method as string, params: m.params });
    } else if (hasId) {
      this.handleResponse(m);
    }
  }

  private handleResponse(m: Record<string, unknown>): void {
    const key = String(m.id);
    const p = this.pending.get(key);
    if (!p) return;
    this.pending.delete(key);
    if (m.error !== undefined) p.reject(m.error);
    else p.resolve(m.result);
  }

  private async handleServerRequest(req: CodexServerRequest): Promise<void> {
    if (!this.opts.onServerRequest) {
      // Respond rather than let codex hang waiting on us.
      this.write({ id: req.id, error: { code: -32601, message: 'no handler for ' + req.method } });
      return;
    }
    try {
      const result = await this.opts.onServerRequest(req);
      this.write({ id: req.id, result: result ?? null });
    } catch (err) {
      this.write({
        id: req.id,
        error: { code: -32603, message: err instanceof Error ? err.message : 'handler error' },
      });
    }
  }

  private write(obj: Record<string, unknown>): void {
    if (this.closed) return;
    if (this.opts.logWire) log.debug(`→ codex: ${JSON.stringify(obj).slice(0, 300)}`);
    this.proc.stdin.write(JSON.stringify(obj) + '\n');
  }

  /** Send a request and await its correlated response. */
  request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(String(id), { resolve, reject });
      this.write({ id, method, ...(params !== undefined ? { params } : {}) });
    });
  }

  /** Send a fire-and-forget notification. */
  notify(method: string, params?: unknown): void {
    this.write({ method, ...(params !== undefined ? { params } : {}) });
  }

  private onExit(code: number | null): void {
    this.closed = true;
    this.failAll(new Error(`codex app-server exited (code ${code})`));
    this.opts.onExit?.(code);
  }

  private failAll(err: unknown): void {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  kill(): void {
    this.closed = true;
    try {
      this.proc.kill();
    } catch {
      /* already gone */
    }
  }

  // ── typed protocol methods (subset we need for chat) ─────────────────────

  /** Handshake: `initialize` request, then the `initialized` notification. */
  async initialize(clientInfo: {
    name: string;
    title?: string;
    version: string;
  }): Promise<unknown> {
    const res = await this.request('initialize', {
      clientInfo,
      capabilities: { experimentalApi: true },
    });
    this.notify('initialized');
    return res;
  }

  /** Start a new conversation. Returns the codex-internal threadId. */
  async startThread(params: CodexThreadStartParams): Promise<string> {
    const res = (await this.request('thread/start', params)) as { thread?: { id?: string } };
    const id = res?.thread?.id;
    if (!id) throw new Error('codex thread/start returned no thread id');
    return id;
  }

  /** Resume a prior conversation by threadId. */
  async resumeThread(params: CodexThreadResumeParams): Promise<string> {
    const res = (await this.request('thread/resume', params)) as { thread?: { id?: string } };
    return res?.thread?.id ?? params.threadId;
  }

  /** Begin a turn (send a user message). Streamed output arrives via onNotification. */
  async startTurn(params: CodexTurnStartParams): Promise<{ id: string }> {
    const res = (await this.request('turn/start', params)) as { turn?: { id?: string } };
    return { id: res?.turn?.id ?? '' };
  }
}

// ── param shapes (from t3code _generated/schema.gen.ts) ─────────────────────

export type CodexApprovalPolicy = 'untrusted' | 'on-request' | 'never';
export type CodexSandbox = 'read-only' | 'workspace-write' | 'danger-full-access';

export interface CodexThreadStartParams {
  cwd: string;
  approvalPolicy?: CodexApprovalPolicy;
  sandbox?: CodexSandbox;
  model?: string | null;
  modelProvider?: string | null;
  baseInstructions?: string | null;
  developerInstructions?: string | null;
}

export interface CodexThreadResumeParams extends Partial<CodexThreadStartParams> {
  threadId: string;
}

export type CodexTurnInput = { type: 'text'; text: string } | { type: 'image'; url: string };

export interface CodexTurnStartParams {
  threadId: string;
  input: CodexTurnInput[];
  model?: string | null;
  effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | null;
}
