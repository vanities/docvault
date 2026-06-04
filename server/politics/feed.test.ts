// Politics ingest — pure-logic tests (no network, no personal data). Fixtures are
// synthetic/public congressional payloads.

import { describe, expect, test } from 'vite-plus/test';
import { fetchRecentBills, inferBillStatus, transformBill } from './congress-bills.js';
import { transformExecutiveAction } from './federal-register.js';
import {
  appendNew,
  buildFeedPayload,
  emptyPoliticsCache,
  mergeBills,
  upsertByKey,
} from './feed-store.js';
import { ingestHousePtr, parseHouseDisclosureIndex, parseHousePtrText } from './house-ptr.js';
import { inferOgeTicker } from './oge-asset-normalization.js';
import { parseOge278Transactions } from './oge-parser.js';
import { parseReportDataRows, parseSenatePtrHtml } from './senate-ptr.js';
import { filterTrades, mergeTrades, topSpenders } from './feed-store.js';
import type { BillRecord, TradeRecord } from './types.js';

/** Minimal fake `fetch` that replays a queue of JSON bodies, one per call. */
function fakeFetch(bodies: unknown[]): typeof fetch {
  let i = 0;
  return (async () => {
    const body = bodies[Math.min(i, bodies.length - 1)];
    i++;
    return { ok: true, status: 200, json: async () => body } as Response;
  }) as unknown as typeof fetch;
}

describe('inferBillStatus', () => {
  test('detects signings, vetoes, and passage', () => {
    expect(inferBillStatus('Became Public Law No: 119-1.')).toBe('signed');
    expect(inferBillStatus('Signed by President.')).toBe('signed');
    expect(inferBillStatus('Vetoed by President.')).toBe('vetoed');
    expect(inferBillStatus('Passed House. Passed Senate with amendment.')).toBe('passed_both');
    expect(inferBillStatus('Passed/agreed to in House.')).toBe('passed_chamber');
    expect(inferBillStatus('Referred to the Committee on Ways and Means.')).toBe('committee');
    expect(inferBillStatus('Introduced in House.')).toBe('introduced');
    expect(inferBillStatus(undefined)).toBe('introduced');
  });
});

describe('transformBill', () => {
  test('builds stable ids and a human official id', () => {
    const bill = transformBill({
      congress: 119,
      type: 'HR',
      number: '3076',
      title: 'Postal Service Reform Act',
      updateDate: '2026-06-03',
      latestAction: { actionDate: '2026-06-02', text: 'Became Public Law No: 119-1.' },
      url: 'https://api.congress.gov/v3/bill/119/hr/3076',
    });
    expect(bill.externalId).toBe('hr-3076-119');
    expect(bill.officialId).toBe('HR 3076');
    expect(bill.status).toBe('signed');
  });
});

describe('transformExecutiveAction', () => {
  test('maps subtype to action type and prefers the EO-number slug', () => {
    const eo = transformExecutiveAction({
      document_number: '2026-12345',
      title: 'Establishing the National AI Initiative',
      type: 'Presidential Document',
      subtype: 'Executive Order',
      publication_date: '2026-06-01',
      signing_date: '2026-05-30',
      executive_order_number: '14200',
      html_url: 'https://www.federalregister.gov/d/2026-12345',
    });
    expect(eo.slug).toBe('eo-14200');
    expect(eo.type).toBe('executive_order');
    expect(eo.issuedDate).toBe('2026-05-30'); // signing_date wins over publication_date

    const memo = transformExecutiveAction({
      document_number: '2026-99999',
      title: 'Memorandum on Trade',
      type: 'Presidential Document',
      subtype: 'Memorandum',
      publication_date: '2026-06-02',
    });
    expect(memo.slug).toBe('fr-2026-99999'); // no EO number → fr- slug
    expect(memo.type).toBe('signing_statement');
  });
});

describe('fetchRecentBills (forward-only)', () => {
  test('stops at the cursor and reports the new high-water mark', async () => {
    const page = {
      bills: [
        {
          congress: 119,
          type: 'HR',
          number: '10',
          title: 'New A',
          updateDate: '2026-06-03',
          url: 'u',
        },
        {
          congress: 119,
          type: 'S',
          number: '20',
          title: 'New B',
          updateDate: '2026-06-02',
          url: 'u',
        },
        {
          congress: 119,
          type: 'HR',
          number: '5',
          title: 'Old',
          updateDate: '2026-05-01',
          url: 'u',
        },
      ],
    };
    const { bills, newestUpdateDate } = await fetchRecentBills({
      apiKey: 'k',
      sinceUpdateDate: '2026-06-01',
      fetchFn: fakeFetch([page]),
    });
    expect(bills.map((b) => b.externalId)).toEqual(['hr-10-119', 's-20-119']); // 'Old' is at/under cursor
    expect(newestUpdateDate).toBe('2026-06-03');
  });

  test('collects everything when there is no cursor', async () => {
    const page = {
      bills: [
        { congress: 119, type: 'HR', number: '10', title: 'A', updateDate: '2026-06-03', url: 'u' },
        { congress: 119, type: 'S', number: '20', title: 'B', updateDate: '2026-06-02', url: 'u' },
      ],
    };
    const { bills } = await fetchRecentBills({ apiKey: 'k', fetchFn: fakeFetch([page]) });
    expect(bills).toHaveLength(2);
  });
});

