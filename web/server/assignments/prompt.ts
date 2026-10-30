// The user-turn prompt for one assignment run. Each run starts a fresh SDK session, so everything
// the agent needs is rebuilt here: the brief, its own notes, recent headlines, new messages from
// the owner, and what an interrupted run already changed.
import { LIMITS, type Assignment, type RunTrigger, type TranscriptEntry } from './types.js';

export interface PromptInput {
  assignment: Pick<Assignment, 'title' | 'brief' | 'notes' | 'cadenceMinutes'>;
  trigger: RunTrigger;
  now: Date;
  timeZone: string;
  /** Oldest first. */
  transcript: TranscriptEntry[];
  /** When the previous run ended; the owner's messages after it are new to this run. */
  lastRunAt: string | null;
  /** Write tools an interrupted run already called. */
  interruptedWrites: string[];
}

export function formatLocal(iso: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(typeof iso === 'string' ? new Date(iso) : iso);
}

export function localDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
}

const TRIGGER_LINE: Record<RunTrigger, string> = {
  scheduled: 'This is a scheduled check-in.',
  manual: 'The owner pressed Run now, so check in now.',
  message: 'The owner wrote to you in the thread (below). Answer them.',
};

export function buildCheckInPrompt(input: PromptInput): string {
  const { assignment, trigger, now, timeZone } = input;
  const recent = input.transcript
    .filter((e) => e.kind === 'check-in' || e.kind === 'reply')
    .slice(-LIMITS.recentEntriesInPrompt);
  const newMessages = input.transcript.filter(
    (e) => e.kind === 'you' && (!input.lastRunAt || e.at > input.lastRunAt)
  );

  const sections = [
    `# Assignment: ${assignment.title}`,
    `Local time: ${formatLocal(now, timeZone)} (${timeZone}). ${TRIGGER_LINE[trigger]} The default time between check-ins is ${assignment.cadenceMinutes} minutes.`,
    `## Brief (written by the owner)\n${assignment.brief.trim()}`,
    `## Your notes from earlier check-ins\n${assignment.notes.trim() || '(none yet: this is the first check-in)'}`,
  ];
  if (recent.length > 0) {
    sections.push(
      `## Recent check-ins\n${recent.map((e) => `- ${formatLocal(e.at, timeZone)}: ${e.headline ?? e.markdown.slice(0, 160)}`).join('\n')}`
    );
  }
  if (newMessages.length > 0) {
    sections.push(
      `## Messages from the owner since your last run\n${newMessages.map((e) => `- ${formatLocal(e.at, timeZone)}: ${e.markdown}`).join('\n')}`
    );
  }
  if (input.interruptedWrites.length > 0) {
    sections.push(
      `## Your previous run was interrupted\nIt had already made these changes. Do not repeat them:\n${input.interruptedWrites.map((w) => `- ${w}`).join('\n')}`
    );
  }
  sections.push(
    [
      '## What to do now',
      trigger === 'message'
        ? 'Answer the owner in your reply text. If they asked you to change how often you check, how you report, or what you watch, record it with cadence_minutes and in your notes.'
        : 'Do what the brief asks, using DocVault tools and the web.',
      'Your reply text is what the owner reads in the thread: say what you checked, what changed since your notes, and anything you did.',
      'Then call finish_check_in exactly once, as your last action:',
      '- headline: one line for the assignment list',
      '- notes: your complete working notes (they replace the old ones)',
      `- next_check_in_minutes or next_check_at (${LIMITS.minIntervalMinutes} minutes to ${LIMITS.maxIntervalMinutes / 1440} days), with the reason`,
      trigger === 'message'
        ? '- notify: leave it out; the owner is here'
        : '- notify: only when something the brief cares about changed, or the brief says to tell them',
      "- close: only when the brief's done condition is met",
    ].join('\n')
  );
  return sections.join('\n\n');
}

export function buildRepairPrompt(
  input: Pick<PromptInput, 'assignment' | 'now' | 'timeZone'>,
  replyText: string
): string {
  return [
    `# Assignment: ${input.assignment.title}`,
    `Local time: ${formatLocal(input.now, input.timeZone)} (${input.timeZone}).`,
    `## Brief\n${input.assignment.brief.trim()}`,
    `## Your notes before this check-in\n${input.assignment.notes.trim() || '(none)'}`,
    `## What you wrote this check-in\n${replyText.trim() || '(nothing)'}`,
    'Your check-in ended without calling finish_check_in. Call it now, once, based on what you wrote above. Do not do any other work.',
  ].join('\n\n');
}
