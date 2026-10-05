import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { requestJson } from '../../api/client';
import { API_BASE } from '../../constants';
import type { AutomationRun } from '../../../server/automation-types';

export interface SelectedJob {
  id: string;
  label: string;
  builtIn: boolean;
}

const LABELS = {
  success: 'Succeeded',
  warning: 'Completed with warnings',
  partial: 'Some items failed',
  error: 'Failed',
};

export function JobRunHistoryDialog({
  job,
  onClose,
}: {
  job: SelectedJob | null;
  onClose: () => void;
}) {
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!job) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setRuns([]);
    void requestJson<{ runs: AutomationRun[] }>(
      `${API_BASE}/jobs/${encodeURIComponent(job.id)}/runs?kind=${job.builtIn ? 'built-in' : 'custom'}`
    )
      .then((data) => {
        if (!cancelled) setRuns(data.runs);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load run history');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [job, refresh]);
  return (
    <Dialog
      open={!!job}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{job?.label} — run history</DialogTitle>
          <DialogDescription>
            Recent attempts, including warnings from runs that eventually succeeded.
          </DialogDescription>
        </DialogHeader>
        <Button
          variant="outline"
          className="self-start"
          onClick={() => setRefresh((n) => n + 1)}
          disabled={loading}
        >
          Refresh history
        </Button>
        {loading && <p role="status">Loading run history…</p>}
        {error && (
          <p role="alert" className="text-red-400">
            {error}
          </p>
        )}
        {!loading && !error && !runs.length && (
          <p className="text-sm text-surface-600">
            No recorded runs yet. New runs will appear here.
          </p>
        )}
        <div className="space-y-3 min-w-0">
          {runs.map((run, i) => (
            <JobRunDetails key={run.runId} run={run} initiallyOpen={i === 0} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function JobRunDetails({
  run,
  initiallyOpen = false,
}: {
  run: AutomationRun;
  initiallyOpen?: boolean;
}) {
  return (
    <details open={initiallyOpen} className="rounded-xl border border-border p-3 min-w-0">
      <summary className="cursor-pointer text-sm font-medium break-words">
        {new Date(run.startedAt).toLocaleString()} · {run.dryRun ? 'Dry run · ' : ''}
        {LABELS[run.outcome]} · {(run.durationMs / 1000).toFixed(1)}s
      </summary>
      <div className="mt-3 space-y-3 text-xs min-w-0">
        <p className="text-surface-600">
          Finished: {new Date(run.finishedAt).toLocaleString()} · {run.warningCount} warning/error
          events
        </p>
        {run.collection && (
          <p>
            {run.collection.collected} collected · {run.collection.failed} failed ·{' '}
            {run.collection.skipped} skipped
          </p>
        )}
        {run.error && <p className="text-red-400 break-words">{run.error}</p>}
        {run.diagnostics.map((entry, index) => (
          <div
            key={index}
            className={
              entry.level === 'error'
                ? 'text-red-400'
                : entry.level === 'warn'
                  ? 'text-amber-400'
                  : 'text-surface-600'
            }
          >
            <p>
              {new Date(entry.ts).toLocaleTimeString()} · {entry.namespace} · {entry.level}
            </p>
            <pre className="whitespace-pre-wrap break-words font-mono mt-1">{entry.message}</pre>
          </div>
        ))}
        {run.stderr && (
          <div>
            <p className="font-medium text-amber-400">Collector warnings and errors</p>
            <pre className="mt-1 whitespace-pre-wrap break-words font-mono">{run.stderr}</pre>
          </div>
        )}
        {run.stdout && (
          <details>
            <summary className="cursor-pointer">Collector output</summary>
            <pre className="mt-2 whitespace-pre-wrap break-words font-mono">{run.stdout}</pre>
          </details>
        )}
      </div>
    </details>
  );
}
