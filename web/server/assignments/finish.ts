// How a check-in ends: the agent calls finish_check_in, and the server applies it within limits.
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { DocVaultTool } from '../routes/chat.js';
import { LIMITS, type Assignment, type RunTrigger } from './types.js';

export const FINISH_TOOL_NAME = 'finish_check_in';

export interface FinishInput {
  headline: string;
  notes: string;
  reason: string;
  next_check_in_minutes?: number;
  next_check_at?: string;
  notify?: { subject: string; body: string };
  cadence_minutes?: number;
  close?: { outcome: string };
}

const OFFSET_RE = /(Z|[+-]\d{2}:\d{2})$/;

/** Problems the model can fix by calling again; empty when the input is usable. */
export function finishProblems(input: FinishInput, now: Date): string[] {
  const problems: string[] = [];
  if (!input.headline.trim()) problems.push('headline must not be empty');
  if (input.next_check_at !== undefined) {
    const at = Date.parse(input.next_check_at);
    if (!OFFSET_RE.test(input.next_check_at.trim()) || !Number.isFinite(at)) {
      problems.push(
        'next_check_at must be an ISO 8601 time with a UTC offset, like 2030-01-02T09:00:00-06:00'
      );
    } else if (at <= now.getTime()) {
      problems.push('next_check_at must be in the future');
    }
  }
  if (input.notify && !input.notify.body.trim()) problems.push('notify.body must not be empty');
  return problems;
}

/**
 * The finish_check_in tool for one run. The last valid call wins; an invalid one is returned to the
 * model as an error so it can call again.
 */
export function makeFinishTool(
  now: () => Date,
  onFinish: (input: FinishInput) => void
): DocVaultTool {
  return tool(
    FINISH_TOOL_NAME,
    `Ends this check-in. Call it exactly once, as your last action, after writing your reply. Next check: between ${LIMITS.minIntervalMinutes / 60} hour and ${LIMITS.maxIntervalMinutes / 1440} days out; check sooner while things move, later when quiet.`,
    {
      headline: z
        .string()
        .max(LIMITS.headlineMaxChars)
        .describe('One line for the assignment list: what you found this time.'),
      notes: z
        .string()
        .max(LIMITS.notesMaxChars)
        .describe(
          'Your complete working notes. They REPLACE the previous notes, so carry forward everything the next check-in needs: baselines, what you are waiting for, what you already told the owner.'
        ),
      reason: z.string().describe('Why the next check is at that time.'),
      next_check_in_minutes: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Minutes until the next check-in.'),
      next_check_at: z
        .string()
        .optional()
        .describe('Alternative to next_check_in_minutes: ISO 8601 time with a UTC offset.'),
      notify: z
        .object({
          subject: z.string().max(120).describe('Email subject, plain words.'),
          body: z
            .string()
            .max(8000)
            .describe('Email body in markdown: what changed and why it matters.'),
        })
        .optional()
        .describe(
          'Email the owner. Only when something the brief cares about changed, or the brief says to tell them.'
        ),
      cadence_minutes: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Change the default time between check-ins (e.g. when the owner asks).'),
      close: z
        .object({ outcome: z.string().max(2000).describe('What happened, for the record.') })
        .optional()
        .describe("Close the assignment: only when the brief's done condition is met."),
    },
    async (args) => {
      const problems = finishProblems(args, now());
      if (problems.length > 0) {
        return {
          content: [{ type: 'text', text: `Not recorded: ${problems.join('; ')}. Call again.` }],
          isError: true,
        };
      }
      onFinish(args);
      return { content: [{ type: 'text', text: 'Recorded. End your turn now.' }] };
    }
  );
}

export interface AppliedFinish {
  headline: string;
  notes: string;
  cadenceMinutes: number;
  nextCheckAt: string;
  notify: { subject: string; body: string } | null;
  closeOutcome: string | null;
  /** Adjustments the server made, for the run log. */
  warnings: string[];
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Applies a finish_check_in result within the limits. Pure. */
export function applyFinish(
  assignment: Pick<Assignment, 'cadenceMinutes'>,
  finish: FinishInput,
  ctx: { now: Date; trigger: RunTrigger }
): AppliedFinish {
  const warnings: string[] = [];
  const cadenceMinutes = clamp(
    Math.round(finish.cadence_minutes ?? assignment.cadenceMinutes),
    LIMITS.minIntervalMinutes,
    LIMITS.maxIntervalMinutes
  );
  if (finish.cadence_minutes !== undefined && finish.cadence_minutes !== cadenceMinutes) {
    warnings.push(`cadence ${finish.cadence_minutes}m clamped to ${cadenceMinutes}m`);
  }

  const atMs = finish.next_check_at ? Date.parse(finish.next_check_at) : NaN;
  const requested = Number.isFinite(atMs)
    ? (atMs - ctx.now.getTime()) / 60_000
    : (finish.next_check_in_minutes ?? cadenceMinutes);
  const minutes = clamp(requested, LIMITS.minIntervalMinutes, LIMITS.maxIntervalMinutes);
  if (Math.abs(minutes - requested) > 0.5) {
    warnings.push(`next check ${Math.round(requested)}m clamped to ${Math.round(minutes)}m`);
  }

  // A reply run happens while the owner is in the thread, so it never emails them.
  const notify = finish.notify && ctx.trigger !== 'message' ? finish.notify : null;
  if (finish.notify && !notify) warnings.push('notify ignored: the owner triggered this run');

  return {
    headline: finish.headline.trim().slice(0, LIMITS.headlineMaxChars),
    notes: finish.notes.trim().slice(0, LIMITS.notesMaxChars),
    cadenceMinutes,
    nextCheckAt: new Date(ctx.now.getTime() + minutes * 60_000).toISOString(),
    notify,
    closeOutcome: finish.close?.outcome.trim() || null,
    warnings,
  };
}
