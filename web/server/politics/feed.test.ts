// Politics ingest — pure-logic tests (no network, no personal data). Fixtures are
// synthetic/public congressional payloads.

import { describe, expect, test } from 'vite-plus/test';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { listFilings, resetArchiveCache } from './filing-archive.js';
import {
  cleanSummaryHtml,
  enrichBillSummaries,
  fetchBillSummary,
  fetchRecentBills,
  inferBillStatus,
  transformBill,
} from './congress-bills.js';
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
import { buildResolverFromEntries, localHeadshotUrl } from './legislators.js';
import {
  filterTrades,
  mergeTrades,
  monthlyBuySell,
  recentMonths,
  topSpenders,
} from './feed-store.js';
import type { BillRecord, TradeRecord } from './types.js';

/** Minimal fake `fetch` that replays a queue of JSON bodies, one per call. */
function fakeFetch(bodies: unknown[], urls: string[] = []): typeof fetch {
  let i = 0;
  return (async (input: RequestInfo | URL) => {
    urls.push(String(input));
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

describe('Congress bill summaries', () => {
  test('cleans Congress.gov summary HTML into plain text', () => {
    expect(
      cleanSummaryHtml(
        '<p><strong>Retirement Fairness Act</strong></p><p>This bill lets charities &amp; schools pool plans.<br/>It applies in 2026.</p>'
      )
    ).toBe(
      'Retirement Fairness Act This bill lets charities & schools pool plans. It applies in 2026.'
    );
    expect(cleanSummaryHtml('<p>Safe invalid entity: &#99999999; &#x110000;</p>')).toBe(
      'Safe invalid entity: &#99999999; &#x110000;'
    );
  });

  test('fetches the latest official CRS summary for a bill', async () => {
    const urls: string[] = [];
    const summary = await fetchBillSummary({
      apiKey: 'k',
      congress: 119,
      billType: 'HR',
      billNumber: '10',
      billTitle: 'Retirement Fairness Act',
      fetchFn: fakeFetch(
        [
          {
            summaries: [
              {
                text: '<p><strong>Retirement Fairness Act</strong></p><p>This bill expands plan access.</p>',
                actionDate: '2026-06-01',
                updateDate: '2026-06-02T12:00:00Z',
              },
            ],
          },
        ],
        urls
      ),
    });

    expect(urls[0]).toContain('/bill/119/hr/10/summaries');
    expect(summary).toEqual({
      text: 'This bill expands plan access.',
      actionDate: '2026-06-01',
      updateDate: '2026-06-02T12:00:00Z',
    });
  });

  test('enriches missing summaries in cached bills without touching populated ones', async () => {
    const bills = [
      transformBill({
        congress: 119,
        type: 'S',
        number: '20',
        title: 'School Nutrition Act',
        updateDate: '2026-06-03',
        url: 'u',
      }),
      {
        ...transformBill({
          congress: 119,
          type: 'HR',
          number: '10',
          title: 'Already Done',
          updateDate: '2026-06-02',
          url: 'u',
        }),
        summary: 'Existing',
      },
    ];

    const result = await enrichBillSummaries(bills, {
      apiKey: 'k',
      maxFetches: 5,
      fetchFn: fakeFetch([
        {
          summaries: [
            {
              text: '<p><strong>School Nutrition Act</strong></p><p>This bill funds meals.</p>',
              actionDate: '2026-06-01',
              updateDate: '2026-06-02T12:00:00Z',
            },
          ],
        },
      ]),
    });

    expect(result).toEqual({ fetched: 1, populated: 1 });
    expect(bills[0]).toMatchObject({
      summary: 'This bill funds meals.',
      summarySource: 'congress-crs',
      summaryActionDate: '2026-06-01',
      summaryUpdatedAt: '2026-06-02T12:00:00Z',
    });
    expect(typeof bills[0].summaryCheckedAt).toBe('string');
    expect(bills[1].summary).toBe('Existing');
  });
});

describe('merge helpers', () => {
  const mk = (id: string, date: string): BillRecord => ({
    externalId: id,
    congress: 119,
    number: id.replace(/\D/g, '') || '1',
    officialId: id.toUpperCase(),
    title: id,
    type: 'hr',
    status: 'introduced',
    introducedDate: null,
    latestAction: null,
    latestActionDate: null,
    summary: null,
    summarySource: null,
    summaryActionDate: null,
    summaryCheckedAt: null,
    summaryUpdatedAt: null,
    updateDate: date,
    url: null,
  });

  test('mergeBills preserves cached CRS summary metadata across bill updates', () => {
    const cache = emptyPoliticsCache();
    const existing = {
      ...mk('hr-10-119', '2026-06-01'),
      title: 'Original title',
      summary: 'Existing CRS summary',
      summarySource: 'congress-crs' as const,
      summaryActionDate: '2026-05-30',
      summaryCheckedAt: '2026-06-02T00:00:00.000Z',
      summaryUpdatedAt: '2026-06-01T12:00:00Z',
    };
    const incoming = {
      ...mk('hr-10-119', '2026-06-03'),
      title: 'Updated title',
      latestAction: 'Reported by committee.',
      latestActionDate: '2026-06-03',
    };
    cache.bills = [existing];

    mergeBills(cache, [incoming]);

    expect(cache.bills).toHaveLength(1);
    expect(cache.bills[0]).toMatchObject({
      title: 'Updated title',
      updateDate: '2026-06-03',
      summary: 'Existing CRS summary',
      summarySource: 'congress-crs',
      summaryActionDate: '2026-05-30',
      summaryCheckedAt: '2026-06-02T00:00:00.000Z',
      summaryUpdatedAt: '2026-06-01T12:00:00Z',
    });
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

  test('captures the DESCRIPTION field + parses the option contract (call/strike/expiry)', () => {
    // Mirrors real -layout output: "DESCRIPTION:" renders as "D    :" a few lines
    // below the transaction, and the expiry wraps onto the next line.
    const text = [
      'Name: Hon. Nancy Pelosi',
      '   SP   Alphabet Inc. - Class A Common   P   12/30/2025  12/30/2025   $250,001 - $500,000',
      '        Stock (GOOGL) [OP]',
      '        F      S      : New',
      '        D           : Purchased 20 call options with a strike price of $150 and an expiration date',
      '        of 1/15/27.',
      '   SP   Amazon.com, Inc. - Common Stock   S   12/24/2025  12/24/2025   $1,000,001 - $5,000,000',
      '        (AMZN) [ST]',
      '        D           : Sold 20,000 shares.',
    ].join('\n');
    const trades = parseHousePtrText(text, {
      docId: '20033725',
      filingYear: 2026,
      filingDate: '2026-01-20',
      filingUrl: 'https://example/ptr.pdf',
    });
    expect(trades).toHaveLength(2);
    expect(trades[0].ticker).toBe('GOOGL');
    expect(trades[0].description).toBe(
      'Purchased 20 call options with a strike price of $150 and an expiration date of 1/15/27.'
    );
    expect(trades[0].option).toEqual({
      optionType: 'call',
      action: 'purchase',
      contracts: 20,
      strike: 150,
      expiry: '2027-01-15',
      shares: null,
    });
    // A plain share-sale description is captured but yields no option contract.
    expect(trades[1].description).toBe('Sold 20,000 shares.');
    expect(trades[1].option).toBeNull();
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

  test('backfill re-scans filings already in the seen ledger', async () => {
    const indexText = [
      'Prefix\tLast\tFirst\tSuffix\tFilingType\tStateDst\tYear\tFilingDate\tDocID',
      'Hon.\tPublic\tJohn\t\tP\tCA01\t2026\t1/20/2026\t20030001',
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
    cache.cursors.houseYear = 2026; // not a first run
    cache.seen.houseDocIds = ['20030001']; // already seed-skipped as seen
    const result = await ingestHousePtr(cache, {
      backfill: true,
      fetchFn,
      extractText: async () => ptrText,
      now: new Date('2026-06-01T00:00:00Z'),
    });

    expect(result.added).toBe(1); // parsed despite being in the seen ledger
    expect(cache.trades[0].ticker).toBe('AAPL');
  });

  test('archives each fetched filing (PDF + text + metadata) to disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'docvault-ingest-archive-'));
    process.env.DOCVAULT_FILINGS_DIR = dir;
    resetArchiveCache();
    try {
      const indexText = [
        'Prefix\tLast\tFirst\tSuffix\tFilingType\tStateDst\tYear\tFilingDate\tDocID',
        'Hon.\tPublic\tJohn\t\tP\tCA01\t2026\t1/20/2026\t20030009',
      ].join('\n');
      const ptrText =
        'Name: John Q Public\nApple Inc (AAPL) [ST]  P  01/15/2026  01/18/2026  $1,001 - $15,000';
      const pdfBytes = new TextEncoder().encode('%PDF-1.4 mock filing bytes').buffer;
      const fetchFn = (async (input: URL | string) => {
        const u = String(input);
        if (u.endsWith('FD.txt')) {
          return { ok: true, status: 200, text: async () => indexText } as Response;
        }
        return { ok: true, status: 200, arrayBuffer: async () => pdfBytes } as Response;
      }) as unknown as typeof fetch;

      const cache = emptyPoliticsCache();
      await ingestHousePtr(cache, {
        fetchFn,
        extractText: async () => ptrText,
        archive: true, // opt in despite the injected extractText
        now: new Date('2026-01-22T00:00:00Z'),
        firstRunDays: 7,
      });

      const archived = await listFilings();
      expect(archived).toHaveLength(1);
      expect(archived[0]).toMatchObject({
        docId: '20030009',
        source: 'house-ptr',
        chamber: 'house',
        parseMethod: 'text',
        tradeCount: 1,
        hasPdf: true,
      });
    } finally {
      delete process.env.DOCVAULT_FILINGS_DIR;
      resetArchiveCache();
      await rm(dir, { recursive: true, force: true });
    }
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

describe('monthly buy/sell series', () => {
  const t = (category: string, tradeDate: string): TradeRecord => ({
    externalId: `${category}-${tradeDate}`,
    source: 'house-ptr',
    chamber: 'house',
    politicianName: 'X',
    filerName: 'X',
    owner: null,
    assetName: 'A',
    ticker: null,
    assetType: null,
    transactionType: 'P',
    transactionDescription: 'x',
    category: category as TradeRecord['category'],
    tradeDate,
    filingDate: null,
    amount: null,
    amountRange: null,
    amountMin: null,
    amountMax: null,
    filingDocId: null,
    filingYear: 2026,
    filingUrl: null,
    sourceUrl: null,
  });

  test('recentMonths returns N months ending at the anchor, oldest first', () => {
    expect(recentMonths('2026-03', 4)).toEqual(['2025-12', '2026-01', '2026-02', '2026-03']);
  });

  test('monthlyBuySell buckets buys/sells by month and ignores other categories', () => {
    const trades = [
      t('buy', '2026-03-10'),
      t('buy', '2026-03-20'),
      t('sell', '2026-02-05'),
      t('other', '2026-03-01'), // bonds etc. — not counted
    ];
    expect(monthlyBuySell(trades, recentMonths('2026-03', 3))).toEqual([
      { m: '2026-01', b: 0, s: 0 },
      { m: '2026-02', b: 0, s: 1 },
      { m: '2026-03', b: 2, s: 0 },
    ]);
  });
});

describe('headshot resolver (fuzzy name match)', () => {
  const entries = [
    { bioguide: 'P000197', first: 'Nancy', last: 'Pelosi', official: 'Nancy Pelosi' },
    // Senator's `first` is the nickname "Dave"; disclosures use legal "David".
    { bioguide: 'M001243', first: 'Dave', last: 'McCormick', official: 'David McCormick' },
    { bioguide: 'M001218', first: 'Rich', last: 'McCormick', official: 'Richard McCormick' },
    {
      bioguide: 'R000605',
      first: 'Mike',
      last: 'Rounds',
      official: 'Mike Rounds',
      nickname: 'Mike',
    },
    { bioguide: 'S001234', first: 'John', last: 'Smith', official: 'John Smith' },
    { bioguide: 'S005678', first: 'Jane', last: 'Smith', official: 'Jane Smith' },
  ];
  const resolve = buildResolverFromEntries(entries);

  test('matches Hon.-prefixed names, drops middle initials, uses legal first names', () => {
    expect(resolve('Hon. Nancy Pelosi')).toBe(localHeadshotUrl('P000197'));
    // "David H McCormick" → the senator (legal first via official name), not Rep. Rich McCormick.
    expect(resolve('David H McCormick')).toBe(localHeadshotUrl('M001243'));
  });

  test('falls back to a unique last name', () => {
    expect(resolve('M. Michael Rounds')).toBe(localHeadshotUrl('R000605'));
  });

  test('returns null for ambiguous last names and unmatched non-members', () => {
    expect(resolve('Pat Smith')).toBeNull(); // two Smiths → ambiguous
    expect(resolve('Jane Q Nobody')).toBeNull(); // not in the set
  });

  test('one-off: Trump (no bioguide) resolves to his Wikimedia portrait', () => {
    expect(resolve('Donald J. Trump')).toBe(localHeadshotUrl('TRUMP'));
    expect(resolve('Donald Trump')).toBe(localHeadshotUrl('TRUMP'));
  });
});

describe('buildFeedPayload', () => {
  test('maps bills into the vote shape the existing Politics consumers read', () => {
    const cache = emptyPoliticsCache();
    cache.generatedAt = '2026-06-04T00:00:00Z';
    const bill = transformBill({
      congress: 119,
      type: 'HR',
      number: '3076',
      title: 'Postal Service Reform Act',
      updateDate: '2026-06-03',
      latestAction: { actionDate: '2026-06-02', text: 'Became Public Law No: 119-1.' },
      url: 'u',
    });
    bill.summary = 'This bill reforms postal operations.';
    bill.summarySource = 'congress-crs';
    mergeBills(cache, [bill]);

    const payload = buildFeedPayload(cache, { jobs: [] }) as unknown as {
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
    expect(vote.summary).toBe('This bill reforms postal operations.');
    expect((vote.bill as { summary: string }).summary).toBe('This bill reforms postal operations.');
    expect(vote.externalId).toBe('hr-3076-119');
    expect(payload.bills).toHaveLength(1);
    expect(payload.executiveActions).toHaveLength(0);
  });
});
