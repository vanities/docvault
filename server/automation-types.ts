// Pure shared types; the runtime image ships server/ and does not ship src/.
export type AutomationOutcome = 'success' | 'warning' | 'partial' | 'error';

export interface AutomationRun {
  id: string;
  runId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  outcome: AutomationOutcome;
  diagnostics: Array<{
    ts: string;
    level: 'info' | 'warn' | 'error' | 'debug';
    namespace: string;
    message: string;
    bootId?: string;
  }>;
  warningCount: number;
  error?: string | null;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  collection?: { collected: number; failed: number; skipped: number } | null;
  dryRun?: boolean;
}
