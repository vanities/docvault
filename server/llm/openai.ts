// OpenAI (and OpenAI-compatible) adapter for the direct-API parsing scope.
//
// `callClaude` (parsers/base.ts) is the chokepoint every parser + form-decode
// goes through. When the parsing provider is OpenAI, callClaude delegates here.
// We translate the Anthropic-shaped request (system + content blocks + tools)
// into an OpenAI chat-completions call, then translate the response BACK into an
// Anthropic.Messages.Message — so the ~19 callers and the
// extractToolResult/extractTextResponse helpers keep working with zero changes.
//
// `baseUrl` in settings points the SDK at any OpenAI-compatible endpoint, so a
// self-hosted local model (Ollama/vLLM/LM Studio) flows through this same path.

import OpenAI from 'openai';
import type Anthropic from '@anthropic-ai/sdk';
import type { CallClaudeOptions } from '../parsers/base.js';
import { getOpenAIConfig, toOpenAIEffort } from '../data.js';
import { createLogger } from '../logger.js';

const log = createLogger('OpenAIAdapter');

let cachedClient: OpenAI | null = null;
let cachedKey = '';

async function getOpenAIClient(): Promise<OpenAI> {
  const { apiKey, baseUrl } = await getOpenAIConfig();
  if (!apiKey) {
    throw new Error('No OpenAI API key configured. Add one in Settings → Models → Parsing.');
  }
  const cacheKey = `${apiKey}|${baseUrl ?? ''}`;
  if (cachedClient && cachedKey === cacheKey) return cachedClient;
  cachedClient = new OpenAI({ apiKey, baseURL: baseUrl || undefined, maxRetries: 2 });
  cachedKey = cacheKey;
  return cachedClient;
}

type UserContentBlock = CallClaudeOptions['userContent'][number];

function toContentPart(block: UserContentBlock): OpenAI.Chat.Completions.ChatCompletionContentPart {
  if (block.type === 'text') return { type: 'text', text: block.text };
  if (block.type === 'image') {
    return {
      type: 'image_url',
      image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` },
    };
  }
  // PDFs: OpenAI chat-completions vision does not accept PDF documents. Surface a
  // clear, actionable error instead of silently dropping the document.
  throw new Error(
    'OpenAI cannot read PDFs directly — keep PDF parsing on Anthropic, or convert the PDF to images first.'
  );
}

function toTools(
  tools: Anthropic.Messages.Tool[] | undefined
): OpenAI.Chat.Completions.ChatCompletionTool[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      ...(t.description ? { description: t.description } : {}),
      parameters: t.input_schema as Record<string, unknown>,
    },
  }));
}

function toToolChoice(
  choice: Anthropic.Messages.ToolChoice | undefined
): OpenAI.Chat.Completions.ChatCompletionToolChoiceOption | undefined {
  if (!choice) return undefined;
  switch (choice.type) {
    case 'tool':
      return { type: 'function', function: { name: choice.name } };
    case 'any':
      return 'required';
    case 'none':
      return 'none';
    default:
      return 'auto';
  }
}

/**
 * Run an OpenAI (or OpenAI-compatible) chat completion for a parsing request and
 * shape the result as an Anthropic.Messages.Message.
 */
export async function openaiComplete(
  opts: CallClaudeOptions,
  model: string
): Promise<Anthropic.Messages.Message> {
  const openai = await getOpenAIClient();
  const effort = toOpenAIEffort(opts.effort);
  const response = await openai.chat.completions.create({
    model,
    max_tokens: opts.maxTokens,
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.userContent.map(toContentPart) },
    ],
    ...(opts.tools ? { tools: toTools(opts.tools) } : {}),
    ...(opts.toolChoice ? { tool_choice: toToolChoice(opts.toolChoice) } : {}),
    // Only sent when configured — non-reasoning models reject the param.
    ...(effort ? { reasoning_effort: effort } : {}),
  });

  const choice = response.choices[0];
  const msg = choice?.message;
  const content: Array<Record<string, unknown>> = [];

  // Function calls → Anthropic tool_use blocks (read via extractToolResult).
  for (const call of msg?.tool_calls ?? []) {
    if (call.type !== 'function') continue;
    let input: unknown = {};
    try {
      input = JSON.parse(call.function.arguments || '{}');
    } catch {
      log.warn(`OpenAI returned non-JSON arguments for tool ${call.function.name}`);
    }
    content.push({ type: 'tool_use', id: call.id, name: call.function.name, input });
  }
  // Plain text → Anthropic text block (read via extractTextResponse).
  if (msg?.content) content.push({ type: 'text', text: msg.content });

  return {
    id: response.id,
    type: 'message',
    role: 'assistant',
    model: response.model,
    content,
    stop_reason: choice?.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: response.usage?.prompt_tokens ?? 0,
      output_tokens: response.usage?.completion_tokens ?? 0,
    },
  } as unknown as Anthropic.Messages.Message;
}
