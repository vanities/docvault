// Synthetic quotes only; no household positions or real prices.
import { describe, expect, test } from 'vite-plus/test';
import { marketPerformance, performanceSymbol, positionChange } from '../../server/market-changes';

const close = (day: string, price: number | null) => ({
  date: new Date(`${day}T20:00:00Z`),
  close: price,
});

describe('historical market performance', () => {
  test('uses prior trading close for 1D and calendar periods for 7D / 1M', () => {
    const result = marketPerformance(120, new Date('2025-03-31T19:00:00Z'), 'America/New_York', [
      close('2025-03-31', 120),
      close('2025-03-28', 100),
      close('2025-03-24', 150),
      close('2025-02-28', 80),
    ]);
    expect(result?.changes['1D']).toEqual({ amount: 20, percent: 20, baselineDate: '2025-03-28' });
    expect(result?.changes['7D']).toEqual({
      amount: -30,
      percent: -20,
      baselineDate: '2025-03-24',
    });
    expect(result?.changes['1M']).toEqual({ amount: 40, percent: 50, baselineDate: '2025-02-28' });
  });

  test('uses the exchange date instead of the UTC date near midnight', () => {
    const result = marketPerformance(110, new Date('2025-03-11T00:30:00Z'), 'America/New_York', [
      close('2025-03-10', 105),
      close('2025-03-07', 100),
    ]);
    expect(result?.changes['1D']?.baselineDate).toBe('2025-03-07');
    expect(result?.changes['1D']?.percent).toBe(10);
  });

  test('does not extrapolate through stale, missing or invalid historical quotes', () => {
    const result = marketPerformance(100, new Date('2025-03-31T19:00:00Z'), 'UTC', [
      close('2025-03-30', null),
      close('2025-03-29', NaN),
      close('2025-03-28', 0),
      close('2025-03-20', 80),
    ]);
    expect(result?.changes['1D']).toBeNull();
    expect(result?.changes['1M']).toBeNull();
    expect(marketPerformance(NaN, new Date(), 'UTC', [])).toBeNull();
    expect(marketPerformance(100, new Date('invalid'), 'UTC', [])).toBeNull();
  });

  test('scales dollars to current units, keeps percentages, and rejects non-USD quotes', () => {
    const quote = {
      symbol: 'ACME',
      currency: 'USD',
      performance: marketPerformance(110, new Date('2025-03-31T19:00:00Z'), 'UTC', [
        close('2025-03-30', 100),
      ]),
    };
    expect(positionChange(quote, 2.5, '1D')).toEqual({
      amount: 25,
      percent: 10,
      baselineDate: '2025-03-30',
    });
    expect(positionChange({ ...quote, currency: 'EUR' }, 2.5, '1D')).toBeNull();
    expect(positionChange(quote, NaN, '1D')).toBeNull();
    expect(positionChange(undefined, 1, '1D')).toBeNull();
  });

  test('maps crypto to USD pairs and leaves unsupported identifiers unavailable', () => {
    expect(performanceSymbol(' btc ', true)).toBe('BTC-USD');
    expect(performanceSymbol('acme')).toBe('ACME');
    expect(performanceSymbol('123456AB9')).toBeNull();
    expect(performanceSymbol('USD', true)).toBeNull();
    expect(performanceSymbol('$CASH')).toBeNull();
  });
});
