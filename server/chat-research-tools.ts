import { readBrowserPage } from './chat-browser.js';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { runCalculation } from './chat-calculation.js';
import { startResearchRun, getRun } from './deep-research-store.js';
import { handleResearchRoutes, type ResearchEntry } from './routes/research.js';
import {
  RESEARCH_CHAT_TOOLS,
  callChatTool,
  chatToolResult,
  type ExecutableChatTool,
} from './chat-tool-definitions.js';

const handlers: Record<string, ExecutableChatTool['execute']> = {
  browser_read: (input, signal) => readBrowserPage((input as { url: string }).url, { signal }),
  run_calculation: (input, signal) => {
    const { code, data } = input as { code: string; data?: unknown };
    return runCalculation(code, data, signal);
  },
  start_deep_research: async (input) => {
    const { question, maxSearches } = input as { question: string; maxSearches: number };
    return {
      id: await startResearchRun(question, maxSearches),
      status: 'running',
      view: 'deep-research',
    };
  },
  get_research_run: async (input) => {
    const run = await getRun((input as { id: string }).id);
    if (!run) throw new Error('Research run not found');
    const { attachments: _attachments, ...summary } = run;
    return {
      ...summary,
      report: run.report?.slice(0, 100_000),
      truncated: (run.report?.length ?? 0) > 100_000,
    };
  },
  save_research: async (input) => {
    const url = new URL('http://docvault.internal/api/research/text');
    const response = await handleResearchRoutes(
      new Request(url.href, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
      url,
      url.pathname
    );
    if (!response) throw new Error('Research route unavailable');
    const body = (await response.json()) as { entry?: ResearchEntry; error?: string };
    if (!response.ok || !body.entry) throw new Error(body.error ?? 'Research save failed');
    const entry = body.entry;
    return {
      id: entry.id,
      title: entry.title,
      domain: entry.domain,
      sourceUrl: entry.sourceUrl,
      charCount: entry.text?.length ?? 0,
      view: 'research',
    };
  },
};

export const researchChatTools: ExecutableChatTool[] = RESEARCH_CHAT_TOOLS.map((definition) => ({
  ...definition,
  execute: handlers[definition.name]!,
}));

export function buildResearchMcpTools(signal?: AbortSignal) {
  return researchChatTools.map((definition) =>
    tool(definition.name, definition.description, definition.inputSchema, async (args) => {
      try {
        return chatToolResult(await callChatTool(researchChatTools, definition.name, args, signal));
      } catch (error) {
        return chatToolResult(
          { error: error instanceof Error ? error.message : 'Tool failed' },
          true
        );
      }
    })
  );
}
