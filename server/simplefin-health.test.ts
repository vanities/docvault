import { expect, test } from 'vite-plus/test';
import { deriveConnectionIssues, updateSimplefinHealth } from './simplefin-health.js';

test('bank authentication and temporary provider errors have different repair actions', () => {
  const issues = deriveConnectionIssues([
    { code: 'con.auth', message: 'Authentication required', connectionName: 'Acme Bank' },
    { code: 'act.failed', message: 'Temporarily unavailable' },
    { code: 'gen.auth', message: 'Access denied' },
  ]);
  expect(issues.map((issue) => issue.kind)).toEqual(['reauth', 'connection', 'access']);
});

test('one unresolved challenge keeps its first detection instead of becoming repeated reauth episodes', () => {
  const issues = deriveConnectionIssues([{ message: 'Acme Bank: Auth required' }]);
  const first = updateSimplefinHealth(undefined, issues, '2026-01-01T12:00:00Z', true);
  const repeated = updateSimplefinHealth(first, issues, '2026-01-02T12:00:00Z', true);
  expect(repeated.issues[0].firstSeenAt).toBe('2026-01-01T12:00:00Z');
  expect(repeated.issues[0].lastSeenAt).toBe('2026-01-02T12:00:00Z');
  expect(repeated.issues[0].observations).toBe(2);
  expect(repeated.history).toEqual([]);
  expect(repeated.lastCleanSyncAt).toBeUndefined();
});

test('confirmed recovery closes an episode; a later challenge starts a new one', () => {
  const issues = deriveConnectionIssues([{ message: 'Acme Bank: Auth required' }]);
  const failed = updateSimplefinHealth(undefined, issues, '2026-01-01T12:00:00Z', true);
  const healthy = updateSimplefinHealth(failed, [], '2026-01-02T12:00:00Z', true);
  expect(healthy.issues).toEqual([]);
  expect(healthy.history[0].resolvedAt).toBe('2026-01-02T12:00:00Z');
  const again = updateSimplefinHealth(healthy, issues, '2026-01-03T12:00:00Z', true);
  expect(again.issues[0].firstSeenAt).toBe('2026-01-03T12:00:00Z');
  expect(again.history).toHaveLength(1);
});

test('legacy institution IDs migrating to connection IDs do not invent a recovery', () => {
  const previous = updateSimplefinHealth(
    undefined,
    deriveConnectionIssues([
      { message: 'Auth required', connectionId: 'legacy-institution', connectionName: 'Acme Bank' },
    ]),
    '2026-01-01T12:00:00Z',
    true
  );
  const next = updateSimplefinHealth(
    previous,
    deriveConnectionIssues([
      {
        message: 'Auth required',
        code: 'con.auth',
        connectionId: 'new-connection',
        connectionName: 'Acme Bank',
      },
    ]),
    '2026-01-02T12:00:00Z',
    true
  );
  expect(next.issues[0].firstSeenAt).toBe('2026-01-01T12:00:00Z');
  expect(next.issues[0].observations).toBe(2);
  expect(next.history).toEqual([]);
});

test('a network outage does not falsely clear existing bank authentication warnings', () => {
  const failed = updateSimplefinHealth(
    undefined,
    deriveConnectionIssues([{ message: 'Acme Bank: Auth required' }]),
    '2026-01-01T12:00:00Z',
    true
  );
  const outage = updateSimplefinHealth(
    failed,
    [{ id: 'sync', kind: 'sync', message: 'Network timeout' }],
    '2026-01-02T12:00:00Z',
    false
  );
  expect(outage.issues.map((issue) => issue.kind)).toEqual(['reauth', 'sync']);
  expect(outage.issues[0].lastSeenAt).toBe('2026-01-01T12:00:00Z');
  expect(outage.history).toEqual([]);
});
