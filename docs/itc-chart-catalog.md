# ITC Chart Catalog

Scraped from the authenticated ITC app (Crypto / Macro / TradFi tabs).
Descriptions are the exact wording shown in the ITC app sidebar.

This file is a living reference for the Quant section build plan —
not every chart here will be rebuilt locally; we prioritize per
`docs/quant-charts-plan.md`.

---

## Crypto

### Total Crypto Market Cap & Trendline

- **Total Crypto Valuation vs. Trendline** — Extension from the total cryptocurrency fair value regression line.
- **Dominance** — Dominance is the asset market cap divided by the total market cap.
- **Stablecoin Supply Ratio (SSR)** — The Stablecoin Supply Ratio is equal to the Bitcoin market cap divided by the stablecoin market cap.
- **Altcoin Market Capitalizations** — The Total Market Cap minus Bitcoin's and/or Ethereum's and/or Stablecoins' Market Cap.
- **Portfolios Weighted By Market Cap** — Historical portfolio performance based on different market cap weightings.

### Risk

- **Historical Risk Levels** — Risk model created by Benjamin Cowen. Values closer to 1 indicate higher risk and values closer to 0 indicate lower risk.
- **Price Color Coded By Risk** — Price color coded by the risk value.
- **Time In Risk Bands** — The amount of days spent in each risk band.
- **Current Risk Levels** — The current risk levels projected onto the price.

### Logarithmic Regression

- **Fair Value Logarithmic Regression** — Bitcoin fair value logarithmic regression line is fit to all of Bitcoin's data.
- **Logarithmic Regression Rainbow** — Logarithmic Regression Rainbow lines contain different multiples of the regression parameters.

### Return On Investment

- **Running ROI** — The return on investment after holding for a certain period of time.
- **Monthly Returns** — Return on investment if you would have bought at the beginning of every month and sold at the end of it.
- **Quarterly Returns** — Return on investment if you would have bought at the beginning of every quarter and sold at the end of it.
- **Average Daily Returns** — Average return on investment for any given day of the month.
- **Monthly Average ROI** — The return on investment averaged over each month.
- **Historical Monthly Average ROI** — The return on investment averaged over each month shown for each year.
- **Altcoin Season Index** — If the Altcoin Season Index is larger than 75 then it is altcoin season. Lower than 25 it is Bitcoin season.
- **Year-To-Date ROI** — The Year-To-Date ROI and ROI of previous years.
- **ROI Bands** — The amount of days it takes to x2, x4, ..., x100 your ROI.
- **ROI After Cycle Bottom** — The return on investment as measured from each market cycle bottom.
- **ROI After Bottom (Multiple Coins)** — The return on investment as measured from the bottom price after a specified date for multiple cryptocurrencies.
- **ROI After Bottom (Crypto Pairs)** — The return on investment as measured from the bottom price after a specified date for multiple crypto pairs.
- **ROI After Inception (Multiple Coins)** — The return on investment as measured from the inception price for multiple cryptocurrencies.
- **ROI After Inception (Crypto Pairs)** — The return on investment as measured from the inception price for multiple crypto pairs.
- **ROI After Cycle Peak** — The return on investment as measured from each market cycle peak.
- **ROI After Latest Cycle Peak (Multiple Coins)** — The return on investment as measured from the most recent cycle peak for multiple cryptocurrencies.
- **ROI After Latest Cycle Peak (Crypto Pairs)** — The return on investment as measured from the inception price for multiple crypto pairs.
- **ROI After Halving** — The return on investment after each time the block mining reward is halved.
- **ROI After Sub-Cycle Bottom** — The return on investment for Ethereum measured from each sub-cycle bottom.
- **QT Ending Bear Markets** — Comparing bear markets that occurred when the Federal Reserve was ending Quantitative Tightening (QT).
- **Best Day To DCA** — The best day to DCA assets based on the average extension from a moving average.
- **Days Since Percentage Decline** — The amount of days since a percentage decline occurred.
- **Days Since Percentage Gain** — The amount of days since a certain percentage gain has occurred.

### Moving Averages

- **Moving Averages** — 8, 20, 50, 100, 150, 200, 250 and 300 weekly/daily moving averages. Both simple and exponential.
- **Bull Market Support Band (BMSB)** — The bull market support band is the area between the 20W simple moving average and 21W exponential moving average.
- **Cowen Corridor** — A corridor which are multiples of the 20WMA made such that it acted as support and resistance historically.
- **Short Term Bubble Risk** — Risk metric based on the extension from the 20W moving average.
- **Color-Coded Moving Average Strength** — If the Moving Average of an asset is above a certain Moving Average it is color-coded as green, otherwise red.
- **Pi Cycle Bottom/Top** — Local price bottom/top indicator using the crossover of the 111D SMA and the 2 \* 350D SMA.
- **Coins Above/Below Moving Average** — The number of coins that are above or below a moving average.
- **SMA Cycle-Top Breakout** — Shows lines where a moving average crosses the previous cycle top.

### Momentum

- **Supertrend** — The Supertrend indicator is used to identify the current trend direction.

### Technical Analysis

- **Relative Strength Index (RSI)** — The Relative Strength Index is a momentum indicator used to judge the strength of an asset's price momentum.
- **Moving Average Convergence Divergence (MACD)** — The Moving Average Convergence Divergence (MACD) indicator measures changes in strength, direction and momentum.
- **Golden/Death Crosses** — A golden cross indicates a long-term bull market going forward. A death cross signals a long-term bear market.
- **Bollinger Bands** — Bollinger Bands create signals when an asset is either oversold or overbought.

### Advances & Declines

