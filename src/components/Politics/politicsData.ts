type UnknownRecord = Record<string, unknown>;

// Shape of GET /api/politics/feed. The in-container feed is always "configured"
// (sources are keyless or use a settings key that doesn't gate the feed itself),
// so unlike the old Check the Vote bridge there is no missing-config branch.
export type PoliticsFeedPayload = {
  configured: boolean;
  ok: boolean;
  baseUrl?: string;
  service?: string;
  checkedAt?: string;
  health?: unknown;
  sync?: unknown;
  votes?: unknown;
  trades?: unknown;
  filings?: unknown;
  bills?: unknown;
  executiveActions?: unknown;
  error?: string;
};

export type PoliticsSummary = {
  configured: boolean;
  ok: boolean;
  statusLabel: string;
  errorLabel?: string;
  baseUrl?: string;
  service?: string;
  checkedAt?: string;
  syncJobCount: number;
  syncWarningCount: number;
  recentVoteCount: number;
  recentTradeCount: number;
  recentFilingCount: number;
  recentExecutiveActionCount: number;
  filingsNeedingAttentionCount: number;
  recentVoteLabels: string[];
  recentTradeLabels: string[];
  recentExecutiveActionLabels: string[];
  attentionLabels: string[];
};

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' ? (value as UnknownRecord) : {};
}

function arrayFromRecord(value: unknown, keys: string[]): UnknownRecord[] {
  const record = asRecord(value);
  for (const key of keys) {
    const maybeArray = record[key];
    if (Array.isArray(maybeArray)) return maybeArray.map(asRecord);
  }
  return [];
}

/** For top-level arrays (e.g. payload.executiveActions is the array itself). */
function asArray(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function syncJobs(sync: unknown): UnknownRecord[] {
  const direct = arrayFromRecord(sync, ['jobs', 'items', 'runs']);
  if (direct.length > 0) return direct;

  const record = asRecord(sync);
  const cron = asRecord(record.cron);
  const historical = asRecord(record.historical);
  return [
    ...arrayFromRecord(cron, ['recentJobs']),
    ...arrayFromRecord(cron, ['partialJobs']).map((job) => ({ status: 'warning', ...job })),
    ...arrayFromRecord(cron, ['failedJobs']).map((job) => ({ status: 'error', ...job })),
    ...arrayFromRecord(historical, ['recentWarnings']).map((job) => ({
      status: 'warning',
      ...job,
    })),
    ...arrayFromRecord(historical, ['recentErrors']).map((job) => ({ status: 'error', ...job })),
    ...(historical.latestWarning
      ? [{ status: 'warning', ...asRecord(historical.latestWarning) }]
      : []),
    ...(historical.latestError ? [{ status: 'error', ...asRecord(historical.latestError) }] : []),
    ...(Number(historical.staleRunningCount ?? 0) > 0 ? [{ status: 'warning' }] : []),
  ];
}

function countWarningJobs(sync: unknown): number {
  return syncJobs(sync).filter((job) => {
    const status = stringValue(job.status)?.toLowerCase() ?? '';
    return (
      status.includes('error') ||
      status.includes('warn') ||
      status.includes('failed') ||
      status.includes('paused') ||
      Boolean(job.error) ||
      Boolean(job.warning)
    );
  }).length;
}

function voteLabel(vote: UnknownRecord): string {
  const bill = asRecord(vote.bill);
  const title =
    stringValue(bill.title) ?? stringValue(vote.billTitle) ?? stringValue(vote.question);
  const officialId = stringValue(bill.officialId) ?? stringValue(vote.billOfficialId);
  const fallback = stringValue(vote.externalId) ?? 'Bill';
  if (title && officialId) return `${title} · ${officialId}`;
  return title ?? officialId ?? fallback;
}

function tradeLabel(trade: UnknownRecord): string {
  const name =
    stringValue(trade.politicianName) ??
    stringValue(trade.filerName) ??
    stringValue(trade.owner) ??
    'Unknown filer';
  const ticker =
    stringValue(trade.ticker) ?? stringValue(trade.assetTicker) ?? stringValue(trade.assetName);
  const type = stringValue(trade.transactionDescription) ?? stringValue(trade.transactionType);
  const amount = stringValue(trade.amountRange) ?? stringValue(trade.amount);
  return [name, ticker, type, amount].filter(Boolean).join(' · ');
}

const EXEC_TYPE_LABELS: Record<string, string> = {
  executive_order: 'Executive Order',
  proclamation: 'Proclamation',
  signing_statement: 'Memo',
};

function executiveActionLabel(action: UnknownRecord): string {
  const title = stringValue(action.title) ?? 'Presidential document';
  const type = stringValue(action.type);
  const typeLabel = type ? (EXEC_TYPE_LABELS[type] ?? type) : undefined;
  const date = stringValue(action.issuedDate);
  return [title, typeLabel, date].filter(Boolean).join(' · ');
}

function filingNeedsAttention(filing: UnknownRecord): boolean {
  const status = stringValue(filing.status)?.toLowerCase() ?? '';
  const warning =
    stringValue(filing.warning) ?? stringValue(filing.error) ?? stringValue(filing.message);
  return (
    Boolean(warning) ||
    status.includes('error') ||
    status.includes('warn') ||
    status.includes('attention') ||
    status.includes('ocr')
  );
}

function filingLabel(filing: UnknownRecord): string {
  const filer =
    stringValue(filing.filerName) ?? stringValue(filing.politicianName) ?? 'Unknown filer';
  const source = stringValue(filing.source) ?? stringValue(filing.chamber);
  const warning =
    stringValue(filing.warning) ?? stringValue(filing.error) ?? stringValue(filing.message);
  return [filer, source, warning].filter(Boolean).join(' · ');
}

export function summarizePoliticsData(payload: PoliticsFeedPayload): PoliticsSummary {
  const health = asRecord(payload.health);
  const jobs = syncJobs(payload.sync);
  const votes = arrayFromRecord(payload.votes, ['votes', 'items', 'data']);
  const trades = arrayFromRecord(payload.trades, ['trades', 'items', 'data']);
  const filings = arrayFromRecord(payload.filings, ['filings', 'items', 'data']);
  const execActions = asArray(payload.executiveActions);
  const attentionFilings = filings.filter(filingNeedsAttention);

  return {
    configured: payload.configured !== false,
    ok: payload.ok,
    statusLabel: payload.ok ? 'Active' : 'Needs attention',
    errorLabel: payload.error,
    baseUrl: payload.baseUrl,
    service: stringValue(health.service) ?? stringValue(payload.service),
    checkedAt: payload.checkedAt,
    syncJobCount: jobs.length,
    syncWarningCount: countWarningJobs(payload.sync),
    recentVoteCount: votes.length,
    recentTradeCount: trades.length,
    recentFilingCount: filings.length,
    recentExecutiveActionCount: execActions.length,
    filingsNeedingAttentionCount: attentionFilings.length,
    recentVoteLabels: votes.slice(0, 5).map(voteLabel),
    recentTradeLabels: trades.slice(0, 5).map(tradeLabel),
    recentExecutiveActionLabels: execActions.slice(0, 5).map(executiveActionLabel),
    attentionLabels: attentionFilings.slice(0, 5).map(filingLabel),
  };
}
