import type { Assignment, RunLogLine, TranscriptEntry } from '../../../server/assignments/types';

export type RunEnd = Extract<RunLogLine, { event: 'end' }>;

export interface AssignmentsList {
  assignments: Assignment[];
  pausedAll: boolean;
  pausedAllReason: string | null;
}

export interface AssignmentDetail {
  assignment: Assignment;
  entries: TranscriptEntry[];
  /** Newest first. */
  runs: RunEnd[];
}

export type StatusFilter = 'active' | 'paused' | 'closed';

/** The sidebar badge listens for this to refresh right after a read or change. */
export const ASSIGNMENTS_CHANGED_EVENT = 'docvault:assignments-changed';

/** "in 3 h", "12 min ago", "now": past and future, for next-check times and history. */
export function formatRelative(iso: string, now: number): string {
  const diff = Date.parse(iso) - now;
  const minutes = Math.round(Math.abs(diff) / 60_000);
  if (minutes < 1) return 'now';
  const span =
    minutes < 60
      ? `${minutes} min`
      : minutes < 48 * 60
        ? `${Math.round(minutes / 60)} h`
        : `${Math.round(minutes / 1440)} d`;
  return diff > 0 ? `in ${span}` : `${span} ago`;
}

export function cadenceLabel(minutes: number): string {
  if (minutes % 1440 === 0) return `every ${minutes / 1440} d`;
  if (minutes % 60 === 0) return `every ${minutes / 60} h`;
  return `every ${minutes} min`;
}

/** What the row and header say about timing, from most to least urgent state. */
export function scheduleLabel(a: Assignment, pausedAll: boolean, now: number): string {
  if (a.running) return 'Checking in now';
  if (a.pendingRun) return 'Queued';
  if (a.status === 'closed')
    return a.closedAt ? `Closed ${formatRelative(a.closedAt, now)}` : 'Closed';
  if (a.status === 'paused') return 'Paused';
  if (pausedAll) return 'All assignments paused';
  return a.nextCheckAt ? `Next check ${formatRelative(a.nextCheckAt, now)}` : 'Not scheduled';
}

export type Tone = 'running' | 'ok' | 'failing' | 'paused' | 'closed';

export function toneOf(a: Assignment, pausedAll: boolean): Tone {
  if (a.running || a.pendingRun) return 'running';
  if (a.status === 'closed') return 'closed';
  if (a.status === 'paused' || pausedAll) return 'paused';
  return a.consecutiveFailures > 0 ? 'failing' : 'ok';
}

/** Filter by tab and search text; unread first, then whatever runs soonest. */
export function visibleAssignments(
  list: Assignment[],
  filter: StatusFilter,
  query: string
): Assignment[] {
  const q = query.trim().toLowerCase();
  return list
    .filter((a) => a.status === filter)
    .filter(
      (a) =>
        !q ||
        [a.title, a.brief, a.notes, a.lastRun?.headline ?? ''].some((s) =>
          s.toLowerCase().includes(q)
        )
    )
    .sort(
      (x, y) =>
        Number(y.unread > 0) - Number(x.unread > 0) ||
        (x.nextCheckAt ?? '￿').localeCompare(y.nextCheckAt ?? '￿') ||
        y.updatedAt.localeCompare(x.updatedAt)
    );
}

export function countByStatus(list: Assignment[]): Record<StatusFilter, number> {
  return {
    active: list.filter((a) => a.status === 'active').length,
    paused: list.filter((a) => a.status === 'paused').length,
    closed: list.filter((a) => a.status === 'closed').length,
  };
}

/** The assignment id in `#assignments/<id>`, if any. */
export function idFromHash(hash: string): string | null {
  const match = /^#?assignments\/([0-9a-f-]{36})$/.exec(hash);
  return match ? match[1] : null;
}

export const ENTRY_LABEL: Record<TranscriptEntry['kind'], string> = {
  you: 'You',
  'check-in': 'Check-in',
  reply: 'Reply',
  system: 'System',
};

export const RUN_OUTCOME_LABEL: Record<RunEnd['outcome'], string> = {
  ok: 'OK',
  failed: 'Failed',
  'rate-limited': 'Usage limit',
  account: 'Account problem',
  refused: 'Refused',
  interrupted: 'Interrupted',
};
