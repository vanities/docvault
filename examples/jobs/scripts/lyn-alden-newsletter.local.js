#!/usr/bin/env node
/**
 * lyn-alden-newsletter.local.js — scrape Lyn Alden's free monthly newsletter
 * and file new issues into DocVault's Research store (Finance).
 *
 * WHY SCRAPE, NOT RSS
 *   lynalden.com is WordPress, but the RSS paths don't work for this:
 *     - the main feed (/feed/) holds only the 10 latest *posts* (books,
 *       articles, newsletters all mixed) and carries no full text — the June
 *       2026 newsletter isn't even in it;
 *     - /investing-newsletter/feed/ is empty.
 *   The reliable source is the static archive page, which lists *every* issue
 *   as a predictable .../{month}-{year}-newsletter/ URL. So we scrape the
 *   archive index, then fetch each issue page and pull its <article> body.
 *
 * WHERE THIS RUNS
 *   In-container as a DocVault custom job (bun run), or on the NAS host with
 *   Node 22+. Talks to the running container over http://localhost:3005. No npm
 *   deps (global fetch + node:fs/promises only).
 *
 * WHAT IT DOES
 *   1. Fetch the archive index and parse out every newsletter URL (newest 1st).
 *   2. File the newest LIMIT *unseen* issues: fetch each page, extract the
 *      entry-content prose + og:title + JSON-LD publish date, POST to
 *      /api/research/text (domain=finance) — the same store the Quant Research
 *      tab reads.
 *   3. Dedup via SEEN_FILE; only mark an issue seen on a successful POST.
 *
 * FORWARD-ONLY (the important bit)
 *   The archive shows the *entire* back catalogue (~60 issues), so a naive
 *   "newest unseen, capped at LIMIT" would crawl backwards LIMIT-per-run and
 *   slowly ingest all of history. To stay forward-only, the FIRST run files the
 *   newest LIMIT and records *every other* archive URL as already-seen — so
 *   later runs only pick up issues published after install.
 *
 * BACKFILL (opt-in, one-off)
 *   To grab the back catalogue instead, run once with DOCVAULT_JOB_BACKFILL=1
 *   and a raised DOCVAULT_JOB_LIMIT, e.g. on the NAS:
 *     DOCVAULT_JOB_BACKFILL=1 DOCVAULT_JOB_LIMIT=100 \
 *       bun run <data>/jobs/scripts/lyn-alden-newsletter.local.js
 *   Backfill files the newest LIMIT unseen issues and does NOT mark the rest
 *   seen, so you can repeat it to walk further back.
 *
 * TUNING
 *   DOCVAULT_JOB_LIMIT  newest issues to file per run (default 3).
 *   DOCVAULT_JOB_BACKFILL=1  ignore forward-only seeding (see above).
 *   DRY_RUN=1 / DOCVAULT_DRY_RUN=1  print what would be filed, write nothing.
 */

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

// --- Config -----------------------------------------------------------------

const SITE = 'https://www.lynalden.com';
const ARCHIVE_URL = `${SITE}/newsletter-archives/`;
const API_BASE = process.env.DOCVAULT_API ?? 'http://localhost:3005';
// In-container the runner injects DOCVAULT_DATA_DIR; on a bare host fall back to
// the appdata dir. The ledger sits beside the other .docvault-* state files so
// it's excluded from entity listings + Dropbox sync.
const STATE_DIR =
  process.env.LYN_STATE_DIR ?? process.env.DOCVAULT_DATA_DIR ?? '/mnt/user/appdata/docvault';
const SEEN_FILE = `${STATE_DIR}/.docvault-lyn-alden-seen.json`;
const SEEN_MAX = 500; // ~12 issues/yr — decades of headroom; cheap insurance
const FETCH_UA = 'Mozilla/5.0 (DocVault Lyn Alden cron)';

// Parse a boolean env var. Env values are always strings, and the runner
// injects DOCVAULT_DRY_RUN="0" for real runs — so `!!process.env.X` is WRONG
// (`!!"0"` is true). Only "1"/"true"/"yes" count as on.
function envFlag(value) {
  return value === '1' || value === 'true' || value === 'yes';
}

// Newest N to file per run. Default 3 caps the first run (empty ledger) so we
// don't dump the whole back catalogue; afterwards only genuinely-new issues are
// unseen. See BACKFILL above to ingest history on purpose.
const LIMIT = Math.max(1, Number(process.env.DOCVAULT_JOB_LIMIT ?? '3') || 3);
const BACKFILL = envFlag(process.env.DOCVAULT_JOB_BACKFILL) || envFlag(process.env.LYN_BACKFILL);
const DRY_RUN =
  envFlag(process.env.DRY_RUN) ||
  envFlag(process.env.DOCVAULT_DRY_RUN) ||
  envFlag(process.env.DOCVAULT_JOB_DRY_RUN);
