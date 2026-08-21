// Politics trade digest — pure-logic tests. Synthetic trades and fabricated
// member names only; no personal data.

import { describe, expect, test } from 'vite-plus/test';
import {
  buildPoliticsTradeDigest,
  classifyTradeAsset,
  disclosureDate,
  tradeNotability,
} from './news-digest.js';
import type { TradeRecord } from './types.js';

let seq = 0;
function trade(
  p: Partial<TradeRecord> & { politicianName: string; tradeDate: string }
): TradeRecord {
  seq += 1;
  const category = p.category ?? 'buy';
  return {
    externalId: p.externalId ?? `t-${seq}`,
    source: p.source ?? 'house-ptr',
    chamber: p.chamber ?? 'house',
    politicianName: p.politicianName,
    filerName: p.politicianName,
    owner: null,
    assetName: p.assetName ?? `${p.ticker ?? 'Some'} Holdings Inc`,
    ticker: p.ticker ?? null,
    // `in` rather than `??`: real filings carry an explicitly NULL assetType
    // (untyped bank CDs, muni paper), and that null must reach the classifier
    // instead of being coalesced into the equity default.
    assetType: 'assetType' in p ? (p.assetType ?? null) : 'ST',
    transactionType: category === 'buy' ? 'P' : 'S',
    transactionDescription: category === 'buy' ? 'Purchase' : 'Sale',
    category,
    tradeDate: p.tradeDate,
    filingDate: 'filingDate' in p ? (p.filingDate ?? null) : p.tradeDate,
    amount: p.amount ?? null,
    amountRange: p.amountRange ?? null,
    amountMin: p.amountMin ?? null,
    amountMax: p.amountMax ?? null,
    filingDocId: null,
    filingYear: 2026,
    filingUrl: null,
    sourceUrl: null,
    description: p.description ?? null,
    option: p.option ?? null,
  };
}

/** Fabricated members with distinct first+last names — identity collapsing is
 *  by first+last, so fixtures must look like real filer names. */
const MEMBERS = ['Hon. Alex Rivera', 'Hon. Blair Chen', 'Hon. Casey Nolan', 'Hon. Devon Okafor'];

/** N distinct members buying the same ticker — the consensus shape. */
function consensus(ticker: string, dates: string[], filingDate: string): TradeRecord[] {
  return dates.map((d, i) =>
    trade({
      politicianName: MEMBERS[i],
      ticker,
      tradeDate: d,
      filingDate,
      amountMin: 15_001,
      amountMax: 50_000,
    })
  );
}

describe('classifyTradeAsset', () => {
  test('reads the filer asset-type code first', () => {
    expect(
      classifyTradeAsset(trade({ politicianName: 'A', tradeDate: '2026-05-01', assetType: 'ST' }))
    ).toBe('equity');
    expect(
      classifyTradeAsset(trade({ politicianName: 'A', tradeDate: '2026-05-01', assetType: 'GS' }))
    ).toBe('fixed-income');
    expect(
      classifyTradeAsset(
        trade({ politicianName: 'A', tradeDate: '2026-05-01', assetType: 'Municipal Security' })
      )
    ).toBe('fixed-income');
  });

  test('sniffs untyped bank CDs and municipal paper into fixed income', () => {
    const cd = trade({
      politicianName: 'A',
      tradeDate: '2026-05-01',
      assetType: null,
      assetName: 'Acme Bank N A INSTL CTF DEP ACT/365 4.200% MAT',
    });
    expect(classifyTradeAsset(cd)).toBe('fixed-income');

    const bill = trade({
      politicianName: 'A',
      tradeDate: '2026-05-01',
      assetType: 'GS',
      assetName: 'U.S. Tres Bill Int. Rate 0.00% Mat 8/5/2027',
    });
    expect(classifyTradeAsset(bill)).toBe('fixed-income');
  });

  test('a parsed option contract wins over the type code', () => {
    const opt = trade({
      politicianName: 'A',
      tradeDate: '2026-05-01',
      ticker: 'ACME',
      assetType: 'ST',
      option: {
        optionType: 'call',
        action: 'purchase',
        contracts: 50,
        strike: 40,
        expiry: '2027-01-15',
        shares: null,
      },
    });
    expect(classifyTradeAsset(opt)).toBe('option');
  });

  test('an untyped, untickered, unrecognized asset is "other"', () => {
    const odd = trade({
      politicianName: 'A',
      tradeDate: '2026-05-01',
      assetType: 'OT',
      assetName: 'Generic Senior Loan Fund LP',
    });
    expect(classifyTradeAsset(odd)).toBe('other');
  });
});

