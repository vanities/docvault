import {
  deriveConnectionIssues,
  type SimplefinIssue,
  type SimplefinTrackedIssue,
} from '../../../server/simplefin-health';

function timestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function isTrackedIssue(issue: SimplefinIssue): issue is SimplefinTrackedIssue {
  return 'firstSeenAt' in issue && typeof issue.firstSeenAt === 'string';
}

export function SimplefinConnectionWarnings({
  errors,
  issues: suppliedIssues,
  history = [],
}: {
  errors?: string[];
  issues?: (SimplefinIssue | SimplefinTrackedIssue)[];
  history?: SimplefinTrackedIssue[];
}) {
  const issues =
    suppliedIssues ?? deriveConnectionIssues((errors ?? []).map((message) => ({ message })));
  if (!issues.length && !history.length) return null;
  const reauth = issues.some((issue) => issue.kind === 'reauth');
  const access = issues.some((issue) => issue.kind === 'access');
  return (
    <div
      role="status"
      className={`p-4 mb-4 rounded-xl border text-sm ${issues.length ? 'border-amber-500/20 bg-amber-500/10' : 'border-emerald-500/20 bg-emerald-500/10'}`}
    >
      <p className={`font-medium ${issues.length ? 'text-amber-500' : 'text-emerald-500'}`}>
        {reauth
          ? 'Bank sign-in required'
          : issues.length
            ? 'Bank connections need attention'
            : 'Bank connections recovered'}
      </p>
      <ul className="mt-2 space-y-1 text-surface-700">
        {issues.map((issue) => (
          <li key={issue.id} className="break-words">
            <p>{issue.message}</p>
            {issue.lastBankDataAt && (
              <p className="text-xs text-surface-600">
                Latest bank data: {timestamp(issue.lastBankDataAt)}
              </p>
            )}
            {isTrackedIssue(issue) && (
              <p className="text-xs text-surface-600">
                Tracked since: {timestamp(issue.firstSeenAt)} · Last confirmed:{' '}
                {timestamp(issue.lastSeenAt)} · {issue.observations}{' '}
                {issue.observations === 1 ? 'check' : 'checks'}
              </p>
            )}
          </li>
        ))}
      </ul>
      {issues.length > 0 && (
        <p className="mt-2 text-xs text-surface-600">
          {reauth && 'Reconnect the affected banks in SimpleFIN Bridge, then sync again. '}
          {issues.some((issue) => issue.kind === 'connection' || issue.kind === 'sync') &&
            'Temporary sync errors can recover on the next update. '}
          Balances may be out of date until the connection is restored.
        </p>
      )}
      {issues.length > 0 && (
        <a
          href="https://beta-bridge.simplefin.org"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block mt-2 text-accent-500 hover:underline"
        >
          {reauth ? 'Reconnect bank accounts' : 'Check SimpleFIN Bridge'}
        </a>
      )}
      {access && (
        <p className="mt-2 text-xs text-surface-600">
          The DocVault app token needs attention. Update it in Settings → Bank Accounts.
        </p>
      )}
      {issues.some((issue) => issue.kind === 'subscription') && (
        <p className="mt-2 text-xs text-surface-600">
          Renew your SimpleFIN subscription in Bridge, then sync again.
        </p>
      )}
      {issues.some((issue) => issue.kind === 'quota') && (
        <p className="mt-2 text-xs text-surface-600">
          Wait for SimpleFIN's request quota to replenish. Signing in again will not fix a quota
          limit.
        </p>
      )}
      {history.length > 0 && (
        <details className="mt-3 text-xs text-surface-600">
          <summary className="cursor-pointer">
            Resolved connection warnings ({history.length})
          </summary>
          <ul className="mt-2 space-y-2">
            {history.map((issue) => (
              <li key={`${issue.id}:${issue.firstSeenAt}`} className="break-words">
                {issue.message}
                <br />
                Tracked: {timestamp(issue.firstSeenAt)} · Recovered:{' '}
                {issue.resolvedAt ? timestamp(issue.resolvedAt) : 'Not recorded'}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
