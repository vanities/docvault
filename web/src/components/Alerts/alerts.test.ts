// Pure helper tests over fabricated alert sources; no network, no personal data.
import { describe, expect, test } from 'vite-plus/test';
import type {
  AlertCheck,
  AlertJobInfo,
  AlertSettingSpec,
  AlertSourceView,
} from '../../../server/alerts-types';
import {
  diffSettings,
  expansionKey,
  formatNumber,
  formatSetting,
  isExpanded,
  overallStatus,
  parseSettingInput,
  scheduleToMs,
  seriesKeys,
  seriesValues,
  settingValue,
  sortChecks,
  sortSources,
  sourceHealth,
  sourceStatus,
  sourceSummary,
  sparkGeometry,
} from './alerts';

function check(overrides: Partial<AlertCheck> = {}): AlertCheck {
  return {
    id: 'demo:check',
    label: 'Demo check',
    scope: 'Demo',
    severity: 'warning',
    active: false,
    value: '1',
    threshold: 'above 2',
    since: null,
    lastAlertAt: null,
    ...overrides,
  };
}

const job = (overrides: Partial<AlertJobInfo> = {}): AlertJobInfo => ({
  id: 'demo-job',
  label: 'Demo job',
  schedule: 'every 15m',
  script: 'scripts/demo.local.ts',
  enabled: true,
  tags: [],
  ...overrides,
});

describe('status', () => {
  test('a disabled job pauses its source even with tripped checks', () => {
    const tripped = [check({ active: true, severity: 'critical' })];
    expect(sourceStatus({ checks: tripped, job: job() })).toBe('act');
    expect(sourceStatus({ checks: tripped, job: job({ enabled: false }) })).toBe('paused');
    expect(sourceStatus({ checks: [check({ active: true })], job: null })).toBe('warning');
    expect(sourceStatus({ checks: [check()], job: null })).toBe('clear');
  });

  test('overall status ignores paused sources and counts them', () => {
    expect(
      overallStatus([
        { checks: [check({ active: true, severity: 'critical' })], job: job({ enabled: false }) },
        { checks: [check({ active: true })], job: job() },
        { checks: [], job: null },
      ])
    ).toEqual({ status: 'warning', paused: 1 });
  });

  test('tripped checks sort first, critical before warning', () => {
    const sorted = sortChecks([
      check({ id: 'ok', label: 'A' }),
      check({ id: 'warn', label: 'B', active: true }),
      check({ id: 'crit', label: 'C', active: true, severity: 'critical' }),
    ]);
    expect(sorted.map((c) => c.id)).toEqual(['crit', 'warn', 'ok']);
  });
});

describe('source health', () => {
  const now = Date.parse('2030-01-01T12:00:00.000Z');
  const ago = (min: number) => new Date(now - min * 60_000).toISOString();

  test('schedules convert like the server', () => {
    expect(scheduleToMs('hourly')).toBe(3_600_000);
    expect(scheduleToMs('every 2h')).toBe(7_200_000);
    expect(scheduleToMs('every 15m')).toBe(900_000);
    expect(scheduleToMs('weekly')).toBeNull();
  });

  test('stale after three missed intervals, only while the job is enabled', () => {
    expect(sourceHealth({ reportedAt: ago(40), failures: 0, job: job() }, now).kind).toBe('ok');
    expect(sourceHealth({ reportedAt: ago(46), failures: 0, job: job() }, now).kind).toBe('stale');
    expect(
      sourceHealth({ reportedAt: ago(600), failures: 0, job: job({ enabled: false }) }, now).kind
    ).toBe('ok');
    expect(sourceHealth({ reportedAt: ago(5), failures: 2, job: job() }, now).kind).toBe('failing');
    expect(sourceHealth({ reportedAt: null, failures: 0, job: null }, now).kind).toBe('never');
  });
});

describe('the list', () => {
  const now = Date.parse('2030-01-01T12:00:00.000Z');
  const recent = new Date(now - 5 * 60_000).toISOString();
  const src = (overrides: Partial<AlertSourceView> = {}): AlertSourceView => ({
    id: 'demo',
    label: 'Demo',
    reportedAt: recent,
    failures: 0,
    checks: [
      check({ id: 'a', label: 'Check A', scope: '' }),
      check({ id: 'b', label: 'Check B', scope: '' }),
    ],
    series: [],
    job: job(),
    hasDashboard: false,
    ...overrides,
  });
  const trip = (id: string, severity: 'critical' | 'warning' = 'critical') =>
    check({ id, label: `Check ${id}`, scope: '', active: true, severity });

  test('a collapsed row says what is wrong, or that nothing is', () => {
    expect(sourceSummary(src(), now)).toEqual({ text: 'All clear, 2 checks', tone: 'ok' });
    expect(
      sourceSummary(src({ checks: [trip('x'), trip('y', 'warning'), trip('z')] }), now)
    ).toEqual({
      text: '3 tripped: Check x, Check z, +1 more',
      tone: 'critical',
    });
    expect(sourceSummary(src({ checks: [trip('y', 'warning')], emails: false }), now)).toEqual({
      text: '1 tripped: Check y, emails off',
      tone: 'warning',
    });
    expect(sourceSummary(src({ job: job({ enabled: false }) }), now).text).toBe(
      'Paused, all clear at the last report'
    );
    expect(sourceSummary(src({ failures: 2 }), now).text).toBe(
      "Can't get its data (2 failed checks)"
    );
    expect(
      sourceSummary(src({ reportedAt: new Date(now - 3 * 3_600_000).toISOString() }), now).text
    ).toBe('No report in 3 h');
    expect(sourceSummary(src({ reportedAt: null }), now).text).toBe('Waiting for its first report');
  });

  test('problems sort first; pausing a source never moves its row', () => {
    const order = sortSources(
      [
        src({ id: 'clear', label: 'A clear' }),
        src({ id: 'paused', label: 'B paused', job: job({ enabled: false }) }),
        src({ id: 'warn', label: 'Z warn', checks: [trip('w', 'warning')] }),
        src({ id: 'stale', label: 'Y stale', reportedAt: new Date(now - 3_600_000).toISOString() }),
        src({ id: 'act', label: 'X act', checks: [trip('c')] }),
      ],
      now
    ).map((s) => s.id);
    expect(order).toEqual(['act', 'warn', 'stale', 'clear', 'paused']);
  });

  test('tripped rows open by default, and a new trip reopens a row collapsed while clear', () => {
    const clear = [check()];
    const tripped = [check({ active: true })];
    expect(isExpanded({}, 'demo', clear)).toBe(false);
    expect(isExpanded({}, 'demo', tripped)).toBe(true);
    const remembered = {
      [expansionKey('demo', clear)]: false,
      [expansionKey('demo', tripped)]: false,
    };
    expect(isExpanded({ [expansionKey('demo', clear)]: true }, 'demo', clear)).toBe(true);
    expect(isExpanded({ [expansionKey('demo', clear)]: false }, 'demo', tripped)).toBe(true);
    expect(isExpanded(remembered, 'demo', tripped)).toBe(false);
  });
});

