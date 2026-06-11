#!/usr/bin/env node
/**
 * local-news.local.js — poll a configurable set of local-news RSS feeds and
 * file fresh items into DocVault's Research store under the `local` domain
 * (the "Local" sidebar view). They also flow into the Daily News edition's
 * research digest automatically.
 *
 * WHERE THIS RUNS
 *   Inside the DocVault container via the custom-job runner (`bun run`). It
 *   talks to the server over http://localhost:3005 and keeps its dedup ledger
 *   in DOCVAULT_DATA_DIR. No npm dependencies — global `fetch` only.
 *
 * CONFIGURE FIRST (the seeded example ships empty on purpose)
 *   Fill in FEEDS with your town/county/state sources and LOCAL_TERMS with the
 *   place names that make a regional story "local". Most US local-news sites
 *   sit on one of three CMS families, each with a predictable feed URL:
 *
 *     CivicPlus (most city/county .gov sites — official announcements):
 *       https://www.<city>.gov/RSSFeed.aspx?ModID=1&CID=All-0
 *     TownNews / BLOX (many hometown papers):
 *       https://www.<paper>.com/search/?f=rss&t=article&l=25&s=start_time&sd=desc
 *     WordPress (indie outlets, States Newsroom affiliates, Nexstar TV sites):
 *       https://<outlet>.com/feed/
 *
 *   `filtered: false` files everything from a feed (official city/county
 *   feeds, hometown papers — already 100% local). `filtered: true` gates the
 *   feed on LOCAL_TERMS (statewide/metro outlets where only some stories
 *   concern your area).
 *
 * WHAT IT DOES
 *   1. Fetch each feed in FEEDS (RSS 2.0; tolerates CDATA + entity-escaped
 *      content from all three CMS families above).
 *   2. Keep items that pass the feed's filter and the global EXCLUDE_LINK_RE
 *      (obituaries/calendars are dropped by default).
 *   3. Skip anything already filed (dedup ledger keyed by article URL).
 *   4. POST the rest to /api/research/text with domain `local`.
 *
 * FIRST RUN (forward-only)
 *   With an empty ledger, only the newest FIRST_RUN_LIMIT matching items per
 *   feed are filed and the rest of the current window is marked seen — so
 *   enabling the job doesn't flood the inbox with a backlog. To ingest the
 *   whole current window on purpose: DOCVAULT_JOB_BACKFILL=1.
 *
 * STATE
 *   SEEN_FILE — dedup ledger of filed/skipped URLs (trimmed to SEEN_MAX).
 *   Only marked on a successful POST, so transient failures retry next run.
 */

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

// --- Config -----------------------------------------------------------------

// Your sources. See the CMS-family URL shapes in the header comment.
const FEEDS = [
  // { name: 'City News Flash', url: 'https://www.<city>.gov/RSSFeed.aspx?ModID=1&CID=All-0', filtered: false },
  // { name: 'County News Flash', url: 'https://www.<county>.gov/RSSFeed.aspx?ModID=1&CID=All-0', filtered: false },
  // { name: 'Hometown Paper', url: 'https://www.<paper>.com/search/?f=rss&t=article&l=25&s=start_time&sd=desc', filtered: false },
  // { name: 'Statewide Outlet', url: 'https://<outlet>.com/feed/', filtered: true },
  // { name: 'Metro TV Station', url: 'https://www.<station>.com/feed/', filtered: true },
];

// Place names that make a story from a `filtered` feed local to you. Matched
// case-insensitively, whole-word, against the headline + summary.
const LOCAL_TERMS = [
  // 'springfield',
  // 'example county',
];

// Dropped regardless of feed/filter — editorial noise in most paper feeds.
const EXCLUDE_LINK_RE = /obituar|\/calendar\//i;

// Match LOCAL_TERMS against headline + summary only (precise). Set true to
// also scan the full article body when the feed carries one (broader — a
// passing mention deep in a statewide story will qualify).
const MATCH_AGAINST_FULL_BODY = false;

// Newest matching items to file per feed when the ledger is empty (first run).
const FIRST_RUN_LIMIT = 3;

const API_BASE = process.env.DOCVAULT_API ?? 'http://localhost:3005';
const STATE_DIR =
  process.env.LOCAL_NEWS_STATE_DIR ?? process.env.DOCVAULT_DATA_DIR ?? '/mnt/user/appdata/docvault';
const SEEN_FILE = `${STATE_DIR}/.docvault-localnews-seen.json`;
const SEEN_MAX = 1200;
const FETCH_TIMEOUT_MS = 20_000;
// Some TownNews/CivicPlus hosts reject bare bot UAs; a browser-ish UA is fine.
const FETCH_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 DocVaultLocalNews';

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
 *  <item> blocks across all three CMS families this targets. */
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

// --- Local-term matching ----------------------------------------------------

// Whole-word matchers for plain terms; substring for terms with non-word
// characters where \b misbehaves.
const TERM_MATCHERS = LOCAL_TERMS.map((term) => {
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const plain = /^[a-z0-9 ]+$/i.test(term);
  return { term, re: new RegExp(plain ? `\\b${esc}\\b` : esc, 'i') };
});

