// =============================================================================
// Brokerage Portfolio Tracking
// =============================================================================
// Manual holdings management with live stock/fund price fetching.
// Supports Vanguard, Fidelity, Robinhood (none have public retail APIs,
// so holdings are manually entered and prices are fetched automatically).

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type BrokerId = 'vanguard' | 'fidelity' | 'robinhood' | 'navy-federal' | 'chase';

export interface BrokerHolding {
  ticker: string; // e.g. "VTI", "AAPL"
  shares: number;
  costBasis?: number; // total cost basis (not per-share)
  label?: string; // e.g. "Vanguard Total Stock Market ETF"
}

export interface BrokerAccount {
  id: string; // unique id
  broker: BrokerId;
  name: string; // e.g. "Roth IRA", "Brokerage"
  holdings: BrokerHolding[];
}

export interface BrokerAccountWithValues extends BrokerAccount {
  holdings: (BrokerHolding & { price?: number; marketValue?: number; gainLoss?: number; gainLossPercent?: number })[];
  totalValue: number;
  totalCostBasis: number;
  totalGainLoss: number;
}

export interface BrokerPortfolio {
  accounts: BrokerAccountWithValues[];
  totalValue: number;
  totalCostBasis: number;
  totalGainLoss: number;
  lastUpdated: string;
}

// -----------------------------------------------------------------------------
// Price Cache (Yahoo Finance, 60s TTL)
// -----------------------------------------------------------------------------

let stockPriceCache: Record<string, number> = {};
let stockPriceCacheTime = 0;
const STOCK_PRICE_CACHE_TTL = 60_000; // 1 minute

// Known fund/ETF name mapping for display
const TICKER_NAMES: Record<string, string> = {
  VTI: 'Vanguard Total Stock Market ETF',
  VXUS: 'Vanguard Total International Stock ETF',
  VOO: 'Vanguard S&P 500 ETF',
  VGT: 'Vanguard Information Technology ETF',
  VNQ: 'Vanguard Real Estate ETF',
  BND: 'Vanguard Total Bond Market ETF',
  VTSAX: 'Vanguard Total Stock Market Index Fund',
  VFIAX: 'Vanguard 500 Index Fund',
  VTIAX: 'Vanguard Total International Stock Index Fund',
  VBTLX: 'Vanguard Total Bond Market Index Fund',
  FXAIX: 'Fidelity 500 Index Fund',
  FSKAX: 'Fidelity Total Market Index Fund',
  FTIHX: 'Fidelity Total International Index Fund',
  FXNAX: 'Fidelity US Bond Index Fund',
  SPAXX: 'Fidelity Government Money Market Fund',
  AAPL: 'Apple Inc.',
  MSFT: 'Microsoft Corporation',
  GOOGL: 'Alphabet Inc.',
  AMZN: 'Amazon.com Inc.',
  NVDA: 'NVIDIA Corporation',
  TSLA: 'Tesla Inc.',
  META: 'Meta Platforms Inc.',
  SPY: 'SPDR S&P 500 ETF',
  QQQ: 'Invesco QQQ Trust',
  IWM: 'iShares Russell 2000 ETF',
};

export function getTickerName(ticker: string): string {
  return TICKER_NAMES[ticker.toUpperCase()] || ticker.toUpperCase();
}

// Fetch stock/ETF/fund prices via Yahoo Finance v8 API (no key needed)
export async function fetchStockPrices(tickers: string[]): Promise<Record<string, number>> {
  const now = Date.now();
  const upperTickers = [...new Set(tickers.map((t) => t.toUpperCase()))];

  // Return cache if fresh
  const allCached = upperTickers.every((t) => stockPriceCache[t] !== undefined);
  if (allCached && now - stockPriceCacheTime < STOCK_PRICE_CACHE_TTL) {
    return stockPriceCache;
  }

  // Fetch from Yahoo Finance
  try {
    const symbols = upperTickers.join(',');
    const url = `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${symbols}&range=1d&interval=1d`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
      },
    });

    if (!res.ok) {
      // Fallback: try individual quotes
      return await fetchPricesIndividually(upperTickers);
    }

    const data = await res.json();
    const prices: Record<string, number> = { ...stockPriceCache };

    for (const ticker of upperTickers) {
      const spark = data.spark?.result?.find(
        (r: { symbol: string }) => r.symbol === ticker
      );
      const close = spark?.response?.[0]?.meta?.regularMarketPrice;
      if (close) {
        prices[ticker] = close;
      }
    }

    stockPriceCache = prices;
    stockPriceCacheTime = now;
    return prices;
  } catch {
    return await fetchPricesIndividually(upperTickers);
  }
}

async function fetchPricesIndividually(tickers: string[]): Promise<Record<string, number>> {
  const prices: Record<string, number> = { ...stockPriceCache };

  for (const ticker of tickers) {
    if (prices[ticker]) continue;
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${ticker}&range=1d&interval=1d`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (res.ok) {
        const data = await res.json();
        const close = data.spark?.result?.[0]?.response?.[0]?.meta?.regularMarketPrice;
        if (close) prices[ticker] = close;
      }
    } catch {
      // Skip failed lookups
    }
  }

  stockPriceCache = prices;
  stockPriceCacheTime = Date.now();
  return prices;
}

// -----------------------------------------------------------------------------
// Portfolio Builder
// -----------------------------------------------------------------------------

export async function buildPortfolio(accounts: BrokerAccount[]): Promise<BrokerPortfolio> {
  // Collect all unique tickers
  const allTickers = new Set<string>();
  for (const account of accounts) {
    for (const holding of account.holdings) {
      allTickers.add(holding.ticker.toUpperCase());
    }
  }

  // Fetch all prices
  const prices = allTickers.size > 0 ? await fetchStockPrices(Array.from(allTickers)) : {};

  // Build enriched accounts
  const enrichedAccounts: BrokerAccountWithValues[] = accounts.map((account) => {
    const enrichedHoldings = account.holdings.map((h) => {
      const price = prices[h.ticker.toUpperCase()] || 0;
      const marketValue = h.shares * price;
      const costBasis = h.costBasis || 0;
      const gainLoss = costBasis > 0 ? marketValue - costBasis : 0;
      const gainLossPercent = costBasis > 0 ? (gainLoss / costBasis) * 100 : 0;
      return {
        ...h,
        label: h.label || getTickerName(h.ticker),
        price,
        marketValue,
        gainLoss,
        gainLossPercent,
      };
    });

    const totalValue = enrichedHoldings.reduce((sum, h) => sum + (h.marketValue || 0), 0);
    const totalCostBasis = enrichedHoldings.reduce((sum, h) => sum + (h.costBasis || 0), 0);

    return {
      ...account,
      holdings: enrichedHoldings,
      totalValue,
      totalCostBasis,
      totalGainLoss: totalCostBasis > 0 ? totalValue - totalCostBasis : 0,
    };
  });

  const totalValue = enrichedAccounts.reduce((sum, a) => sum + a.totalValue, 0);
  const totalCostBasis = enrichedAccounts.reduce((sum, a) => sum + a.totalCostBasis, 0);

  return {
    accounts: enrichedAccounts,
    totalValue,
    totalCostBasis,
    totalGainLoss: totalCostBasis > 0 ? totalValue - totalCostBasis : 0,
    lastUpdated: new Date().toISOString(),
  };
}

export const BROKER_LABELS: Record<BrokerId, string> = {
  vanguard: 'Vanguard',
  fidelity: 'Fidelity',
  robinhood: 'Robinhood',
  'navy-federal': 'Navy Federal',
  chase: 'Chase',
};
