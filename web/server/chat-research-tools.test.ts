// Fabricated reports and source URLs only; stores and background jobs use temp data.
import { afterAll, beforeEach, expect, test, vi } from 'vite-plus/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';

const dataDir = vi.hoisted(() => `/tmp/docvault-chat-tools-test-${Date.now()}`);
vi.mock('./data.js', () => ({
  DATA_DIR: dataDir,
  ensureDir: (dir: string) => fs.mkdir(dir, { recursive: true }),
  jsonResponse: (value: unknown, status = 200) => Response.json(value, { status }),
}));
vi.mock('./deep-research.js', () => ({ runDeepResearch: vi.fn() }));
vi.mock('./parsers/research-report.js', () => ({
  RESEARCH_EXTRACTOR_VERSION: 'synthetic',
  extractResearchText: vi.fn(),
}));
vi.mock('./parsers/youtube-transcript.js', () => ({
  YOUTUBE_EXTRACTOR_VERSION: 'synthetic',
  extractVideoId: vi.fn(),
  fetchYouTubeTranscript: vi.fn(),
}));
vi.mock('./parsers/media-transcribe.js', () => ({
  MEDIA_TRANSCRIBE_EXTRACTOR_VERSION: 'synthetic',
  transcribeMediaFile: vi.fn(),
}));
vi.mock('./politics/feed-store.js', () => ({ loadPoliticsFeedPayload: vi.fn() }));
vi.mock('./logger.js', () => ({
  createLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    timer: () => () => 0,
  }),
}));

import { researchChatTools, buildResearchMcpTools } from './chat-research-tools.js';
import { callChatTool } from './chat-tool-definitions.js';
import {
  startResearchRun,
  getRun,
  listRuns,
  deleteRun,
  type Runner,
} from './deep-research-store.js';
import { runDeepResearch } from './deep-research.js';
import { openChatToolBridge } from './llm/chat-tool-bridge.js';

beforeEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
  vi.mocked(runDeepResearch).mockReset();
});
afterAll(() => fs.rm(dataDir, { recursive: true, force: true }));
const report = {
  report: 'Synthetic cited report [source](https://example.org/source)',
  sources: [{ title: 'Synthetic source', url: 'https://example.org/source' }],
  searchCount: 1,
  usage: { inputTokens: 10, outputTokens: 20 },
};

