// Render smoke tests over a fabricated alert source; no network, no personal data.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vite-plus/test';
import type { AlertSourceView } from '../../../server/alerts-types';
import { AlertRow } from './AlertsView';

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

function renderRow(
  s: AlertSourceView,
  opts: { expanded?: boolean; enabled?: boolean; emails?: boolean } = {}
) {
  return renderToStaticMarkup(
    <AlertRow
      source={s}
      now={NOW}
      expanded={opts.expanded ?? false}
      onExpand={() => {}}
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

describe('AlertRow', () => {
  test('a collapsed row is one scannable line: name, status, summary and both switches', () => {
    const html = renderRow(source());
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('Demo uptime');
    expect(html).toContain('Act now');
    expect(html).toContain('1 tripped: Site answers (example.com)');
    expect(html).toContain('aria-label="Demo uptime checks"');
    expect(html).toContain('aria-label="Demo uptime emails"');
    expect(html).not.toContain('Restart the demo server.');
    expect(html).not.toContain('trips not 200');
    expect(html).not.toContain('site.latencyMs');
  });

  test('expanding shows the checks, advice and Check now', () => {
    const html = renderRow(source(), { expanded: true });
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('id="alert-panel-demo-source"');
    expect(html).toContain('trips not 200');
    expect(html).toContain('Restart the demo server.');
    expect(html).toContain('Check now');
  });

  test('a disabled job reads as paused, even mid-toggle', () => {
    const paused = source({ job: { ...source().job!, enabled: false } });
    for (const html of [renderRow(paused), renderRow(source(), { enabled: false })]) {
      expect(html).toContain('Paused');
      expect(html).toContain('at the last report');
    }
    expect(renderRow(paused, { expanded: true })).toContain(
      'no checks or emails until you turn it back on'
    );
  });

  test('emails off is visible collapsed and explained expanded', () => {
    expect(renderRow(source({ emails: false }))).toContain('emails off');
    expect(renderRow(source(), { emails: false, expanded: true })).toContain('Emails are off');
  });

  test('a dashboard file loads only when the row is open, in a script-only sandbox', () => {
    expect(renderRow(source({ hasDashboard: true }))).not.toContain('<iframe');
    const html = renderRow(source({ hasDashboard: true }), { expanded: true });
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).toContain('src="/api/alerts/sources/demo-source/dashboard"');
    expect(html).not.toContain('allow-same-origin');
  });

  test('without a dashboard file, an open row charts every series key', () => {
    const html = renderRow(source(), { expanded: true });
    expect(html).not.toContain('<iframe');
    expect(html).toContain('site.latencyMs');
    expect(html).toContain('<svg');
  });
});
