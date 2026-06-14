// Mobile chat route — agentic conversation against the user's vault.
//
// POST /api/chat
//   body: { messages: ChatMessage[], entity?: string, chatId?: string,
//           resumeSessionId?: string,
//           attachments?: { name, mimeType, dataUrl }[] }
//   returns: text/event-stream — newline-delimited `data: {json}\n\n` events
//
// Two IDs (matches t3code's split):
//   - `chatId` — client-minted UUID, sent on every turn. Scopes attachments
//     to /data/_chat-attachments/<chatId>/ on disk for cleanup.
//   - `resumeSessionId` — assigned by the SDK on the first turn. Server
//     captures it from `session_id` on each SDKMessage and emits a
//     {type:'session', sessionId} event so the client can persist it. On
//     subsequent turns the client sends it back and the route passes
//     `resume:` to query() — Claude Code then has full conversation context
//     natively, so we don't need to fold history into the system prompt.
//
// Attachments are sent **inline as base64 data URLs in the chat body**
// (matches t3code's `UploadChatImageAttachment` flow — no separate upload
// endpoint). The handler parses each dataUrl, validates size + mime, writes
// it to disk under <chatId>/, and includes it as an image or document
// content block in the SDKUserMessage that gets handed to query().
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
import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import { createRequire } from 'module';
import {
  createSdkMcpServer,
  query,
  tool,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { readJsonBody } from '../http.js';
import {
  DATA_DIR,
  jsonResponse,
  loadConfig,
  loadSettings,
  loadParsedData,
  loadMetadata,
  saveMetadata,
  loadReminders,
  saveReminders,
  scanDirectory,
  getEntityPath,
  getClaudeModel,
  getChatMode,
  getChatApiModel,
  getClaudeChatEffort,
  toClaudeAgentEffort,
  toOpenAIEffort,
  getChatBackend,
  getCodexChatConfig,
  getAnthropicKey,
  getAnthropicAuthToken,
  ensureDir,
  type EntityConfig,
  type FileInfo,
  type Reminder,
  type DocMetadata,
  type ParsedData,
} from '../data.js';
import { runCodexChat } from '../llm/codex-chat.js';
import { ensureSkillsPluginDir, buildSkillsPromptBlock } from '../skills.js';
import { loadHealthStore } from '../health-store.js';
import { searchMarkdown, readSourceFile, listSourceFiles } from '../external-sources.js';
import { readBrain, readBrainContent, appendBrainEntry } from '../brain.js';
import { getCachedPredictions, handleQuantRoutes } from './quant.js';
import { handleNutritionRoutes } from './nutrition.js';
import { handleSicknessRoutes } from './sickness.js';
import { handleHealthSnapshotRoutes } from './health-snapshot.js';
import {
  handleResearchRoutes,
  RESEARCH_DOMAINS,
  type ResearchDomain,
  type ResearchEntry,
} from './research.js';
import { handleFinancialSnapshotRoutes } from './financial-snapshot.js';
import { handleDailyNewsRoutes } from './daily-news.js';
import { handlePoliticsRoutes } from './politics.js';
import { listRuns, getRun } from '../deep-research-store.js';
import { loadChatThreads, saveChatThreads, isChatThreadsState } from '../chat-threads-store.js';
import { logAiCall } from '../ai/usage-log.js';
import { createLogger } from '../logger.js';

const log = createLogger('Chat');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILE_RESULTS = 100;
const MAX_PARSED_TEXT_CHARS = 8000;
// Deep Research reports are meant to be read whole; this only caps pathological
// sizes so a single run can't blow out the agent's context window.
const MAX_REPORT_CHARS = 30000;
const MCP_SERVER_NAME = 'docvault';

// Per-chat attachment store. Mirrors t3code's per-thread folder pattern
// so cleanup is just `rm -rf <chatId>/`. Layout:
//   /data/_chat-attachments/<chatId>/<uuid>.<ext>
const CHAT_ATTACHMENTS_DIR = path.join(DATA_DIR, '_chat-attachments');

// Mime types we let through the upload endpoint. Images go in as Anthropic
// `image` content blocks; PDFs as `document` blocks (the SDK passes both
// straight through to the Messages API). DocVault is document-first, so
// PDFs are the most-requested attachment type — extends t3code's
// image-only schema.
const SUPPORTED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const SUPPORTED_DOCUMENT_MIME_TYPES = new Set(['application/pdf']);
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10MB — Anthropic's image cap is generous but DocVault doesn't need megabyte raws.

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

// Parse a `data:<mime>;base64,<payload>` URL. Returns null on any deviation
// from that exact form — we deliberately don't accept percent-encoded data
// URLs (they're a different format and we can validate base64 cleanly).
function parseBase64DataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
  const match = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const mimeType = match[1].trim().toLowerCase();
  const base64 = match[2];
  if (mimeType.length === 0 || base64.length === 0) return null;
  return { mimeType, base64 };
}

function extensionFor(mimeType: string): string {
  switch (mimeType) {
    case 'image/png':
      return '.png';
    case 'image/jpeg':
      return '.jpg';
    case 'image/gif':
      return '.gif';
    case 'image/webp':
      return '.webp';
    case 'application/pdf':
      return '.pdf';
    default:
      return '.bin';
  }
}

// Tool names declared by our MCP server. Prefixed with `mcp__docvault__` once
// the agent SDK registers them — that prefixed form is what shows up in
// canUseTool / allowedTools / disallowedTools.
//
// READS are first, WRITES are last — visual grouping makes the
// "agent must confirm before invoking" rule in the system prompt easy to
// audit. The writes set is also the literal list the prompt names.
const TOOL_NAMES = [
  // --- Reads (free to chain) ---
  'list_entities',
  'list_files',
  'read_file',
  'search_files',
  'get_tax_summary',
  'list_health_people',
  'get_health_snapshot',
  'list_supplements',
  'get_supplement',
  'list_external_sources',
  'search_external_sources',
  'read_external_file',
  'list_external_source_files',
  'get_prediction_markets',
  'list_research',
  'search_research',
  'read_research',
  'list_deep_research',
  'read_deep_research',
  'get_financial_snapshot',
  'get_quant_signals',
  'get_daily_news',
  'get_congress_trades',
  'read_brain',
  // --- Writes (require user confirmation per system prompt) ---
  'remember',
  'set_metadata',
  'add_reminder',
  'create_supplement',
  'update_supplement',
  'delete_supplement',
  'log_sickness',
] as const;
// Built-in Claude Code tools we want available alongside our MCP set. WebSearch
// lets the chat research products/brands/citations while reasoning about the
// user's existing data — necessary for the "recommend a creatine brand" use
// case the chat is designed for.
// Skill is allow-listed too: it lets the model invoke user-authored skills
// from DATA_DIR/skills (mirrored into a local plugin per turn). Our
// canUseTool callback denies anything outside ALLOWED_TOOLS, so the Skill
// tool must be listed here even though the SDK's `skills` option normally
// self-enables it.
const ALLOWED_BUILTIN_TOOLS = ['WebSearch', 'Skill'] as const;
const ALLOWED_TOOLS: string[] = [
  ...TOOL_NAMES.map((n) => `mcp__${MCP_SERVER_NAME}__${n}`),
  ...ALLOWED_BUILTIN_TOOLS,
];

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
// Health tools — read + write the multi-person Health sidebar surface.
//
// For mutations we call the existing route handlers in-process with a
// synthesized Request rather than re-implementing the validation. This keeps
// the chat path bit-identical to the HTTP path the UI uses, so any future fix
// to the routes automatically applies to chat as well. Reads short-circuit
// directly against the health store for speed.
// ---------------------------------------------------------------------------

type RouteHandler = (req: Request, url: URL, pathname: string) => Promise<Response | null>;

async function invokeRoute(
  handler: RouteHandler,
  method: string,
  routePath: string,
  body?: unknown
): Promise<{ status: number; data: unknown }> {
  const url = new URL(`http://internal${routePath}`);
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const req = new Request(url.toString(), init);
  const resp = await handler(req, url, url.pathname);
  if (!resp) {
    return { status: 500, data: { error: `No handler matched ${method} ${routePath}` } };
  }
  const text = await resp.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // Non-JSON response (e.g. markdown snapshot) — keep as string.
  }
  return { status: resp.status, data };
}

async function toolListHealthPeople(): Promise<unknown> {
  const store = await loadHealthStore();
  return {
    people: store.people.map((p) => ({
      id: p.id,
      name: p.name,
      archived: !!p.archivedAt,
    })),
  };
}