describe('merge helpers', () => {
  const mk = (id: string, date: string): BillRecord => ({
    externalId: id,
    officialId: id.toUpperCase(),
    title: id,
    type: 'hr',
    status: 'introduced',
    introducedDate: null,
    latestAction: null,
    latestActionDate: null,
    updateDate: date,
    url: null,
  });

  test('upsertByKey replaces by key, sorts newest-first, caps', () => {
    const existing = [mk('a', '2026-01-01'), mk('b', '2026-02-01')];
    const incoming = [mk('a', '2026-03-01')]; // 'a' updated → should replace + move to front
    const merged = upsertByKey(
      existing,
      incoming,
      (b) => b.externalId,
      (b) => b.updateDate,
      10
    );
    expect(merged.map((b) => b.externalId)).toEqual(['a', 'b']);
    expect(merged[0].updateDate).toBe('2026-03-01');
  });

  test('appendNew prepends only genuinely-new keys', () => {
    const existing = ['x', 'y'];
    const incoming = ['y', 'z']; // only 'z' is new
    const merged = appendNew(existing, incoming, (s) => s, 10);
    expect(merged).toEqual(['z', 'x', 'y']);
  });
});

describe('parseHouseDisclosureIndex', () => {
  test('parses the tab-separated index and flags PTRs (FilingType P)', () => {
    const text = [
      'Prefix\tLast\tFirst\tSuffix\tFilingType\tStateDst\tYear\tFilingDate\tDocID',
      'Hon.\tPublic\tJohn\t\tP\tCA01\t2026\t1/20/2026\t20030001',
      'Hon.\tDoe\tJane\t\tO\tNY02\t2026\t1/10/2026\t10030002',
    ].join('\n');
    const rows = parseHouseDisclosureIndex(text);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ docId: '20030001', isPtr: true, filingDate: '2026-01-20' });
    expect(rows[1].isPtr).toBe(false); // 'O' = annual FD, not a PTR
  });
});

describe('parseHousePtrText', () => {
  test('extracts ticker, owner, category, dates, and amount from a PTR line', () => {
    // Blank line between rows mirrors real pdftotext -layout output (the line
    // directly after a transaction is treated as a wrapped asset-name continuation).
    const text = [
      'Name: John Q Public',
      'SP  Apple Inc (AAPL) [ST]  P  01/15/2026  01/20/2026  $1,001 - $15,000',
      '',
      'Microsoft Corporation (MSFT) [ST]  S  02/01/2026  02/03/2026  $15,001 - $50,000',
    ].join('\n');
    const trades = parseHousePtrText(text, {
      docId: '20030001',
      filingYear: 2026,
      filingDate: '2026-02-10',
      filingUrl: 'https://example/ptr.pdf',
    });
    expect(trades).toHaveLength(2);
    expect(trades[0]).toMatchObject({
      politicianName: 'John Q Public',
      owner: 'SP',
      ticker: 'AAPL',
      assetName: 'Apple Inc',
      category: 'buy',
      tradeDate: '2026-01-15',
      amountMin: 1001,
      amountMax: 15000,
      chamber: 'house',
      source: 'house-ptr',
    });
    expect(trades[1]).toMatchObject({ ticker: 'MSFT', category: 'sell', owner: null });
  });
});

