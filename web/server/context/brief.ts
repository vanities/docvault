// A short picture of the owner's situation, for research engines that can't
// call get_context themselves (the API and Codex engines). Built only when the
// owner ticks "Use my DocVault data" on a Deep Research run.

import { calendarToday } from '../calendar-store.js';
import { createLogger } from '../logger.js';
import { addDays } from './format.js';
import { CONTEXT_SOURCES } from './registry.js';
import type { ContextGroup } from './types.js';

const log = createLogger('Context');

const HEALTH_QUESTION =
  /\b(health|labs?|blood|cholesterol|ldl|hdl|apob|lp\(a\)|sleep|supplements?|vitamins?|diet|exercise|workouts?|weight|medic\w*|doctors?|dna|genes?|genetic\w*)\b/i;

/** Money and finance always; health only when the question is about health,
 *  so a refinance question doesn't carry lab results into a report. */
export function briefGroups(question: string): ContextGroup[] {
  return HEALTH_QUESTION.test(question)
    ? ['memory', 'money', 'finance', 'health']
    : ['memory', 'money', 'finance'];
}

export async function buildOwnerBrief(question: string, maxChars = 30_000): Promise<string> {
  const t0 = Date.now();
  const today = await calendarToday();
  const groups = new Set(briefGroups(question));
  const sources = CONTEXT_SOURCES.filter(
    (s) => groups.has(s.group) && s.id !== 'newsstand-editions'
  );
  const reads = await Promise.all(
    sources.map(async (s) => {
      try {
        const read = await s.read({
          since: addDays(today, -30),
          today,
          purpose: 'query',
          full: true,
        });
        return { label: s.label, lines: read.lines };
      } catch (err) {
        log.warn(`[brief] ${s.id} failed: ${err instanceof Error ? err.message : String(err)}`);
        return { label: s.label, lines: [] };
      }
    })
  );
  let out = '';
  for (const { label, lines } of reads) {
    if (!lines.length) continue;
    const section = `## ${label}\n${lines.map((l) => `- ${l}`).join('\n')}\n\n`;
    if (out.length + section.length > maxChars) break;
    out += section;
  }
  log.info(
    `[brief] groups=${[...groups].join(',')} sources=${sources.length} chars=${out.length} in ${Date.now() - t0}ms`
  );
  return out.trim();
}
