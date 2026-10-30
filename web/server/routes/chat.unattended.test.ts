// Unattended (assignment) turns must never wait for a confirmation nobody can give, must label
// what they write to the Brain, and must be stoppable mid-hang. Fabricated tool context only; the
// Agent SDK's query() is scripted, nothing reaches Anthropic.
import { afterAll, beforeEach, describe, expect, test, vi } from 'vite-plus/test';
import { rmSync } from 'node:fs';

const dataDir = vi.hoisted(() => {
  const os = require('node:os') as typeof import('node:os');
  const p = require('node:path') as typeof import('node:path');
  const dir = p.join(os.tmpdir(), `docvault-chat-unattended-${Date.now()}`);
  process.env.DOCVAULT_DATA_DIR = dir;
  return dir;
});

const sdk = vi.hoisted(() => ({
  calls: [] as { prompt: unknown; options: Record<string, unknown> }[],
  makeQuery: null as null | (() => unknown),
}));
const brain = vi.hoisted(() => ({
  append: vi.fn(async (_text: string, _opts?: { tag?: string }) => ({ appended: true, bytes: 1 })),
}));
const research = vi.hoisted(() => ({ start: vi.fn(async () => ({ content: [] })) }));

vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>();
  return {
    ...actual,
    query: (args: { prompt: unknown; options: Record<string, unknown> }) => {
      sdk.calls.push(args);
      if (sdk.makeQuery) return sdk.makeQuery();
      return (async function* () {
        yield {
          type: 'result',
          subtype: 'success',
          session_id: 's',
          is_error: false,
          stop_reason: 'end_turn',
          result: 'ok',
          usage: { input_tokens: 1, output_tokens: 1 },
          total_cost_usd: 0,
        };
      })();
    },
  };
});

vi.mock('../data.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data.js')>()),
  loadConfig: async () => ({ entities: [] }),
}));
vi.mock('../brain.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../brain.js')>()),
  appendBrainEntry: brain.append,
}));
// Real research tool descriptions (they carry "Confirm ..." wording), but starting a Deep Research
// run is stubbed so the per-run cap can be exercised without a real run.
vi.mock('../chat-research-tools.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../chat-research-tools.js')>();
  return {
    ...actual,
    buildResearchMcpTools: (signal?: AbortSignal) =>
      actual
        .buildResearchMcpTools(signal)
        .map((t) => (t.name === 'start_deep_research' ? { ...t, handler: research.start } : t)),
  };
});
vi.mock('../ai/usage-log.js', () => ({ logAiCall: vi.fn(async () => {}) }));

import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import {
  buildSystemPrompt,
  docVaultTools,
  runClaudeTurn,
  toUnattendedDescription,
  type ClaudeAgent,
  type ToolContext,
} from './chat.js';

const agent: ClaudeAgent = {
  model: 'claude-test-model',
  effort: undefined,
  usingSub: true,
  env: {},
};
const assignmentCtx = (): ToolContext => ({
  config: { entities: [] },
  assignment: { id: 'a1', title: 'Watch Acme Bank rates', deepResearchStarts: 0 },
});
const textOf = (result: unknown) =>
  JSON.parse((result as { content: { text: string }[] }).content[0].text) as Record<
    string,
    unknown
  >;

