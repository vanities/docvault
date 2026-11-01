import { listResearchEntries, type ResearchEntry } from '../../routes/research.js';
import { createLogger } from '../../logger.js';
import { ReadCollector, windowTest, type DateTest } from '../request.js';
import type { ContextSource } from '../types.js';

const log = createLogger('Context');

const RESEARCH_FILES = ['.docvault-research.json', 'research'];

/** In the window when PULLED in it or PUBLISHED in it: a scraper backfilling a
 *  channel's last week of videos is still news the morning after the pull. */
const filedInWindow = (e: ResearchEntry, inWindow: DateTest) =>
  inWindow(e.uploadedAt) || inWindow(e.reportDate ? `${e.reportDate}T12:00:00` : undefined);

/**
 * The full text of research filed in the window, so a reader can synthesize
 * the analysis, not just the titles. Each entry gets an even share of
 * `maxChars`, between 350 and 2,800 characters.
 */
export function buildResearchDigestItems(
  entries: ResearchEntry[],
  afterSince: DateTest,
  opts: { maxChars?: number; cite?: (e: ResearchEntry) => string } = {}
): string[] {
  const eligible = entries
    .filter((e) => filedInWindow(e, afterSince))
    .filter((e) => (e.text ?? '').trim().length > 0);
  if (!eligible.length) return [];

  const maxChars = opts.maxChars ?? 70_000;
  const charsPerEntry = Math.max(350, Math.min(2800, Math.floor(maxChars / eligible.length)));
  return eligible.map((e) => {
    const who = e.publisher ?? e.author ?? e.domain;
    const when = e.reportDate ?? e.uploadedAt.slice(0, 10);
    const clean = (e.text ?? '').replace(/\s+/g, ' ').trim();
    const clipped = clean.length > charsPerEntry;
    const body = clean.slice(0, charsPerEntry);
    const suffix = clipped ? ' … [excerpt truncated; source text remains in Research]' : '';
    const tag = opts.cite?.(e) ?? '';
    return `### ${e.title ?? 'Untitled'} — ${who} (${e.domain}, ${when})${tag}\n${body}${suffix}`;
  });
}

export const researchSource: ContextSource = {
  id: 'research',
  label: 'Research',
  group: 'research',
  description:
    'The research library (finance, health, politics and tech): the full text of every piece ' +
    'filed in the window, with publisher, date and a source link.',
  files: RESEARCH_FILES,
  async read(req) {
    const r = new ReadCollector();
    await r.part('research/full-text', async () => {
      const entries = (await listResearchEntries()).filter((e) => e.domain !== 'local');
      r.lines.push(
        ...buildResearchDigestItems(entries, windowTest(req), { cite: (e) => r.cite(e.sourceUrl) })
      );
      log.info(`[read] research full-text=${r.lines.length} linkable=${r.citations.length}`);
    });
    return r.result();
  },
};

// Local news is its own source so it lands on its own desk: city announcements
// shouldn't be buried among macro research.
export const localNewsSource: ContextSource = {
  id: 'local-news',
  label: 'Local news',
  group: 'local',
  description:
    'Local news filed into the research library (the local domain): the full text of each piece ' +
    'filed in the window, with publisher, date and a source link.',
  files: RESEARCH_FILES,
  async read(req) {
    const r = new ReadCollector();
    await r.part('research/local-full-text', async () => {
      const entries = (await listResearchEntries()).filter((e) => e.domain === 'local');
      r.lines.push(
        ...buildResearchDigestItems(entries, windowTest(req), {
          maxChars: 25_000,
          cite: (e) => r.cite(e.sourceUrl),
        })
      );
      log.info(`[read] local-news full-text=${r.lines.length} linkable=${r.citations.length}`);
    });
    return r.result();
  },
};

export const researchFilingsSource: ContextSource = {
  id: 'research-filings',
  label: 'Research filed',
  group: 'documents',
  description:
    'A one-line entry for each research piece filed in the window, in any domain: title, ' +
    'publisher and the first line of its summary.',
  files: RESEARCH_FILES,
  async read(req) {
    const r = new ReadCollector();
    const inWindow = windowTest(req);
    await r.part('docs/research', async () => {
      for (const e of (await listResearchEntries()).filter((x) => filedInWindow(x, inWindow))) {
        const snippet = e.intelligence?.summary?.[0]?.text;
        const title = e.title ?? e.filename ?? 'untitled';
        r.lines.push(
          `Filed (${e.domain}): ${title}` +
            `${e.publisher ? ` — ${e.publisher}` : ''}${snippet ? ` — ${snippet}` : ''}.`
        );
        r.pulled.push({
          source: `research/${e.domain}`,
          title: `${title}${e.publisher ? ` — ${e.publisher}` : ''}`,
          ...(e.sourceUrl?.trim() ? { url: e.sourceUrl.trim() } : {}),
        });
      }
    });
    return r.result();
  },
};