function matchLocalTerms(haystack) {
  return TERM_MATCHERS.filter(({ re }) => re.test(haystack)).map(({ term }) => term);
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

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// --- Main -------------------------------------------------------------------

async function main() {
  if (FEEDS.length === 0) {
    console.error(
      '[local-news] FEEDS is empty — edit the config block at the top of this script ' +
        '(DATA_DIR/jobs/scripts/local-news.local.js) with your city/county/state sources, ' +
        'then run again.'
    );
    process.exitCode = 1;
    return;
  }
  const needsTerms = FEEDS.some((f) => f.filtered);
  if (needsTerms && TERM_MATCHERS.length === 0) {
    console.error(
      '[local-news] a feed has filtered:true but LOCAL_TERMS is empty — add your place names.'
    );
    process.exitCode = 1;
    return;
  }

  const seen = await loadSeen();
  const firstRun = seen.size === 0 && !BACKFILL;
  if (firstRun) {
    console.log(
      `[local-news] empty ledger — forward-only first run: newest ${FIRST_RUN_LIMIT}/feed, ` +
        'rest of the current window marked seen (DOCVAULT_JOB_BACKFILL=1 to ingest everything)'
    );
  }

  let totalPosted = 0;
  let totalMatched = 0;
  let feedFailures = 0;
  const newlySeen = [];

  for (const feed of FEEDS) {
    const t0 = performance.now();
    let items;
    let xml;
    try {
      const res = await fetch(feed.url, {
        headers: { 'user-agent': FETCH_UA },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      xml = await res.text();
      items = parseFeed(xml);
    } catch (err) {
      feedFailures++;
      console.error(`[local-news] feed "${feed.name}" fetch failed: ${err.message}`);
      continue;
    }
    if (items.length === 0) {
      // CivicPlus news-flash feeds are legitimately empty between announcements —
      // only a response with no RSS skeleton at all suggests the shape changed.
      if (/<(rss|channel)\b/i.test(xml)) {
        console.log(`[local-news] feed "${feed.name}" is valid but currently has no items`);
      } else {
        feedFailures++;
        console.error(
          `[local-news] feed "${feed.name}" returned no parseable RSS — feed shape may have changed`
        );
      }
      continue;
    }

    let matched = 0;
    let posted = 0;
    let skippedSeen = 0;

    for (const it of items) {
      if (!it.link || seen.has(it.link)) {
        skippedSeen++;
        continue;
      }
      if (EXCLUDE_LINK_RE.test(it.link)) continue;

      const summary = toText(it.descRaw);
      const fullBody = it.contentRaw ? toText(it.contentRaw) : '';
      let matchedTerms = [];
      if (feed.filtered) {
        const haystack = MATCH_AGAINST_FULL_BODY
          ? `${it.title}\n${summary}\n${fullBody}`
          : `${it.title}\n${summary}`;
        matchedTerms = matchLocalTerms(haystack);
        if (matchedTerms.length === 0) continue; // not local — ignore, don't record
      }

      matched++;
      totalMatched++;
      // Forward-only seeding: past the per-feed cap, record the URL as seen
      // without filing so the backlog never floods in on later runs.
      if (firstRun && matched > FIRST_RUN_LIMIT) {
        newlySeen.push(it.link);
        continue;
      }

      const body = fullBody || summary;
      const reportDate = toIsoDate(it.pubDate);
      const header = `[${feed.name} RSS via local-news job — published ${reportDate || '?'}]`;
      const tags = ['local-news', 'auto', slugify(feed.name), ...matchedTerms.slice(0, 6)];

      if (DRY_RUN) {
        console.log(
          `[dry] ${feed.name}: ${it.title}` +
            (matchedTerms.length ? `  ·  {${matchedTerms.join(', ')}}` : '')
        );
        posted++;
        totalPosted++;
        continue;
      }

      try {
        await postEntry({
          text: `${header}\n\n${body || it.title}`,
          title: it.title,
          author: it.author || undefined,
          publisher: feed.name,
          reportDate: reportDate || undefined,
          sourceUrl: it.link,
          domain: 'local',
          tags,
        });
        posted++;
        totalPosted++;
        newlySeen.push(it.link); // only mark seen on success → transient failures retry
      } catch (err) {
        console.error(`[local-news] POST failed for ${it.link}: ${err.message}`);
      }
    }

    console.log(
      `[local-news] feed "${feed.name}" items=${items.length} matched=${matched} ` +
        `posted=${posted} skipped_seen=${skippedSeen} in ${(performance.now() - t0).toFixed(0)}ms`
    );
  }

  if (!DRY_RUN && newlySeen.length) {
    await saveSeen([...seen, ...newlySeen].slice(-SEEN_MAX));
  }

  console.log(
    `[local-news ${new Date().toISOString()}] feeds=${FEEDS.length} failed=${feedFailures} ` +
      `matched=${totalMatched} posted=${totalPosted}${DRY_RUN ? ' (dry run)' : ''}`
  );
  if (feedFailures === FEEDS.length) {
    process.exitCode = 1; // every feed failed — surface as a failed run
  }
}

main().catch((err) => {
  console.error(`[local-news] fatal: ${err.stack || err.message}`);
  process.exitCode = 1;
});
