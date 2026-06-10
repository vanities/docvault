// Chat Skills — user-authored instruction packs the chat assistant can invoke.
//
// A skill is a folder under DATA_DIR/skills/<name>/ holding a SKILL.md with
// YAML frontmatter (name + description) and a markdown body of instructions.
// Like the Brain and custom jobs, skills live in DATA_DIR: gitignored,
// user-owned, editable from Settings → Skills (or over SSH on the NAS).
//
// The Claude chat backend loads them through the Agent SDK's plugin mechanism:
// the SDK expects a plugin root containing `.claude-plugin/plugin.json` plus
// `skills/<name>/SKILL.md`, so `ensureSkillsPluginDir` mirrors the user dir
// into a cached temp plugin and hands that path to `query({plugins})`. Skills
// are instruction-only — chat denies Bash/Read, and the harness inlines the
// SKILL.md content itself, so no file tools are needed at invocation time.
//
// Writes are atomic (temp file + rename) and never stream back into a file
// being read — same rules as the Brain store.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DATA_DIR } from './data.js';
import { createLogger } from './logger.js';

const log = createLogger('Skills');

export const SKILLS_DIR = path.join(DATA_DIR, 'skills');

/** kebab-case, 1-64 chars — also blocks path traversal (no dots or slashes). */
const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface SkillSummary {
  name: string;
  description: string;
  bytes: number;
  updatedAt: string | null;
}

export interface SkillRecord extends SkillSummary {
  /** Markdown body below the frontmatter. */
  instructions: string;
}

export function isValidSkillName(name: string): boolean {
  return SKILL_NAME_RE.test(name);
}

function skillFile(name: string): string {
  return path.join(SKILLS_DIR, name, 'SKILL.md');
}

