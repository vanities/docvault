export interface AutomationStatus {
  lastRanAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastDurationMs: number | null;
  running: boolean;
  lastOutcome?: 'success' | 'warning' | 'partial' | 'error';
  lastWarning?: string | null;
  lastCleanSuccessAt?: string | null;
  warningCount?: number;
  nextRetryAt?: string | null;
  consecutiveFailures?: number;
  lastCollection?: { collected: number; failed: number; skipped: number } | null;
  lastSummary?: string | null;
  lastAttemptSummary?: string | null;
}

export function automationOutcome(status?: AutomationStatus): string {
  if (status?.running) return 'Running';
  if (status?.lastOutcome === 'partial') return 'Some items failed';
  if (status?.lastError || status?.lastOutcome === 'error') return 'Failed';
  if (status?.lastWarning || status?.lastOutcome === 'warning') return 'Completed with warnings';
  return status?.lastSuccessAt ? 'Succeeded' : 'Not run yet';
}

export function automationNeedsAttention(status?: AutomationStatus): boolean {
  return !!(
    status?.lastError ||
    status?.lastWarning ||
    ['partial', 'error', 'warning'].includes(status?.lastOutcome ?? '')
  );
}
