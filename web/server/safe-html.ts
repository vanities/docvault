// HTML hardening for markdown we render into emails and downloadable reports. The Newsstand
// report, the Deep Research export and assignment emails all render model-written markdown, so
// they share one implementation instead of private copies that drift.
import { marked } from 'marked';

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function decodeHtmlEntities(text: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    quot: '"',
    nbsp: ' ',
  };
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith('#x')) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    if (lower.startsWith('#')) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return named[lower] ?? match;
  });
}

// Entity-encoded or whitespace-split schemes ("jav&#x61;script:", "java\tscript:") still execute
// in a browser, so the protocol check runs on the decoded, whitespace-free form.
export function normalizedUrlForProtocolCheck(url: string): string {
  return decodeHtmlEntities(url).replace(/[\u0000-\u001f\u007f\s]+/g, '');
}

/** An escaped URL safe for an href/src attribute, or null for script/data schemes. */
export function safeUrlAttr(url: string | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (/^(javascript|data|vbscript):/i.test(normalizedUrlForProtocolCheck(trimmed))) return null;
  return escapeHtml(trimmed);
}

/** Removes script-capable tags, event handlers and script/data URLs from rendered markdown. */
export function stripUnsafeHtml(html: string): string {
  return html
    .replace(/<(script|style|iframe|object|embed|link|meta|svg|math|form)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(
      /<(script|style|iframe|object|embed|link|meta|svg|math|form|foreignObject)\b[^>]*\/?\s*>/gi,
      ''
    )
    .replace(/<\/\s*(svg|math|form|foreignObject)\s*>/gi, '')
    .replace(/\s+on[a-z][\w:-]*\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+[a-z][\w-]*:[\w:-]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(
      /\s+(href|src|action|formaction|poster|srcset)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,
      (match, attr: string, raw: string) => {
        const value = raw.replace(/^['"]|['"]$/g, '').trim();
        return /^(javascript|data|vbscript):/i.test(normalizedUrlForProtocolCheck(value))
          ? ''
          : `${match.startsWith(' ') ? ' ' : ''}${attr}=${raw}`;
      }
    );
}

/** Markdown → HTML with unsafe tags, handlers and URLs removed. */
export function renderSafeMarkdown(markdown: string): string {
  return stripUnsafeHtml(marked.parse(markdown) as string);
}
