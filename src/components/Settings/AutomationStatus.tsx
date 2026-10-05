import {
  automationOutcome,
  automationNeedsAttention,
  type AutomationStatus,
} from '../../utils/automation-status';
export type { AutomationStatus } from '../../utils/automation-status';

function timestamp(value?: string | null): string {
  return value ? new Date(value).toLocaleString() : 'Not recorded';
}

export function AutomationStatusDetails({ status }: { status?: AutomationStatus }) {
  const outcome = automationOutcome(status);
  const counts = status?.lastCollection;
  const color = status?.lastError
    ? 'text-red-400'
    : automationNeedsAttention(status)
      ? 'text-amber-400'
      : 'text-emerald-400';
  return (
    <div className="mt-2 space-y-1 text-xs break-words">
      <p className={`font-medium ${status?.running ? 'text-blue-400' : color}`}>{outcome}</p>
      <p className="text-surface-600">Last attempt: {timestamp(status?.lastRanAt)}</p>
      <p className="text-surface-600">
        Last successful completion: {timestamp(status?.lastSuccessAt)}
      </p>
      <p className="text-surface-500">
        Last clean success: {timestamp(status?.lastCleanSuccessAt)}
      </p>
      {status?.lastDurationMs != null && (
        <p className="text-surface-500">Duration: {(status.lastDurationMs / 1000).toFixed(1)}s</p>
      )}
      {counts && (
        <p className="text-surface-700">
          {counts.collected} collected · {counts.failed} failed · {counts.skipped} skipped
        </p>
      )}
      {status?.lastError && <p className="text-red-400">{status.lastError}</p>}
      {!status?.lastError && status?.lastWarning && (
        <p className="text-amber-400">{status.lastWarning}</p>
      )}
      {status?.nextRetryAt && (
        <p className="text-amber-400">
          Next retry: {timestamp(status.nextRetryAt)}
          {status.consecutiveFailures
            ? ` · ${status.consecutiveFailures} incomplete runs in a row`
            : ''}
        </p>
      )}
    </div>
  );
}
