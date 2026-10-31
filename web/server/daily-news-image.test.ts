// Hero-image prompt tests — buildImagePrompt is pure string assembly; the
// OpenAI call itself is not exercised. Fabricated edition text, no personal
// data.

import { describe, expect, test } from 'vite-plus/test';
import { buildImagePrompt } from './daily-news-image.js';

const base = {
  title: 'Test Dispatch',
  body: '# Lede\nAcme Bank reports **$1,234.56** in synthetic earnings.',
  themeId: 'noir',
};

describe('buildImagePrompt', () => {
  test('carries the story, the theme visual, and the no-text rule', () => {
    const prompt = buildImagePrompt(base);
    expect(prompt).toContain('"Test Dispatch"');
    expect(prompt).toContain('Acme Bank');
    expect(prompt).toContain('film noir');
    expect(prompt).toContain('Do NOT render any text');
  });

  test('a holiday edition date adds the seasonal motif line', () => {
    const prompt = buildImagePrompt({ ...base, editionDate: '2026-10-31' });
    expect(prompt).toContain('Seasonal note: today is Halloween.');
    expect(prompt).toContain('Halloween motifs');
  });

  test('ordinary dates get no seasonal line', () => {
    expect(buildImagePrompt({ ...base, editionDate: '2026-10-30' })).not.toContain('Seasonal note');
    expect(buildImagePrompt(base)).not.toContain('Seasonal note');
  });
});
