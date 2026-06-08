import { describe, expect, test } from 'vite-plus/test';
import { buildResearchDigestItems } from './daily-news.js';

function afterSince(d?: string | null): boolean {
  if (!d) return false;
  const iso = d.length === 10 ? `${d}T23:59:59` : d;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t >= new Date('2026-06-01T00:00:00.000Z').getTime();
}

describe('daily-news digest helpers', () => {
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
