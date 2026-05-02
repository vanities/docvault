// Mobile chat route — agentic conversation against the user's vault.
//
// POST /api/chat
//   body: { messages: ChatMessage[], entity?: string }
//   returns: { content: AssistantBlock[], stopReason?: string, error?: string }
//
// The frontend keeps the full conversation history client-side and replays it
// on every turn (server is stateless). This route runs the Claude tool-use
// loop server-side: tool_use blocks come back from the model, we execute the
// tool, append a tool_result, and loop until stop_reason !== 'tool_use'.
//
// Tools intentionally hit the same data-layer helpers the rest of the app
// uses (loadConfig, scanDirectory, loadParsedData, …) so the chat sees
// exactly what the file views show. Write tools (set_metadata, add_reminder)
// are scoped to safe metadata mutations — the chat can't move/delete files.
//
// Loop is bounded at MAX_TURNS to keep tokens predictable; client gets a
// `stopReason` if it hit the cap.

import Anthropic from '@anthropic-ai/sdk';
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
  type EntityConfig,
  type FileInfo,
  type Reminder,
  type DocMetadata,
  type ParsedData,
} from '../data.js';
import { getClient } from '../parsers/base.js';
import { withAILimit } from '../aiLimiter.js';
import { logAiCall } from '../ai/usage-log.js';
import { createLogger } from '../logger.js';

const log = createLogger('Chat');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_TURNS = 8; // hard cap on tool-use round-trips per request
const MAX_OUTPUT_TOKENS = 4096;
const MAX_FILE_RESULTS = 100;
const MAX_PARSED_TEXT_CHARS = 8000;

// ---------------------------------------------------------------------------
// Tool definitions (Anthropic Messages format)
// ---------------------------------------------------------------------------

const TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: 'list_entities',
    description:
      'List every configured entity (id, display name, type). Use first if you do not know which entity the user is asking about.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'list_files',
    description:
      'List files for a given entity. Optionally restrict to a tax year. Returns up to 100 files with their path, size, type, and a one-line summary derived from any cached parse data. Use this before drilling into specific documents.',
    input_schema: {
      type: 'object',
      properties: {
        entity: { type: 'string', description: 'Entity id from list_entities.' },
        year: {
          type: 'number',
          description: 'Optional tax year (e.g. 2025). Omit to list all files.',
        },
      },
      required: ['entity'],
    },
  },
  {
    name: 'read_file',
    description:
      'Return the cached parse data plus user notes/tags for a single file. Use this to answer questions about a specific document. Files that have not been parsed return parsedData: null — explain this rather than guessing.',
    input_schema: {
      type: 'object',
      properties: {
        entity: { type: 'string' },
        path: {
          type: 'string',
          description:
            'File path relative to the entity root (use the path field from list_files).',
        },
      },
      required: ['entity', 'path'],
    },
  },
  {
    name: 'search_files',
    description:
      'Substring search across filenames, paths, and parsed-data fields (vendor, payer, employer, line item descriptions, …) across every entity. Returns up to 100 hits. Prefer this over list_files when the user asks about a vendor or topic.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Lowercased substring; minimum 2 chars.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_tax_summary',
    description:
      'Return totals (income + expenses by category) for every tax-type entity for a given year. Use this for "what did I make" / "how much did I spend" questions.',
    input_schema: {
      type: 'object',
      properties: { year: { type: 'number' } },
      required: ['year'],
    },
  },
  {
    name: 'set_metadata',
    description:
      'Set tags or a notes string on a file. Pass null to clear. Tags are merged with any existing tags. Use sparingly — confirm with the user before tagging if the request was ambiguous.',
    input_schema: {
      type: 'object',
      properties: {
        entity: { type: 'string' },
        path: { type: 'string' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags to add (merged with existing). Pass [] to leave tags unchanged.',
        },
        notes: { type: ['string', 'null'] },
      },
      required: ['entity', 'path'],
    },
  },
  {
    name: 'add_reminder',
    description:
      'Create a reminder/deadline tied to an entity. Use for tax filing deadlines, follow-ups, etc.',
    input_schema: {
      type: 'object',
      properties: {
        entity: { type: 'string', description: 'Entity id.' },
        title: { type: 'string' },
        dueDate: { type: 'string', description: 'YYYY-MM-DD' },
        recurrence: {
          type: ['string', 'null'],
          enum: ['yearly', 'monthly', 'quarterly', null],
        },
        notes: { type: ['string', 'null'] },
      },
      required: ['entity', 'title', 'dueDate'],
    },
  },
];

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

