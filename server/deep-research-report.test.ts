import { describe, expect, test } from 'vite-plus/test';
import { renderReportHtml } from './deep-research-report.js';
import type { ResearchRun } from './deep-research-store.js';

function run(overrides: Partial<ResearchRun> = {}): ResearchRun {
  return {
    id: 'run-1',
    question: 'Can <b>markup</b> leak?',
    status: 'done',
    maxSearches: 3,
    report: '## Markets &amp; Macro\n\nBody',
    sources: [],
    searchCount: 1,
    createdAt: '2026-06-05T12:00:00.000Z',
    completedAt: '2026-06-05T12:30:00.000Z',
    ...overrides,
  };
}

describe('deep-research-report', () => {
  test('escapes chrome and decodes heading entities for stable anchors', () => {
    const html = renderReportHtml(run());

    expect(html).toContain('Can &lt;b&gt;markup&lt;/b&gt; leak?');
    expect(html).toContain('<h2 id="markets-macro">Markets &amp; Macro</h2>');
    expect(html).toContain('<a href="#markets-macro">Markets &amp; Macro</a>');
  });

  test('strips dangerous report HTML while preserving normal links', () => {
    const html = renderReportHtml(
      run({
        report: [
          '## Safe',
          '<script>alert("x")</script>',
          '<style>body{display:none}</style>',
          '<img src="javascript:alert(1)" onerror="alert(2)">',
          '<a href="java&#x73;cript:alert(3)" onclick="alert(4)">bad</a>',
          '[safe](https://example.test/report)',
        ].join('\n\n'),
      })
    );

    expect(html.toLowerCase()).not.toContain('<script');
    expect(html).not.toContain('body{display:none}');
    expect(html.toLowerCase()).not.toContain('javascript:');
    expect(html.toLowerCase()).not.toContain('onerror=');
    expect(html.toLowerCase()).not.toContain('onclick=');
    expect(html).toContain('href="https://example.test/report"');
  });

  test('does not create clickable javascript source links', () => {
    const html = renderReportHtml(
      run({
        sources: [
          { url: 'https://example.test/good', title: 'Good source' },
          { url: 'java\nscript:alert(1)', title: 'Bad source' },
        ],
      })
    );

    expect(html).toContain('href="https://example.test/good"');
    expect(html).toContain('Good source');
    expect(html).toContain('Bad source');
    expect(html.toLowerCase()).not.toContain('href="javascript:');
  });
});
