// Self-contained visual HTML report for a Deep Research run — odysseus's
// signature output, reimplemented lean: `marked` for markdown→HTML, an
// extracted table of contents, source cards, and an inline themed stylesheet
// (no remote deps, light/dark via prefers-color-scheme). A single downloadable,
// shareable file.

import { marked } from 'marked';
import type { ResearchRun } from './deep-research-store.js';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function decodeHtmlEntities(text: string): string {
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

function safeUrlAttr(url: string | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  const decoded = decodeHtmlEntities(trimmed).replace(/[\u0000-\u001f\u007f\s]+/g, '');
  if (/^(javascript|data|vbscript):/i.test(decoded)) return null;
  return escapeHtml(trimmed);
}

function stripUnsafeHtml(html: string): string {
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
        const value = raw
          .replace(/^['"]|['"]$/g, '')
          .trim()
          .toLowerCase();
        const decoded = decodeHtmlEntities(value).replace(/[\u0000-\u001f\u007f\s]+/g, '');
        return /^(javascript|data|vbscript):/.test(decoded)
          ? ''
          : `${match.startsWith(' ') ? ' ' : ''}${attr}=${raw}`;
      }
    );
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'section'
  );
}

const CSS = `
:root { --bg:#fbfaf8; --fg:#1c1b19; --muted:#6b6862; --accent:#6d28d9; --card:#fff; --border:#e7e3dc; }
@media (prefers-color-scheme: dark) { :root { --bg:#16151a; --fg:#e9e7e2; --muted:#9b978f; --accent:#a78bfa; --card:#1f1e25; --border:#2e2c34; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.7 Georgia,'Times New Roman',serif; }
main { max-width:760px; margin:0 auto; padding:0 24px 64px; }
.hero { max-width:760px; margin:0 auto; padding:48px 24px 24px; }
.kicker { font:600 12px/1 system-ui,sans-serif; letter-spacing:.12em; text-transform:uppercase; color:var(--accent); }
.hero h1 { font:700 30px/1.25 system-ui,sans-serif; margin:.4em 0 .3em; }
.hero .meta { color:var(--muted); font:13px/1 system-ui,sans-serif; }
.toc { background:var(--card); border:1px solid var(--border); border-radius:12px; padding:16px 20px; margin:24px 0; }
.toc-title { font:600 12px/1 system-ui,sans-serif; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); margin-bottom:8px; }
.toc ul { list-style:none; margin:0; padding:0; }
.toc li { margin:3px 0; font:14px/1.4 system-ui,sans-serif; }
.toc li.lvl3 { padding-left:16px; font-size:13px; }
.toc a { color:var(--fg); text-decoration:none; }
.toc a:hover { color:var(--accent); }
.report h2 { font:700 22px/1.3 system-ui,sans-serif; margin:1.6em 0 .5em; }
.report h3 { font:600 18px/1.3 system-ui,sans-serif; margin:1.3em 0 .4em; }
.report p { margin:.8em 0; }
.report a { color:var(--accent); }
.report ul,.report ol { padding-left:1.4em; }
.report li { margin:.3em 0; }
.report table { border-collapse:collapse; width:100%; font:14px/1.5 system-ui,sans-serif; margin:1em 0; }
.report th,.report td { border:1px solid var(--border); padding:6px 10px; text-align:left; }
.report th { background:var(--card); }
.report blockquote { border-left:3px solid var(--accent); margin:1em 0; padding:.2em 1em; color:var(--muted); }
.report code { background:var(--card); border:1px solid var(--border); border-radius:4px; padding:1px 5px; font-size:.9em; }
.sources { margin-top:48px; border-top:1px solid var(--border); padding-top:24px; }
.sources h2 { font:700 18px/1 system-ui,sans-serif; margin:0 0 12px; }
.sources ol { padding-left:1.4em; }
.sources li { margin:8px 0; font:14px/1.4 system-ui,sans-serif; }
.sources a { color:var(--accent); text-decoration:none; }
.sources a:hover { text-decoration:underline; }
.src-url { color:var(--muted); font-size:12px; word-break:break-all; }
footer { max-width:760px; margin:0 auto; padding:24px; color:var(--muted); font:12px/1 system-ui,sans-serif; border-top:1px solid var(--border); }
`.trim();

export function renderReportHtml(run: ResearchRun): string {
  // markdown → HTML, with dangerous tags/attributes stripped. Research reports
  // can contain LLM-synthesized or web-derived markup, so treat them as an XSS
  // boundary even though the resulting file is self-contained.
  let body = stripUnsafeHtml(marked.parse(run.report ?? '') as string);

  // Add ids to h2/h3 and collect a table of contents.
  const toc: Array<{ level: number; text: string; id: string }> = [];
  body = body.replace(/<(h[23])>([\s\S]*?)<\/\1>/g, (_m, tag: string, inner: string) => {
    const text = decodeHtmlEntities(inner.replace(/<[^>]+>/g, '').trim());
    const id = slug(text);
    toc.push({ level: tag === 'h3' ? 3 : 2, text, id });
    return `<${tag} id="${id}">${inner}</${tag}>`;
  });

  const tocHtml = toc.length
    ? `<nav class="toc"><div class="toc-title">Contents</div><ul>${toc
        .map((t) => `<li class="lvl${t.level}"><a href="#${t.id}">${escapeHtml(t.text)}</a></li>`)
        .join('')}</ul></nav>`
    : '';

  const sources = run.sources ?? [];
  const sourcesHtml = sources.length
    ? `<section class="sources"><h2>Sources (${sources.length})</h2><ol>${sources
        .map((s) => {
          const safeUrl = safeUrlAttr(s.url);
          const label = escapeHtml(s.title || s.url);
          const visibleUrl = escapeHtml(s.url);
          return safeUrl
            ? `<li><a href="${safeUrl}" target="_blank" rel="noopener">${label}</a><div class="src-url">${visibleUrl}</div></li>`
            : `<li>${label}<div class="src-url">${visibleUrl}</div></li>`;
        })
        .join('')}</ol></section>`
    : '';

  const when = run.completedAt ?? run.createdAt;
  const meta = `${sources.length} sources · ${run.searchCount ?? 0} searches · ${new Date(
    when
  ).toLocaleDateString()}`;

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(
    run.question
  )}</title><style>${CSS}</style></head>
<body>
<header class="hero"><div class="kicker">DocVault · Deep Research</div><h1>${escapeHtml(
    run.question
  )}</h1><div class="meta">${meta}</div></header>
<main>${tocHtml}<article class="report">${body}</article>${sourcesHtml}</main>
<footer>Generated by DocVault Deep Research · ${new Date(when).toISOString().slice(0, 10)}</footer>
</body></html>`;
}
