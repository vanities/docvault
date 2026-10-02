import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vite-plus/test';
import { SafeMarkdown } from './SafeMarkdown';

describe('Markdown link rendering', () => {
  test('passes explicitly allowed wiki links to the source browser handler', () => {
    const html = renderToStaticMarkup(
      <SafeMarkdown
        allowedProtocols={['wiki:']}
        components={{ a: ({ href, children }) => <button data-target={href}>{children}</button> }}
      >
        {'[Open note](wiki:Project%20notes)'}
      </SafeMarkdown>
    );
    expect(html).toContain('data-target="wiki:Project%20notes"');
    expect(html).toContain('Open note</button>');
  });
  test('does not allow wiki links by default or script links when wiki is allowed', () => {
    const html = renderToStaticMarkup(<SafeMarkdown>{'[Hidden](wiki:Note)'}</SafeMarkdown>);
    expect(html).not.toContain('<a');
    const hostile = renderToStaticMarkup(
      <SafeMarkdown allowedProtocols={['wiki:']}>
        {'[Unsafe](javascript:alert%281%29)\n\n[Unsafe data](data:text/html,test)'}
      </SafeMarkdown>
    );
    expect(hostile).not.toContain('<a');
    expect(hostile).not.toContain('javascript:');
    expect(hostile).not.toContain('data:text');
  });
  test('retains safe external links and anchors', () => {
    const html = renderToStaticMarkup(
      <SafeMarkdown>{'[Example](https://example.com) and [Section](#notes)'}</SafeMarkdown>
    );
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('href="#notes"');
  });

  test('preserves relative images without admitting executable image URLs', () => {
    const html = renderToStaticMarkup(
      <SafeMarkdown>{'![Diagram](diagram.png)\n\n![Unsafe](javascript:alert%281%29)'}</SafeMarkdown>
    );
    expect(html).toContain('src="diagram.png"');
    expect(html).not.toContain('javascript:');
  });
});