const MIN_BODY_CHARS = 800; // guard: a real newsletter is many KB; less ⇒ a
// layout change broke extraction — fail loudly, don't file junk or mark seen.

const DOMAIN = 'finance';
const AUTHOR = 'Lyn Alden';
const PUBLISHER = 'Lyn Alden';

const MONTHS = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

// --- Text helpers (mirrors zerohedge-research.local.js) ---------------------

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
};

function safeCodePoint(cp) {
  try {
    return String.fromCodePoint(cp);
  } catch {
    return '';
  }
}

/** Decode XML/HTML entities (numeric hex, numeric decimal, named). */
function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => safeCodePoint(parseInt(n, 10)))
    .replace(/&([a-z]+\d?);/gi, (m, name) =>
      name.toLowerCase() in NAMED_ENTITIES ? NAMED_ENTITIES[name.toLowerCase()] : m
    );
}

/** Strip HTML to readable plain text, keeping paragraph breaks. */
function stripHtml(html) {
  return html
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// --- Archive parsing --------------------------------------------------------

/** Parse the archive index into [{url, ts, label}] sorted newest-first. The
 *  slug encodes the date ({month}-{year}-newsletter), so we sort on that rather
 *  than trusting page order, and skip the /investing-newsletter/ signup page
 *  (no month → not a real issue). */
function parseArchive(html) {
  const re = /https?:\/\/(?:www\.)?lynalden\.com\/([a-z]+)-(20\d\d)-newsletter\/?/gi;
  const seen = new Set();
  const items = [];
  let m;
  while ((m = re.exec(html))) {
    const month = m[1].toLowerCase();
    const year = Number(m[2]);
    const mo = MONTHS[month];
    if (mo === undefined) continue;
    const url = `${SITE}/${month}-${year}-newsletter/`;
    if (seen.has(url)) continue;
    seen.add(url);
    items.push({
      url,
      ts: Date.UTC(year, mo, 1),
      label: `${month[0].toUpperCase()}${month.slice(1)} ${year}`,
    });
  }
  items.sort((a, b) => b.ts - a.ts);
  return items;
}

// --- Article parsing --------------------------------------------------------

/** Extract the inner HTML of the article's entry-content container by
 *  brace-matching <div>/</div> from its opening tag. WordPress renders the
 *  related-posts menu, the book/Premium-membership widgets, and the footer as
 *  *siblings after* entry-content, so finding its real close structurally
 *  excludes all of them — far more robust than guessing trailing-text markers,
 *  which break as Lyn rotates which book/promo she features. */
function extractEntryContent(html) {
  const open = html.match(/<div[^>]*class=["'][^"']*\bentry-content\b[^"']*["'][^>]*>/i);
  if (!open) return '';
  const start = open.index + open[0].length;
  let depth = 1;
  const tag = /<(\/?)div\b[^>]*>/gi;
  tag.lastIndex = start;
  let m;
  while ((m = tag.exec(html))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index);
  }
  return html.slice(start); // unbalanced markup — fall back to the remainder
}

function metaContent(html, prop) {
  // Tolerate attribute order: property before or after content.
  const a = html.match(
    new RegExp(`<meta[^>]+property=["']${prop}["'][^>]*content=["']([^"']*)["']`, 'i')
  );
  if (a) return a[1];
  const b = html.match(
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*property=["']${prop}["']`, 'i')
  );
  return b ? b[1] : '';
}

/** Pull {title, reportDate, body} from an issue page.
 *   - title: og:title (falls back to <title>)
 *   - reportDate: JSON-LD datePublished, else article:published_time meta
 *   - body: the entry-content region, cut at the first trailing-boilerplate
 *     marker (article footer / share / related posts / comments). */
function extractArticle(html, url) {
  const rawTitle =
    metaContent(html, 'og:title') ||
    (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] ||
    url;
  const title = decodeEntities(rawTitle).replace(/\s+/g, ' ').trim();

  let reportDate = '';
  const ld = html.match(/"datePublished"\s*:\s*"([^"]+)"/i);
  if (ld) reportDate = ld[1].slice(0, 10);
  if (!reportDate) {
    const meta = metaContent(html, 'article:published_time');
    if (meta) reportDate = meta.slice(0, 10);
  }

  let inner = extractEntryContent(html);
  // Drop the trailing Social Warfare share panel (renders as "Tweet/Share/…").
  // Match the whole opening <div …> so we cut on a tag boundary (slicing at the
  // class substring would strand a "<div class=\"" fragment that stripHtml, which
  // only removes complete tags, can't clean up). Guard to the back half so a
  // hypothetical top-of-post panel could never truncate the article.
  const swp = inner.match(
    /<div[^>]*class=["'][^"']*(?:swp-hidden-panel-wrap|swp_social_panel)[^"']*["'][^>]*>/i
  );
  if (swp && swp.index > inner.length / 2) inner = inner.slice(0, swp.index);
  inner = inner.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  const body = decodeEntities(stripHtml(inner));
  return { title, reportDate, body };
}

// --- Dedup ledger -----------------------------------------------------------

async function loadSeen() {
  try {
    const arr = JSON.parse(await readFile(SEEN_FILE, 'utf8'));
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

async function saveSeen(arr) {
  await mkdir(dirname(SEEN_FILE), { recursive: true });
  const tmp = `${SEEN_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(arr.slice(-SEEN_MAX)));
  await rename(tmp, SEEN_FILE); // atomic swap — never truncate the live file
}

// --- Ingest -----------------------------------------------------------------

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'user-agent': FETCH_UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function postEntry(payload) {
  const res = await fetch(`${API_BASE}/api/research/text`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${detail.slice(0, 200)}`);
  }
  return res.json();
}

// --- Main -------------------------------------------------------------------

async function main() {
  const seen = await loadSeen();
  const firstRun = seen.size === 0;

  const archiveHtml = await fetchText(ARCHIVE_URL);
  const all = parseArchive(archiveHtml);
  if (all.length === 0) {
    throw new Error('parsed 0 newsletters — archive page shape may have changed');
  }

  const unseen = all.filter((it) => !seen.has(it.url));
  const toFile = unseen.slice(0, LIMIT); // newest-first already

  let posted = 0;
  let failed = 0;
  const newlySeen = [];

  for (const it of toFile) {
    if (DRY_RUN) {
      // Fetch so we can show what extraction yields, but write nothing.
      try {
        const html = await fetchText(it.url);
        const { title, reportDate, body } = extractArticle(html, it.url);
        const ok = body.length >= MIN_BODY_CHARS;
        console.log(
          `[dry] ${ok ? 'FILE ' : 'SKIP '}${it.label.padEnd(14)} ${reportDate || '?'}  ${body.length} chars  "${title}"`
        );
        if (!ok) console.log(`      └─ body too short (${body.length} < ${MIN_BODY_CHARS})`);
        else if (process.env.SHOW_BODY)
          console.log(`      └─ ${body.replace(/\n+/g, ' ⏎ ').slice(0, 240)}…`);
      } catch (err) {
        console.error(`[dry] ERROR ${it.label}: ${err.message}`);
      }
      continue;
    }

    try {
      const html = await fetchText(it.url);
      const { title, reportDate, body } = extractArticle(html, it.url);
      if (body.length < MIN_BODY_CHARS) {
        throw new Error(
          `extracted body too short (${body.length} chars) — extraction may be broken`
        );
      }
      const header = `[Lyn Alden newsletter — ${it.label}${reportDate ? `, published ${reportDate}` : ''} — ${it.url}]`;
      await postEntry({
        text: `${header}\n\n${body}`,
        title,
        author: AUTHOR,
        publisher: PUBLISHER,
        reportDate: reportDate || undefined,
        sourceUrl: it.url,
        domain: DOMAIN,
        tags: ['lyn-alden', 'newsletter', 'macro', 'finance', 'auto'],
      });
      posted++;
      newlySeen.push(it.url); // only mark seen on success → transient failures retry
      console.log(`[lyn-alden] filed ${it.label} (${body.length} chars) — ${title}`);
    } catch (err) {
      failed++;
      console.error(`[lyn-alden] FAILED ${it.label} (${it.url}): ${err.message}`);
    }
  }

  // Forward-only seeding: on the first run, record the rest of the back
  // catalogue as seen so future runs only pick up newly-published issues. We
  // only seed issues we didn't *try* to file (toFile is handled per-success
  // above), so a failed newest issue still retries next run. Skipped entirely
  // in BACKFILL mode, where the whole archive is fair game.
  if (!DRY_RUN && firstRun && !BACKFILL) {
    const filedUrls = new Set(toFile.map((it) => it.url));
    for (const it of unseen) {
      if (!filedUrls.has(it.url)) newlySeen.push(it.url);
    }
  }

  if (!DRY_RUN && newlySeen.length) {
    await saveSeen([...seen, ...newlySeen]);
  }

  const stamp = new Date().toISOString();
  console.log(
    `[lyn-alden ${stamp}] archive=${all.length} unseen=${unseen.length} ` +
      `${DRY_RUN ? 'dry-run' : `posted=${posted} failed=${failed}`} ` +
      `firstRun=${firstRun} backfill=${BACKFILL} limit=${LIMIT} ` +
      `ledger=${DRY_RUN ? seen.size : Math.min(seen.size + newlySeen.length, SEEN_MAX)}`
  );
}

main().catch((err) => {
  console.error(`[lyn-alden] fatal: ${err.stack || err.message}`);
  process.exitCode = 1;
});
