// A list row renders what the owner scans for: title, unread count, state, timing, latest headline.
// Fabricated assignment only.
import { describe, expect, test } from 'vite-plus/test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Assignment } from '../../../server/assignments/types';
import { AssignmentRow } from './AssignmentsView';

const NOW = Date.parse('2030-01-02T15:00:00.000Z');

const row: Assignment = {
  id: '0b5e3b52-9a59-4f3e-8a64-1f7f1c2d3e4f',
  title: 'Watch Acme Bank rates',
  brief: 'Tell me if Acme Bank savings drops below 4%.',
  status: 'active',
  notes: '',
  cadenceMinutes: 180,
  nextCheckAt: '2030-01-02T18:00:00.000Z',
  running: null,
  pendingRun: null,
  unread: 2,
  lastRun: {
    runId: 'r',
    at: '2030-01-02T14:00:00.000Z',
    trigger: 'scheduled',
    ok: true,
    headline: 'Acme cut savings to 3.9%',
    emailed: true,
    error: null,
  },
  consecutiveFailures: 0,
  failureEmailedAt: null,
  counters: { day: '2030-01-02', runs: 1, emails: 1 },
  toolAllowlist: null,
  outcome: null,
  createdAt: '2030-01-01T00:00:00.000Z',
  updatedAt: '2030-01-02T14:00:00.000Z',
  closedAt: null,
};

describe('AssignmentRow', () => {
  test('shows the title, unread count, state, next check and latest headline', () => {
    const html = renderToStaticMarkup(
      <AssignmentRow assignment={row} pausedAll={false} now={NOW} selected onSelect={() => {}} />
    );
    expect(html).toContain('Watch Acme Bank rates');
    expect(html).toContain('aria-label="2 unread"');
    expect(html).toContain('Active');
    expect(html).toContain('Next check in 3 h');
    expect(html).toContain('Acme cut savings to 3.9%');
    expect(html).toContain('aria-current="true"');
  });

  test('a paused-all state wins over the schedule', () => {
    const html = renderToStaticMarkup(
      <AssignmentRow
        assignment={{ ...row, unread: 0 }}
        pausedAll
        now={NOW}
        selected={false}
        onSelect={() => {}}
      />
    );
    expect(html).toContain('All assignments paused');
    expect(html).not.toContain('unread');
  });
});
