import { describe, expect, test } from 'vite-plus/test';
import { buildResearchIntelligence } from './research-intelligence';

describe('buildResearchIntelligence', () => {
  test('extracts summary bullets and claims with source-line provenance', () => {
    const intelligence = buildResearchIntelligence({
      id: 'entry123',
      title: 'Semis policy transcript',
      mediaType: 'text/plain',
      sourceUrl: 'https://example.test/transcript',
      publisher: 'Example Channel',
      reportDate: '2026-06-01',
      tickers: ['NVDA', 'TSM'],
      text: [
        'Host intro and housekeeping.',
        'NVDA demand will accelerate if export waivers remain in place for AI accelerators.',
        'The speaker argues TSM capex risk is tied to Taiwan policy and semiconductor tariffs.',
        'This paragraph is background without a tradable claim.',
      ].join('\n'),
    });

    expect(intelligence.source).toEqual({
      entryId: 'entry123',
      title: 'Semis policy transcript',
      sourceUrl: 'https://example.test/transcript',
      publisher: 'Example Channel',
      reportDate: '2026-06-01',
      mediaType: 'text/plain',
    });
    expect(intelligence.summary.map((item) => item.text)).toEqual([
      'NVDA demand will accelerate if export waivers remain in place for AI accelerators.',
      'The speaker argues TSM capex risk is tied to Taiwan policy and semiconductor tariffs.',
    ]);
    expect(intelligence.claims).toEqual([
      expect.objectContaining({
        text: 'NVDA demand will accelerate if export waivers remain in place for AI accelerators.',
        tickers: ['NVDA'],
        topics: ['ai', 'semiconductors', 'trade-policy'],
        stance: 'bullish',
        provenance: expect.objectContaining({
          entryId: 'entry123',
          lineStart: 2,
          lineEnd: 2,
          quote:
            'NVDA demand will accelerate if export waivers remain in place for AI accelerators.',
          sourceUrl: 'https://example.test/transcript',
        }),
      }),
      expect.objectContaining({
        text: 'The speaker argues TSM capex risk is tied to Taiwan policy and semiconductor tariffs.',
        tickers: ['TSM'],
        topics: ['semiconductors', 'trade-policy'],
        stance: 'risk',
        provenance: expect.objectContaining({ lineStart: 3, lineEnd: 3 }),
      }),
    ]);
  });

  test('uses title context and company-name rules to tag political-market claims', () => {
    const intelligence = buildResearchIntelligence({
      id: 'entry-oil',
      title: 'Oil spikes as Iran deal talks halt',
      mediaType: 'text/plain',
      sourceUrl: 'https://example.test/oil',
      text: [
        'Washington expects a broader Iran deal over the next week, but officials warn talks could stall.',
        'Nvidia demand may accelerate if data center export waivers survive the tariff fight.',
      ].join('\n'),
    });

    expect(intelligence.claims).toEqual([
      expect.objectContaining({
        text: 'Nvidia demand may accelerate if data center export waivers survive the tariff fight.',
        tickers: ['NVDA'],
        topics: expect.arrayContaining(['ai', 'semiconductors', 'trade-policy', 'energy']),
      }),
      expect.objectContaining({
        text: 'Washington expects a broader Iran deal over the next week, but officials warn talks could stall.',
        topics: expect.arrayContaining(['energy']),
      }),
    ]);
  });

  test('returns an empty intelligence payload when no text is available', () => {
    const intelligence = buildResearchIntelligence({
      id: 'empty',
      mediaType: 'application/pdf',
      text: null,
    });

    expect(intelligence.summary).toEqual([]);
    expect(intelligence.claims).toEqual([]);
    expect(intelligence.source).toEqual({ entryId: 'empty', mediaType: 'application/pdf' });
  });
});