beforeEach(() => {
  sdk.calls = [];
  sdk.makeQuery = null;
  brain.append.mockClear();
  research.start.mockClear();
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('unattended tool wording', () => {
  test('no tool asks for confirmation in an unattended run, while chat tools still do', () => {
    const ctx = assignmentCtx();
    const chatAsking = docVaultTools(ctx).filter((t) => /confirm/i.test(t.description));
    expect(chatAsking.length).toBeGreaterThanOrEqual(12);
    const unattended = docVaultTools(ctx, { policy: 'unattended' });
    expect(unattended.filter((t) => /confirm/i.test(t.description)).map((t) => t.name)).toEqual([]);
    expect(unattended.find((t) => t.name === 'log_time')!.description).toContain(
      'allowed in this unattended run when the assignment brief calls for it'
    );
  });

  test('only the confirmation sentence is replaced', () => {
    expect(
      toUnattendedDescription(
        'Add an event. WRITE TOOL — state the date and confirm before invoking. Prefer all-day events.'
      )
    ).toBe(
      'Add an event. WRITE TOOL: allowed in this unattended run when the assignment brief calls for it; every call is reported back to the user. Prefer all-day events.'
    );
    expect(toUnattendedDescription('Read the calendar.')).toBe('Read the calendar.');
  });

  test('the unattended system prompt drops every ask-first rule and uses the local date', () => {
    const prompt = buildSystemPrompt(undefined, '', 'claude', {
      policy: 'unattended',
      today: '2030-01-02',
    });
    expect(prompt).toContain('Today is 2030-01-02');
    expect(prompt).toContain('UNATTENDED RUN');
    expect(prompt).not.toMatch(
      /wait for explicit user confirmation|ASK before|require user confirmation|requiring confirmation/
    );
    expect(buildSystemPrompt(undefined)).toContain('wait for explicit user confirmation');
  });
});

describe('unattended tool behavior', () => {
  test('a Brain note written by an assignment is labeled with it', async () => {
    const remember = docVaultTools(assignmentCtx(), { policy: 'unattended' }).find(
      (t) => t.name === 'remember'
    )!;
    await remember.handler({ text: 'Acme Bank pays 4.1% now' }, {});
    expect(brain.append).toHaveBeenCalledWith(
      '[Assignment: Watch Acme Bank rates] Acme Bank pays 4.1% now',
      {
        tag: undefined,
      }
    );
  });

  test('Deep Research starts once per check-in', async () => {
    const start = docVaultTools(assignmentCtx(), { policy: 'unattended' }).find(
      (t) => t.name === 'start_deep_research'
    )!;
    await start.handler({ question: 'first' }, {});
    const second = await start.handler({ question: 'second' }, {});
    expect(research.start).toHaveBeenCalledTimes(1);
    expect(textOf(second).error).toMatch(/Limit reached: 1 Deep Research run per check-in/);
  });
});

describe('runClaudeTurn for assignment runs', () => {
  const finishTool = tool(
    'finish_check_in',
    'Record the check-in.',
    { headline: z.string() },
    async () => ({
      content: [],
    })
  );

  test('passes run limits, serves extra tools, and narrows the allow-list', async () => {
    const out = await runClaudeTurn({
      prompt: 'check in',
      systemPrompt: 'brief',
      agent,
      toolContext: assignmentCtx(),
      skillsPlugin: null,
      policy: 'unattended',
      extraTools: [finishTool],
      isToolAllowed: (name) => name !== 'mcp__docvault__log_time',
      maxTurns: 30,
      maxBudgetUsd: 3,
      persistSession: false,
      purpose: 'assignment',
      send: () => {},
    });
    expect(out.error).toBeNull();
    expect(out.result?.subtype).toBe('success');
    const options = sdk.calls[0].options;
    expect(options.allowedTools).toContain('mcp__docvault__finish_check_in');
    expect(options.allowedTools).not.toContain('mcp__docvault__log_time');
    expect(options.persistSession).toBe(false);
    expect(options.maxTurns).toBe(30);
    expect(options.maxBudgetUsd).toBe(3);
    const canUseTool = options.canUseTool as (
      n: string,
      i: object
    ) => Promise<{ message?: string }>;
    expect((await canUseTool('mcp__docvault__log_time', {})).message).toBe(
      'Tool "mcp__docvault__log_time" is not allowed in this assignment.'
    );
  });

  test('aborting closes the SDK query, so a hung turn ends', async () => {
    let release = () => {};
    const close = vi.fn(() => release());
    sdk.makeQuery = () =>
      Object.assign(
        (async function* () {
          await new Promise<void>((resolve) => (release = resolve));
        })(),
        { close }
      );
    const controller = new AbortController();
    const running = runClaudeTurn({
      prompt: 'check in',
      systemPrompt: 'brief',
      agent,
      toolContext: assignmentCtx(),
      skillsPlugin: null,
      policy: 'unattended',
      signal: controller.signal,
      send: () => {},
    });
    await new Promise((r) => setTimeout(r, 10));
    controller.abort();
    await expect(running).resolves.toEqual({ result: null, error: null, aborted: true });
    expect(close).toHaveBeenCalledTimes(1);
  });
});
