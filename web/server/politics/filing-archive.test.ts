// Filing archive — pure filter tests + a round-trip integration test against a
// temp dir. Synthetic/public data only.

import { afterAll, beforeEach, describe, expect, test } from 'vite-plus/test';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  archiveFiling,
  filterFilings,
  getFilingMeta,
  listFilings,
  readFilingPdf,
  readFilingText,
  resetArchiveCache,
  searchFilings,
  type FilingMeta,
} from './filing-archive.js';

function meta(p: Partial<FilingMeta>): FilingMeta {
  return {
    docId: '1',
    source: 'house-ptr',
    chamber: 'house',
    filerName: 'Rep A',
    filingYear: 2026,
    filingDate: '2026-01-01',
    filingUrl: 'x',
    parseMethod: 'text',
    tradeCount: 1,
    textLength: 10,
    hasPdf: true,
    fetchedAt: '2026-01-01T00:00:00.000Z',
    ...p,
  };
}

describe('filterFilings (pure)', () => {
  const all = [
    meta({ docId: 'a', filerName: 'Nancy Pelosi', filingDate: '2026-03-01', source: 'house-ptr' }),
    meta({
      docId: 'b',
      filerName: 'Tommy Tuberville',
      filingDate: '2026-05-01',
      source: 'senate-ptr',
      chamber: 'senate',
    }),
    meta({ docId: 'c', filerName: 'Nancy Pelosi', filingDate: '2026-01-15', tradeCount: 0 }),
  ];

  test('newest filing first', () => {
    expect(filterFilings(all).map((f) => f.docId)).toEqual(['b', 'a', 'c']);
  });

  test('filters by source, chamber, filer substring, year, hasTrades', () => {
    expect(filterFilings(all, { source: 'senate-ptr' }).map((f) => f.docId)).toEqual(['b']);
    expect(filterFilings(all, { chamber: 'senate' }).map((f) => f.docId)).toEqual(['b']);
    expect(filterFilings(all, { filer: 'pelosi' }).map((f) => f.docId)).toEqual(['a', 'c']);
    expect(filterFilings(all, { hasTrades: true }).map((f) => f.docId)).toEqual(['b', 'a']);
    expect(filterFilings(all, { year: 2026 })).toHaveLength(3);
  });

  test('honors limit', () => {
    expect(filterFilings(all, { limit: 1 }).map((f) => f.docId)).toEqual(['b']);
  });
});

