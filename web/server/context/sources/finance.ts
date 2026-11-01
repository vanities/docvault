import { promises as fs } from 'fs';
import {
  BROKER_ACTIVITIES_FILE,
  BROKER_CACHE_FILE,
  CRYPTO_CACHE_FILE,
  loadAssets,
  loadContributions,
  loadEstimatedTaxes,
  loadFederalTax,
  loadGoldData,
  loadIncomeData,
  loadMileageData,
  loadPropertyData,
  loadSalesData,
  loadSnapshots,
  type EstimatedTaxPayment,
} from '../../data.js';
import { getLatestStrategy } from '../../routes/strategy.js';
import { ReadCollector, windowTest } from '../request.js';
import type { ContextRequest, ContextSource } from '../types.js';

/** The tax year a request is about: the year of its today. */
const taxYearOf = (req: ContextRequest) => Number(req.today.slice(0, 4));

/** Estimated-tax and contribution stores are keyed by `entity/year`
 *  ("personal/2026", "consulting-llc/2025"); some legacy data uses a bare year.
 *  Totals span every entity, the way the financial snapshot adds them up. */
export function bucketsForYear<T>(data: Record<string, T>, year: number): T[] {
  const y = String(year);
  return Object.entries(data)
    .filter(([k]) => k === y || k.endsWith(`/${y}`))
    .map(([, v]) => v);
}

/** The estimated-tax state line: paid to date against the target, which
 *  quarters are paid, and the next UNPAID installment's deadline. Skipping paid
 *  quarters matters: a calendar-only "next deadline" reported Q3 as due after
 *  Q3 was paid, and the editor wrote a shortfall headline against the cash
 *  balance. Deadlines: Apr 15, Jun 15, Sep 15, and Jan 15 of the next year. */
