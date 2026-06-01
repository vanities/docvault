// Deep Research — a thorough, cited web-research run powered by Claude's native
// web_search server tool. A single agentic API call: the model issues many
// searches (up to maxSearches), reads the results the API feeds back inline,
// and synthesizes a structured markdown report. We pull the report text + the
// deduped source URLs out of the response blocks.
//
// Native web_search is deliberately chosen over rebuilding odysseus's
// search-provider + BeautifulSoup extraction stack — the model does the
// searching and reading; we own the prompt + the report.

import { getClient } from './parsers/base.js';
import { getClaudeModel } from './data.js';
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
  'Ground every claim in your searches and cite sources inline. Prefer primary/authoritative sources; note where sources disagree. Aim for 1200+ words when the topic warrants. Output clean markdown only — no preamble like "Here is the report".',
].join('\n');

const DEFAULT_MAX_SEARCHES = 18;

export async function runDeepResearch(
  question: string,
  opts: { maxSearches?: number } = {}
): Promise<ResearchResult> {
  const client = await getClient();
  const model = await getClaudeModel();
  const maxUses = opts.maxSearches ?? DEFAULT_MAX_SEARCHES;
  const startedAt = Date.now();

  log.info(`Deep research started (maxSearches=${maxUses}): "${question.slice(0, 80)}"`);

  const response = await client.messages.create({
    model,
    max_tokens: 8192,
    system: RESEARCH_SYSTEM,
    messages: [{ role: 'user', content: question }],
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxUses }],
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
    `Deep research done: ${searchCount} searches, ${sources.length} sources, ${report.length} chars`
  );
  return { question, report: report.trim(), sources, searchCount, usage };
}
