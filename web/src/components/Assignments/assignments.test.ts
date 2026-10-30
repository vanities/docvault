// Assignments page helpers: pure logic over fabricated assignments, no personal data.
import { describe, expect, test } from 'vite-plus/test';
import type { Assignment } from '../../../server/assignments/types';
import {
  cadenceLabel,
  countByStatus,
  formatRelative,
  idFromHash,
  scheduleLabel,
  toneOf,
  visibleAssignments,
} from './assignments';

const NOW = Date.parse('2030-01-02T15:00:00.000Z');
const ID = '0b5e3b52-9a59-4f3e-8a64-1f7f1c2d3e4f';

function assignment(over: Partial<Assignment> = {}): Assignment {
  return {
    id: ID,
    title: 'Watch Acme Bank rates',
    brief: 'Tell me if Acme Bank savings drops below 4%.',
    status: 'active',
    notes: '',
    cadenceMinutes: 180,
    nextCheckAt: '2030-01-02T18:00:00.000Z',
    running: null,
    pendingRun: null,
    unread: 0,
    lastRun: null,
    consecutiveFailures: 0,
    failureEmailedAt: null,
    counters: { day: '2030-01-02', runs: 0, emails: 0 },
    toolAllowlist: null,
    outcome: null,
    createdAt: '2030-01-01T00:00:00.000Z',
    updatedAt: '2030-01-02T00:00:00.000Z',
    closedAt: null,
    ...over,
  };
}

describe('formatRelative', () => {
  test('future and past, in minutes, hours and days', () => {
    expect(formatRelative('2030-01-02T15:00:20.000Z', NOW)).toBe('now');
    expect(formatRelative('2030-01-02T15:12:00.000Z', NOW)).toBe('in 12 min');
    expect(formatRelative('2030-01-02T18:00:00.000Z', NOW)).toBe('in 3 h');
    expect(formatRelative('2030-01-02T10:00:00.000Z', NOW)).toBe('5 h ago');
    expect(formatRelative('2029-12-29T15:00:00.000Z', NOW)).toBe('4 d ago');
  });
});

describe('labels', () => {
  test('cadence reads in the largest whole unit', () => {
    expect(cadenceLabel(60)).toBe('every 1 h');
    expect(cadenceLabel(90)).toBe('every 90 min');
    expect(cadenceLabel(10080)).toBe('every 7 d');
  });

  test('the schedule line follows the most urgent state', () => {
    const running = {
      runId: 'r',
      trigger: 'scheduled' as const,
      startedAt: '2030-01-02T14:59:00.000Z',
    };
    expect(scheduleLabel(assignment({ running }), false, NOW)).toBe('Checking in now');
    expect(scheduleLabel(assignment({ pendingRun: 'manual' }), false, NOW)).toBe('Queued');
    expect(scheduleLabel(assignment({ status: 'paused', nextCheckAt: null }), false, NOW)).toBe(
      'Paused'
    );
    expect(scheduleLabel(assignment(), true, NOW)).toBe('All assignments paused');
    expect(scheduleLabel(assignment(), false, NOW)).toBe('Next check in 3 h');
    expect(
      scheduleLabel(
        assignment({ status: 'closed', closedAt: '2030-01-01T15:00:00.000Z' }),
        false,
        NOW
      )
    ).toBe('Closed 24 h ago');
  });

  test('tone shows running, failing, paused and closed states', () => {
    expect(toneOf(assignment({ pendingRun: 'message' }), false)).toBe('running');
    expect(toneOf(assignment({ consecutiveFailures: 2 }), false)).toBe('failing');
    expect(toneOf(assignment(), true)).toBe('paused');
    expect(toneOf(assignment({ status: 'closed' }), false)).toBe('closed');
    expect(toneOf(assignment(), false)).toBe('ok');
  });
});

describe('visibleAssignments', () => {
  const list = [
    assignment({ id: 'a', title: 'Rates', nextCheckAt: '2030-01-02T20:00:00.000Z' }),
    assignment({ id: 'b', title: 'Deadline', nextCheckAt: '2030-01-02T16:00:00.000Z' }),
    assignment({ id: 'c', title: 'News', unread: 1, nextCheckAt: '2030-01-03T00:00:00.000Z' }),
    assignment({ id: 'd', title: 'Old', status: 'closed', nextCheckAt: null }),
    assignment({
      id: 'e',
      title: 'Quiet',
      lastRun: {
        runId: 'r',
        at: '2030-01-02T14:00:00.000Z',
        trigger: 'scheduled',
        ok: true,
        headline: 'USDe back at $1',
        emailed: false,
        error: null,
      },
      nextCheckAt: '2030-01-02T22:00:00.000Z',
    }),
  ];

  test('unread first, then the soonest check', () => {
    expect(visibleAssignments(list, 'active', '').map((a) => a.id)).toEqual(['c', 'b', 'a', 'e']);
    expect(visibleAssignments(list, 'closed', '').map((a) => a.id)).toEqual(['d']);
  });

  test('search covers title, brief, notes and the latest headline', () => {
    expect(visibleAssignments(list, 'active', 'usde').map((a) => a.id)).toEqual(['e']);
    expect(visibleAssignments(list, 'active', 'acme bank').length).toBe(4);
    expect(visibleAssignments(list, 'active', 'nothing like this')).toEqual([]);
  });

  test('counts per tab', () => {
    expect(countByStatus(list)).toEqual({ active: 4, paused: 0, closed: 1 });
  });
});

describe('idFromHash', () => {
  test('reads an assignment id from a deep link, and nothing else', () => {
    expect(idFromHash(`#assignments/${ID}`)).toBe(ID);
    expect(idFromHash('#assignments')).toBeNull();
    expect(idFromHash('#alerts/whatever')).toBeNull();
  });
});