export function describeEstimatedTaxState(
  buckets: { payments?: EstimatedTaxPayment[]; config?: { annualTarget?: number } }[],
  taxYear: number,
  now: Date = new Date()
): string | null {
  if (!buckets.length) return null;
  const payments = buckets.flatMap((b) => b.payments ?? []);
  const paid = payments.reduce((s, p) => s + p.amount, 0);
  const target = buckets.reduce((s, b) => s + (b.config?.annualTarget ?? 0), 0);
  const paidQuarters = new Set(payments.map((p) => p.quarter));
  const deadlines: [1 | 2 | 3 | 4, string][] = [
    [1, `${taxYear}-04-15`],
    [2, `${taxYear}-06-15`],
    [3, `${taxYear}-09-15`],
    [4, `${taxYear + 1}-01-15`],
  ];
  const t = now.getTime();
  const next = deadlines.find(
    ([q, d]) => !paidQuarters.has(q) && new Date(`${d}T23:59:59`).getTime() >= t
  );
  const paidList = deadlines.filter(([q]) => paidQuarters.has(q)).map(([q]) => `Q${q}`);
  let schedule = '';
  if (paidList.length === 4) schedule = '; all 4 installments paid';
  else {
    if (paidList.length) schedule += `; ${paidList.join(', ')} paid`;
    if (next) schedule += `; next unpaid installment Q${next[0]} due ${next[1]}`;
  }
  return (
    `Estimated taxes ${taxYear}: $${Math.round(paid).toLocaleString()} paid` +
    (target > 0
      ? ` of $${Math.round(target).toLocaleString()} target (${Math.round((paid / target) * 100)}%)`
      : '') +
    schedule +
    '.'
  );
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export const salesSource: ContextSource = {
  id: 'sales',
  label: 'Sales',
  group: 'finance',
  description: 'Product sales logged in the window: count, dollar total and which products.',
  files: ['.docvault-sales.json'],
  async read(req) {
    const r = new ReadCollector();
    await r.part('finance/sales', async () => {
      const sales = await loadSalesData();
      const productName = new Map(sales.products.map((p) => [p.id, p.name]));
      const recent = sales.sales.filter((s) => windowTest(req)(s.date));
      if (!recent.length) return;
      const total = recent.reduce((sum, s) => sum + (s.total ?? 0), 0);
      const products = [
        ...new Set(recent.map((s) => productName.get(s.productId) ?? 'item')),
      ].slice(0, 5);
      r.lines.push(
        `${recent.length} sale${recent.length === 1 ? '' : 's'} totaling ` +
          `$${total.toLocaleString()} (${products.join(', ')}).`
      );
    });
    return r.result();
  },
};

export const mileageSource: ContextSource = {
  id: 'mileage',
  label: 'Business mileage',
  group: 'finance',
  description: 'Business trips logged in the window, total miles and the deductible amount.',
  files: ['.docvault-mileage.json'],
  async read(req) {
    const r = new ReadCollector();
    await r.part('finance/mileage', async () => {
      const mileage = await loadMileageData();
      const recent = mileage.entries.filter((e) => windowTest(req)(e.date));
      if (!recent.length) return;
      const miles = recent.reduce((s, e) => s + (e.tripMiles ?? 0), 0);
      r.lines.push(
        `${recent.length} business trip${recent.length === 1 ? '' : 's'} logged, ` +
          `${miles.toFixed(0)} miles (~$${(miles * mileage.irsRate).toFixed(0)} deductible).`
      );
    });
    return r.result();
  },
};

export const strategySource: ContextSource = {
  id: 'strategy',
  label: 'Investment strategy',
  group: 'finance',
  description: 'The latest investment strategy report, in full, when it was filed in the window.',
  files: ['.docvault-strategy-history.json'],
  async read(req) {
    const r = new ReadCollector();
    await r.part('finance/strategy', async () => {
      const strat = await getLatestStrategy();
      if (strat && windowTest(req)(strat.createdAt)) {
        r.lines.push(`New investment strategy filed: ${strat.title}.`);
        r.lines.push(strat.body);
      }
    });
    return r.result();
  },
};

export const brokerActivitySource: ContextSource = {
  id: 'broker-activity',
  label: 'Brokerage activity',
  group: 'finance',
  description:
    'Trades, dividends and transfers inside the connected brokerage accounts during the window.',
  files: ['.docvault-broker-activities.json', '.docvault-broker-cache.json'],
  async read(req) {
    const r = new ReadCollector();
    await r.part('finance/broker-activity', async () => {
      let raw: string | null = null;
      try {
        raw = await fs.readFile(BROKER_ACTIVITIES_FILE, 'utf-8');
      } catch (err) {
        // The activities cache exists only once a broker integration has synced
        // activity history; absence reads as an empty feed.
        if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
      }
      const cache = raw
        ? (JSON.parse(raw) as {
            accounts?: Record<
              string,
              {
                activities?: Array<{
                  type?: string;
                  tradeDate?: string;
                  ticker?: string | null;
                  description?: string;
                  amount?: number;
                }>;
              }
            >;
          })
        : {};
      const acts = Object.values(cache.accounts ?? {})
        .flatMap((a) => a.activities ?? [])
        .filter((a) => windowTest(req)(a.tradeDate))
        .slice(0, 10);
      for (const a of acts) {
        const sym = a.ticker ?? a.description ?? 'activity';
        const amt = typeof a.amount === 'number' ? ` $${Math.abs(a.amount).toLocaleString()}` : '';
        r.lines.push(
          `Broker ${a.type ?? 'activity'}: ${sym}${amt} (${(a.tradeDate ?? '').slice(0, 10)}).`
        );
      }
      // An explicit quiet-period line beats silence, but only when brokers are
      // connected. It must say it covers only the brokerage: the 2026-11-01
      // weekly read "no trades or transfers" as "no transfer explains the cash drop".
      if (acts.length === 0 && (await fileExists(BROKER_CACHE_FILE))) {
        r.lines.push(
          'No trades, dividends or transfers inside the brokerage accounts this period ' +
            '(this says nothing about bank transfers; those are under Money Movements).'
        );
      }
    });
    return r.result();
  },
};

export const cryptoSource: ContextSource = {
  id: 'crypto',
  label: 'Crypto holdings',
  group: 'finance',
  description: 'Current crypto holdings: total value and the largest assets.',
  files: ['.docvault-crypto-cache.json'],
  async read() {
    const r = new ReadCollector();
    await r.part('finance/crypto', async () => {
      const portfolio = JSON.parse(await fs.readFile(CRYPTO_CACHE_FILE, 'utf-8')) as {
        totalUsdValue?: number;
        byAsset?: Array<{ asset?: string; usdValue?: number }>;
      };
      if (typeof portfolio.totalUsdValue !== 'number') return;
      const top = (portfolio.byAsset ?? [])
        .slice()
        .sort((a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0))
        .slice(0, 4)
        .map((b) => b.asset)
        .filter(Boolean)
        .join(', ');
      r.lines.push(
        `Crypto holdings ~$${Math.round(portfolio.totalUsdValue).toLocaleString()}${top ? ` (top: ${top})` : ''}.`
      );
    });
    return r.result();
  },
};

export const balanceSheetSource: ContextSource = {
  id: 'balance-sheet',
  label: 'Balance sheet',
  group: 'finance',
  description:
    'The latest daily portfolio total and its parts: crypto, brokerage, bank, metals and ' +
    'property equity.',
  files: ['.docvault-portfolio-snapshots-*.json'],
  async read(req) {
    const r = new ReadCollector();
    if (!req.full) return r.result();
    await r.part('finance/balance-sheet', async () => {
      const snaps = await loadSnapshots();
      const cur = snaps[snaps.length - 1];
      if (!cur) return;
      const fmt = (n?: number) => `$${Math.round(n ?? 0).toLocaleString()}`;
      const parts = [
        `crypto ${fmt(cur.cryptoValue)}`,
        `brokerage ${fmt(cur.brokerValue)}`,
        typeof cur.bankValue === 'number' ? `bank ${fmt(cur.bankValue)}` : '',
        typeof cur.goldValue === 'number' && cur.goldValue > 0
          ? `metals ${fmt(cur.goldValue)}`
          : '',
        typeof cur.propertyValue === 'number' && cur.propertyValue > 0
          ? `property equity ${fmt(cur.propertyValue)}`
          : '',
      ].filter(Boolean);
      r.lines.push(
        `Balance sheet (${cur.date}): net worth ${fmt(cur.totalValue)} — ${parts.join(', ')}.`
      );
    });
    return r.result();
  },
};

export const propertySource: ContextSource = {
  id: 'property',
  label: 'Real estate',
  group: 'finance',
  description: 'Each property with its current value and mortgage balance.',
  files: ['.docvault-property.json'],
  async read(req) {
    const r = new ReadCollector();
    if (!req.full) return r.result();
    await r.part('finance/property', async () => {
      const { entries } = await loadPropertyData();
      for (const p of entries.slice(0, 4)) {
        const mort = p.mortgage
          ? `, mortgage $${Math.round(p.mortgage.balance).toLocaleString()}`
          : '';
        r.lines.push(
          `Property: ${p.name} valued $${Math.round(p.currentValue).toLocaleString()}${mort}.`
        );
      }
    });
    return r.result();
  },
};

export const preciousMetalsSource: ContextSource = {
  id: 'precious-metals',
  label: 'Precious metals',
  group: 'finance',
  description: 'Physical precious metals on file: number of holdings and total ounces.',
  files: ['.docvault-gold.json'],
  async read(req) {
    const r = new ReadCollector();
    if (!req.full) return r.result();
    await r.part('finance/gold', async () => {
      const { entries } = await loadGoldData();
      if (!entries.length) return;
      const oz = entries.reduce((s, g) => s + (g.weightOz ?? 0) * (g.quantity ?? 0), 0);
      r.lines.push(`Precious metals: ${entries.length} holdings, ${oz.toFixed(2)} oz total.`);
    });
    return r.result();
  },
};

const PER_YEAR: Record<string, number> = {
  weekly: 52,
  biweekly: 26,
  monthly: 12,
  quarterly: 4,
  annually: 1,
};

export const incomeSource: ContextSource = {
  id: 'income',
  label: 'Income sources',
  group: 'finance',
  description: 'Recorded income sources: any added in the window, and the annualized total.',
  files: ['.docvault-income.json'],
  async read(req) {
    const r = new ReadCollector();
    await r.part('finance/income', async () => {
      const { sources } = await loadIncomeData();
      for (const s of sources.filter((x) => windowTest(req)(x.createdAt))) {
        r.lines.push(
          `New income source: ${s.name} $${Math.round(s.amount).toLocaleString()}/${s.frequency}` +
            `${s.taxable ? '' : ' (tax-free)'}.`
        );
      }
    });
    if (req.full) {
      await r.part('finance/income-state', async () => {
        const { sources } = await loadIncomeData();
        if (!sources.length) return;
        const total = sources.reduce((sum, s) => sum + s.amount * (PER_YEAR[s.frequency] ?? 1), 0);
        r.lines.push(
          `Income sources (${sources.length}): ~$${Math.round(total).toLocaleString()}/yr.`
        );
      });
    }
    return r.result();
  },
};

export const estimatedTaxesSource: ContextSource = {
  id: 'estimated-taxes',
  label: 'Estimated taxes',
  group: 'finance',
  description:
    'Estimated tax payments made in the window, and progress against the annual target with ' +
    'the next unpaid installment.',
  files: ['.docvault-estimated-taxes.json'],
  async read(req) {
    const r = new ReadCollector();
    const taxYear = taxYearOf(req);
    await r.part('finance/estimated-taxes', async () => {
      const payments = bucketsForYear(await loadEstimatedTaxes(), taxYear).flatMap(
        (b) => b.payments ?? []
      );
      for (const p of payments.filter((x) => windowTest(req)(x.date))) {
        r.lines.push(
          `Estimated tax payment: Q${p.quarter} ${taxYear} — ` +
            `$${Math.round(p.amount).toLocaleString()} paid ${p.date}.`
        );
      }
    });
    if (req.full) {
      await r.part('finance/estimated-taxes-state', async () => {
        const line = describeEstimatedTaxState(
          bucketsForYear(await loadEstimatedTaxes(), taxYear),
          taxYear
        );
        if (line) r.lines.push(line);
      });
    }
    return r.result();
  },
};

export const contributionsSource: ContextSource = {
  id: 'retirement-contributions',
  label: 'Retirement contributions',
  group: 'finance',
  description:
    'Retirement contributions made in the window, and year-to-date totals split by employee ' +
    'and employer.',
  files: ['.docvault-contributions.json'],
  async read(req) {
    const r = new ReadCollector();
    const taxYear = taxYearOf(req);
    await r.part('finance/contributions', async () => {
      const entries = bucketsForYear(await loadContributions(), taxYear).flat();
      for (const c of entries.filter((x) => windowTest(req)(x.date))) {
        r.lines.push(
          `Retirement contribution: $${Math.round(c.amount).toLocaleString()} (${c.type}) on ${c.date}.`
        );
      }
    });
    if (req.full) {
      await r.part('finance/contributions-state', async () => {
        const entries = bucketsForYear(await loadContributions(), taxYear).flat();
        if (!entries.length) return;
        const ee = entries.filter((c) => c.type === 'employee').reduce((s, c) => s + c.amount, 0);
        const er = entries.filter((c) => c.type === 'employer').reduce((s, c) => s + c.amount, 0);
        r.lines.push(
          `Retirement contributions ${taxYear}: $${Math.round(ee + er).toLocaleString()} ` +
            `(employee $${Math.round(ee).toLocaleString()}, employer $${Math.round(er).toLocaleString()}).`
        );
      });
    }
    return r.result();
  },
};

// Vehicles and equipment are not part of the net-worth snapshot, so without
// this the standing picture would leave them out entirely.
export const assetsSource: ContextSource = {
  id: 'assets',
  label: 'Other assets',
  group: 'finance',
  description: 'Vehicles, equipment and other tracked assets with their values.',
  files: ['.docvault-assets.json'],
  async read(req) {
    const r = new ReadCollector();
    if (!req.full) return r.result();
    await r.part('finance/assets', async () => {
      const assets = Object.values(await loadAssets()).flat();
      if (!assets.length) return;
      const total = assets.reduce((s, a) => s + (a.value ?? 0), 0);
      const top = assets
        .slice()
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
        .slice(0, 5)
        .map((a) => `${a.name} $${Math.round(a.value ?? 0).toLocaleString()}`);
      r.lines.push(
        `Other assets (${assets.length}, $${Math.round(total).toLocaleString()}): ${top.join(', ')}.`
      );
    });
    return r.result();
  },
};

export const federalReturnsSource: ContextSource = {
  id: 'federal-returns',
  label: 'Federal tax returns',
  group: 'finance',
  description:
    'Federal returns filed in the window, and the most recent filed return (AGI, taxable ' +
    'income, total tax).',
  files: ['.docvault-federal.json'],
  async read(req) {
    const r = new ReadCollector();
    await r.part('finance/federal-tax', async () => {
      const federal = await loadFederalTax();
      for (const [year, ret] of Object.entries(federal)) {
        if (ret.filed && ret.filedDate && windowTest(req)(ret.filedDate)) {
          const bal = ret.balance.totalOwed;
          r.lines.push(
            `Filed ${year} federal return: AGI $${Math.round(ret.agi).toLocaleString()}, ` +
              `total tax $${Math.round(ret.tax.totalTax).toLocaleString()}, ` +
              `${bal >= 0 ? 'owed' : 'refund'} $${Math.round(Math.abs(bal)).toLocaleString()}.`
          );
        }
      }
    });
    if (req.full) {
      await r.part('finance/federal-tax-state', async () => {
        const federal = await loadFederalTax();
        const year = Object.keys(federal)
          .filter((y) => federal[y].filed)
          .sort()
          .reverse()[0];
        const ret = year ? federal[year] : undefined;
        if (!ret || !year) return;
        r.lines.push(
          `Most recent filed return (${year}): AGI $${Math.round(ret.agi).toLocaleString()}, ` +
            `taxable income $${Math.round(ret.taxableIncome).toLocaleString()}, ` +
            `total tax $${Math.round(ret.tax.totalTax).toLocaleString()}.`
        );
      });
    }
    return r.result();
  },
};