- **Advance Decline Ratios** — Several metrics using daily advances and declines of the top 10, 25 or 100 cryptocurrencies.
- **Advance Decline Index (ADI)** — The running sum of the difference between advances and declines.
- **Absolute Breadth Index (ABI)** — The absolute value of the difference between advances and declines.

### Other

- **Fear & Greed Index** — Bitcoin Price color coded by the Fear & Greed Index.
- **Does It Bleed** — Check if your altcoin is a bleeder against BTC or ETH.
- **BTC vs. DXY** — Bitcoin shows a highly negative correlation with DXY.
- **Price Drawdown From ATH** — Percentage drawdown from most recent ATH.
- **Correlation Coefficients** — Pearson/Spearman correlation coefficients highlight the degree of correlation between two assets.
- **Volatility** — The 30/60/180 day volatility, equal to the standard deviation of logarithmic returns.
- **Benford's Law** — The probability of an asset having a certain leading digit (1, 2, ..., 9).
- **Price Milestone Crossings** — How many times has BTC price crossed various price milestones?
- **Cycles Deviation** — ROI deviation between cycles

### Supply

- **HODL Waves** — HODL waves show the percentage of active supply held by long term investors and short term investors.
- **RHODL Waves** — RHODL waves are HODL waves weighted by the realized price.
- **RHODL Ratio** — RHODL ratio compares the RHODL waves of short term (1w) holders to long term holders (1-2y).
- **Supply In Profit Or Loss** — The percentage of the total supply that is in profit or loss.
- **Ethereum Supply Dynamics vs Bitcoin** — Supply comparison between Ethereum and Bitcoin.
- **Supply Revived** — The sum of native units held for a certain period of time that became active in this interval.
- **UTxO Supply Distribution** — Distribution of Bitcoin supply across different balance bands (from 0-0.001 BTC to 10K+ BTC).
- **UTxO Age Distribution** — Distribution of Bitcoin supply by holding period age bands (from < 1 day to 10+ years).
- **Ethereum Supply Burnt** — The sum of all ETH removed from circulation each day, in native units and USD.
- **Supply Issued & Inflation** — The value of assets issued that day in Native Units/USD and their daily/yearly inflation rates.
- **Puell Multiple** — The ratio of the USD value of daily issuance to the 365-day moving average of the USD value of daily issuance.
- **Stock to Flow (S2F)** — The Stock to Flow model predicts the future price of Bitcoin based on its scarcity (issuance and supply).

### Addresses

- **Address Activity** — The sum count of unique addresses that were active in the Bitcoin network that day.

### Valuation

- **Spent Output Profit Ratio (SOPR)** — SOPR is a value that oscillates around 1; if below it, people spending are realizing losses, above it, people are realizing gains.
- **Market Value to Realized Value (MVRV)** — The ratio between the market value cap and the realized value cap.
- **Market Value Realized Value Z-Score (MVRV Z-Score)** — Market cap minus realized cap divided by standard deviation of the market cap.
- **Net Unrealized Profit/Loss (NUPL)** — NUPL compares market cap vs realized cap; values above 0 indicate unrealized profit, below 0 unrealized loss.
- **Network Value to Transactions (NVT)** — NVT is network value (market cap) divided by on-chain transfer volume; often viewed with smoothing.
- **Realized Network Value to Transaction Signal (RVTS)** — RVTS is the realized cap divided by a 90-day moving average of transferred volume

### Transactions

- **Transfer Count Statistics** — The sum count of all unique transfers in that interval worth at most or at least a certain amount of USD, or between two certain USD amounts.
- **Transfer Volume** — The amount of native units transferred within a single day.
- **Transaction Fees** — The sum USD value of all fees paid to miners, transaction validators, stakers and/or block producers that day.
- **Velocity** — Velocity is the amount of native units transferred in the trailing 1 year divided by supply on that day.
- **Coin Days Destroyed** — The sum of all native units transferred multiplied by the sum of days since those native units were last transferred.
- **90D Coin Days Destroyed** — Time adjusted 90-day rolling sum of coin days destroyed.
- **Value Days Destroyed Multiple** — Adjusted ratio of the 30 day and 365 day moving average of Value Days Destroyed.
- **Terminal Price** — Terminal price is a top predicting indicator. When price rises above it, a capitulation is likely to happen.
- **Dormancy** — The average number of days destroyed per coin transacted in a given day.
- **Liveliness** — The ratio of the cumulative coin days destroyed and the sum of all coin days ever created
- **Gas Statistics** — Ethereum gas prices, gas used and gas transaction- and block limits.

### Mining

- **Block Statistics** — Information on block count, block interval, block revenue, block size and uncle blocks.
- **Miner Revenue** — Total value of coinbase block rewards and transaction fees paid to miners.
- **Hash Rate** — The mean rate at which miners are solving hashes that day.
- **Hash Ribbons** — The Hash ribbons metric provides a buy signal using the 30-day SMA and the 60-day SMA of the hashrate.
- **Hash Rate Divided By Price** — Hash rate divided by price with an option to divide the price by the hash rate.
- **MarketCap To ThermoCap Ratio (MCTC)** — Market cap divided by the Thermocap.
- **Realized MarketCap To ThermoCap Ratio (RCTC)** — Realized Market cap divided by the Thermocap.
- **MinerCap To ThermoCap Ratio (mCTC)** — Miner Cap divided by the Thermocap.
- **Miner Outflow To Miner Revenue (MOMR)** — Miner Outflow divided by the Miner Revenue.

### Exchanges

