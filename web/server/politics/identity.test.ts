// Member-identity and ticker-recovery normalization — pure-logic tests.
// Fabricated member names and public fund names only; no personal data.

import { describe, expect, test } from 'vite-plus/test';
import {
  canonicalPoliticianName,
  normalizeTradesForAnalysis,
  politicianIdentityKey,
  resolveTradeTicker,
  tickerFromAssetName,
} from './identity.js';
import type { TradeRecord } from './types.js';

let seq = 0;
function trade(p: Partial<TradeRecord> & { politicianName: string }): TradeRecord {
  seq += 1;
  return {
    externalId: `t-${seq}`,
    source: 'senate-ptr',
    chamber: 'senate',
    politicianName: p.politicianName,
    filerName: p.politicianName,
    owner: null,
    assetName: p.assetName ?? 'Acme Holdings Inc',
    ticker: p.ticker ?? null,
    assetType: p.assetType ?? null,
    transactionType: 'P',
    transactionDescription: 'Purchase',
    category: p.category ?? 'buy',
    tradeDate: p.tradeDate ?? '2026-06-01',
    filingDate: p.filingDate ?? '2026-06-10',
    amount: null,
    amountRange: null,
    amountMin: null,
    amountMax: null,
    filingDocId: null,
    filingYear: 2026,
    filingUrl: null,
    sourceUrl: null,
    description: null,
    option: null,
  };
}

describe('politicianIdentityKey', () => {
  test('collapses title, middle name and suffix variants to one key', () => {
    // The real-world collision that was inflating a consensus cluster: one
    // member filing under two renderings counted as two members.
    const a = politicianIdentityKey('Hon. John McGuire');
    const b = politicianIdentityKey('Hon. John J Mr McGuire III');
    expect(a).toBe(b);
    expect(a).toBe('john mcguire');
  });

  test('ignores stray punctuation', () => {
    expect(politicianIdentityKey('Jerry Moran,')).toBe(politicianIdentityKey('Jerry Moran'));
  });

  test('keeps genuinely different members apart', () => {
    expect(politicianIdentityKey('Hon. Alex Rivera')).not.toBe(
      politicianIdentityKey('Hon. Blair Rivera')
    );
    expect(politicianIdentityKey('Hon. Alex Rivera')).not.toBe(
      politicianIdentityKey('Hon. Alex Chen')
    );
  });

  test('degrades safely on a single-token or empty name', () => {
    expect(politicianIdentityKey('Cher')).toBe('cher');
    expect(politicianIdentityKey('   ')).toBe('');
  });
});

describe('canonicalPoliticianName', () => {
  test('prefers the most frequent rendering', () => {
    const name = canonicalPoliticianName([
      'Hon. John McGuire',
      'Hon. John McGuire',
      'Hon. John J Mr McGuire III',
    ]);
    expect(name).toBe('Hon. John McGuire');
  });

  test('strips a trailing separator but keeps title and middle-initial periods', () => {
    expect(canonicalPoliticianName(['Jerry Moran,'])).toBe('Jerry Moran');
    expect(canonicalPoliticianName(['Hon. James A. Himes'])).toBe('Hon. James A. Himes');
  });

  test('breaks a frequency tie on the shortest (cleanest) rendering', () => {
    const name = canonicalPoliticianName(['Hon. John J Mr McGuire III', 'Hon. John McGuire']);
    expect(name).toBe('Hon. John McGuire');
  });
});

describe('tickerFromAssetName', () => {
  test('recovers the symbol the Senate feed leaves at the end of the name', () => {
    expect(tickerFromAssetName('Vaneck ETF Tr Gold Miners GDX')).toBe('GDX');
    expect(tickerFromAssetName('Spdr Ser Tr Aerospace & Defense XAR')).toBe('XAR');
    expect(tickerFromAssetName('Ishares Tr 10 20 Yr Treas Bd ETF TLH')).toBe('TLH');
  });

  test('refuses trailing corporate/fund boilerplate', () => {
    expect(tickerFromAssetName('Audax Senior Loan Fund ST LP')).toBeNull();
    expect(tickerFromAssetName('Acme Bank N A INSTL CTF DEP ACT/365 4.200% MAT')).toBeNull();
    expect(tickerFromAssetName('Regaero Holdings Pty Ltd Com')).toBeNull();
  });

  test('refuses anything that is not symbol-shaped', () => {
    expect(tickerFromAssetName('U.S. Tres Bill Int. Rate 0.00% Mat 8/5/2027')).toBeNull();
    expect(tickerFromAssetName('Pittsburgh, CA Successor Agency')).toBeNull();
    expect(tickerFromAssetName('ACME')).toBeNull(); // single token — nothing to anchor on
    expect(tickerFromAssetName(null)).toBeNull();
  });
});

describe('resolveTradeTicker', () => {
  test('an explicit ticker wins and is upper-cased', () => {
    expect(resolveTradeTicker(trade({ politicianName: 'Hon. Alex Rivera', ticker: 'acme' }))).toBe(
      'ACME'
    );
  });

  test('falls back to the asset name only when the field is empty', () => {
    const t = trade({
      politicianName: 'Hon. Alex Rivera',
      ticker: null,
      assetName: 'Vaneck ETF Tr Gold Miners GDX',
    });
    expect(resolveTradeTicker(t)).toBe('GDX');
  });
});

describe('normalizeTradesForAnalysis', () => {
  test('unifies name variants onto one canonical display name', () => {
    const out = normalizeTradesForAnalysis([
      trade({ politicianName: 'Hon. John McGuire' }),
      trade({ politicianName: 'Hon. John McGuire' }),
      trade({ politicianName: 'Hon. John J Mr McGuire III' }),
    ]);
    expect(new Set(out.map((t) => t.politicianName))).toEqual(new Set(['Hon. John McGuire']));
  });

  test('fills in recoverable tickers so untickered ETF rows can cluster', () => {
    const out = normalizeTradesForAnalysis([
      trade({
        politicianName: 'Hon. Alex Rivera',
        ticker: null,
        assetName: 'Spdr Ser Tr Aerospace & Defense XAR',
      }),
    ]);
    expect(out[0].ticker).toBe('XAR');
  });

  test('leaves unrecoverable rows alone and does not mutate the input', () => {
    const input = [
      trade({
        politicianName: 'Hon. Alex Rivera',
        ticker: null,
        assetName: 'U.S. Tres Bill Mat 8/5/2027',
      }),
    ];
    const before = JSON.stringify(input);
    const out = normalizeTradesForAnalysis(input);
    expect(out[0].ticker).toBeNull();
    expect(JSON.stringify(input)).toBe(before);
  });
});
