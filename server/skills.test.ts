// CRUD + frontmatter + plugin-mirror tests for the chat skills store.
// Uses only fabricated skill content — no personal data.

import { afterAll, beforeAll, describe, expect, test, vi } from 'vite-plus/test';
import { promises as fs } from 'fs';
import path from 'path';

// Vi.hoisted fires before the import graph resolves — same pattern as the
// chat-threads-store test. Must happen before any `./*.js` imports that
// read DATA_DIR.
const tmpDataDir = vi.hoisted(() => {
  const p = require('path') as typeof import('path');
  const o = require('os') as typeof import('os');
  const dir = p.join(o.tmpdir(), `docvault-skills-${Date.now()}`);
  process.env.DOCVAULT_DATA_DIR = dir;
  return dir;
});

vi.mock('./logger.js', () => ({
  createLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

import {
  SKILLS_DIR,
  isValidSkillName,
  listSkills,
  readSkill,
  writeSkill,
  deleteSkill,
  ensureSkillsPluginDir,
  extractSkillMentions,
  buildSkillsPromptBlock,
} from './skills.js';

beforeAll(async () => {
  await fs.mkdir(tmpDataDir, { recursive: true });
});

afterAll(async () => {
  await fs.rm(tmpDataDir, { recursive: true, force: true });
});

describe('skill names', () => {
  test('accepts kebab-case, rejects traversal and uppercase', () => {
    expect(isValidSkillName('tax-review')).toBe(true);
    expect(isValidSkillName('a1')).toBe(true);
    expect(isValidSkillName('Tax-Review')).toBe(false);
    expect(isValidSkillName('../escape')).toBe(false);
    expect(isValidSkillName('with space')).toBe(false);
    expect(isValidSkillName('-leading')).toBe(false);
    expect(isValidSkillName('')).toBe(false);
  });
});

describe('skills store', () => {
  test('list returns empty when the skills dir does not exist', async () => {
    expect(await listSkills()).toEqual([]);
  });

  test('write → read round-trips, with quoting-hostile description', async () => {
    const desc = 'Review docs: check "totals", costs & 100% of fields';
    const body = '# Steps\n\n1. List files\n2. Summarize';
    const written = await writeSkill('doc-review', desc, body);
    expect(written.name).toBe('doc-review');
    expect(written.description).toBe(desc);

    const read = await readSkill('doc-review');
    expect(read?.description).toBe(desc);
    expect(read?.instructions).toBe(body);
    expect(read?.updatedAt).toBeTruthy();
  });

  test('composed SKILL.md carries valid frontmatter on disk', async () => {
    const raw = await fs.readFile(path.join(SKILLS_DIR, 'doc-review', 'SKILL.md'), 'utf8');
    expect(raw.startsWith('---\nname: doc-review\ndescription: "')).toBe(true);
    expect(raw).toContain('\n---\n\n# Steps');
  });

  test('parses a hand-written SKILL.md (unquoted description)', async () => {
    const dir = path.join(SKILLS_DIR, 'hand-made');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'SKILL.md'),
      '---\nname: hand-made\ndescription: plain text description\n---\nDo the thing.\n',
      'utf8'
    );
    const read = await readSkill('hand-made');
    expect(read?.description).toBe('plain text description');
    expect(read?.instructions).toBe('Do the thing.');
  });

  test('list returns both skills sorted, skipping junk entries', async () => {
    await fs.mkdir(path.join(SKILLS_DIR, 'no-skill-md-here'), { recursive: true });
    await fs.writeFile(path.join(SKILLS_DIR, '.hidden'), 'x', 'utf8');
    const skills = await listSkills();
    expect(skills.map((s) => s.name)).toEqual(['doc-review', 'hand-made']);
  });

  test('write rejects invalid names and empty fields', async () => {
    await expect(writeSkill('Bad Name', 'd', 'i')).rejects.toThrow(/kebab-case/);
    await expect(writeSkill('ok-name', '', 'i')).rejects.toThrow(/description/);
    await expect(writeSkill('ok-name', 'd', '  ')).rejects.toThrow(/instructions/);
  });

  test('read/delete of a missing or invalid skill is null/false', async () => {
    expect(await readSkill('nope')).toBeNull();
    expect(await readSkill('../etc')).toBeNull();
    expect(await deleteSkill('nope')).toBe(false);
    expect(await deleteSkill('../etc')).toBe(false);
  });

  test('delete removes the skill folder', async () => {
    expect(await deleteSkill('hand-made')).toBe(true);
    expect(await readSkill('hand-made')).toBeNull();
    expect((await listSkills()).map((s) => s.name)).toEqual(['doc-review']);
  });
});

describe('agent SDK plugin mirror', () => {
  test('mirrors skills into a plugin layout and caches on fingerprint', async () => {
    const first = await ensureSkillsPluginDir();
    expect(first).not.toBeNull();
    expect(first?.skillNames).toEqual(['doc-review']);

    const manifest = JSON.parse(
      await fs.readFile(path.join(first!.path, '.claude-plugin', 'plugin.json'), 'utf8')
    ) as { name: string };
    expect(manifest.name).toBe('docvault');
    const mirrored = await fs.readFile(
      path.join(first!.path, 'skills', 'doc-review', 'SKILL.md'),
      'utf8'
    );
    expect(mirrored).toContain('doc-review');

    // Unchanged skills → same cached dir.
    const second = await ensureSkillsPluginDir();
    expect(second?.path).toBe(first?.path);

    // A write changes the fingerprint → fresh mirror including the new skill.
    await writeSkill('extra-skill', 'another fabricated skill', 'More steps.');
    const third = await ensureSkillsPluginDir();
    expect(third?.skillNames).toEqual(['doc-review', 'extra-skill']);
    expect(third?.path).not.toBe(first?.path);

    await fs.rm(third!.path, { recursive: true, force: true });
  });

  test('returns null when no skills exist', async () => {
    await deleteSkill('doc-review');
    await deleteSkill('extra-skill');
    expect(await ensureSkillsPluginDir()).toBeNull();
  });
});

describe('mention extraction + prompt block (codex path)', () => {
  test('extractSkillMentions finds known $tokens only, deduped', () => {
    const names = ['doc-review', 'monthly-report'];
    expect(
      extractSkillMentions('run $doc-review and $doc-review, skip $400 and $nope', names)
    ).toEqual(['doc-review']);
    expect(extractSkillMentions('costs$doc-review glued', names)).toEqual([]);
    expect(extractSkillMentions('anything', [])).toEqual([]);
  });

  test('prompt block is empty with no skills, catalogs without mention', async () => {
    expect(await buildSkillsPromptBlock('hello')).toBe('');

    await writeSkill('doc-review', 'Review a fabricated document', '# Steps\n\n1. Read it.');
    const block = await buildSkillsPromptBlock('no mentions here');
    expect(block).toContain('## Installed skills');
    expect(block).toContain('$doc-review — Review a fabricated document');
    expect(block).toContain('skills/<name>/SKILL.md');
    expect(block).not.toContain('<skill name=');
  });

  test('a $mention inlines that skill body', async () => {
    const block = await buildSkillsPromptBlock('please run $doc-review on this');
    expect(block).toContain('<skill name="doc-review">');
    expect(block).toContain('1. Read it.');
    expect(block).toContain('Follow the quoted skill instructions');
    await deleteSkill('doc-review');
  });
});