- **Supply Held By Exchanges** — The total amount of supply held by several exchanges.
- **Supply Flow To Exchanges** — The total amount of supply that flows in, out or net (in - out) of several exchanges.
- **Transfer Flow To Exchanges** — The total amount of transfers that flow in, out or net (in - out) of several exchanges.
- **Miner Flow To Exchanges** — Supply flow from mining addresses in, out or net (in - out) of several exchanges.

### Open Interest & Volume

- **Open Interest Of Crypto Futures** — Open interest is the total value of outstanding futures contracts for an asset that have not been settled.
- **Open Interest Of Crypto Options** — The total value of outstanding options contracts for an asset that have not been settled.

### YouTube

- **YouTube Subscribers** — Daily/Weekly/Monthly new YouTube subscribers for various big crypto YouTube channels.
- **YouTube Views** — Daily/Weekly/Monthly YouTube views for various big crypto YouTube channels.

### Twitter

- **Twitter Followers (Analysts)** — Daily/Weekly/Monthly new Twitter followers of various big crypto analysts.
- **Twitter Followers (Exchanges)** — Daily/Weekly/Monthly new Twitter followers of various big crypto exchanges.
- **Twitter Followers (Layer 1s)** — Daily/Weekly/Monthly new Twitter followers of various big layer 1 cryptocurrencies.
- **Twitter Tweets** — Daily/Weekly/Monthly new Twitter tweets made by various big crypto Twitter accounts.

### Wikipedia

- **Wikipedia Page Views** — Daily/Weekly/Monthly new Wikipedia page views.

### Google Trends

- **Search Interest** — Monthly Google search interest for major crypto terms (worldwide web search).

### On-Chain

- **ERC-721 Transactions and Transfers** — The amount of daily ERC-721 (NFT) Transactions and Transfers.
- **ERC-1155 Transactions and Transfers** — The amount of daily ERC-1155 (FT/NFT) Transactions and Transfers.

### Social Media

- **Twitter Followers (Marketplaces)** — Daily/Weekly/Monthly new Twitter followers for various big NFT marketplaces.
- **Twitter Followers (NFT Projects)** — Daily/Weekly/Monthly new Twitter followers for various big NFT projects.
- **Wikipedia NFT Page Views** — Daily/Weekly/Monthly new Wikipedia page views for NFT related pages.

_117 charts extracted in Crypto_

---

## Macro

### GDP & GNP

- **Gross Domestic Product (GDP)** — GDP is the market value of goods and services produced by labor and property located in the United States.
- **Gross Domestic Product Per Capita (GDP Per Capita)** — GDP per capita is the total economic output of a country divided by its population.
- **World GDP Per Capita (Current US$)** — World GDP per capita is the global gross domestic product divided by world population.
- **World GDP (Current US$)** — World GDP is the total value of all final goods and services produced globally in current U.S. dollars.
- **Gross National Product (GNP)** — GNP represents the total market value of all final goods and services produced by a country's residents, whether they are located domestically or abroad.
- **Gross Domestic Income (GDI)** — Gross Domestic Income measures the total income generated each quarter.
- **Average of GDP and GDI** — The average value of the Gross Domestic Product (GDP) and Gross Domestic Income (GDI).
- **Gross National Income (GNI)** — The total income earned by a country's residents, regardless of whether they are located within the country's borders or abroad
- **Imports Of Goods And Services** — Imports of goods and services is the total value of imports made by a country.
- **Exports Of Goods And Services** — Exports of goods and services is the total value of exports made by a country.
- **Net Exports Of Goods And Services** — Net exports of goods and services is the value of total exports minus total imports for a country.
- **Goods Trade Balance** — Monthly U.S. goods trade balance reported by the Census Bureau.
- **Balance of Trade** — Monthly U.S. balance of trade reported by the BEA.
- **Full Year GDP Growth (Int)** — Full Year GDP Growth (International)

### Debt

- **Total National Federal Debt** — A country's gross public debt (also called go government debt) is the financial liabilities of the government sector.
- **Federal Surplus Or Deficit** — The federal surplus or deficit is the difference between the government's revenue and its spending.
- **Federal Surplus Or Deficit Total** — The federal surplus or deficit is the difference between the government's revenue and its spending.
- **Government Debt to GDP Ratio (Int)** — Debt to GDP Ratio
- **Household Debt to GDP (Int)** — Household Debt to GDP

### Saving & Investment

- **Personal Saving Rate** — The personal saving rate is the percentage of disposable income that is saved by the average US citizen.
- **Gross Private Domestic Investment (GPDI)** — Gross Private Domestic Investment (GPDI) is the total investments made by the private sector.
- **Corporate Profits After Tax** — Corporate Profits After Tax, either without or with IVA and CCAdj.
- **Net Saving** — Net saving refers to the portion of national income that is set aside for the future
- **Personal Savings (Int)** — Personal Savings (International)

### Personal Income & Outlays

- **Average Hourly Earnings** — Average Hourly Earnings is a measure of the average hourly earnings of all employees within a sector on a gross basis.
- **Average Hours Worked Per Week** — Average amount of hours worked per week in different private job sectors.
- **Indexes of Aggregate Weekly Hours of Production- and Nonsupervisory Employees** — The ratio of the current month's aggregate hours by the average of the 12 monthly figures of the base year.
- **Real Median Usual Weekly Earnings** — The median usual weekly earnings of full-time wage and salary workers adjusted for inflation.
- **Real Personal Income** — Real personal income refers to the income earned by individuals adjusted for inflation.
- **Real Personal Income Excluding Transfer Receipts** — Real personal income refers to the income earned by individuals adjusted for inflation and excluding any income received from government transfer payments.
- **Real Disposable Personal Income** — Real Disposable Personal Income refers to the income earned by individuals minus taxes adjusted for inflation.
- **Real Disposable Personal Income Per Capita** — Real Disposable Personal Income Per Capita refers to the inflation-adjusted income earned by individuals minus taxes divided by the total population.
- **Federal Government Current Tax Receipts** — The total amount of money collected by the central government through various taxation mechanisms.

