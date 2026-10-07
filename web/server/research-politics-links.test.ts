import { describe, expect, test } from 'vite-plus/test';
import { buildResearchPoliticsBriefs, buildResearchPoliticsLinks } from './research-politics-links';

describe('buildResearchPoliticsLinks', () => {
  test('links research claims to Check the Vote trades by ticker and votes by policy topic', () => {
    const links = buildResearchPoliticsLinks({
      entries: [
        {
          id: 'research-1',
          title: 'AI export waiver transcript',
          sourceUrl: 'https://example.test/video',
          intelligence: {
            version: 1,
            summary: [],
            claims: [
              {
                id: 'claim-1',
                text: 'NVDA demand will accelerate if export waivers remain in place for AI accelerators.',
                tickers: ['NVDA'],
                topics: ['ai', 'trade-policy'],
                stance: 'bullish',
                provenance: {
                  entryId: 'research-1',
                  mediaType: 'text/plain',
                  lineStart: 4,
                  lineEnd: 4,
                  charStart: 100,
                  charEnd: 182,
                  quote:
                    'NVDA demand will accelerate if export waivers remain in place for AI accelerators.',
                  sourceUrl: 'https://example.test/video',
                },
              },
            ],
          },
        },
      ],
      politics: {
        configured: true,
        ok: true,
        baseUrl: 'http://pi.local:3000',
        checkedAt: '2026-06-02T12:00:00.000Z',
        trades: {
          trades: [
            {
              politicianName: 'Donald J. Trump',
              ticker: 'NVDA',
              category: 'buy',
              tradeDate: '2026-03-23',
              amount: '$50,001 - $100,000',
            },
            { politicianName: 'Jane Doe', ticker: 'MSFT', category: 'sell' },
          ],
        },
        votes: {
          votes: [
            {
              externalId: 'house-119-2-7',
              question: 'On passage: Export Control and AI Accelerator Waiver Act',
              bill: { title: 'AI Accelerator Export Control and Waiver Act' },
            },
          ],
        },
      },
    });

    expect(links).toEqual([
      expect.objectContaining({
        entryId: 'research-1',
        title: 'AI export waiver transcript',
        claimId: 'claim-1',
        claimText:
          'NVDA demand will accelerate if export waivers remain in place for AI accelerators.',
        sourceUrl: 'https://example.test/video',
        tickers: ['NVDA'],
        topics: ['ai', 'trade-policy'],
        matchedTrades: [
          expect.objectContaining({
            politicianName: 'Donald J. Trump',
            ticker: 'NVDA',
            category: 'buy',
            tradeDate: '2026-03-23',
          }),
        ],
        matchedVotes: [
          expect.objectContaining({
            externalId: 'house-119-2-7',
            label: 'AI Accelerator Export Control and Waiver Act',
          }),
        ],
      }),
    ]);
  });

  test('does not create links for unconfigured politics payloads or claims without matches', () => {
    expect(
      buildResearchPoliticsLinks({
        entries: [{ id: 'research-1', intelligence: { version: 1, summary: [], claims: [] } }],
        politics: { configured: false, ok: false, reason: 'missing_api_key' },
      })
    ).toEqual([]);
  });

  test('matches trades by topic-derived asset exposure when claims have no explicit ticker', () => {
    const links = buildResearchPoliticsLinks({
      entries: [
        {
          id: 'research-energy',
          title: 'Oil risk note',
          intelligence: {
            claims: [
              {
                id: 'claim-1',
                text: 'Oil prices may spike if Iran talks fail.',
                tickers: [],
                topics: ['energy'],
                stance: 'risk',
              },
            ],
          },
        },
      ],
      politics: {
        configured: true,
        ok: true,
        baseUrl: 'http://check-the-vote.test',
        checkedAt: '2026-06-02T00:00:00.000Z',
        trades: {
          trades: [
            {
              politicianName: 'Jane Doe',
              assetName: 'Exxon Mobil Corporation Common Stock',
              ticker: 'XOM',
              category: 'buy',
              tradeDate: '2026-06-01',
            },
          ],
        },
        votes: { votes: [] },
      },
    });

    expect(links).toEqual([
      expect.objectContaining({
        topics: ['energy'],
        matchedTrades: [expect.objectContaining({ ticker: 'XOM', politicianName: 'Jane Doe' })],
      }),
    ]);
  });

  test('groups linked claims into ticker and topic briefs with provenance counts', () => {
    const links = [
      {
        entryId: 'research-1',
        title: 'AI export waiver transcript',
        claimId: 'claim-1',
        claimText: 'NVDA demand will accelerate if export waivers remain in place.',
        sourceUrl: 'https://example.test/video',
        tickers: ['NVDA'],
        topics: ['ai', 'trade-policy'],
        stance: 'bullish',
        matchedTrades: [
          {
            politicianName: 'Donald J. Trump',
            ticker: 'NVDA',
            category: 'buy',
            tradeDate: '2026-03-23',
          },
        ],
        matchedVotes: [{ externalId: 'house-119-2-7', label: 'AI Accelerator Export Waiver Act' }],
      },
      {
        entryId: 'research-2',
        title: 'Semis note',
        claimId: 'claim-2',
        claimText: 'NVDA capex risk rises if data-center demand slows.',
        tickers: ['NVDA'],
        topics: ['ai'],
        stance: 'bearish',
        matchedTrades: [{ politicianName: 'Jane Doe', ticker: 'NVDA', category: 'sell' }],
        matchedVotes: [],
      },
    ];

    expect(buildResearchPoliticsBriefs(links)).toEqual([
      expect.objectContaining({
        key: 'ticker:NVDA',
        kind: 'ticker',
        label: 'NVDA',
        claimCount: 2,
        tradeMatchCount: 2,
        voteMatchCount: 0,
        stances: ['bearish', 'bullish'],
        sourceUrls: ['https://example.test/video'],
      }),
      expect.objectContaining({
        key: 'topic:ai',
        kind: 'topic',
        label: '#ai',
        claimCount: 2,
        tradeMatchCount: 2,
        voteMatchCount: 1,
      }),
      expect.objectContaining({
        key: 'topic:trade-policy',
        kind: 'topic',
        label: '#trade-policy',
        claimCount: 1,
        tradeMatchCount: 1,
        voteMatchCount: 1,
      }),
    ]);
  });
});