test('starts a background report, reads completion and saves its cited text verbatim', async () => {
  let release!: (value: typeof report) => void;
  vi.mocked(runDeepResearch).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }) as ReturnType<Runner>
  );
  const started = (await callChatTool(researchChatTools, 'start_deep_research', {
    question: 'Synthetic research question',
    maxSearches: 3,
  })) as { id: string; status: string };
  expect(started.status).toBe('running');
  expect((await getRun(started.id))?.status).toBe('running');
  release(report);
  await vi.waitFor(async () => expect((await getRun(started.id))?.status).toBe('done'));
  const completed = (await callChatTool(researchChatTools, 'get_research_run', {
    id: started.id,
  })) as typeof report;
  expect(completed.report).toBe(report.report);
  const saved = (await callChatTool(researchChatTools, 'save_research', {
    title: 'Synthetic saved report',
    text: completed.report,
    domain: 'tech',
    sourceUrl: 'https://example.org/source',
    tags: ['synthetic'],
  })) as { id: string };
  const store = JSON.parse(
    await fs.readFile(path.join(dataDir, '.docvault-research.json'), 'utf8')
  );
  expect(store.entries[saved.id]).toMatchObject({
    title: 'Synthetic saved report',
    text: report.report,
    domain: 'tech',
    sourceUrl: 'https://example.org/source',
    tags: ['synthetic'],
  });
  expect(await fs.readFile(path.join(dataDir, 'research', `${saved.id}.txt`), 'utf8')).toBe(
    report.report
  );
});
test('concurrent starts and completions retain all runs; deleted runs stay deleted', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const runner: Runner = async () => {
    await gate;
    return report as Awaited<ReturnType<Runner>>;
  };
  const ids = await Promise.all(
    Array.from({ length: 12 }, (_, i) => startResearchRun(`Synthetic ${i}`, 2, [], runner))
  );
  expect(await listRuns()).toHaveLength(12);
  await deleteRun(ids[0]!);
  release();
  await vi.waitFor(async () =>
    expect((await listRuns()).every((r) => r.status === 'done')).toBe(true)
  );
  expect(await listRuns()).toHaveLength(11);
  expect(await getRun(ids[0]!)).toBeNull();
});
test('synchronous runner failures are persisted, and corrupt JSON is not overwritten', async () => {
  const id = await startResearchRun('Synthetic failure', 2, [], (() => {
    throw new Error('Synthetic error');
  }) as Runner);
  await vi.waitFor(async () => expect((await getRun(id))?.status).toBe('error'));
  await fs.writeFile(path.join(dataDir, '.docvault-deep-research.json'), 'broken');
  await expect(startResearchRun('Synthetic next', 2, [], vi.fn() as Runner)).rejects.toThrow();
  expect(await fs.readFile(path.join(dataDir, '.docvault-deep-research.json'), 'utf8')).toBe(
    'broken'
  );
});
test('validates unknown tools and write inputs before invoking a backend', async () => {
  await expect(callChatTool(researchChatTools, 'unknown', {})).rejects.toThrow(/Unknown/);
  await expect(
    callChatTool(researchChatTools, 'start_deep_research', {
      question: 'Synthetic',
      maxSearches: 31,
    })
  ).rejects.toThrow();
  await expect(
    callChatTool(researchChatTools, 'save_research', {
      title: 'Synthetic',
      text: 'text',
      domain: 'invalid',
    })
  ).rejects.toThrow();
  expect(runDeepResearch).not.toHaveBeenCalled();
});
test('Claude SDK MCP registration exposes and executes the shared tools', async () => {
  const sdk = createSdkMcpServer({
    name: 'docvault',
    tools: buildResearchMcpTools(),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'synthetic-test', version: '1.0.0' });
  await sdk.instance.connect(serverTransport);
  try {
    await client.connect(clientTransport);
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(
      researchChatTools.map((t) => t.name)
    );
    const result = await client.callTool({
      name: 'run_calculation',
      arguments: { code: 'return data[0]+data[1];', data: [3, 4] },
    });
    expect(result.content).toContainEqual({
      type: 'text',
      text: JSON.stringify({ result: 7, logs: [] }),
    });
  } finally {
    await client.close();
    await sdk.instance.close();
  }
});
test('Codex stdio MCP executes in the parent process and reports tool errors', async () => {
  const bridge = await openChatToolBridge(researchChatTools);
  const client = new Client({ name: 'synthetic-codex', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: 'bun',
    args: ['run', path.resolve('server/llm/codex-research-mcp.ts')],
    env: { DOCVAULT_TOOL_SOCKET: bridge.socketPath },
    stderr: 'pipe',
  });
  try {
    await client.connect(transport);
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(
      researchChatTools.map((t) => t.name)
    );
    const calculated = await client.callTool({
      name: 'run_calculation',
      arguments: { code: 'return 6*7;' },
    });
    expect(calculated.content).toContainEqual({ type: 'text', text: '{"result":42,"logs":[]}' });
    const saved = await client.callTool({
      name: 'save_research',
      arguments: { title: 'Synthetic IPC source', text: 'Synthetic source text', domain: 'local' },
    });
    expect(saved.isError).toBe(false);
    const store = JSON.parse(
      await fs.readFile(path.join(dataDir, '.docvault-research.json'), 'utf8')
    );
    expect(Object.values(store.entries)).toHaveLength(1);
    const error = await client.callTool({
      name: 'run_calculation',
      arguments: { code: 'throw new Error("Synthetic failure");' },
    });
    expect(error.isError).toBe(true);
  } finally {
    await client.close();
    await transport.close();
    await bridge.close();
  }
  await expect(fs.stat(bridge.socketPath)).rejects.toThrow();
}, 15_000);