### Exchange Rates

- **DXY** — The Dollar Curreny Index (DXY) is an index that tracks the relative strength of the dollar.

### Monetary Data

- **Currency In Circulation** — Currency in circulation is paper currency and coins held both by the public and in the vaults of depository institutions.
- **M1 Money Supply** — M1 is a measure of the money supply that includes currency, demand deposits, and other liquid deposits.
- **M2 Money Supply** — M2 is a measure of the money supply that includes M1 plus savings deposits, securities and time deposits.
- **Retail Money Market Funds** — The retail money funds component refers to a specific category within the broader monetary aggregate known as M2.
- **FED Total Assets** — The total assets are a measure of the size and composition of the central bank's balance sheet.
- **Overnight Reverse Repurchase Agreements (ON RRP)** — The amount of treasury securities sold by the Fed with an agreement to repurchase the securities the following day at a higher price.
- **Treasury Deposits With Federal Reserve Banks** — Treasury deposits with Federal Reserve Banks refers to the funds that the United States Department of the Treasury holds in accounts at Federal Reserve Banks.

### Gold Reserves

- **Global Net Liquidity** — Global Net Liquidity attempts to represent worldwide net liquidity
- **M2 Money Supply (Int)** — M2 is a measure of the money supply that is a equal to M1, plus so-called "near money"

### Interest Rates

- **Federal Funds Target Range** — The Federal Funds Target Range (FFTR) is the target interest rates of federal fund transactions during the previous day.
- **Effective Federal Funds Rate** — The Effective Federal Funds Rate (EFFR) is the effective interest rate of federal fund transactions during the previous day.
- **Constant Maturity Treasury** — US Treasury Yield Rates are the rates of government bonds, notes and bills.
- **Treasury Yield Spreads** — Yield spreads are the differences between yield rates. Some have been good predictors of economic recessions.
- **Treasury Yield Curve** — The yield curve is a plot of interest rates of bonds/notes/bills of equal credit and different maturity dates.
- **Days After Inversion** — The amount of days after a specified spread between two treasuries has become negative.
- **Days After Uninversion** — The amount of consecutive days a spread between two treasuries has been positive.
- **Real Interest Rates** — The real interest rate is the nominal interest rate adjusted for inflation.
- **Real Interest Spreads** — Real interest spreads are the differences between real interest rates.
- **Real Interest Curve** — The real interest curve is a plot of real interest rates of different timeframes.

### Interest Rate

- **Government Bond 10Y (Int)** — Government Bond 10Y

### Banking

- **Deposits** — Deposits refers to the funds that people and organizations hold in their accounts with commercial banks.
- **Consumer Loans** — Value of loans that are taken out by individuals for personal use.
- **Consumer Credit Outstanding** — The total consumer credit owned refers to the sum of all outstanding loans held by financial institutions.
- **Delinquency Rates** — The delinquency rate on loans is a measure of the percentage of loans taken out by consumers that are past due in their payments.
- **Loans and Leases in Bank Credit** — The total USD value of loans and leases provided by all commercial banks.
- **Total Assets** — Assets held by all commercial banks, including cash, loans, securities, and other financial instruments.
- **Total Liabilities** — The sum of all obligations and debts owed by commercial banks to their depositors, creditors, and other counterparties.
- **Net Percentage Of Banks Tightening Loan Standards** — The percentage of banks that are tightening their lending standards minus the percentage of banks that are easing their lending standards.
- **Net Percentage Of Banks Reporting Stronger Demand For Loans** — The percentage of domestic banks that are reporting stronger demand for certain types of loans.
- **Consumer Confidence (Int)** — Consumer Confidence (International)
- **Gasoline Prices (Int)** — Gasoline Prices (International)
- **Central Bank Balance Sheets (Int)** — A Central Bank Balance Sheet is a financial statement showing a central bank's assets and liabilities
- **Bank Lending Rate (Int)** — Bank Lending Rate (International)

### Recessions

- **Past Recession Statistics** — Start date, end date, declaration date, S&P drawdown and its averages of all past recessions.
- **ITC Business Cycles** — Business cycle composite from S&P 500, unemployment, interest rates, and optionally M2 normalization.
- **Smoothed Recession Probabilities** — Smoothed recession probabilities are obtained from a model applied to four monthly coincident variables.
- **Sahm Rule Recession Indicator** — Sahm Rule Recession Indicator is a recession probability indicator based on the unemployment rate.
- **Sahm Rule Recession Indicator (Per State)** — Sahm Rule Recession Indicator is a recession probability indicator based on the unemployment rate per state.
- **Number of States Where Sahm Rule Triggered** — The Number of States where the Sahm Rule has triggered.
- **Map of States Where Sahm Rule Triggered** — The Number of States where the Sahm Rule has triggered.
- **RGDP Recession Indicator** — The RGDP Recession Indicator is a recession probability indicator based on the Real Gross Domestic Product (RGDP).
- **Composite Leading Indicator (CLI)** — The CLI is a combination of various economic indicators used to predict short-term economic trends.
- **National Financial Conditions Index (NFCI)** — The Chicago Fed National Financial Conditions Index (NFCI) is a measure of overall financial conditions in the US economy.
- **St. Louis Fed Financial Stress Index** — The stress index measures the degree of financial stress in the markets and is constructed from 18 weekly data series.
- **Coincident Economic Activity Index (CEAI)** — A combination of four different indicators to provide a comprehensive picture of the overall health of the economy.
- **Economic Policy Uncertainty Index** — A measure of policy-related economic uncertainty based on newspaper coverage frequency and forecaster opinions.
- **Categorical Economic Policy Uncertainty Indices** — Categorical Economic Policy Uncertainty indices spanning multiple policy domains.
- **World Uncertainty Index** — Global and regional World Uncertainty Index measures based on EIU country reports.
- **Equity Market Volatility Tracker** — A newspaper-based equity market volatility tracker with policy and macro category breakdowns.

