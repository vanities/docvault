import path from 'path';
import {
  DATA_DIR,
  loadConfig,
  loadMetadata,
  loadParsedData,
  loadTodos,
  scanDirectory,
} from '../../data.js';
import { listRuns } from '../../deep-research-store.js';
import { ReadCollector, windowTest } from '../request.js';
import type { ContextSource } from '../types.js';

export const documentsSource: ContextSource = {
  id: 'documents',
  label: 'Documents',
  group: 'documents',
  description:
    'Documents uploaded in the window across every entity (tax documents, receipts, statements), ' +
    'named by entity and file, with the type AI parsing found and any tags or notes; for ' +
    'direct queries, how many documents each entity holds.',
  files: ['.docvault-config.json', '.docvault-parsed.json', '.docvault-metadata.json'],
  async read(req) {
    const r = new ReadCollector();
    const sinceMs = new Date(req.since).getTime();
    const untilMs = req.until ? Date.parse(`${req.until}T23:59:59`) : Number.POSITIVE_INFINITY;
    await r.part('docs/files', async () => {
      const [config, parsed, metadata] = await Promise.all([
        loadConfig(),
        loadParsedData(),
        loadMetadata(),
      ]);
      const fileLines: string[] = [];
      const counts: string[] = [];
      for (const entity of config.entities) {
        const files = await scanDirectory(path.join(DATA_DIR, entity.path));
        const docs = files.filter((f) => !f.isDirectory);
        if (docs.length) {
          const parsedCount = docs.filter((f) => parsed[`${entity.id}/${f.path}`]).length;
          counts.push(`${entity.name} ${docs.length} (${parsedCount} parsed)`);
        }
        for (const f of files) {
          if (f.lastModified >= sinceMs && f.lastModified <= untilMs) {
            const key = `${entity.id}/${f.path}`;
            const kind = parsed[key]?.documentType ?? parsed[key]?.type;
            const tags = metadata[key]?.tags?.length ? ` [${metadata[key].tags!.join(', ')}]` : '';
            const note = metadata[key]?.notes
              ? ` (note: ${String(metadata[key].notes).slice(0, 120)})`
              : '';
            fileLines.push(
              `${entity.name}/${f.name}${typeof kind === 'string' ? ` (${kind})` : ''}${tags}${note}`
            );
            r.pulled.push({ source: 'upload', title: `${entity.name}/${f.name}` });
          }
        }
      }
      if (fileLines.length) {
        r.lines.push(`${fileLines.length} document(s) uploaded: ${fileLines.join(', ')}.`);
      }
      if (req.purpose === 'query' && counts.length) {
        r.lines.push(`Documents on file by entity: ${counts.join('; ')}.`);
      }
    });
    return r.result();
  },
};

export const deepResearchSource: ContextSource = {
  id: 'deep-research',
  label: 'Deep Research',
  group: 'documents',
  description: 'Deep Research reports finished in the window, by question.',
  files: ['.docvault-deep-research.json'],
  async read(req) {
    const r = new ReadCollector();
    await r.part('docs/deep-research', async () => {
      const done = (await listRuns()).filter(
        (run) => run.status === 'done' && windowTest(req)(run.completedAt ?? run.createdAt)
      );
      for (const run of done) {
        r.lines.push(`Deep Research completed: ${run.question}.`);
        r.pulled.push({ source: 'deep-research', title: run.question });
      }
    });
    return r.result();
  },
};

export const todosSource: ContextSource = {
  id: 'todos',
  label: 'To-dos',
  group: 'documents',
  description: 'Open to-dos (not yet done) that were created or edited in the window, by title.',
  files: ['.docvault-todos.json'],
  async read(req) {
    const r = new ReadCollector();
    await r.part('docs/todos', async () => {
      const todos = await loadTodos();
      for (const t of todos.filter((x) => x.status === 'pending' && windowTest(req)(x.updatedAt))) {
        r.lines.push(`To-do: ${t.title}.`);
      }
    });
    return r.result();
  },
};
