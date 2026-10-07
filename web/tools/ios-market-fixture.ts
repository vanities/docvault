// Fabricated markets and public-disclosure-shaped records for native UI tests.
// No live prices, members, source documents or household data.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function seedNativeMarkets(dataDir: string, pdfBytes: Uint8Array) {
  await writeFile(
    path.join(dataDir, '.docvault-research.json'),
    JSON.stringify({
      version: 1,
      entries: {
        syntheticnote: {
          id: 'syntheticnote',
          domain: 'finance',
          filename: null,
          filePath: 'syntheticnote.txt',
          mediaType: 'text/plain',
          uploadedAt: '2026-10-01T12:00:00Z',
          text: 'Synthetic research mentioning DEMO.',
          pageCount: null,
          extractedAt: null,
          extractorVersion: null,
          extractError: null,
          title: 'Synthetic market note',
          tickers: ['DEMO'],
          reportDate: '2026-10-01',
        },
        syntheticpoliticsnote: {
          id: 'syntheticpoliticsnote',
          domain: 'politics',
          filename: null,
          filePath: 'syntheticpoliticsnote.txt',
          mediaType: 'text/plain',
          uploadedAt: '2026-10-01T12:00:00Z',
          text: 'Synthetic political source: fictional commentary on DEMO and rates policy.',
          title: 'Synthetic political commentary',
          reportDate: '2026-10-01',
          tickers: ['DEMO'],
          intelligence: {
            claims: [
              {
                id: 'asset-claim',
                text: 'Synthetic commentary links DEMO to semiconductor policy.',
                tickers: ['DEMO'],
                topics: ['semiconductors'],
                stance: 'watch',
                provenance: { sourceUrl: 'https://example.com/synthetic-politics' },
              },
              {
                id: 'rates-claim',
                text: 'Fictional rates commentary is linked only to a policy bill.',
                tickers: [],
                topics: ['rates'],
                stance: 'neutral',
                provenance: { sourceUrl: 'https://example.com/synthetic-politics' },
              },
            ],
          },
        },
      },
    })
  );
  await mkdir(path.join(dataDir, 'research'), { recursive: true });
  await writeFile(
    path.join(dataDir, 'research', 'syntheticpoliticsnote.txt'),
    'Synthetic political source: fictional commentary on DEMO and rates policy.'
  );
  await writeFile(
    path.join(dataDir, '.docvault-ticker-cache.json'),
    JSON.stringify({
      version: 1,
      quotes: {
        DEMO: {
          symbol: 'DEMO',
          price: 123.45,
          currency: 'USD',
          performance: null,
          oneYearChangePct: 10,
          fiftyTwoWeekHigh: 130,
          fiftyTwoWeekLow: 100,
          sparklineCloses: [100, 110, 105, 123.45],
          name: 'Synthetic Security',
          fetchedAt: new Date().toISOString(),
          error: null,
        },
      },
    })
  );
  const member = 'Demo Member A & B';
  const archive = path.join(dataDir, '.docvault-filings', 'house-ptr');
  await mkdir(archive, { recursive: true });
  await writeFile(path.join(archive, 'DEMO-001.pdf'), pdfBytes);
  await writeFile(
    path.join(archive, 'DEMO-001.txt'),
    'Synthetic disclosure text for Demo Member A & B.'
  );
  await writeFile(
    path.join(archive, 'DEMO-001.json'),
    JSON.stringify({
      docId: 'DEMO-001',
      source: 'house-ptr',
      chamber: 'house',
      filerName: member,
      filingYear: 2026,
      filingDate: '2026-09-30',
      filingUrl: 'https://example.com/disclosure',
      parseMethod: 'text',
      tradeCount: 5,
      textLength: 46,
      hasPdf: true,
      fetchedAt: new Date().toISOString(),
    })
  );

  function trade(name: string, ticker: string, date: string, category = 'buy', option = false) {
    return {
      externalId: `${name}-${ticker}-${date}`,
      source: 'house-ptr',
      chamber: 'house',
      politicianName: name,
      filerName: name,
      owner: null,
      assetName: 'Synthetic Security',
      ticker,
      assetType: null,
      transactionType: category,
      transactionDescription: category,
      category,
      tradeDate: date,
      filingDate: '2026-09-30',
      amount: '$1,001 - $5,000',
      amountRange: '$1,001 - $5,000',
      amountMin: 1001,
      amountMax: 5000,
      filingDocId: 'DEMO-001',
      filingYear: 2026,
      filingUrl: null,
      sourceUrl: 'https://example.com/disclosure',
      ...(option
        ? { option: { optionType: 'call', contracts: 2, strike: 100, expiry: '2027-01-15' } }
        : {}),
    };
  }
  await writeFile(
    path.join(dataDir, '.docvault-politics.json'),
    JSON.stringify({
      generatedAt: '2026-10-06T12:00:00Z',
      bills: [
        {
          externalId: 'synthetic-chip-bill',
          officialId: 'DEMO 1',
          title: 'Synthetic semiconductor policy bill',
          latestActionDate: '2026-10-01',
          status: 'introduced',
        },
        {
          externalId: 'synthetic-rates-bill',
          officialId: 'DEMO 2',
          title: 'Synthetic rates policy bill',
          summary: 'Synthetic official summary about fictional rates policy.',
          summarySource: 'congress-crs',
          introducedDate: '2026-09-29',
          latestAction: 'Synthetic introduction to committee',
          url: 'https://example.com/synthetic-bill',
          latestActionDate: '2026-10-02',
          status: 'introduced',
        },
      ],
      executiveActions: [],
      filings: [],
      cursors: {},
      seen: { houseDocIds: [], ogeDocIds: [], senateFilingIds: [] },
      trades: [
        trade(member, 'DEMO', '2026-07-01'),
        trade(member, 'DEMO', '2026-09-02', 'buy', true),
        trade('Demo Member C', 'DEMO', '2026-09-05'),
        trade(member, 'SYNTH', '2026-09-10', 'sell'),
        trade('Demo Member C', 'SYNTH', '2026-09-12', 'sell'),
      ],
    })
  );
  await writeFile(
    path.join(dataDir, '.docvault-legislators.json'),
    JSON.stringify({
      fetchedAt: new Date().toISOString(),
      entries: [
        { bioguide: 'DEMOA', first: 'Demo', last: 'B', official: member },
        { bioguide: 'DEMOC', first: 'Demo', last: 'C', official: 'Demo Member C' },
      ],
    })
  );
  // This image contains only drawn geometric shapes, never a real person.
  await mkdir(path.join(dataDir, '.docvault-headshots'), { recursive: true });
  await writeFile(
    path.join(dataDir, '.docvault-headshots', 'DEMOA.jpg'),
    await readFile(new URL('./fixtures/ios-portrait.jpg', import.meta.url))
  );
  await writeFile(
    path.join(dataDir, '.docvault-politics-backtest.json'),
    JSON.stringify({
      generatedAt: '2026-10-06T12:00:00Z',
      totalTickers: 2,
      pricedTickers: 2,
      leaderboard: [
        {
          politician: member,
          buyCount: 1,
          optionBuyCount: 1,
          totalCostBasis: 1000,
          totalCurrentValue: 1250,
          totalGainAbs: 250,
          returnPct: 0.25,
          winRate: 1,
          estimatedShareFraction: 1,
          optionUnderlyingAvgPct: 0.05,
        },
      ],
      trades: {
        [member]: [
          {
            ticker: 'DEMO',
            category: 'buy',
            tradeDate: '2026-07-01',
            entryPrice: 100,
            currentPrice: 125,
            gainPct: 0.25,
            gainAbs: 250,
            underlyingPct: 0.25,
            isOption: false,
            approximate: true,
            note: 'Estimated from a synthetic disclosed range.',
          },
          {
            ticker: 'DEMO',
            category: 'buy',
            tradeDate: '2026-09-02',
            entryPrice: 100,
            currentPrice: 105,
            gainPct: 9.99,
            underlyingPct: 0.05,
            isOption: true,
            approximate: true,
            note: 'Synthetic option: underlying proxy only.',
          },
        ],
      },
    })
  );
  const prices = Array.from({ length: 24 }, (_, index) => ({
    t: Date.UTC(2024, index, 1),
    price: 1000 + index * 100,
  }));
  const sequence = prices.map(({ price }) => price);
  const ma = sequence.map((price, index) => (index < 2 ? null : price * 0.9));
  const metric = prices.map((_, index) => (index === 3 ? null : 0.2 + index / 50));
  const components = Object.fromEntries(
    ['mayerMultiple', 'sma20wDistance', 'regressionSigma', 'rsi14', 'drawdownFromAth'].map(
      (key) => [key, metric]
    )
  );
  const btcLogRegression = {
    prices,
    fit: {
      line: sequence.map((p) => p * 0.95),
      upper1: sequence.map((p) => p * 1.2),
      lower1: sequence.map((p) => p * 0.8),
      upper2: sequence.map((p) => p * 1.4),
      lower2: sequence.map((p) => p * 0.6),
    },
    slope: 1,
    intercept: 1,
    stdev: 0.1,
    latest: { price: 3300, fitted: 3135, residualSigma: 0.5 },
    movingAverages: {
      sma50d: ma,
      sma200d: ma,
      sma200w: ma,
      mayerBandMultipliers: [0.8, 1, 2.4],
      latest: { sma50d: 2970, sma200d: 2970, sma200w: 2970, priceVs200w: 3300 / 2970 },
    },
    corridor: {
      sma20w: ma,
      multipliers: [0.5, 1, 2],
      latest: { sma20w: 2970, currentMultiple: 3300 / 2970 },
    },
    bmsb: {
      sma20w: ma,
      ema21w: ma.map((p) => (p == null ? null : p * 0.95)),
      latest: { state: 'above', sma20w: 2970, ema21w: 2821.5 },
    },
    piCycle: {
      sma111d: ma,
      sma350dDouble: ma.map((p) => (p == null ? null : p * 2)),
      signal: prices.map((_, i) => i === 10),
      latest: { signalActive: false, ratio: 0.5 },
    },
    goldenDeathCrosses: {
      events: [
        { t: prices[6].t, type: 'golden' },
        { t: prices[18].t, type: 'death' },
      ],
      currentRegime: 'bearish',
    },
    risk: {
      metric,
      components,
      normalized: components,
      latest: { metric: 0.66, components: { mayerMultiple: 3300 / 2970 } },
    },
  };
  const macroDashboard = {
    series: [
      {
        id: 'demo-rate',
        label: 'Synthetic rate',
        description: 'Invented observations for chart verification.',
        unit: '%',
        decimals: 2,
        points: prices.map((p, i) => ({ t: p.t, value: 2 + i / 10 })),
        latest: { date: '2025-12-01', value: 4.3 },
        yoyChange: 1.2,
      },
      {
        id: 'demo-level',
        label: 'Synthetic level',
        description: 'Different units use a separate chart.',
        unit: 'index',
        decimals: 0,
        points: prices.map((p, i) => ({ t: p.t, value: 100 + i })),
        latest: { date: '2025-12-01', value: 123 },
        yoyChange: 12,
      },
    ],
    source: 'synthetic',
  };
  const presidentialCycle = {
    matrix: Array.from({ length: 4 }, (_, y) =>
      Array.from({ length: 12 }, (_, m) => (m - 5) / 2 + y / 10)
    ),
    counts: Array.from({ length: 4 }, () => Array.from({ length: 12 }, () => 10)),
    currentYear: 2026,
    currentYearOfCycle: 2,
    yearLabels: ['Year 1', 'Year 2', 'Year 3', 'Year 4'],
    monthLabels: [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ],
    source: 'synthetic',
  };
  const sectorRotation = {
    benchmark: { ticker: 'SPY', name: 'Synthetic benchmark', price: 400, returns: { ytd: 8 } },
    sectors: [
      {
        ticker: 'DEMO',
        name: 'Synthetic leading sector',
        price: 100,
        rsRatio: 102,
        momentum: 103,
        quadrant: 'leading',
        returns: { d1: 1, w1: 2, m1: 3, m3: 4, m6: 5, ytd: 6 },
      },
      {
        ticker: 'SYNTH',
        name: 'Synthetic lagging sector',
        price: 50,
        rsRatio: 98,
        momentum: 97,
        quadrant: 'lagging',
        returns: { d1: null, w1: -1, m1: -2, m3: -3, m6: -4, ytd: -5 },
      },
    ],
    source: 'synthetic',
  };
  function macroSeries(id: string, value: number, yoyChange = 0) {
    return {
      id,
      label: `Synthetic ${id}`,
      unit: '%',
      points: prices.map((p) => ({ t: p.t, value })),
      latest: { date: '2025-12-01', value },
      yoyChange,
    };
  }
  const overviewMacro = {
    ...macroDashboard,
    series: [
      ...macroDashboard.series,
      macroSeries('DFF', 4.25),
      macroSeries('CPILFESL', 321, 2.4),
      { ...macroSeries('M2SL', 22000, 2), unit: 'billions USD' },
    ],
  };
  const cache: Record<string, unknown> = {};
  for (const [key, data] of Object.entries({
    btcLogRegression,
    presidentialCycle,
    sectorRotation,
    macroDashboard: overviewMacro,
    jobsDashboard: macroDashboard,
    businessCycle: {
      ...macroDashboard,
      series: [macroSeries('SAHMREALTIME', 0), macroSeries('RECPROUSM156N', 0.12)],
    },
    inflation: {
      ...macroDashboard,
      series: [
        macroSeries('CPIAUCSL', 320, 2.6),
        { ...macroSeries('WALCL', 6600000, -2), unit: 'millions USD' },
      ],
    },
    financialConditions: { ...macroDashboard, series: [macroSeries('NFCI', -0.5)] },
    housing: macroDashboard,
    gdpGrowth: macroDashboard,
    commodities: macroDashboard,
    vixTermStructure: macroDashboard,
    globalMarkets: macroDashboard,
    yieldCurve: {
      latest: { date: '2025-12-01', t10y2y: 1.3, t10y3m: 0.15, regime: 'normal' },
      points: prices.map((p, i) => ({ t: p.t, t10y2y: i / 10 - 1, t10y3m: i / 20 - 1 })),
      recessions: [{ start: prices[2].t, end: prices[5].t }],
      inversionStreak: 0,
      lastInversionStart: '2024-01-01',
      source: 'synthetic',
    },
    realRates: {
      latest: { tenYear: { real: 1 }, fiveYear: { real: 0.5 } },
      ten: prices.map((p) => ({ t: p.t, real: 1, nominal: 4, breakeven: 3 })),
      five: prices.map((p) => ({ t: p.t, real: 0.5, nominal: 3, breakeven: 2.5 })),
      source: 'synthetic',
    },
    btcDrawdown: {
      latest: { drawdown: -0.03, ath: 3400, daysSinceAth: 10 },
      series: prices.map((p, i) => ({
        ...p,
        ath: 3400,
        drawdown: p.price / 3400 - 1,
        date: `2024-${i}`,
      })),
      source: 'synthetic',
    },
    fearGreed: {
      latest: { value: 66, classification: 'Synthetic sentiment' },
      history: prices.map((p, i) => ({ t: p.t, value: 20 + i * 2, classification: 'Synthetic' })),
      source: 'synthetic',
    },
    flippening: {
      latest: { ratio: 0.05, progressToFlippening: 0.2 },
      series: prices.map((p) => ({
        t: p.t,
        btcPrice: p.price,
        ethPrice: p.price / 20,
        ratio: 0.05,
      })),
      source: 'synthetic',
    },
    hashRate: {
      latest: { regime: 'bullish', hashRate: 123000000 },
      series: prices.map((p, i) => ({ t: p.t, hashRate: 100 + i, sma30: 90 + i, sma60: 80 + i })),
      events: [{ t: prices[6].t, type: 'recovery' }],
      source: 'synthetic',
    },
    btcDerivatives: {
      currentFundingRate: 0.0001,
      annualizedFundingRate: 0.1,
      currentLongShortRatio: 1.2,
      fundingHistory: prices.map((p) => ({ t: p.t, rate: 0.0001 })),
      openInterestHistory: prices.map((p) => ({ t: p.t, oiUsd: 10000 })),
      longShortHistory: prices.map((p) => ({ t: p.t, ratio: 1.2 })),
      source: 'synthetic',
    },
    fedPolicy: Object.fromEntries(
      ['effectiveRate', 'targetUpper', 'targetLower', 'sofr'].map((key) => [
        key,
        prices.map((p) => ({ t: p.t, rate: 4 })),
      ])
    ),
    shillerValuation: {
      latest: { cape: 20 },
      capePercentile: 60,
      points: prices.map((p) => ({ t: p.t, sp500: p.price, cape: 20, divYield: 2 })),
      medians: { cape: 18, divYield: 2.5 },
      source: 'synthetic',
    },
    sp500RiskMetric: {
      latest: { metric: 0.66, date: '2025-12-01' },
      points: prices,
      metric,
      normalized: components,
      components,
      source: 'synthetic',
    },
    runningRoi: Object.fromEntries(
      ['btc', 'spx'].map((asset) => [
        asset,
        {
          windows: ['1y', '2y'].map((label) => ({
            label,
            bars: 12,
            approxDays: 365,
            series: prices.map((p, i) => ({ t: p.t, roi: i / 100 })),
            latest: 0.23,
            latestPercentile: 0.7,
            count: 24,
            mean: 0.12,
            min: 0,
            max: 0.23,
          })),
        },
      ])
    ),
    btcDominance: {
      btcDominance: 50,
      ethDominance: 20,
      stableDominance: 10,
      flightToSafety: 60,
      totalMarketCapUsd: 1000000,
      ssr: 5,
      source: 'synthetic',
    },
    altcoinSeason: {
      indexValue: 50,
      regime: 'neutral',
      btcReturn90d: 0.1,
      coins: [
        {
          symbol: 'DEMO',
          name: 'Synthetic Coin',
          return90d: 0.2,
          outperformance: 10,
          beatsBtc: true,
        },
      ],
      source: 'synthetic',
    },
    midtermDrawdowns: {
      curves: [
        {
          label: 'Synthetic current cycle',
          isCurrent: true,
          peakDate: '2026-01-01',
          peakClose: 1000,
          points: [
            { offsetMonths: -1, drawdown: 0 },
            { offsetMonths: 0, drawdown: -0.1 },
            { offsetMonths: 1, drawdown: -0.05 },
          ],
        },
      ],
      averageCurve: [
        { offsetMonths: -1, drawdown: 0 },
        { offsetMonths: 0, drawdown: -0.15 },
        { offsetMonths: 1, drawdown: -0.1 },
      ],
      source: 'synthetic',
    },
    predictions: {
      fetchedAt: new Date().toISOString(),
      sources: { kalshi: true, polymarket: false },
      errors: ['Synthetic secondary source is unavailable.'],
      finance: [
        {
          id: 'demo-finance',
          source: 'kalshi',
          question: 'Synthetic rate decision?',
          probability: 65,
          volumeUsd: 10000,
          liquidityUsd: 2000,
          closeTime: '2027-01-01T12:00:00Z',
          url: 'https://example.com/market/rate',
          domain: 'finance',
          topic: 'Fed & rates',
          change24h: 2,
        },
        {
          id: 'demo-unpriced',
          source: 'kalshi',
          question: 'Synthetic unpriced market?',
          probability: null,
          volumeUsd: null,
          closeTime: null,
          url: 'https://example.com/market/unpriced',
          domain: 'finance',
          topic: 'Equities',
          change24h: null,
        },
      ],
      politics: [
        {
          id: 'demo-politics',
          source: 'polymarket',
          question: 'Synthetic policy outcome?',
          probability: 40,
          volumeUsd: 20000,
          closeTime: null,
          url: 'https://example.com/market/policy',
          domain: 'politics',
          topic: 'Policy',
          change24h: -4,
        },
      ],
    },
    macroCalendar: {
      fetchedAt: Date.now(),
      source: 'synthetic',
      fomc: { display: '4.00–4.25%', asOf: '2025-12-01', note: 'Synthetic previous rate range' },
      cpi: { display: '+2.6% y/y', asOf: '2025-12-01' },
      nfp: null,
    },
  }))
    cache[key] = { fetchedAt: Date.now(), data };
  await writeFile(path.join(dataDir, '.docvault-quant-cache.json'), JSON.stringify(cache));
}