### Price Indices (CPI & PCE)

- **Consumer Price Index (CPI)** — The Consumer Price Index (CPI) measures the monthly change in prices paid by consumers.
- **Consumer Price Index (CPI) Contributions Per Category (Approximation)** — The Consumer Price Index (CPI) contributions per category that that contribute to the headline inflation.
- **Core Consumer Price Index** — The Core Consumer Price Index (Core CPI) measures the monthly change in prices paid by consumers excluding food and energy.
- **Personal Consumption Expenditures (PCE)** — The Estimated total of personal consumption expenditures (PCEs) is an indicator of the health of the economy overall.
- **Core Personal Consumption Expenditures (Core PCE)** — The Estimated total of core personal consumption expenditures is an indicator of the health of the economy overall.
- **PCE Price Index (PCEPI)** — The PCE Price Index is a Chain-Type index based on regular PCE.
- **Core PCE Price Index (Core PCEPI)** — The core PCE Price Index is a Chain-Type index based on regular PCE.
- **Consumer Price Index (CPI) (Int)** — Consumer Price Index (CPI) (International)

### Producer Price Indices (PPI)

- **Producer Price Index (PPI)** — The Producer Price Index is a measure of the average change in the prices received by domestic producers for the sale of their goods and services.
- **Producer Price Index: All Commodities (PPIAC)** — PPI is a measure of the change in the prices received by domestic producers for the sale of their goods and services.
- **Producer Prices Change (Int)** — Producer Prices Change (International)

### Inflation

- **Inflation YoY** — The year-over-year inflation rate is a measure of the rate of rising prices of goods and services in an economy.
- **Inflation YoY Per Category** — The inflation rates of different categories that contribute to the headline inflation.
- **Inflation YoY Contributions Per Category (Approximation)** — The weighted inflation rates of different categories that contribute to the headline inflation.
- **Core Inflation YoY** — The core year-over-year inflation rate is a measure of the rate of rising core prices of goods and services in an economy.
- **PCE Price Index Inflation YoY (PCEPI YoY)** — The PCE Price Index Inflation YoY measures the yearly percentage change in PCEPI.
- **Core PCE Price Index Inflation YoY (Core PCEPI YoY)** — The Core PCE Price Index Inflation YoY measures the yearly percentage change in Core PCEPI.
- **PPI All Commodities Inflation YoY (PPIAC YoY)** — The PPIAC Inflation YoY measures the yearly percentage change of the Producer Price Index: All Commodities (PPIAC).
- **CPI Housing Utilities (Int)** — CPI Housing Utilities (International)
- **Inflation Rate (Int)** — Inflation Rate (International)
- **Core Inflation Rate (Int)** — Core Inflation Rate (International)
- **Food Inflation Rate (Int)** — Food Inflation Rate (International)
- **Import Prices (Int)** — Import Prices (International)
- **Export Prices (Int)** — Export Prices (International)
- **Core Consumer Prices (Int)** — Core Consumer Prices (International)
- **Inflation Expectations (Int)** — Inflation Expectations (International)
- **Producer Price Inflation MoM (Int)** — Producer Price Inflation MoM (International)

### Commodities

- **Crude Oil (WTI)** — The average price of West Texas Intermediate (WTI) crude oil.
- **Eggs** — The average price of Eggs, Grade A, Large (Cost per Dozen).
- **Dairy Products** — The average price of dairy products in the United States.
- **Meat Products** — The average price of chicken, pork and beef products in the United States.
- **EIA Natural Gas Stocks Change** — Weekly EIA change in U.S. working natural gas held in storage.
- **EIA Gasoline Stocks Change** — Weekly U.S. EIA change in gasoline stocks.
- **Baker Hughes Oil Rig Count** — Weekly US Baker Hughes crude oil rig count from TradingEconomics.
- **EIA Distillate Fuel Production Change** — Weekly U.S. EIA change in distillate fuel production.
- **Baker Hughes Total Rigs Count** — Weekly US Baker Hughes total rig count from TradingEconomics.
- **EIA Crude Oil Imports Change** — Weekly U.S. EIA change in crude oil imports.
- **EIA Distillate Stocks Change** — Weekly U.S. EIA change in distillate stocks.
- **EIA Cushing Crude Oil Stocks Change** — Weekly U.S. EIA change in Cushing crude oil stocks.
- **API Crude Oil Stock Change** — Weekly API crude oil stock change for the United States from TradingEconomics.
- **EIA Crude Oil Stocks Change** — Weekly U.S. EIA change in crude oil stocks.
- **EIA Gasoline Production Change** — Weekly EIA gasoline production change data for the United States.
- **EIA Heating Oil Stocks Change** — Weekly EIA heating oil stocks change data for the United States.
- **EIA Refinery Crude Runs Change** — Weekly EIA refinery crude runs change data for the United States.

### GDP & GNP

- **GDP Deflator (Int)** — GDP Deflator (International)

### Unemployment Statistics