describe('ingestHousePtr (forward-only)', () => {
  test('first run bounds to the recent window, parses PTRs, seeds the rest as seen', async () => {
    const indexText = [
      'Prefix\tLast\tFirst\tSuffix\tFilingType\tStateDst\tYear\tFilingDate\tDocID',
      'Hon.\tPublic\tJohn\t\tP\tCA01\t2026\t1/20/2026\t20030001', // in window
      'Hon.\tOld\tSam\t\tP\tTX03\t2026\t1/02/2026\t20030003', // older → seeded-seen, not parsed
      'Hon.\tDoe\tJane\t\tO\tNY02\t2026\t1/10/2026\t10030002', // not a PTR
    ].join('\n');
    const ptrText =
      'Name: John Q Public\nApple Inc (AAPL) [ST]  P  01/15/2026  01/18/2026  $1,001 - $15,000';

    const fetchFn = (async (input: URL | string) => {
      const u = String(input);
      if (u.includes('/financial-pdfs/') && u.endsWith('FD.txt')) {
        return { ok: true, status: 200, text: async () => indexText } as Response;
      }
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) } as Response;
    }) as unknown as typeof fetch;

    const cache = emptyPoliticsCache();
    const result = await ingestHousePtr(cache, {
      fetchFn,
      extractText: async () => ptrText,
      now: new Date('2026-01-22T00:00:00Z'),
      firstRunDays: 7,
    });

    expect(result.added).toBe(1); // only the in-window PTR parsed
    expect(cache.trades[0].ticker).toBe('AAPL');
    expect(cache.cursors.houseYear).toBe(2026);
    // Both PTR docIds are now seen (the older one was seeded without parsing).
    expect(cache.seen.houseDocIds.sort()).toEqual(['20030001', '20030003']);
  });
});

describe('OGE-278-T parser', () => {
  test('parseOge278Transactions extracts sequence, type, date, and amount band', () => {
    const text = [
      '1 Apple Inc Common Stock Purchase 03/15/2026 $1,001 - $15,000',
      '2 Microsoft Corp Common Stock Sale 04/01/2026 $15,001 - $50,000',
    ].join('\n');
    const txns = parseOge278Transactions(text, 2026);
    expect(txns).toHaveLength(2);
    expect(txns[0]).toMatchObject({
      sequence: 1,
      transactionType: 'purchase',
      tradeDate: '2026-03-15',
      amount: '$1,001 - $15,000',
    });
    expect(txns[1]).toMatchObject({ sequence: 2, transactionType: 'sale' });
  });

  test('inferOgeTicker maps known issuers and screens out debt instruments', () => {
    expect(inferOgeTicker('Apple Inc Common Stock', 'ST')).toBe('AAPL');
    expect(inferOgeTicker('NVIDIA CORP', 'ST')).toBe('NVDA');
    expect(inferOgeTicker('UNITED STATES TREAS BILL DUE 2030', 'BOND')).toBeNull();
    expect(inferOgeTicker('MORGAN STANLEY 04.250% DUE 041530', null)).toBeNull();
  });
});

describe('Senate eFD parsers', () => {
  test('parseReportDataRows splits electronic PTRs from scanned paper filings', () => {
    const rows = parseReportDataRows([
      [
        'James',
        'Banks',
        'James Banks (Senator)',
        '<a href="/search/view/ptr/abc-123/">View</a>',
        '04/20/2026',
      ],
      [
        'Richard',
        'Blumenthal',
        '—',
        '<a href="/search/view/paper/def-456/">View</a>',
        '05/19/2026',
      ],
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      reportKind: 'ptr',
      filingDocId: 'abc-123',
      filingDate: '2026-04-20',
    });
    expect(rows[1]).toMatchObject({ reportKind: 'paper', filingDocId: 'def-456' });
  });

  test('parseSenatePtrHtml extracts ticker/category/amount from the transactions table', () => {
    const html = `
      <h3>Transactions</h3>
      <table><tbody>
        <tr>
          <td>1</td><td>04/15/2026</td><td>Self</td>
          <td><a href="https://finance.yahoo.com/quote/SBUX">SBUX</a></td>
          <td>Starbucks Corporation - Common Stock</td><td>Stock</td>
          <td>Sale (Full)</td><td>$1,001 - $15,000</td><td>--</td>
        </tr>
      </tbody></table>`;
    const trades = parseSenatePtrHtml(html, {
      filingDocId: 'abc-123',
      filerName: 'James Banks',
      filingDate: '2026-04-20',
      filingYear: 2026,
      filingUrl: 'https://efdsearch.senate.gov/search/view/ptr/abc-123/',
    });
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({
      chamber: 'senate',
      source: 'senate-ptr',
      ticker: 'SBUX',
      category: 'sell',
      tradeDate: '2026-04-15',
      amountMin: 1001,
      amountMax: 15000,
    });
  });
});

