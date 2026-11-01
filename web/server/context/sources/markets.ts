import { promises as fs } from 'fs';
import { QUANT_SNAPSHOTS_FILE, loadSnapshots } from '../../data.js';
import { listResearchEntries } from '../../routes/research.js';
import { loadQuantCache } from '../../routes/quant.js';
import { fetchTickerPrices } from '../../ticker-prices.js';
import { ReadCollector, windowPhrase } from '../request.js';
import type { ContextSource } from '../types.js';

const last = <T>(a: readonly T[] | undefined): T | undefined =>
  a && a.length ? a[a.length - 1] : undefined;

export const marketSignalsSource: ContextSource = {
  id: 'market-signals',
  label: 'Market signals',
  group: 'markets',
  description:
    'Cached market signals: crypto Fear & Greed with its 30-day average, Bitcoin distance below ' +
    'its all-time high, the altcoin season index, and the highest-volume prediction market per topic.',
  files: ['.docvault-quant-cache.json', '.docvault-quant-snapshots.json'],
  async read(req) {
    const r = new ReadCollector();
    // Read-only: never triggers a network refresh.
    await r.part('markets/quant', async () => {
      const q = await loadQuantCache();
      const fg = q.fearGreed?.data?.latest;
      if (fg) {
        const ma = q.fearGreed?.data?.ma30;
        r.lines.push(
          `Crypto Fear & Greed: ${fg.value}/100 (${fg.classification})${
            typeof ma === 'number' ? `, 30-day avg ${Math.round(ma)}` : ''
          }.`
        );
      }
      const dd = q.btcDrawdown?.data?.latest;
      if (dd) {
        // No absolute price here: the watchlist quote is the single source of
        // BTC's spot price; printing this signal's (often staler) price too
        // produced two different BTC prices in the same edition.
        r.lines.push(
          `Bitcoin ${Math.abs(dd.drawdown * 100).toFixed(1)}% below its all-time high ` +
            `of $${Math.round(dd.ath).toLocaleString()}, ${dd.daysSinceAth}d past the peak.`
        );
      }
      const alt = q.altcoinSeason?.data;
      if (alt) {
        r.lines.push(
          `Altcoin Season Index ${alt.indexValue}/100 (${alt.regime.replace(/-/g, ' ')}); ` +
            `BTC 90-day return ${(alt.btcReturn90d * 100).toFixed(0)}%.`
        );
      }
      const preds = q.predictions?.data;
      if (preds) {
        const all = [...(preds.finance ?? []), ...(preds.politics ?? [])]
          .filter((m) => typeof m.probability === 'number')
          .sort((a, b) => (b.volumeUsd ?? 0) - (a.volumeUsd ?? 0));
        // One market per topic, highest volume first. Raw volume ranking
        // surfaces six election markets and nothing else.
        const byTopic = new Map<string, (typeof all)[number]>();
        for (const m of all) {
          const key = m.topic || m.question;
          if (!byTopic.has(key)) byTopic.set(key, m);
        }
        for (const m of [...byTopic.values()].slice(0, 6)) {
          r.lines.push(
            `Prediction (${m.source}, ${m.topic}): "${m.question}" — ${Math.round(m.probability)}% yes.`
          );
        }
      }
    });
    if (req.purpose === 'query') {
      // The daily signal snapshots, raw: too bulky for a newspaper digest,
      // useful when someone asks how a signal moved.
      await r.part('markets/quant-history', async () => {
        const file = JSON.parse(await fs.readFile(QUANT_SNAPSHOTS_FILE, 'utf-8')) as {
          snapshots?: Array<Record<string, unknown> & { date?: string }>;
        };
        const days = (file.snapshots ?? []).filter(
          (s) => s.date && s.date >= req.since.slice(0, 10) && (!req.until || s.date <= req.until)
        );
        for (const s of days.slice(-14)) {
          const { date, takenAt: _takenAt, ...signals } = s;
          r.lines.push(`Signals ${date}: ${JSON.stringify(signals).slice(0, 900)}`);
        }
      });
    }
    return r.result();
  },
};

const METALS_SYMBOLS = ['GLD', 'SLV'] as const;
const METALS_LABEL: Record<string, string> = { GLD: 'Gold (GLD)', SLV: 'Silver (SLV)' };

