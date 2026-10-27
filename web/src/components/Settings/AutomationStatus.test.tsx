import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vite-plus/test';
import { AutomationStatusDetails, type AutomationStatus } from './AutomationStatus';
import { JobRunDetails } from './JobRunHistoryDialog';
import type { AutomationRun } from '../../../server/automation-types';

const status: AutomationStatus = {
  lastRanAt: '2026-06-01T12:00:00Z',
  lastSuccessAt: '2026-05-31T12:00:00Z',
  lastCleanSuccessAt: '2026-05-31T12:00:00Z',
  lastError: 'Three caption downloads failed',
  lastOutcome: 'partial',
  lastDurationMs: 2000,
  running: false,
  lastCollection: { collected: 1, failed: 3, skipped: 0 },
  nextRetryAt: '2026-06-01T12:15:00Z',
  consecutiveFailures: 1,
};

describe('admin automation status', () => {
  test('bank authentication warnings provide a connection repair action', () => {
    const html = renderToStaticMarkup(
      <AutomationStatusDetails
        status={{ ...status, lastError: null, lastWarning: 'SimpleFIN: authentication required' }}
      />
    );
    expect(html).toContain('Check bank connections in SimpleFIN Bridge');
    expect(html).toContain('https://beta-bridge.simplefin.org');
  });
  test('shows incomplete collection, earlier success, reason, and retry timing', () => {
    const html = renderToStaticMarkup(<AutomationStatusDetails status={status} />);
    for (const text of [
      'Some items failed',
      'Last attempt:',
      'Last successful completion:',
      'Last clean success:',
      '1 collected',
      '3 failed',
      'Three caption downloads failed',
      'Next retry:',
    ])
      expect(html).toContain(text);
  });

  test('a run waiting on unpublished items reads as a success with an early check, not a retry', () => {
    const waiting = {
      ...status,
      lastOutcome: 'success' as const,
      lastError: null,
      lastSuccessAt: status.lastRanAt,
      lastCollection: { collected: 2, failed: 0, skipped: 0, deferred: 1 },
      nextRetryAt: null,
      consecutiveFailures: 0,
      nextCheckAt: '2026-06-01T14:00:00Z',
    };
    const html = renderToStaticMarkup(<AutomationStatusDetails status={waiting} />);
    expect(html).toContain('Succeeded');
    expect(html).toContain('1 not published yet');
    expect(html).toContain('Checking again for unpublished items:');
    expect(html).not.toContain('Next retry:');
  });

  test('recovered source errors remain visible in a successful run and its history', () => {
    const recovered = {
      ...status,
      lastOutcome: 'warning' as const,
      lastError: null,
      lastWarning: 'HTTP 503 recovered on attempt 2',
      nextRetryAt: null,
    };
    expect(renderToStaticMarkup(<AutomationStatusDetails status={recovered} />)).toContain(
      'Completed with warnings'
    );
    const run: AutomationRun = {
      id: 'example-job',
      runId: 'example-job-1',
      startedAt: status.lastRanAt!,
      finishedAt: '2026-06-01T12:00:02Z',
      durationMs: 2000,
      outcome: 'warning',
      warningCount: 1,
      diagnostics: [
        {
          ts: '2026-06-01T12:00:01Z',
          level: 'warn',
          namespace: 'YouTubeTranscript',
          message: 'HTTP 503 recovered on attempt 2',
        },
      ],
    };
    const html = renderToStaticMarkup(<JobRunDetails run={run} initiallyOpen />);
    expect(html).toContain('HTTP 503 recovered on attempt 2');
    expect(html).toContain('YouTubeTranscript');
    expect(html).toContain('Completed with warnings');
  });
});