async function toolGetHealthSnapshot(input: {
  personId: string;
  includeClinical?: boolean;
  includeDNA?: boolean;
}): Promise<unknown> {
  const qs = new URLSearchParams();
  qs.set('personId', input.personId);
  qs.set('format', 'md');
  if (input.includeClinical === false) qs.set('includeClinical', 'false');
  if (input.includeDNA === false) qs.set('includeDNA', 'false');
  const { status, data } = await invokeRoute(
    handleHealthSnapshotRoutes,
    'GET',
    `/api/health-snapshot?${qs.toString()}`
  );
  if (status !== 200) return { error: data, status };
  return { markdown: typeof data === 'string' ? data : JSON.stringify(data) };
}

async function toolListSupplements(input: {
  personId: string;
  status?: 'considering' | 'active' | 'past' | 'never';
}): Promise<unknown> {
  const store = await loadHealthStore();
  if (!store.people.some((p) => p.id === input.personId)) {
    return { error: `Unknown person "${input.personId}". Call list_health_people first.` };
  }
  const prefix = `${input.personId}/`;
  const entries = Object.entries(store.nutrition ?? {})
    .filter(([k]) => k.startsWith(prefix))
    .map(([, v]) => v)
    .filter((e) => (input.status ? e.status === input.status : true))
    .map((e) => ({
      id: e.id,
      brandName: e.parsed?.brandName ?? null,
      productName: e.parsed?.productName ?? null,
      category: e.parsed?.category ?? null,
      status: e.status,
      dose: e.dose ?? null,
      notes: e.notes ?? null,
      lastUpdated: e.lastUpdated,
    }));
  return { personId: input.personId, totalFound: entries.length, entries };
}

async function toolGetSupplement(input: { personId: string; id: string }): Promise<unknown> {
  const store = await loadHealthStore();
  const entry = store.nutrition?.[`${input.personId}/${input.id}`];
  if (!entry) return { error: `No supplement "${input.id}" for person "${input.personId}".` };
  return { entry };
}

async function toolCreateSupplement(input: Record<string, unknown>): Promise<unknown> {
  const personId = typeof input.personId === 'string' ? input.personId : '';
  if (!personId) return { error: 'personId is required' };
  // The personId travels in the URL; the rest of the input is the JSON body.
  const { personId: _omit, ...body } = input;
  const { status, data } = await invokeRoute(
    handleNutritionRoutes,
    'POST',
    `/api/health/${encodeURIComponent(personId)}/nutrition`,
    body
  );
  return status === 200 ? data : { error: data, status };
}

async function toolUpdateSupplement(input: Record<string, unknown>): Promise<unknown> {
  const personId = typeof input.personId === 'string' ? input.personId : '';
  const id = typeof input.id === 'string' ? input.id : '';
  if (!personId || !id) return { error: 'personId and id are required' };
  const { personId: _p, id: _i, ...patch } = input;
  const { status, data } = await invokeRoute(
    handleNutritionRoutes,
    'PATCH',
    `/api/health/${encodeURIComponent(personId)}/nutrition/${encodeURIComponent(id)}`,
    patch
  );
  return status === 200 ? data : { error: data, status };
}

async function toolDeleteSupplement(input: { personId: string; id: string }): Promise<unknown> {
  const { status, data } = await invokeRoute(
    handleNutritionRoutes,
    'DELETE',
    `/api/health/${encodeURIComponent(input.personId)}/nutrition/${encodeURIComponent(input.id)}`
  );
  return status === 200 ? data : { error: data, status };
}

async function toolLogSickness(input: Record<string, unknown>): Promise<unknown> {
  const personId = typeof input.personId === 'string' ? input.personId : '';
  if (!personId) return { error: 'personId is required' };
  const { personId: _omit, ...body } = input;
  const { status, data } = await invokeRoute(
    handleSicknessRoutes,
    'POST',
    `/api/health/${encodeURIComponent(personId)}/sickness`,
    body
  );
  return status === 200 ? data : { error: data, status };
}

// ---------------------------------------------------------------------------
// MCP server — wraps the tool implementations as the agent SDK expects.
// Each tool returns a CallToolResult with a single text block carrying the
// JSON-serialized payload — same pattern Claude Code uses for its built-in
// tools, and the model parses it out of `content[0].text`.
// ---------------------------------------------------------------------------

async function toolListExternalSources(): Promise<unknown> {
  const settings = await loadSettings();
  const repos = settings.externalSources?.repos ?? [];
  return {
    sources: repos.map((r) => ({
      id: r.id,
      name: r.name,
      synced: !!r.lastSyncedAt,
      fileCount: r.fileCount ?? 0,
      lastError: r.lastError ?? null,
    })),
  };
}

async function toolSearchExternalSources(input: {
  query: string;
  sourceId?: string;
}): Promise<unknown> {
  if (input.query.trim().length < 2) return { error: 'query must be at least 2 characters' };
  const settings = await loadSettings();
  let repos = (settings.externalSources?.repos ?? []).filter((r) => r.lastSyncedAt);
  if (input.sourceId) repos = repos.filter((r) => r.id === input.sourceId);
  if (repos.length === 0) {
    return {
      results: [],
      note: 'No synced external sources to search. The user can add one in Settings → Sources.',
    };
  }
  const results = await searchMarkdown(repos, input.query, { maxResults: 50 });
  return { totalFound: results.length, results };
}

