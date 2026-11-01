// Fabricated debts and questions only.
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { describe, expect, test, vi } from 'vite-plus/test';

const DATA = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? '/tmp'}/docvault-context-tools-${Date.now()}`;
  process.env.DOCVAULT_DATA_DIR = dir;
  return dir;
});

const { getContext, listContext, CONTEXT_TOOL_NAMES } = await import('./tools.js');
const { briefGroups } = await import('./brief.js');
const { CONTEXT_SOURCES } = await import('./registry.js');
const { RESEARCH_CHAT_TOOLS } = await import('../chat-tool-definitions.js');
const { researchChatTools } = await import('../chat-research-tools.js');
const { handleDeepResearchRoutes } = await import('../routes/deep-research.js');
const { getRun } = await import('../deep-research-store.js');

describe('list_context and get_context', () => {
  test('list_context names every registered source and can narrow to a group', async () => {
    const all = await listContext({});
    expect(all.sources.map((s) => s.id)).toEqual(CONTEXT_SOURCES.map((s) => s.id));
    const money = await listContext({ group: 'money' });
    expect(money.sources.every((s) => s.group === 'money')).toBe(true);
    expect(money.sources.map((s) => s.id)).toContain('bank-transactions');
  });

  test('get_context reads a source with its standing picture', async () => {
    mkdirSync(DATA, { recursive: true });
    writeFileSync(
      path.join(DATA, '.docvault-liabilities.json'),
      JSON.stringify({
        entries: [
          {
            id: 'l1',
            name: 'Delivery Van',
            lender: 'Globex Credit',
            type: 'auto-loan',
            balance: 9000,
            rate: 0.05,
            monthlyPayment: 300,
            createdAt: '2025-01-01T00:00:00.000Z',
          },
        ],
      })
    );
    const out = await getContext({ source: 'debts' });
    expect(out.source).toBe('debts');
    expect(out.lines).toContain('Delivery Van (Added here, Globex Credit): $9,000 at 5%, $300/mo.');
  });

  test('get_context refuses unknown sources and malformed dates', async () => {
    await expect(getContext({ source: 'nope' })).rejects.toThrow(/list_context/);
    await expect(getContext({ source: 'debts', since: '2026-3-1' })).rejects.toThrow(/YYYY-MM-DD/);
    await expect(
      getContext({ source: 'debts', since: '2026-03-10', until: '2026-03-01' })
    ).rejects.toThrow(/before since/);
  });

  test('both tools are in the shared list, and every shared tool has a handler', () => {
    const names = RESEARCH_CHAT_TOOLS.map((t) => t.name);
    for (const name of CONTEXT_TOOL_NAMES) expect(names).toContain(name);
    for (const t of researchChatTools) expect(typeof t.execute, t.name).toBe('function');
  });
});

describe('owner brief for Deep Research', () => {
  test('health records join only when the question is about health', () => {
    expect(briefGroups('Should I refinance my mortgage at 6.5%?')).not.toContain('health');
    expect(briefGroups('Is my LDL worth treating with a statin?')).toContain('health');
    expect(briefGroups('Best supplements for sleep?')).toContain('health');
  });

  test('the run records the owner’s choice and hands it to the engine; only true counts', async () => {
    const seen: Array<boolean | undefined> = [];
    const runner = async (question: string, opts: { useOwnerData?: boolean } = {}) => {
      seen.push(opts.useOwnerData);
      return {
        question,
        report: 'done',
        sources: [],
        searchCount: 0,
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    };
    const start = async (body: unknown) => {
      const url = new URL('http://docvault.test/api/deep-research/run');
      const res = await handleDeepResearchRoutes(
        new Request(url.href, { method: 'POST', body: JSON.stringify(body) }),
        url,
        url.pathname,
        runner as never
      );
      return ((await res!.json()) as { id: string }).id;
    };
    const withData = await start({ question: 'Refinance or not?', useOwnerData: true });
    const sloppy = await start({ question: 'General question', useOwnerData: 'yes' });
    await vi.waitFor(() => expect(seen).toHaveLength(2));
    expect(seen.sort()).toEqual([false, true]);
    expect((await getRun(withData))?.useOwnerData).toBe(true);
    expect((await getRun(sloppy))?.useOwnerData).toBeUndefined();
  });
});