describe('tradeNotability', () => {
  test('fixed income and unidentified assets never score', () => {
    const bond = trade({
      politicianName: 'A',
      tradeDate: '2026-05-01',
      assetType: 'GS',
      amountMax: 25_000_000,
    });
    expect(tradeNotability(bond)).toBe(0);
  });

  test('a bigger disclosed band outranks a smaller one', () => {
    const big = trade({
      politicianName: 'A',
      tradeDate: '2026-05-01',
      ticker: 'ACME',
      amountMax: 5_000_000,
    });
    const small = trade({
      politicianName: 'B',
      tradeDate: '2026-05-01',
      ticker: 'ACME',
      amountMax: 15_000,
    });
    expect(tradeNotability(big)).toBeGreaterThan(tradeNotability(small));
  });

  test('an option contract outranks a same-size plain equity trade', () => {
    const shares = trade({
      politicianName: 'A',
      tradeDate: '2026-05-01',
      ticker: 'ACME',
      amountMax: 50_000,
    });
    const calls = trade({
      politicianName: 'B',
      tradeDate: '2026-05-01',
      ticker: 'ACME',
      amountMax: 50_000,
      option: {
        optionType: 'call',
        action: 'purchase',
        contracts: 10,
        strike: 40,
        expiry: '2027-01-15',
        shares: null,
      },
    });
    expect(tradeNotability(calls)).toBeGreaterThan(tradeNotability(shares));
  });
});

describe('disclosureDate', () => {
  test('prefers the filing date — a trade is news when its PTR lands', () => {
    const t = trade({ politicianName: 'A', tradeDate: '2026-05-01', filingDate: '2026-06-14' });
    expect(disclosureDate(t)).toBe('2026-06-14');
  });

  test('falls back to the trade date and rejects garbage', () => {
    expect(
      disclosureDate(trade({ politicianName: 'A', tradeDate: '2026-05-01', filingDate: null }))
    ).toBe('2026-05-01');
    expect(
      disclosureDate(trade({ politicianName: 'A', tradeDate: 'unknown', filingDate: null }))
    ).toBeNull();
  });
});

