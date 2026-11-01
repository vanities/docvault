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
  files: ['.docvault-politics.json'],
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
    return r.result();
  },
};
