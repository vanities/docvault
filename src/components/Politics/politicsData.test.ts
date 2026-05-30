import { describe, expect, test } from 'vite-plus/test';
import { summarizePoliticsData } from './politicsData';

describe('summarizePoliticsData', () => {
  test('summarizes Check the Vote politics payload for dashboard cards', () => {
    const summary = summarizePoliticsData({
      configured: true,
      ok: true,
      baseUrl: 'http://pi.local:3000',
      checkedAt: '2026-05-30T12:00:00.000Z',
      health: { service: 'checkthevote' },
      sync: {
        cron: {
          recentJobs: [
            { name: 'trades:house-ptr', status: 'done', lastSuccessAt: '2026-05-30T11:00:00Z' },
          ],
          partialJobs: [{ name: 'photos', status: 'warning', message: '3 missing images' }],
          failedJobs: [],
        },
        historical: {
          latestWarning: { job: 'capitol-api', message: 'upstream 503' },
          recentWarnings: [{ job: 'ocr', message: 'blank PDF' }],
          recentErrors: [],
          staleRunningCount: 0,
        },
      },
      votes: {
        votes: [
          {
            externalId: 'senate-119-2-44',
            question: 'On Passage of H.R. 7148',
            bill: { title: 'Consolidated Appropriations Act, 2026', officialId: 'HR-7148-119' },
          },
          { externalId: 'house-119-2-35', question: 'On Motion to Suspend the Rules' },
        ],
      },
      trades: {
        trades: [
          {
            politicianName: 'Nancy Pelosi',
            ticker: 'NVDA',
            transactionType: 'purchase',
            amountRange: '$1,001 - $15,000',
          },
        ],
      },
      filings: {
        filings: [
          { filerName: 'Jane Doe', source: 'house-clerk-ptr', warning: 'ptr_pdf_text_blank' },
          { filerName: 'John Doe', source: 'senate-efd-ptr' },
        ],
      },
    });

    expect(summary).toMatchObject({
      configured: true,
      ok: true,
      baseUrl: 'http://pi.local:3000',
      service: 'checkthevote',
      syncJobCount: 4,
      syncWarningCount: 3,
      recentVoteCount: 2,
      recentTradeCount: 1,
      recentFilingCount: 2,
      filingsNeedingAttentionCount: 1,
    });
    expect(summary.recentVoteLabels[0]).toBe('Consolidated Appropriations Act, 2026 · HR-7148-119');
    expect(summary.recentTradeLabels[0]).toContain('Nancy Pelosi');
    expect(summary.attentionLabels[0]).toContain('Jane Doe');
  });

  test('summarizes missing config and upstream failures safely', () => {
    expect(
      summarizePoliticsData({ configured: false, ok: false, reason: 'missing_api_key' })
    ).toMatchObject({
      configured: false,
      ok: false,
      statusLabel: 'Not configured',
      errorLabel: 'Missing CHECKTHEVOTE_API_KEY',
    });

    expect(
      summarizePoliticsData({
        configured: true,
        ok: false,
        baseUrl: 'http://pi.local:3000',
        checkedAt: '2026-05-30T12:00:00.000Z',
        error: 'Check the Vote request failed for /api/v1/sync: HTTP 503',
      })
    ).toMatchObject({
      configured: true,
      ok: false,
      statusLabel: 'Needs attention',
      errorLabel: 'Check the Vote request failed for /api/v1/sync: HTTP 503',
    });
  });
});
