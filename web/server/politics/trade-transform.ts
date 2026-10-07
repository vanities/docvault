// Shared trade-disclosure transforms — ported from the Check the Vote repo
// (`lib/ingest/trades/transform.ts`), trimmed to what the DocVault feed needs.

import type { TradeCategory } from './types.js';

function parseMoney(raw: string): number | null {
  const digits = raw.replace(/[^0-9]/g, '');
  return digits ? Number(digits) : null;
}

/** "$1,001 - $15,000" → {min, max}; "Over $5,000,000" → {min, null}. */
export function parseDisclosureAmountRange(amount: string | null | undefined): {
  amountMin: number | null;
  amountMax: number | null;
} {
  const value = amount?.trim() || null;
  if (!value) return { amountMin: null, amountMax: null };

  const over = value.match(/^over\s+(.+)$/i);
  if (over) return { amountMin: parseMoney(over[1]), amountMax: null };

  const [minRaw, maxRaw] = value.split(/\s+-\s+/);
  if (maxRaw) return { amountMin: parseMoney(minRaw), amountMax: parseMoney(maxRaw) };

  const single = parseMoney(value);
  return { amountMin: single, amountMax: single };
}

export function normalizeTradeCategory(value: string | null | undefined): TradeCategory {
  const lower = value?.trim().toLowerCase() ?? '';
  if (lower.includes('purchase') || lower === 'p' || lower === 'buy') return 'buy';
  if (lower.includes('sale') || lower === 's' || lower === 'sell') return 'sell';
  if (lower.includes('exchange') || lower === 'e') return 'exchange';
  if (lower.includes('gift')) return 'gift';
  return 'other';
}
