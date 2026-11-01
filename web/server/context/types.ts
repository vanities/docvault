// A context source is one kind of DocVault data, described once so every AI
// surface (the Newsstand digest, chat, assignments, deep research) reads it the
// same way. See registry.ts for the list and coverage.test.ts for the rule that
// keeps the list complete.

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
  /** Signed dollars, when the event moves money. Consumers rank and filter by it. */
  amount?: number;
}

/** One number a source tracks over time, such as a loan balance. */
export interface ContextMetric {
  label: string;
  value: number;
}

/** Broad subject, so each consumer can place a source without knowing it by
 * name (the Newsstand maps groups to desks). */
export type ContextGroup = 'money';

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
  /** How things stand now, as short lines. Empty when there is nothing to say. */
  state?(): Promise<string[]>;
  /** Dated events inside the window, oldest first. */
  changes?(window: ContextWindow): Promise<ContextEvent[]>;
  /**
   * Numbers to record once a day, keyed by an id that stays stable across days.
   * The daily history of these is what changes() compares against for data
   * that only ever stores its current value.
   */
  metrics?(): Promise<Record<string, ContextMetric>>;
}
