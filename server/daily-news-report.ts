// Self-contained newspaper HTML for a Daily News edition. Cloned from
// deep-research-report.ts (marked → HTML, <script> stripped, inline themed
// stylesheet, no remote deps) but laid out as a newspaper: a serif masthead +
// dateline, an "In this edition" index, and a multi-column body.
//
// Two renderers:
//   renderEditionHtml      — the full, columned, downloadable/in-app edition.
//   renderEditionEmailHtml — a single-column, inline-styled variant for email
//                            clients (no column-count / media queries, which
//                            most clients drop). The full edition rides along
//                            as an attachment.

import { marked } from 'marked';
import type { Edition } from './daily-news-store.js';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizedUrlForProtocolCheck(url: string): string {
  return decodeHtmlEntities(url).replace(/[\u0000-\u001f\u007f\s]+/g, '');
}

function safeUrlAttr(url: string | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  const decoded = normalizedUrlForProtocolCheck(trimmed);
  if (/^(javascript|data|vbscript):/i.test(decoded)) return null;
  return escapeHtml(trimmed);
}

function safeHeroUrlAttr(url: string | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  const decoded = normalizedUrlForProtocolCheck(trimmed);
  if (/^data:image\/png;base64,[a-z0-9+/]+=*$/i.test(decoded)) return escapeHtml(trimmed);
  return safeUrlAttr(trimmed);
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

/** Long-form dateline, e.g. "Friday, June 5, 2026". Robust to a bad date. */
export function formatEditionDate(editionDate: string): string {
  const d = new Date(`${editionDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return editionDate;
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** Slugified download filename (no extension), e.g. "the-docvault-dispatch-2026-06-05". */
export function editionFilename(edition: Edition): string {
  return slug(`${edition.title ?? 'daily-news'}-${edition.editionDate}`);
}

function editionBadge(edition: Edition): string {
  return edition.editionType === 'weekly' ? 'WEEKLY DEEP-DIVE' : 'DAILY EDITION';
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

function stripUnsafeHtml(html: string): string {
  return html
    .replace(/<(script|style|iframe|object|embed|link|meta)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|style|iframe|object|embed|link|meta)\b[^>]*\/?\s*>/gi, '')
    .replace(/\s+on[a-z][\w:-]*\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(
      /\s+(href|src)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,
      (match, attr: string, raw: string) => {
        const value = raw.replace(/^['"]|['"]$/g, '').trim();
        const decoded = normalizedUrlForProtocolCheck(value);
        return /^(javascript|data|vbscript):/i.test(decoded)
          ? ''
          : `${match.startsWith(' ') ? ' ' : ''}${attr}=${raw}`;
      }
    );
}

/** marked → HTML, unsafe tags/attrs stripped, h2/h3 given ids; returns body + TOC entries. */
function renderBody(markdown: string): { body: string; toc: Array<{ text: string; id: string }> } {
  let body = stripUnsafeHtml(marked.parse(markdown) as string);
  const toc: Array<{ text: string; id: string }> = [];
  body = body.replace(/<h2>([\s\S]*?)<\/h2>/g, (_m, inner: string) => {
    const text = decodeHtmlEntities(inner.replace(/<[^>]+>/g, '').trim());
    const id = slug(text);
    toc.push({ text, id });
    return `<h2 id="${id}">${inner}</h2>`;
  });
  return { body, toc };
}

// Per-theme visual identity — palette + masthead/body fonts. The theme changes
// not just the prose voice (server/daily-news-themes.ts) and hero-image style,
// but the look of the rendered paper itself, so a sampled edition LOOKS like its
// theme. Each theme is a complete, fixed palette (no auto dark-mode switch — the
// aesthetic is deliberate; noir is meant to be dark). Fonts are web-safe stacks
// (the edition is self-contained, no remote font loads).
interface ThemeStyle {
  bg: string;
  fg: string;
  muted: string;
  accent: string;
  rule: string;
  card: string;
  /** `font` shorthand for the masthead <h1>. */
  masthead: string;
  /** `font` shorthand for the body. */
  body: string;
}

const THEME_STYLES: Record<string, ThemeStyle> = {
  // Classic sepia paper of record (also the fallback for older, theme-less editions).
  standard: {
    bg: '#f7f4ed',
    fg: '#1a1814',
    muted: '#6b6457',
    accent: '#7c2d12',
    rule: '#d9d2c4',
    card: '#fffdf8',
    masthead: "800 clamp(34px,6vw,58px)/1.05 Georgia,'Times New Roman',serif",
    body: "18px/1.6 Georgia,'Times New Roman',serif",
  },
  // The Economist: crisp white, signature red accent, serif.
  economist: {
    bg: '#ffffff',
    fg: '#121212',
    muted: '#6b6b6b',
    accent: '#e3120b',
    rule: '#e1e1e1',
    card: '#f6f6f6',
    masthead: "800 clamp(34px,6vw,56px)/1.05 Georgia,'Times New Roman',serif",
    body: "17px/1.65 Georgia,'Times New Roman',serif",
  },
  // Morning Brew: bright, friendly, modern sans.
  brew: {
    bg: '#fffef7',
    fg: '#16182b',
    muted: '#6a6c84',
    accent: '#2b50aa',
    rule: '#ece7d5',
    card: '#fff8de',
    masthead: "800 clamp(32px,6vw,54px)/1.05 system-ui,'Segoe UI',Helvetica,sans-serif",
    body: "17px/1.65 system-ui,'Segoe UI',Helvetica,sans-serif",
  },
  // Equity research desk: cool, professional, tight sans.
  analyst: {
    bg: '#f4f6f8',
    fg: '#0f1722',
    muted: '#5a6b7b',
    accent: '#0a6cff',
    rule: '#d5dde6',
    card: '#ffffff',
    masthead: "800 clamp(30px,5.5vw,50px)/1.05 system-ui,'Segoe UI',Helvetica,sans-serif",
    body: "16px/1.6 system-ui,'Segoe UI',Helvetica,sans-serif",
  },
  // Tabloid: punchy, high-contrast, heavy condensed masthead.
  tabloid: {
    bg: '#fffef9',
    fg: '#0a0a0a',
    muted: '#555555',
    accent: '#d6001c',
    rule: '#111111',
    card: '#ffffff',
    masthead:
      "900 clamp(40px,8vw,74px)/.92 Impact,Haettenschweiler,'Arial Narrow',system-ui,sans-serif",
    body: "17px/1.55 system-ui,'Segoe UI',Helvetica,sans-serif",
  },
  // Noir: moody dark monochrome with a dim gold accent.
  noir: {
    bg: '#141318',
    fg: '#e7e5e0',
    muted: '#8f8b84',
    accent: '#c2a24a',
    rule: '#2c2a31',
    card: '#1c1b21',
    masthead: "800 clamp(34px,6vw,56px)/1.05 'Iowan Old Style',Georgia,serif",
    body: "18px/1.65 'Iowan Old Style',Georgia,'Times New Roman',serif",
  },
  // Victorian gazette: ornate parchment, period serif.
  victorian: {
    bg: '#f3e9cf',
    fg: '#2b2118',
    muted: '#7a6a4f',
    accent: '#6b4423',
    rule: '#cbb78c',
    card: '#faf3dd',
    masthead: "800 clamp(34px,6vw,58px)/1.05 'Palatino Linotype',Palatino,Georgia,serif",
    body: "18px/1.7 'Palatino Linotype',Palatino,Georgia,serif",
  },
};

/** Visual style for a theme id; falls back to the classic sepia paper. */
function themeStyle(id?: string): ThemeStyle {
  return THEME_STYLES[id ?? 'standard'] ?? THEME_STYLES.standard;
}

/** Build the self-contained stylesheet for a given theme's palette + fonts. */
function buildCss(s: ThemeStyle): string {
  return `
:root { --bg:${s.bg}; --fg:${s.fg}; --muted:${s.muted}; --accent:${s.accent}; --rule:${s.rule}; --card:${s.card}; }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:${s.body}; }
.paper { max-width:980px; margin:0 auto; padding:0 28px 72px; }
.masthead { text-align:center; padding:36px 0 12px; border-bottom:3px double var(--fg); }
.masthead h1 { font:${s.masthead}; letter-spacing:-.01em; margin:0; }
.dateline { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;
  font:600 12px/1 system-ui,sans-serif; letter-spacing:.14em; text-transform:uppercase; color:var(--muted);
  border-bottom:1px solid var(--rule); padding:10px 0; margin-bottom:8px; }
.badge { color:var(--accent); }
.index { background:var(--card); border:1px solid var(--rule); border-radius:6px; padding:12px 18px; margin:18px 0 4px;
  font:13px/1.5 system-ui,sans-serif; }
.index .label { font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); margin-right:8px; }
.index a { color:var(--fg); text-decoration:none; margin-right:14px; white-space:nowrap; }
.index a:hover { color:var(--accent); text-decoration:underline; }
.edition { columns:2 320px; column-gap:34px; margin-top:22px; }
.edition > p:first-of-type { font-size:1.06em; }
.edition h2 { font-weight:800; font-size:22px; line-height:1.2; margin:0 0 .4em; padding-top:.3em; color:var(--fg);
  border-top:2px solid var(--fg); break-after:avoid; column-span:all; }
.edition h3 { font:700 16px/1.3 system-ui,sans-serif; margin:1.1em 0 .3em; }
.edition p { margin:0 0 .8em; }
.edition ul,.edition ol { margin:.2em 0 .9em; padding-left:1.2em; }
.edition li { margin:.25em 0; }
.edition a { color:var(--accent); }
.edition blockquote { border-left:3px solid var(--accent); margin:.8em 0; padding:.1em .9em; color:var(--muted); font-style:italic; }
.edition table { border-collapse:collapse; width:100%; font:13px/1.4 system-ui,sans-serif; margin:.6em 0; }
.edition th,.edition td { border:1px solid var(--rule); padding:5px 8px; text-align:left; }
.hero-img { display:block; width:100%; max-height:360px; object-fit:cover; border-radius:8px; margin:0 0 14px; }
.source-notes { margin-top:28px; border-top:1px solid var(--rule); padding-top:14px; color:var(--muted); font:12px/1.5 system-ui,sans-serif; }
.source-notes h2 { font:700 12px/1 system-ui,sans-serif; letter-spacing:.1em; text-transform:uppercase; margin:0 0 8px; color:var(--muted); }
.source-notes ul { margin:.2em 0 0; padding-left:1.2em; }
footer { margin-top:40px; border-top:1px solid var(--rule); padding-top:16px; color:var(--muted);
  font:12px/1.5 system-ui,sans-serif; text-align:center; }
.weather { display:flex; gap:6px; overflow-x:auto; margin:14px 0 2px; padding:10px 0;
  border-top:1px solid var(--rule); border-bottom:1px solid var(--rule); }
.weather .wx-label { font:700 11px/1 system-ui,sans-serif; letter-spacing:.1em; text-transform:uppercase;
  color:var(--muted); align-self:center; padding-right:8px; white-space:nowrap; }
.wx-day { flex:1 0 auto; min-width:62px; text-align:center; font:12px/1.4 system-ui,sans-serif; }
.wx-day .d { font-weight:700; color:var(--muted); text-transform:uppercase; font-size:10px; letter-spacing:.04em; }
.wx-day .ico { font-size:18px; }
.wx-day .t { color:var(--fg); white-space:nowrap; }
.wx-day .t .lo { color:var(--muted); }
.wx-day .p { color:var(--accent); font-size:10px; }
@media (max-width:640px) { .edition { columns:1; } }
@media print { .edition { columns:2; } }
`.trim();
}

/** A compact week-ahead weather strip (a newspaper "weather corner"), themed via
 *  the palette vars. Empty string when the edition carries no forecast. */
function renderWeatherBox(w: Edition['weather']): string {
  if (!w || !w.days.length) return '';
  const days = w.days
    .map((d) => {
      const day = new Date(`${d.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' });
      const precip = d.precipPct >= 20 ? `<div class="p">${d.precipPct}%</div>` : '';
      return (
        `<div class="wx-day"><div class="d">${escapeHtml(day)}</div>` +
        `<div class="ico">${d.emoji}</div>` +
        `<div class="t">${d.hi}°<span class="lo"> ${d.lo}°</span></div>${precip}</div>`
      );
    })
    .join('');
  return `<div class="weather"><span class="wx-label">${escapeHtml(w.label)} · °${w.units}</span>${days}</div>`;
}

