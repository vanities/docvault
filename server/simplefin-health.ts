export type SimplefinIssueKind =
  | 'reauth'
  | 'access'
  | 'quota'
  | 'subscription'
  | 'connection'
  | 'stale'
  | 'sync';

export interface SimplefinIssue {
  id: string;
  kind: SimplefinIssueKind;
  message: string;
  code?: string;
  connectionId?: string;
  connectionName?: string;
  lastBankDataAt?: string;
}

export interface SimplefinTrackedIssue extends SimplefinIssue {
  firstSeenAt: string;
  lastSeenAt: string;
  observations: number;
  resolvedAt?: string;
}

export interface SimplefinHealth {
  lastAttemptAt?: string;
  lastFetchedAt?: string;
  lastCleanSyncAt?: string;
  issues: SimplefinTrackedIssue[];
  history: SimplefinTrackedIssue[];
}

export function deriveConnectionIssues(
  errors: Array<Omit<SimplefinIssue, 'id' | 'kind'>>
): SimplefinIssue[] {
  return errors.map((error) => {
    let kind: SimplefinIssueKind = 'connection';
    if (error.code === 'con.auth') kind = 'reauth';
    else if (error.code === 'gen.auth') kind = 'access';
    else if (
      !error.code &&
      /\b(?:auth(?:entication)? required|reauthenticate|reconnect|sign in|log in)\b/i.test(
        error.message
      )
    )
      kind = 'reauth';
    else if (/quota|rate limit|too many requests/i.test(error.message)) kind = 'quota';
    return {
      ...error,
      kind,
      id: `${kind}:${error.connectionId || error.connectionName || error.message}`,
    };
  });
}

/** A failed request cannot confirm that a previous bank challenge recovered.
 * Only a complete provider response closes missing issues. */
export function updateSimplefinHealth(
  previous: SimplefinHealth | undefined,
  incoming: SimplefinIssue[],
  checkedAt: string,
  complete: boolean
): SimplefinHealth {
  const existing = previous?.issues ?? [];
  const matchedIds = new Set<string>();
  const issues = incoming.map((issue) => {
    let prior = existing.find((entry) => entry.id === issue.id);
    // Legacy responses used institution IDs instead of connection IDs. Keep
    // an unambiguous ongoing warning through that upgrade without inventing
    // a recovery and a new authentication challenge.
    if (!prior && issue.connectionName) {
      const candidates = existing.filter(
        (entry) => entry.kind === issue.kind && entry.connectionName === issue.connectionName
      );
      if (
        candidates.length === 1 &&
        incoming.filter(
          (entry) => entry.kind === issue.kind && entry.connectionName === issue.connectionName
        ).length === 1
      )
        prior = candidates[0];
    }
    if (prior) matchedIds.add(prior.id);
    return {
      ...issue,
      firstSeenAt: prior?.firstSeenAt ?? checkedAt,
      lastSeenAt: checkedAt,
      observations: (prior?.observations ?? 0) + 1,
    };
  });
  const missing = existing.filter((entry) => !matchedIds.has(entry.id));
  return {
    lastAttemptAt: checkedAt,
    lastFetchedAt: complete ? checkedAt : previous?.lastFetchedAt,
    lastCleanSyncAt: complete && !incoming.length ? checkedAt : previous?.lastCleanSyncAt,
    issues: complete ? issues : [...missing, ...issues],
    history: [
      ...(complete ? missing.map((issue) => ({ ...issue, resolvedAt: checkedAt })) : []),
      ...(previous?.history ?? []),
    ].slice(0, 30),
  };
}
