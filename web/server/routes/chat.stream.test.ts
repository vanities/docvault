// Pins what POST /api/chat streams for a scripted Claude Agent SDK conversation, so the chat turn
// can be extracted for unattended runs without changing what the browser receives. The SDK's
// query() is replaced with a fixed message sequence; nothing reaches Anthropic.
import { afterAll, beforeEach, describe, expect, test, vi } from 'vite-plus/test';
import { rmSync } from 'node:fs';

const dataDir = vi.hoisted(() => {
  const os = require('node:os') as typeof import('node:os');
  const p = require('node:path') as typeof import('node:path');
  const dir = p.join(os.tmpdir(), `docvault-chat-stream-${Date.now()}`);
  process.env.DOCVAULT_DATA_DIR = dir;
  return dir;
});

const sdk = vi.hoisted(() => ({
  script: [] as unknown[],
  throwAfter: null as Error | null,
  calls: [] as { prompt: unknown; options: Record<string, unknown> }[],
}));

vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>();
  return {
    ...actual,
    query: (args: { prompt: unknown; options: Record<string, unknown> }) => {
      sdk.calls.push(args);
      return (async function* () {
        for (const message of sdk.script) yield message;
        if (sdk.throwAfter) throw sdk.throwAfter;
      })();
    },
  };
});

vi.mock('../data.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data.js')>();
  return {
    ...actual,
    loadConfig: async () => ({ entities: [] }),
    getChatMode: async () => 'agent' as const,
    getChatBackend: async () => 'claude' as const,
    getAnthropicAuthToken: async () => 'oauth-test-token',
    getAnthropicKey: async () => undefined,
    getClaudeModel: async () => 'claude-test-model',
    getClaudeChatEffort: async () => undefined,
  };
});

vi.mock('../ai/usage-log.js', () => ({ logAiCall: vi.fn(async () => {}) }));

import { handleChatRoutes } from './chat.js';

const SESSION = 'session-test-1';
const SUCCESS_SCRIPT = [
  { type: 'system', subtype: 'init', session_id: SESSION },
  {
    type: 'stream_event',
    session_id: SESSION,
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Checking ' } },
  },
  {
    type: 'stream_event',
    session_id: SESSION,
    event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{' } },
  },
  {
    type: 'assistant',
    session_id: SESSION,
    message: {
      content: [
        { type: 'text', text: 'Checking ' },
        { type: 'tool_use', id: 'tool-1', name: 'mcp__docvault__list_entities', input: {} },
      ],
    },
  },
  {
    type: 'user',
    session_id: SESSION,
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'tool-1',
          content: [{ type: 'text', text: '{"entities":[]}' }],
        },
      ],
    },
  },
  { type: 'rate_limit_event', session_id: SESSION, rate_limit_info: { status: 'allowed' } },
  {
    type: 'result',
    subtype: 'success',
    session_id: SESSION,
    stop_reason: 'end_turn',
    is_error: false,
    result: 'Checking done.',
    usage: { input_tokens: 10, output_tokens: 5 },
    total_cost_usd: 0.01,
  },
];

async function postChat(body: unknown): Promise<Response> {
  const res = await handleChatRoutes(
    new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    new URL('http://localhost/api/chat'),
    '/api/chat'
  );
  if (!res) throw new Error('chat route did not match');
  return res;
}

async function events(res: Response): Promise<Record<string, unknown>[]> {
  const raw = await res.text();
  return raw
    .split('\n\n')
    .filter((frame) => frame.startsWith('data: '))
    .map((frame) => JSON.parse(frame.slice('data: '.length)) as Record<string, unknown>);
}

const userTurn = { messages: [{ role: 'user', content: 'what entities do I have?' }] };