- **Unemployment Level** — The Unemployment Level is the aggregate measure of people currently unemployed in the US.
- **Unemployment Level By Reason For Unemployment** — The unemployment level for different reasons why people are unemployed.
- **Unemployment Rate** — The Unemployment Rate is the number of unemployed as a percentage of the US labor force.
- **Unemployment Rate (Per State)** — The Unemployment Rate is the number of unemployed as a percentage of the US labor force in a state.
- **Number of States Where Unemployment Rate Rises** — The number of states where the unemployment rate rises compared to the previous 1, 3 or 6 months.
- **Map of States Where Unemployment Rate Rises** — The Unemployment Rate is the number of unemployed as a percentage of the US labor force in a state.
- **Alternative Unemployment Rate Measures** — Alternative measures of the unemployment rate.
- **People Not In Labor Force** — People who are currently not working and are not actively seeking employment.
- **Unemployment Duration** — The average duration of unemployment for those who are unemployed.
- **Challenger Job Cuts** — The Challenger Job Cuts report tracks the number of planned layoffs announced by employers, as compiled by Challenger, Gray & Christmas, Inc.
- **Jobless Claims 4-week Average** — Weekly U.S. four-week average of jobless claims.
- **Long Term Unemployment Rate (Int)** — Long Term Unemployment Rate (International)
- **Youth Unemployment Rate (Int)** — Youth Unemployment Rate (International)

### Employment Statistics

- **Labor Force Participation Rate** — The participation rate is the percentage of the population that is either working or actively looking for work.
- **Civilian Labor Force Level** — The Civilian Labor Force is the number of people who are employed or unemployed but actively seeking employment.
- **Employment Level** — The number of people that work in a given sector.
- **Nonfarm Private Payroll Employment Level** — The number of people that work in private businesses who receive wages and salaries that are processed through the payroll system.
- **Total Temporary Help Services Employees** — The participation rate is the percentage of the population that is either working or actively looking for work.
- **Multiple Jobholders** — The number of people working simultaneously in more than one paid job.
- **Job Postings on Indeed** — The number of job vacancies advertised on the Indeed platform.
- **Employment-Population Ratio** — The proportion of the working-age population that is employed.
- **Non Farm Payrolls** — Monthly US nonfarm payroll change from TradingEconomics.
- **Government Payrolls** — Monthly US government payroll change from TradingEconomics.
- **Manufacturing Payrolls** — Monthly US manufacturing payroll change from TradingEconomics.
- **Nonfarm Payrolls Private** — Monthly US private nonfarm payroll change from TradingEconomics.

### Job Openings & Turnovers

- **Job Openings** — The amount of unfilled job vacancies in the United States.
- **Job Quits Level** — The amount of job quits in the United States.
- **Job Quits Rate** — The percentage of employees leaving their job voluntarily in a given sector.
- **Layoffs and Discharges** — The number of layoffs and discharges in the United States.
- **Initial Claims** — An initial claim is a claim filed by an unemployed individual after a separation from an employer.
- **Initial Claims (Per State)** — An initial claim is a claim filed by an unemployed individual after a separation from an employer.
- **Number of States where Initial Claims Over Population is >= N%** — The Number of States where Initial Claims Over Population is >= N%.
- **Initial Claims Map** — The map of initial claims per state.
- **Number of States %YoY Initial Claims Rises** — The number of states where the initial claims percentage year-over-year growth is >N%.
- **Map of States %YoY Initial Claims Rises** — Map of states where the initial claims percentage year-over-year growth is >N%.
- **Continued Claims** — A continued claim is a claim filed by an unemployed individual for ongoing unemployment benefits.
- **Continued Claims (Per State)** — A continued claim is a claim filed by an unemployed individual for ongoing unemployment benefits.
- **Continued Claims Map** — The map of continued claims per state.
- **Number of States %YoY Continued Claims Rises** — The number of states where the continued claims percentage year-over-year growth is >N%.
- **Map of States %YoY Continued Claims Rises** — Map of states where the continued claims percentage year-over-year growth is >N%.
- **Hires** — The total number of new hires in various sectors.

### Population

- **Population** — Population includes resident population plus armed forces overseas.

### Sentiment

- **Michigan Consumer Sentiment Index (MCSI)** — Consumer sentiment refers to the overall attitude of consumers about the economy and their own financial well-being.
- **Manufacturing Confidence Index** — A composite metric that combines various survey responses to provide an overview of business sentiment.

### Labor Indices

- **KC Fed Labor Market Conditions Index, Level Indicator** — An index created by 24 labor market indicators to summarize the overall state of the labor market.
- **KC Fed Labor Market Conditions Index, Momentum Indicator** — An index created by 24 labor market indicators to summarize the overall momentum of the labor market.
- **Employment Rate (Int)** — Employment Rate
- **Productivity (Int)** — Productivity (International)
- **Labour Costs (Int)** — Labour Costs (International)

### Income Distribution

- **Distribution of Total Net Worth** — The percentage of total net worth held by different wealth percentile groups.
- **Distribution Of Total Assets** — The percentage of total assets held by different wealth percentile groups.
- **Distribution of Total Nonfinancial Assets** — The percentage of total nonfinancial assets held by different wealth percentile groups.
- **Distribution of Real Estate** — The percentage of real estate held by different wealth percentile groups.

### Personal Income & Outlays

- **Wage Growth (Int)** — Wage Growth (International)

### Production Indices

- **Industrial Production Indices** — Industrial Production Indices measure the relative overall level of industrial production for different sectors.
- **Capacity Utilization** — Capacity utilization is a measure of how much productive capacity is being used to produce goods and services.
- **Manufacturing Production Index (Int)** — Manufacturing Production Index

### Business Activity

