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

  test('renders source warning notes at the end of full and email renders', () => {
    const withWarnings = {
      ...edition('## Main\n\nBody'),
      digestMeta: {
        sources: ['Markets & Macro'],
        sinceISO: '2026-06-05T00:00:00.000Z',
        itemCount: 1,
        sourceWarnings: [
          { source: 'politics/feed', message: 'cache unavailable' },
          { source: 'weather', message: 'forecast failed' },
        ],
      },
    };

    for (const html of [renderEditionHtml(withWarnings), renderEditionEmailHtml(withWarnings)]) {
      expect(html).toContain('Source notes');
      expect(html).toContain('politics/feed');
      expect(html).toContain('cache unavailable');
      expect(html).toContain('weather');
    }
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

  test('drops unsafe hero image URLs in full and email renders', () => {
    for (const html of [
      renderEditionHtml(edition('Body'), 'java\nscript:alert(1)'),
      renderEditionEmailHtml(edition('Body'), 'data:text/html,<svg onload=alert(1)>'),
    ]) {
      expect(html.toLowerCase()).not.toContain('javascript:');
      expect(html.toLowerCase()).not.toContain('data:text/html');
      expect(html).not.toContain('<img');
    }
  });
});