/** Email-safe weather row — a <table> with fully inline styles (email clients
 *  strip <style> blocks + classes, so the class-based renderWeatherBox above
 *  won't show; this is the same forecast laid out for the inline email body). */
function renderWeatherEmail(w: Edition['weather'], s: ReturnType<typeof themeStyle>): string {
  if (!w || !w.days.length) return '';
  const cells = w.days
    .map((d) => {
      const day = new Date(`${d.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' });
      const precip =
        d.precipPct >= 20
          ? `<div style="color:${s.accent};font-size:10px;">${d.precipPct}%</div>`
          : '';
      return (
        `<td style="text-align:center;padding:4px 6px;font-family:system-ui,sans-serif;vertical-align:top;">` +
        `<div style="font-weight:700;color:${s.muted};text-transform:uppercase;font-size:10px;letter-spacing:.04em;">${escapeHtml(day)}</div>` +
        `<div style="font-size:18px;line-height:1.3;">${d.emoji}</div>` +
        `<div style="font-size:12px;color:${s.fg};white-space:nowrap;">${d.hi}°<span style="color:${s.muted};"> ${d.lo}°</span></div>` +
        `${precip}</td>`
      );
    })
    .join('');
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:4px 0 18px;border-collapse:collapse;border-top:1px solid ${s.rule};border-bottom:1px solid ${s.rule};">` +
    `<tr><td style="font:700 11px/1 system-ui,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:${s.muted};padding:8px 6px;white-space:nowrap;vertical-align:middle;">${escapeHtml(
      w.label
    )} · °${w.units}</td>${cells}</tr></table>`
  );
}

function renderSourceNotes(edition: Edition): string {
  const warnings = edition.digestMeta?.sourceWarnings ?? [];
  if (!warnings.length) return '';
  const items = warnings
    .map((w) => `<li><strong>${escapeHtml(w.source)}</strong>: ${escapeHtml(w.message)}</li>`)
    .join('');
  return `<aside class="source-notes"><h2>Source notes</h2><p>Some sources could not be read while this edition was composed:</p><ul>${items}</ul></aside>`;
}

function renderSourceNotesEmail(edition: Edition, s: ReturnType<typeof themeStyle>): string {
  const warnings = edition.digestMeta?.sourceWarnings ?? [];
  if (!warnings.length) return '';
  const items = warnings
    .map((w) => `<li><strong>${escapeHtml(w.source)}</strong>: ${escapeHtml(w.message)}</li>`)
    .join('');
  return (
    `<div style="margin-top:24px;border-top:1px solid ${s.rule};padding-top:14px;color:${s.muted};font:13px/1.5 system-ui,sans-serif;">` +
    `<div style="font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin-bottom:6px;">Source notes</div>` +
    `<p style="margin:0 0 8px;">Some sources could not be read while this edition was composed:</p><ul style="margin:.2em 0 0;padding-left:1.2em;">${items}</ul></div>`
  );
}

/** The full, self-contained newspaper edition (download + in-app "view as newspaper"). */
export function renderEditionHtml(edition: Edition, heroSrc?: string): string {
  const css = buildCss(themeStyle(edition.theme));
  const { body, toc } = renderBody(edition.body ?? '');
  const weatherHtml = renderWeatherBox(edition.weather);
  const safeHeroSrc = safeHeroUrlAttr(heroSrc);
  const hero = safeHeroSrc ? `<img class="hero-img" src="${safeHeroSrc}" alt="">` : '';
  const sourceNotes = renderSourceNotes(edition);
  const indexHtml = toc.length
    ? `<nav class="index"><span class="label">In this edition</span>${toc
        .map((t) => `<a href="#${t.id}">${escapeHtml(t.text)}</a>`)
        .join('')}</nav>`
    : '';
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(
    edition.title ?? 'Daily News'
  )} — ${escapeHtml(edition.editionDate)}</title><style>${css}</style></head>
<body>
<div class="paper">
  ${hero}
  <header class="masthead"><h1>${escapeHtml(edition.title ?? 'Daily News')}</h1></header>
  <div class="dateline"><span>${escapeHtml(formatEditionDate(edition.editionDate))}</span><span class="badge">${editionBadge(
    edition
  )}</span></div>
  ${weatherHtml}
  ${indexHtml}
  <article class="edition">${body}</article>
  ${sourceNotes}
  <footer>Generated by DocVault · ${escapeHtml(edition.editionDate)}</footer>
</div>
</body></html>`;
}

/** Email-safe variant: single column, inline-styled masthead, no media queries.
 *  The fully-formatted edition is attached as an .html file alongside. */
export function renderEditionEmailHtml(edition: Edition, heroSrc?: string): string {
  const s = themeStyle(edition.theme);
  const { body } = renderBody(edition.body ?? '');
  const safeHeroSrc = safeHeroUrlAttr(heroSrc);
  const hero = safeHeroSrc
    ? `<img src="${safeHeroSrc}" alt="" style="display:block;width:100%;max-height:320px;object-fit:cover;border-radius:8px;margin:0 0 14px;">`
    : '';
  const sourceNotes = renderSourceNotesEmail(edition, s);
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;background:${s.bg};color:${s.fg};font-family:Georgia,'Times New Roman',serif;">
<div style="max-width:660px;margin:0 auto;padding:24px 22px 48px;">
  ${hero}
  <h1 style="font-family:Georgia,serif;font-weight:800;font-size:34px;line-height:1.1;text-align:center;margin:8px 0 4px;border-bottom:3px double ${s.fg};padding-bottom:10px;">${escapeHtml(
    edition.title ?? 'Daily News'
  )}</h1>
  <div style="font:600 12px/1 system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:${s.muted};text-align:center;margin:0 0 18px;">${escapeHtml(
    formatEditionDate(edition.editionDate)
  )} · ${editionBadge(edition)}</div>
  ${renderWeatherEmail(edition.weather, s)}
  <div style="font-size:16px;line-height:1.6;">${body}</div>
  ${sourceNotes}
  <p style="margin-top:28px;padding-top:16px;border-top:1px solid ${s.rule};color:${s.muted};font:13px/1.6 system-ui,sans-serif;">
    📎 The fully formatted edition is attached as an HTML file — open it for the two-column newspaper layout.<br>
    Generated by DocVault.
  </p>
</div>
</body></html>`;
}