export const marketQuotesSource: ContextSource = {
  id: 'market-quotes',
  label: 'Market quotes',
  group: 'markets',
  description:
    'Spot quotes with one-year change: gold and silver (GLD, SLV) and the watchlist, which is ' +
    'every ticker tagged on finance research entries.',
  files: ['.docvault-ticker-cache.json'],
  async read() {
    const r = new ReadCollector();
    // The owner holds physical metals, so metals get a market line of their own
    // rather than surfacing only as a balance-sheet holdings count.
    await r.part('markets/metals', async () => {
      const { quotes } = await fetchTickerPrices([...METALS_SYMBOLS]);
      const spot = quotes
        .filter((q) => q && q.price != null)
        .map(
          (q) =>
            `${METALS_LABEL[q.symbol] ?? q.symbol} ` +
            `$${q.price!.toLocaleString(undefined, { maximumFractionDigits: 2 })}` +
            (q.oneYearChangePct != null
              ? ` (${q.oneYearChangePct >= 0 ? '+' : ''}${q.oneYearChangePct.toFixed(0)}% 1y)`
              : '')
        );
      if (spot.length) r.lines.push(`Precious metals spot: ${spot.join(', ')}.`);
    });
    // Metals proxies are excluded from the watchlist: they have their own line.
    await r.part('markets/tickers', async () => {
      const finance = await listResearchEntries('finance');
      const symbols = [...new Set(finance.flatMap((e) => e.tickers ?? []))]
        .filter((s) => !METALS_SYMBOLS.includes(s as (typeof METALS_SYMBOLS)[number]))
        .slice(0, 10);
      if (!symbols.length) return;
      const { quotes } = await fetchTickerPrices(symbols);
      const movers = quotes
        .filter((q) => q && q.price != null)
        .map(
          (q) =>
            `${q.symbol} $${q.price!.toLocaleString(undefined, { maximumFractionDigits: 2 })}` +
            (q.oneYearChangePct != null
              ? ` (${q.oneYearChangePct >= 0 ? '+' : ''}${q.oneYearChangePct.toFixed(0)}% 1y)`
              : '')
        );
      if (movers.length) r.lines.push(`Watchlist: ${movers.join(', ')}.`);
    });
    return r.result();
  },
};

export const netWorthSource: ContextSource = {
  id: 'net-worth',
  label: 'Net worth',
  group: 'markets',
  description:
    'The daily portfolio history: total net worth and each sleeve (crypto, brokerage, bank cash, ' +
    'precious metals, property equity), reported as the move over the window.',
  files: ['.docvault-portfolio-snapshots-*.json'],
  async read(req) {
    const r = new ReadCollector();
    // Baseline = the first snapshot on/after the window start, not merely the
    // previous one, which for a weekly would report one overnight move as the
    // whole week's story.
    await r.part('markets/snapshots', async () => {
      const snaps = (await loadSnapshots())
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date))
        .filter((s) => !req.until || s.date <= req.until);
      const cur = last(snaps);
      const sinceDate = req.since.slice(0, 10);
      let base = snaps.find((s) => s.date >= sinceDate);
      // A baseline more than 25% off its next snapshot is almost certainly a
      // bad (partially loaded) snapshot: step forward one.
      if (base) {
        const nxt = snaps[snaps.indexOf(base) + 1];
        if (
          nxt &&
          base.totalValue > 0 &&
          Math.abs(nxt.totalValue - base.totalValue) / base.totalValue > 0.25
        ) {
          base = nxt;
        }
      }
      if (!cur || !base || base === cur || base.totalValue <= 0) return;
      const delta = cur.totalValue - base.totalValue;
      const pct = Math.abs((delta / base.totalValue) * 100);
      const span = windowPhrase(req);
      r.lines.push(
        `Portfolio net worth ${delta >= 0 ? 'up' : 'down'} ${pct.toFixed(1)}% ${span} ` +
          `($${Math.round(base.totalValue).toLocaleString()} on ${base.date} → ` +
          `$${Math.round(cur.totalValue).toLocaleString()} on ${cur.date}).`
      );
      // Every sleeve that composes totalValue (scheduler.ts), so the parts
      // reconcile to the net-worth move above.
      const sleeves: Array<[string, number | undefined, number | undefined]> = [
        ['crypto', base.cryptoValue, cur.cryptoValue],
        ['brokerage', base.brokerValue, cur.brokerValue],
        ['cash', base.bankValue, cur.bankValue],
        ['precious metals', base.goldValue, cur.goldValue],
        ['real estate equity', base.propertyValue, cur.propertyValue],
      ];
      const moves = sleeves
        .filter(([, b, c]) => typeof b === 'number' && b > 0 && typeof c === 'number')
        .map(([name, b, c]) => {
          const d = (c as number) - (b as number);
          const p = (d / (b as number)) * 100;
          const move = Math.abs(p) < 0.5 ? 'flat' : `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`;
          return (
            `${name} ${move} ` +
            `($${Math.round(b as number).toLocaleString()} → $${Math.round(c as number).toLocaleString()})`
          );
        });
      if (moves.length) r.lines.push(`By asset class ${span}: ${moves.join('; ')}.`);
    });
    return r.result();
  },
};
