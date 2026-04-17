// Claude model pricing table + cost math.
// Source: https://platform.claude.com/docs/en/about-claude/pricing
// All prices are USD per million tokens.

export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWrite5mPerMTok: number;
  cacheWrite1hPerMTok: number;
  cacheReadPerMTok: number;
}

// Keyed by the canonical family ID Anthropic uses (without the dated suffix).
// Dated variants (e.g. "claude-sonnet-4-6-20250929") resolve via lookupPricing().
export const MODEL_PRICING: Record<string, ModelPrice> = {
  // Opus family — 4.5 / 4.6 / 4.7 share the same rate card.
  'claude-opus-4-7': {
    inputPerMTok: 5,
    outputPerMTok: 25,
    cacheWrite5mPerMTok: 6.25,
    cacheWrite1hPerMTok: 10,
    cacheReadPerMTok: 0.5,
  },
  'claude-opus-4-6': {
    inputPerMTok: 5,
    outputPerMTok: 25,
    cacheWrite5mPerMTok: 6.25,
    cacheWrite1hPerMTok: 10,
    cacheReadPerMTok: 0.5,
  },
  'claude-opus-4-5': {
    inputPerMTok: 5,
    outputPerMTok: 25,
    cacheWrite5mPerMTok: 6.25,
    cacheWrite1hPerMTok: 10,
    cacheReadPerMTok: 0.5,
  },
  // Older Opus generations are 3x more expensive.
  'claude-opus-4-1': {
    inputPerMTok: 15,
    outputPerMTok: 75,
    cacheWrite5mPerMTok: 18.75,
    cacheWrite1hPerMTok: 30,
    cacheReadPerMTok: 1.5,
  },
  'claude-opus-4': {
    inputPerMTok: 15,
    outputPerMTok: 75,
    cacheWrite5mPerMTok: 18.75,
    cacheWrite1hPerMTok: 30,
    cacheReadPerMTok: 1.5,
  },
  // Sonnet family — 4 / 4.5 / 4.6 all share the same card.
  'claude-sonnet-4-6': {
    inputPerMTok: 3,
    outputPerMTok: 15,
    cacheWrite5mPerMTok: 3.75,
    cacheWrite1hPerMTok: 6,
    cacheReadPerMTok: 0.3,
  },
  'claude-sonnet-4-5': {
    inputPerMTok: 3,
    outputPerMTok: 15,
    cacheWrite5mPerMTok: 3.75,
    cacheWrite1hPerMTok: 6,
    cacheReadPerMTok: 0.3,
  },
  'claude-sonnet-4': {
    inputPerMTok: 3,
    outputPerMTok: 15,
    cacheWrite5mPerMTok: 3.75,
    cacheWrite1hPerMTok: 6,
    cacheReadPerMTok: 0.3,
  },
  // Haiku.
  'claude-haiku-4-5': {
    inputPerMTok: 1,
    outputPerMTok: 5,
    cacheWrite5mPerMTok: 1.25,
    cacheWrite1hPerMTok: 2,
    cacheReadPerMTok: 0.1,
  },
  'claude-haiku-3-5': {
    inputPerMTok: 0.8,
    outputPerMTok: 4,
    cacheWrite5mPerMTok: 1,
    cacheWrite1hPerMTok: 1.6,
    cacheReadPerMTok: 0.08,
  },
  'claude-haiku-3': {
    inputPerMTok: 0.25,
    outputPerMTok: 1.25,
    cacheWrite5mPerMTok: 0.3,
    cacheWrite1hPerMTok: 0.5,
    cacheReadPerMTok: 0.03,
  },
};

/**
 * Look up pricing for a model ID. Tolerates dated suffixes
 * (e.g. "claude-sonnet-4-6-20250929") and unknown tails via prefix match.
 * Returns `null` if no entry matches — the caller should treat this as
 * "cost unknown" rather than crashing.
 */
export function lookupPricing(modelId: string): ModelPrice | null {
  if (MODEL_PRICING[modelId]) return MODEL_PRICING[modelId];

  // Strip trailing date suffix (YYYYMMDD).
  const withoutDate = modelId.replace(/-\d{8}$/, '');
  if (MODEL_PRICING[withoutDate]) return MODEL_PRICING[withoutDate];

  // Progressive prefix match: longest key first wins so that
  // "claude-opus-4-7" beats "claude-opus-4".
  const keys = Object.keys(MODEL_PRICING).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (modelId.startsWith(key)) return MODEL_PRICING[key];
  }
  return null;
}

export interface UsageTokens {
  inputTokens: number;
  outputTokens: number;
  /**
   * Total cache-creation tokens as reported by older SDK responses. Treated
   * as 5-minute-TTL writes unless the split fields below are present.
   */
  cacheCreationInputTokens?: number;
  /** 5-minute-TTL cache writes (newer `cache_creation.ephemeral_5m_input_tokens`). */
  cacheCreationEphemeral5mInputTokens?: number;
  /** 1-hour-TTL cache writes (newer `cache_creation.ephemeral_1h_input_tokens`). */
  cacheCreationEphemeral1hInputTokens?: number;
  /** Cache-read (hit) tokens — 90% cheaper than base input. */
  cacheReadInputTokens?: number;
}

export interface CostBreakdown {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  total: number;
  currency: 'USD';
}

/**
 * Compute the dollar cost for a single call. Prefers explicit split
 * 5m/1h cache fields; if only the bundled `cacheCreationInputTokens` is
 * supplied it is priced at the 5-minute rate (the SDK default cache TTL).
 */
export function calculateCost(modelId: string, usage: UsageTokens): CostBreakdown | null {
  const p = lookupPricing(modelId);
  if (!p) return null;

  const split5m = usage.cacheCreationEphemeral5mInputTokens ?? 0;
  const split1h = usage.cacheCreationEphemeral1hInputTokens ?? 0;
  const bundle = usage.cacheCreationInputTokens ?? 0;
  // If the API gave us the split, trust it; otherwise assume bundle == 5m.
  const cache5mTokens = split5m + split1h === 0 ? bundle : split5m;
  const cache1hTokens = split1h;

  const input = (usage.inputTokens / 1_000_000) * p.inputPerMTok;
  const output = (usage.outputTokens / 1_000_000) * p.outputPerMTok;
  const cacheWrite5m = (cache5mTokens / 1_000_000) * p.cacheWrite5mPerMTok;
  const cacheWrite1h = (cache1hTokens / 1_000_000) * p.cacheWrite1hPerMTok;
  const cacheRead = ((usage.cacheReadInputTokens ?? 0) / 1_000_000) * p.cacheReadPerMTok;

  return {
    input,
    output,
    cacheWrite5m,
    cacheWrite1h,
    cacheRead,
    total: input + output + cacheWrite5m + cacheWrite1h + cacheRead,
    currency: 'USD',
  };
}
