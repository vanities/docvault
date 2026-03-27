// Financial snapshot route handler — consolidated financial data for LLM consumption.
// Extracted from server/index.ts.

import { promises as fs } from 'fs';
import path from 'path';
import {
  DATA_DIR,
  CRYPTO_CACHE_FILE,
  BROKER_CACHE_FILE,
  SIMPLEFIN_CACHE_FILE,
  loadConfig,
  loadSettings,
  loadParsedData,
  loadMetadata,
  loadSalesData,
  loadMileageData,
  loadGoldData,
  loadPropertyData,
  loadContributions,
  loadReminders,
  loadSnapshots,
  loadSnapshotsForYear,
  loadAssets,
  fetchMetalSpotPrices,
  getEntityPath,
  scanDirectory,
  jsonResponse,
  monthsBetween,
} from '../data.js';
import type {
  EntityConfig,
  Config,
  FileInfo,
  ParsedData,
  PortfolioSnapshot,
  Contribution401k,
} from '../data.js';

export async function handleFinancialSnapshotRoutes(
  req: Request,
  url: URL,
  pathname: string
): Promise<Response | null> {
  // GET /api/financial-snapshot/:year - Consolidated financial snapshot for LLM consumption
  const snapshotMatch = pathname.match(/^\/api\/financial-snapshot\/(\d{4})$/);
  if (snapshotMatch && req.method === 'GET') {
    const year = snapshotMatch[1];
    const format = url.searchParams.get('format') || 'toon';

    try {
      const [
        config,
        parsedDataMap,
        metadataMap,
        salesData,
        mileageData,
        assets,
        contributions,
        goldData,
        propertyData,
        reminders,
        portfolioSnapshots,
      ] = await Promise.all([
        loadConfig(),
        loadParsedData(),
        loadMetadata(),
        loadSalesData(),
        loadMileageData(),
        loadAssets(),
        loadContributions(),
        loadGoldData(),
        loadPropertyData(),
        loadReminders(),
        loadSnapshotsForYear(parseInt(year)),
      ]);

      // Load cached portfolio data (non-critical — use empty defaults on failure)
      let brokerCache: {
        accounts: {
          id: string;
          broker: string;
          name: string;
          url?: string;
          holdings: {
            ticker: string;
            shares: number;
            costBasis: number;
            label: string;
            price: number;
            marketValue: number;
            gainLoss: number;
            gainLossPercent: number;
            gainType: string;
          }[];
        }[];
        lastUpdated?: string;
      } = { accounts: [] };
      let cryptoCache: {
        sources: {
          sourceId: string;
          sourceType: string;
          label: string;
          balances: { asset: string; amount: number; usdValue: number }[];
          totalUsdValue: number;
          lastUpdated: string;
        }[];
        totalUsdValue?: number;
      } = { sources: [] };
      let simplefinCache: {
        accounts: {
          id: string;
          name: string;
          currency: string;
          balance: number;
          availableBalance: number | null;
          connectionName?: string;
        }[];
        lastUpdated: string;
      } = { accounts: [], lastUpdated: '' };

      try {
        const raw = await fs.readFile(BROKER_CACHE_FILE, 'utf-8');
        brokerCache = JSON.parse(raw);
      } catch {
        /* no broker data */
      }
      try {
        const raw = await fs.readFile(CRYPTO_CACHE_FILE, 'utf-8');
        cryptoCache = JSON.parse(raw);
      } catch {
        /* no crypto data */
      }
      try {
        const raw = await fs.readFile(SIMPLEFIN_CACHE_FILE, 'utf-8');
        simplefinCache = JSON.parse(raw);
      } catch {
        /* no bank data */
      }

      // Load crypto gains cache (pre-computed, not fetched live)
      let cryptoGainsCache: {
        assets?: {
          asset: string;
          totalAmount: number;
          totalCostBasis: number;
          currentValue: number;
          unrealizedGain: number;
          shortTermGain: number;
          longTermGain: number;
        }[];
        totalCostBasis?: number;
        totalCurrentValue?: number;
        totalUnrealizedGain?: number;
        totalShortTermGain?: number;
        totalLongTermGain?: number;
        tradeCount?: number;
        lastUpdated?: string;
      } = {};
      try {
        const raw = await fs.readFile(path.join(DATA_DIR, '.docvault-crypto-gains.json'), 'utf-8');
        cryptoGainsCache = JSON.parse(raw);
      } catch {
        /* no crypto gains data */
      }

      // Fetch metal spot prices (non-blocking)
      let spotPrices: Record<string, number> = {};
      try {
        spotPrices = await fetchMetalSpotPrices();
      } catch {
        /* no spot prices */
      }

      // Parse bank statement deposits using centralized analytics module
      const { getBankDepositSummary } = await import('../analytics/index.js');

      // Build bank deposit summaries using centralized analytics module
      const bankDepositsByEntity: Record<
        string,
        ReturnType<typeof getBankDepositSummary>['monthly']
      > = {};
      const bankDepositSummaries: Record<string, ReturnType<typeof getBankDepositSummary>> = {};
      const taxEntitiesForStatements = config.entities.filter(
        (e) => (e as Record<string, unknown>).type === 'tax'
      );
      for (const entity of taxEntitiesForStatements) {
        const entityPath = await getEntityPath(entity.id);
        if (!entityPath) continue;
        const statementsPath = path.join(entityPath, year, 'statements', 'bank');
        try {
          await fs.access(statementsPath);
          const statementFiles = await fs.readdir(statementsPath);
          const summary = getBankDepositSummary(
            entity.id,
            year,
            parsedDataMap,
            metadataMap,
            statementFiles
          );
          if (summary.monthly.length > 0) {
            bankDepositsByEntity[entity.id] = summary.monthly;
            bankDepositSummaries[entity.id] = summary;
          }
        } catch {
          /* no statements dir */
        }
      }

      // Build tax entity summaries using centralized analytics module
      const { getIncomeSummary, getExpenseSummary } = await import('../analytics/index.js');
      const taxEntities = config.entities.filter(
        (e) => (e as Record<string, unknown>).type === 'tax'
      );

      const entitySummaries: Record<
        string,
        {
          entity: EntityConfig;
          income: {
            source: string;
            amount: number;
            type: string;
            details?: Record<string, unknown>;
          }[];
          expenses: { vendor: string; amount: number; category: string }[];
        }
      > = {};

      for (const entity of taxEntities) {
        const entityPath = await getEntityPath(entity.id);
        if (!entityPath) continue;

        const yearPath = path.join(entityPath, year);
        let files: FileInfo[] = [];
        try {
          await fs.access(yearPath);
          files = await scanDirectory(yearPath, year);
        } catch {
          continue;
        }

        const analyticsFiles = files.map((f) => ({ name: f.name, path: f.path, type: f.type }));
        const incomeSummary = getIncomeSummary(
          entity.id,
          year,
          parsedDataMap,
          metadataMap,
          analyticsFiles
        );
        const expenseSummary = getExpenseSummary(
          entity.id,
          year,
          parsedDataMap,
          metadataMap,
          analyticsFiles
        );

        entitySummaries[entity.id] = {
          entity,
          income: incomeSummary.items.map((i) => ({
            source: i.source,
            amount: i.amount,
            type: i.type,
            details: i.details,
          })),
          expenses: expenseSummary.expenses.map((e) => ({
            vendor: e.vendor,
            amount: e.amount,
            category: e.category,
          })),
        };
      }

      // Filter sales and mileage by year
      const yearSales = salesData.sales.filter((s) => s.date.startsWith(year));
      const yearMileage = mileageData.entries.filter((e) => e.date.startsWith(year));

      // Filter contributions by year
      const yearContributions: Record<string, Contribution401k[]> = {};
      for (const [key, entries] of Object.entries(contributions)) {
        if (key.endsWith(`/${year}`)) {
          yearContributions[key] = entries;
        }
      }

      // Build quarterly invoice/sales breakdown
      const quarterLabels = ['Q1 (Jan-Mar)', 'Q2 (Apr-Jun)', 'Q3 (Jul-Sep)', 'Q4 (Oct-Dec)'];
      const salesByQuarter: { quarter: string; sales: typeof yearSales; total: number }[] = [
        { quarter: quarterLabels[0], sales: [], total: 0 },
        { quarter: quarterLabels[1], sales: [], total: 0 },
        { quarter: quarterLabels[2], sales: [], total: 0 },
        { quarter: quarterLabels[3], sales: [], total: 0 },
      ];
      for (const s of yearSales) {
        const month = parseInt(s.date.split('-')[1], 10);
        const qi = month <= 3 ? 0 : month <= 6 ? 1 : month <= 9 ? 2 : 3;
        salesByQuarter[qi].sales.push(s);
        salesByQuarter[qi].total += s.total;
      }

      // Build quarterly bank deposit breakdown per entity
      type MonthDeposit = {
        month: string;
        deposits: number;
        ownerContributions: number;
        revenueDeposits: number;
      };
      type QuarterDeposit = {
        quarter: string;
        deposits: number;
        ownerContributions: number;
        revenueDeposits: number;
        months: MonthDeposit[];
      };
      const depositsByQuarter: Record<string, QuarterDeposit[]> = {};
      for (const [entityId, months] of Object.entries(bankDepositsByEntity)) {
        const quarters: QuarterDeposit[] = quarterLabels.map((q) => ({
          quarter: q,
          deposits: 0,
          ownerContributions: 0,
          revenueDeposits: 0,
          months: [],
        }));
        for (const m of months) {
          const monthNum = parseInt(m.month.split('-')[1], 10);
          const qi = monthNum <= 3 ? 0 : monthNum <= 6 ? 1 : monthNum <= 9 ? 2 : 3;
          quarters[qi].deposits += m.deposits;
          quarters[qi].ownerContributions += m.ownerContributions;
          quarters[qi].revenueDeposits += m.revenueDeposits;
          quarters[qi].months.push({
            month: m.month,
            deposits: m.deposits,
            ownerContributions: m.ownerContributions,
            revenueDeposits: m.revenueDeposits,
          });
        }
        depositsByQuarter[entityId] = quarters;
      }

      // Build gold/precious metals summary
      const goldSummary: {
        entries: {
          metal: string;
          product: string;
          quantity: number;
          weightOz: number;
          totalOz: number;
          purchasePrice: number;
          totalCost: number;
          currentValue: number;
          gainLoss: number;
          purchaseDate: string;
        }[];
        totalCost: number;
        totalValue: number;
        totalGainLoss: number;
        spotPrices: Record<string, number>;
      } = { entries: [], totalCost: 0, totalValue: 0, totalGainLoss: 0, spotPrices };

      for (const entry of goldData.entries) {
        const spot = spotPrices[entry.metal] || 0;
        const totalOz = entry.weightOz * entry.quantity;
        const totalCost = entry.purchasePrice * entry.quantity;
        const currentValue = totalOz * spot * entry.purity;
        goldSummary.entries.push({
          metal: entry.metal,
          product: entry.customDescription || entry.productId,
          quantity: entry.quantity,
          weightOz: entry.weightOz,
          totalOz,
          purchasePrice: entry.purchasePrice,
          totalCost,
          currentValue,
          gainLoss: currentValue - totalCost,
          purchaseDate: entry.purchaseDate,
        });
        goldSummary.totalCost += totalCost;
        goldSummary.totalValue += currentValue;
      }
      goldSummary.totalGainLoss = goldSummary.totalValue - goldSummary.totalCost;

      // Build property summary
      const propertySummary: {
        entries: {
          name: string;
          type: string;
          address: string;
          acreage?: number;
          squareFeet?: number;
          purchaseDate: string;
          purchasePrice: number;
          currentValue: number;
          equity: number;
          appreciation: number;
          appreciationPercent: number;
          annualPropertyTax?: number;
          mortgage?: {
            lender: string;
            balance: number;
            rate: number;
            monthlyPayment: number;
          };
        }[];
        totalValue: number;
        totalEquity: number;
        totalMortgageBalance: number;
        totalAnnualPropertyTax: number;
      } = {
        entries: [],
        totalValue: 0,
        totalEquity: 0,
        totalMortgageBalance: 0,
        totalAnnualPropertyTax: 0,
      };

      for (const prop of propertyData.entries) {
        const mortgageBalance = prop.mortgage?.balance || 0;
        const equity = prop.currentValue - mortgageBalance;
        const appreciation = prop.currentValue - prop.purchasePrice;
        const appreciationPercent =
          prop.purchasePrice > 0 ? (appreciation / prop.purchasePrice) * 100 : 0;
        const addr = prop.address;
        propertySummary.entries.push({
          name: prop.name,
          type: prop.type,
          address: `${addr.street}, ${addr.city}, ${addr.state} ${addr.zip}`,
          acreage: prop.acreage,
          squareFeet: prop.squareFeet,
          purchaseDate: prop.purchaseDate,
          purchasePrice: prop.purchasePrice,
          currentValue: prop.currentValue,
          equity,
          appreciation,
          appreciationPercent,
          annualPropertyTax: prop.annualPropertyTax,
          mortgage: prop.mortgage
            ? {
                lender: prop.mortgage.lender,
                balance: prop.mortgage.balance,
                rate: prop.mortgage.rate,
                monthlyPayment: prop.mortgage.monthlyPayment,
              }
            : undefined,
        });
        propertySummary.totalValue += prop.currentValue;
        propertySummary.totalEquity += equity;
        propertySummary.totalMortgageBalance += mortgageBalance;
        propertySummary.totalAnnualPropertyTax += prop.annualPropertyTax || 0;
      }

      // Filter reminders for the tax year (due dates in the year or the following April for filing)
      const yearReminders = reminders.filter((r) => {
        const dueYear = r.dueDate.substring(0, 4);
        // Include reminders due in the tax year or in the filing season (Jan-Apr of next year)
        return (
          dueYear === year ||
          (dueYear === String(parseInt(year) + 1) && r.dueDate.substring(5, 7) <= '04')
        );
      });

      // Portfolio history summary (first and last snapshots, plus quarterly)
      const portfolioHistory: {
        snapshotCount: number;
        firstSnapshot?: { date: string; totalValue: number };
        lastSnapshot?: { date: string; totalValue: number };
        yearChange?: number;
        yearChangePercent?: number;
        quarterlySnapshots: { quarter: string; date: string; totalValue: number }[];
      } = {
        snapshotCount: portfolioSnapshots.length,
        quarterlySnapshots: [],
      };
      if (portfolioSnapshots.length > 0) {
        const first = portfolioSnapshots[0];
        const last = portfolioSnapshots[portfolioSnapshots.length - 1];
        portfolioHistory.firstSnapshot = { date: first.date, totalValue: first.totalValue };
        portfolioHistory.lastSnapshot = { date: last.date, totalValue: last.totalValue };
        portfolioHistory.yearChange = last.totalValue - first.totalValue;
        portfolioHistory.yearChangePercent =
          first.totalValue > 0
            ? ((last.totalValue - first.totalValue) / first.totalValue) * 100
            : 0;

        // Pick one snapshot per quarter end (closest to end of Mar, Jun, Sep, Dec)
        const quarterEnds = [`${year}-03-31`, `${year}-06-30`, `${year}-09-30`, `${year}-12-31`];
        for (let qi = 0; qi < quarterEnds.length; qi++) {
          const target = quarterEnds[qi];
          let closest = portfolioSnapshots[0];
          let closestDist = Math.abs(new Date(closest.date).getTime() - new Date(target).getTime());
          for (const snap of portfolioSnapshots) {
            const dist = Math.abs(new Date(snap.date).getTime() - new Date(target).getTime());
            if (dist < closestDist) {
              closest = snap;
              closestDist = dist;
            }
          }
          // Only include if within 15 days of quarter end
          if (closestDist < 15 * 86400000) {
            portfolioHistory.quarterlySnapshots.push({
              quarter: quarterLabels[qi],
              date: closest.date,
              totalValue: closest.totalValue,
            });
          }
        }
      }

      // Calculate net worth / portfolio totals
      const brokerTotal = brokerCache.accounts.reduce(
        (s, a) => s + a.holdings.reduce((hs, h) => hs + h.marketValue, 0),
        0
      );
      const cryptoTotal = cryptoCache.totalUsdValue || 0;
      const bankTotal = simplefinCache.accounts.reduce((s, a) => s + a.balance, 0);
      const portfolioSummary = {
        brokerage: brokerTotal,
        crypto: cryptoTotal,
        preciousMetals: goldSummary.totalValue,
        property: propertySummary.totalEquity,
        bankAccounts: bankTotal,
        totalNetWorth:
          brokerTotal +
          cryptoTotal +
          goldSummary.totalValue +
          propertySummary.totalEquity +
          bankTotal,
      };

      // ── Tax Summary + Form 2210 (using centralized analytics) ──────
      const { getTaxCalculation } = await import('../analytics/index.js');

      // Retirement deduction total
      let retirementDeduction = 0;
      for (const [, entries] of Object.entries(yearContributions)) {
        retirementDeduction += entries.reduce((s, c) => s + c.amount, 0);
      }

      // Build bank revenue by entity for Schedule C calculation
      const bankRevenueByEntity: Record<string, number> = {};
      for (const [entityId, summary] of Object.entries(bankDepositSummaries)) {
        bankRevenueByEntity[entityId] = summary.monthly.reduce(
          (sum, m) => sum + m.revenueDeposits,
          0
        );
      }

      // Build expenses by entity for Schedule C net profit
      // Includes parsed receipt expenses + home office deduction from entity metadata
      const expensesByEntity: Record<string, number> = {};
      for (const [entityId, data] of Object.entries(entitySummaries)) {
        let total = 0;
        if (data.expenses && data.expenses.length > 0) {
          total = data.expenses.reduce((sum, e) => sum + e.amount, 0);
        }
        // Add home office deduction if set in entity metadata
        const entityMeta = data.entity?.metadata as Record<string, string | string[]> | undefined;
        if (entityMeta?.homeOfficeDeduction) {
          total += parseFloat(String(entityMeta.homeOfficeDeduction)) || 0;
        }
        if (total > 0) {
          expensesByEntity[entityId] = total;
        }
      }

      // Read QBI loss carryforward from personal entity metadata
      // Keyed by prior year (e.g., "2024" means carryforward FROM 2024 INTO 2025)
      let qbiLossCarryforward = 0;
      const personalEntity = entitySummaries['personal'];
      if (personalEntity) {
        const personalMeta = personalEntity.entity?.metadata as Record<string, unknown> | undefined;
        if (personalMeta?.qbiCarryforward) {
          const cfData = personalMeta.qbiCarryforward as Record<string, string | number>;
          const priorYear = String(parseInt(year) - 1);
          if (cfData[priorYear]) {
            qbiLossCarryforward = parseFloat(String(cfData[priorYear])) || 0;
          }
        }
      }

      const taxSummary = getTaxCalculation(
        year,
        entitySummaries,
        retirementDeduction,
        bankRevenueByEntity,
        expensesByEntity,
        qbiLossCarryforward
      );

      // Form 2210 periods from bank deposit summaries (already computed by analytics module)
      const form2210Periods: Record<
        string,
        {
          periods: {
            label: string;
            cumulativeDeposits: number;
            cumulativeRevenue: number;
            cumulativeOwnerContributions: number;
          }[];
        }
      > = {};
      for (const [entityId, summary] of Object.entries(bankDepositSummaries)) {
        form2210Periods[entityId] = { periods: summary.form2210Periods };
      }

      // Build the snapshot object
      const snapshot = {
        year,
        generatedAt: new Date().toISOString(),
        entities: entitySummaries,
        sales: {
          products: salesData.products,
          entries: yearSales,
          totalRevenue: yearSales.reduce((sum, s) => sum + s.total, 0),
          byQuarter: salesByQuarter,
        },
        mileage: {
          vehicles: mileageData.vehicles,
          entries: yearMileage,
          irsRate: mileageData.irsRate,
          totalMiles: yearMileage.reduce((sum, e) => sum + (e.tripMiles || 0), 0),
          totalDeduction:
            yearMileage.reduce((sum, e) => sum + (e.tripMiles || 0), 0) * mileageData.irsRate,
        },
        bankStatementDeposits: depositsByQuarter,
        assets,
        retirement: yearContributions,
        investments: {
          brokerAccounts: brokerCache.accounts,
          brokerLastUpdated: brokerCache.lastUpdated,
        },
        crypto: {
          sources: cryptoCache.sources,
          totalUsdValue: cryptoCache.totalUsdValue,
        },
        preciousMetals: goldSummary,
        property: propertySummary,
        bankAccounts: {
          accounts: simplefinCache.accounts.map((a) => ({
            name: a.name,
            balance: a.balance,
            currency: a.currency,
            connectionName: a.connectionName,
          })),
          lastUpdated: simplefinCache.lastUpdated,
        },
        cryptoGains: cryptoGainsCache.assets
          ? {
              assets: cryptoGainsCache.assets.map((a) => ({
                asset: a.asset,
                totalAmount: a.totalAmount,
                costBasis: a.totalCostBasis,
                currentValue: a.currentValue,
                unrealizedGain: a.unrealizedGain,
                shortTermGain: a.shortTermGain,
                longTermGain: a.longTermGain,
              })),
              totalCostBasis: cryptoGainsCache.totalCostBasis,
              totalCurrentValue: cryptoGainsCache.totalCurrentValue,
              totalUnrealizedGain: cryptoGainsCache.totalUnrealizedGain,
              totalShortTermGain: cryptoGainsCache.totalShortTermGain,
              totalLongTermGain: cryptoGainsCache.totalLongTermGain,
              tradeCount: cryptoGainsCache.tradeCount,
              lastUpdated: cryptoGainsCache.lastUpdated,
            }
          : null,
        reminders: yearReminders.map((r) => ({
          title: r.title,
          entityId: r.entityId,
          dueDate: r.dueDate,
          status: r.status,
          recurrence: r.recurrence,
          notes: r.notes,
        })),
        portfolioHistory,
        portfolioSummary,
        taxSummary,
        form2210Periods,
      };

      if (format === 'toon') {
        // TOON — Token-Optimized Object Notation for LLM consumption.
        // Flat key:value lines, no JSON overhead, no markdown tables.
        // ~60% fewer tokens than JSON, ~40% fewer than markdown.
        const t: string[] = [];
        const $ = (n: number) =>
          (n < 0 ? '-' : '') +
          '$' +
          Math.abs(n).toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          });

        t.push(`FINANCIAL_SNAPSHOT year=${year} date=${new Date().toISOString().split('T')[0]}`);
        t.push('');

        // Entities + income + expenses
        for (const [id, data] of Object.entries(entitySummaries)) {
          const meta = data.entity.metadata || {};
          t.push(
            `ENTITY ${id} name="${data.entity.name}"${meta.ein ? ` ein=${meta.ein}` : ''}${data.entity.description ? ` desc="${data.entity.description}"` : ''}`
          );

          if (data.income.length > 0) {
            for (const inc of data.income) {
              let line = `  INCOME type=${inc.type} source="${inc.source}" amt=${$(inc.amount)}`;
              if (inc.details) {
                const d = inc.details as Record<string, unknown>;
                for (const [k, v] of Object.entries(d)) {
                  if (v !== undefined && v !== null && v !== 0 && v !== '') {
                    line += ` ${k}=${typeof v === 'number' ? $(v as number) : v}`;
                  }
                }
              }
              t.push(line);
            }
          }

          if (data.expenses.length > 0) {
            // Group expenses by category
            const cats = new Map<string, number>();
            for (const exp of data.expenses) {
              cats.set(exp.category, (cats.get(exp.category) || 0) + exp.amount);
            }
            for (const [cat, total] of cats) {
              t.push(`  EXPENSE cat=${cat} amt=${$(total)}`);
            }
          }
        }
        t.push('');

        // Bank deposits
        for (const [entityId, quarters] of Object.entries(snapshot.bankStatementDeposits || {})) {
          const total = (quarters as { deposits: number }[]).reduce((s, q) => s + q.deposits, 0);
          if (total > 0) {
            t.push(`BANK_DEPOSITS entity=${entityId} total=${$(total)}`);
            for (const q of quarters as {
              quarter: string;
              deposits: number;
              revenueDeposits: number;
              ownerContributions: number;
            }[]) {
              if (q.deposits > 0) {
                t.push(
                  `  ${q.quarter} deposits=${$(q.deposits)} revenue=${$(q.revenueDeposits)} owner=${$(q.ownerContributions)}`
                );
              }
            }
          }
        }
        t.push('');

        // Tax summary
        t.push('TAX_SUMMARY');
        t.push(`  wages=${$(taxSummary.wages)} fed_withheld=${$(taxSummary.federalWithheld)}`);
        t.push(`  schedule_c=${$(taxSummary.scheduleCIncome)}`);
        t.push(
          `  cap_gains st=${$(taxSummary.capitalGains.shortTerm)} lt=${$(taxSummary.capitalGains.longTerm)} total=${$(taxSummary.capitalGains.total)}`
        );
        t.push(
          `  dividends ordinary=${$(taxSummary.dividends.ordinary)} qualified=${$(taxSummary.dividends.qualified)}`
        );
        t.push(`  other_income=${$(taxSummary.otherIncome)}`);
        t.push(`  total_income=${$(taxSummary.estimatedTotalIncome)}`);
        t.push(`  se_tax=${$(taxSummary.seTax)} se_deduction=${$(taxSummary.seTaxDeduction)}`);
        t.push(`  retirement_deduction=${$(taxSummary.retirementDeduction)}`);
        t.push(`  est_agi=${$(taxSummary.estimatedAGI)}`);
        if (taxSummary.w2Details.length > 0) {
          for (const w of taxSummary.w2Details) {
            t.push(`  W2 employer="${w.employer}" wages=${$(w.wages)} withheld=${$(w.withheld)}`);
          }
        }
        t.push('');

        // Form 2210
        for (const [entityId, data] of Object.entries(form2210Periods)) {
          t.push(`FORM_2210 entity=${entityId}`);
          for (const p of (
            data as {
              periods: {
                label: string;
                cumulativeDeposits: number;
                cumulativeRevenue: number;
                cumulativeOwnerContributions: number;
              }[];
            }
          ).periods) {
            t.push(
              `  ${p.label} deposits=${$(p.cumulativeDeposits)} revenue=${$(p.cumulativeRevenue)}`
            );
          }
        }
        t.push('');

        // Portfolio
        if (portfolioSummary.totalNetWorth > 0) {
          t.push(`PORTFOLIO net_worth=${$(portfolioSummary.totalNetWorth)}`);
          if (portfolioSummary.brokerage) t.push(`  brokerage=${$(portfolioSummary.brokerage)}`);
          if (portfolioSummary.crypto) t.push(`  crypto=${$(portfolioSummary.crypto)}`);
          if (portfolioSummary.preciousMetals)
            t.push(`  metals=${$(portfolioSummary.preciousMetals)}`);
          if (portfolioSummary.property) t.push(`  property=${$(portfolioSummary.property)}`);
          if (portfolioSummary.bankAccounts) t.push(`  bank=${$(portfolioSummary.bankAccounts)}`);
        }

        // Sales
        if (snapshot.sales.totalRevenue > 0) {
          t.push(
            `SALES total=${$(snapshot.sales.totalRevenue)} count=${snapshot.sales.entries.length}`
          );
        }

        // Mileage
        if (snapshot.mileage.totalMiles > 0) {
          t.push(
            `MILEAGE miles=${snapshot.mileage.totalMiles} deduction=${$(snapshot.mileage.totalDeduction)} rate=${snapshot.mileage.irsRate}`
          );
        }

        return new Response(t.join('\n'), {
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }

      if (format === 'md' || format === 'markdown') {
        // Generate markdown
        const lines: string[] = [];
        const fmt = (n: number) =>
          n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

        lines.push(`# ${year} Financial Snapshot`);
        lines.push(`Generated: ${new Date().toISOString().split('T')[0]}`);
        lines.push('');

        // Entity overview
        lines.push('## Entities');
        for (const [id, data] of Object.entries(entitySummaries)) {
          const meta = data.entity.metadata || {};
          const ein = meta.ein ? ` (EIN: ${meta.ein})` : '';
          lines.push(
            `- **${data.entity.name}**${ein}${data.entity.description ? ` — ${data.entity.description}` : ''}`
          );
          if (meta.address) lines.push(`  - Address: ${meta.address}`);
        }
        lines.push('');

        // Income & Expenses per entity
        for (const [id, data] of Object.entries(entitySummaries)) {
          if (data.income.length > 0) {
            lines.push(`## ${data.entity.name} — Income`);
            lines.push('| Source | Type | Amount |');
            lines.push('|--------|------|--------|');
            for (const inc of data.income) {
              lines.push(`| ${inc.source} | ${inc.type} | ${fmt(inc.amount)} |`);
              if (inc.details) {
                for (const [k, v] of Object.entries(inc.details)) {
                  if (v != null && v !== 0) {
                    lines.push(`|   ↳ ${k} | | ${fmt(v as number)} |`);
                  }
                }
              }
            }
            const totalIncome = data.income.reduce((s, i) => s + i.amount, 0);
            lines.push(`| **Total** | | **${fmt(totalIncome)}** |`);
            lines.push('');
          }

          if (data.expenses.length > 0) {
            lines.push(`## ${data.entity.name} — Expenses (Schedule C)`);
            // Group by category
            const byCategory: Record<string, number> = {};
            for (const exp of data.expenses) {
              byCategory[exp.category] = (byCategory[exp.category] || 0) + exp.amount;
            }
            lines.push('| Category | Total |');
            lines.push('|----------|-------|');
            for (const [cat, total] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
              lines.push(`| ${cat} | ${fmt(total)} |`);
            }
            const totalExp = data.expenses.reduce((s, e) => s + e.amount, 0);
            lines.push(`| **Total Expenses** | **${fmt(totalExp)}** |`);
            lines.push('');
          }
        }

        // Sales with quarterly breakdown
        if (yearSales.length > 0) {
          lines.push('## Sales Revenue');
          const byCust: Record<string, number> = {};
          for (const s of yearSales) {
            byCust[s.person] = (byCust[s.person] || 0) + s.total;
          }
          lines.push('| Customer | Total |');
          lines.push('|----------|-------|');
          for (const [cust, total] of Object.entries(byCust).sort((a, b) => b[1] - a[1])) {
            lines.push(`| ${cust} | ${fmt(total)} |`);
          }
          lines.push(`| **Total Revenue** | **${fmt(snapshot.sales.totalRevenue)}** |`);
          lines.push('');

          // Quarterly breakdown
          const hasQuarterData = salesByQuarter.some((q) => q.total > 0);
          if (hasQuarterData) {
            lines.push('### Sales by Quarter');
            lines.push('| Quarter | Revenue | # Sales |');
            lines.push('|---------|---------|---------|');
            for (const q of salesByQuarter) {
              lines.push(`| ${q.quarter} | ${fmt(q.total)} | ${q.sales.length} |`);
            }
            lines.push('');
          }
        }

        // Mileage
        if (yearMileage.length > 0) {
          lines.push('## Business Mileage');
          lines.push(`- Total trips: ${yearMileage.length}`);
          lines.push(`- Total miles: ${snapshot.mileage.totalMiles.toFixed(1)}`);
          lines.push(`- IRS rate: $${mileageData.irsRate}/mi`);
          lines.push(`- **Deduction: ${fmt(snapshot.mileage.totalDeduction)}**`);
          // By entity
          const mileByEntity: Record<string, number> = {};
          for (const e of yearMileage) {
            const eid = e.entity || 'unknown';
            mileByEntity[eid] = (mileByEntity[eid] || 0) + (e.tripMiles || 0);
          }
          if (Object.keys(mileByEntity).length > 1) {
            lines.push('');
            lines.push('| Entity | Miles | Deduction |');
            lines.push('|--------|-------|-----------|');
            for (const [eid, miles] of Object.entries(mileByEntity)) {
              lines.push(`| ${eid} | ${miles.toFixed(1)} | ${fmt(miles * mileageData.irsRate)} |`);
            }
          }
          lines.push('');
        }

        // Assets
        const entityAssetKeys = Object.keys(assets).filter((k) => k !== 'all');
        if (entityAssetKeys.length > 0) {
          lines.push('## Business Assets');
          for (const eid of entityAssetKeys) {
            const list = assets[eid] || [];
            if (list.length === 0) continue;
            lines.push(`### ${eid}`);
            lines.push('| Asset | Value |');
            lines.push('|-------|-------|');
            for (const a of list) {
              lines.push(`| ${a.name} | ${fmt(a.value)} |`);
            }
            lines.push(`| **Total** | **${fmt(list.reduce((s, a) => s + a.value, 0))}** |`);
            lines.push('');
          }
        }

        // Retirement contributions (with timeline)
        if (Object.keys(yearContributions).length > 0) {
          lines.push('## Retirement Contributions (Solo 401k)');
          for (const [key, entries] of Object.entries(yearContributions)) {
            const entityId = key.split('/')[0];
            const entityName = entitySummaries[entityId]?.entity.name || entityId;
            const employee = entries
              .filter((c) => c.type === 'employee')
              .reduce((s, c) => s + c.amount, 0);
            const employer = entries
              .filter((c) => c.type === 'employer')
              .reduce((s, c) => s + c.amount, 0);
            lines.push(`### ${entityName}`);
            lines.push('');
            lines.push('**Summary**');
            lines.push(`- Employee contributions: ${fmt(employee)}`);
            lines.push(`- Employer contributions: ${fmt(employer)}`);
            lines.push(`- **Total: ${fmt(employee + employer)}**`);
            lines.push('');

            // Timeline of individual contributions
            const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
            if (sorted.length > 0) {
              lines.push('**Contribution Timeline**');
              lines.push('| Date | Type | Amount | Cumulative |');
              lines.push('|------|------|--------|------------|');
              let cumulative = 0;
              for (const c of sorted) {
                cumulative += c.amount;
                const typeLabel = c.type === 'employee' ? 'Employee' : 'Employer';
                lines.push(`| ${c.date} | ${typeLabel} | ${fmt(c.amount)} | ${fmt(cumulative)} |`);
              }
              lines.push('');
            }
          }
        }

        // Investments
        if (brokerCache.accounts.length > 0) {
          lines.push('## Brokerage Accounts');
          if (brokerCache.lastUpdated) lines.push(`_Last updated: ${brokerCache.lastUpdated}_`);
          for (const acct of brokerCache.accounts) {
            const totalValue = acct.holdings.reduce((s, h) => s + h.marketValue, 0);
            const totalGain = acct.holdings.reduce((s, h) => s + h.gainLoss, 0);
            lines.push(`### ${acct.name} (${acct.broker})`);
            lines.push(`Total value: ${fmt(totalValue)} | Unrealized gain/loss: ${fmt(totalGain)}`);
            lines.push('| Holding | Shares | Market Value | Gain/Loss |');
            lines.push('|---------|--------|-------------|-----------|');
            for (const h of acct.holdings) {
              lines.push(
                `| ${h.label || h.ticker} | ${h.shares} | ${fmt(h.marketValue)} | ${fmt(h.gainLoss)} |`
              );
            }
            lines.push('');
          }
        }

        // Crypto
        if (cryptoCache.sources.length > 0) {
          lines.push('## Crypto Holdings');
          lines.push(`Total value: ${fmt(cryptoCache.totalUsdValue || 0)}`);
          for (const src of cryptoCache.sources) {
            lines.push(`### ${src.label} (${fmt(src.totalUsdValue)})`);
            const nonZero = src.balances.filter((b) => b.usdValue > 0.01);
            if (nonZero.length > 0) {
              lines.push('| Asset | Amount | USD Value |');
              lines.push('|-------|--------|-----------|');
              for (const b of nonZero) {
                lines.push(`| ${b.asset} | ${b.amount} | ${fmt(b.usdValue)} |`);
              }
            }
          }
          lines.push('');
        }

        // Bank Statement Deposits (quarterly breakdown)
        if (Object.keys(depositsByQuarter).length > 0) {
          lines.push('## Bank Statement Deposits');
          for (const [entityId, quarters] of Object.entries(depositsByQuarter)) {
            const entityName = entitySummaries[entityId]?.entity.name || entityId;
            const totalOwnerContribs = quarters.reduce((s, q) => s + q.ownerContributions, 0);
            const hasOwnerContribs = totalOwnerContribs > 0;
            const monthNames = [
              '',
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
            ];

            lines.push(`### ${entityName}`);
            if (hasOwnerContribs) {
              lines.push(
                '_Note: Owner contributions (transfers from personal accounts) are separated from revenue deposits._'
              );
              lines.push('| Month | Total Deposits | Revenue | Owner Contributions |');
              lines.push('|-------|---------------|---------|---------------------|');
            } else {
              lines.push('| Month | Deposits |');
              lines.push('|-------|----------|');
            }
            for (const q of quarters) {
              for (const m of q.months) {
                const monthNum = parseInt(m.month.split('-')[1], 10);
                const label = monthNames[monthNum] || m.month;
                if (hasOwnerContribs) {
                  if (m.deposits > 0) {
                    lines.push(
                      `| ${label} | ${fmt(m.deposits)} | ${fmt(m.revenueDeposits)} | ${m.ownerContributions > 0 ? fmt(m.ownerContributions) : '—'} |`
                    );
                  } else {
                    lines.push(`| ${label} | _no deposits_ | — | — |`);
                  }
                } else {
                  lines.push(
                    `| ${label} | ${m.deposits > 0 ? fmt(m.deposits) : '_no deposits_'} |`
                  );
                }
              }
              if (hasOwnerContribs) {
                lines.push(
                  `| **${q.quarter}** | **${fmt(q.deposits)}** | **${fmt(q.revenueDeposits)}** | **${q.ownerContributions > 0 ? fmt(q.ownerContributions) : '—'}** |`
                );
              } else {
                lines.push(`| **${q.quarter}** | **${fmt(q.deposits)}** |`);
              }
            }
            const totalDeposits = quarters.reduce((s, q) => s + q.deposits, 0);
            const totalRevenue = quarters.reduce((s, q) => s + q.revenueDeposits, 0);
            if (hasOwnerContribs) {
              lines.push(
                `| **Full Year** | **${fmt(totalDeposits)}** | **${fmt(totalRevenue)}** | **${fmt(totalOwnerContribs)}** |`
              );
            } else {
              lines.push(`| **Full Year** | **${fmt(totalDeposits)}** |`);
            }
            lines.push('');
          }
        }

        // Precious Metals
        if (goldSummary.entries.length > 0) {
          lines.push('## Precious Metals');
          if (Object.keys(spotPrices).length > 0) {
            const spotLines = Object.entries(spotPrices)
              .filter(([, v]) => v > 0)
              .map(([metal, price]) => `${metal}: ${fmt(price)}/oz`)
              .join(', ');
            lines.push(`_Spot prices: ${spotLines}_`);
          }
          lines.push('| Metal | Product | Qty | Weight | Total Cost | Current Value | Gain/Loss |');
          lines.push('|-------|---------|-----|--------|------------|---------------|-----------|');
          for (const e of goldSummary.entries) {
            lines.push(
              `| ${e.metal} | ${e.product} | ${e.quantity} | ${e.totalOz.toFixed(2)} oz | ${fmt(e.totalCost)} | ${fmt(e.currentValue)} | ${fmt(e.gainLoss)} |`
            );
          }
          lines.push(
            `| **Total** | | | | **${fmt(goldSummary.totalCost)}** | **${fmt(goldSummary.totalValue)}** | **${fmt(goldSummary.totalGainLoss)}** |`
          );
          lines.push('');
        }

        // Property / Real Estate
        if (propertySummary.entries.length > 0) {
          lines.push('## Property & Real Estate');
          for (const prop of propertySummary.entries) {
            lines.push(`### ${prop.name}`);
            lines.push(`- Type: ${prop.type}`);
            lines.push(`- Address: ${prop.address}`);
            if (prop.acreage) lines.push(`- Acreage: ${prop.acreage}`);
            if (prop.squareFeet) lines.push(`- Sq Ft: ${prop.squareFeet.toLocaleString()}`);
            lines.push(`- Purchase: ${fmt(prop.purchasePrice)} (${prop.purchaseDate})`);
            lines.push(`- Current Value: ${fmt(prop.currentValue)}`);
            lines.push(
              `- Appreciation: ${fmt(prop.appreciation)} (${prop.appreciationPercent.toFixed(1)}%)`
            );
            if (prop.mortgage) {
              lines.push(
                `- Mortgage: ${fmt(prop.mortgage.balance)} @ ${(prop.mortgage.rate * 100).toFixed(2)}% (${prop.mortgage.lender})`
              );
              lines.push(`- Monthly Payment: ${fmt(prop.mortgage.monthlyPayment)}`);
            }
            lines.push(`- **Equity: ${fmt(prop.equity)}**`);
            if (prop.annualPropertyTax)
              lines.push(`- Annual Property Tax: ${fmt(prop.annualPropertyTax)}`);
            lines.push('');
          }
          lines.push(`**Total Property Value:** ${fmt(propertySummary.totalValue)}`);
          lines.push(`**Total Equity:** ${fmt(propertySummary.totalEquity)}`);
          if (propertySummary.totalMortgageBalance > 0)
            lines.push(`**Total Mortgage Balance:** ${fmt(propertySummary.totalMortgageBalance)}`);
          if (propertySummary.totalAnnualPropertyTax > 0)
            lines.push(
              `**Total Annual Property Tax:** ${fmt(propertySummary.totalAnnualPropertyTax)}`
            );
          lines.push('');
        }

        // Bank accounts
        const nonZeroBanks = simplefinCache.accounts.filter((a) => a.balance !== 0);
        if (nonZeroBanks.length > 0) {
          lines.push('## Bank Accounts');
          if (simplefinCache.lastUpdated)
            lines.push(`_Last updated: ${simplefinCache.lastUpdated}_`);
          lines.push('| Account | Balance |');
          lines.push('|---------|---------|');
          for (const a of nonZeroBanks) {
            lines.push(
              `| ${a.name}${a.connectionName ? ` (${a.connectionName})` : ''} | ${fmt(a.balance)} |`
            );
          }
          const totalBank = nonZeroBanks.reduce((s, a) => s + a.balance, 0);
          lines.push(`| **Total** | **${fmt(totalBank)}** |`);
          lines.push('');
        }

        // Crypto Tax Gains (if cached)
        if (cryptoGainsCache.assets && cryptoGainsCache.assets.length > 0) {
          lines.push('## Crypto Tax Gains (Cost Basis)');
          if (cryptoGainsCache.lastUpdated)
            lines.push(`_Last computed: ${cryptoGainsCache.lastUpdated}_`);
          if (cryptoGainsCache.tradeCount)
            lines.push(`_Total trades analyzed: ${cryptoGainsCache.tradeCount.toLocaleString()}_`);
          lines.push(
            '| Asset | Amount | Cost Basis | Current Value | Unrealized Gain | ST Gain | LT Gain |'
          );
          lines.push(
            '|-------|--------|------------|---------------|-----------------|---------|---------|'
          );
          const significantAssets = cryptoGainsCache.assets.filter(
            (a) => Math.abs(a.unrealizedGain) > 1 || a.totalCostBasis > 1
          );
          for (const a of significantAssets.sort((x, y) => y.currentValue - x.currentValue)) {
            lines.push(
              `| ${a.asset} | ${a.totalAmount.toFixed(4)} | ${fmt(a.totalCostBasis)} | ${fmt(a.currentValue)} | ${fmt(a.unrealizedGain)} | ${fmt(a.shortTermGain)} | ${fmt(a.longTermGain)} |`
            );
          }
          lines.push(
            `| **Total** | | **${fmt(cryptoGainsCache.totalCostBasis || 0)}** | **${fmt(cryptoGainsCache.totalCurrentValue || 0)}** | **${fmt(cryptoGainsCache.totalUnrealizedGain || 0)}** | **${fmt(cryptoGainsCache.totalShortTermGain || 0)}** | **${fmt(cryptoGainsCache.totalLongTermGain || 0)}** |`
          );
          lines.push('');
        }

        // Reminders / Deadlines
        if (yearReminders.length > 0) {
          lines.push('## Tax Deadlines & Reminders');
          lines.push('| Due Date | Entity | Title | Status | Notes |');
          lines.push('|----------|--------|-------|--------|-------|');
          for (const r of yearReminders.sort((a, b) => a.dueDate.localeCompare(b.dueDate))) {
            const entityName = entitySummaries[r.entityId]?.entity.name || r.entityId;
            const statusIcon =
              r.status === 'completed'
                ? 'Done'
                : r.status === 'dismissed'
                  ? 'Dismissed'
                  : '**Pending**';
            lines.push(
              `| ${r.dueDate} | ${entityName} | ${r.title} | ${statusIcon} | ${r.notes || ''} |`
            );
          }
          lines.push('');
        }

        // Portfolio History (net worth over time)
        if (portfolioHistory.snapshotCount > 0) {
          lines.push('## Portfolio History');
          lines.push(`_${portfolioHistory.snapshotCount} snapshots recorded_`);
          if (portfolioHistory.firstSnapshot && portfolioHistory.lastSnapshot) {
            lines.push(
              `- Start of period: ${fmt(portfolioHistory.firstSnapshot.totalValue)} (${portfolioHistory.firstSnapshot.date})`
            );
            lines.push(
              `- End of period: ${fmt(portfolioHistory.lastSnapshot.totalValue)} (${portfolioHistory.lastSnapshot.date})`
            );
            if (portfolioHistory.yearChange !== undefined) {
              const sign = portfolioHistory.yearChange >= 0 ? '+' : '';
              lines.push(
                `- **Change: ${sign}${fmt(portfolioHistory.yearChange)} (${sign}${portfolioHistory.yearChangePercent?.toFixed(1)}%)**`
              );
            }
          }
          if (portfolioHistory.quarterlySnapshots.length > 0) {
            lines.push('');
            lines.push('| Quarter | Date | Portfolio Value |');
            lines.push('|---------|------|----------------|');
            for (const q of portfolioHistory.quarterlySnapshots) {
              lines.push(`| ${q.quarter} | ${q.date} | ${fmt(q.totalValue)} |`);
            }
          }
          lines.push('');
        }

        // Tax Summary
        lines.push('## Tax Summary');
        lines.push('');
        lines.push('### Income');
        lines.push('| Source | Amount |');
        lines.push('|--------|--------|');
        if (taxSummary.wages > 0) lines.push(`| W-2 Wages | ${fmt(taxSummary.wages)} |`);
        if (taxSummary.interestIncome !== 0)
          lines.push(`| Interest Income | ${fmt(taxSummary.interestIncome)} |`);
        if (taxSummary.dividends.ordinary > 0) {
          lines.push(`| Dividends (ordinary) | ${fmt(taxSummary.dividends.ordinary)} |`);
          if (taxSummary.dividends.qualified > 0)
            lines.push(`|   ↳ Qualified | ${fmt(taxSummary.dividends.qualified)} |`);
        }
        if (taxSummary.scheduleCIncome > 0)
          lines.push(`| Schedule C (Self-Employment) | ${fmt(taxSummary.scheduleCIncome)} |`);
        if (taxSummary.k1Income !== 0)
          lines.push(`| K-1 Income (partnerships) | ${fmt(taxSummary.k1Income)} |`);
        if (taxSummary.capitalGains.total !== 0 || taxSummary.cryptoCapitalGains.total !== 0) {
          const combinedTotal = taxSummary.capitalGains.total + taxSummary.cryptoCapitalGains.total;
          const combinedST =
            taxSummary.capitalGains.shortTerm + taxSummary.cryptoCapitalGains.shortTerm;
          const combinedLT =
            taxSummary.capitalGains.longTerm + taxSummary.cryptoCapitalGains.longTerm;
          lines.push(`| Capital Gains (net) | ${fmt(combinedTotal)} |`);
          if (combinedST !== 0) lines.push(`|   ↳ Short-term | ${fmt(combinedST)} |`);
          if (combinedLT !== 0) lines.push(`|   ↳ Long-term | ${fmt(combinedLT)} |`);
          if (taxSummary.cryptoCapitalGains.total !== 0)
            lines.push(
              `|   ↳ Crypto gains included | ${fmt(taxSummary.cryptoCapitalGains.total)} |`
            );
        }
        if (taxSummary.taxablePension !== 0)
          lines.push(`| Taxable Pension/401(k) (1099-R) | ${fmt(taxSummary.taxablePension)} |`);
        if (taxSummary.taxableIRA !== 0)
          lines.push(`| Taxable IRA Distributions | ${fmt(taxSummary.taxableIRA)} |`);
        if (taxSummary.stakingIncome !== 0)
          lines.push(`| Crypto Staking Interest | ${fmt(taxSummary.stakingIncome)} |`);
        if (taxSummary.miscIncome !== 0)
          lines.push(`| Other Income | ${fmt(taxSummary.miscIncome)} |`);
        lines.push(`| **Estimated Total Income** | **${fmt(taxSummary.estimatedTotalIncome)}** |`);
        lines.push('');

        lines.push('### Deductions & Adjustments');
        lines.push('| Adjustment | Amount |');
        lines.push('|------------|--------|');
        if (taxSummary.seTaxDeduction > 0)
          lines.push(`| SE Tax Deduction (50%) | ${fmt(taxSummary.seTaxDeduction)} |`);
        if (taxSummary.retirementDeduction > 0)
          lines.push(`| Retirement Plan (Solo 401k) | ${fmt(taxSummary.retirementDeduction)} |`);
        lines.push(`| **Total Adjustments** | **${fmt(taxSummary.estimatedAdjustments)}** |`);
        lines.push('');
        lines.push(`**Estimated AGI: ${fmt(taxSummary.estimatedAGI)}**`);
        lines.push('');

        if (taxSummary.seTax > 0) {
          lines.push('### Self-Employment Tax');
          const seBase = taxSummary.scheduleCIncome + taxSummary.k1SEEarnings;
          lines.push(`- Schedule C: ${fmt(taxSummary.scheduleCIncome)}`);
          if (taxSummary.k1SEEarnings !== 0)
            lines.push(`- K-1 SE Earnings (1 per entity): ${fmt(taxSummary.k1SEEarnings)}`);
          lines.push(`- Net SE Earnings (× 0.9235): ${fmt(seBase * 0.9235)}`);
          lines.push(`- SE Tax (15.3%): ${fmt(taxSummary.seTax)}`);
          lines.push(`- SE Tax Deduction (50%): ${fmt(taxSummary.seTaxDeduction)}`);
          lines.push('');
        }

        if (taxSummary.federalWithheld > 0) {
          lines.push('### Withholding');
          for (const w of taxSummary.w2Details) {
            lines.push(`- ${w.employer}: ${fmt(w.withheld)} withheld on ${fmt(w.wages)} wages`);
          }
          lines.push(`- **Total Federal Withholding: ${fmt(taxSummary.federalWithheld)}**`);
          lines.push('');
        }

        lines.push('### Estimated Tax Payments (Next Year)');
        lines.push(`_${taxSummary.estimatedPayments.note}_`);
        lines.push('| Quarter | Due Date |');
        lines.push('|---------|----------|');
        for (const q of taxSummary.estimatedPayments.quarterly) {
          lines.push(`| ${q.label} | ${q.due} |`);
        }
        lines.push('');

        // Form 2210 Annualized Income Periods
        if (Object.keys(form2210Periods).length > 0) {
          lines.push('## Form 2210 — Annualized Income Periods');
          lines.push(
            '_Cumulative bank deposits through each period cutoff for the annualized income installment method._'
          );
          lines.push('');
          for (const [entityId, data] of Object.entries(form2210Periods)) {
            const entityName = entitySummaries[entityId]?.entity.name || entityId;
            lines.push(`### ${entityName}`);
            lines.push('| Period | Cumulative Deposits | Revenue | Owner Contributions |');
            lines.push('|--------|--------------------:|--------:|--------------------:|');
            for (const p of data.periods) {
              lines.push(
                `| ${p.label} | ${fmt(p.cumulativeDeposits)} | ${fmt(p.cumulativeRevenue)} | ${p.cumulativeOwnerContributions > 0 ? fmt(p.cumulativeOwnerContributions) : '—'} |`
              );
            }
            lines.push('');
          }
        }

        // Portfolio Summary / Net Worth
        lines.push('## Portfolio Summary (Net Worth)');
        lines.push('| Asset Class | Value |');
        lines.push('|-------------|-------|');
        if (portfolioSummary.brokerage > 0)
          lines.push(`| Brokerage Accounts | ${fmt(portfolioSummary.brokerage)} |`);
        if (portfolioSummary.crypto > 0)
          lines.push(`| Cryptocurrency | ${fmt(portfolioSummary.crypto)} |`);
        if (portfolioSummary.preciousMetals > 0)
          lines.push(`| Precious Metals | ${fmt(portfolioSummary.preciousMetals)} |`);
        if (portfolioSummary.property > 0)
          lines.push(`| Property (Equity) | ${fmt(portfolioSummary.property)} |`);
        if (portfolioSummary.bankAccounts !== 0)
          lines.push(`| Bank Accounts | ${fmt(portfolioSummary.bankAccounts)} |`);
        lines.push(`| **Total Net Worth** | **${fmt(portfolioSummary.totalNetWorth)}** |`);
        lines.push('');

        return new Response(lines.join('\n'), {
          headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
        });
      }

      return jsonResponse(snapshot);
    } catch (err) {
      return jsonResponse(
        { error: 'Failed to generate financial snapshot', details: String(err) },
        500
      );
    }
  }

  // ========================================================================
  // Reminders API
  // ========================================================================

  return null;
}