/** Compose canonical SKILL.md — frontmatter the Agent SDK understands. */
function composeSkillMd(name: string, description: string, instructions: string): string {
  const desc = description.replace(/\s+/g, ' ').trim();
  // Double-quoted YAML scalar so colons/hashes in the description stay literal.
  const quoted = `"${desc.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
  return `---\nname: ${name}\ndescription: ${quoted}\n---\n\n${instructions.trim()}\n`;
}

/** Pull description + body out of a SKILL.md. Tolerates hand-written files. */
function parseSkillMd(raw: string): { description: string; instructions: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!m) return { description: '', instructions: raw.trim() };
  const frontmatter = m[1];
  const body = raw.slice(m[0].length).trim();
  const dm = /^description:\s*(?:"((?:[^"\\]|\\.)*)"|(.*))$/m.exec(frontmatter);
  const description = dm
    ? (dm[1] !== undefined ? dm[1].replaceAll('\\"', '"').replaceAll('\\\\', '\\') : dm[2]).trim()
    : '';
  return { description, instructions: body };
}

/** List skills — a missing skills dir is a normal empty state. */
export async function listSkills(): Promise<SkillSummary[]> {
  const t0 = performance.now();
  let entries: string[];
  try {
    entries = await fs.readdir(SKILLS_DIR);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const skills: SkillSummary[] = [];
  for (const entry of entries) {
    if (entry.startsWith('.') || !isValidSkillName(entry)) continue;
    try {
      const file = skillFile(entry);
      const [raw, stat] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file)]);
      const { description } = parseSkillMd(raw);
      skills.push({
        name: entry,
        description,
        bytes: Buffer.byteLength(raw, 'utf8'),
        updatedAt: stat.mtime.toISOString(),
      });
    } catch {
      // Folder without a readable SKILL.md — not a skill, skip it.
    }
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));
  log.debug(`[list] ${skills.length} skill(s) in ${(performance.now() - t0).toFixed(1)}ms`);
  return skills;
}

export async function readSkill(name: string): Promise<SkillRecord | null> {
  if (!isValidSkillName(name)) return null;
  try {
    const file = skillFile(name);
    const [raw, stat] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file)]);
    const { description, instructions } = parseSkillMd(raw);
    return {
      name,
      description,
      instructions,
      bytes: Buffer.byteLength(raw, 'utf8'),
      updatedAt: stat.mtime.toISOString(),
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** Create or replace a skill (the Settings editor's Save). */
export async function writeSkill(
  name: string,
  description: string,
  instructions: string
): Promise<SkillRecord> {
  if (!isValidSkillName(name)) {
    throw new Error('Skill name must be kebab-case: lowercase letters, digits, hyphens (max 64)');
  }
  if (!description.trim()) throw new Error('Skill description is required');
  if (!instructions.trim()) throw new Error('Skill instructions are required');

  const dir = path.join(SKILLS_DIR, name);
  await fs.mkdir(dir, { recursive: true });
  const file = skillFile(name);
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, composeSkillMd(name, description, instructions), 'utf8');
  await fs.rename(tmp, file);
  log.info(`[write] skill=${name} bytes=${Buffer.byteLength(instructions, 'utf8')}`);
  const record = await readSkill(name);
  if (!record) throw new Error(`Skill ${name} vanished after write`);
  return record;
}

export async function deleteSkill(name: string): Promise<boolean> {
  if (!isValidSkillName(name)) return false;
  const dir = path.join(SKILLS_DIR, name);
  try {
    await fs.rm(dir, { recursive: true });
    log.info(`[delete] skill=${name}`);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

// ── Mention extraction + prompt inlining (Codex / non-Agent-SDK backends) ───
//
// The Claude chat backend gets skills natively (plugin + Skill tool). Codex
// gets the same UX a different way: the system prompt always carries the
// skill CATALOG (name + description — cheap), and a `$name` mention in the
// user's message inlines that skill's full instructions for the turn. Codex
// can also read `skills/<name>/SKILL.md` itself — the data view symlinks the
// skills dir — so an un-mentioned but relevant skill is still reachable via
// its native file tools. Progressive disclosure without codex-version-specific
// skill support.

/** Same token rule as the client's splitSkillTokens — keep the two in sync. */
const MENTION_RE = /(^|\s)\$([a-z0-9][a-z0-9-]*)(?=\s|$|[.,;:!?)])/g;

/** Distinct installed-skill names mentioned as `$name` in the text. */
export function extractSkillMentions(text: string, names: readonly string[]): string[] {
  if (names.length === 0) return [];
  const known = new Set(names);
  const found: string[] = [];
  for (const m of text.matchAll(MENTION_RE)) {
    const name = m[2];
    if (known.has(name) && !found.includes(name)) found.push(name);
  }
  return found;
}

/** Most skills a single turn will inline — guards the prompt against blowup. */
const MAX_INLINED_SKILLS = 4;

/**
 * Skills block for prompt-injection backends (Codex chat): the catalog, the
 * read-it-yourself pointer, and the full instructions of any `$mentioned`
 * skill. Returns '' when no skills exist so callers can append untouched.
 */
export async function buildSkillsPromptBlock(userText: string): Promise<string> {
  const skills = await listSkills();
  if (skills.length === 0) return '';

  const lines = [
    '',
    '',
    '## Installed skills',
    ...skills.map((s) => `- $${s.name} — ${s.description}`),
    '',
    'A $name token in a user message refers to that skill. Full instructions live at `skills/<name>/SKILL.md` in your working directory — read the file when a skill is clearly relevant but not quoted below.',
  ];

  const mentioned = extractSkillMentions(
    userText,
    skills.map((s) => s.name)
  ).slice(0, MAX_INLINED_SKILLS);
  for (const name of mentioned) {
    const record = await readSkill(name);
    if (!record) continue;
    lines.push('', `<skill name="${name}">`, record.instructions, '</skill>');
  }
  if (mentioned.length > 0) {
    lines.push('', 'Follow the quoted skill instructions above for this turn.');
    log.info(`[prompt] inlined ${mentioned.length} mentioned skill(s): ${mentioned.join(', ')}`);
  }
  return lines.join('\n');
}

// ── Agent SDK plugin mirror ──────────────────────────────────────────────────
//
// The SDK loads skills from a plugin root:
//   <root>/.claude-plugin/plugin.json   {"name":"docvault","version":"1.0.0"}
//   <root>/skills/<name>/SKILL.md
// We mirror DATA_DIR/skills into a temp plugin and cache it on a fingerprint of
// (name, mtime, size) so repeated chat turns reuse the same dir until a skill
// changes. Plugin skills surface to the model as `docvault:<name>`.

interface SkillsPlugin {
  path: string;
  skillNames: string[];
}

let cachedPlugin: { fingerprint: string; plugin: SkillsPlugin } | null = null;

async function skillsFingerprint(): Promise<{ fingerprint: string; names: string[] }> {
  const skills = await listSkills();
  const fingerprint = skills.map((s) => `${s.name}:${s.updatedAt}:${s.bytes}`).join('|');
  return { fingerprint, names: skills.map((s) => s.name) };
}

/**
 * Mirror DATA_DIR/skills into a cached Agent SDK plugin dir.
 * Returns null when no skills exist (callers then skip the plugins option).
 */
export async function ensureSkillsPluginDir(): Promise<SkillsPlugin | null> {
  const t0 = performance.now();
  const { fingerprint, names } = await skillsFingerprint();
  if (names.length === 0) return null;

  if (cachedPlugin && cachedPlugin.fingerprint === fingerprint) {
    // Confirm the temp dir survived (tmp can be cleaned out from under us).
    try {
      await fs.stat(path.join(cachedPlugin.plugin.path, '.claude-plugin', 'plugin.json'));
      return cachedPlugin.plugin;
    } catch {
      cachedPlugin = null;
    }
  }

  const staleDir = cachedPlugin?.plugin.path;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'docvault-skills-'));
  await fs.mkdir(path.join(root, '.claude-plugin'), { recursive: true });
  await fs.writeFile(
    path.join(root, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'docvault', version: '1.0.0' }, null, 2),
    'utf8'
  );
  for (const name of names) {
    await fs.cp(path.join(SKILLS_DIR, name), path.join(root, 'skills', name), {
      recursive: true,
    });
  }
  cachedPlugin = { fingerprint, plugin: { path: root, skillNames: names } };
  if (staleDir) void fs.rm(staleDir, { recursive: true, force: true }).catch(() => undefined);
  log.info(
    `[plugin] mirrored ${names.length} skill(s) → ${root} in ${(performance.now() - t0).toFixed(1)}ms`
  );
  return cachedPlugin.plugin;
}