describe('charts and formatting', () => {
  test('the reference line stays inside the chart even far from the data', () => {
    const g = sparkGeometry([99, 99.5, 98], 240, 56, 5);
    expect(g.refY).not.toBeNull();
    expect(g.refY!).toBeGreaterThanOrEqual(0);
    expect(g.refY!).toBeLessThanOrEqual(56);
    expect(g.line.startsWith('M')).toBe(true);
  });

  test('a flat series and gaps still draw', () => {
    expect(sparkGeometry([1, 1, 1], 100, 20).line).not.toBe('');
    expect(sparkGeometry([null, 2, null, 3], 100, 20).end).not.toBeNull();
    expect(sparkGeometry([null, null], 100, 20).line).toBe('');
  });

  test('series values drop non-numbers', () => {
    expect(
      seriesValues(
        [
          { t: 'a', values: { 'demo.x': 1 } },
          { t: 'b', values: { 'demo.x': null } },
          { t: 'c', values: {} },
        ],
        'demo.x'
      )
    ).toEqual([1, null, null]);
  });

  test('series keys come out in first-seen order, once each', () => {
    expect(
      seriesKeys([
        { t: 'a', values: { 'demo.b': 1, 'demo.a': 2 } },
        { t: 'b', values: { 'demo.a': 3, 'demo.c': null } },
      ])
    ).toEqual(['demo.b', 'demo.a', 'demo.c']);
  });

  test('unitless numbers keep precision when small', () => {
    expect(formatNumber(0.99971)).toBe('0.9997');
    expect(formatNumber(8.4)).toBe('8.4');
    expect(formatNumber(1234567.89)).toBe('1,234,567.9');
  });
});

describe('settings helpers', () => {
  const line: AlertSettingSpec = {
    key: 'line',
    label: 'Alert at or below',
    unit: '%',
    default: 6.75,
    min: 2,
    max: 15,
  };
  const target: AlertSettingSpec = { key: 'target', label: 'Target', unit: '$', default: 1234 };
  const span: AlertSettingSpec = {
    key: 'span',
    label: 'Window',
    unit: 'weeks',
    default: 4,
    min: 1,
    max: 26,
  };

  test('the value in effect is the owner one, else the default', () => {
    expect(settingValue(line, { line: 6.5 })).toBe(6.5);
    expect(settingValue(line, {})).toBe(6.75);
    expect(settingValue(line, undefined)).toBe(6.75);
  });

  test('values read with the unit the job named, without float noise', () => {
    expect(formatSetting(line, 6.75)).toBe('6.75%');
    expect(formatSetting(line, 0.1 + 0.2)).toBe('0.3%');
    expect(formatSetting(target, 1234)).toBe('$1,234');
    expect(formatSetting(span, 4)).toBe('4 weeks');
    expect(formatSetting({}, 3)).toBe('3');
  });

  test('a blank field means the default; typed symbols are fine; ranges hold', () => {
    expect(parseSettingInput(line, '')).toEqual({ value: 6.75 });
    expect(parseSettingInput(line, ' 6.5% ')).toEqual({ value: 6.5 });
    expect(parseSettingInput(target, '$2,500')).toEqual({ value: 2500 });
    expect(parseSettingInput(line, 'abc')).toEqual({ error: 'Enter a number' });
    expect(parseSettingInput(line, '1')).toEqual({ error: 'At least 2%' });
    expect(parseSettingInput(span, '30')).toEqual({ error: 'At most 26 weeks' });
  });

  test('Done lists only real changes, old → new; going back to the default saves null', () => {
    const specs = [line, span];
    expect(diffSettings(specs, { line: 6.5 }, { line: 6.5, span: 4 })).toEqual([]);
    expect(diffSettings(specs, { line: 6.5 }, { line: 6.75, span: 6 })).toEqual([
      { key: 'line', label: 'Alert at or below', from: '6.5%', to: '6.75%', value: null },
      { key: 'span', label: 'Window', from: '4 weeks', to: '6 weeks', value: 6 },
    ]);
  });
});
