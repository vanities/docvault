// The DocVault "Brain" — a single user-owned markdown file that the chat
// assistant always sees and can append to.
//
// Unlike External Sources (read-only git clones of someone's repo), the brain
// is DocVault's OWN store:
//   - it lives in DATA_DIR, so it is gitignored and never touched by any git
//     sync (a clone's `git reset --hard` on sync can't reach it);
//   - it ships empty with every install, so any user gets a personal long-term
//     memory out of the box — no GitHub account or repo required.
//
// Design choices:
//   - Markdown, not JSON: human-editable in the Settings editor and rendered
//     verbatim into the chat system prompt, matching the "curated vault" feel.
//   - Append-only by default (the `remember` chat tool + POST /api/brain/append);
//     the whole file can still be replaced via PUT for manual cleanup.
//   - Atomic writes (temp file + rename) so a crash mid-write can't truncate the
//     brain. We read the whole file into memory, build the next version, then
//     rename a temp file over it — we NEVER stream output back into the file we
//     are still reading.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './data.js';

export const BRAIN_FILE = path.join(DATA_DIR, '.docvault-brain.md');

// Seeded only when the very first entry is appended, so a brand-new brain reads
// as a real document rather than a loose bullet. Manual PUTs are left untouched.
const BRAIN_HEADER = `# DocVault Brain

Long-term memory for the DocVault chat assistant. Everything here is included in
every chat, so the assistant remembers it across conversations. Edit freely —
it's just markdown. Add durable facts, preferences, decisions, and ongoing
context; leave out anything the app's own data already answers (account
balances, lab values, document contents).
`;

export interface BrainState {
  /** Full markdown content ('' when the brain has never been written). */
  content: string;
  /** Size of the content in bytes. */
  bytes: number;
  /** ISO mtime of the file, or null when it does not exist yet. */
  updatedAt: string | null;
  /** Whether the brain file exists on disk. */
  exists: boolean;
}

/** Read the brain. A missing file is a normal empty state, not an error. */
export async function readBrain(): Promise<BrainState> {
  try {
    const content = await fs.readFile(BRAIN_FILE, 'utf8');
    const stat = await fs.stat(BRAIN_FILE);
    return {
      content,
      bytes: Buffer.byteLength(content, 'utf8'),
      updatedAt: stat.mtime.toISOString(),
      exists: true,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { content: '', bytes: 0, updatedAt: null, exists: false };
    }
    throw err;
  }
}

/** Just the markdown text — convenience for the chat system-prompt injection. */
export async function readBrainContent(): Promise<string> {
  return (await readBrain()).content;
}

async function atomicWrite(content: string): Promise<void> {
  await fs.mkdir(path.dirname(BRAIN_FILE), { recursive: true });
  const tmp = `${BRAIN_FILE}.tmp`;
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, BRAIN_FILE);
}

/** Replace the entire brain (the Settings editor's Save, and Clear via ''). */
export async function writeBrain(content: string): Promise<BrainState> {
  await atomicWrite(content);
  return readBrain();
}

export interface AppendResult extends BrainState {
  /** The exact bullet line that was appended. */
  appended: string;
}

/**
 * Append one timestamped entry. Seeds the header + a "## Notes" section on the
 * first write. `opts.date` is injectable so callers (and tests) stay
 * deterministic; the chat tool omits it and gets today's date.
 */
export async function appendBrainEntry(
  text: string,
  opts: { tag?: string; date?: string } = {}
): Promise<AppendResult> {
  const clean = text.trim();
  if (!clean) throw new Error('Cannot append an empty brain entry');

  const existing = await readBrain();
  const date = opts.date ?? new Date().toISOString().slice(0, 10);
  const tag = opts.tag?.trim();
  const bullet = `- (${date}${tag ? `, ${tag}` : ''}) ${clean}`;

  let next: string;
  if (!existing.content.trim()) {
    next = `${BRAIN_HEADER}\n## Notes\n\n${bullet}\n`;
  } else {
    const sep = existing.content.endsWith('\n') ? '' : '\n';
    next = `${existing.content}${sep}${bullet}\n`;
  }

  const state = await writeBrain(next);
  return { ...state, appended: bullet };
}
