// Deep Research — two engines, chosen by settings.deepResearch.mode:
//   'api'   → one direct messages.create with the model's native web_search
//             tool. Provider-flexible in principle; today web_search is
//             Anthropic-only, so non-Anthropic models fall back to DEFAULT_MODEL.
//   'agent' → Claude Code (claude-agent-sdk) with WebSearch enabled — a true
//             agentic loop on the Claude subscription (search → read → iterate →
//             search again), richer than the single API turn.
// Both return the same ResearchResult (report + deduped cited sources).

import { createRequire } from 'module';
import path from 'path';
import { promises as fs } from 'fs';
import os from 'os';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { getClient } from './parsers/base.js';
import { CodexAppServerClient, type CodexNotification } from './llm/codex-app-server.js';
import { handleCodexServerRequest } from './llm/codex-chat.js';
import {
  getDeepResearchConfig,
  getCodexChatConfig,
  getAnthropicAuthToken,
  getAnthropicKey,
  toAnthropicApiEffort,
  toClaudeAgentEffort,
  toOpenAIEffort,
  DEFAULT_MODEL,
} from './data.js';
import { logAiCall } from './ai/usage-log.js';
import { createLogger } from './logger.js';

const log = createLogger('DeepResearch');

export interface ResearchSource {
  url: string;
  title?: string;
}

export interface ResearchResult {
  question: string;
  report: string;
  sources: ResearchSource[];
  searchCount: number;
  usage: { inputTokens: number; outputTokens: number };
}

const RESEARCH_SYSTEM = [
  'You are a thorough research analyst. Research the question deeply and produce a comprehensive, well-organized report.',
  'Search the web from multiple angles and read enough sources to cover the important sub-aspects with confidence. Be thorough — pursue several distinct lines of inquiry before concluding.',
  'Synthesize rather than list: write a structured report with clear `##` section headings, comparisons, and specifics (numbers, dates, names). Open with a 2-3 sentence summary, then the detailed sections, then a short "## Bottom line".',
  'Ground every claim in your searches and cite sources inline as markdown links. Prefer primary/authoritative sources; note where sources disagree. Aim for 1200+ words when the topic warrants. Output clean markdown only — no preamble like "Here is the report".',
].join('\n');

const DEFAULT_MAX_SEARCHES = 18;

// Claude Code binary resolution for the agent engine (mirrors chat.ts — the SDK
// can prefer a musl variant on Debian-slim and fail; pick by platform+arch).
const CLAUDE_BINARY_PATH: string | undefined = (() => {
  const { platform, arch } = process;
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

/** Entry point — dispatches to the configured engine. */
export async function runDeepResearch(
  question: string,
  opts: { maxSearches?: number } = {}
): Promise<ResearchResult> {
  const { mode, agentBackend } = await getDeepResearchConfig();
  if (mode !== 'agent') return runDeepResearchApi(question, opts);
  return agentBackend === 'codex'
    ? runDeepResearchCodexAgent(question)
    : runDeepResearchClaudeAgent(question);
}

/** API engine — a single agentic messages.create with native web_search. */
async function runDeepResearchApi(
  question: string,
  opts: { maxSearches?: number }
): Promise<ResearchResult> {
  const client = await getClient();
  const { model: ref } = await getDeepResearchConfig();
  // web_search is Anthropic-only; a non-Anthropic pick falls back to the default
  // until per-provider web search is wired.
  const model = ref.provider === 'anthropic' ? ref.model : DEFAULT_MODEL;
  const maxUses = opts.maxSearches ?? DEFAULT_MAX_SEARCHES;
  const startedAt = Date.now();

  log.info(`Deep research (api) started (maxSearches=${maxUses}): "${question.slice(0, 80)}"`);

  const effort = toAnthropicApiEffort(ref.effort);
  const response = await client.messages.create({
    model,
    max_tokens: 8192,
    system: RESEARCH_SYSTEM,
    messages: [{ role: 'user', content: question }],
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxUses }],
    ...(effort ? { output_config: { effort } } : {}),
  });

  let report = '';
  const sources: ResearchSource[] = [];
  const seen = new Set<string>();
  let searchCount = 0;

  for (const block of response.content) {
    if (block.type === 'text') {
      report += block.text;
    } else if (block.type === 'server_tool_use') {
      searchCount++;
    } else if (block.type === 'web_search_tool_result') {
      const content = block.content;
      if (Array.isArray(content)) {
        for (const r of content) {
          if (r.type === 'web_search_result' && r.url && !seen.has(r.url)) {
            seen.add(r.url);
            sources.push({ url: r.url, title: r.title || undefined });
          }
        }
      }
    }
  }

  const usage = {
    inputTokens: response.usage.input_tokens ?? 0,
    outputTokens: response.usage.output_tokens ?? 0,
  };

  void logAiCall({
    model,
    purpose: 'deep-research',
    latencyMs: Date.now() - startedAt,
    usage,
    ok: true,
    requestId: response.id ?? null,
    stopReason: response.stop_reason ?? null,
  });

  log.info(
    `Deep research (api) done: ${searchCount} searches, ${sources.length} sources, ${report.length} chars`
  );
  return { question, report: report.trim(), sources, searchCount, usage };
}

