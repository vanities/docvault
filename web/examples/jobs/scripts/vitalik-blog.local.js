#!/usr/bin/env node
/**
 * vitalik-blog.local.js — poll Vitalik Buterin's blog feed and file fresh posts
 * into DocVault's Research store under the `tech` domain (the "Tech" sidebar
 * view). They also flow into the Daily News edition's research digest.
 *
 * WHY THIS IS THE TWO-STAGE CASE
 *   Unlike the torrentfreak job this was cloned from, the feed is an *index*,
 *   not content: every <description> is empty and there is no <content:encoded>.
 *   So we use the feed only to learn which posts exist, then fetch each new
 *   post's page and extract the body from it — the lyn-alden pattern.
 *
 * THE DEAD-HOST GOTCHA
 *   Every <link> in the feed points at `vitalik.ca`, which publishes MX records
 *   but no A record — it does not resolve at all (curl exit 6). The live site is
 *   the IPFS/ENS gateway `vitalik.eth.limo`, same paths. We rewrite the host on
 *   every URL (canonicalUrl) *before* the dedup lookup, so the ledger is keyed on
 *   one stable form and a future host change can't re-file the whole archive.
 *
 * WHERE THIS RUNS
 *   Inside the DocVault container via the custom-job runner (`bun run`). It
 *   talks to the server over http://localhost:3005 and keeps its dedup ledger
 *   in DOCVAULT_DATA_DIR. No npm dependencies — global `fetch` only.
 *
 * WHAT IT DOES
 *   1. Fetch FEED_URL (RSS 2.0) → title / link / pubDate per post.
 *   2. Canonicalize each link onto SITE_HOST.
 *   3. Skip anything already filed (dedup ledger keyed by canonical URL).
 *   4. Fetch each new post, extract the <div id="doc"> body, POST it to
 *      /api/research/text with domain `tech`.
 *
 * FIRST RUN (forward-only) — LOAD-BEARING HERE
 *   The feed carries the ENTIRE back-catalogue (~170 posts), not a rolling
 *   window, and each page is ~550 KB because diagrams are inlined as base64
 *   data URIs. With an empty ledger we file only the newest FIRST_RUN_LIMIT and
 *   mark the rest seen, so enabling the job doesn't pull ~95 MB and flood
 *   Research with a decade of backlog. To ingest the whole archive on purpose:
 *   DOCVAULT_JOB_BACKFILL=1 (expect it to run for a while).
 *
 * STATE
 *   SEEN_FILE — dedup ledger of filed/skipped URLs (trimmed to SEEN_MAX).
 *   Only marked on a successful POST, so transient failures retry next run.
 */

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

// --- Config -----------------------------------------------------------------

const SITE_HOST = 'vitalik.eth.limo';
const FEED_URL = `https://${SITE_HOST}/feed.xml`;
const PUBLISHER = 'Vitalik Buterin';
const AUTHOR = 'Vitalik Buterin';

// Newest posts to file when the ledger is empty (first run). Kept small: the
// feed is the full archive, so this is the flood guard, not a rate limit.
const FIRST_RUN_LIMIT = 3;

// Per-run cap on article fetches. Vitalik posts roughly monthly, so a normal
// run does 0-1; this only bites on a backfill.
const MAX_FETCHES_PER_RUN = 12;

const API_BASE = process.env.DOCVAULT_API ?? 'http://localhost:3005';
const STATE_DIR =
  process.env.VITALIK_STATE_DIR ?? process.env.DOCVAULT_DATA_DIR ?? '/mnt/user/appdata/docvault';
const SEEN_FILE = `${STATE_DIR}/.docvault-vitalik-seen.json`;
const SEEN_MAX = 500;

// eth.limo is an ENS/IPFS gateway — slower and flakier than an origin server,
// and the pages are large. Generous timeout, a retry, and a polite pause
// between article fetches.
const FETCH_TIMEOUT_MS = 45_000;
const FETCH_RETRIES = 2;
const POLITE_DELAY_MS = 1_500;
const FETCH_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 DocVaultVitalik';

