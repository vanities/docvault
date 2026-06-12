// Tests for the deterministic speech-adaptation pass and the atempo chain.
// All pure functions over fabricated edition text — no TTS server, no real
// data. The tmp DATA_DIR isolates the data.ts import chain.

import { describe, expect, test, vi } from 'vite-plus/test';

// Point DATA_DIR at a throwaway directory BEFORE the import graph resolves —
// data.ts reads DOCVAULT_DATA_DIR at module-load time.
vi.hoisted(() => {
  const p = require('path') as typeof import('path');
  const o = require('os') as typeof import('os');
  process.env.DOCVAULT_DATA_DIR = p.join(o.tmpdir(), `docvault-narration-test-${Date.now()}`);
});

vi.mock('./logger.js', () => ({
  createLogger: () => ({
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    timer: () => () => 0,
  }),
}));

// eslint-disable-next-line import/first
import { atempoChain, buildNarrationScript, speakableText } from './daily-news-narration.js';

describe('speakableText', () => {
  test('strips markdown links but keeps their text', () => {
    expect(speakableText('Paper bets [shorts tripled](https://x.test/a) since March.')).toBe(
      'Paper bets shorts tripled since March.'
    );
  });

  test('drops numbered citation links entirely', () => {
    expect(speakableText('El Nino was declared [[12]](https://x.test/b).')).toBe(
      'El Nino was declared.'
    );
  });

  test('verbalizes money, scales, and percent', () => {
    expect(speakableText('Oil at $91 and a $58 billion bill, up 4.2%.')).toBe(
      'Oil at 91 dollars and a 58 billion dollars bill, up 4.2 percent.'
    );
    expect(speakableText('Italy raised €70 billion.')).toBe('Italy raised 70 billion euros.');
  });

  test('letterizes opaque acronyms, keeps word-reads, expands tickers', () => {
    const out = speakableText('The ECB hiked while NATO watched; BTC fell and the S&P held.');
    expect(out).toContain('E-C-B');
    expect(out).toContain('NATO');
    expect(out).toContain('Bitcoin');
    expect(out).toContain('S and P');
  });
});

describe('buildNarrationScript', () => {
  const EDITION = {
    id: 'fab-1',
    editionType: 'daily',
    editionDate: '2026-06-12',
    title: 'The Test Gazette',
    body:
      'A 4% print landed today, and [markets shrugged](https://x.test/lede).\n\n' +
      '## Markets & Macro\n\nThe index rose $5 on the day.\n\n' +
      '## Health\n\nA solid 8,000 steps.\n\n' +
      '## Custom Desk\n\nSomething novel happened.\n',
  };

  test('wraps the edition in a dated intro and outro', () => {
    const script = buildNarrationScript(EDITION);
    expect(
      script.startsWith('Good morning. This is The Test Gazette, for Friday, June 12, 2026.')
    ).toBe(true);
    expect(script.endsWith('Same time tomorrow.')).toBe(true);
  });

  test('headers become spoken transitions, unknown desks get a generic one', () => {
    const script = buildNarrationScript(EDITION);
    expect(script).toContain('First — markets and macro.');
    expect(script).toContain('Health check.');
    expect(script).toContain('Next: Custom Desk.');
    expect(script).not.toContain('##');
  });

  test('lede survives with links stripped and symbols spoken', () => {
    const script = buildNarrationScript(EDITION);
    expect(script).toContain('4 percent print');
    expect(script).toContain('markets shrugged');
    expect(script).not.toContain('https://');
  });

  test('weekly editions close with the deep-dive outro', () => {
    const script = buildNarrationScript({ ...EDITION, editionType: 'weekly' });
    expect(script).toContain("That's the weekly deep-dive.");
  });
});

describe('atempoChain', () => {
  test('single filter within atempo range', () => {
    expect(atempoChain(1.5)).toBe('atempo=1.5');
    expect(atempoChain(2)).toBe('atempo=2.0');
  });

  test('chains filters above 2x', () => {
    expect(atempoChain(3)).toBe('atempo=2.0,atempo=1.5');
  });
});
