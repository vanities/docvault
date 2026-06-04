import { describe, expect, test } from 'vite-plus/test';
import { summarizePoliticsData } from './politicsData';

describe('summarizePoliticsData', () => {
  test('summarizes the politics feed payload for dashboard cards', () => {
    const summary = summarizePoliticsData({
      configured: true,
      ok: true,
      baseUrl: 'local',
      service: 'docvault-politics',
      checkedAt: '2026-06-04T12:00:00.000Z',
      health: { service: 'docvault-politics' },
      sync: {
        jobs: [{ name: 'politicsRefresh', status: 'ok', ranAt: '2026-06-04T11:00:00Z' }],
      },
      votes: {
        votes: [
          {
            externalId: 'hr-7148-119',
            question: 'Became Public Law',
            bill: { title: 'Consolidated Appropriations Act, 2026', officialId: 'HR 7148' },
          },
          { externalId: 's-200-119', billTitle: 'A Senate Bill' },
        ],
      },
      trades: {
        trades: [
          {
            politicianName: 'John Q Public',
            ticker: 'NVDA',
            transactionDescription: 'Purchase',
            amountRange: '$1,001 - $15,000',
          },
        ],
      },
      executiveActions: [
        {
          slug: 'eo-14200',
          type: 'executive_order',
          title: 'Establishing the National AI Initiative',
          issuedDate: '2026-05-30',
        },
      ],
      filings: {
        filings: [
          {
            filerName: 'Jane Doe',
            source: 'house-ptr',
            status: 'needs_attention',
            warning: 'scanned/blank PDF',
          },
        ],
      },
    });

    expect(summary).toMatchObject({
      configured: true,
      ok: true,
      statusLabel: 'Active',
      service: 'docvault-politics',
      recentVoteCount: 2,
      recentTradeCount: 1,
      recentExecutiveActionCount: 1,
      recentFilingCount: 1,
      filingsNeedingAttentionCount: 1,
    });
    expect(summary.recentVoteLabels[0]).toBe('Consolidated Appropriations Act, 2026 · HR 7148');
    expect(summary.recentTradeLabels[0]).toContain('John Q Public');
    expect(summary.recentExecutiveActionLabels[0]).toContain(
      'Establishing the National AI Initiative'
    );
    expect(summary.recentExecutiveActionLabels[0]).toContain('Executive Order');
    expect(summary.attentionLabels[0]).toContain('Jane Doe');
  });

  test('surfaces a refresh error without a config branch', () => {
    expect(
      summarizePoliticsData({
        configured: true,
        ok: false,
        error: 'bills: Congress API key not set',
      })
    ).toMatchObject({
      configured: true,
      ok: false,
      statusLabel: 'Needs attention',
      errorLabel: 'bills: Congress API key not set',
    });
  });
});