- **Total Business Inventories** — Total business inventories refer to the amount of goods and materials that companies hold in stock in anticipation of future sales.
- **Manufacturers' New Orders** — The dollar amount of new purchase orders placed with manufacturers for various categories.
- **Inventories to Sales Ratio** — The inventories to sales ratio shows the relationship of the end-of-month values of inventory to the monthly sales.
- **ISM Manufacturing PMI** — Monthly ISM Manufacturing PMI for the United States.
- **Business Inventories MoM** — Monthly business inventories growth rate for the United States.
- **Prospective Plantings - Cotton** — Annual US prospective plantings for cotton from TradingEconomics.
- **ISM Manufacturing Employment** — Monthly ISM Manufacturing Employment index for the United States.
- **ISM Manufacturing New Orders** — Monthly ISM Manufacturing New Orders index for the United States.
- **Prospective Plantings - Soy** — Annual US prospective plantings for soy from TradingEconomics.
- **ISM Manufacturing Prices** — Monthly ISM Manufacturing Prices index for the United States.
- **Retail Inventories Ex Autos MoM** — Monthly retail inventories excluding autos growth rate for the United States.
- **Prospective Plantings - Wheat** — Annual US prospective plantings for wheat from TradingEconomics.
- **Dallas Fed Services Revenues Index** — Monthly Dallas Fed Services Revenues Index for the United States from TradingEconomics.
- **Dallas Fed Services Index** — Monthly Dallas Fed Services Index for the United States from TradingEconomics.
- **Dallas Fed Manufacturing Index** — Monthly Dallas Fed Manufacturing Index for the United States from TradingEconomics.
- **Chicago PMI** — Monthly Chicago PMI for the United States from TradingEconomics.
- **Prospective Plantings - Corn** — Annual US prospective plantings for corn from TradingEconomics.

### Sales

- **Total Vehicle Sales** — The total number of vehicles sold each month.
- **Real Manufacturing and Trade Industries Sales** — Real manufacturing and trade sales represent the total value of goods and services produced and sold by manufacturers and businesses.
- **Advance Sales For Retail and Food Services** — Advanced sales for retail and food services refers to the forecasting of sales for all businesses within a given industry industry.
- **Retail Sales MoM (Int)** — Retail Sales MoM (International)
- **Redbook YoY** — Weekly Redbook same-store sales growth for the United States from TradingEconomics.
- **Retail Sales Control Group MoM** — Monthly US retail sales control group growth from TradingEconomics.
- **Retail Sales Ex Gas/Autos MoM** — Monthly US retail sales excluding gas and autos growth from TradingEconomics.

### House Price Indices

- **Purchase-Only Housing Price Index** — The FHFA Purchase-Only House Price Index is a broad measure of the price movement of single-family houses
- **Zillow Home Value Index (ZHVI)** — The Zillow Home Value Index or ZHVI reflects the typical value for homes in the 35th to 65th percentile range.
- **Residential Property Prices (Int)** — Residential Property Prices (International)
- **House Price Index YoY** — Monthly US house price growth from TradingEconomics.
- **S&P/Case-Shiller Home Price MoM** — Monthly S&P/Case-Shiller 20-city home price change for the United States from TradingEconomics.
- **S&P/Case-Shiller Home Price YoY** — Monthly S&P/Case-Shiller 20-city home price growth for the United States from TradingEconomics.
- **Housing Index (Int)** — Housing Index (International)

### Housing Inventory

- **House Prices Increased/Reduced Count** — The number of houses that have had their price increased or reduced.
- **House Listing Prices** — The average and median listing price of houses, also per square feet.
- **Construction Output (Int)** — Construction Output (International)

### Loans

- **Mortgage Rates Average** — 15 and 30-Year Fixed Rate Mortgage Average in the United States.
- **Delinquency Rate On Real Estate Secured Loans** — The Delinquency Rate on Loans Secured by Real Estate is the percentage of loans, backed by real estate, that are past due on their payments.
- **Net Percentage Of Domestic Banks Reporting Stronger Demand For Real Estate Loans** — The percentage of domestic banks that are reporting stronger demand for certain types of real estate loans.
- **MBA Mortgage Applications (Weekly % Change)** — Weekly percent change in mortgage applications from the Mortgage Bankers Association survey in the United States.
- **MBA Mortgage Refinance Index** — Weekly Mortgage Bankers Association refinance index for the United States.
- **MBA Purchase Index** — Weekly Mortgage Bankers Association purchase index for the United States.
- **MBA Mortgage Market Index** — Weekly Mortgage Bankers Association mortgage market index for the United States.

### Residential Sales

- **Sales Price of Houses Sold** — Median Sales Price of Houses Sold in the United States.
- **Sales Price of New Houses Sold** — Median Sales Price of New Houses Sold in the United States.
- **New Single Family Homes Sold** — New Single Family Homes Sold in The United States.
- **New Houses For Sale/Sold Ratio** — Ratio of new houses for sale to new houses sold.
- **Months To Sell A New Home** — The median number of months to sell a newly completed home.
- **Home Ownership Rate (Int)** — Home Ownership Rate (International)

### Housing Starts

- **Housing Units Started** — A housing start denotes groundbreaking, or excavation, for a home's foundation or footing.
- **Housing Units Under Construction** — The amount of housing units that are under construction.

### Other

- **Homeownership Rate** — The homeownership rate is the proportion of households that is owner-occupied.
- **Owners' Equity Level in Real Estate** — The total value of real estate assets owned by households, minus any outstanding debt on those assets.
- **Rental Vacancy Rate** — The rental vacancy rate is the percentage of the rental inventory that is vacant for rent.
- **Furniture & Home Furnishing Sales** — The retail sales value of furniture and home furnishings stores.
- **Balance Sheet Of Households** — Assets, liabilities, and Net Worth of households
- **Price to Rent Ratio (Int)** — Price to Rent Ratio (International)

