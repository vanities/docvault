// Render smoke tests over a fabricated alert source; no network, no personal data.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vite-plus/test';
import type { AlertSourceView } from '../../../server/alerts-types';
import { SourceCard } from './AlertsView';

const NOW = Date.parse('2030-01-01T12:00:00.000Z');

function source(overrides: Partial<AlertSourceView> = {}): AlertSourceView {
  return {
    id: 'demo-source',
    label: 'Demo uptime',
    description: 'Synthetic source',
    jobId: 'demo-job',
    reportedAt: new Date(NOW - 5 * 60_000).toISOString(),
    failures: 0,
    checks: [
      {
        id: 'site:status',
        label: 'Site answers',
        scope: 'example.com',
        severity: 'critical',
        active: true,
        value: '503',
        threshold: 'not 200',
        since: new Date(NOW - 30 * 60_000).toISOString(),
        lastAlertAt: null,
      },
    ],
    advice: { critical: 'Restart the demo server.' },
    series: [
      { t: new Date(NOW - 30 * 60_000).toISOString(), values: { 'site.latencyMs': 120 } },
      { t: new Date(NOW - 15 * 60_000).toISOString(), values: { 'site.latencyMs': 480 } },
    ],
    job: {
      id: 'demo-job',
      label: 'Demo job',
      schedule: 'every 15m',
      script: 'scripts/demo.local.ts',
      enabled: true,
      tags: [],
    },
    hasDashboard: false,
    ...overrides,
  };
}

function renderCard(s: AlertSourceView, opts: { enabled?: boolean; emails?: boolean } = {}) {
  return renderToStaticMarkup(
    <SourceCard
      source={s}
      now={NOW}
      enabledOverride={opts.enabled}
      toggling={false}
      toggleError={undefined}
      checking={false}
      emailsOverride={opts.emails}
      emailsBusy={false}
      onToggle={() => {}}
      onCheck={() => {}}
      onToggleEmails={() => {}}
    />
  );
}

describe('AlertsView rendering', () => {
  test('a running source with a critical trip shows act now, advice and both switches', () => {
    const html = renderCard(source());
    expect(html).toContain('Act now');
    expect(html).toContain('Restart the demo server.');
    expect(html).toContain('aria-label="Demo uptime checks"');
    expect(html).toContain('aria-label="Demo uptime emails"');
    expect(html.match(/aria-checked="true"/g)).toHaveLength(2);
  });

  test('a disabled job reads as paused, even mid-toggle', () => {
    const paused = source({ job: { ...source().job!, enabled: false } });
    for (const html of [renderCard(paused), renderCard(source(), { enabled: false })]) {
      expect(html).toContain('Paused');
      expect(html).toContain('no checks or emails until you turn it back on');
    }
  });

  test('emails off keeps the checks but says nothing is sent', () => {
    for (const html of [
      renderCard(source({ emails: false })),
      renderCard(source(), { emails: false }),
    ]) {
      expect(html).toContain('Emails are off');
      expect(html).toContain('Act now');
    }
  });

  test('a source with a dashboard file renders it in a script-only sandbox', () => {
    const html = renderCard(source({ hasDashboard: true }));
    expect(html).toContain('<iframe');
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).toContain('src="/api/alerts/sources/demo-source/dashboard"');
    expect(html).not.toContain('allow-same-origin');
  });

  test('without a dashboard file, every series key gets a generic chart', () => {
    const html = renderCard(source());
    expect(html).not.toContain('<iframe');
    expect(html).toContain('site.latencyMs');
    expect(html).toContain('<svg');
  });
});
