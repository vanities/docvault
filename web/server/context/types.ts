// A context source is one kind of DocVault data, described once so every AI
// surface (the Newsstand digest, chat, assignments, deep research) reads it the
// same way. See registry.ts for the list and coverage.test.ts for the rule that
// keeps the list complete.

/**
 * Broad subject, so each consumer can place a source without knowing it by
 * name: the Newsstand maps groups to desks, chat lists sources by group.
 * `outlook` (weather) and `memory` (long-term notes, past editions) are read by
 * the Newsstand outside its desks.
 */
export type ContextGroup =
  | 'markets'
  | 'money'
  | 'politics'
  | 'local'
  | 'finance'
  | 'health'
  | 'research'
  | 'calendar'
  | 'documents'
  | 'activity'
  | 'outlook'
  | 'memory';

/** What a reader wants from a source. */
export interface ContextRequest {
  /** Window start: an ISO timestamp, or YYYY-MM-DD for that whole day. */
  since: string;
  /** Window end, YYYY-MM-DD inclusive. Absent means up to now. */
  until?: string;
  /** The household's today, YYYY-MM-DD. */
  today: string;
  /**
   * Who is asking. A Newsstand edition (daily or weekly) or a direct query
   * (chat, assignments, research). Sources use it only for presentation,
   * such as a weekly reporting 7-day averages.
   */
  purpose: 'daily' | 'weekly' | 'query';
  /** Also include the standing picture (balances, rosters, totals), not only what changed. */
  full: boolean;
}

/** One ingested item, for the Newsstand's "Sources pulled" appendix. */
export interface PulledItem {
  /** Origin tag, e.g. 'research/finance', 'upload', 'deep-research'. */
  source: string;
  title: string;
  /** Original article/video URL when the item carries one. */
  url?: string;
}

/** A source tag ([S1], [S2], …) in a read's lines, and the URL it stands for. */
export interface SourceCitation {
  ref: string;
  url: string;
}

export interface ContextRead {
  lines: string[];
  pulled?: PulledItem[];
  /** Tags used in `lines`, numbered from S1 within this read. Callers that
   *  combine reads renumber them into one sequence. */
  citations?: SourceCitation[];
  /** Parts of the source that failed and were skipped. */
  warnings?: Array<{ source: string; message: string }>;
}

/** Inclusive date range, YYYY-MM-DD. */
export interface ContextWindow {
  from: string;
  to: string;
}

/** Something that happened on a date: a transaction, a balance change. */
export interface ContextEvent {
  /** YYYY-MM-DD */
  date: string;
  /** One line, ready to show a model. */
  text: string;
  /** Signed dollars, when the event moves money. Readers rank and filter by it. */
  amount?: number;
}

/** One number a source tracks over time, such as a loan balance. */
export interface ContextMetric {
  label: string;
  value: number;
}

export interface ContextSource {
  /** Stable id; also the history folder name. Lowercase letters, digits, dashes. */
  id: string;
  label: string;
  group: ContextGroup;
  /** What the source holds, in a sentence a model can use to decide whether to read it. */
  description: string;
  /**
   * Data-folder files and folders this source reads, as the server code names
   * them ('.docvault-property.json', 'health'). coverage.test.ts fails when a
   * data file belongs to no source and has no written exemption.
   */
  files: string[];
  /** Lines for a reader: what changed in the window, current readings, and,
   *  when `full`, the standing picture. */
  read(req: ContextRequest): Promise<ContextRead>;
  /** Dated, signed events, for sources whose changes are money moves. */
  events?(window: ContextWindow): Promise<ContextEvent[]>;
  /**
   * Numbers to record once a day, keyed by an id that stays stable across days.
   * The daily history of these is what lets a source report dated changes for
   * data that only ever stores its current value.
   */
  metrics?(): Promise<Record<string, ContextMetric>>;
}
