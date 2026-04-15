# Quant Charts — Plan & Catalog

Living reference for the Quant section. Inspired by Benjamin Cowen's
[Into The Cryptoverse](https://app.intothecryptoverse.com/charts) (ITC) which
organizes charts under three categories: **Crypto**, **Macro**, and **TradFi**.

> **See also: [`itc-chart-catalog.md`](./itc-chart-catalog.md)** — the full
> **408-chart** ITC catalog with **verified descriptions** scraped from the
> authenticated app. That's the canonical reference for chart names and
> wording; this doc is the build plan.

---

## ITC catalog (full reference)

Short overview — see the full catalog in
[`itc-chart-catalog.md`](./itc-chart-catalog.md).

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

---

## Per-chart notes

For each priority chart, the **"ITC wording"** block quotes the exact
description from the ITC app sidebar (see
[`itc-chart-catalog.md`](./itc-chart-catalog.md) for the full 408-chart
catalog). The **"Notes"** block adds formula detail, interpretation, and
implementation guidance from public sources.

### Crypto

#### BTC Log Regression Bands

> **ITC wording (Logarithmic Regression Rainbow):** "Logarithmic Regression
> Rainbow lines contain different multiples of the regression parameters."
>
> **ITC wording (Fair Value Logarithmic Regression):** "Bitcoin fair value
> logarithmic regression line is fit to all of Bitcoin's data."

**What it is.** Fit `log10(price) = slope × log10(days_since_genesis) + c` on
BTC's full history and draw bands a fixed number of stdevs above and below
the fit line. The log-log fit captures Bitcoin's **diminishing-returns power
law**: each cycle's peak is a smaller multiple of the prior peak.

**Cowen's two-band variation.** In public, Cowen has emphasized that he uses
**two different logarithmic bands**:

- **Green (lower) band** — fit on _thousands_ of "non-bubble" data points
  (everything _except_ euphoria spikes). He calls this the band he "trusts a
  lot more."
- **Red (upper) band** — fit on only the _three_ all-time-high points from
  prior cycles. Much noisier by construction.

**How to read.** Above the upper band historically = distribution zone.
Near/below the lower band = accumulation. Touches of the lower band have
marked every major BTC cycle low.

**Our version.** We do a single OLS fit on 2014+ daily data with ±1σ and ±2σ
symmetric bands — simpler, and residual-σ is a cleaner scalar to snapshot
day-over-day. Adding Cowen's two-band flavor is a follow-up.

**Data.** yahoo-finance2 (`BTC-USD`, 2014-09+).

#### BTC Risk Metric (composite 0–1)

> **ITC wording (Historical Risk Levels):** "Risk model created by Benjamin
> Cowen. Values closer to 1 indicate higher risk and values closer to 0
> indicate lower risk."
>
> **ITC wording (Short Term Bubble Risk):** "Risk metric based on the
> extension from the 20W moving average."
>
> **ITC wording (Current Risk Levels):** "The current risk levels projected
> onto the price."
>
> **ITC wording (Price Color Coded By Risk):** "Price color coded by the
> risk value."
>
> **ITC wording (Time In Risk Bands):** "The amount of days spent in each
> risk band."

Note the ITC wording confirms there are two separate risk models:

- **Historical Risk Levels** — the canonical "0 to 1" long-run model, credited
  to Cowen directly in the ITC sidebar
- **Short Term Bubble Risk** — a simpler model based purely on the 20W SMA
  extension, which is the formula the community reverse-engineered

**What it is.** Not a single indicator but a **blended percentile rank**
across multiple sub-metrics, smoothed into a 0–1 scalar where 0 = deep value
(accumulation zone) and 1 = euphoria (distribution zone). Cowen calls it
"Price Risk Analysis" on ITC and it's the single most-referenced chart on the
platform.

**Formula (what we know, what we don't).** Cowen has never published the full
recipe. Reverse-engineering attempts by the community (e.g.
`sdrpa/crypto-risk-management`, `BitcoinRaven/Bitcoin-Risk-Metric-V2`) land
on a normalized ratio of short-to-long moving averages as the spine —
typically **50-day SMA / 350-day SMA** or **50-day / 50-week** — normalized
to a 0–1 percentile over BTC's full history. Cowen himself has said he's
added "more inputs" over time (possibly including RSI, Mayer multiple, and
log-regression position), and there's community speculation that ML is now
involved. The fundamental math is simple; the tuning is proprietary.

**Cowen's framing.** He uses it as a **systematic DCA signal** — instead of
buying a fixed dollar amount weekly, scale it inversely to the risk metric
(buy more when risk is low, less when risk is high). Same for profit-taking
on the way up.

**Our version.** We'll build a transparent composite from 5 sub-metrics,
each normalized to its own 5-year percentile and averaged (weights
configurable later):

1. Mayer multiple: `price / sma200d`
2. 20W SMA distance: `(price - sma20w) / sma20w`
3. 2-year log-regression residual σ
4. 14-day RSI
5. Drawdown from ATH

Keeping the inputs visible lets the user see _what_ is driving the current
risk level, not just the final 0–1 number.

**Data.** yahoo-finance2 (`BTC-USD`) — same series we already have cached.

#### Bull Market Support Band (BMSB)

> **ITC wording:** "The bull market support band is the area between the 20W
> simple moving average and 21W exponential moving average."

**What it is.** The zone between the **20-week simple moving average** and
the **21-week exponential moving average**. Two similar-but-different curves
that trace out a thin band on BTC's weekly chart.

**Why it matters.** Cowen has repeatedly shown that BTC tests the BMSB in
**January/February of halving years** — 2012, 2016, 2020, and 2024 all saw
tests. In 2 of the prior cycles (2012, 2016) BTC held and continued up; in
2020 it broke (pandemic crash). Acts as dynamic support in bull markets and
dynamic resistance in bear markets.

**How to read.** Price holding the band = bull intact. Sustained close below
= trend-change risk. The band's _width_ also contains information — tight
bands precede big moves.

**Data.** yahoo-finance2 (`BTC-USD`), weekly.

#### Cowen Corridor

> **ITC wording:** "A corridor which are multiples of the 20WMA made such
> that it acted as support and resistance historically."

**What it is.** Cowen's signature indicator — a set of bands that are fixed
**multiples of the 20-week moving average** on BTC, chosen empirically so
that prior cycle tops and bottoms lined up on one of the bands. Different
from the log-regression bands (which use log-log OLS) and from BMSB (which
is just the 20W/21W pair) — the corridor is a multi-band zone around the
20WMA.

**How to read.** Upper bands act as historical resistance in bull markets,
lower bands act as support in bear markets. When BTC punches through the
upper corridor, euphoria; when it falls below the lower corridor,
capitulation.

**Our version.** Trivial to compute once we have the 20WMA wired up: just
multiply by a few fixed constants (e.g. 0.5×, 1×, 2×, 3×, 5× 20WMA) and
plot each as a separate line on the BTC chart.

**Data.** yahoo-finance2 (`BTC-USD`), weekly.

#### Pi Cycle Top Indicator

> **ITC wording:** "Local price bottom/top indicator using the crossover of
> the 111D SMA and the 2 \* 350D SMA."

**What it is.** The 111-day SMA compared to the 350-day SMA × 2. When the
faster 111DMA crosses _above_ the slower 350DMA × 2, that's the Pi Cycle Top
signal.

**The "Pi" name.** `350 / 111 ≈ 3.153`, very close to π. Discovered by
Philip Swift. No theoretical reason π should matter — it's empirical.

**Historical accuracy.** Successfully called the tops in **2013, 2017, and
2021** — each time within 3 days of the actual peak. Notably _failed_ to
trigger at the Nov 2021 top (or triggered too late), which is part of why
Cowen now blends it with other signals rather than using it standalone.

**How to read.** It's a binary signal: crossover or not. Useful as a
confirmation layer on top of the risk metric.

**Data.** yahoo-finance2 (`BTC-USD`), daily.

#### Bitcoin Dominance & Altcoin Season

> **ITC wording (Dominance):** "Dominance is the asset market cap divided
> by the total market cap."
>
> **ITC wording (Altcoin Season Index):** "If the Altcoin Season Index is
> larger than 75 then it is altcoin season. Lower than 25 it is Bitcoin
> season."
>
> **ITC wording (Stablecoin Supply Ratio):** "The Stablecoin Supply Ratio
> is equal to the Bitcoin market cap divided by the stablecoin market cap."

**What it is.** Bitcoin dominance = BTC market cap / total crypto market
cap, expressed as a percentage. Altcoin Season Index = the fraction of the
top 50 altcoins that have outperformed BTC over the past 90 days.

**Cowen's framework.** He treats BTC dominance as a **risk-on / risk-off
gauge for crypto itself**. Rising dominance = capital consolidating into BTC
(flight to safety, or early bull cycle). Falling dominance = capital
rotating into alts (late-cycle euphoria, or "altcoin season"). He watches
the **60% level as a key pivot**: sustained moves above typically precede
continued BTC strength.

He has a specific variant he calls **"flight to safety dominance"** — BTC
dominance + USDT dominance, treating stablecoins as the alternative
"safe" asset when both BTC and alts are selling off.

**How to interpret.** Low altcoin season index + rising BTC dominance =
early cycle, be in BTC. High altcoin season index + falling BTC dominance =
late cycle, take profits on alts first.

**Data.** CoinGecko `/global` endpoint for dominance (free, no key).
Altcoin Season Index requires top-50 alt historical prices, also CoinGecko.

#### MVRV Z-Score

> **ITC wording (Market Value Realized Value Z-Score):** "Market cap minus
> realized cap divided by standard deviation of the market cap."
>
> **ITC wording (MVRV):** "The ratio between the market value cap and the
> realized value cap."

**What it is.** An on-chain metric that compares BTC's **market cap**
(current price × supply) to its **realized cap** (value of every coin at
the time it last moved), normalized by the standard deviation of market cap:

```
MVRV Z-Score = (market_cap - realized_cap) / stdev(market_cap)
```

**How to read.** Has called every cycle peak within 2 weeks historically.

- **Z > 7** → red zone, distribution, every cycle peak has been at or above
- **Z < 0** → green zone, accumulation, every cycle bottom has been below
- **0 < Z < 7** → normal range

**Why it works.** Realized cap captures aggregate cost basis. When market
cap runs way above cost basis, most holders are sitting on unrealized gains
and eventually sell. When market cap drops below cost basis, most holders
are underwater and the supply-overhang is cleared.

**Data.** Requires realized-cap, which is UTXO-level on-chain data.
Glassnode and Coin Metrics expose it (Glassnode free tier is restricted).
Deprioritized until we wire up an on-chain provider.

#### Puell Multiple

> **ITC wording:** "The ratio of the USD value of daily issuance to the
> 365-day moving average of the USD value of daily issuance."

**What it is.** Daily BTC issuance value (USD) divided by the 365-day
moving average of daily issuance value:

```
Puell = (daily_issuance_btc × price_usd) / 365dma(daily_issuance_btc × price_usd)
```

**Interpretation.**

- **Puell < 0.5** — green zone, miner revenue is unusually low, miners
  reluctant to sell, historically a bottom signal
- **0.5 ≤ Puell ≤ 4.0** — neutral
- **Puell > 4.0** — red zone, miner revenue far above baseline, miners
  distribute, historically a top signal

**Why 365 days?** A full year reflects a reasonable baseline for miners'
long-term investment and hardware-depreciation planning.

**Data.** Needs daily BTC issuance (block reward × blocks × price). Can be
computed from mempool.space or blockchain.info APIs. Deprioritized until
on-chain wiring is done.

### Macro

All of these are single-line or two-line time-series charts sourced from
FRED. The real value is in **overlays** (e.g. 10Y yield vs SPX, or M2
year-over-year change vs BTC), which we'll build as composite cards.

| Series             | FRED ID    | What it tells you                                                 |
| ------------------ | ---------- | ----------------------------------------------------------------- |
| 10Y Treasury Yield | `DGS10`    | Long-end rate expectations                                        |
| 2Y Treasury Yield  | `DGS2`     | Front-end rate expectations, most-sensitive to Fed                |
| Yield Curve Spread | `T10Y2Y`   | Inversion historically precedes every US recession by 6–18 months |
| 3M Spread          | `T10Y3M`   | NY Fed's preferred recession signal                               |
| Fed Funds Rate     | `DFF`      | The Fed's policy instrument                                       |
| M2 Money Supply    | `M2SL`     | Broad liquidity; YoY change correlates strongly with BTC          |
| Fed Balance Sheet  | `WALCL`    | QE/QT; expansion → risk-on, contraction → risk-off                |
| Core CPI YoY       | `CPILFESL` | Inflation ex food/energy, the Fed's actual target                 |
| Headline CPI YoY   | `CPIAUCSL` | What consumers actually feel                                      |
| Unemployment       | `UNRATE`   | Recession lagging indicator, also a Fed target                    |
| DXY Dollar Index   | `DTWEXBGS` | Broad trade-weighted dollar; inverse-correlated with risk assets  |
| Michigan Sentiment | `UMCSENT`  | Consumer mood                                                     |

**Cowen's macro framing.** He uses macro as a **regime filter** over crypto
signals. The thesis is: crypto only trends up when macro is accommodative
(rising M2, falling real yields, weakening DXY). When macro turns hostile
(tightening, rising yields, strong dollar), no amount of crypto-specific
bullishness saves you. The yield curve inversion is his favorite long-lead
recession indicator.

### TradFi

#### Presidential Cycle / Monthly Returns Heatmap

**What it is.** A 4 × 12 matrix where each cell is the average monthly SPX
return for (year-of-cycle, calendar month) historically. The 4-year
presidential cycle runs: Y1 post-election, Y2 midterm, Y3 pre-election,
Y4 election.

**Historical pattern (from our Shiller data, 1871+).** Y3 (pre-election) is
historically the **strongest** year (~+8% avg), Y2 (midterm) is the
**weakest** (~+3.6% avg). The Y2→Y3 pivot typically happens in late Y2 /
early Y3 — which is exactly where we sit now (late 2026 → early 2027).

**Cowen's angle.** He uses this as the macro backdrop for his "midterm
bottom → pre-election rally" thesis. The signal strengthens if Q3 of the
midterm year shows a drawdown followed by a Q4 recovery (the classic
Stock Trader's Almanac pattern).

**Data.** Shiller S&P 500 CSV — already wired, 155 years of monthly data.
**Already built** in `PresidentialCycleChart.tsx`.

#### Sector Rotation

**What it is.** Track the 11 S&P sector SPDR ETFs relative to SPY and rank
them by relative strength (RS ratio) and momentum (20W SMA slope).

**The 11 sectors.**

| Ticker | Sector                 | Typical role                       |
| ------ | ---------------------- | ---------------------------------- |
| XLE    | Energy                 | Late-cycle / inflation beneficiary |
| XLB    | Materials              | Early-cycle / recovery             |
| XLI    | Industrials            | Mid-cycle / capex                  |
| XLY    | Consumer Discretionary | Mid-cycle / risk-on                |
| XLF    | Financials             | Mid-cycle / rising rates           |
| XLK    | Technology             | Cycle-agnostic growth              |
| XLC    | Communication Services | Tech-adjacent                      |
| XLU    | Utilities              | Defensive / bond proxy             |
| XLP    | Consumer Staples       | Defensive                          |
| XLV    | Healthcare             | Defensive                          |
| XLRE   | Real Estate            | Rate-sensitive                     |

**How to read sector rotation.** The classic rotation model places sectors
on a **momentum × relative-strength quadrant**:

- **Leading** (high RS, high momentum) — already outperforming, trend
  following
- **Improving** (low RS, high momentum) — about to take leadership, best
  risk-reward
- **Weakening** (high RS, low momentum) — about to roll over, take profits
- **Lagging** (low RS, low momentum) — broken, avoid until improving

**Cowen's current thesis** (late-cycle / midterm pivot): **Energy (XLE) and
Industrials (XLI)** are the ones to watch as Y2 rolls into Y3 — both
historically lead out of midterm lows in cycles where rates are peaking and
inflation is sticky.

**Data.** yahoo-finance2 daily closes for 11 ETF tickers + SPY. Our next
chart to build.

#### Shiller PE / CAPE

**What it is.** Price of SPX divided by the 10-year trailing average of
inflation-adjusted earnings. Smooths out cyclical earnings volatility to
give a long-run valuation signal.

**How to read.**

- **CAPE < 15** — historically cheap (1982, 2009)
- **CAPE 15–25** — fair range
- **CAPE 25–35** — expensive
- **CAPE > 35** — historically only seen around dot-com 2000 and recent
  highs; forward 10-year returns from these levels have been poor

**Cowen's framing.** He uses it as a **long-run regime signal**, not a
timing tool. High CAPE doesn't mean "sell now"; it means "forward 10-year
returns will be mediocre, size accordingly."

**Data.** Already in our Shiller CSV cache — column `PE10`. Near-zero work
to plot once we generalize the endpoint.

#### S&P 500 Dividend Yield

**What it is.** Trailing 12-month dividends divided by SPX price.

**Historical ranges.** Bottomed around 1.1% in 2000 (peak overvaluation) and
1999 highs; has typically sat between 1.5% and 4.5% over the post-WWII era.

**Cowen's framing.** A secondary valuation signal paired with CAPE. Very low
yield + very high CAPE = classic overvaluation warning.

**Data.** Already in our Shiller CSV cache — column `Dividend`. Need to
compute `Dividend / SP500 × 100` over the time series.

#### Midterm Drawdown Overlay

**What it is.** Every midterm year since 1950 plotted as a drawdown curve
from the prior peak, normalized and overlaid on a single chart, with the
current year (2026) tracked live.

**Cowen's framing.** His version of "are we tracking hot or cold vs
history" — gives a visual sense of whether 2026 is running ahead of or
behind the typical midterm year bottom-and-recover pattern.

**Data.** Shiller CSV (already cached) — just a transform of the existing
data, no new fetch needed.
