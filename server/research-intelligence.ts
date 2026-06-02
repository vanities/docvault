export const RESEARCH_INTELLIGENCE_VERSION = 1;

export type ResearchIntelligenceInput = {
  id: string;
  title?: string | null;
  sourceUrl?: string | null;
  publisher?: string | null;
  reportDate?: string | null;
  mediaType: 'application/pdf' | 'text/plain';
  text?: string | null;
  tickers?: string[] | null;
};

export type ResearchSourceProvenance = {
  entryId: string;
  title?: string;
  sourceUrl?: string;
  publisher?: string;
  reportDate?: string;
  mediaType: ResearchIntelligenceInput['mediaType'];
};

export type ResearchTextProvenance = ResearchSourceProvenance & {
  lineStart: number;
  lineEnd: number;
  charStart: number;
  charEnd: number;
  quote: string;
};

export type ResearchSummaryBullet = {
  text: string;
  provenance: ResearchTextProvenance;
};

export type ResearchClaim = {
  id: string;
  text: string;
  tickers: string[];
  topics: string[];
  stance: 'bullish' | 'bearish' | 'risk' | 'neutral';
  provenance: ResearchTextProvenance;
};

export type ResearchIntelligence = {
  version: typeof RESEARCH_INTELLIGENCE_VERSION;
  source: ResearchSourceProvenance;
  summary: ResearchSummaryBullet[];
  claims: ResearchClaim[];
};

type TextSpan = {
  text: string;
  lineStart: number;
  lineEnd: number;
  charStart: number;
  charEnd: number;
};

const CLAIM_CUE_RE =
  /\b(will|should|could|may|might|expects?|forecast|predicts?|argues?|claims?|believes?|thesis|risk|risks?|benefit|benefits|accelerate|slow|weaken|strengthen|tariffs?|waivers?|policy|regulation)\b/i;

const TOPIC_RULES: Array<[topic: string, pattern: RegExp]> = [
  ['ai', /\b(ai|artificial intelligence|accelerators?|gpu|gpus|data centers?)\b/i],
  [
    'semiconductors',
    /\b(semiconductor|semiconductors|chip|chips|foundry|fabs?|capex|nvda|nvidia|tsm|taiwan semiconductor)\b/i,
  ],
  [
    'trade-policy',
    /\b(tariffs?|export|imports?|waivers?|sanctions?|china|taiwan|policy|regulation)\b/i,
  ],
  ['rates', /\b(fed|fomc|rates?|yield curve|treasurys?|treasuries|inflation|cpi)\b/i],
  ['crypto', /\b(bitcoin|btc|ethereum|eth|crypto|stablecoin|token)\b/i],
  ['energy', /\b(oil|gas|lng|pipeline|solar|wind|uranium|nuclear|energy)\b/i],
  ['healthcare', /\b(fda|medicare|medicaid|drug|pharma|biotech|hospital|healthcare)\b/i],
  ['defense', /\b(defense|pentagon|missile|aerospace|weapons?|dod)\b/i],
];

function cleanOptional(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function sourceFor(entry: ResearchIntelligenceInput): ResearchSourceProvenance {
  return {
    entryId: entry.id,
    title: cleanOptional(entry.title),
    sourceUrl: cleanOptional(entry.sourceUrl),
    publisher: cleanOptional(entry.publisher),
    reportDate: cleanOptional(entry.reportDate),
    mediaType: entry.mediaType,
  };
}

function normalizeTickerList(tickers: string[] | null | undefined): string[] {
  if (!Array.isArray(tickers)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ticker of tickers) {
    const normalized = ticker.trim().toUpperCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function sentenceSpans(text: string): TextSpan[] {
  const spans: TextSpan[] = [];
  let globalOffset = 0;
  const lines = text.split(/\n/);

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const sentencePattern = /[^.!?\n]+(?:[.!?]+|$)/g;
    for (const match of line.matchAll(sentencePattern)) {
      const raw = match[0];
      const trimmed = raw.replace(/\s+/g, ' ').trim();
      if (trimmed.length < 24) continue;
      const localStart = (match.index ?? 0) + raw.search(/\S/);
      const charStart = globalOffset + Math.max(0, localStart);
      spans.push({
        text: trimmed,
        lineStart: lineNumber,
        lineEnd: lineNumber,
        charStart,
        charEnd: charStart + trimmed.length,
      });
    }
    globalOffset += line.length + 1;
  });

  return spans;
}

function provenanceFor(source: ResearchSourceProvenance, span: TextSpan): ResearchTextProvenance {
  return {
    ...source,
    lineStart: span.lineStart,
    lineEnd: span.lineEnd,
    charStart: span.charStart,
    charEnd: span.charEnd,
    quote: span.text,
  };
}

function tickersForSpan(span: TextSpan, tickers: string[]): string[] {
  const text = span.text.toUpperCase();
  return tickers.filter((ticker) =>
    new RegExp(`(^|[^A-Z0-9])${escapeRegExp(ticker)}([^A-Z0-9]|$)`).test(text)
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function topicsForSpan(span: TextSpan): string[] {
  const topics = TOPIC_RULES.filter(([, pattern]) => pattern.test(span.text)).map(
    ([topic]) => topic
  );
  return Array.from(new Set(topics));
}

function stanceForSpan(span: TextSpan): ResearchClaim['stance'] {
  if (
    /\b(risk|risks|downside|bearish|weaken|slow|pressure|tariff|tariffs|sanctions)\b/i.test(
      span.text
    )
  ) {
    return 'risk';
  }
  if (/\b(accelerate|benefit|bullish|upside|growth|strengthen|increase|surge)\b/i.test(span.text)) {
    return 'bullish';
  }
  if (/\b(decline|fall|falls|drop|drops|bearish|negative)\b/i.test(span.text)) return 'bearish';
  return 'neutral';
}

function scoreSpan(span: TextSpan, tickers: string[]): number {
  if (/\b(without|no|not)\b[^.!?]{0,40}\b(claim|signal|takeaway)\b/i.test(span.text)) return 0;

  let score = 0;
  score += tickersForSpan(span, tickers).length * 4;
  if (CLAIM_CUE_RE.test(span.text)) score += 3;
  score += topicsForSpan(span).length;
  if (span.text.length > 220) score -= 1;
  return score;
}

export function buildResearchIntelligence(entry: ResearchIntelligenceInput): ResearchIntelligence {
  const source = sourceFor(entry);
  const tickers = normalizeTickerList(entry.tickers);
  const spans = sentenceSpans(entry.text ?? '');
  const scored = spans
    .map((span) => ({ span, score: scoreSpan(span, tickers) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.span.charStart - b.span.charStart);

  const summary = scored.slice(0, 5).map(({ span }) => ({
    text: span.text,
    provenance: provenanceFor(source, span),
  }));

  const claims = scored
    .filter(({ span }) => CLAIM_CUE_RE.test(span.text) || tickersForSpan(span, tickers).length > 0)
    .slice(0, 12)
    .map(({ span }, index) => ({
      id: `claim-${index + 1}`,
      text: span.text,
      tickers: tickersForSpan(span, tickers),
      topics: topicsForSpan(span),
      stance: stanceForSpan(span),
      provenance: provenanceFor(source, span),
    }));

  return {
    version: RESEARCH_INTELLIGENCE_VERSION,
    source,
    summary,
    claims,
  };
}
