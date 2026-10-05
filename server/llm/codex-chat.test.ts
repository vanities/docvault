// Synthetic Codex notifications and temp vault only; no inference or credentials.
import { afterAll, beforeEach, expect, test, vi } from 'vite-plus/test';
import { promises as fs } from 'node:fs';
import { RESEARCH_CHAT_TOOLS, type ExecutableChatTool } from '../chat-tool-definitions.js';
import type {
  CodexClientOptions,
  CodexThreadStartParams,
  CodexThreadResumeParams,
} from './codex-app-server.js';

const fixture = vi.hoisted(() => ({
  dataDir: `/tmp/docvault-codex-chat-test-${Date.now()}`,
  clients: [] as {
    options: CodexClientOptions;
    start?: CodexThreadStartParams;
    resume?: CodexThreadResumeParams;
    killed: boolean;
  }[],
  failed: false,
}));
vi.mock('../data.js', () => ({ DATA_DIR: fixture.dataDir }));
vi.mock('../logger.js', () => ({
  createLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    timer: () => () => 0,
  }),
}));
vi.mock('./codex-app-server.js', () => ({
  CodexAppServerClient: class {
    state: (typeof fixture.clients)[number];
    constructor(options: CodexClientOptions) {
      this.state = { options, killed: false };
      fixture.clients.push(this.state);
    }
    async initialize() {}
    async startThread(input: CodexThreadStartParams) {
      this.state.start = input;
      return 'synthetic-thread';
    }
    async resumeThread(input: CodexThreadResumeParams) {
      this.state.resume = input;
      return input.threadId;
    }
    async startTurn() {
      const item = {
        type: 'mcpToolCall',
        id: 'synthetic-tool',
        server: 'docvault_research',
        tool: 'run_calculation',
        arguments: { code: 'return 42;' },
      };
      this.state.options.onNotification?.({ method: 'item/started', params: { item } });
      this.state.options.onNotification?.({
        method: 'item/completed',
        params: {
          item: {
            ...item,
            status: fixture.failed ? 'failed' : 'completed',
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    fixture.failed ? { error: 'Synthetic failure' } : { result: 42, logs: [] }
                  ),
                },
              ],
            },
            error: fixture.failed ? { message: 'Synthetic failure' } : null,
          },
        },
      });
      this.state.options.onNotification?.({
        method: 'turn/completed',
        params: { turn: { status: fixture.failed ? 'failed' : 'completed' } },
      });
    }
    kill() {
      this.state.killed = true;
    }
  },
}));
import { runCodexChat, handleCodexServerRequest } from './codex-chat.js';

beforeEach(async () => {
  fixture.clients.length = 0;
  fixture.failed = false;
  await fs.mkdir(fixture.dataDir, { recursive: true });
  for (const filename of ['.docvault-settings.json', '.rclone.conf', '.codex', 'synthetic.txt'])
    await fs.writeFile(`${fixture.dataDir}/${filename}`, 'synthetic');
});
afterAll(() => fs.rm(fixture.dataDir, { recursive: true, force: true }));
const tools: ExecutableChatTool[] = RESEARCH_CHAT_TOOLS.map((d) => ({
  ...d,
  execute: async () => ({ synthetic: true }),
}));

test('registers the MCP bridge for new and resumed chats and cleans temporary resources', async () => {
  const events: Record<string, unknown>[] = [];
  for (const resumeThreadId of [undefined, 'synthetic-resume']) {
    await runCodexChat({
      userText: 'Synthetic question',
      systemPrompt: 'Synthetic instructions',
      resumeThreadId,
      tools,
      send: (event) => events.push(event as Record<string, unknown>),
    });
    const state = fixture.clients.at(-1)!;
    expect(state.options.extraArgs?.join(' ')).toContain('mcp_servers.docvault_research.command=');
    expect(state.options.extraArgs?.join(' ')).toContain('DOCVAULT_TOOL_SOCKET=');
    expect(state.options.extraArgs).toContain('web_search="live"');
    expect(state.killed).toBe(true);
    expect(state.start?.sandbox ?? state.resume?.sandbox).toBe('read-only');
    await expect(fs.stat(state.options.cwd!)).rejects.toThrow();
    const socketArgument = state.options.extraArgs!.find((v) =>
      v.startsWith('mcp_servers.docvault_research.env.DOCVAULT_TOOL_SOCKET=')
    )!;
    await expect(
      fs.stat(JSON.parse(socketArgument.split('=').slice(1).join('=')))
    ).rejects.toThrow();
  }
  expect(events).toContainEqual({
    type: 'tool_call',
    id: 'synthetic-tool',
    toolName: 'run_calculation',
    input: { code: 'return 42;' },
  });
  expect(events).toContainEqual({
    type: 'tool_result',
    toolUseId: 'synthetic-tool',
    result: { result: 42, logs: [] },
    isError: false,
  });
});
test('surfaces MCP and turn failures and continues to deny filesystem approvals', async () => {
  fixture.failed = true;
  const events: Record<string, unknown>[] = [];
  await runCodexChat({
    userText: 'Synthetic',
    systemPrompt: 'Synthetic',
    send: (event) => events.push(event as Record<string, unknown>),
  });
  expect(events).toContainEqual({
    type: 'tool_result',
    toolUseId: 'synthetic-tool',
    result: { error: 'Synthetic failure' },
    isError: true,
  });
  expect(events.at(-1)?.isError).toBe(true);
  expect(
    await handleCodexServerRequest({ id: 1, method: 'item/commandExecution/requestApproval' })
  ).toEqual({ decision: 'deny' });
});
