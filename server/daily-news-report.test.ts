import { describe, expect, test } from 'vite-plus/test';
import { buildResendPayload } from './email.js';
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
      '<img src="vbscript:msgbox(1)">',
      '<a href="java&#x73;cript:alert(3)" onclick="alert(4)">bad</a>',
      '[safe](https://example.test/report)',
    ].join('\n\n');

    for (const html of [renderEditionHtml(edition(body)), renderEditionEmailHtml(edition(body))]) {
      expect(html.toLowerCase()).not.toContain('<script');
      expect(html.toLowerCase()).not.toContain('javascript:');
      expect(html.toLowerCase()).not.toContain('java&#x73;cript:');
      expect(html.toLowerCase()).not.toContain('vbscript:');
      expect(html.toLowerCase()).not.toContain('onerror=');
      expect(html.toLowerCase()).not.toContain('onclick=');
      expect(html).toContain('href="https://example.test/report"');
    }
  });

  test('drops svg/math islands and namespaced or form URL attributes in full and email renders', () => {
    const body = [
      '## Unsafe raw HTML',
      '<svg><a xlink:href="javascript:alert(1)"><foreignObject><p>bad</p></foreignObject></a></svg>',
      '<math><mi xlink:href="javascript:alert(2)">x</mi></math>',
      '<form action="javascript:alert(3)"><button formaction="javascript:alert(4)">go</button></form>',
    ].join('\n\n');

    for (const html of [renderEditionHtml(edition(body)), renderEditionEmailHtml(edition(body))]) {
      const lower = html.toLowerCase();
      expect(lower).not.toContain('<svg');
      expect(lower).not.toContain('<math');
      expect(lower).not.toContain('foreignobject');
      expect(lower).not.toContain('xlink:href');
      expect(lower).not.toContain('formaction');
      expect(lower).not.toContain('action="javascript:');
      expect(lower).not.toContain('javascript:');
    }
  });

  test('preserves generated PNG hero data URIs and CID hero images, and drops unsafe hero image URLs', () => {
    for (const html of [
      renderEditionHtml(edition('Body'), 'data:image/png;base64,AAAA'),
      renderEditionEmailHtml(edition('Body'), 'data:image/png;base64,AAAA'),
      renderEditionEmailHtml(edition('Body'), 'cid:docvault-daily-news-hero'),
    ]) {
      expect(html).toContain('<img');
    }
    expect(renderEditionHtml(edition('Body'), 'data:image/png;base64,AAAA')).toContain(
      'data:image/png;base64,AAAA'
    );
    expect(renderEditionEmailHtml(edition('Body'), 'cid:docvault-daily-news-hero')).toContain(
      'cid:docvault-daily-news-hero'
    );

    for (const html of [
      renderEditionHtml(edition('Body'), 'java\nscript:alert(1)'),
      renderEditionEmailHtml(edition('Body'), 'data:text/html,<svg onload=alert(1)>'),
    ]) {
      expect(html.toLowerCase()).not.toContain('javascript:');
      expect(html.toLowerCase()).not.toContain('data:text/html');
      expect(html).not.toContain('<img');
    }
  });

  test('builds Resend CID attachments for inline email hero images', () => {
    const result = buildResendPayload(
      {
        subject: 'Daily News',
        html: '<img src="cid:docvault-daily-news-hero" alt="">',
        attachments: [
          {
            filename: 'daily-news-hero.png',
            content: 'iVBORw0KGgo=',
            contentType: 'image/png',
            contentId: 'docvault-daily-news-hero',
          },
        ],
      },
      {
        fromEmail: 'sender@example.test',
        fromName: 'DocVault',
        toEmail: 'reader@example.test',
      }
    );

    expect(result.error).toBeUndefined();
    expect(result.payload).toMatchObject({
      from: 'DocVault <sender@example.test>',
      to: ['reader@example.test'],
      subject: 'Daily News',
      html: '<img src="cid:docvault-daily-news-hero" alt="">',
      attachments: [
        {
          filename: 'daily-news-hero.png',
          content: 'iVBORw0KGgo=',
          content_type: 'image/png',
          content_id: 'docvault-daily-news-hero',
        },
      ],
    });
  });
});