describe('archive round-trip (temp dir)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'docvault-archive-'));
    process.env.DOCVAULT_FILINGS_DIR = dir;
    resetArchiveCache();
  });

  afterAll(async () => {
    delete process.env.DOCVAULT_FILINGS_DIR;
    resetArchiveCache();
  });

  test('archives PDF + text + metadata and reads them back', async () => {
    await archiveFiling({
      source: 'house-ptr',
      docId: '20033725',
      chamber: 'house',
      filerName: 'Hon. Nancy Pelosi',
      filingYear: 2026,
      filingDate: '2026-01-20',
      filingUrl: 'https://example/ptr.pdf',
      pdfBytes: new TextEncoder().encode('%PDF-1.4 fake').buffer,
      text: 'Purchased 20 call options with a strike price of $150...',
      parseMethod: 'text',
      tradeCount: 17,
    });

    const listed = await listFilings();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      docId: '20033725',
      tradeCount: 17,
      hasPdf: true,
      parseMethod: 'text',
    });

    const m = await getFilingMeta('house-ptr', '20033725');
    expect(m?.filerName).toBe('Hon. Nancy Pelosi');

    expect((await readFilingPdf('house-ptr', '20033725'))?.toString()).toBe('%PDF-1.4 fake');
    expect(await readFilingText('house-ptr', '20033725')).toContain('call options');
  });

  test('full-text search finds the filing by its content', async () => {
    await archiveFiling({
      source: 'house-ptr',
      docId: 'x1',
      chamber: 'house',
      filerName: 'Rep A',
      filingYear: 2026,
      filingDate: '2026-02-01',
      filingUrl: 'x',
      text: 'NVIDIA call options strike $100',
      parseMethod: 'text',
      tradeCount: 1,
    });
    await archiveFiling({
      source: 'house-ptr',
      docId: 'x2',
      chamber: 'house',
      filerName: 'Rep B',
      filingYear: 2026,
      filingDate: '2026-02-02',
      filingUrl: 'x',
      text: 'Sold 5,000 shares of Apple',
      parseMethod: 'text',
      tradeCount: 1,
    });
    expect((await searchFilings('nvidia')).map((f) => f.docId)).toEqual(['x1']);
    expect((await searchFilings('shares')).map((f) => f.docId)).toEqual(['x2']);
    expect(await searchFilings('tesla')).toHaveLength(0);
  });

  test('a missing filing returns null, not a throw (path-traversal safe)', async () => {
    expect(await readFilingPdf('house-ptr', '../../etc/passwd')).toBeNull();
    expect(await getFilingMeta('house-ptr', 'nope')).toBeNull();
  });

  test('re-archiving the same docId updates its metadata (latest wins)', async () => {
    const common = {
      source: 'house-ptr',
      docId: 'dup',
      chamber: 'house',
      filerName: 'Rep A',
      filingYear: 2026,
      filingDate: '2026-01-01',
      filingUrl: 'x',
      parseMethod: 'none' as const,
    };
    await archiveFiling({ ...common, tradeCount: 0, text: '' });
    await archiveFiling({ ...common, tradeCount: 5, text: 'now with trades', parseMethod: 'text' });
    const listed = await listFilings();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ tradeCount: 5, parseMethod: 'text' });
    expect(await readFilingText('house-ptr', 'dup')).toBe('now with trades');
  });

  test('text-only filing has hasPdf=false; pdf-only has textLength 0', async () => {
    await archiveFiling({
      source: 'senate-ptr',
      docId: 'txt',
      chamber: 'senate',
      filerName: 'Sen B',
      filingYear: 2026,
      filingDate: '2026-02-01',
      filingUrl: 'x',
      text: 'just text',
      parseMethod: 'text',
      tradeCount: 1,
    });
    await archiveFiling({
      source: 'oge-278t',
      docId: 'pdf',
      chamber: 'executive',
      filerName: 'POTUS',
      filingYear: 2026,
      filingDate: '2026-02-02',
      filingUrl: 'x',
      pdfBytes: new ArrayBuffer(4),
      parseMethod: 'ocr',
      tradeCount: 2,
    });
    expect(await getFilingMeta('senate-ptr', 'txt')).toMatchObject({ hasPdf: false });
    expect(await readFilingPdf('senate-ptr', 'txt')).toBeNull();
    expect(await getFilingMeta('oge-278t', 'pdf')).toMatchObject({ hasPdf: true, textLength: 0 });
  });

  test('archiveFiling sanitizes a traversal docId rather than escaping the dir', async () => {
    await archiveFiling({
      source: 'house-ptr',
      docId: '../../evil',
      chamber: 'house',
      filerName: 'X',
      filingYear: 2026,
      filingDate: null,
      filingUrl: 'x',
      text: 'contained',
      parseMethod: 'text',
      tradeCount: 0,
    });
    // Sanitized to "evil" — readable under the archive, not at a traversal path.
    expect(await readFilingText('house-ptr', 'evil')).toBe('contained');
    expect(await readFilingText('house-ptr', '../../evil')).toBe('contained');
  });

  test('search is case-insensitive and honors the limit', async () => {
    for (const id of ['s1', 's2', 's3']) {
      await archiveFiling({
        source: 'house-ptr',
        docId: id,
        chamber: 'house',
        filerName: 'Rep',
        filingYear: 2026,
        filingDate: `2026-03-0${id.slice(1)}`,
        filingUrl: 'x',
        text: 'TESLA call options',
        parseMethod: 'text',
        tradeCount: 1,
      });
    }
    expect(await searchFilings('tesla')).toHaveLength(3);
    expect(await searchFilings('TeSLa', 2)).toHaveLength(2);
    expect(await searchFilings('  ')).toHaveLength(0);
  });
});
