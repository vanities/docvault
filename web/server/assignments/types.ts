// Assignments: long-running AI threads that check in on their own (see store.ts for the files).

export type AssignmentStatus = 'active' | 'paused' | 'closed';
/** scheduled = the timer fired; manual = Run now; message = the owner replied in the thread. */
export type RunTrigger = 'scheduled' | 'manual' | 'message';

// Constants in v1. A check-in is one full agent turn on the owner's Claude subscription, which
// their own Claude Code use draws on too, so the floor is an hour; reacting faster is what alert
// wake-ups are for.
export const LIMITS = {
  minIntervalMinutes: 60,
  maxIntervalMinutes: 7 * 24 * 60,
  defaultIntervalMinutes: 180,
  runsPerDay: 24,
  emailsPerDay: 5,
  maxTurns: 30,
  maxBudgetUsd: 3,
  runTimeoutMs: 10 * 60_000,
  notesMaxChars: 6000,
  headlineMaxChars: 120,
  recentEntriesInPrompt: 5,
  transcriptEntriesReturned: 200,
  runLogMaxLines: 500,
  /** After an interrupted run, wait this long before the next try so a crash can't loop. */
  retryFloorMinutes: 10,
  /** Next try after the 1st, 2nd, and 3rd-or-later failure in a row. */
  failureBackoffMinutes: [60, 180, 720],
  failureEmailAfter: 3,
  /** A subscription close to its limit pushes the next check at least this far out. */
  quotaWarningDelayMinutes: 120,
} as const;

export interface LastRun {
  runId: string;
  at: string;
  trigger: RunTrigger;
  ok: boolean;
  headline: string | null;
  emailed: boolean;
  error: string | null;
}

export interface Assignment {
  id: string;
  title: string;
  /** Owner-written: the goal, what to watch, when to tell them, when the job is done. */
  brief: string;
  status: AssignmentStatus;
  /** Agent-written working memory, rewritten each check-in. */
  notes: string;
  cadenceMinutes: number;
  /** Null unless active. */
  nextCheckAt: string | null;
  /** Persisted so a restart mid-run can tell the next run what already happened. */
  running: { runId: string; trigger: RunTrigger; startedAt: string } | null;
  /** A run requested by the owner that is waiting for the one-at-a-time run slot. */
  pendingRun: RunTrigger | null;
  /** Notifications the owner hasn't opened yet; drives the sidebar badge. */
  unread: number;
  lastRun: LastRun | null;
  consecutiveFailures: number;
  /** Set once the "can't run" email for the current failure streak went out. */
  failureEmailedAt: string | null;
  /** Per local day; reset when the day changes. */
  counters: { day: string; runs: number; emails: number };
  /** Tool names (as chat shows them) this assignment may use; null = every tool. */
  toolAllowlist: string[] | null;
  outcome: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface AssignmentsIndex {
  version: 1;
  /** Every assignment stops; set by the owner or by an account-level failure. */
  pausedAll: boolean;
  pausedAllReason: string | null;
  assignments: Record<string, Assignment>;
}

export type EntryKind = 'you' | 'check-in' | 'reply' | 'system';

export interface ToolUse {
  name: string;
  write: boolean;
  ok: boolean | null;
}

export interface TranscriptEntry {
  id: string;
  at: string;
  kind: EntryKind;
  markdown: string;
  runId?: string;
  trigger?: RunTrigger;
  tools?: ToolUse[];
  headline?: string;
  emailed?: boolean;
  nextCheckAt?: string | null;
}

/** One line of `assignments/<id>.runs.jsonl`; tool lines are appended as the calls happen. */
export type RunLogLine =
  | { runId: string; at: string; event: 'start'; trigger: RunTrigger }
  | { runId: string; at: string; event: 'tool'; name: string; write: boolean; input?: string }
  | {
      runId: string;
      at: string;
      event: 'end';
      outcome: 'ok' | 'failed' | 'rate-limited' | 'account' | 'refused' | 'interrupted';
      durationMs: number;
      costUsd: number | null;
      emailed: boolean;
      headline: string | null;
      warnings: string[];
      error: string | null;
    };
