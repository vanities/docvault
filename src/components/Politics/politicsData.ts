type UnknownRecord = Record<string, unknown>;

export type CheckTheVotePoliticsPayload =
  | { configured: false; ok: false; reason: 'missing_base_url' | 'missing_api_key' }
  | {
      configured: true;
      ok: boolean;
      baseUrl: string;
      checkedAt: string;
      health?: unknown;
      sync?: unknown;
      votes?: unknown;
      trades?: unknown;
      filings?: unknown;
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
  filingsNeedingAttentionCount: number;
  recentVoteLabels: string[];
  recentTradeLabels: string[];
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
  const fallback = stringValue(vote.externalId) ?? 'Vote';
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
  const type = stringValue(trade.transactionType) ?? stringValue(trade.type);
  const amount = stringValue(trade.amountRange) ?? stringValue(trade.amount);
  return [name, ticker, type, amount].filter(Boolean).join(' · ');
}

function filingNeedsAttention(filing: UnknownRecord): boolean {
  const status = stringValue(filing.status)?.toLowerCase() ?? '';
  const warning =
    stringValue(filing.warning) ?? stringValue(filing.error) ?? stringValue(filing.message);
  return (
    Boolean(warning) ||
    status.includes('error') ||
    status.includes('warn') ||
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

export function summarizePoliticsData(payload: CheckTheVotePoliticsPayload): PoliticsSummary {
  if (!payload.configured) {
    return {
      configured: false,
      ok: false,
      statusLabel: 'Not configured',
      errorLabel:
        payload.reason === 'missing_api_key'
          ? 'Missing CHECKTHEVOTE_API_KEY'
          : 'Missing CHECKTHEVOTE_BASE_URL',
      syncJobCount: 0,
      syncWarningCount: 0,
      recentVoteCount: 0,
      recentTradeCount: 0,
      recentFilingCount: 0,
      filingsNeedingAttentionCount: 0,
      recentVoteLabels: [],
      recentTradeLabels: [],
      attentionLabels: [],
    };
  }

  const health = asRecord(payload.health);
  const jobs = syncJobs(payload.sync);
  const votes = arrayFromRecord(payload.votes, ['votes', 'items', 'data']);
  const trades = arrayFromRecord(payload.trades, ['trades', 'items', 'data']);
  const filings = arrayFromRecord(payload.filings, ['filings', 'items', 'data']);
  const attentionFilings = filings.filter(filingNeedsAttention);

  return {
    configured: true,
    ok: payload.ok,
    statusLabel: payload.ok ? 'Connected' : 'Needs attention',
    errorLabel: payload.error,
    baseUrl: payload.baseUrl,
    service: stringValue(health.service),
    checkedAt: payload.checkedAt,
    syncJobCount: jobs.length,
    syncWarningCount: countWarningJobs(payload.sync),
    recentVoteCount: votes.length,
    recentTradeCount: trades.length,
    recentFilingCount: filings.length,
    filingsNeedingAttentionCount: attentionFilings.length,
    recentVoteLabels: votes.slice(0, 5).map(voteLabel),
    recentTradeLabels: trades.slice(0, 5).map(tradeLabel),
    attentionLabels: attentionFilings.slice(0, 5).map(filingLabel),
  };
}