beforeEach(() => {
  sdk.script = SUCCESS_SCRIPT;
  sdk.throwAfter = null;
  sdk.calls = [];
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('POST /api/chat streaming contract', () => {
  test('a tool-using turn streams meta, session, text, tool call, tool result, rate limit, done', async () => {
    const res = await postChat(userTurn);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    const evs = await events(res);
    expect(evs).toEqual([
      { type: 'meta', model: 'claude-test-model', billing: 'subscription', backend: 'claude' },
      { type: 'session', sessionId: SESSION },
      { type: 'text', text: 'Checking ' },
      { type: 'tool_call', id: 'tool-1', toolName: 'list_entities', input: {} },
      { type: 'tool_result', toolUseId: 'tool-1', result: { entities: [] }, isError: false },
      {
        type: 'rate_limit',
        payload: {
          type: 'rate_limit_event',
          session_id: SESSION,
          rate_limit_info: { status: 'allowed' },
        },
      },
      {
        type: 'done',
        stopReason: 'end_turn',
        isError: false,
        usage: { inputTokens: 10, outputTokens: 5 },
        cost: 0.01,
      },
    ]);
  });

  test('query() gets the chat prompt, tool allow-list, sandboxing and subscription credentials', async () => {
    await events(await postChat(userTurn));
    expect(sdk.calls).toHaveLength(1);
    const { prompt, options } = sdk.calls[0];
    expect(prompt).toBe('what entities do I have?');
    expect(options.model).toBe('claude-test-model');
    const system = options.systemPrompt as { type: string; preset: string; append: string };
    expect(system.type).toBe('preset');
    expect(system.preset).toBe('claude_code');
    expect(system.append).toContain('You are the DocVault chat assistant');
    expect(system.append).toContain('wait for explicit user confirmation BEFORE invoking');
    expect(options.allowedTools).toContain('mcp__docvault__list_entities');
    expect(options.allowedTools).toContain('mcp__docvault__log_time');
    expect(options.allowedTools).toContain('WebSearch');
    expect(options.tools).toEqual(['WebSearch', 'WebFetch', 'ToolSearch', 'TodoWrite', 'Skill']);
    expect(options.disallowedTools).toEqual([
      'Bash',
      'Read',
      'Edit',
      'Write',
      'Glob',
      'Grep',
      'NotebookEdit',
    ]);
    expect(Object.keys(options.mcpServers as object)).toEqual(['docvault']);
    expect(options.includePartialMessages).toBe(true);
    expect(options.cwd).toBe('/tmp');
    expect('resume' in options).toBe(false);
    const env = options.env as Record<string, string | undefined>;
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('oauth-test-token');
    expect('ANTHROPIC_API_KEY' in env).toBe(false);
  });

  test('canUseTool passes allowed tools through with their input and denies everything else', async () => {
    await events(await postChat(userTurn));
    const canUseTool = sdk.calls[0].options.canUseTool as (
      name: string,
      input: Record<string, unknown>
    ) => Promise<Record<string, unknown>>;
    const input = { entity: 'acme' };
    expect(await canUseTool('mcp__docvault__list_files', input)).toEqual({
      behavior: 'allow',
      updatedInput: input,
    });
    expect(await canUseTool('Bash', { command: 'ls' })).toEqual({
      behavior: 'deny',
      message: 'Tool "Bash" is not allowed in DocVault chat.',
      interrupt: false,
    });
  });

  test('a resumed chat passes its session id to the SDK', async () => {
    const resumeSessionId = '0b5e3b52-9a59-4f3e-8a64-1f7f1c2d3e4f';
    await events(await postChat({ ...userTurn, resumeSessionId }));
    expect(sdk.calls[0].options.resume).toBe(resumeSessionId);
  });

  test('an assistant-level error is surfaced as its own event', async () => {
    sdk.script = [
      { type: 'system', subtype: 'init', session_id: SESSION },
      {
        type: 'assistant',
        session_id: SESSION,
        error: 'rate_limit',
        message: { content: [{ type: 'text', text: '' }] },
      },
    ];
    const evs = await events(await postChat(userTurn));
    expect(evs.map((e) => e.type)).toEqual(['meta', 'session', 'assistant_error']);
    expect(evs[2]).toEqual({ type: 'assistant_error', error: 'rate_limit' });
  });

  test('an SDK failure mid-stream ends with an error event', async () => {
    sdk.script = [{ type: 'system', subtype: 'init', session_id: SESSION }];
    sdk.throwAfter = new Error('subprocess exited');
    const evs = await events(await postChat(userTurn));
    expect(evs.map((e) => e.type)).toEqual(['meta', 'session', 'error']);
    expect(evs[2]).toEqual({ type: 'error', message: 'subprocess exited' });
  });

  test('bad requests are rejected before any model call', async () => {
    expect((await postChat({ messages: [] })).status).toBe(400);
    expect((await postChat({ messages: [{ role: 'assistant', content: 'hi' }] })).status).toBe(400);
    expect(sdk.calls).toHaveLength(0);
  });
});
