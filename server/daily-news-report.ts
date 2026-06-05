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

/** marked → HTML, <script> stripped, h2/h3 given ids; returns body + TOC entries. */
function renderBody(markdown: string): { body: string; toc: Array<{ text: string; id: string }> } {
  let body = (marked.parse(markdown) as string).replace(/<script[\s\S]*?<\/script>/gi, '');
  const toc: Array<{ text: string; id: string }> = [];
  body = body.replace(/<h2>([\s\S]*?)<\/h2>/g, (_m, inner: string) => {
    const text = inner.replace(/<[^>]+>/g, '').trim();
    const id = slug(text);
    toc.push({ text, id });
    return `<h2 id="${id}">${inner}</h2>`;
  });
  return { body, toc };
}

const CSS = `
:root { --bg:#f7f4ed; --fg:#1a1814; --muted:#6b6457; --accent:#7c2d12; --rule:#d9d2c4; --card:#fffdf8; }
@media (prefers-color-scheme: dark) { :root { --bg:#16140f; --fg:#ece7dd; --muted:#9c9486; --accent:#d98a5a; --rule:#322d24; --card:#1d1a14; } }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:18px/1.6 Georgia,'Times New Roman',serif; }
.paper { max-width:980px; margin:0 auto; padding:0 28px 72px; }
.masthead { text-align:center; padding:36px 0 12px; border-bottom:3px double var(--fg); }
.masthead h1 { font:800 clamp(34px,6vw,58px)/1.05 'Playfair Display',Georgia,serif; letter-spacing:-.01em; margin:0; }
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
.edition h2 { font:800 22px/1.2 Georgia,serif; margin:0 0 .4em; padding-top:.3em; color:var(--fg);
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
footer { margin-top:40px; border-top:1px solid var(--rule); padding-top:16px; color:var(--muted);
  font:12px/1.5 system-ui,sans-serif; text-align:center; }
@media (max-width:640px) { .edition { columns:1; } }
@media print { body { background:#fff; } .edition { columns:2; } }
`.trim();

/** The full, self-contained newspaper edition (download + in-app "view as newspaper"). */
export function renderEditionHtml(edition: Edition, heroSrc?: string): string {
  const { body, toc } = renderBody(edition.body ?? '');
  const hero = heroSrc ? `<img class="hero-img" src="${heroSrc}" alt="">` : '';
  const indexHtml = toc.length
    ? `<nav class="index"><span class="label">In this edition</span>${toc
        .map((t) => `<a href="#${t.id}">${escapeHtml(t.text)}</a>`)
        .join('')}</nav>`
    : '';
  const when = edition.completedAt ?? edition.createdAt;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(
    edition.title ?? 'Daily News'
  )} — ${escapeHtml(edition.editionDate)}</title><style>${CSS}</style></head>
<body>
<div class="paper">
  ${hero}
  <header class="masthead"><h1>${escapeHtml(edition.title ?? 'Daily News')}</h1></header>
  <div class="dateline"><span>${escapeHtml(formatEditionDate(edition.editionDate))}</span><span class="badge">${editionBadge(
    edition
  )}</span></div>
  ${indexHtml}
  <article class="edition">${body}</article>
  <footer>Generated by DocVault · ${escapeHtml(new Date(when).toISOString().slice(0, 10))}</footer>
</div>
</body></html>`;
}

/** Email-safe variant: single column, inline-styled masthead, no media queries.
 *  The fully-formatted edition is attached as an .html file alongside. */
export function renderEditionEmailHtml(edition: Edition, heroSrc?: string): string {
  const { body } = renderBody(edition.body ?? '');
  const hero = heroSrc
    ? `<img src="${heroSrc}" alt="" style="display:block;width:100%;max-height:320px;object-fit:cover;border-radius:8px;margin:0 0 14px;">`
    : '';
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;background:#f7f4ed;color:#1a1814;font-family:Georgia,'Times New Roman',serif;">
<div style="max-width:660px;margin:0 auto;padding:24px 22px 48px;">
  ${hero}
  <h1 style="font-family:Georgia,serif;font-weight:800;font-size:34px;line-height:1.1;text-align:center;margin:8px 0 4px;border-bottom:3px double #1a1814;padding-bottom:10px;">${escapeHtml(
    edition.title ?? 'Daily News'
  )}</h1>
  <div style="font:600 12px/1 system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#6b6457;text-align:center;margin:0 0 18px;">${escapeHtml(
    formatEditionDate(edition.editionDate)
  )} · ${editionBadge(edition)}</div>
  <div style="font-size:16px;line-height:1.6;">${body}</div>
  <p style="margin-top:28px;padding-top:16px;border-top:1px solid #d9d2c4;color:#6b6457;font:13px/1.6 system-ui,sans-serif;">
    📎 The fully formatted edition is attached as an HTML file — open it for the two-column newspaper layout.<br>
    Generated by DocVault.
  </p>
</div>
</body></html>`;
}