// Parse boolean env vars — never coerce with `!!`. The job runner injects
// DOCVAULT_DRY_RUN="0" for real runs and `!!"0"` is true, which would silently
// turn every real run into a dry run.
function envFlag(value) {
  return value === '1' || value === 'true' || value === 'yes';
}
const DRY_RUN =
  envFlag(process.env.DRY_RUN) ||
  envFlag(process.env.DOCVAULT_DRY_RUN) ||
  envFlag(process.env.DOCVAULT_JOB_DRY_RUN);
const BACKFILL = envFlag(process.env.DOCVAULT_JOB_BACKFILL);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Text helpers -----------------------------------------------------------

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
  times: '×',
  minus: '−',
};

function safeCodePoint(cp) {
  try {
    return String.fromCodePoint(cp);
  } catch {
    return '';
  }
}

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
    .replace(/<\/(p|div|h[1-6]|li|tr|pre|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripCdata(s) {
  const m = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(s);
  return m ? m[1] : s;
}

// --- Feed parsing -----------------------------------------------------------

/** Rewrite any post URL onto the live host. The feed still advertises the
 *  long-dead `vitalik.ca`; paths are identical, only the host moved. Also used
 *  as the dedup key so both forms collapse to one entry. */
function canonicalUrl(raw) {
  const url = raw.trim();
  if (!url) return '';
  try {
    const u = new URL(url);
    u.protocol = 'https:';
    u.host = SITE_HOST;
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

/** Parse RSS 2.0 into item objects. Regex is fine here: flat, predictable
 *  <item> blocks from a static site generator. */
function parseFeed(xml) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml))) {
    const block = m[1];
    const pick = (tag) => {
      const mm = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      return mm ? mm[1].trim() : '';
    };
    const link = canonicalUrl(stripCdata(pick('link')) || stripCdata(pick('guid')));
    items.push({
      title: decodeEntities(stripCdata(pick('title')))
        .replace(/\s+/g, ' ')
        .trim(),
      link,
      pubDate: pick('pubDate'),
    });
  }
  return items;
}

