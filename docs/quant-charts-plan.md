# Quant Charts — Plan & Catalog

Living reference for the Quant section. Inspired by Benjamin Cowen's
[Into The Cryptoverse](https://app.intothecryptoverse.com/charts) (ITC) which
organizes charts under three categories: **Crypto**, **Macro**, and **TradFi**.

---

## ITC catalog (full reference)

Sourced from [ITC's help article on charts by tier](https://help.intothecryptoverse.com/support/solutions/articles/69000833996-what-charts-tools-are-offered-in-each-tier-).

### Crypto

**Price & trend**

- Logarithmic Regression Charts _(Lite/free)_
- Total Crypto Market Cap & Trendline _(Lite/free)_
- Moving Averages
- Bull Market Support Band (BMSB)
- Bollinger Bands
- Golden / Death Crosses
- Historical Risk Levels
- Price Color-Coded by Risk
- Time in Risk Bands
- Running ROI
- Monthly Returns / Average Daily Returns / ROI Bands
- Bitcoin Dominance
- Altcoin Season Index
- Flippening Index (ETH vs BTC)

**Oscillators / signals**

- Pi Cycle Bottom / Top
- Short-Term Bubble Risk
- RSI (Relative Strength Index)
- MACD
- Fear & Greed Index
- Correlation Coefficients
- Benford's Law

**On-chain**

- MVRV / MVRV Z-Score
- Supply in Profit / Loss
- Puell Multiple
- Supply Flow to Exchanges
- Mining Statistics
- Coin Days Destroyed
- Address Count / Activity / Creation
- HODL Waves
- RHODL Waves / Ratio

**Social**

- YouTube Subscribers/Views
- Reddit Subscribers/Posts/Comments
- Twitter Followers/Tweets
- Wikipedia Page Views

**NFTs**

- ERC-721 Transactions & Transfers
- ERC-1155 Transactions & Transfers

**Derivatives**

- Open Interest (Futures / Options)
- Liquidations (totals / count)
- Long/Short Ratio
- Funding Rate

**Crypto tools** (not standalone charts)

- Crypto Risk Indicator Dashboard
- Modern Portfolio Theory
- Portfolios Weighted By Market Cap
- Weighted Risk
- Strategies Dashboard
- Exit Strategies Tool
- Dynamic DCA Tool

### Macro (Pro-tier)

Essentially a FRED visualization layer. FRED has nearly all of these series
natively.

**Growth & income**

- GDP / GNP
- Real Gross Private Domestic Investment (RGPDI)
- Real Personal Income
- Real Personal Income Excluding Transfer Receipts
- Real Disposable Personal Income
- Personal Saving Rate
- Income Distribution Statistics

**Debt & balance sheet**

- Debt-to-GDP Ratio
- Total National Federal Debt
- Fed Total Assets
- Consumer Loans Statistics
- Business Loans
- ONRRP (overnight reverse repo)

**Money & liquidity**

- M1 / M2 Money Supply
- DXY (Dollar Index)

**Rates & yield curve**

- Treasury Yield Spreads / Curves
- FFR (Fed Funds Rate)

**Inflation & labor**

- Core Inflation YoY
- Inflation YoY
- Unemployment Statistics
- Employment Statistics
- Michigan Consumer Sentiment Index (MCSI)

**Economic indicators**

- Composite Leading Indicator
- NFCI (National Financial Conditions Index)

**Real estate**

- Real Estate Loans
- House Price Indices
- Residential Sales
- Housing Starts
- Mortgage Rates

### TradFi / Equities (Pro-tier)

Per-asset charts on SP500, TSLA, NFLX, MSTR, DXY, Gold, Silver, Palladium,
Platinum, Nickel, Copper:

- Historical & Forward-Looking EPS
- Outstanding Shares
- P/B Ratio
- ROI During SP500 Bear/Bull Markets
- Running ROI
- Monthly Returns
- Average Daily Returns
- Monthly Average ROI
- ROI Bands
- SP500 Dividend Yield
- Trailing PE Ratio
- Shiller PE Ratio (CAPE)

---

## Where our data sources map

| Category                                                           | Source                                          | Cost                 | Notes                                                                                                                                                              |
| ------------------------------------------------------------------ | ----------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SPX long-history monthly                                           | **Shiller CSV** (GitHub `datasets/s-and-p-500`) | Free                 | Monthly back to 1871. Already wired. CSV also has `Dividend`, `Earnings`, `CPI`, `Long Interest Rate`, and `PE10` (CAPE) — gets us several TradFi charts for free. |
| BTC / ETH daily                                                    | **yahoo-finance2** (`BTC-USD`, `ETH-USD`)       | Free, no key         | Back to ~2014-09. Already wired. Reliable.                                                                                                                         |
| Sector ETFs (XLE, XLI, XLK, etc.)                                  | **yahoo-finance2**                              | Free                 | FRED doesn't have sector ETFs.                                                                                                                                     |
| Individual stocks / commodities                                    | **yahoo-finance2**                              | Free                 | TSLA, NFLX, MSTR, Gold, Silver, Copper all available.                                                                                                              |
| Macro series (yields, M2, CPI, DXY, unemployment, fed funds, GDP…) | **FRED**                                        | Free key required    | Key already saved in settings. 120 req/min.                                                                                                                        |
| Crypto market cap & dominance                                      | **CoinGecko `/global`**                         | Free, no key         | `days=max` is paid-only but `/global` is free.                                                                                                                     |
| Altcoin top-50 prices                                              | **CoinGecko**                                   | Free (limited)       | More complex to wire up.                                                                                                                                           |
| On-chain (MVRV, Puell, HODL)                                       | **Glassnode / Coin Metrics**                    | Paid or limited free | Glassnode free tier is very restricted. Deprioritized.                                                                                                             |
| Derivatives (OI, funding)                                          | **Binance public API**                          | Free, no key         | Good free source.                                                                                                                                                  |
| NFT transactions                                                   | **Alchemy / Dune**                              | Paid                 | Deprioritized.                                                                                                                                                     |
| Social stats                                                       | Per-platform APIs                               | Mixed                | Low signal for trading. Deprioritized.                                                                                                                             |

---

## What's already built

| Chart                      | Data                   | Location                                          |
| -------------------------- | ---------------------- | ------------------------------------------------- |
| BTC Log Regression Bands   | yahoo `BTC-USD`, 2014+ | `src/components/Quant/BtcLogRegressionChart.tsx`  |
| Presidential Cycle heatmap | Shiller CSV (1871+)    | `src/components/Quant/PresidentialCycleChart.tsx` |

Backend: `server/routes/quant.ts` with daily scheduled refresh via
`server/scheduler.ts → runQuantRefresh()` and historical snapshot log at
`.docvault-quant-snapshots.json`.

---

## Priority queue — next charts to build

Ordered by **signal value ÷ implementation cost**. Top of list is the highest
leverage next step.

### Tier 1 — build next

1. **Sector Rotation dashboard**

   11 S&P sector ETFs (XLE, XLI, XLK, XLF, XLU, XLY, XLP, XLV, XLB, XLRE, XLC)
   ranked by relative strength vs SPY plus 20W SMA slope. Directly answers
   "when do energy/manufacturing run" — the core thesis. Source: yahoo-finance2.

2. **Shiller PE (CAPE) + SP500 Dividend Yield**

   Already have the data (`PE10` and `Dividend` columns in Shiller CSV). Shows
   whether US stocks are rich or cheap vs 150 years of history. ~30 min
   incremental on top of the existing endpoint.

3. **Macro overlay dashboard**

   Single page with DXY, 10Y yield, M2, Fed funds rate, Core CPI. All FRED,
   all already have a key saved. First real FRED usage in the app.

4. **Yield Curve Inversion** (T10Y2Y, T10Y3M)

   FRED, classic recession signal. Plots the spread with a zero-line highlight
   and shades historical inversions.

### Tier 2 — generalizations

5. **Generalized Log Regression** — refactor BTC chart to accept any symbol.
   Enables log regression for SPX, Gold, MSTR, TSLA, etc.
6. **Monthly Returns heatmap** for any asset — generalize the presidential
   cycle code to accept any symbol, compute seasonality by calendar month.
7. **Bitcoin Dominance** — CoinGecko `/global`, single line chart.
8. **BTC 200W SMA / Bull Market Support Band** — 20W + 21W EMA on BTC price.
9. **Moving Averages / Golden & Death Crosses** — generic SMA overlay
   primitives usable on any chart.

### Tier 3 — requires more data wrangling

10. **Sector Rotation Quadrant** — momentum × relative strength scatter, each
    sector as a moving point.
11. **Composite Crypto Risk Metric** — blended 0–1 score from Mayer multiple,
    distance from 20W SMA, RSI, regression σ, drawdown from ATH.
12. **Altcoin Season Index** — top 50 alts % outperforming BTC over 90 days.
13. **Derivatives panel** — BTC open interest, funding rate, long/short ratio
    from Binance public API.
14. **Running ROI** — rolling annual return for any asset.

### Deprioritized (hard data / low signal)

- On-chain metrics (MVRV, Puell, HODL Waves, supply in profit)
- NFT transaction volumes
- Social media stats

---

## Implementation notes

### Reusable building blocks to extract

As we build more charts, extract these into `src/components/Quant/lib/`:

- `indicators.ts` — SMA, EMA, RSI, MACD, Bollinger Bands, log-regression fit.
  Pure functions on `{time, value}[]`.
- `yahooHelpers.ts` — shared server-side helpers for cleaning and deduping
  yahoo-finance2 daily bars.
- `fredHelpers.ts` — shared `fetchFredSeries(id, start)` that handles auth
  errors, missing-value markers (`.`), and observations normalization.
- `chartTheme.ts` — shared color palette (price orange, trend white,
  bullish emerald, bearish rose) and base ECharts / lightweight-charts options.

### Cache & snapshot policy

- **Heavy time-series** (BTC daily, Shiller CSV) → 24-hour cache, daily
  scheduler refresh.
- **Macro series** (FRED) → 24-hour cache, but FRED data often updates
  weekly/monthly so the effective freshness is set by FRED itself.
- **Crypto spot/derivatives** (if added later) → 5-minute cache.
- **Snapshots** → one row per day in `.docvault-quant-snapshots.json`. Extend
  the `QuantSnapshot` type each time we add a new metric worth trending.

### Cowen's "risk metric" (composite)

His famous 0–1 risk metric isn't a single indicator but a **blended percentile
rank** across several inputs, then smoothed. When we build ours, keep the
inputs transparent so the user can see what's driving the current value:

1. Mayer multiple (`price / 200d_sma`)
2. Distance from 20-week SMA (`(price - sma20w) / sma20w`)
3. 2-year log-regression σ (already compute in BTC chart)
4. RSI on daily close
5. Drawdown from all-time high

Each input normalized to 0–1 via its own 5-year percentile, then averaged.
Add weights later if needed.

### Heatmap colors

ECharts `visualMap` with a diverging scale from `#7f1d1d` (deep red) → `#f1f5f9`
(neutral) → `#14532d` (deep green), capped at ±5% so single-month outliers
don't wash the rest of the matrix. See `PresidentialCycleChart.tsx` for the
exact stops.

### lightweight-charts v5 quirks

- Use `chart.addSeries(LineSeries, opts)` — not the old `addLineSeries(opts)`.
- Time values are `UTCTimestamp` (seconds, not ms). `Math.floor(tMs / 1000)`.
- Data must be **strictly increasing** on time — dedupe by day key before
  feeding in.
- Log scale via `rightPriceScale: { mode: 1 }`.
