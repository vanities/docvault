// The missing-vs-zero rule for history charts. All figures fabricated.
import { describe, expect, test } from 'vite-plus/test';
import { observedEndpoints, seriesValue, type HistoryPoint } from './historySeries';

describe('seriesValue', () => {
  test('an absent field is null, not 0', () => {
    // The whole bug: a day the banks could not be read is not a day of $0.
    expect(seriesValue({ goldValue: 100 }, 'bankValue')).toBeNull();
  });

  test('an explicit zero is preserved as a real reading', () => {
    expect(seriesValue({ bankValue: 0 }, 'bankValue')).toBe(0);
  });

  test('a real number passes through', () => {
    expect(seriesValue({ bankValue: 1234.56 }, 'bankValue')).toBe(1234.56);
  });

  test('null, undefined, and non-finite values are all gaps', () => {
    expect(seriesValue({ bankValue: null }, 'bankValue')).toBeNull();
    expect(seriesValue({ bankValue: undefined }, 'bankValue')).toBeNull();
    expect(seriesValue({ bankValue: NaN }, 'bankValue')).toBeNull();
    expect(seriesValue({ bankValue: Infinity }, 'bankValue')).toBeNull();
  });

  test('a NEGATIVE reading is real data, not a gap', () => {
    // bankValue nets credit-card balances against cash, so it is routinely
    // negative. Any missing-data check based on falsiness (`|| 0`, `v <= 0`)
    // silently discards these real readings.
    expect(seriesValue({ bankValue: -22529.05 }, 'bankValue')).toBe(-22529.05);
  });

  test('a stringified number is not silently coerced', () => {
    // Guards against a future loader handing us strings from JSON.
    expect(seriesValue({ bankValue: '500' }, 'bankValue')).toBeNull();
  });
});

const pt = (fullDate: string, bankValue: number | null): HistoryPoint => ({
  date: fullDate,
  fullDate,
  bankValue,
});

describe('observedEndpoints', () => {
  test('ignores leading and trailing gap days', () => {
    const points = [
      pt('2020-01-01', null),
      pt('2020-01-02', 1000),
      pt('2020-01-03', 1500),
      pt('2020-01-04', null),
    ];
    expect(observedEndpoints(points, 'bankValue')).toEqual({ first: 1000, last: 1500, count: 2 });
  });

  test('a gap in the middle does not become an endpoint', () => {
    const points = [pt('2020-01-01', 1000), pt('2020-01-02', null), pt('2020-01-03', 900)];
    const { first, last } = observedEndpoints(points, 'bankValue');
    expect(first).toBe(1000);
    expect(last).toBe(900);
  });

  test('an all-gap range reports no observations rather than a fake 0 -> 0', () => {
    const points = [pt('2020-01-01', null), pt('2020-01-02', null)];
    expect(observedEndpoints(points, 'bankValue').count).toBe(0);
  });

  test('a genuine 0 reading still counts as observed', () => {
    const points = [pt('2020-01-01', 0), pt('2020-01-02', 500)];
    expect(observedEndpoints(points, 'bankValue')).toEqual({ first: 0, last: 500, count: 2 });
  });

  test('negative readings anchor the endpoints like any other value', () => {
    const points = [pt('2020-01-01', -2500), pt('2020-01-02', null), pt('2020-01-03', -400)];
    expect(observedEndpoints(points, 'bankValue')).toEqual({ first: -2500, last: -400, count: 2 });
  });
});