function toIsoDate(pubDate) {
  const d = new Date(pubDate);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

// --- Article parsing --------------------------------------------------------

/** Extract the inner HTML of the post body by brace-matching <div>/</div> from
 *  the opening <div id="doc" class="markdown-body …"> tag. Finding its real
 *  close structurally excludes the comment widget and footer that render as
 *  siblings after it. */
function extractDocBody(html) {
  const open = html.match(/<div[^>]*\bid=["']doc["'][^>]*>/i);
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

/** Pull the readable body out of a post page.
 *  Diagrams are inlined as base64 data URIs (~85% of the page weight), so
 *  <img> is replaced with a marker *before* text extraction — otherwise the
 *  research entry would be megabytes of base64. */
function extractArticle(html) {
  let inner = extractDocBody(html);
  if (!inner) return '';
  inner = inner
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<img\b[^>]*>/gi, '\n[image]\n')
    .replace(/<div[^>]*\bid=["']color-mode-switch["'][\s\S]*?<\/div>/i, '');
  return decodeEntities(stripHtml(inner));
}

// --- Fetch ------------------------------------------------------------------

async function fetchText(url, label) {
  let lastErr;
  for (let attempt = 1; attempt <= FETCH_RETRIES; attempt++) {
    const t0 = performance.now();
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': FETCH_UA },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      console.log(
        `[vitalik] fetched ${label} bytes=${text.length} in ${(performance.now() - t0).toFixed(0)}ms` +
          (attempt > 1 ? ` (attempt ${attempt})` : '')
      );
      return text;
    } catch (err) {
      lastErr = err;
      console.error(
        `[vitalik] fetch ${label} attempt ${attempt}/${FETCH_RETRIES} failed after ` +
          `${(performance.now() - t0).toFixed(0)}ms: ${err.message}`
      );
      if (attempt < FETCH_RETRIES) await sleep(POLITE_DELAY_MS * attempt);
    }
  }
  throw lastErr;
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
  await writeFile(tmp, JSON.stringify(arr));
  await rename(tmp, SEEN_FILE); // atomic swap — never truncate the live file
}

// --- Ingest -----------------------------------------------------------------

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
  const firstRun = seen.size === 0 && !BACKFILL;
  if (firstRun) {
    console.log(
      `[vitalik] empty ledger — forward-only first run: newest ${FIRST_RUN_LIMIT}, ` +
        'rest of the archive marked seen (DOCVAULT_JOB_BACKFILL=1 to ingest everything)'
    );
  }

  const t0 = performance.now();
  let xml;
  let items;
  try {
    xml = await fetchText(FEED_URL, 'feed');
    items = parseFeed(xml);
  } catch (err) {
    console.error(`[vitalik] feed fetch failed: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  if (items.length === 0) {
    if (/<(rss|channel)\b/i.test(xml)) {
      console.log('[vitalik] feed is valid but currently has no items');
    } else {
      console.error('[vitalik] returned no parseable RSS — feed shape may have changed');
      process.exitCode = 1;
    }
    return;
  }

  let matched = 0;
  let posted = 0;
  let skippedSeen = 0;
  let fetches = 0;
  const newlySeen = [];

  for (const it of items) {
    if (!it.link || seen.has(it.link) || newlySeen.includes(it.link)) {
      skippedSeen++;
      continue;
    }

    matched++;
    // Forward-only seeding: past the cap, record the URL as seen without filing
    // so the archive never floods in on later runs.
    if (firstRun && matched > FIRST_RUN_LIMIT) {
      newlySeen.push(it.link);
      continue;
    }

    const reportDate = toIsoDate(it.pubDate);

    if (DRY_RUN) {
      console.log(`[dry] ${reportDate || '?'} ${it.title} — ${it.link}`);
      posted++;
      continue;
    }

    if (fetches >= MAX_FETCHES_PER_RUN) {
      console.log(
        `[vitalik] hit MAX_FETCHES_PER_RUN=${MAX_FETCHES_PER_RUN} — ` +
          `${items.length - skippedSeen - matched + 1} remaining will be picked up next run`
      );
      break;
    }

    let body = '';
    try {
      fetches++;
      const html = await fetchText(it.link, it.title);
      body = extractArticle(html);
    } catch (err) {
      console.error(`[vitalik] article fetch failed for ${it.link}: ${err.message}`);
      continue; // not marked seen → retried next run
    }

    if (!body) {
      console.error(
        `[vitalik] no <div id="doc"> body found in ${it.link} — page layout may have changed`
      );
      continue; // not marked seen → retried next run
    }

    const header = `[vitalik.eth.limo via vitalik-blog job — published ${reportDate || '?'}]`;

    try {
      await postEntry({
        text: `${header}\n\n${body}`,
        title: it.title,
        author: AUTHOR,
        publisher: PUBLISHER,
        reportDate: reportDate || undefined,
        sourceUrl: it.link,
        domain: 'tech',
        tags: ['vitalik', 'auto', 'tech', 'ethereum', 'cryptography'],
      });
      posted++;
      newlySeen.push(it.link); // only mark seen on success → transient failures retry
      console.log(`[vitalik] filed "${it.title}" chars=${body.length}`);
    } catch (err) {
      console.error(`[vitalik] POST failed for ${it.link}: ${err.message}`);
    }

    await sleep(POLITE_DELAY_MS);
  }

  if (!DRY_RUN && newlySeen.length) {
    await saveSeen([...seen, ...newlySeen].slice(-SEEN_MAX));
  }

  console.log(
    `[vitalik ${new Date().toISOString()}] items=${items.length} matched=${matched} ` +
      `posted=${posted} skipped_seen=${skippedSeen} fetches=${fetches} ` +
      `in ${(performance.now() - t0).toFixed(0)}ms${DRY_RUN ? ' (dry run)' : ''}`
  );
}

main().catch((err) => {
  console.error(`[vitalik] fatal: ${err.stack || err.message}`);
  process.exitCode = 1;
});
