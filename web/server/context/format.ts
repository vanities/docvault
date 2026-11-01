// Small formatting and date helpers shared by context sources. Dates are plain
// YYYY-MM-DD strings, compared as strings and shifted in UTC so no local
// timezone can move a day.

export function money(n: number, cents = false): string {
  const digits = cents ? 2 : 0;
  const body = Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${n < 0 ? '-' : ''}$${body}`;
}

/** "+$1,200" / "-$5,000": for amounts whose direction is the point. */
export function signedMoney(n: number, cents = false): string {
  return `${n < 0 ? '-' : '+'}${money(Math.abs(n), cents)}`;
}

export function percent(rate: number): string {
  return `${(rate * 100).toFixed(2).replace(/\.?0+$/, '')}%`;
}

export function addDays(ymd: string, days: number): string {
  const t = Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function daysBetween(fromYmd: string, toYmd: string): number {
  return Math.round(
    (Date.parse(`${toYmd}T00:00:00Z`) - Date.parse(`${fromYmd}T00:00:00Z`)) / 86_400_000
  );
}

export function clip(text: string, max = 80): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