describe('buildPoliticsTradeDigest', () => {
  const OPTS = { since: '2026-06-14', today: '2026-06-14' };

  test('leads with a consensus line when several members trade the same ticker', () => {
    const d = buildPoliticsTradeDigest(
      consensus('ACME', ['2026-06-01', '2026-06-05', '2026-06-09'], '2026-06-14'),
      OPTS
    );
    expect(d.counts.clusters).toBe(1);
    expect(d.lines[0]).toContain('CONSENSUS BUY');
    expect(d.lines[0]).toContain('3 members bought ACME');
    expect(d.lines[0]).toContain('Hon. Alex Rivera');
    expect(d.standing).toBe(false);
  });

  test('names each consensus member with their chamber', () => {
    // Regression: without the chamber the editor infers one, and published a
    // House member as a Senator (two different McCormicks sit in the chambers).
    const mixed = [
      trade({
        politicianName: 'Hon. Alex Rivera',
        chamber: 'house',
        ticker: 'ACME',
        tradeDate: '2026-06-01',
        filingDate: '2026-06-14',
      }),
      trade({
        politicianName: 'Blair Chen',
        chamber: 'senate',
        ticker: 'ACME',
        tradeDate: '2026-06-05',
        filingDate: '2026-06-14',
      }),
      trade({
        politicianName: 'Donald Q. Public',
        chamber: 'executive',
        ticker: 'ACME',
        tradeDate: '2026-06-09',
        filingDate: '2026-06-14',
      }),
    ];
    const d = buildPoliticsTradeDigest(mixed, OPTS);
    expect(d.counts.clusters).toBe(1);
    expect(d.lines[0]).toContain('Hon. Alex Rivera (House)');
    expect(d.lines[0]).toContain('Blair Chen (Senate)');
    expect(d.lines[0]).toContain('Donald Q. Public (executive branch)');
  });

  test('a cluster with nothing newly disclosed does NOT surface', () => {
    // All three filed well before the window — old news, already reported.
    const d = buildPoliticsTradeDigest(
      consensus('ACME', ['2026-04-01', '2026-04-05', '2026-04-09'], '2026-04-10'),
      { since: '2026-06-14', today: '2026-06-14', standingDays: 7 }
    );
    expect(d.counts.clusters).toBe(0);
  });

  test('two members are not consensus — the default floor is three', () => {
    const d = buildPoliticsTradeDigest(
      consensus('ACME', ['2026-06-01', '2026-06-05'], '2026-06-14'),
      OPTS
    );
    expect(d.counts.clusters).toBe(0);
  });

  test('a trade counted in a consensus line is not repeated as NOTABLE', () => {
    const cluster = consensus('ACME', ['2026-06-01', '2026-06-05', '2026-06-09'], '2026-06-14');
    // Make one of them enormous so it would otherwise top the notable ranking.
    cluster[0].amountMax = 25_000_000;
    const d = buildPoliticsTradeDigest(cluster, OPTS);
    expect(d.counts.clusters).toBe(1);
    expect(d.counts.notable).toBe(0);
    expect(d.lines.filter((l) => l.startsWith('NOTABLE'))).toHaveLength(0);
  });

  test('ranks notable individual trades by size and names the disclosure lag', () => {
    const d = buildPoliticsTradeDigest(
      [
        trade({
          politicianName: 'Sen Alpha',
          chamber: 'senate',
          ticker: 'ACME',
          category: 'sell',
          tradeDate: '2026-05-02',
          filingDate: '2026-06-14',
          amount: '$5,000,001 - $25,000,000',
          amountMax: 25_000_000,
        }),
        trade({
          politicianName: 'Rep Beta',
          ticker: 'ZENO',
          tradeDate: '2026-06-10',
          filingDate: '2026-06-14',
          amount: '$1,001 - $15,000',
          amountMax: 15_000,
        }),
      ],
      OPTS
    );
    expect(d.counts.notable).toBe(2);
    expect(d.lines[0]).toContain('NOTABLE — Sen Alpha (Senate) sold ACME');
    expect(d.lines[0]).toContain('traded 2026-05-02, disclosed 2026-06-14');
    expect(d.lines[1]).toContain('Rep Beta');
  });

  test('fixed income is collapsed into the tail, never promoted to NOTABLE', () => {
    const d = buildPoliticsTradeDigest(
      [
        trade({
          politicianName: 'Rep Gamma',
          assetType: 'GS',
          assetName: 'U.S. Tres Bill Mat 8/5/2027',
          tradeDate: '2026-06-12',
          filingDate: '2026-06-14',
          amountMax: 250_000,
        }),
        trade({
          politicianName: 'Rep Gamma',
          assetType: 'Municipal Security',
          assetName: 'Springfield GO Bds Ser A',
          tradeDate: '2026-06-12',
          filingDate: '2026-06-14',
          amountMax: 1_000_000,
        }),
      ],
      OPTS
    );
    expect(d.counts.notable).toBe(0);
    expect(d.counts.tail).toBe(2);
    const tailLine = d.lines.find((l) => l.startsWith('Also disclosed'));
    expect(tailLine).toContain('2 further transactions');
    expect(tailLine).toContain('2 fixed-income');
  });

  test('widens to a standing window and labels it when nothing landed in the edition window', () => {
    // Regression: PTRs arrive in bursts, so a strict 24h window used to empty
    // and drop the whole Politics desk out of the edition.
    const d = buildPoliticsTradeDigest(
      consensus('ACME', ['2026-06-01', '2026-06-03', '2026-06-05'], '2026-06-10'),
      { since: '2026-06-14', today: '2026-06-14', standingDays: 7 }
    );
    expect(d.standing).toBe(true);
    expect(d.windowStart).toBe('2026-06-07');
    expect(d.counts.disclosed).toBe(3);
    expect(d.lines[0]).toContain('NOT new today');
    expect(d.lines.some((l) => l.startsWith('CONSENSUS BUY'))).toBe(true);
  });

  test('a weekly edition widens further than a daily one', () => {
    const trades = consensus('ACME', ['2026-05-20', '2026-05-22', '2026-05-24'], '2026-05-25');
    const daily = buildPoliticsTradeDigest(trades, {
      since: '2026-06-14',
      today: '2026-06-14',
      standingDays: 7,
    });
    const weekly = buildPoliticsTradeDigest(trades, {
      since: '2026-06-14',
      today: '2026-06-14',
      standingDays: 30,
    });
    expect(daily.counts.disclosed).toBe(0);
    expect(weekly.counts.disclosed).toBe(3);
  });

  test('caps NOTABLE per member so one liquidation cannot take every slot', () => {
    // One member dumping six positions on one day used to fill the whole tier.
    const dump = ['ACME', 'ZENO', 'ORBI', 'VELA', 'NUMI', 'KETO'].map((ticker) =>
      trade({
        politicianName: 'Hon. Casey Nolan',
        ticker,
        category: 'sell',
        tradeDate: '2026-03-10',
        filingDate: '2026-06-14',
        amountMax: 50_000,
      })
    );
    const other = trade({
      politicianName: 'Hon. Alex Rivera',
      ticker: 'WYND',
      tradeDate: '2026-06-10',
      filingDate: '2026-06-14',
      amountMax: 15_000,
    });
    const d = buildPoliticsTradeDigest([...dump, other], OPTS);
    const notableLines = d.lines.filter((l) => l.startsWith('NOTABLE'));
    expect(notableLines.filter((l) => l.includes('Casey Nolan'))).toHaveLength(2);
    // The other member still gets heard, and the remainder is counted in the tail.
    expect(notableLines.some((l) => l.includes('Alex Rivera'))).toBe(true);
    expect(d.counts.tail).toBe(4);
  });

  test('drops a stale cluster that only a single late filing resurrected', () => {
    // Three members traded a year ago; one filed late today. That is a late
    // disclosure, not today's consensus.
    const old = consensus('ACME', ['2025-06-01', '2025-06-10', '2025-06-20'], '2025-06-25');
    old[0] = { ...old[0], filingDate: '2026-06-14' };
    const d = buildPoliticsTradeDigest(old, { ...OPTS, maxClusterAgeDays: 180 });
    expect(d.counts.clusters).toBe(0);
    // It is still reported, just as an individual disclosure rather than consensus.
    expect(d.counts.notable).toBe(1);
  });

  test('returns no lines at all when there is genuinely nothing to report', () => {
    const d = buildPoliticsTradeDigest([], OPTS);
    expect(d.lines).toEqual([]);
    expect(d.counts.disclosed).toBe(0);
  });
});