describe('mergeTrades per-source cap', () => {
  test('keeps every house trade and caps a high-volume OGE filer to 250', () => {
    const mk = (source: string, n: number): TradeRecord[] =>
      Array.from({ length: n }, (_, i) => ({
        externalId: `${source}:${i}`,
        source,
        chamber: source === 'oge-278t' ? 'executive' : 'house',
        politicianName: 'X',
        filerName: 'X',
        owner: null,
        assetName: 'A',
        ticker: null,
        assetType: null,
        transactionType: 'P',
        transactionDescription: 'Purchase',
        category: 'buy',
        // Descending dates so ordering is deterministic.
        tradeDate: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
        filingDate: null,
        amount: null,
        amountRange: null,
        amountMin: null,
        amountMax: null,
        filingDocId: null,
        filingYear: 2026,
        filingUrl: null,
        sourceUrl: null,
      }));
    const cache = emptyPoliticsCache();
    mergeTrades(cache, [...mk('house-ptr', 3), ...mk('oge-278t', 700)]);
    const counts = cache.trades.reduce<Record<string, number>>((acc, t) => {
      acc[t.source] = (acc[t.source] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts['house-ptr']).toBe(3); // congressional trades never crowded out
    expect(counts['oge-278t']).toBe(600); // Trump's bond churn capped (per-source OGE cap)
  });
});

describe('topSpenders + filterTrades', () => {
  const trade = (over: Partial<TradeRecord>): TradeRecord => ({
    externalId: Math.random().toString(36).slice(2),
    source: 'house-ptr',
    chamber: 'house',
    politicianName: 'X',
    filerName: 'X',
    owner: null,
    assetName: 'A',
    ticker: null,
    assetType: null,
    transactionType: 'P',
    transactionDescription: 'Purchase',
    category: 'buy',
    tradeDate: '2026-01-01',
    filingDate: null,
    amount: null,
    amountRange: null,
    amountMin: 0,
    amountMax: 0,
    filingDocId: null,
    filingYear: 2026,
    filingUrl: null,
    sourceUrl: null,
    ...over,
  });

  const cache = emptyPoliticsCache();
  mergeTrades(cache, [
    trade({
      politicianName: 'Nancy Pelosi',
      ticker: 'NVDA',
      category: 'buy',
      amountMax: 250000,
      tradeDate: '2026-05-01',
    }),
    trade({
      politicianName: 'Nancy Pelosi',
      ticker: 'AAPL',
      category: 'sell',
      amountMax: 50000,
      tradeDate: '2026-05-10',
    }),
    trade({
      politicianName: 'Some Senator',
      chamber: 'senate',
      source: 'senate-ptr',
      ticker: 'TSLA',
      amountMax: 15000,
      tradeDate: '2026-04-01',
    }),
  ]);

  test('topSpenders ranks by upper-bound dollar volume with buy/sell split', () => {
    const spenders = topSpenders(cache, 10);
    expect(spenders[0]).toMatchObject({
      politician: 'Nancy Pelosi',
      trades: 2,
      buys: 1,
      sells: 1,
      estMax: 300000,
      lastTradeDate: '2026-05-10',
    });
    expect(spenders[0].tickers.sort()).toEqual(['AAPL', 'NVDA']);
    expect(spenders[1].politician).toBe('Some Senator');
  });

  test('filterTrades narrows by politician (substring) and chamber', () => {
    expect(filterTrades(cache, { politician: 'pelosi' })).toHaveLength(2);
    expect(filterTrades(cache, { chamber: 'senate' })).toHaveLength(1);
    expect(filterTrades(cache, { politician: 'pelosi', category: 'buy' })[0].ticker).toBe('NVDA');
  });
});

describe('buildFeedPayload', () => {
  test('maps bills into the vote shape the existing Politics consumers read', () => {
    const cache = emptyPoliticsCache();
    cache.generatedAt = '2026-06-04T00:00:00Z';
    mergeBills(cache, [
      transformBill({
        congress: 119,
        type: 'HR',
        number: '3076',
        title: 'Postal Service Reform Act',
        updateDate: '2026-06-03',
        latestAction: { actionDate: '2026-06-02', text: 'Became Public Law No: 119-1.' },
        url: 'u',
      }),
    ]);

    const payload = buildFeedPayload(cache, { jobs: [] }) as {
      ok: boolean;
      configured: boolean;
      votes: { votes: Array<Record<string, unknown>> };
      bills: unknown[];
      executiveActions: unknown[];
    };

    expect(payload.configured).toBe(true);
    expect(payload.ok).toBe(true);
    const vote = payload.votes.votes[0];
    expect((vote.bill as { title: string }).title).toBe('Postal Service Reform Act');
    expect((vote.bill as { officialId: string }).officialId).toBe('HR 3076');
    expect(vote.billTitle).toBe('Postal Service Reform Act');
    expect(vote.question).toBe('Became Public Law No: 119-1.');
    expect(vote.externalId).toBe('hr-3076-119');
    expect(payload.bills).toHaveLength(1);
    expect(payload.executiveActions).toHaveLength(0);
  });
});
