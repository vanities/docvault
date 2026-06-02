type UnknownRecord = Record<string, unknown>;

type PoliticsPayload =
  | { configured: false; ok: false; reason: 'missing_base_url' | 'missing_api_key' }
  | {
      configured: true;
      ok: boolean;
      baseUrl: string;
      checkedAt: string;
      trades?: unknown;
      votes?: unknown;
      [key: string]: unknown;
    };

type ResearchClaimLike = {
  id: string;
  text: string;
  tickers?: string[];
  topics?: string[];
  stance?: string;
  provenance?: { sourceUrl?: string; lineStart?: number; quote?: string; [key: string]: unknown };
};

type ResearchEntryLike = {
  id: string;
  title?: string | null;
  sourceUrl?: string | null;
  intelligence?: { claims?: ResearchClaimLike[] } | null;
};

export type ResearchPoliticsTradeMatch = {
  politicianName?: string;
  ticker: string;
  category?: string;
  transactionType?: string;
  tradeDate?: string;
  amount?: string;
};

export type ResearchPoliticsVoteMatch = {
  externalId?: string;
  label: string;
};

export type ResearchPoliticsLink = {
  entryId: string;
  title?: string;
  claimId: string;
  claimText: string;
  sourceUrl?: string;
  tickers: string[];
  topics: string[];
  stance?: string;
  matchedTrades: ResearchPoliticsTradeMatch[];
  matchedVotes: ResearchPoliticsVoteMatch[];
};

export type ResearchPoliticsLinkInput = {
  entries: ResearchEntryLike[];
  politics: PoliticsPayload;
  limit?: number;
};

const TOPIC_KEYWORDS: Record<string, string[]> = {
  ai: ['ai', 'artificial intelligence', 'accelerator', 'accelerators', 'gpu', 'data center'],
  semiconductors: ['semiconductor', 'semiconductors', 'chip', 'chips', 'foundry', 'fab'],
  'trade-policy': [
    'trade',
    'tariff',
    'tariffs',
    'export',
    'import',
    'waiver',
    'waivers',
    'sanction',
  ],
  rates: ['fed', 'fomc', 'rate', 'rates', 'inflation', 'treasury', 'treasuries'],
  crypto: ['bitcoin', 'ethereum', 'crypto', 'stablecoin', 'token'],
  energy: ['oil', 'gas', 'lng', 'pipeline', 'energy', 'nuclear', 'uranium'],
  healthcare: ['fda', 'medicare', 'medicaid', 'drug', 'pharma', 'biotech', 'healthcare'],
  defense: ['defense', 'pentagon', 'missile', 'aerospace', 'dod'],
};

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' ? (value as UnknownRecord) : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function arrayFromRecord(value: unknown, keys: string[]): UnknownRecord[] {
  const record = asRecord(value);
  for (const key of keys) {
    const candidate = record[key];
    if (Array.isArray(candidate)) return candidate.map(asRecord);
  }
  return [];
}

function normalizeList(values: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values ?? []) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function tickerFromTrade(trade: UnknownRecord): string | undefined {
  return stringValue(trade.ticker)?.toUpperCase() ?? stringValue(trade.assetTicker)?.toUpperCase();
}

function tradeMatchFor(trade: UnknownRecord): ResearchPoliticsTradeMatch | null {
  const ticker = tickerFromTrade(trade);
  if (!ticker) return null;
  return {
    politicianName: stringValue(trade.politicianName) ?? stringValue(trade.filerName),
    ticker,
    category: stringValue(trade.category),
    transactionType: stringValue(trade.transactionType) ?? stringValue(trade.type),
    tradeDate: stringValue(trade.tradeDate),
    amount: stringValue(trade.amount) ?? stringValue(trade.amountRange),
  };
}

function voteText(vote: UnknownRecord): string {
  const bill = asRecord(vote.bill);
  return [
    vote.question,
    vote.description,
    vote.title,
    vote.billTitle,
    bill.title,
    bill.officialId,
    vote.externalId,
  ]
    .map((part) => stringValue(part))
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function voteLabel(vote: UnknownRecord): string {
  const bill = asRecord(vote.bill);
  return (
    stringValue(bill.title) ??
    stringValue(vote.billTitle) ??
    stringValue(vote.question) ??
    stringValue(vote.externalId) ??
    'Vote'
  );
}

function voteMatchesTopics(vote: UnknownRecord, topics: string[]): boolean {
  const haystack = voteText(vote);
  return topics.some((topic) =>
    (TOPIC_KEYWORDS[topic] ?? [topic]).some((word) => haystack.includes(word))
  );
}

export function buildResearchPoliticsLinks({
  entries,
  politics,
  limit = 25,
}: ResearchPoliticsLinkInput): ResearchPoliticsLink[] {
  if (!politics.configured || !politics.ok) return [];

  const trades = arrayFromRecord(politics.trades, ['trades', 'items', 'data']);
  const votes = arrayFromRecord(politics.votes, ['votes', 'items', 'data']);
  const links: ResearchPoliticsLink[] = [];

  for (const entry of entries) {
    for (const claim of entry.intelligence?.claims ?? []) {
      const tickers = normalizeList(claim.tickers).map((ticker) => ticker.toUpperCase());
      const topics = normalizeList(claim.topics);
      const matchedTrades = trades
        .filter((trade) => {
          const ticker = tickerFromTrade(trade);
          return ticker ? tickers.includes(ticker) : false;
        })
        .map(tradeMatchFor)
        .filter((trade): trade is ResearchPoliticsTradeMatch => trade != null)
        .slice(0, 5);
      const matchedVotes = votes
        .filter((vote) => voteMatchesTopics(vote, topics))
        .map((vote) => ({ externalId: stringValue(vote.externalId), label: voteLabel(vote) }))
        .slice(0, 5);

      if (matchedTrades.length === 0 && matchedVotes.length === 0) continue;

      links.push({
        entryId: entry.id,
        title: stringValue(entry.title) ?? undefined,
        claimId: claim.id,
        claimText: claim.text,
        sourceUrl: stringValue(claim.provenance?.sourceUrl) ?? stringValue(entry.sourceUrl),
        tickers,
        topics,
        stance: stringValue(claim.stance),
        matchedTrades,
        matchedVotes,
      });
      if (links.length >= limit) return links;
    }
  }

  return links;
}
