import { readBrainContent } from '../../brain.js';
import { clip } from '../format.js';
import { ReadCollector, windowTest } from '../request.js';
import type { ContextSource } from '../types.js';

/** The brain is injected whole into chat and Newsstand prompts already; this
 *  makes it readable by the surfaces that don't get it injected. */
export const brainSource: ContextSource = {
  id: 'brain',
  label: 'Long-term notes',
  group: 'memory',
  description:
    "The owner's long-term notes (the Brain): standing facts, preferences and decisions they " +
    'asked DocVault to remember.',
  files: ['.docvault-brain.md'],
  async read(req) {
    const r = new ReadCollector();
    if (!req.full && req.purpose !== 'query') return r.result();
    await r.part('memory/brain', async () => {
      const content = (await readBrainContent()).trim();
      if (content) r.lines.push(`Long-term notes:\n${clip(content, 20_000)}`);
    });
    return r.result();
  },
};

export const editionsSource: ContextSource = {
  id: 'newsstand-editions',
  label: 'Newsstand editions',
  group: 'memory',
  description:
    'Newsstand editions published in the window: type, date and opening paragraph, so a ' +
    'reader knows what the owner was already told.',
  files: ['.docvault-daily-news.json'],
  async read(req) {
    const r = new ReadCollector();
    const inWindow = windowTest(req);
    await r.part('memory/editions', async () => {
      // Imported here: the edition store imports the Newsstand, which imports
      // the registry this source is part of.
      const { getEdition, listEditions } = await import('../../daily-news-store.js');
      const editions = (await listEditions())
        .filter((e) => !e.sample && e.status === 'done' && inWindow(e.completedAt ?? e.createdAt))
        .slice(0, 10);
      for (const summary of editions) {
        const edition = await getEdition(summary.id);
        const lede = (edition?.body ?? '').split(/\n\s*\n/).find((p) => p.trim()) ?? '';
        r.lines.push(
          `${summary.editionType === 'weekly' ? 'Weekly' : 'Daily'} edition ${summary.editionDate}: ` +
            `${clip(lede.replace(/^#+\s*/, ''), 600)}`
        );
      }
    });
    return r.result();
  },
};
