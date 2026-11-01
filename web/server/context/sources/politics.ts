import { promises as fs } from 'fs';
import path from 'path';
import { DATA_DIR } from '../../data.js';
import { createLogger } from '../../logger.js';
import { loadPoliticsFeedPayload } from '../../politics/feed-store.js';
import { buildPoliticsTradeDigest } from '../../politics/news-digest.js';
import type { BillRecord, ExecutiveActionRecord, TradeRecord } from '../../politics/types.js';
import { ReadCollector, windowTest } from '../request.js';
import type { ContextSource } from '../types.js';

const log = createLogger('Context');

export const politicsSource: ContextSource = {
  id: 'politics',
  label: 'Politics',
  group: 'politics',
  description:
    'Congressional and executive-branch stock trades (grouped into consensus clusters, notable ' +
    'single trades and a collapsed tail), bills with their latest action and CRS summary, and ' +
    'executive orders and actions.',
  files: [
    '.docvault-politics.json',
    '.docvault-politics-backtest.json',
    '.docvault-legislators.json',
    '.docvault-filings',
  ],
  async read(req) {
    const r = new ReadCollector();
    const inWindow = windowTest(req);
    await r.part('politics/feed', async () => {
      const feed = await loadPoliticsFeedPayload();
      const bills = ((feed.bills as BillRecord[] | undefined) ?? []).filter((b) =>
        inWindow(b.latestActionDate ?? b.introducedDate ?? b.updateDate)
      );
      for (const b of bills) {
        const parts = [`${b.officialId}: ${b.title}`];
        if (b.latestAction) parts.push(`Action: ${b.latestAction}`);
        if (b.summary)
          parts.push(`CRS summary: ${b.summary.replace(/\s+/g, ' ').trim().slice(0, 900)}`);
        r.lines.push(`${parts.join(' — ')}.`);
      }
      const eos = ((feed.executiveActions as ExecutiveActionRecord[] | undefined) ?? []).filter(
        (a) => inWindow(a.issuedDate)
      );
      for (const a of eos) {
        r.lines.push(`${a.type.replace(/_/g, ' ')}: ${a.title} (${a.issuedDate}).`);
      }
      const trades = (feed.trades as { trades?: TradeRecord[] } | TradeRecord[] | undefined) ?? [];
      const tradeList = Array.isArray(trades) ? trades : (trades.trades ?? []);
      // Tiered digest (consensus clusters, notable individuals, collapsed tail)
      // rather than one line per transaction, so several members moving the
      // same name leads instead of being buried under Treasury bills.
      const tradeDigest = buildPoliticsTradeDigest(tradeList, {
        since: req.since.slice(0, 10),
        today: req.today,
        standingDays: req.purpose === 'weekly' ? 30 : 7,
      });
      r.lines.push(...tradeDigest.lines);
      log.info(
        `[read] politics/trades window=${tradeDigest.windowStart}` +
          `${tradeDigest.standing ? ' (standing)' : ''} disclosed=${tradeDigest.counts.disclosed} ` +
          `members=${tradeDigest.counts.members} clusters=${tradeDigest.counts.clusters} ` +
          `notable=${tradeDigest.counts.notable} tail=${tradeDigest.counts.tail}`
      );
    });
    if (!req.full && req.purpose !== 'query') return r.result();
    await r.part('politics/backtest', async () => {
      const bt = await readOptionalJson<{
        generatedAt?: string;
        leaderboard?: Array<{
          politician?: string;
          buyCount?: number;
          returnPct?: number;
          winRate?: number;
        }>;
      }>(path.join(DATA_DIR, '.docvault-politics-backtest.json'));
      // returnPct and winRate are fractions (0.43 is 43%), checked against the stored file.
      const top = (bt?.leaderboard ?? [])
        .filter((x) => typeof x.returnPct === 'number')
        .sort((a, b) => (b.returnPct ?? 0) - (a.returnPct ?? 0))
        .slice(0, 5);
      if (!top.length) return;
      r.lines.push(
        `Copy-trade backtest (${(bt?.generatedAt ?? '').slice(0, 10)}), best returns: ` +
          top
            .map(
              (x) =>
                `${x.politician} ${((x.returnPct ?? 0) * 100).toFixed(1)}% over ${x.buyCount ?? 0} buys` +
                (typeof x.winRate === 'number' ? `, ${Math.round(x.winRate * 100)}% winners` : '')
            )
            .join('; ') +
          '.'
      );
    });
    await r.part('politics/archive', async () => {
      const legislators = await readOptionalJson<unknown>(
        path.join(DATA_DIR, '.docvault-legislators.json')
      );
      const count = (legislators as { entries?: unknown[] } | null)?.entries?.length ?? 0;
      let filings = 0;
      try {
        filings = (await fs.readdir(path.join(DATA_DIR, '.docvault-filings'))).length;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
      if (count || filings) {
        r.lines.push(
          `Politics records: ${count} legislators in the directory, ${filings} archived disclosure filing folder(s).`
        );
      }
    });
    return r.result();
  },
};

async function readOptionalJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}
