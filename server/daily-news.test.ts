import { describe, expect, test } from 'vite-plus/test';
import {
  applySourceCitations,
  buildResearchDigestItems,
  selectDailyNewsStepCount,
  snapshotFromAllResponseBody,
} from './daily-news.js';

function afterSince(d?: string | null): boolean {
  if (!d) return false;
  const iso = d.length === 10 ? `${d}T23:59:59` : d;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t >= new Date('2026-06-01T00:00:00.000Z').getTime();
}

describe('daily-news digest helpers', () => {
  test('daily health steps use the last complete day before the edition date', () => {
    const steps = selectDailyNewsStepCount(
      [
        { date: '2026-06-07', steps: 8200 },
        { date: '2026-06-08', steps: 10500 },
        { date: '2026-06-09', steps: 450 },
      ],
      { useAverage: false, editionDate: '2026-06-09' }
    );

    expect(steps).toBe(10500);
  });

  test('weekly health steps keep using the 7-day average path', () => {
    const steps = selectDailyNewsStepCount(
      [
        { date: '2026-06-07', steps: 8200 },
        { date: '2026-06-08', steps: 10500 },
        { date: '2026-06-09', steps: 450, steps7dAvg: 9300 },
      ],
      { useAverage: true, editionDate: '2026-06-09' }
    );

    expect(steps).toBe(9300);
  });

  test('includes every in-window research entry instead of dropping after a fixed cap', () => {
    const entries = Array.from({ length: 25 }, (_, i) => ({
      id: `entry-${i + 1}`,
      domain: i % 2 === 0 ? 'finance' : 'politics',
      title: `Research report ${i + 1}`,
      publisher: i % 2 === 0 ? 'Desk A' : 'Desk B',
      uploadedAt: `2026-06-${String((i % 8) + 1).padStart(2, '0')}T12:00:00.000Z`,
      text: `Full text for report ${i + 1}. `.repeat(80),
    }));

    const items = buildResearchDigestItems(entries as never[], afterSince, { maxChars: 12_000 });

    expect(items).toHaveLength(25);
    expect(items[0]).toContain('Research report 1');
    expect(items[24]).toContain('Research report 25');
  });

  test('filters old or empty research entries while preserving all eligible entries', () => {
    const entries = [
      {
        id: 'old',
        domain: 'finance',
        title: 'Old report',
        uploadedAt: '2026-05-30T12:00:00.000Z',
        text: 'old text',
      },
      {
        id: 'blank',
        domain: 'finance',
        title: 'Blank report',
        uploadedAt: '2026-06-02T12:00:00.000Z',
        text: '   ',
      },
      {
        id: 'new-1',
        domain: 'finance',
        title: 'New report 1',
        uploadedAt: '2026-06-02T12:00:00.000Z',
        text: 'new text 1',
      },
      {
        id: 'new-2',
        domain: 'politics',
        title: 'New report 2',
        reportDate: '2026-06-03',
        uploadedAt: '2026-05-20T12:00:00.000Z',
        text: 'new text 2',
      },
    ];

    const items = buildResearchDigestItems(entries as never[], afterSince, { maxChars: 4_000 });

    expect(items).toHaveLength(2);
    expect(items.join('\n')).toContain('New report 1');
    expect(items.join('\n')).toContain('New report 2');
    expect(items.join('\n')).not.toContain('Old report');
    expect(items.join('\n')).not.toContain('Blank report');
  });
});

describe('snapshotFromAllResponseBody', () => {
  // Regression: freshPersonSnapshot reads the `/snapshot/all` body, which nests
  // metrics under `snapshot`. It previously read `data` (the single-segment
  // key), so it returned undefined every call — the auto-heal recompute never
  // reached the digest and a freshly-synced person (whose raw-store snapshot
  // wasn't recomputed yet) was silently dropped from the edition.
  const snap = {
    activity: { daily: [{ date: '2026-06-15', steps: 7659 }] },
    sleep: { daily: [{ asleepMinutes: 350, deepMinutes: 41 }] },
  };

  test('reads the `snapshot` key from the all-endpoint shape', () => {
    const body = { snapshot: snap, illnessNotes: {}, stale: false, currentParserVersion: 7 };
    expect(snapshotFromAllResponseBody(body)).toBe(snap);
  });

  test('a single-segment `data` body yields undefined (the original bug)', () => {
    expect(snapshotFromAllResponseBody({ data: snap })).toBeUndefined();
  });

  test('missing, empty, or null-snapshot bodies yield undefined', () => {
    expect(snapshotFromAllResponseBody(undefined)).toBeUndefined();
    expect(snapshotFromAllResponseBody(null)).toBeUndefined();
    expect(snapshotFromAllResponseBody({})).toBeUndefined();
    expect(snapshotFromAllResponseBody({ snapshot: null })).toBeUndefined();
  });
});

describe('applySourceCitations', () => {
  const CITES = [
    { ref: 'S1', url: 'https://example.com/oil-shorts' },
    { ref: 'S2', url: 'https://example.com/el-nino' },
  ];

  test('tagged phrases become inline markdown links', () => {
    const body = 'Paper bets the crisis ends: [Brent shorts have tripled][S1] since March.';
    expect(applySourceCitations(body, CITES)).toBe(
      'Paper bets the crisis ends: [Brent shorts have tripled](https://example.com/oil-shorts) since March.'
    );
  });

  test('bare tags become numbered links, renumbered in reading order', () => {
    const body = 'El Nino was declared [S2]. Shorts tripled [S1]. El Nino again [S2].';
    expect(applySourceCitations(body, CITES)).toBe(
      'El Nino was declared [[1]](https://example.com/el-nino). ' +
        'Shorts tripled [[2]](https://example.com/oil-shorts). ' +
        'El Nino again [[1]](https://example.com/el-nino).'
    );
  });

  test('unknown tags are stripped, not leaked to readers', () => {
    const body = 'A claim [with text][S9] and a bare mistake [S7].';
    expect(applySourceCitations(body, CITES)).toBe('A claim with text and a bare mistake.');
  });

  test('no citations strips any stray tags entirely', () => {
    expect(applySourceCitations('Clean prose [S3] here.', [])).toBe('Clean prose here.');
  });

  test('regular markdown links pass through untouched', () => {
    const body = 'See [the appendix](https://example.com/notes) below.';
    expect(applySourceCitations(body, CITES)).toBe(body);
  });
});
