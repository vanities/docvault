// Scanned/paper House PTR recovery — deterministic tests.
//
// The hard part of these filings (Purchase/Sale + amount band) is a hand-drawn X
// in a checkbox grid, which flat OCR can't read. The extractor reads it from the
// rasterized image (gridline detection + per-cell pixel darkness); the result is
// frozen as `fleischmann-9115821.observation.json` (public congressional data).
// These tests run the PURE interpretation over that frozen observation, so they
// need no poppler/tesseract and are byte-for-byte deterministic in CI.
//
// Regenerate the fixture after extraction changes:
//   bun server/politics/fixtures/scanned/regenerate.ts

import { describe, expect, test } from 'vite-plus/test';
import observationJson from './fixtures/scanned/fleischmann-9115821.observation.json';
import harshbargerJson from './fixtures/scanned/harshbarger-9115809.observation.json';
import {
  HOUSE_AMOUNT_RANGES,
  cleanScannedAssetName,
  interpretScannedHousePtr,
  normalizeOwner,
  parseMmDdYy,
  pickCheckedCell,
  repairOcrMonth,
  tickerFromAssetTail,
  type ScanObservation,
} from './scanned-house-ptr.js';

const observation = observationJson as unknown as ScanObservation;

const CTX = {
  docId: '9115821',
  filingYear: 2026,
  filingDate: '2026-05-12',
  filerName: 'Charles J. Fleischmann',
  filingUrl: 'https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/9115821.pdf',
};

// Ground truth, established by visually reading the scanned filing (both pages).
// Every trade dated 04/28/26, notified 05/01/26, owner JT (joint).
const A = '$1,001 - $15,000';
const B = '$15,001 - $50,000';
const GROUND_TRUTH = [
  { ticker: 'SHLD', type: 'P', category: 'buy', amount: A },
  { ticker: 'IEI', type: 'S', category: 'sell', amount: A },
  { ticker: 'HYBB', type: 'S', category: 'sell', amount: B },
  { ticker: 'SPDW', type: 'S', category: 'sell', amount: A },
  { ticker: 'SPMB', type: 'S', category: 'sell', amount: A },
  { ticker: 'SPYG', type: 'P', category: 'buy', amount: A },
  { ticker: 'SPYV', type: 'P', category: 'buy', amount: A },
  { ticker: 'SDY', type: 'P', category: 'buy', amount: A },
  { ticker: 'XLE', type: 'P', category: 'buy', amount: A },
  { ticker: 'VPL', type: 'P', category: 'buy', amount: A },
  { ticker: 'GLDM', type: 'P', category: 'buy', amount: A },
] as const;

describe('interpretScannedHousePtr — golden fixture (Fleischmann 9115821)', () => {
  const trades = interpretScannedHousePtr(observation, CTX);

  test('recovers all 11 transactions', () => {
    expect(trades).toHaveLength(GROUND_TRUTH.length);
  });

  test('every ticker matches the filing', () => {
    expect(trades.map((t) => t.ticker)).toEqual(GROUND_TRUTH.map((g) => g.ticker));
  });

  test('every transaction TYPE (Purchase/Sale checkbox) matches', () => {
    expect(trades.map((t) => t.transactionType)).toEqual(GROUND_TRUTH.map((g) => g.type));
    expect(trades.map((t) => t.category)).toEqual(GROUND_TRUTH.map((g) => g.category));
  });

  test('every AMOUNT band (checkbox column A–J) matches — incl. HYBB in column B', () => {
    expect(trades.map((t) => t.amountRange)).toEqual(GROUND_TRUTH.map((g) => g.amount));
  });

  test('every trade date resolves to 2026-04-28 (incl. the 0→9 OCR misread on SPMB)', () => {
    expect(trades.every((t) => t.tradeDate === '2026-04-28')).toBe(true);
  });

  test('owner is best-effort and never wrong (JT or null, never a bad code)', () => {
    // The 2-letter owner cells are below tesseract's reliable size; we recover
    // them when the read is clean and emit null otherwise — never a wrong code.
    expect(trades.every((t) => t.owner === 'JT' || t.owner === null)).toBe(true);
  });

  test('records carry stable, unique externalIds + amount min/max', () => {
    const ids = new Set(trades.map((t) => t.externalId));
    expect(ids.size).toBe(trades.length);
    const hybb = trades.find((t) => t.ticker === 'HYBB')!;
    expect(hybb.amountMin).toBe(15001);
    expect(hybb.amountMax).toBe(50000);
    expect(hybb.source).toBe('house-ptr');
    expect(hybb.transactionDescription).toBe('Sale (OCR)');
  });
});

