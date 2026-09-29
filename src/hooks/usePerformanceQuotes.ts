import { useEffect, useState } from 'react';
import { API_BASE } from '../constants';
import type { PerformanceQuote } from '../../server/market-changes';

// The server shares its 15-minute quote cache with Research/Quant. Keep page
// loads nonblocking and request the entire symbol set, not one request per row.
export function usePerformanceQuotes(symbols: (string | null)[], refreshKey?: string) {
  const symbolKey = [...new Set(symbols.filter((symbol): symbol is string => !!symbol))]
    .sort()
    .join(',');
  const [quotes, setQuotes] = useState<Record<string, PerformanceQuote>>({});
  useEffect(() => {
    const controller = new AbortController();
    setQuotes({});
    if (!symbolKey) return;
    void (async () => {
      const symbols = symbolKey.split(',');
      for (let offset = 0; offset < symbols.length; offset += 100) {
        const batch = symbols.slice(offset, offset + 100).join(',');
        const res = await fetch(
          `${API_BASE}/quant/tickers/prices?symbols=${encodeURIComponent(batch)}`,
          { signal: controller.signal }
        );
        if (!res.ok) continue;
        const data = (await res.json()) as { quotes: PerformanceQuote[] };
        if (!controller.signal.aborted && Array.isArray(data.quotes)) {
          setQuotes((previous) => ({
            ...previous,
            ...Object.fromEntries(data.quotes.map((quote) => [quote.symbol, quote])),
          }));
        }
      }
    })().catch(() => {});
    return () => controller.abort();
  }, [symbolKey, refreshKey]);
  return quotes;
}
