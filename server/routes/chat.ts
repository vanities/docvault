// Mobile chat route — agentic conversation against the user's vault.
//
// POST /api/chat
//   body: { messages: ChatMessage[], entity?: string }
//   returns: text/event-stream — newline-delimited `data: {json}\n\n` events
//
// Powered by `@anthropic-ai/claude-agent-sdk` — the same SDK Claude Code
// itself uses, which spawns a bundled Claude Code binary internally and
// gives us its rate-limit treatment when authenticated via the
// `CLAUDE_CODE_OAUTH_TOKEN` env var. DocVault's tools (list_files, …) are
// exposed via an in-process MCP server so the agent loop can call them
// without Bash/Read/Edit access to the NAS filesystem.
//
// Frontend keeps the conversation history client-side and replays it every
// turn (server is stateless). We pass the LAST user message as the SDK's
// `prompt` and fold prior turns into the system prompt — preserves multi-
// turn context without owning session state on the server.
//
// Event types streamed back:
//   { type: 'text', text }              — assistant text turn
//   { type: 'tool_call', id, toolName, input }
//   { type: 'tool_result', toolUseId, result, isError }
//   { type: 'done', stopReason, isError? }
//   { type: 'error', message }          — fatal stream error

import path from 'path';
import { createRequire } from 'module';
import { createSdkMcpServer, query, tool, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import {
  jsonResponse,
  loadConfig,
  loadParsedData,
  loadMetadata,
  saveMetadata,
  loadReminders,
  saveReminders,
  scanDirectory,
  getEntityPath,
  getClaudeModel,
  getAnthropicKey,
  getAnthropicAuthToken,
  type EntityConfig,
  type FileInfo,
  type Reminder,
  type DocMetadata,
  type ParsedData,
} from '../data.js';
import { logAiCall } from '../ai/usage-log.js';
import { createLogger } from '../logger.js';

const log = createLogger('Chat');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILE_RESULTS = 100;
const MAX_PARSED_TEXT_CHARS = 8000;
const MCP_SERVER_NAME = 'docvault';

// Tool names declared by our MCP server. Prefixed with `mcp__docvault__` once
// the agent SDK registers them — that prefixed form is what shows up in
// canUseTool / allowedTools / disallowedTools.
const TOOL_NAMES = [
  'list_entities',
  'list_files',
  'read_file',
  'search_files',
  'get_tax_summary',
  'set_metadata',
  'add_reminder',
] as const;
const ALLOWED_TOOLS = TOOL_NAMES.map((n) => `mcp__${MCP_SERVER_NAME}__${n}`);

// Resolve the Claude Code binary path explicitly. The SDK's auto-detection
// can pick the wrong platform variant when both `linux-x64` (glibc) and
// `linux-x64-musl` are present in node_modules — Bun installs all matching
// optional dependencies regardless of libc, and the SDK has been observed
// to prefer the musl variant on Debian-slim, which then fails to execute.
// Picking the right package by platform+arch and resolving its `claude`
// binary up-front sidesteps the heuristic entirely. Falls back to `undefined`
// (SDK auto-detect) on platforms we don't handle, so dev on macOS still works.
const CLAUDE_BINARY_PATH: string | undefined = (() => {
  const { platform, arch } = process;
  // Note: musl distros (Alpine) aren't covered — DocVault's container uses
  // Debian-slim, and dev happens on macOS or glibc Linux.
  let pkg: string | undefined;
  if (platform === 'linux' && arch === 'x64') pkg = '@anthropic-ai/claude-agent-sdk-linux-x64';
  else if (platform === 'linux' && arch === 'arm64')
    pkg = '@anthropic-ai/claude-agent-sdk-linux-arm64';
  else if (platform === 'darwin' && arch === 'x64')
    pkg = '@anthropic-ai/claude-agent-sdk-darwin-x64';
  else if (platform === 'darwin' && arch === 'arm64')
    pkg = '@anthropic-ai/claude-agent-sdk-darwin-arm64';
  if (!pkg) return undefined;
  try {
    const requireFromHere = createRequire(import.meta.url);
    const pkgJsonPath = requireFromHere.resolve(`${pkg}/package.json`);
    return path.join(path.dirname(pkgJsonPath), 'claude');
  } catch {
    return undefined;
  }
})();

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

interface ToolContext {
  config: { entities: EntityConfig[] };
}

async function toolListEntities(): Promise<unknown> {
  const config = await loadConfig();
  return {
    entities: config.entities.map((e) => ({
      id: e.id,
      name: e.name,
      type: e.type ?? 'tax',
      description: e.description ?? null,
    })),
  };
}

function summarizeParsed(parsed: ParsedData | null): string | null {
  if (!parsed) return null;
  const parts: string[] = [];
  for (const key of ['vendor', 'employerName', 'payerName', 'documentType', 'category']) {
    const v = parsed[key];
    if (typeof v === 'string' && v.length > 0) parts.push(`${key}=${v}`);
  }
  for (const key of ['totalAmount', 'amount', 'grossPay', 'wages']) {
    const v = parsed[key];
    if (typeof v === 'number') parts.push(`${key}=${v}`);
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

async function toolListFiles(input: { entity: string; year?: number }): Promise<unknown> {
  const entityPath = await getEntityPath(input.entity);
  if (!entityPath) {
    return { error: `Unknown entity "${input.entity}". Call list_entities first.` };
  }
  const baseDir = input.year ? `${entityPath}/${input.year}` : entityPath;
  let files: FileInfo[] = [];
  try {
    files = await scanDirectory(baseDir, input.year ? String(input.year) : '');
  } catch {
    return { entity: input.entity, year: input.year ?? null, files: [], note: 'No files found.' };
  }
  const parsedDataMap = await loadParsedData();
  const trimmed = files.slice(0, MAX_FILE_RESULTS).map((f) => {
    const parsed = parsedDataMap[`${input.entity}/${f.path}`] ?? null;
    return {
      name: f.name,
      path: f.path,
      type: f.type,
      sizeBytes: f.size,
      lastModified: new Date(f.lastModified).toISOString(),
      summary: summarizeParsed(parsed),
      parsed: parsed !== null,
    };
  });
  return {
    entity: input.entity,
    year: input.year ?? null,
    totalFound: files.length,
    truncated: files.length > MAX_FILE_RESULTS,
    files: trimmed,
  };
}

async function toolReadFile(input: { entity: string; path: string }): Promise<unknown> {
  const parsedDataMap = await loadParsedData();
  const metadataMap = await loadMetadata();
  const key = `${input.entity}/${input.path}`;
  const parsed = parsedDataMap[key] ?? null;
  const meta = metadataMap[key] ?? null;

  let parsedTrimmed: ParsedData | { _truncated: true; preview: string } | null = parsed;
  if (parsed) {
    const json = JSON.stringify(parsed);
    if (json.length > MAX_PARSED_TEXT_CHARS) {
      parsedTrimmed = { _truncated: true, preview: json.slice(0, MAX_PARSED_TEXT_CHARS) };
    }
  }

  return {
    entity: input.entity,
    path: input.path,
    parsedData: parsedTrimmed,
    metadata: meta,
  };
}

async function toolSearchFiles(input: { query: string }): Promise<unknown> {
  const query = input.query.toLowerCase();
  if (query.length < 2) return { error: 'query must be at least 2 characters' };
  const config = await loadConfig();
  const parsedDataMap = await loadParsedData();
  const results: Array<{
    entity: string;
    entityName: string;
    name: string;
    path: string;
    summary: string | null;
  }> = [];
  for (const entity of config.entities) {
    const entityPath = await getEntityPath(entity.id);
    if (!entityPath) continue;
    let files: FileInfo[] = [];
    try {
      files = await scanDirectory(entityPath, '');
    } catch {
      continue;
    }
    for (const f of files) {
      if (results.length >= MAX_FILE_RESULTS) break;
      const nameLower = f.name.toLowerCase();
      const pathLower = f.path.toLowerCase();
      const parsed = parsedDataMap[`${entity.id}/${f.path}`] ?? null;
      let match = nameLower.includes(query) || pathLower.includes(query);
      if (!match && parsed) {
        for (const field of [
          'vendor',
          'employerName',
          'payerName',
          'recipientName',
          'billTo',
          'customerName',
          'category',
          'description',
        ]) {
          const val = parsed[field];
          if (typeof val === 'string' && val.toLowerCase().includes(query)) {
            match = true;
            break;
          }
        }
        if (!match && Array.isArray(parsed.items)) {
          for (const item of parsed.items as { description?: string }[]) {
            if (item.description && item.description.toLowerCase().includes(query)) {
              match = true;
              break;
            }
          }
        }
      }
      if (match) {
        results.push({
          entity: entity.id,
          entityName: entity.name,
          name: f.name,
          path: f.path,
          summary: summarizeParsed(parsed),
        });
      }
    }
  }
  return { totalFound: results.length, files: results };
}

async function toolGetTaxSummary(input: { year: number }): Promise<unknown> {
  const config = await loadConfig();
  const parsedDataMap = await loadParsedData();
  const metadataMap = await loadMetadata();
  const taxEntities = config.entities.filter((e) => (e.type ?? 'tax') === 'tax');
  const { getIncomeSummary, getExpenseSummary } = await import('../analytics/index.js');

  const summary: Array<{
    entity: string;
    entityName: string;
    documentCount: number;
    incomeTotal: number;
    expenseTotal: number;
    incomeBySource: Array<{ source: string; amount: number }>;
    expensesByCategory: Array<{ category: string; amount: number }>;
  }> = [];

  for (const entity of taxEntities) {
    const entityPath = await getEntityPath(entity.id);
    if (!entityPath) continue;
    let files: FileInfo[] = [];
    try {
      files = await scanDirectory(`${entityPath}/${input.year}`, String(input.year));
    } catch {
      continue;
    }
    const analyticsFiles = files.map((f) => ({ name: f.name, path: f.path, type: f.type }));
    const income = getIncomeSummary(
      entity.id,
      String(input.year),
      parsedDataMap,
      metadataMap,
      analyticsFiles
    );
    const expenses = getExpenseSummary(
      entity.id,
      String(input.year),
      parsedDataMap,
      metadataMap,
      analyticsFiles
    );
    const incomeTotal = income.items.reduce((s, i) => s + i.amount, 0);
    const expenseTotal = expenses.expenses.reduce((s, e) => s + e.amount, 0);
    const byCategory = new Map<string, number>();
    for (const e of expenses.expenses) {
      byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amount);
    }
    summary.push({
      entity: entity.id,
      entityName: entity.name,
      documentCount: files.length,
      incomeTotal,
      expenseTotal,
      incomeBySource: income.items.map((i) => ({ source: i.source, amount: i.amount })),
      expensesByCategory: [...byCategory.entries()].map(([category, amount]) => ({
        category,
        amount,
      })),
    });
  }

  return { year: input.year, entities: summary };
}

async function toolSetMetadata(
  input: { entity: string; path: string; tags?: string[]; notes?: string | null },
  ctx: ToolContext
): Promise<unknown> {
  const knownEntity = ctx.config.entities.find((e) => e.id === input.entity);
  if (!knownEntity) return { error: `Unknown entity "${input.entity}".` };
  const metadataMap = await loadMetadata();
  const key = `${input.entity}/${input.path}`;
  const existing: DocMetadata = metadataMap[key] ?? {};
  const tags =
    input.tags && input.tags.length > 0
      ? Array.from(new Set([...(existing.tags ?? []), ...input.tags]))
      : existing.tags;
  const notes = input.notes === null ? undefined : (input.notes ?? existing.notes);
  metadataMap[key] = { ...existing, tags, notes };
  await saveMetadata(metadataMap);
  return { ok: true, key, metadata: metadataMap[key] };
}

async function toolAddReminder(
  input: {
    entity: string;
    title: string;
    dueDate: string;
    recurrence?: 'yearly' | 'monthly' | 'quarterly' | null;
    notes?: string | null;
  },
  ctx: ToolContext
): Promise<unknown> {
  const knownEntity = ctx.config.entities.find((e) => e.id === input.entity);
  if (!knownEntity) return { error: `Unknown entity "${input.entity}".` };
  const reminders = await loadReminders();
  const now = new Date().toISOString();
  const reminder: Reminder = {
    id: crypto.randomUUID(),
    entityId: input.entity,
    title: input.title,
    dueDate: input.dueDate,
    recurrence: input.recurrence ?? null,
    status: 'pending',
    notes: input.notes ?? undefined,
    createdAt: now,
    updatedAt: now,
  };
  reminders.push(reminder);
  await saveReminders(reminders);
  return { ok: true, reminder };
}

// ---------------------------------------------------------------------------
// MCP server — wraps the tool implementations as the agent SDK expects.
// Each tool returns a CallToolResult with a single text block carrying the
// JSON-serialized payload — same pattern Claude Code uses for its built-in
// tools, and the model parses it out of `content[0].text`.
// ---------------------------------------------------------------------------

function jsonResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}

function buildDocVaultMcpServer(ctx: ToolContext) {
  return createSdkMcpServer({
    name: MCP_SERVER_NAME,
    version: '1.0.0',
    tools: [
      tool(
        'list_entities',
        'List every configured entity (id, display name, type). Use first if you do not know which entity the user is asking about.',
        {},
        async () => jsonResult(await toolListEntities())
      ),
      tool(
        'list_files',
        'List files for a given entity. Optionally restrict to a tax year. Returns up to 100 files with their path, size, type, and a one-line summary derived from any cached parse data. Use this before drilling into specific documents.',
        {
          entity: z.string().describe('Entity id from list_entities.'),
          year: z
            .number()
            .optional()
            .describe('Optional tax year (e.g. 2025). Omit to list all files.'),
        },
        async (args) => jsonResult(await toolListFiles(args))
      ),
      tool(
        'read_file',
        'Return the cached parse data plus user notes/tags for a single file. Use this to answer questions about a specific document. Files that have not been parsed return parsedData: null — explain this rather than guessing.',
        {
          entity: z.string(),
          path: z
            .string()
            .describe(
              'File path relative to the entity root (use the path field from list_files).'
            ),
        },
        async (args) => jsonResult(await toolReadFile(args))
      ),
      tool(
        'search_files',
        'Substring search across filenames, paths, and parsed-data fields (vendor, payer, employer, line item descriptions, …) across every entity. Returns up to 100 hits. Prefer this over list_files when the user asks about a vendor or topic.',
        {
          query: z.string().describe('Lowercased substring; minimum 2 chars.'),
        },
        async (args) => jsonResult(await toolSearchFiles(args))
      ),
      tool(
        'get_tax_summary',
        'Return totals (income + expenses by category) for every tax-type entity for a given year. Use this for "what did I make" / "how much did I spend" questions.',
        {
          year: z.number(),
        },
        async (args) => jsonResult(await toolGetTaxSummary(args))
      ),
      tool(
        'set_metadata',
        'Set tags or a notes string on a file. Pass null to clear. Tags are merged with any existing tags. Use sparingly — confirm with the user before tagging if the request was ambiguous.',
        {
          entity: z.string(),
          path: z.string(),
          tags: z
            .array(z.string())
            .optional()
            .describe('Tags to add (merged with existing). Pass [] to leave tags unchanged.'),
          notes: z.string().nullable().optional(),
        },
        async (args) => jsonResult(await toolSetMetadata(args, ctx))
      ),
      tool(
        'add_reminder',
        'Create a reminder/deadline tied to an entity. Use for tax filing deadlines, follow-ups, etc.',
        {
          entity: z.string().describe('Entity id.'),
          title: z.string(),
          dueDate: z.string().describe('YYYY-MM-DD'),
          recurrence: z.enum(['yearly', 'monthly', 'quarterly']).nullable().optional(),
          notes: z.string().nullable().optional(),
        },
        async (args) => jsonResult(await toolAddReminder(args, ctx))
      ),
    ],
  });
}

// ---------------------------------------------------------------------------
// System prompt — the LAST user message is sent as the SDK's `prompt`, so
// prior conversation lives here as static context. Cheap because the SDK
// caches the system prompt across turns.
// ---------------------------------------------------------------------------

function buildSystemPrompt(
  activeEntity: string | undefined,
  history: IncomingChatMessage[]
): string {
  const today = new Date().toISOString().slice(0, 10);
  const parts: string[] = [
    `You are the DocVault chat assistant — answering questions about the user's tax documents, financial records, and personal files. Today is ${today}.`,
    activeEntity
      ? `The user currently has entity "${activeEntity}" selected in the UI; prefer it when context is ambiguous, but call list_entities if they ask about something different.`
      : 'No entity is currently selected in the UI.',
    'Use the provided tools to answer factually. Never invent file names, vendors, amounts, or dates. If a file has not been parsed yet, say so — do not guess its contents.',
    'Be concise. Use markdown tables for structured data. When citing a specific document, include its path so the user can find it.',
    'Write tools (set_metadata, add_reminder) make persistent changes — only invoke them when the user has clearly asked for that action.',
  ];
  if (history.length > 0) {
    const transcript = history.map((m) => `${m.role}: ${m.content}`).join('\n\n');
    parts.push(`## Prior conversation in this thread\n\n${transcript}`);
  }
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

interface IncomingChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ---------------------------------------------------------------------------
// Route handler — streams SSE
// ---------------------------------------------------------------------------

export async function handleChatRoutes(
  req: Request,
  _url: URL,
  pathname: string
): Promise<Response | null> {
  if (pathname !== '/api/chat') return null;
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  let body: { messages?: IncomingChatMessage[]; entity?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const incoming = (body.messages ?? []).filter(
    (m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'
  );
  if (incoming.length === 0) {
    return jsonResponse({ error: 'messages must be a non-empty array' }, 400);
  }
  const last = incoming[incoming.length - 1];
  if (last.role !== 'user') {
    return jsonResponse({ error: 'last message must be from the user' }, 400);
  }

  // Resolve credentials from settings (override env). The SDK reads
  // CLAUDE_CODE_OAUTH_TOKEN / ANTHROPIC_API_KEY from the env we pass to
  // its bundled Claude Code subprocess, so we layer settings on top of
  // process.env rather than mutating process.env globally.
  const oauthToken = await getAnthropicAuthToken();
  const apiKey = await getAnthropicKey();
  if (!oauthToken && !apiKey) {
    return jsonResponse(
      {
        error:
          'No Claude credentials configured. Add an Anthropic API key OR a Claude OAuth token in Settings.',
      },
      400
    );
  }

  const model = await getClaudeModel();
  const config = await loadConfig();
  const ctx: ToolContext = { config };
  const history = incoming.slice(0, -1);
  const systemPrompt = buildSystemPrompt(body.entity, history);
  const mcpServer = buildDocVaultMcpServer(ctx);

  const subprocessEnv: Record<string, string | undefined> = {
    ...process.env,
    ...(oauthToken ? { CLAUDE_CODE_OAUTH_TOKEN: oauthToken } : {}),
    ...(apiKey ? { ANTHROPIC_API_KEY: apiKey } : {}),
  };

  const startedAt = Date.now();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: object) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          /* stream already closed */
        }
      };

      try {
        for await (const message of query({
          prompt: last.content,
          options: {
            model,
            systemPrompt,
            // Disable every built-in Claude Code tool — the chat must NOT
            // be able to Bash/Read/Edit files on the NAS. Only DocVault's
            // MCP tools below should be reachable.
            allowedTools: ALLOWED_TOOLS,
            disallowedTools: [
              'Bash',
              'Read',
              'Edit',
              'Write',
              'Glob',
              'Grep',
              'WebFetch',
              'WebSearch',
              'NotebookEdit',
            ],
            mcpServers: { [MCP_SERVER_NAME]: mcpServer },
            // Defense-in-depth: even if a built-in tool slips past
            // disallowedTools, this callback denies anything not in our
            // explicit allow-list.
            canUseTool: async (toolName) => {
              if (ALLOWED_TOOLS.includes(toolName)) {
                return { behavior: 'allow', updatedInput: {} };
              }
              return {
                behavior: 'deny',
                message: `Tool "${toolName}" is not allowed in DocVault chat.`,
                interrupt: false,
              };
            },
            env: subprocessEnv,
            cwd: '/tmp',
            ...(CLAUDE_BINARY_PATH ? { pathToClaudeCodeExecutable: CLAUDE_BINARY_PATH } : {}),
          },
        })) {
          translateAndSend(message, send);
          if (message.type === 'result') {
            const usageInput = message.usage?.input_tokens ?? 0;
            const usageOutput = message.usage?.output_tokens ?? 0;
            void logAiCall({
              model,
              purpose: 'chat',
              latencyMs: Date.now() - startedAt,
              usage: { inputTokens: usageInput, outputTokens: usageOutput },
              ok: !message.is_error,
              stopReason: message.stop_reason ?? null,
            });
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error(`Chat stream failed: ${msg}`);
        send({ type: 'error', message: msg });
        void logAiCall({
          model,
          purpose: 'chat',
          latencyMs: Date.now() - startedAt,
          usage: { inputTokens: 0, outputTokens: 0 },
          ok: false,
          error: msg,
        });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// Translate one SDKMessage into zero-or-more wire events for the client.
function translateAndSend(message: SDKMessage, send: (event: object) => void): void {
  if (message.type === 'assistant') {
    for (const block of message.message.content) {
      if (block.type === 'text') {
        send({ type: 'text', text: block.text });
      } else if (block.type === 'tool_use') {
        // Strip the `mcp__docvault__` prefix so the UI shows the friendly
        // tool name (matches the labels the previous chat handler emitted).
        const friendlyName = block.name.startsWith(`mcp__${MCP_SERVER_NAME}__`)
          ? block.name.slice(`mcp__${MCP_SERVER_NAME}__`.length)
          : block.name;
        send({
          type: 'tool_call',
          id: block.id,
          toolName: friendlyName,
          input: block.input,
        });
      }
    }
  } else if (message.type === 'user') {
    const content = message.message.content;
    if (typeof content === 'string') return;
    for (const block of content) {
      if (block.type !== 'tool_result') continue;
      // tool_result.content is `string | unknown[]` per the API. The MCP
      // server we built returns text-block arrays — extract the text and
      // try to parse it back into the JSON the model sent up.
      let parsed: unknown = block.content;
      if (Array.isArray(block.content)) {
        const textBlock = block.content.find(
          (b: unknown) =>
            typeof b === 'object' && b !== null && (b as { type?: string }).type === 'text'
        ) as { text?: string } | undefined;
        if (textBlock?.text) {
          try {
            parsed = JSON.parse(textBlock.text);
          } catch {
            parsed = textBlock.text;
          }
        }
      }
      send({
        type: 'tool_result',
        toolUseId: block.tool_use_id,
        result: parsed,
        isError: !!block.is_error,
      });
    }
  } else if (message.type === 'result') {
    send({
      type: 'done',
      stopReason: message.stop_reason ?? null,
      isError: message.is_error,
    });
  }
}
