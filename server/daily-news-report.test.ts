import { describe, expect, test } from 'vite-plus/test';
import {
  formatEditionDate,
  renderEditionEmailHtml,
  renderEditionHtml,
} from './daily-news-report.js';
import type { Edition } from './daily-news-store.js';

function edition(body: string): Edition {
  return {
    id: 'edition-1',
    editionType: 'daily',
    editionDate: '2026-06-05',
    status: 'done',
    title: 'The Test Dispatch',
    body,
    createdAt: '2026-06-05T12:00:00.000Z',
  };
}

describe('daily-news-report', () => {
  test('formats edition dates as newspaper datelines', () => {
    expect(formatEditionDate('2026-06-05')).toBe('Friday, June 5, 2026');
    expect(formatEditionDate('not-a-date')).toBe('not-a-date');
  });

  test('renders table of contents headings and escapes edition chrome', () => {
    const html = renderEditionHtml({
      ...edition('## Markets & Macro\n\nBody'),
      title: 'A <Paper>',
    });

    expect(html).toContain('A &lt;Paper&gt;');
    expect(html).toContain('<h2 id="markets-macro">Markets &amp; Macro</h2>');
    expect(html).toContain('<a href="#markets-macro">Markets &amp; Macro</a>');
  });

  test('strips unsafe HTML from the markdown body in full and email renders', () => {
    const body = [
      '## Safe headline',
      '<script>alert("x")</script>',
      '<img src="javascript:alert(1)" onerror="alert(2)">',
      '<a href="javascript:alert(3)" onclick="alert(4)">bad</a>',
      '[safe](https://example.test/report)',
    ].join('\n\n');

    for (const html of [renderEditionHtml(edition(body)), renderEditionEmailHtml(edition(body))]) {
      expect(html.toLowerCase()).not.toContain('<script');
      expect(html.toLowerCase()).not.toContain('javascript:');
      expect(html.toLowerCase()).not.toContain('onerror=');
      expect(html.toLowerCase()).not.toContain('onclick=');
      expect(html).toContain('href="https://example.test/report"');
    }
  });
});