async function executeTool(name: string, input: unknown, ctx: ToolContext): Promise<unknown> {
  try {
    switch (name) {
      case 'list_entities':
        return await toolListEntities();
      case 'list_files':
        return await toolListFiles(input as { entity: string; year?: number });
      case 'read_file':
        return await toolReadFile(input as { entity: string; path: string });
      case 'search_files':
        return await toolSearchFiles(input as { query: string });
      case 'get_tax_summary':
        return await toolGetTaxSummary(input as { year: number });
      case 'set_metadata':
        return await toolSetMetadata(
          input as { entity: string; path: string; tags?: string[]; notes?: string | null },
          ctx
        );
      case 'add_reminder':
        return await toolAddReminder(
          input as {
            entity: string;
            title: string;
            dueDate: string;
            recurrence?: 'yearly' | 'monthly' | 'quarterly' | null;
            notes?: string | null;
          },
          ctx
        );
      default:
        return { error: `Unknown tool "${name}"` };
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

function buildSystemPrompt(activeEntity?: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return [
    `You are the DocVault chat assistant — answering questions about the user's tax documents, financial records, and personal files. Today is ${today}.`,
    activeEntity
      ? `The user currently has entity "${activeEntity}" selected in the UI; prefer it when context is ambiguous, but call list_entities if they ask about something different.`
      : 'No entity is currently selected in the UI.',
    'Use the provided tools to answer factually. Never invent file names, vendors, amounts, or dates. If a file has not been parsed yet, say so — do not guess its contents.',
    'Be concise. Use markdown tables for structured data. When citing a specific document, include its path so the user can find it.',
    'Write tools (set_metadata, add_reminder) make persistent changes — only invoke them when the user has clearly asked for that action.',
  ].join('\n\n');
}

// ---------------------------------------------------------------------------
// Public types (mirrored on the frontend)
// ---------------------------------------------------------------------------

interface IncomingChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AssistantTextBlock {
  type: 'text';
  text: string;
}

interface AssistantToolCallBlock {
  type: 'tool_call';
  toolName: string;
  input: unknown;
  result: unknown;
  ok: boolean;
}

type AssistantBlock = AssistantTextBlock | AssistantToolCallBlock;

// ---------------------------------------------------------------------------
// Route handler
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

  let anthropic: Anthropic;
  try {
    anthropic = await getClient();
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Claude not configured' },
      400
    );
  }

  const model = await getClaudeModel();
  const config = await loadConfig();
  const ctx: ToolContext = { config };
  const system = buildSystemPrompt(body.entity);

  const apiMessages: Anthropic.Messages.MessageParam[] = incoming.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // Surface blocks the user sees, in order. Text blocks are streamed-out
  // assistant chatter; tool_call blocks let the UI render a small "ran X"
  // affordance with the input/result for transparency.
  const surfaceBlocks: AssistantBlock[] = [];
  const startedAt = Date.now();
  let stopReason: string | null = null;

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await withAILimit(() =>
        anthropic.messages.create({
          model,
          max_tokens: MAX_OUTPUT_TOKENS,
          system,
          tools: TOOLS,
          messages: apiMessages,
        })
      );

      void logAiCall({
        model,
        purpose: 'chat',
        latencyMs: Date.now() - startedAt,
        usage: {
          inputTokens: response.usage.input_tokens ?? 0,
          outputTokens: response.usage.output_tokens ?? 0,
        },
        ok: true,
        requestId: response.id ?? null,
        stopReason: response.stop_reason ?? null,
      });

      stopReason = response.stop_reason;

      // Append the assistant's response into the running message log.
      apiMessages.push({ role: 'assistant', content: response.content });

      // Capture text blocks for the client.
      for (const block of response.content) {
        if (block.type === 'text') {
          surfaceBlocks.push({ type: 'text', text: block.text });
        }
      }

      // No tool use → done.
      if (response.stop_reason !== 'tool_use') break;

      // Execute every tool_use block in this turn and append a single
      // user-role message containing all tool_result blocks.
      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        log.info(`tool_use: ${block.name} ${JSON.stringify(block.input).slice(0, 200)}`);
        const result = await executeTool(block.name, block.input, ctx);
        const ok = !(typeof result === 'object' && result && 'error' in result);
        surfaceBlocks.push({
          type: 'tool_call',
          toolName: block.name,
          input: block.input,
          result,
          ok,
        });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
          is_error: !ok,
        });
      }
      apiMessages.push({ role: 'user', content: toolResults });
    }

    return jsonResponse({ content: surfaceBlocks, stopReason });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`Chat call failed: ${message}`);
    void logAiCall({
      model,
      purpose: 'chat',
      latencyMs: Date.now() - startedAt,
      usage: { inputTokens: 0, outputTokens: 0 },
      ok: false,
      error: message,
    });
    return jsonResponse({ error: message, content: surfaceBlocks }, 500);
  }
}