describe('interpretScannedHousePtr — second form variant (Harshbarger 9115809)', () => {
  // A DIFFERENT printed variant: 4 type columns (Purchase/Sale/Partial Sale/
  // Exchange), 11 amount columns (A–K), open-box checkboxes, full-year dates, and
  // a municipal bond with no ticker. Proves the detector adapts to the variant.
  const trades = interpretScannedHousePtr(harshbargerJson as unknown as ScanObservation, {
    docId: '9115809',
    filingYear: 2026,
    filingDate: '2026-05-06',
    filerName: 'Diana Harshbarger',
    filingUrl: 'x',
  });

  test('recovers the single transaction', () => {
    expect(trades).toHaveLength(1);
  });

  test('reads the 4-column TYPE (Purchase) and 11-column AMOUNT (band B) checkboxes', () => {
    expect(trades[0].transactionType).toBe('P');
    expect(trades[0].category).toBe('buy');
    expect(trades[0].amountRange).toBe('$15,001 - $50,000');
  });

  test('parses the full-year date format (4/24/2026)', () => {
    expect(trades[0].tradeDate).toBe('2026-04-24');
  });

  test('identifies the municipal bond (no ticker) by name', () => {
    expect(trades[0].ticker).toBeNull();
    expect(trades[0].assetName).toMatch(/Airports/);
    expect(trades[0].assetName).toMatch(/Municipal Bond/);
  });
});

describe('pickCheckedCell — the checkbox strategy', () => {
  test('picks the clear darkness peak', () => {
    expect(pickCheckedCell([1100, 264, 212, 0, 212, 212, 212, 159, 159, 477])).toBe(0);
  });

  test('picks column B when the X is shifted one cell right', () => {
    expect(pickCheckedCell([212, 716, 200, 0, 100, 100, 100, 100, 100, 100])).toBe(1);
  });

  test('returns null when nothing clears the absolute floor (empty row)', () => {
    expect(pickCheckedCell([10, 20, 5, 0, 12, 8, 3, 0, 1, 4])).toBeNull();
  });

  test('returns null when the top two are too close (ambiguous)', () => {
    expect(pickCheckedCell([300, 290, 10])).toBeNull();
  });

  test('honors custom floor + ratio', () => {
    expect(pickCheckedCell([90, 10], { minAbs: 100 })).toBeNull();
    expect(pickCheckedCell([90, 10], { minAbs: 50 })).toBe(0);
  });
});

describe('tickerFromAssetTail — the ticker strategy', () => {
  test('extracts the trailing dash-ticker', () => {
    expect(tickerFromAssetTail('Ishares Tr BB Rated Corp Bd ETF - HYBB')).toBe('HYBB');
  });

  test('tolerates trailing OCR junk', () => {
    expect(tickerFromAssetTail('ard Intl Equity Index-VPL_ .-')).toBe('VPL');
  });

  test('lowercased OCR ticker is normalized to upper', () => {
    expect(tickerFromAssetTail('Global X Fds Global X Def Tech ETF -sHLD')).toBe('SHLD');
  });

  test('does not mistake a trailing common word for a ticker', () => {
    expect(tickerFromAssetTail('Vanguard Total Bond ETF')).toBeNull();
    expect(tickerFromAssetTail('Some Holding - INC')).toBeNull();
  });

  test('returns null when there is no dash-ticker', () => {
    expect(tickerFromAssetTail('Apple Computer Common Stock')).toBeNull();
  });
});

describe('repairOcrMonth + parseMmDdYy — the date strategy', () => {
  test('passes valid months through', () => {
    expect(repairOcrMonth(4)).toBe(4);
    expect(repairOcrMonth(12)).toBe(12);
  });

  test('repairs a 0→9 tens-digit misread', () => {
    expect(repairOcrMonth(94)).toBe(4); // "94" → "04"
    expect(repairOcrMonth(19)).toBe(9);
  });

  test('gives up on an unrecoverable month', () => {
    expect(repairOcrMonth(20)).toBeNull(); // ones digit 0
    expect(repairOcrMonth(0)).toBeNull();
  });

  test('parses MM/DD/YY into ISO, repairing the month', () => {
    expect(parseMmDdYy('04/28/26', 2026)).toBe('2026-04-28');
    expect(parseMmDdYy('94/28/26', 2026)).toBe('2026-04-28');
  });

  test('rejects dates far from the filing year (OCR noise)', () => {
    expect(parseMmDdYy('04/28/99', 2026)).toBeNull();
  });
});

describe('normalizeOwner — safe best-effort', () => {
  test('accepts an exact clean read', () => {
    expect(normalizeOwner('JT')).toBe('JT');
    expect(normalizeOwner('SP')).toBe('SP');
    expect(normalizeOwner('DC')).toBe('DC');
  });

  test('strips border/whitespace noise around a clean code', () => {
    expect(normalizeOwner('|JT')).toBe('JT');
    expect(normalizeOwner(' J T ')).toBe('JT');
  });

  test('returns null rather than guess a wrong code from garbage', () => {
    expect(normalizeOwner('TSP')).toBeNull(); // would be a WRONG "SP"
    expect(normalizeOwner('loot')).toBeNull();
    expect(normalizeOwner(null)).toBeNull();
  });
});

describe('cleanScannedAssetName + constants', () => {
  test('collapses whitespace and stray pipes from the form rules', () => {
    expect(cleanScannedAssetName('SPDR  Index | Shs   Fds')).toBe('SPDR Index Shs Fds');
  });

  test('amount ranges are A–J, 10 bands, matching the e-filed strings', () => {
    expect(HOUSE_AMOUNT_RANGES).toHaveLength(10);
    expect(HOUSE_AMOUNT_RANGES[0]).toBe('$1,001 - $15,000');
    expect(HOUSE_AMOUNT_RANGES[9]).toBe('Over $50,000,000');
  });
});
