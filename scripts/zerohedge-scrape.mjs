#!/usr/bin/env node
/**
 * zerohedge-scrape.mjs — poll the ZeroHedge RSS feed and file matching
 * articles into DocVault's Research store, auto-routed by topic.
 *
 * WHERE THIS RUNS
 *   On the Unraid NAS *host* (not inside the DocVault container), driven by a
 *   cron drop-in at /boot/config/plugins/docvault/zerohedge.cron. It talks to
 *   the running container over http://localhost:3005. Node 22+ only (uses the
 *   global `fetch`); no npm dependencies.
 *
 * WHAT IT DOES
 *   1. Fetch the FeedBurner feed (full article HTML lives in <description>).
 *   2. Keep only items whose HEADLINE matches a watchlist (see WATCHLIST).
 *   3. Route each kept item to a Research domain (tab) by its ZH URL section,
 *      falling back to the matched watchlist group.
 *   4. Skip anything already filed (dedup via SEEN_FILE).
 *   5. POST the rest to /api/research/text — same store the Quant/Politics/
 *      Health "Research" tabs read.
 *
 * STATE (on the array, not the flash — write-friendly)
 *   SEEN_FILE  dedup ledger of filed article URLs (trimmed to SEEN_MAX).
 *   The cron appends stdout/stderr to zerohedge-scrape.log next to it.
 *
 * TUNING
 *   - Edit the WATCHLIST groups below to change what gets filed + where.
 *   - Flip MATCH_AGAINST_BODY to true to match the whole article, not just the
 *     headline (much broader — most ZH articles mention the Fed/China/war).
 *   - Change the schedule in zerohedge.cron, then run /usr/local/sbin/update_cron.
 */

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

// --- Config -----------------------------------------------------------------

const FEED_URL = 'https://feeds.feedburner.com/zerohedge/feed';
const API_BASE = process.env.DOCVAULT_API ?? 'http://localhost:3005';
const STATE_DIR = process.env.ZH_STATE_DIR ?? '/mnt/user/appdata/docvault';
const SEEN_FILE = `${STATE_DIR}/zerohedge-seen.json`;
const SEEN_MAX = 500; // far more than the feed's ~13h window; cheap insurance
const FETCH_UA = 'Mozilla/5.0 (DocVault ZeroHedge cron)';
// DRY_RUN=1 prints what would be filed (domain/title/tags) and writes nothing —
// no POSTs, no seen-ledger update. Handy for tuning the watchlist.
const DRY_RUN = !!process.env.DRY_RUN;

// Match the headline only by default. ZH bodies almost always mention some
// macro/geo keyword, so body-matching would file ~everything and defeat the
// point of a curated feed. Set true to broaden.
const MATCH_AGAINST_BODY = false;

// Watchlist groups. An article is filed iff at least one term matches (each
// term is a case-insensitive whole-word match). The matched group is also a
// routing hint when the URL section is unknown (see routeDomain).
const WATCHLIST = {
  finance: [
    'fed', 'fomc', 'federal reserve', 'powell', 'rate cut', 'rate hike',
    'interest rate', 'rates', 'inflation', 'cpi', 'ppi', 'pce', 'deflation',
    'stagflation', 'jobs report', 'payroll', 'payrolls', 'jolts', 'unemployment',
    'recession', 'gdp', 'treasury', 'treasuries', 'yields', 'yield curve',
    'bond', 'bonds', 'bitcoin', 'btc', 'ethereum', 'crypto', 'stablecoin',
    'gold', 'silver', 'copper', 'oil', 'crude', 'wti', 'brent', 'dollar', 'dxy',
    's&p', 'nasdaq', 'dow', 'equities', 'stocks', 'earnings', 'bessent',
  ],
  politics: [
    'trump', 'biden', 'election', 'tariff', 'tariffs', 'sanction', 'sanctions',
    'war', 'ukraine', 'russia', 'china', 'iran', 'israel', 'gaza', 'nato',
    'congress', 'senate', 'immigration', 'border', 'doge', 'musk', 'deportation',
    'shutdown', 'impeach', 'supreme court',
  ],
  health: [
    'fda', 'cdc', 'vaccine', 'vaccines', 'mrna', 'covid', 'pandemic', 'pharma',
    'pfizer', 'moderna', 'ozempic', 'glp-1', 'rfk', 'hhs', 'measles', 'outbreak',
    'autism', 'disease', 'medical', 'hospital', 'obesity',
  ],
};

// First path segment of a ZH article URL → Research domain. The strongest
// routing signal (ZH's own editorial section), preferred over the keyword group.
const SECTION_DOMAIN = {
  economics: 'finance', markets: 'finance', commodities: 'finance',
  energy: 'finance', crypto: 'finance', cryptocurrency: 'finance',
  'personal-finance': 'finance', 'the-market-ear': 'finance', finance: 'finance',
  political: 'politics', politics: 'politics', geopolitical: 'politics',
  medical: 'health', 'covid-19': 'health', covid: 'health', health: 'health',
};

// --- Text helpers -----------------------------------------------------------

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', rsquo: '’',
  lsquo: '‘', ldquo: '“', rdquo: '”', copy: '©',
  reg: '®', trade: '™', deg: '°',
};

function safeCodePoint(cp) {
  try {
    return String.fromCodePoint(cp);
  } catch {
    return '';
  }
}