/** Claude agent engine — Claude Code + WebSearch, an agentic loop on the Claude sub. */
async function runDeepResearchClaudeAgent(question: string): Promise<ResearchResult> {
  const oauthToken = await getAnthropicAuthToken();
  const apiKey = await getAnthropicKey();
  const ref = (await getDeepResearchConfig()).model;
  // The scope's configured model applies when it's an Anthropic pick; a stale
  // OpenAI ref (left over from API mode) falls back to the default.
  const model = ref.provider === 'anthropic' && ref.model ? ref.model : DEFAULT_MODEL;
  const effort = toClaudeAgentEffort(ref.effort);
  const startedAt = Date.now();
  const env: Record<string, string | undefined> = {
    ...process.env,
    ...(oauthToken ? { CLAUDE_CODE_OAUTH_TOKEN: oauthToken } : {}),
    ...(apiKey ? { ANTHROPIC_API_KEY: apiKey } : {}),
  };

  log.info(`Deep research (agent) started: "${question.slice(0, 80)}"`);

  let report = '';
  let searchCount = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  for await (const message of query({
    prompt: question,
    options: {
      model,
      ...(effort ? { effort } : {}),
      systemPrompt: { type: 'preset', preset: 'claude_code', append: RESEARCH_SYSTEM },
      // The whole point: let the agent search, read pages, and search again.
      allowedTools: ['WebSearch', 'WebFetch'],
      disallowedTools: ['Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'NotebookEdit'],
      env,
      cwd: '/tmp',
      ...(CLAUDE_BINARY_PATH ? { pathToClaudeCodeExecutable: CLAUDE_BINARY_PATH } : {}),
    },
  })) {
    if (message.type === 'assistant') {
      for (const block of message.message.content) {
        if (block.type === 'text') report += block.text;
        else if (block.type === 'tool_use' && block.name === 'WebSearch') searchCount++;
      }
    } else if (message.type === 'result') {
      inputTokens = message.usage?.input_tokens ?? 0;
      outputTokens = message.usage?.output_tokens ?? 0;
    }
  }

  // The agent cites inline as markdown links — pull deduped URLs from the report.
  const sources: ResearchSource[] = [];
  const seen = new Set<string>();
  for (const m of report.matchAll(/https?:\/\/[^\s)\]]+/g)) {
    const url = m[0].replace(/[.,;]+$/, '');
    if (!seen.has(url)) {
      seen.add(url);
      sources.push({ url });
    }
  }

  const usage = { inputTokens, outputTokens };
  void logAiCall({
    model: `agent:${model}`,
    purpose: 'deep-research',
    latencyMs: Date.now() - startedAt,
    usage,
    ok: true,
    requestId: null,
    stopReason: null,
  });

  log.info(
    `Deep research (claude agent) done: ${searchCount} searches, ${sources.length} sources, ${report.length} chars`
  );
  return { question, report: report.trim(), sources, searchCount, usage };
}

/** Codex agent engine — codex app-server + web_search on the OpenAI subscription. */
async function runDeepResearchCodexAgent(question: string): Promise<ResearchResult> {
  const { codexHome, binaryPath, model: chatCodexModel } = await getCodexChatConfig();
  const ref = (await getDeepResearchConfig()).model;
  // The scope's configured model applies when it's an OpenAI pick; otherwise
  // fall back to the chat's codex model, then codex's account default.
  const model = ref.provider === 'openai' && ref.model ? ref.model : chatCodexModel;
  const effort = toOpenAIEffort(ref.effort);
  const startedAt = Date.now();
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'docvault-research-'));

  let report = '';
  let searchCount = 0;
  let done = false;
  let resolveDone!: () => void;
  const donePromise = new Promise<void>((r) => {
    resolveDone = r;
  });
  const finish = () => {
    if (!done) {
      done = true;
      resolveDone();
    }
  };

  const onNotification = (n: CodexNotification) => {
    const p = (n.params ?? {}) as Record<string, unknown>;
    if (n.method === 'item/agentMessage/delta') {
      if (typeof p.delta === 'string') report += p.delta;
    } else if (n.method === 'item/started') {
      const item = (p.item ?? {}) as Record<string, unknown>;
      if (item.type === 'webSearch') searchCount++;
    } else if (n.method === 'turn/completed' || n.method === 'error') {
      finish();
    }
  };

  const client = new CodexAppServerClient({
    binaryPath,
    cwd,
    codexHome,
    // Enable the native Responses web_search tool (equivalent to `codex --search`).
    extraArgs: ['-c', 'tools.web_search=true'],
    onNotification,
    // Relay codex's ChatGPT auth-token refresh from auth.json (deny approvals).
    // Returning null here makes codex fail fast with an empty turn.
    onServerRequest: (r) => handleCodexServerRequest(r, codexHome),
    onExit: () => finish(),
  });

  try {
    await client.initialize({ name: 'docvault', title: 'DocVault', version: '1.0.0' });
    const threadId = await client.startThread({
      cwd,
      ...(model ? { model } : {}),
      modelProvider: 'openai',
      approvalPolicy: 'never',
      sandbox: 'read-only',
      developerInstructions: RESEARCH_SYSTEM,
    });
    await client.startTurn({
      threadId,
      input: [{ type: 'text', text: question }],
      ...(effort ? { effort } : {}),
    });
    await donePromise;
  } finally {
    client.kill();
    await fs.rm(cwd, { recursive: true, force: true }).catch(() => undefined);
  }

  const sources: ResearchSource[] = [];
  const seen = new Set<string>();
  for (const m of report.matchAll(/https?:\/\/[^\s)\]]+/g)) {
    const url = m[0].replace(/[.,;]+$/, '');
    if (!seen.has(url)) {
      seen.add(url);
      sources.push({ url });
    }
  }

  const usage = { inputTokens: 0, outputTokens: 0 };
  void logAiCall({
    model: 'codex-agent',
    purpose: 'deep-research',
    latencyMs: Date.now() - startedAt,
    usage,
    ok: true,
    requestId: null,
    stopReason: null,
  });
  log.info(
    `Deep research (codex agent) done: ${searchCount} searches, ${sources.length} sources, ${report.length} chars`
  );
  return { question, report: report.trim(), sources, searchCount, usage };
}
