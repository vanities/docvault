// Ticker symbol normalization.
//
// We use Yahoo Finance's symbol format throughout DocVault because that's
// the source `yahoo-finance2` queries against (and Yahoo covers every
// public exchange the user cares about). Examples:
//   `NVDA`            US common stock
//   `TSM`             ADR
//   `^GSPC`           index (S&P 500)
//   `ES=F`            futures
//   `BTC-USD`         crypto
//   `4063.T`          Japan (Tokyo Stock Exchange)
//   `WAF.DE`          Germany (XETRA)
//   `6488.TWO`        Taiwan OTC
//   `NK.PA`           Euronext Paris
//
// Normalization rules: trim → uppercase → strict charset
// (`A–Z`, `0–9`, `.`, `-`, `=`, `^`) → length cap → dedup. Anything
// outside the charset is dropped silently rather than transformed, so
// pasted garbage from a transcript can't poison the store.

const MAX_LEN = 16;
const VALID = /^[A-Z0-9.\-=^]+$/;

/** Normalize a single value to a valid Yahoo-style ticker, or `null`. */
export function normalizeTicker(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const sym = input.trim().toUpperCase();
  if (sym === '' || sym.length > MAX_LEN) return null;
  if (!VALID.test(sym)) return null;
  return sym;
}

/**
 * Normalize an arbitrary input value to a deduped list of valid tickers.
 * Non-arrays and non-string elements are silently filtered. Order is
 * preserved (first occurrence wins).
 */
export function normalizeTickers(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of input) {
    const sym = normalizeTicker(item);
    if (sym && !seen.has(sym)) {
      seen.add(sym);
      out.push(sym);
    }
  }
  return out;
}
