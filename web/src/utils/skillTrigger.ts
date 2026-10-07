// $skill mention helpers for the chat composer — DocVault's port of t3code's
// composer-trigger pattern, sized for a plain <textarea>:
//   - detectSkillTrigger: is the caret inside a `$...` token? → drive the menu
//   - filterSkills: rank skills against the typed query
//   - splitSkillTokens: split sent text into text/skill segments for chip
//     rendering (only KNOWN skill names become chips; `$30` stays text)

export interface SkillTrigger {
  /** Text typed after the `$` (may be ''). */
  query: string;
  /** Index of the `$` in the text. */
  start: number;
  /** Caret index — the token under construction ends here. */
  end: number;
}

const TOKEN_CHAR = /[a-z0-9-]/i;

/**
 * Detect an in-progress `$skill` mention at the caret. The `$` must sit at
 * the start of a whitespace-delimited token (so `costs$5` never triggers),
 * and everything between `$` and the caret must be name-ish characters.
 */
export function detectSkillTrigger(text: string, cursor: number): SkillTrigger | null {
  const at = Math.max(0, Math.min(text.length, cursor));
  let i = at - 1;
  while (i >= 0 && TOKEN_CHAR.test(text[i])) i--;
  if (i < 0 || text[i] !== '$') return null;
  const start = i;
  if (start > 0 && !/\s/.test(text[start - 1])) return null;
  return { query: text.slice(start + 1, at), start, end: at };
}

/** Rank skills for the menu: prefix > substring > description match. */
export function filterSkills<T extends { name: string; description: string }>(
  skills: readonly T[],
  query: string
): T[] {
  const q = query.toLowerCase();
  if (!q) return [...skills];
  const scored: Array<{ skill: T; score: number }> = [];
  for (const skill of skills) {
    const name = skill.name.toLowerCase();
    let score: number | null = null;
    if (name.startsWith(q)) score = 0;
    else if (name.includes(q)) score = 1;
    else if (skill.description.toLowerCase().includes(q)) score = 2;
    if (score !== null) scored.push({ skill, score });
  }
  scored.sort((a, b) => a.score - b.score || a.skill.name.localeCompare(b.skill.name));
  return scored.map((s) => s.skill);
}

/** Replace the in-progress trigger with the chosen skill mention. */
export function insertSkillMention(
  text: string,
  trigger: SkillTrigger,
  name: string
): { text: string; cursor: number } {
  const mention = `$${name} `;
  const next = text.slice(0, trigger.start) + mention + text.slice(trigger.end);
  return { text: next, cursor: trigger.start + mention.length };
}

export type SkillSegment = { type: 'text'; text: string } | { type: 'skill'; name: string };

/**
 * Split message text into text/skill segments. Mirrors t3code's
 * SkillInlineText: a `$name` token only becomes a chip when it names a known
 * skill — anything else (e.g. `$400`, `$unknown`) stays plain text.
 */
export function splitSkillTokens(text: string, knownNames: readonly string[]): SkillSegment[] {
  if (knownNames.length === 0) return [{ type: 'text', text }];
  const known = new Set(knownNames);
  const segments: SkillSegment[] = [];
  const re = /(^|\s)\$([a-z0-9][a-z0-9-]*)(?=\s|$|[.,;:!?)])/g;
  let cursor = 0;
  for (const m of text.matchAll(re)) {
    const name = m[2];
    if (!known.has(name)) continue;
    const start = (m.index ?? 0) + m[1].length;
    if (start > cursor) segments.push({ type: 'text', text: text.slice(cursor, start) });
    segments.push({ type: 'skill', name });
    cursor = start + name.length + 1; // +1 for the '$'
  }
  if (segments.length === 0) return [{ type: 'text', text }];
  if (cursor < text.length) segments.push({ type: 'text', text: text.slice(cursor) });
  return segments;
}
