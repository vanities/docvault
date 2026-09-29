// All dates and balances below are fabricated.
import { describe, expect, test } from 'vite-plus/test';
import type { PortfolioSnapshot } from '../types';
import { comparisonDay, latestSnapshot, portfolioChange } from '../../server/portfolio-changes';

const snapshot = (date: string, bankValue?: number): PortfolioSnapshot => ({
  date,
  totalValue: 1000,
  brokerValue: 500,
  cryptoValue: 500,
  shortTermGains: 0,
  longTermGains: 0,
  bankValue,
});

describe('historical balance changes', () => {
  test('uses one calendar month, clamped at leap and non-leap month ends', () => {
    expect(comparisonDay('2024-03-31', '1M')).toBe('2024-02-29');
    expect(comparisonDay('2025-03-31', '1M')).toBe('2025-02-28');
    expect(comparisonDay('2025-01-31', '1M')).toBe('2024-12-31');
    expect(comparisonDay('2025-03-10', '1D')).toBe('2025-03-09');
    expect(comparisonDay('2025-01-03', '7D')).toBe('2024-12-27');
  });

  test('invalid dates are not normalized into another month', () => {
    expect(comparisonDay('2025-02-30', '1D')).toBeNull();
    expect(comparisonDay('bad-date', '1M')).toBeNull();
  });

  test('selects latest history regardless of API order without mutating it', () => {
    const rows = [snapshot('2025-01-10'), snapshot('2025-01-02'), snapshot('invalid')];
    expect(latestSnapshot(rows)?.date).toBe('2025-01-10');
    expect(rows[1].date).toBe('2025-01-02');
    expect(latestSnapshot([])).toBeUndefined();
  });

  test('calculates separate daily, weekly and monthly baselines', () => {
    const rows = [
      snapshot('2025-03-31', 1200),
      snapshot('2025-03-30', 1000),
      snapshot('2025-03-24', 1500),
      snapshot('2025-02-28', 800),
    ];
    expect(portfolioChange(rows, 'bankValue', '2025-03-31', '1D')).toEqual({
      amount: 200,
      percent: 20,
    });
    expect(portfolioChange(rows, 'bankValue', '2025-03-31', '7D')).toEqual({
      amount: -300,
      percent: -20,
    });
    expect(portfolioChange(rows, 'bankValue', '2025-03-31', '1M')).toEqual({
      amount: 400,
      percent: 50,
    });
  });

  test('missing baseline, missing value and missing current value stay unavailable', () => {
    const rows = [snapshot('2025-01-10', 1000), snapshot('2025-01-08', 800)];
    expect(portfolioChange(rows, 'bankValue', '2025-01-10', '1D')).toBeNull();
    expect(
      portfolioChange([...rows, snapshot('2025-01-09')], 'bankValue', '2025-01-10', '1D')
    ).toBeNull();
    expect(
      portfolioChange(
        [snapshot('2025-01-10'), snapshot('2025-01-09', 1000)],
        'bankValue',
        '2025-01-10',
        '1D'
      )
    ).toBeNull();
  });

  test('zero and negative balances are observed and never divide by zero', () => {
    const change = (previous: number, current: number) =>
      portfolioChange(
        [snapshot('2025-01-01', previous), snapshot('2025-01-02', current)],
        'bankValue',
        '2025-01-02',
        '1D'
      );
    expect(change(0, 100)).toEqual({ amount: 100, percent: null });
    expect(change(100, 0)).toEqual({ amount: -100, percent: -100 });
    expect(change(-1000, -800)).toEqual({ amount: 200, percent: 20 });
    expect(change(100, 100)).toEqual({ amount: 0, percent: 0 });
    expect(change(NaN, 100)).toBeNull();
    expect(change(100, Infinity)).toBeNull();
  });
});