_240 charts extracted in Macro_

---

## TradFi

### Balance Sheet

- **Company Assets** — The value of a company's total assets, total current assets and total noncurrent assets.
- **Company Debt** — The value of a company's total debt, net debt, short-term debt and long-term debt.
- **Company Liabilities** — The value of a company's total liabilities, current liabilities and noncurrent liabilities.

### Basics

- **Outstanding Shares** — The total number of shares that a company has issued.
- **Historical Market Capitalization** — The historical market capitalization is the amount of outstanding shares multiplied by the historical price.
- **Earnings-per-Share (EPS)** — The historical and forward looking earnings-per-share (EPS) for stocks.
- **Earnings Yield** — The historical and forward looking earnings yield.
- **Historical Dividends** — The historical dividend payouts.

### Ratios

- **Price-to-Earnings (PE) Ratio** — The historical and forward looking price-to-earnings (PE) ratio for stocks.
- **Price-to-Book (PB) Ratio** — The price-to-book (PB) ratio for stocks.
- **Price-to-Sales (PS) Ratio** — The price-to-sales (PS) ratio for stocks.
- **Current Ratio** — The current ratio is defined as the total assets divided by the total liabilities for a company.
- **Quick Ratio** — The quick ratio is calculated by dividing a company's total current assets minus inventory by its total current liabilities.
- **Debt-to-Assets Ratio** — The Debt-to-Assets ratio represents the proportion of a company's total debt to its total assets, expressed as a percentage.
- **Return On Equity (ROE)** — Return on Equity (ROE) is calculated by dividing net income over the last year over the shareholder's equity.
- **Return On Assets (ROA)** — Return on assets (ROA) measures a company's profitability by evaluating how efficiently it is using its assets to generate earnings.

### Risk

- **Historical Risk Levels** — The risk of the S&P 500 index and other assets.
- **Price Color-Coded By Risk** — Price color-coded by the risk value.
- **Time Spent In Risk Bands** — The time spent in each risk band.

### Return On Investment

- **Running ROI** — The return on investment after holding for a certain period of time.
- **Monthly Returns** — Return on investment if you would have bought at the beginning of every month and sold at the end of it.
- **Quarterly Returns** — Return on investment if you would have bought at the beginning of every quarter and sold at the end of it.
- **Average Daily Returns** — Average return on investment for any given day of the month.
- **Monthly Average ROI** — The return on investment averaged over each month.
- **Historical Monthly Average ROI** — The return on investment averaged over each month shown for each year.
- **Year-To-Date ROI** — The Year-To-Date ROI and ROI of previous years.
- **ROI Bands** — The amount of days it takes to x2, x4, ..., x100 your ROI.
- **Best Day To DCA** — The best day to DCA assets based on the average extension from a moving average.
- **Days Since Percentage Decline** — The amount of days since a percentage decline occurred.
- **Days Since Percentage Gain** — The amount of days since a certain percentage gain has occurred.

### Moving Averages

- **Moving Averages** — 8, 20, 50, 100, 150, 200, 250 and 300 weekly/daily moving averages. Both simple and exponential.
- **Bull Market Support Band (BMSB)** — The bull market support band is the area between the 20W simple moving average and 21W exponential moving average.
- **Cowen Corridor** — A corridor which are multiples of the 20WMA made such that it acted as support and resistance historically.
- **Short Term Bubble Risk** — Risk metric based on the extension from the 20W moving average.
- **Color-Coded Moving Average Strength** — If the Moving Average of an asset is above a certain Moving Average it is color-coded as green, otherwise red.
- **Pi Cycle Bottom/Top** — Local price bottom/top indicator using the crossover of the 111D SMA and the 2 \* 350D SMA.

### Technical Analysis

- **Relative Strength Index (RSI)** — The Relative Strength Index is a momentum indicator used to judge the strength of an asset's price momentum.
- **Moving Average Convergence Divergence (MACD)** — The Moving Average Convergence Divergence (MACD) indicator measures changes in strength, direction and momentum.
- **Golden/Death Crosses** — A golden cross indicates a long-term bull market going forward. A death cross signals a long-term bear market.
- **Bollinger Bands** — Bollinger Bands create signals when an asset is either oversold or overbought.

### Other

- **Does It Bleed** — Check if your altcoin is a bleeder against BTC or ETH.
- **Price Drawdown From ATH** — Percentage drawdown from most recent ATH.
- **Correlation Coefficients** — Pearson/Spearman correlation coefficients highlight the degree of correlation between two assets.
- **Volatility** — The 30/60/180 day volatility, equal to the standard deviation of logarithmic returns.
- **Benford's Law** — The probability of an asset having a certain leading digit (1, 2, ..., 9).

### Return On Investment

- **ROI During S&P 500 Bear Markets** — The Return Of Investment (ROI) during S&P 500 bear markets.
- **ROI During S&P 500 Bull Markets** — The Return Of Investment (ROI) during S&P 500 bull markets.
- **ROI After Yield Curve Inversion** — The Return Of Investment (ROI) of the S&P 500 after the yield curve has made an inversion to the next inversion.
- **ROI To Low After Yield Curve Inversion** — The Return Of Investment (ROI) of the S&P 500 and other assets to their low after the yield curve has made an inversion.

### Risk

- **S&P 500 Risk** — The S&P 500 Risk Metric.
- **S&P 500 Time in Risk Bands** — The S&P 500 time spent in each risk band.

_51 charts extracted in TradFi_
