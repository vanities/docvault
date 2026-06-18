#!/usr/bin/env node
/**
 * torrentfreak-research.local.js — poll TorrentFreak's RSS feed and file fresh
 * articles into DocVault's Research store under the `tech` domain (the "Tech"
 * sidebar view). They also flow into the Daily News edition's research digest.
 *
 * WHY THIS IS THE SIMPLE CASE
 *   TorrentFreak is a single WordPress site whose /feed/ carries the FULL
 *   article body in <content:encoded>, and every story is on-topic for tech
 *   (piracy, copyright, privacy, site-blocking, DMCA). So unlike the
 *   local-news job this was cloned from, there's no per-feed filter and no
 *   place-name watchlist — we file the whole window, deduped.
 *
 * WHERE THIS RUNS
 *   Inside the DocVault container via the custom-job runner (`bun run`). It
 *   talks to the server over http://localhost:3005 and keeps its dedup ledger
 *   in DOCVAULT_DATA_DIR. No npm dependencies — global `fetch` only.
 *
 * WHAT IT DOES
 *   1. Fetch FEED_URL (RSS 2.0; CDATA + entity-escaped content tolerated).
 *   2. Drop anything matching EXCLUDE_LINK_RE (off by default).
 *   3. Skip anything already filed (dedup ledger keyed by article URL).
 *   4. POST the rest to /api/research/text with domain `tech`.
 *
 * FIRST RUN (forward-only)
 *   With an empty ledger, only the newest FIRST_RUN_LIMIT items are filed and
 *   the rest of the current window is marked seen — so enabling the job doesn't
 *   flood the inbox with a backlog. To ingest the whole current window on
 *   purpose: DOCVAULT_JOB_BACKFILL=1.
 *
 * STATE
 *   SEEN_FILE — dedup ledger of filed/skipped URLs (trimmed to SEEN_MAX).
 *   Only marked on a successful POST, so transient failures retry next run.
 */

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

// --- Config -----------------------------------------------------------------

const FEED_URL = 'https://torrentfreak.com/feed/';
const PUBLISHER = 'TorrentFreak';

// Dropped regardless — tune if a TF section ever turns into noise. Off by
// default (TF stories are all on-topic for the tech domain).
const EXCLUDE_LINK_RE = null; // e.g. /\/deals\//i

// Newest items to file when the ledger is empty (first run).
const FIRST_RUN_LIMIT = 5;

const API_BASE = process.env.DOCVAULT_API ?? 'http://localhost:3005';
const STATE_DIR =
  process.env.TORRENTFREAK_STATE_DIR ?? process.env.DOCVAULT_DATA_DIR ?? '/mnt/user/appdata/docvault';
const SEEN_FILE = `${STATE_DIR}/.docvault-torrentfreak-seen.json`;
const SEEN_MAX = 800;
const FETCH_TIMEOUT_MS = 20_000;
const FETCH_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 DocVaultTorrentFreak';

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

/** WordPress feeds wrap most fields in CDATA; unwrap before decoding. */
function stripCdata(s) {
  const m = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(s);
  return m ? m[1] : s;
}

/** Entity-escaped or CDATA HTML → clean plain text. Decoding twice is
 *  harmless for single-encoded feeds and fixes double-encoded ones. */
function toText(raw) {
  return decodeEntities(stripHtml(decodeEntities(stripCdata(raw))));
}

// --- Feed parsing -----------------------------------------------------------

/** Parse RSS 2.0 into item objects. Regex is fine here: flat, predictable
 *  <item> blocks from WordPress. */
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
    items.push({
      title: decodeEntities(stripCdata(pick('title')))
        .replace(/\s+/g, ' ')
        .trim(),
      link: stripCdata(pick('link')).trim(),
      pubDate: pick('pubDate'),
      author: decodeEntities(stripCdata(pick('dc:creator'))).trim(),
      descRaw: pick('description'),
      contentRaw: pick('content:encoded'),
    });
  }
  return items;
}

function toIsoDate(pubDate) {
  const d = new Date(pubDate);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
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
      `[torrentfreak] empty ledger — forward-only first run: newest ${FIRST_RUN_LIMIT}, ` +
        'rest of the current window marked seen (DOCVAULT_JOB_BACKFILL=1 to ingest everything)'
    );
  }

  const t0 = performance.now();
  let xml;
  let items;
  try {
    const res = await fetch(FEED_URL, {
      headers: { 'user-agent': FETCH_UA },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    xml = await res.text();
    items = parseFeed(xml);
  } catch (err) {
    console.error(`[torrentfreak] feed fetch failed: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  if (items.length === 0) {
    if (/<(rss|channel)\b/i.test(xml)) {
      console.log('[torrentfreak] feed is valid but currently has no items');
    } else {
      console.error('[torrentfreak] returned no parseable RSS — feed shape may have changed');
      process.exitCode = 1;
    }
    return;
  }

  let matched = 0;
  let posted = 0;
  let skippedSeen = 0;
  const newlySeen = [];

  for (const it of items) {
    if (!it.link || seen.has(it.link)) {
      skippedSeen++;
      continue;
    }
    if (EXCLUDE_LINK_RE && EXCLUDE_LINK_RE.test(it.link)) continue;

    matched++;
    // Forward-only seeding: past the cap, record the URL as seen without filing
    // so the backlog never floods in on later runs.
    if (firstRun && matched > FIRST_RUN_LIMIT) {
      newlySeen.push(it.link);
      continue;
    }

    const summary = toText(it.descRaw);
    const fullBody = it.contentRaw ? toText(it.contentRaw) : '';
    const body = fullBody || summary;
    const reportDate = toIsoDate(it.pubDate);
    const header = `[TorrentFreak RSS via torrentfreak-research job — published ${reportDate || '?'}]`;

    if (DRY_RUN) {
      console.log(`[dry] ${it.title}`);
      posted++;
      continue;
    }

    try {
      await postEntry({
        text: `${header}\n\n${body || it.title}`,
        title: it.title,
        author: it.author || undefined,
        publisher: PUBLISHER,
        reportDate: reportDate || undefined,
        sourceUrl: it.link,
        domain: 'tech',
        tags: ['torrentfreak', 'auto', 'tech', 'piracy', 'copyright'],
      });
      posted++;
      newlySeen.push(it.link); // only mark seen on success → transient failures retry
    } catch (err) {
      console.error(`[torrentfreak] POST failed for ${it.link}: ${err.message}`);
    }
  }

  if (!DRY_RUN && newlySeen.length) {
    await saveSeen([...seen, ...newlySeen].slice(-SEEN_MAX));
  }

  console.log(
    `[torrentfreak ${new Date().toISOString()}] items=${items.length} matched=${matched} ` +
      `posted=${posted} skipped_seen=${skippedSeen} in ${(performance.now() - t0).toFixed(0)}ms` +
      `${DRY_RUN ? ' (dry run)' : ''}`
  );
}

main().catch((err) => {
  console.error(`[torrentfreak] fatal: ${err.stack || err.message}`);
  process.exitCode = 1;
});