async function toolReadExternalFile(input: { sourceId: string; path: string }): Promise<unknown> {
  const settings = await loadSettings();
  const repo = (settings.externalSources?.repos ?? []).find((r) => r.id === input.sourceId);
  if (!repo) {
    return { error: `Unknown source "${input.sourceId}". Call list_external_sources first.` };
  }
  try {
    const file = await readSourceFile(input.sourceId, input.path);
    return { sourceId: input.sourceId, sourceName: repo.name, ...file };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

async function toolListExternalSourceFiles(input: {
  sourceId: string;
  folder?: string;
}): Promise<unknown> {
  const settings = await loadSettings();
  const repo = (settings.externalSources?.repos ?? []).find((r) => r.id === input.sourceId);
  if (!repo) {
    return { error: `Unknown source "${input.sourceId}". Call list_external_sources first.` };
  }
  let files = await listSourceFiles(input.sourceId);
  if (input.folder) {
    const prefix = input.folder.toLowerCase();
    files = files.filter((f) => f.toLowerCase().startsWith(prefix));
  }
  const MAX = 200;
  const truncated = files.length > MAX;
  return {
    sourceId: input.sourceId,
    sourceName: repo.name,
    totalFiles: files.length,
    truncated,
    files: truncated ? files.slice(0, MAX) : files,
  };
}

async function toolGetPredictionMarkets(input: {
  domain?: 'finance' | 'politics';
  query?: string;
  limit?: number;
}): Promise<unknown> {
  try {
    const data = await getCachedPredictions();
    const limit = Math.max(1, Math.min(input.limit ?? 20, 50));
    const q = input.query?.trim().toLowerCase();
    const pick = (rows: typeof data.finance) =>
      (q
        ? rows.filter(
            (m) => m.question.toLowerCase().includes(q) || m.topic.toLowerCase().includes(q)
          )
        : rows
      )
        .slice(0, limit)
        .map((m) => ({
          question: m.question,
          probability: m.probability,
          source: m.source,
          topic: m.topic,
          volumeUsd: m.volumeUsd,
          change24h: m.change24h ?? null,
          closeTime: m.closeTime,
          url: m.url,
        }));
    const out: Record<string, unknown> = { fetchedAt: data.fetchedAt, sources: data.sources };
    if (input.domain !== 'politics') out.finance = pick(data.finance);
    if (input.domain !== 'finance') out.politics = pick(data.politics);
    if (data.errors?.length) out.errors = data.errors;
    return out;
  } catch (err) {
    return { error: (err as Error).message };
  }
}

// -- Daily News (synthesized newspaper editions) ----------------------------
// Reuses the same /api/daily-news handler the Newsstand UI calls. No id → list
// recent editions; with an id → return that edition's full synthesized body.
async function toolGetDailyNews(input: { id?: string; limit?: number }): Promise<unknown> {
  try {
    if (input.id) {
      const { data } = await invokeRoute(
        handleDailyNewsRoutes,
        'GET',
        `/api/daily-news/${encodeURIComponent(input.id)}`
      );
      const ed = data as {
        id?: string;
        editionType?: string;
        editionDate?: string;
        title?: string;
        body?: string;
      } | null;
      if (!ed || !ed.id) {
        return { error: `No edition "${input.id}". Call get_daily_news with no id to list them.` };
      }
      const body = ed.body ?? '';
      const MAX = 24000;
      return {
        id: ed.id,
        type: ed.editionType,
        date: ed.editionDate,
        title: ed.title,
        body: body.length > MAX ? `${body.slice(0, MAX)}\n…[truncated]` : body,
      };
    }
    const { data } = await invokeRoute(handleDailyNewsRoutes, 'GET', '/api/daily-news');
    const list = ((data as { editions?: unknown[] })?.editions ?? []) as Array<
      Record<string, unknown>
    >;
    const limit = Math.max(1, Math.min(input.limit ?? 10, 30));
    const editions = list.slice(0, limit).map((e) => ({
      id: e.id,
      type: e.editionType,
      date: e.editionDate,
      title: e.title,
      status: e.status,
    }));
    return {
      count: editions.length,
      editions,
      hint: 'Call again with an id to read that edition’s full synthesized body.',
    };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

// -- Congressional trades (politician stock/option disclosures) --------------
// Reuses /api/politics/trades. Public STOCK Act disclosures — distinct from the
// user's own holdings. Optional filters mirror the Politics → Trades view.
async function toolGetCongressTrades(input: {
  politician?: string;
  ticker?: string;
  chamber?: string;
  category?: string;
  limit?: number;
}): Promise<unknown> {
  try {
    const qs = new URLSearchParams();
    if (input.politician) qs.set('politician', input.politician);
    if (input.ticker) qs.set('ticker', input.ticker);
    if (input.chamber) qs.set('chamber', input.chamber);
    if (input.category) qs.set('category', input.category);
    const q = qs.toString();
    const { data } = await invokeRoute(
      handlePoliticsRoutes,
      'GET',
      `/api/politics/trades${q ? `?${q}` : ''}`
    );
    const trades = (
      ((data as { trades?: unknown[] })?.trades ?? []) as Array<Record<string, unknown>>
    ).slice(0, Math.max(1, Math.min(input.limit ?? 40, 200)));
    return {
      count: trades.length,
      trades: trades.map((t) => ({
        politician: t.politicianName,
        chamber: t.chamber,
        party: t.party,
        category: t.category,
        ticker: t.ticker ?? t.assetName,
        amount: t.amount,
        tradeDate: t.tradeDate,
        filingDate: t.filingDate,
      })),
    };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

// -- Research library (filed PDFs, pasted articles, YouTube transcripts) -----
// These reuse the same /api/research handler the UI calls, so the chat sees
// exactly what the Research tab shows. Entries carry extracted text plus
// deterministic "intelligence" (summary bullets + source-grounded claims).

/** One-line metadata view of a research entry — omits the (large) full text. */
function summarizeResearchEntry(e: ResearchEntry) {
  return {
    id: e.id,
    domain: e.domain,
    title: e.title ?? e.filename ?? null,
    author: e.author ?? null,
    publisher: e.publisher ?? null,
    reportDate: e.reportDate ?? null,
    uploadedAt: e.uploadedAt,
    sourceUrl: e.sourceUrl ?? null,
    mediaType: e.mediaType,
    pageCount: e.pageCount ?? null,
    tickers: e.tickers ?? [],
    tags: e.tags ?? [],
    hasIntelligence: Boolean(e.intelligence),
    hasText: typeof e.text === 'string' && e.text.length > 0,
  };
}

/** Pull ~240 chars of context around the first match so the model can see why
 *  an entry matched without reading the whole document. */
function researchSnippet(text: string, q: string): string {
  const idx = text.toLowerCase().indexOf(q);
  if (idx < 0) return '';
  const start = Math.max(0, idx - 120);
  const end = Math.min(text.length, idx + q.length + 120);
  return (
    (start > 0 ? '…' : '') +
    text.slice(start, end).replace(/\s+/g, ' ').trim() +
    (end < text.length ? '…' : '')
  );
}

async function toolListResearch(input: {
  domain?: ResearchDomain;
  limit?: number;
}): Promise<unknown> {
  const qs = input.domain ? `?domain=${input.domain}` : '';
  const { status, data } = await invokeRoute(handleResearchRoutes, 'GET', `/api/research${qs}`);
  if (status !== 200) return { error: data, status };
  const entries = (data as { entries?: ResearchEntry[] }).entries ?? [];
  const limit = Math.max(1, Math.min(input.limit ?? 30, 100));
  return {
    domain: input.domain ?? 'all',
    totalFound: entries.length,
    truncated: entries.length > limit,
    entries: entries.slice(0, limit).map(summarizeResearchEntry),
  };
}

async function toolSearchResearch(input: {
  query: string;
  domain?: ResearchDomain;
  limit?: number;
}): Promise<unknown> {
  const q = input.query.trim().toLowerCase();
  if (q.length < 2) return { error: 'query must be at least 2 characters' };
  // Tokenize: a multi-word query is matched as AND-of-terms, each found anywhere
  // in metadata OR content — NOT as one contiguous substring. Matching the whole
  // phrase literally meant "gold silver metals" found nothing even though every
  // term appears (just not adjacent). A quoted query keeps phrase semantics.
  const phrase = /^".+"$/.test(input.query.trim());
  const terms = phrase ? [q.slice(1, -1)] : q.split(/\s+/).filter((t) => t.length >= 2);
  if (!terms.length) return { error: 'query must contain a term of at least 2 characters' };
  const { status, data } = await invokeRoute(handleResearchRoutes, 'GET', '/api/research');
  if (status !== 200) return { error: data, status };
  let entries = (data as { entries?: ResearchEntry[] }).entries ?? [];
  if (input.domain) entries = entries.filter((e) => e.domain === input.domain);
  const limit = Math.max(1, Math.min(input.limit ?? 20, 50));
  const hits: Array<Record<string, unknown>> = [];
  for (const e of entries) {
    if (hits.length >= limit) break;
    const meta = [
      e.title,
      e.author,
      e.publisher,
      e.notes,
      e.sourceUrl,
      ...(e.tags ?? []),
      ...(e.tickers ?? []),
    ]
      .filter((v): v is string => typeof v === 'string')
      .join('\n')
      .toLowerCase();
    const text = typeof e.text === 'string' ? e.text : '';
    const textLower = text.toLowerCase();
    // AND semantics: every term must appear somewhere (metadata or content).
    if (!terms.every((t) => meta.includes(t) || textLower.includes(t))) continue;
    // Anchor the snippet on a term that's actually in the body; if all matched
    // terms live only in metadata, label it a metadata hit.
    const contentTerm = terms.find((t) => textLower.includes(t));
    const matchedIn: 'metadata' | 'content' = contentTerm ? 'content' : 'metadata';
    const snippet = contentTerm ? researchSnippet(text, contentTerm) : null;
    hits.push({
      id: e.id,
      domain: e.domain,
      title: e.title ?? e.filename ?? null,
      sourceUrl: e.sourceUrl ?? null,
      reportDate: e.reportDate ?? null,
      tickers: e.tickers ?? [],
      matchedIn,
      snippet,
    });
  }
  return { query: input.query, totalHits: hits.length, hits };
}

async function toolReadResearch(input: { id: string }): Promise<unknown> {
  const { status, data } = await invokeRoute(
    handleResearchRoutes,
    'GET',
    `/api/research/${encodeURIComponent(input.id)}`
  );
  if (status !== 200) return { error: data, status };
  const entry = (data as { entry?: ResearchEntry }).entry;
  if (!entry) return { error: `No research entry "${input.id}". Call list_research first.` };
  const text = typeof entry.text === 'string' ? entry.text : null;
  const truncated = text !== null && text.length > MAX_PARSED_TEXT_CHARS;
  return {
    id: entry.id,
    domain: entry.domain,
    title: entry.title ?? entry.filename ?? null,
    author: entry.author ?? null,
    publisher: entry.publisher ?? null,
    reportDate: entry.reportDate ?? null,
    sourceUrl: entry.sourceUrl ?? null,
    mediaType: entry.mediaType,
    pageCount: entry.pageCount ?? null,
    tickers: entry.tickers ?? [],
    tags: entry.tags ?? [],
    notes: entry.notes ?? null,
    intelligence: entry.intelligence ?? null,
    textTruncated: truncated,
    text: text === null ? null : truncated ? text.slice(0, MAX_PARSED_TEXT_CHARS) : text,
  };
}

// -- Deep Research (async, cited web-research runs) --------------------------

async function toolListDeepResearch(): Promise<unknown> {
  const runs = await listRuns();
  return { totalFound: runs.length, runs };
}

async function toolReadDeepResearch(input: { id: string }): Promise<unknown> {
  const run = await getRun(input.id);
  if (!run) return { error: `No deep research run "${input.id}". Call list_deep_research first.` };
  const report = typeof run.report === 'string' ? run.report : null;
  const truncated = report !== null && report.length > MAX_REPORT_CHARS;
  return {
    id: run.id,
    question: run.question,
    status: run.status,
    createdAt: run.createdAt,
    completedAt: run.completedAt ?? null,
    searchCount: run.searchCount ?? null,
    sources: run.sources ?? [],
    error: run.error ?? null,
    reportTruncated: truncated,
    report: report === null ? null : truncated ? report.slice(0, MAX_REPORT_CHARS) : report,
  };
}

// -- Financial snapshot (full money picture for a tax year) ------------------
// Returns the same markdown the financial-snapshot skill consumes: net worth,
// crypto, brokerage, real estate, liabilities, retirement, bank — far beyond
// get_tax_summary's income/expense-by-category view.

async function toolGetFinancialSnapshot(input: { year: number }): Promise<unknown> {
  const { status, data } = await invokeRoute(
    handleFinancialSnapshotRoutes,
    'GET',
    `/api/financial-snapshot/${input.year}?format=md`
  );
  if (status !== 200) return { error: data, status };
  return { year: input.year, markdown: typeof data === 'string' ? data : JSON.stringify(data) };
}

// -- Quant signals (consolidated daily market/macro snapshot) ----------------
// Reads the append-only daily snapshot log (populated by the quant scheduler),
// so one call yields the whole dashboard without fanning out across the ~30
// per-signal /api/quant/* endpoints.

async function toolGetQuantSignals(input: { days?: number }): Promise<unknown> {
  const days = Math.max(1, Math.min(input.days ?? 1, 90));
  const { status, data } = await invokeRoute(
    handleQuantRoutes,
    'GET',
    `/api/quant/snapshots?days=${days}`
  );
  if (status !== 200) return { error: data, status };
  const snapshots = (data as { snapshots?: unknown[] }).snapshots ?? [];
  if (snapshots.length === 0) {
    return {
      note: 'No quant snapshots recorded yet — the daily scheduler (or POST /api/quant/refresh) populates these. Live per-signal endpoints under /api/quant/* are also available.',
      latest: null,
    };
  }
  const latest = snapshots[snapshots.length - 1];
  return {
    asOf: (latest as { date?: string }).date ?? null,
    totalAll: (data as { totalAll?: number }).totalAll ?? snapshots.length,
    returned: snapshots.length,
    latest,
    // Only include the daily series when a window was requested (trend view).
    ...(days > 1 ? { history: snapshots } : {}),
  };
}

function jsonResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}

// --- Brain (long-term memory) tools ---------------------------------------
// The brain is a single user-owned markdown file (DATA_DIR/.docvault-brain.md)
// that is also injected whole into the system prompt. read_brain re-reads the
// current text (useful after a truncated injection or before proposing edits);
// remember appends one durable note.

async function toolReadBrain(): Promise<unknown> {
  const brain = await readBrain();
  return {
    content: brain.content,
    bytes: brain.bytes,
    updatedAt: brain.updatedAt,
    empty: !brain.content.trim(),
  };
}

async function toolRemember(input: { text: string; tag?: string }): Promise<unknown> {
  const text = (input.text ?? '').trim();
  if (!text) return { error: 'text is required and must be non-empty.' };
  try {
    const result = await appendBrainEntry(text, { tag: input.tag });
    return { ok: true, appended: result.appended, bytes: result.bytes };
  } catch (err) {
    return { error: (err as Error).message };
  }
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
        'list_external_sources',
        'List the configured External Sources — cloned git repos of markdown the user maintains (for example a personal knowledge or creative vault). Returns each source id, name, whether it has synced, and its markdown file count. Call this before searching or reading external files.',
        {},
        async () => jsonResult(await toolListExternalSources())
      ),
      tool(
        'search_external_sources',
        'Case-insensitive substring search across the markdown in every synced External Source — matches BOTH file paths and line content. Returns up to 50 hits, each tagged via:"path" (line 0) or via:"content". To browse structure without a search term, use list_external_source_files instead.',
        {
          query: z.string().describe('Substring to find; minimum 2 chars.'),
          sourceId: z
            .string()
            .optional()
            .describe('Restrict to one source id from list_external_sources.'),
        },
        async (args) => jsonResult(await toolSearchExternalSources(args))
      ),
      tool(
        'read_external_file',
        'Return the full markdown content of one file in an External Source. Use the sourceId and path from search_external_sources. Markdown only; content over 256KB is truncated.',
        {
          sourceId: z.string().describe('Source id from list_external_sources.'),
          path: z
            .string()
            .describe('File path relative to the repo root (the `path` field from a search hit).'),
        },
        async (args) => jsonResult(await toolReadExternalFile(args))
      ),
      tool(
        'list_external_source_files',
        'List markdown file paths in an External Source, optionally filtered to a folder prefix (e.g. "vault/05_PROJECTS/"). Use this to browse the structure of a source when you have no obvious search term, then read_external_file on a path. Returns up to 200 paths.',
        {
          sourceId: z.string().describe('Source id from list_external_sources.'),
          folder: z
            .string()
            .optional()
            .describe('Optional path prefix to filter to, e.g. "vault/05_PROJECTS/".'),
        },
        async (args) => jsonResult(await toolListExternalSourceFiles(args))
      ),
      tool(
        'read_brain',
        "Return the user's Brain — their long-term memory: a single markdown document of durable facts, preferences, decisions, and context they want remembered across every conversation. The Brain is ALREADY included in your system prompt, so call this only to get the exact current text before proposing an edit, or when the injected copy was truncated. READ-ONLY.",
        {},
        async () => jsonResult(await toolReadBrain())
      ),
      tool(
        'remember',
        "Append ONE durable note to the user's Brain (long-term memory) so it is recalled in every future chat. Use ONLY for things worth remembering long-term — a stable preference, a decision, an ongoing project, household/context facts. Do NOT use it for one-off task details, transient state, or anything the app's own data already stores (balances, document contents, lab values). WRITE TOOL: state the exact text you will save and get the user's confirmation first. Keep each note to one short sentence.",
        {
          text: z
            .string()
            .describe(
              'The single durable fact/preference/decision to remember. One short sentence.'
            ),
          tag: z
            .string()
            .optional()
            .describe('Optional one-word category, e.g. "preference", "decision", "project".'),
        },
        async (args) => jsonResult(await toolRemember(args))
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
        'get_prediction_markets',
        'Live prediction-market odds (Kalshi + Polymarket) on finance and political questions — Fed decisions, recession, crypto, elections, control of Congress, geopolitics. Each row is one event showing the current favorite, its probability (0–100), 24h move, $ volume, and a link. Use this when the user asks what the markets/odds think about an event, the implied probability of something, or current market sentiment. READ-ONLY.',
        {
          domain: z
            .enum(['finance', 'politics'])
            .optional()
            .describe('Restrict to one bucket. Omit for both.'),
          query: z
            .string()
            .optional()
            .describe('Case-insensitive substring to filter questions/topics, e.g. "fed", "iran".'),
          limit: z.number().optional().describe('Max rows per bucket (default 20, max 50).'),
        },
        async (args) => jsonResult(await toolGetPredictionMarkets(args))
      ),
      tool(
        'list_research',
        `List the user's filed Research entries — PDFs, pasted articles/transcripts, and YouTube videos they've saved (including auto-filed feeds like ZeroHedge and local news). Each row shows title, source, date, domain (${RESEARCH_DOMAINS.join('/')}), any tickers, and whether claim "intelligence" has been extracted. Optionally filter by domain. Use this to see what research exists before reading or searching it.`,
        {
          domain: z
            .enum(RESEARCH_DOMAINS)
            .optional()
            .describe('Restrict to one Research tab. Omit for all.'),
          limit: z.number().optional().describe('Max entries (default 30, max 100). Newest first.'),
        },
        async (args) => jsonResult(await toolListResearch(args))
      ),
      tool(
        'search_research',
        'Case-insensitive substring search across the Research library — matches BOTH metadata (title, author, publisher, notes, tickers, tags, source URL) and the full extracted text of every entry. Returns hits with a short snippet around the match. Prefer this over list_research when the user asks about a topic, person, or ticker mentioned inside their saved articles/transcripts.',
        {
          query: z.string().describe('Substring to find; minimum 2 chars.'),
          domain: z
            .enum(RESEARCH_DOMAINS)
            .optional()
            .describe('Restrict to one Research tab. Omit for all.'),
          limit: z.number().optional().describe('Max hits (default 20, max 50).'),
        },
        async (args) => jsonResult(await toolSearchResearch(args))
      ),
      tool(
        'read_research',
        'Return one Research entry in full — metadata, the extracted text (transcript / article / PDF text, truncated if very long), and any extracted intelligence (summary bullets + source-grounded claims with tickers, topics, and stance). Use the id from list_research or search_research. READ-ONLY.',
        {
          id: z.string().describe('Research entry id (from list_research / search_research).'),
        },
        async (args) => jsonResult(await toolReadResearch(args))
      ),
      tool(
        'list_deep_research',
        'List the Deep Research runs — async, multi-source, cited web-research reports the user has commissioned. Each shows the question, status (running / done / error), number of sources, and timestamps. Use this to find a completed report to read.',
        {},
        async () => jsonResult(await toolListDeepResearch())
      ),
      tool(
        'read_deep_research',
        "Return one Deep Research run by id — its question, status, the full cited report (markdown, truncated only if pathologically long), and the list of sources. Use the report's findings to answer the user, and cite its sources. READ-ONLY.",
        {
          id: z.string().describe('Deep research run id (from list_deep_research).'),
        },
        async (args) => jsonResult(await toolReadDeepResearch(args))
      ),
      tool(
        'get_financial_snapshot',
        "The user's FULL financial picture for a tax year, rendered as markdown — net worth, crypto balances, brokerage holdings, real estate equity, liabilities, retirement contributions, bank accounts, and tax summary. Use this for 'what's my net worth', 'how much crypto do I hold', balance-sheet, or deduction questions. This is far broader than get_tax_summary (which is only income/expense by category). READ-ONLY; may take a moment if live prices need refreshing.",
        {
          year: z.number().describe('Tax year, e.g. 2025.'),
        },
        async (args) => jsonResult(await toolGetFinancialSnapshot(args))
      ),
      tool(
        'get_quant_signals',
        'The consolidated daily quant/market snapshot — BTC risk & drawdown, crypto Fear & Greed, BTC/ETH dominance, the ETH/BTC flippening progress, hash-ribbon regime, the yield-curve regime, business-cycle/recession signals, and inflation. One call returns the whole dashboard. Use it when the user asks about overall market conditions, crypto risk, macro regime, or "what are the signals saying". For live odds on specific events use get_prediction_markets instead. READ-ONLY.',
        {
          days: z
            .number()
            .optional()
            .describe(
              'Days of daily history to include for trend (default 1 = latest only, max 90).'
            ),
        },
        async (args) => jsonResult(await toolGetQuantSignals(args))
      ),
      tool(
        'get_daily_news',
        "The user's synthesized newspaper editions (the Newsstand) — each weaves together that day's/week's markets, politics, local news, personal finance, tax/retirement, health, and filed research into one narrative, ending with an Action Items section. Call with no id to list recent editions; call with an id to read that edition's full body. Use it for 'what's the latest', a macro overview, or to ground a strategy in the already-synthesized picture. READ-ONLY.",
        {
          id: z
            .string()
            .optional()
            .describe('Edition id (from a no-id call) to read its full body. Omit to list recent.'),
          limit: z
            .number()
            .optional()
            .describe('Max editions to list (default 10, max 30). Newest first.'),
        },
        async (args) => jsonResult(await toolGetDailyNews(args))
      ),
      tool(
        'get_congress_trades',
        'Recent congressional stock/option trades (public STOCK Act disclosures) — politician, chamber, party, buy/sell, ticker, dollar range, and trade/filing dates. These are PUBLIC disclosures by members of Congress, NOT the user\'s own holdings. Use it for "what are politicians buying", insider/consensus signals, or to factor disclosed trades into market analysis. Optional filters mirror the Politics → Trades view. READ-ONLY.',
        {
          politician: z.string().optional().describe('Filter by politician name substring.'),
          ticker: z.string().optional().describe('Filter by ticker, e.g. "NVDA".'),
          chamber: z.string().optional().describe('"house" or "senate".'),
          category: z.string().optional().describe('Trade category, e.g. "buy" or "sell".'),
          limit: z.number().optional().describe('Max trades (default 40, max 200). Newest first.'),
        },
        async (args) => jsonResult(await toolGetCongressTrades(args))
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
      // -- Health: reads ----------------------------------------------------
      tool(
        'list_health_people',
        'List every configured person in DocVault Health (id, name, archived flag). The chat is multi-person — ALWAYS call this first to learn whose health data is available, and ask the user whose health they mean before calling any health tool.',
        {},
        async () => jsonResult(await toolListHealthPeople())
      ),
      tool(
        'get_health_snapshot',
        "Fetch the consolidated health snapshot (Apple Health activity/heart/sleep/body, clinical labs, DNA traits if enabled, current supplement regimen, recent sicknesses, illness periods) for one person, rendered as markdown. Use this BEFORE making any health recommendation so the advice is grounded in the user's actual data.",
        {
          personId: z.string().describe('Person id from list_health_people.'),
          includeClinical: z
            .boolean()
            .optional()
            .describe('Include FHIR clinical summary (labs, conditions, meds). Default true.'),
          includeDNA: z.boolean().optional().describe('Include DNA trait results. Default true.'),
        },
        async (args) => jsonResult(await toolGetHealthSnapshot(args))
      ),
      tool(
        'list_supplements',
        "List the user's supplement regimen for a person, optionally filtered by status (active = currently taking, considering = on the shortlist, past = stopped, never = considered + rejected). Returns a trimmed summary per entry; call get_supplement for the full parsed label, research notes, or citations.",
        {
          personId: z.string(),
          status: z.enum(['considering', 'active', 'past', 'never']).optional(),
        },
        async (args) => jsonResult(await toolListSupplements(args))
      ),
      tool(
        'get_supplement',
        'Return the full NutritionEntry for one supplement — parsed label fields, dose, user notes, research prose, citations. Use when the user asks "what dose am I on" / "what brand of X" / before recommending a switch.',
        {
          personId: z.string(),
          id: z.string().describe('Supplement entry id (from list_supplements).'),
        },
        async (args) => jsonResult(await toolGetSupplement(args))
      ),
      // -- Health: writes (require user confirmation per system prompt) ----
      tool(
        'create_supplement',
        'Create a new supplement entry from text (no label image required). Status defaults to "considering" so chat recommendations never silently join the active stack. WRITE TOOL — confirm with the user before invoking.',
        {
          personId: z.string(),
          brandName: z.string().describe('e.g. "Thorne", "Klean Athlete", "Bulk Supplements".'),
          productName: z
            .string()
            .describe('e.g. "Creatine Monohydrate", "Magnesium Bisglycinate".'),
          category: z.string().optional().describe('Free-form category bucket from the parser.'),
          dose: z
            .object({
              amount: z.number().optional(),
              unit: z.string().optional(),
              frequency: z
                .enum(['daily', 'twice-daily', 'as-needed', 'weekly', 'custom'])
                .optional(),
              frequencyCustom: z.string().optional(),
              timeOfDay: z
                .enum(['morning', 'midday', 'evening', 'bedtime', 'pre-workout', 'post-workout'])
                .optional(),
            })
            .optional(),
          notes: z.string().optional(),
          research: z
            .string()
            .optional()
            .describe('Markdown prose summarizing the evidence supporting this choice.'),
          citations: z
            .array(
              z.object({
                id: z.string(),
                pmid: z.string().optional(),
                doi: z.string().optional(),
                authors: z.string(),
                year: z.number(),
                title: z.string(),
                journal: z.string(),
                findings: z.string().optional(),
                url: z.string().optional(),
              })
            )
            .optional(),
          status: z.enum(['considering', 'active', 'past', 'never']).optional(),
        },
        async (args) => jsonResult(await toolCreateSupplement(args))
      ),
      tool(
        'update_supplement',
        'Patch an existing supplement entry — change status, dose, notes, research, or citations. Common uses: record web research onto a "considering" entry, mark a brand "active" once the user starts taking it, append findings. WRITE TOOL — confirm before invoking.',
        {
          personId: z.string(),
          id: z.string(),
          status: z.enum(['considering', 'active', 'past', 'never']).optional(),
          dose: z
            .object({
              amount: z.number().optional(),
              unit: z.string().optional(),
              frequency: z
                .enum(['daily', 'twice-daily', 'as-needed', 'weekly', 'custom'])
                .optional(),
              frequencyCustom: z.string().optional(),
              timeOfDay: z
                .enum(['morning', 'midday', 'evening', 'bedtime', 'pre-workout', 'post-workout'])
                .optional(),
            })
            .nullable()
            .optional(),
          notes: z.string().nullable().optional(),
          research: z.string().nullable().optional(),
          citations: z
            .array(
              z.object({
                id: z.string(),
                pmid: z.string().optional(),
                doi: z.string().optional(),
                authors: z.string(),
                year: z.number(),
                title: z.string(),
                journal: z.string(),
                findings: z.string().optional(),
                url: z.string().optional(),
              })
            )
            .nullable()
            .optional(),
        },
        async (args) => jsonResult(await toolUpdateSupplement(args))
      ),
      tool(
        'delete_supplement',
        'Delete a supplement entry (and its label image if one exists). DESTRUCTIVE WRITE TOOL — always state which entry and confirm before invoking. Prefer setting status to "past" if the user might want the history.',
        {
          personId: z.string(),
          id: z.string(),
        },
        async (args) => jsonResult(await toolDeleteSupplement(args))
      ),
      tool(
        'log_sickness',
        'Record an illness episode (cold, flu, allergies, migraine, …) with symptoms, severity, and any medications taken. Pairs with auto-detected illness periods from Apple Health to build a long-term picture. WRITE TOOL — confirm before invoking.',
        {
          personId: z.string(),
          title: z.string().describe('Short label, e.g. "Spring sinus congestion".'),
          startDate: z.string().describe('YYYY-MM-DD'),
          endDate: z
            .string()
            .optional()
            .describe('YYYY-MM-DD (inclusive). Omit while still active.'),
          category: z
            .enum([
              'cold',
              'flu',
              'covid',
              'allergies',
              'sinus',
              'stomach',
              'injury',
              'migraine',
              'other',
            ])
            .optional(),
          severity: z.enum(['mild', 'moderate', 'severe']).optional(),
          symptoms: z.array(z.string()).optional(),
          medications: z
            .array(
              z.object({
                name: z.string(),
                doseText: z.string().optional(),
                count: z.number().optional(),
                notes: z.string().optional(),
              })
            )
            .optional(),
          notes: z.string().optional(),
        },
        async (args) => jsonResult(await toolLogSickness(args))
      ),
    ],
  });
}

// ---------------------------------------------------------------------------
// System prompt — the LAST user message is sent as the SDK's `prompt`, so
// prior conversation lives here as static context. Cheap because the SDK
// caches the system prompt across turns.
// ---------------------------------------------------------------------------

// The brain (long-term memory) is injected whole. Cap the injected copy so a
// runaway brain can't blow the context budget; the model can still pull the
// full text on demand via read_brain.
const MAX_BRAIN_INJECT = 8000;

function brainSection(brainContent: string): string {
  const brain = brainContent.trim();
  if (!brain) {
    return 'The user has not saved anything to their Brain (long-term memory) yet. When they share a durable fact, preference, or decision worth recalling in future chats, offer to save it with the remember tool.';
  }
  const body =
    brain.length > MAX_BRAIN_INJECT
      ? `${brain.slice(0, MAX_BRAIN_INJECT)}\n…(truncated — call read_brain for the full text)`
      : brain;
  return [
    'LONG-TERM MEMORY — the user\'s "Brain". Durable facts, preferences, and decisions the user has saved for you to remember across every conversation. Treat them as established, already-confirmed context and weave them into your answers without being asked or re-confirming. The user maintains this in Settings → Brain; you may add to it with the remember tool.',
    '<brain>',
    body,
    '</brain>',
  ].join('\n');
}

function buildSystemPrompt(activeEntity: string | undefined, brainContent = ''): string {
  const today = new Date().toISOString().slice(0, 10);
  return [
    `You are the DocVault chat assistant — answering questions about the user's tax documents, financial records, personal files, AND DocVault Health data (Apple Health, clinical labs, DNA, current supplement regimen, sickness log). Today is ${today}.`,
    activeEntity
      ? `The user currently has entity "${activeEntity}" selected in the UI; prefer it when entity context is ambiguous, but call list_entities if they ask about something different.`
      : 'No entity is currently selected in the UI.',
    brainSection(brainContent),
    'DocVault Health is multi-person — the user, their partner, and any children each have their own person record. ALWAYS call list_health_people first when a health question comes in, and if the user did not specify whose health they mean, ASK before calling any health tool. Default to the user themselves only when there is exactly one non-archived person.',
    "When making a supplement, dosing, or regimen recommendation, ground it in the user's actual data: call get_health_snapshot for the relevant person FIRST, then call list_supplements to see what they're already taking, and only after that synthesize advice. Cross-reference against any labs (kidney/liver function, electrolytes) before recommending dosage.",
    'WebSearch is enabled. Use it to research products, brands, dosages, and primary literature (PubMed, journal articles) when the user asks for a recommendation or a comparison. Cite sources. Prefer primary literature over marketing pages.',
    'get_prediction_markets returns live Kalshi + Polymarket odds on finance and political questions (Fed, recession, crypto, elections, control of Congress, geopolitics). Use it when the user asks what the markets/odds imply about an event or current market sentiment — quote the probability, source, and link, and frame them as real-money-weighted forecasts, not certainties. READ-ONLY, free to chain.',
    'The user maintains a Research library — saved PDFs, pasted articles/transcripts, and YouTube videos (some auto-filed from feeds like ZeroHedge), each tagged finance/health/politics and often carrying extracted claims. For questions about what an article/analyst/video said, or what the user has been reading on a topic or ticker: use search_research (substring over metadata AND full text), list_research to browse, and read_research for the full text + extracted claims. Cite the entry title and id. READ-ONLY, free to chain.',
    'Deep Research runs are async, cited web-research reports the user commissioned: list_deep_research to find them, read_deep_research to read a completed report. When a question matches an existing report, ground your answer in it and pass through its citations.',
    "get_financial_snapshot is the user's FULL money picture for a year (net worth, crypto, brokerage, real estate, liabilities, retirement, bank). Use it for balance-sheet / net-worth / holdings questions — get_tax_summary only covers income and expenses by category, so reach for the snapshot when the question is about wealth or balances rather than taxable income.",
    'get_quant_signals returns the consolidated daily market/macro snapshot (BTC risk & drawdown, Fear & Greed, dominance, yield-curve regime, business-cycle/recession signals, inflation). Use it for "what do the signals say" / overall market-condition questions; use get_prediction_markets for odds on a specific named event.',
    'get_daily_news lists/returns the synthesized Newsstand editions (markets+politics+finance+tax+health+research woven into one narrative with Action Items). No id lists recent editions; an id returns that edition\'s full body. Use it for "what\'s the latest" or to ground analysis in the already-synthesized macro picture.',
    'get_congress_trades returns recent congressional stock/option disclosures (politician, chamber, party, buy/sell, ticker, $ range, dates) — PUBLIC STOCK Act filings, NOT the user\'s holdings. Use it for "what are politicians buying" or insider/consensus signals; optional politician/ticker/chamber/category filters.',
    'The user may have configured External Sources — cloned git repos of their own markdown (for example a personal knowledge or creative vault). For questions about their notes, projects, writing, or anything outside the tax, financial, and health data: call list_external_sources, then either search_external_sources (substring over BOTH file paths and content) or list_external_source_files (browse the tree or a folder when you have no obvious search term), then read_external_file for the full text. These are READ-ONLY and free to chain. Cite the source name and file path when you quote them.',
    'Use the provided tools to answer factually. Never invent file names, vendors, amounts, dates, lab values, supplement brands, or citations. If a file has not been parsed yet or a supplement is not in the regimen, say so — do not guess.',
    'Be concise. Use markdown tables for structured data. When citing a specific document, include its path so the user can find it.',
    [
      "WRITE TOOLS — these make persistent changes to the user's data:",
      '  remember, set_metadata, add_reminder, create_supplement, update_supplement, delete_supplement, log_sickness',
      'ALWAYS state what you are about to write (which entry, which fields, what values) and wait for explicit user confirmation BEFORE invoking any of them. Read tools can be chained freely without asking.',
      "remember saves ONE durable note to the user's Brain (long-term memory, shown above). Use it sparingly — only for stable preferences, decisions, or context worth recalling in every future chat, never for one-off task details or anything the app already stores. Show the exact text and confirm before saving.",
      'delete_supplement is destructive — prefer update_supplement with status:"past" if the user might want the history back.',
      'create_supplement defaults to status:"considering" — that is intentional so research-grounded suggestions never silently join the active stack.',
    ].join('\n'),
  ].join('\n\n');
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

interface IncomingChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ---------------------------------------------------------------------------
// Attachments — /api/chat/attachments
// ---------------------------------------------------------------------------

// Inline-upload attachment shape, mirrors t3code's UploadChatImageAttachment
// schema (with PDF added). dataUrl is `data:<mime>;base64,<bytes>`.
interface IncomingAttachment {
  name: string;
  mimeType: string;
  dataUrl: string;
}

function attachmentDirFor(chatId: string): string {
  return path.join(CHAT_ATTACHMENTS_DIR, chatId);
}

// Validate an incoming attachment, write it to disk under the chat dir, and
// return the Anthropic content block that should be included in the user
// message. Returns { error } on validation failure so we can short-circuit
// the whole turn (keeps the model from being asked about an attachment we
// silently dropped). Mirrors t3code's normalizer flow:
//   parseBase64DataUrl → size/mime check → createAttachmentId → writeFile.
async function persistAttachment(
  chatId: string,
  attachment: IncomingAttachment
): Promise<{ block: Record<string, unknown> } | { error: string }> {
  if (typeof attachment.dataUrl !== 'string' || attachment.dataUrl.length === 0) {
    return { error: `Attachment "${attachment.name}" missing dataUrl` };
  }
  const parsed = parseBase64DataUrl(attachment.dataUrl);
  if (!parsed) {
    return { error: `Attachment "${attachment.name}" has invalid data URL` };
  }
  const mimeType = parsed.mimeType;
  const isImage = SUPPORTED_IMAGE_MIME_TYPES.has(mimeType);
  const isDoc = SUPPORTED_DOCUMENT_MIME_TYPES.has(mimeType);
  if (!isImage && !isDoc) {
    return {
      error: `Unsupported mime "${mimeType}" for "${attachment.name}". Allowed: image/* (PNG/JPG/GIF/WebP) or application/pdf.`,
    };
  }
  const bytes = Buffer.from(parsed.base64, 'base64');
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    return {
      error: `Attachment "${attachment.name}" is empty or exceeds ${MAX_ATTACHMENT_BYTES} bytes`,
    };
  }

  // Persist with a t3code-style scoped id: `<chat-segment>-<uuid>` so the
  // file is recognizably part of this chat even if listed alongside other
  // chats' uploads. Keep the chat-segment short and url-safe.
  const chatSegment = chatId
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 12)
    .toLowerCase();
  const id = `${chatSegment}-${randomUUID()}`;
  const ext = extensionFor(mimeType);
  await ensureDir(attachmentDirFor(chatId));
  const target = path.join(attachmentDirFor(chatId), `${id}${ext}`);
  await fs.writeFile(target, bytes);

  const block: Record<string, unknown> = isImage
    ? { type: 'image', source: { type: 'base64', media_type: mimeType, data: parsed.base64 } }
    : { type: 'document', source: { type: 'base64', media_type: mimeType, data: parsed.base64 } };
  return { block };
}

// Build the SDK prompt input. With no attachments, the SDK accepts a plain
// string. With attachments, switch to the AsyncIterable<SDKUserMessage>
// form so the user message can carry rich content blocks.
async function buildUserMessageContent(
  text: string,
  chatId: string | undefined,
  attachments: IncomingAttachment[]
): Promise<string | AsyncIterable<SDKUserMessage> | { error: string }> {
  if (attachments.length === 0 || !chatId) return text;

  const blocks: Array<Record<string, unknown>> = [];
  if (text.length > 0) blocks.push({ type: 'text', text });
  for (const attachment of attachments) {
    const result = await persistAttachment(chatId, attachment);
    if ('error' in result) return { error: result.error };
    blocks.push(result.block);
  }
  if (blocks.length === 0) return text;

  return (async function* () {
    // The SDK's declared SDKUserMessage requires parent_tool_use_id, but the
    // runtime accepts messages without it — cast rather than alter the payload.
    yield {
      type: 'user' as const,
      message: { role: 'user' as const, content: blocks },
    } as unknown as SDKUserMessage;
  })();
}

// ---------------------------------------------------------------------------
// Route handler — streams SSE
// ---------------------------------------------------------------------------

export async function handleChatRoutes(
  req: Request,
  _url: URL,
  pathname: string
): Promise<Response | null> {
  // Thread history persistence — the client hydrates on boot and PUTs the
  // whole pruned ThreadsState blob (see src/contexts/chatPersistence.ts).
  if (pathname === '/api/chat/threads') {
    if (req.method === 'GET') {
      return jsonResponse(await loadChatThreads());
    }
    if (req.method === 'PUT') {
      const body = await readJsonBody<unknown>(req);
      if (!isChatThreadsState(body)) {
        return jsonResponse({ error: 'Invalid chat threads state shape' }, 400);
      }
      await saveChatThreads(body);
      return jsonResponse({ ok: true });
    }
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  if (pathname !== '/api/chat') return null;
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  let body: {
    messages?: IncomingChatMessage[];
    entity?: string;
    chatId?: string;
    resumeSessionId?: string;
    attachments?: IncomingAttachment[];
  };
  try {
    body = await readJsonBody<typeof body>(req);
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

  // Validate IDs up-front so malformed values don't surprise the SDK with a
  // NotFound error mid-stream.
  const chatId = body.chatId && isUuid(body.chatId) ? body.chatId : undefined;
  const resumeSessionId =
    body.resumeSessionId && isUuid(body.resumeSessionId) ? body.resumeSessionId : undefined;
  const attachments: IncomingAttachment[] = Array.isArray(body.attachments)
    ? body.attachments.filter(
        (a): a is IncomingAttachment =>
          a !== null &&
          typeof a === 'object' &&
          typeof (a as IncomingAttachment).name === 'string' &&
          typeof (a as IncomingAttachment).mimeType === 'string' &&
          typeof (a as IncomingAttachment).dataUrl === 'string'
      )
    : [];
  if (attachments.length > 0 && !chatId) {
    return jsonResponse(
      {
        error:
          'chatId is required when sending attachments (mint client-side with crypto.randomUUID())',
      },
      400
    );
  }

  // Chat mode: 'agent' (Claude Code / Codex on the subscription) or 'api'
  // (direct Anthropic Messages API via Claude Code with the API key — bills
  // credits). Codex is a subscription agent, so it only applies in agent mode.
  const chatMode = await getChatMode();

  // Codex backend — diverges entirely from the Claude path here. Codex brings
  // its own auth (codex login) and native tools, so we skip the Anthropic
  // credential / in-process-MCP setup below and stream from codex instead.
  if (chatMode === 'agent' && (await getChatBackend()) === 'codex') {
    return streamCodexChat({
      userText: last.content,
      entity: body.entity,
      resumeSessionId: body.resumeSessionId,
      attachments,
      signal: req.signal,
    });
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

  const model = chatMode === 'api' ? await getChatApiModel() : await getClaudeModel();
  const effort = toClaudeAgentEffort(await getClaudeChatEffort());
  // User-authored skills (DATA_DIR/skills) ride along as a local plugin —
  // null when none exist, in which case the plugins/skills options are
  // omitted entirely and chat behaves exactly as before.
  const skillsPlugin = await ensureSkillsPluginDir();
  const config = await loadConfig();
  const ctx: ToolContext = { config };
  // When resuming, the SDK already has the full conversation in its session
  // JSONL — no need to fold prior turns into the system prompt. For brand-new
  // sessions, history is empty anyway (this is the first turn), so dropping
  // the fold is a no-op there too.
  const skillsNote = skillsPlugin
    ? `\n\nInstalled skills: ${skillsPlugin.skillNames.map((n) => `$${n}`).join(', ')}. A $name token in a user message refers to that skill — invoke the matching Skill tool when one is mentioned or clearly relevant.`
    : '';
  const systemPrompt = buildSystemPrompt(body.entity, await readBrainContent()) + skillsNote;
  const mcpServer = buildDocVaultMcpServer(ctx);

  // If attachments came in this turn, we switch from the simple
  // `prompt: string` form to the iterable form so the user message can
  // carry image / document blocks. persistAttachment writes each upload
  // to disk under <chatId>/ and returns the matching content block.
  const userMessageResult = await buildUserMessageContent(last.content, chatId, attachments);
  if (
    typeof userMessageResult === 'object' &&
    userMessageResult !== null &&
    'error' in userMessageResult
  ) {
    return jsonResponse({ error: userMessageResult.error }, 400);
  }
  const userMessageContent = userMessageResult;

  // Credential selection follows the chat MODE. Claude Code bills API credits
  // whenever ANTHROPIC_API_KEY is in the env (even alongside an OAuth token), so
  // whichever credential we DON'T want must be deleted — it can also be
  // inherited from process.env, not just added here.
  //   • agent mode → prefer the SUBSCRIPTION (OAuth token); API key is fallback.
  //   • api mode   → force the API KEY (billed); OAuth token is fallback.
  const subprocessEnv: Record<string, string | undefined> = { ...process.env };
  const preferApi = chatMode === 'api';
  const usingSub = preferApi ? !apiKey && !!oauthToken : !!oauthToken;
  if (usingSub) {
    subprocessEnv.CLAUDE_CODE_OAUTH_TOKEN = oauthToken;
    delete subprocessEnv.ANTHROPIC_API_KEY;
  } else {
    subprocessEnv.ANTHROPIC_API_KEY = apiKey;
    delete subprocessEnv.CLAUDE_CODE_OAUTH_TOKEN;
  }
  log.info(
    `[ai-billing] chat (${chatMode}) → Claude ${usingSub ? 'SUBSCRIPTION (Claude.ai OAuth token)' : 'API KEY (billed credits)'} · model=${model}`
  );

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

      // Heartbeat — a long agentic turn can sit silent for many seconds while
      // the model thinks between tool calls. With no bytes on the wire, an idle
      // proxy/NAT (notably over a VPN tunnel) drops the SSE connection and the
      // client surfaces a stream read error mid-run. A periodic SSE comment
      // (no `data:` line, so clients ignore it) keeps the connection warm.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': hb\n\n'));
        } catch {
          /* stream already closed */
        }
      }, 15000);

      // Tell the client which model + billing path this turn uses, so the chat
      // window can show it (e.g. "opus-4-8 · Subscription") instead of leaving
      // the user guessing whether they're spending credits.
      send({
        type: 'meta',
        model,
        billing: usingSub ? 'subscription' : 'api',
        backend: 'claude',
      });

      // Track the session_id once we see it on the first SDK message so we
      // can echo it back to the client. The SDK stamps every message with
      // this value, but we only need to send it once per turn.
      let emittedSession = false;

      // Cancellation support — when the client closes the SSE connection
      // (Stop button, navigation, network drop), we break out of the
      // for-await loop. The SDK then tears down the bundled Claude Code
      // subprocess so we stop spending tokens on a response nobody's
      // watching.
      let aborted = req.signal.aborted;
      const onAbort = () => {
        aborted = true;
      };
      req.signal.addEventListener('abort', onAbort);

      try {
        for await (const message of query({
          prompt: userMessageContent,
          options: {
            model,
            // Layer our DocVault-specific instructions on top of Claude
            // Code's preset prompt — matches t3code's pattern. The model
            // will sometimes try a tool we've disallowed (TodoWrite,
            // Bash, etc.); canUseTool denies those and the model
            // self-corrects to our MCP tools. Trade-off: minor "tried
            // unavailable tool" noise vs richer baseline tool-use
            // behavior from the preset.
            systemPrompt: { type: 'preset', preset: 'claude_code', append: systemPrompt },
            ...(resumeSessionId ? { resume: resumeSessionId } : {}),
            // Reasoning effort from Settings → Models (unset = model default).
            ...(effort ? { effort } : {}),
            // Skills load through the plugin mechanism; `skills: 'all'`
            // enables every skill the plugin ships (named docvault:<name>).
            ...(skillsPlugin
              ? {
                  plugins: [{ type: 'local' as const, path: skillsPlugin.path }],
                  skills: 'all' as const,
                }
              : {}),
            // Disable every built-in Claude Code tool — the chat must NOT
            // be able to Bash/Read/Edit files on the NAS. Only DocVault's
            // MCP tools below should be reachable.
            allowedTools: ALLOWED_TOOLS,
            // WebSearch is intentionally absent — it's in ALLOWED_BUILTIN_TOOLS
            // so the chat can research supplement brands, lab interpretations,
            // and tax-rule changes while reasoning about the user's data.
            // WebFetch stays denied: the model would have to construct URLs
            // and we don't want it pulling arbitrary user-supplied URLs.
            disallowedTools: [
              'Bash',
              'Read',
              'Edit',
              'Write',
              'Glob',
              'Grep',
              'WebFetch',
              'NotebookEdit',
            ],
            mcpServers: { [MCP_SERVER_NAME]: mcpServer },
            // Defense-in-depth: even if a built-in tool slips past
            // disallowedTools, this callback denies anything not in our
            // explicit allow-list. Pass `toolInput` straight through to
            // `updatedInput` — the SDK uses this as the FINAL input to the
            // tool, so returning `{}` would call our MCP tools with empty
            // arguments. T3code's pattern is the same (allow-list + pass
            // toolInput). Found via the t3code parity audit.
            canUseTool: async (toolName, toolInput) => {
              if (ALLOWED_TOOLS.includes(toolName)) {
                return { behavior: 'allow', updatedInput: toolInput };
              }
              return {
                behavior: 'deny',
                message: `Tool "${toolName}" is not allowed in DocVault chat.`,
                interrupt: false,
              };
            },
            env: subprocessEnv,
            cwd: '/tmp',
            // Token-level streaming. SDK emits SDKPartialAssistantMessage
            // events carrying raw Anthropic stream deltas (content_block_delta
            // with text_delta) so the UI can render character-by-character
            // instead of waiting for whole assistant turns.
            includePartialMessages: true,
            ...(CLAUDE_BINARY_PATH ? { pathToClaudeCodeExecutable: CLAUDE_BINARY_PATH } : {}),
          },
        })) {
          if (aborted) break;
          // Echo the SDK-assigned session id once per stream so the client
          // can persist it and pass it back as `sessionId` on the next turn
          // to keep Claude Code's conversation continuity.
          if (
            !emittedSession &&
            typeof (message as { session_id?: unknown }).session_id === 'string'
          ) {
            const sid = (message as { session_id: string }).session_id;
            if (sid.length > 0) {
              send({ type: 'session', sessionId: sid });
              emittedSession = true;
            }
          }
          if (message.type === 'result') {
            // Forward usage + cost to the client so it can render a running
            // total at the bottom of the chat view. We log AND send here
            // (not in translateAndSend) so the cost is computed once.
            const usageInput = message.usage?.input_tokens ?? 0;
            const usageOutput = message.usage?.output_tokens ?? 0;
            const cost = message.total_cost_usd ?? null;
            send({
              type: 'done',
              stopReason: message.stop_reason ?? null,
              isError: message.is_error,
              usage: { inputTokens: usageInput, outputTokens: usageOutput },
              ...(typeof cost === 'number' ? { cost } : {}),
            });
            void logAiCall({
              model,
              purpose: 'chat',
              latencyMs: Date.now() - startedAt,
              usage: { inputTokens: usageInput, outputTokens: usageOutput },
              ok: !message.is_error,
              stopReason: message.stop_reason ?? null,
            });
          } else {
            translateAndSend(message, send);
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
        clearInterval(heartbeat);
        req.signal.removeEventListener('abort', onAbort);
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

// Codex backend path — a fully separate SSE stream from the Claude one. No
// Anthropic creds, no in-process MCP: codex uses its native tools over a
// read-only, secrets-excluded view of the data dir (server/llm/codex-chat.ts).
// Attachments aren't wired for codex yet (text-only first cut).
function streamCodexChat(opts: {
  userText: string;
  entity?: string;
  resumeSessionId?: string;
  attachments?: IncomingAttachment[];
  signal: AbortSignal;
}): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Codex has no Skill tool — skills ride in via the system prompt: the
      // catalog is always listed, and a $mention inlines that skill's full
      // instructions for this turn (see buildSkillsPromptBlock).
      const systemPrompt =
        buildSystemPrompt(opts.entity, await readBrainContent()) +
        (await buildSkillsPromptBlock(opts.userText));
      const send = (event: object) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          /* stream already closed */
        }
      };
      // Heartbeat — keep the SSE connection warm through silent gaps so an idle
      // proxy/NAT (e.g. over a VPN tunnel) doesn't drop a long run. See the
      // Claude path above for the rationale.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': hb\n\n'));
        } catch {
          /* stream already closed */
        }
      }, 15000);
      try {
        const cfg = await getCodexChatConfig();
        // Surface model + billing to the chat window. Codex always runs on the
        // ChatGPT subscription (CODEX_HOME auth), never an API key.
        send({
          type: 'meta',
          model: cfg.model ?? 'codex',
          billing: 'subscription',
          backend: 'codex',
        });
        await runCodexChat({
          userText: opts.userText,
          model: cfg.model,
          effort: toOpenAIEffort(cfg.effort),
          systemPrompt,
          codexHome: cfg.codexHome,
          binaryPath: cfg.binaryPath,
          resumeThreadId: opts.resumeSessionId,
          images: (opts.attachments ?? [])
            .filter((a) => a.mimeType.startsWith('image/'))
            .map((a) => ({ url: a.dataUrl })),
          signal: opts.signal,
          send,
        });
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : 'codex chat failed' });
      } finally {
        clearInterval(heartbeat);
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
  // SDK rate-limit event — the SDK emits this on its own when the
  // Claude.ai subscription's quota window changes. Forward to the client
  // so the UI can warn the user before they hit a hard 429 mid-turn.
  if (message.type === 'rate_limit_event') {
    send({ type: 'rate_limit', payload: message });
    return;
  }
  // Token-level text streaming. With includePartialMessages enabled, every
  // model-emitted token arrives as a stream_event carrying a raw Anthropic
  // content_block_delta. We forward only text_delta payloads — tool_use
  // input deltas and thinking deltas aren't useful to render incrementally
  // in this UI.
  if (message.type === 'stream_event') {
    const ev = message.event as { type?: string; delta?: { type?: string; text?: string } };
    if (
      ev.type === 'content_block_delta' &&
      ev.delta?.type === 'text_delta' &&
      typeof ev.delta.text === 'string'
    ) {
      send({ type: 'text', text: ev.delta.text });
    }
    return;
  }
  if (message.type === 'assistant') {
    // Surface specific assistant-level errors (rate_limit, billing_error,
    // authentication_failed, etc.) so the UI can show actionable copy
    // instead of a generic "Stream error". The full union is in the SDK
    // types as SDKAssistantMessageError.
    if (message.error) {
      send({ type: 'assistant_error', error: message.error });
    }
    for (const block of message.message.content) {
      if (block.type === 'text') {
        // Skip — partial events above already streamed the text.
        continue;
      }
      if (block.type === 'tool_use') {
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
  }
  // 'result' is handled inline in the route handler so we can attach
  // usage + cost to the done event without recomputing them here.
}
