// Parse the free-text DESCRIPTION field of a House PTR into a structured option
// contract. This is the field that carries the actual tradeable detail — strike,
// expiry, call/put, contract count — that the asset row ("Alphabet Inc. (GOOGL)
// [OP]") omits. Detail-conscious filers (Pelosi being the canonical example)
// spell it out here; it's exactly what a "Pelosi tracker" parses for the
// copy-trading angle.
//
// Pure + deterministic → golden-tested against real disclosure strings.

export interface OptionDetail {
  optionType: 'call' | 'put';
  /** Open vs close vs exercise. null if the verb is unclear. */
  action: 'purchase' | 'sale' | 'exercise' | null;
  contracts: number | null;
  strike: number | null;
  expiry: string | null; // YYYY-MM-DD
  /** Resulting share count, present on exercises ("(5,000 shares)"). */
  shares: number | null;
}

function toIsoMdY(raw: string): string | null {
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const mm = Number(m[1]);
  const dd = Number(m[2]);
  let yy = Number(m[3]);
  if (yy < 100) yy += 2000;
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${yy.toString().padStart(4, '0')}-${mm.toString().padStart(2, '0')}-${dd
    .toString()
    .padStart(2, '0')}`;
}

function num(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Parse a filer description into option detail, or null if it isn't an option
 *  (e.g. "Sold 31,600 shares.", a gift, a bond note). */
export function parseOptionDescription(text: string | null | undefined): OptionDetail | null {
  if (!text) return null;
  const t = text.replace(/\s+/g, ' ').trim();

  // Must mention call/put options with a contract count to be an option contract.
  const contractMatch = t.match(/\b(\d[\d,]*)\s+(call|put)\s+options?\b/i);
  if (!contractMatch) return null;
  const contracts = num(contractMatch[1]);
  const optionType = contractMatch[2].toLowerCase() as 'call' | 'put';

  const action: OptionDetail['action'] = /^purchas/i.test(t)
    ? 'purchase'
    : /^(sold|sale|sell)/i.test(t)
      ? 'sale'
      : /^exercis/i.test(t)
        ? 'exercise'
        : null;

  const strike = num(t.match(/strike price of\s*\$?\s*([\d,]+(?:\.\d+)?)/i)?.[1]);
  const expiry = toIsoMdY(t.match(/expiration date of\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i)?.[1] ?? '');
  // Exercises report the resulting shares: "(5,000 shares)".
  const shares = num(t.match(/\(([\d,]+)\s+shares?\)/i)?.[1]);

  return { optionType, action, contracts, strike, expiry, shares };
}

/** Compact label for the UI, e.g. "GOOGL $150C 1/15/27". Underlying is supplied by
 *  the caller (it lives on the asset row, not the description). */
export function formatOptionLabel(ticker: string | null, opt: OptionDetail): string {
  const parts: string[] = [];
  if (ticker) parts.push(ticker);
  if (opt.strike != null) parts.push(`$${opt.strike}${opt.optionType === 'call' ? 'C' : 'P'}`);
  else parts.push(opt.optionType === 'call' ? 'Calls' : 'Puts');
  if (opt.expiry) {
    const [y, m, d] = opt.expiry.split('-');
    parts.push(`${Number(m)}/${Number(d)}/${y.slice(2)}`);
  }
  return parts.join(' ');
}
