// Quant tickers route — live price lookup for tagged tickers.
//
// Backs the per-entry price strip in the Research panel and the
// aggregate Tickers view in Quant. The actual fetching + caching lives
// in ../ticker-prices.ts; this is just the HTTP layer plus input
// validation. Kept in its own dispatcher (rather than inside
// routes/quant.ts) so the prices endpoint is matched before the broader
// quant routes — a path collision is unlikely but the separation is
// cheap insurance.
//
// Routes:
//   GET /api/quant/tickers/prices?symbols=A,B,C
//     Returns { quotes: TickerQuote[], cached: number, fetched: number }
//     Quotes are in input order; per-symbol errors are carried inside the
//     TickerQuote (so a bad symbol doesn't fail the whole batch).

import { jsonResponse } from '../data.js';
import { normalizeTickers } from '../tickers.js';
import { fetchTickerPrices } from '../ticker-prices.js';

const SYMBOLS_LIMIT = 100;

export async function handleQuantTickerRoutes(
  req: Request,
  url: URL,
  pathname: string
): Promise<Response | null> {
  if (pathname === '/api/quant/tickers/prices' && req.method === 'GET') {
    const raw = url.searchParams.get('symbols') ?? '';
    const symbols = normalizeTickers(raw.split(','));
    if (symbols.length === 0) {
      return jsonResponse({ error: 'No valid tickers in "symbols" param' }, 400);
    }
    if (symbols.length > SYMBOLS_LIMIT) {
      return jsonResponse({ error: `Too many symbols (max ${SYMBOLS_LIMIT})` }, 400);
    }
    const result = await fetchTickerPrices(symbols);
    return jsonResponse(result);
  }

  return null;
}