/** Decode XML/HTML entities. Called twice end-to-end (the feed double-encodes:
 *  the description is entity-escaped HTML, so one pass yields HTML and a second
 *  pass — after tag stripping — yields the final text). */
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

/** Turn the entity-escaped HTML <description> into clean article prose. The
 *  feed wraps the body with a leading title <span> and trailing author/date
 *  <span>s; both are snipped via their stable schema markers. */
function extractBody(descRaw) {
  let html = decodeEntities(descRaw);
  html = html.replace(/<span property="schema:name"[\s\S]*?<\/span>/i, '');
  html = html.replace(/<span rel="schema:author"[\s\S]*$/i, '');
  return decodeEntities(stripHtml(html));
}

// --- Feed parsing -----------------------------------------------------------

/** Parse the RSS into {title, link, pubDate, author, descRaw} items. Regex is
 *  fine here: one trusted feed with a flat, predictable item shape. */
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
      title: decodeEntities(pick('title')).replace(/\s+/g, ' ').trim(),
      link: pick('link'),
      pubDate: pick('pubDate'),
      author: decodeEntities(pick('dc:creator')) || 'Tyler Durden',
      descRaw: pick('description'),
    });
  }
  return items;
}

// --- Filter + routing -------------------------------------------------------

// Precompile one matcher per term. Whole-word for plain terms; substring for
// terms with non-word characters (s&p, glp-1) where \b misbehaves.
const MATCHERS = Object.fromEntries(
  Object.entries(WATCHLIST).map(([group, terms]) => [
    group,
    terms.map((term) => {
      const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const plain = /^[a-z0-9 ]+$/i.test(term);
      return { term, re: new RegExp(plain ? `\\b${esc}\\b` : esc, 'i') };
    }),
  ])
);

/** Which watchlist groups (and terms) a string hits. */
function matchWatchlist(haystack) {
  const groups = new Set();
  const terms = [];
  for (const [group, matchers] of Object.entries(MATCHERS)) {
    for (const { term, re } of matchers) {
      if (re.test(haystack)) {
        groups.add(group);
        terms.push(term);
      }
    }
  }
  return { groups, terms };
}

function sectionOf(link) {
  try {
    return new URL(link).pathname.split('/').filter(Boolean)[0] ?? '';
  } catch {
    return '';
  }
}

/** URL section wins; else matched group with health > politics > finance
 *  (finance is the broadest net, so it loses ties). */
function routeDomain(link, groups) {
  const section = SECTION_DOMAIN[sectionOf(link)];
  if (section) return section;
  if (groups.has('health')) return 'health';
  if (groups.has('politics')) return 'politics';
  return 'finance';
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

function uniq(xs) {
  return [...new Set(xs)];
}

// --- Main -------------------------------------------------------------------

async function main() {
  const seen = await loadSeen();

  const res = await fetch(FEED_URL, { headers: { 'user-agent': FETCH_UA } });
  if (!res.ok) throw new Error(`feed HTTP ${res.status}`);
  const items = parseFeed(await res.text());
  if (items.length === 0) throw new Error('parsed 0 items — feed shape may have changed');

  const counts = { finance: 0, politics: 0, health: 0 };
  let matched = 0;
  let posted = 0;
  let skippedSeen = 0;
  const newlySeen = [];

  for (const it of items) {
    if (!it.link || seen.has(it.link)) {
      skippedSeen++;
      continue;
    }
    const body = extractBody(it.descRaw);
    const haystack = (MATCH_AGAINST_BODY ? `${it.title}\n${body}` : it.title).toLowerCase();
    const { groups, terms } = matchWatchlist(haystack);
    if (groups.size === 0) continue; // not a watchlist topic — ignore, don't record

    matched++;
    const domain = routeDomain(it.link, groups);
    const section = sectionOf(it.link) || '?';
    const reportDate = toIsoDate(it.pubDate);
    const header = `[ZeroHedge RSS via cron — section: ${section}, published ${reportDate || '?'}]`;
    const tags = ['zerohedge', 'auto', ...uniq(terms).slice(0, 8)];

    if (DRY_RUN) {
      console.log(`[dry] ${domain.padEnd(8)} ${it.title}  ·  ${section} · {${uniq(terms).join(', ')}}`);
      if (process.env.SHOW_BODY) {
        console.log(`      └─ ${body.replace(/\n+/g, ' ⏎ ').slice(0, 240)}…\n`);
      }
      counts[domain]++;
      continue;
    }

    try {
      await postEntry({
        text: `${header}\n\n${body}`,
        title: it.title,
        author: it.author,
        publisher: 'ZeroHedge',
        reportDate: reportDate || undefined,
        sourceUrl: it.link,
        domain,
        tags,
      });
      posted++;
      counts[domain]++;
      newlySeen.push(it.link); // only mark seen on success → transient failures retry
    } catch (err) {
      console.error(`[zerohedge] POST failed for ${it.link}: ${err.message}`);
    }
  }

  if (newlySeen.length) {
    await saveSeen([...seen, ...newlySeen].slice(-SEEN_MAX));
  }

  const stamp = new Date().toISOString();
  console.log(
    `[zerohedge ${stamp}] feed=${items.length} matched=${matched} posted=${posted} ` +
      `(finance=${counts.finance} politics=${counts.politics} health=${counts.health}) ` +
      `skipped_seen=${skippedSeen}`
  );
}

main().catch((err) => {
  console.error(`[zerohedge] fatal: ${err.stack || err.message}`);
  process.exitCode = 1;
});
