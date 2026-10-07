import { describe, expect, test } from 'vite-plus/test';
import {
  buildAmortization,
  compareAmortization,
  formatTerm,
  formatMonthYear,
} from './amortization';

// Standard mortgage payment formula, used to derive exact-term test inputs.
function monthlyPI(principal: number, annualRate: number, termMonths: number): number {
  const r = annualRate / 12;
  if (r === 0) return principal / termMonths;
  return (principal * r) / (1 - Math.pow(1 + r, -termMonths));
}

const JAN_2026 = new Date(2026, 0, 1);

describe('buildAmortization', () => {
  test('zero-interest loan amortizes in exactly balance / payment months', () => {
    const result = buildAmortization({
      balance: 1200,
      annualRate: 0,
      monthlyPayment: 100,
      startDate: JAN_2026,
    });
    expect(result.months).toBe(12);
    expect(result.totalInterest).toBe(0);
    expect(result.totalPaid).toBeCloseTo(1200, 2);
    expect(result.rows[result.rows.length - 1].balance).toBe(0);
    // First payment is January 2026, twelfth is December 2026.
    expect(result.payoffDate).toBe('2026-12-01');
  });

  test('30-year mortgage at its exact P&I payment retires in 360 months', () => {
    const payment = monthlyPI(100_000, 0.06, 360);
    const result = buildAmortization({
      balance: 100_000,
      annualRate: 0.06,
      monthlyPayment: payment,
      startDate: JAN_2026,
    });
    expect(result.months).toBe(360);
    // Total interest on a 100k/6%/30yr loan is ~$115,838.
    expect(Math.abs(result.totalInterest - 115_838.19)).toBeLessThan(5);
    expect(result.rows[result.rows.length - 1].balance).toBe(0);
    expect(result.negativeAmortization).toBe(false);
  });

  test('each row splits payment into interest + principal that reduces the balance', () => {
    const result = buildAmortization({
      balance: 10_000,
      annualRate: 0.12, // 1% per month
      monthlyPayment: 1000,
      startDate: JAN_2026,
    });
    const first = result.rows[0];
    expect(first.interest).toBeCloseTo(100, 6); // 10,000 * 0.01
    expect(first.principal).toBeCloseTo(900, 6); // 1000 - 100
    expect(first.balance).toBeCloseTo(9100, 6);
    // Interest shrinks as the balance falls.
    expect(result.rows[1].interest).toBeLessThan(first.interest);
    expect(result.rows[result.rows.length - 1].balance).toBe(0);
  });

  test('flags negative amortization when the payment cannot cover interest', () => {
    const result = buildAmortization({
      balance: 100_000,
      annualRate: 0.12, // first-month interest = $1,000
      monthlyPayment: 500,
      startDate: JAN_2026,
    });
    expect(result.negativeAmortization).toBe(true);
    expect(result.months).toBe(0);
    expect(result.payoffDate).toBeNull();
    expect(result.firstMonthInterest).toBeCloseTo(1000, 6);
  });

  test('a tiny balance pays off in a single trimmed final payment', () => {
    const result = buildAmortization({
      balance: 250,
      annualRate: 0.06,
      monthlyPayment: 1000,
      startDate: JAN_2026,
    });
    expect(result.months).toBe(1);
    // Final payment is only interest + the remaining $250, not the full $1,000.
    expect(result.rows[0].payment).toBeLessThan(1000);
    expect(result.rows[0].balance).toBe(0);
  });
});

describe('compareAmortization', () => {
  const loan = {
    balance: 100_000,
    annualRate: 0.06,
    monthlyPayment: monthlyPI(100_000, 0.06, 360),
    startDate: JAN_2026,
  };

  test('extra monthly principal shortens the term and saves interest', () => {
    const cmp = compareAmortization(loan, { extraMonthly: 200 });
    expect(cmp.monthsSaved).toBeGreaterThan(0);
    expect(cmp.interestSaved).toBeGreaterThan(0);
    expect(cmp.scenario.months).toBeLessThan(cmp.base.months);
  });

  test('a one-time lump sum saves interest and time', () => {
    const cmp = compareAmortization(loan, { oneTimeExtra: 20_000, oneTimeMonthIndex: 1 });
    expect(cmp.interestSaved).toBeGreaterThan(0);
    expect(cmp.monthsSaved).toBeGreaterThan(0);
  });

  test('no extra payment yields identical schedules (zero saved)', () => {
    const cmp = compareAmortization(loan, {});
    expect(cmp.monthsSaved).toBe(0);
    expect(cmp.interestSaved).toBeCloseTo(0, 6);
  });

  test('more extra never costs more time or interest than less extra (monotonic)', () => {
    const small = compareAmortization(loan, { extraMonthly: 100 });
    const large = compareAmortization(loan, { extraMonthly: 500 });
    expect(large.monthsSaved).toBeGreaterThanOrEqual(small.monthsSaved);
    expect(large.interestSaved).toBeGreaterThanOrEqual(small.interestSaved);
  });
});

describe('formatters', () => {
  test('formatTerm renders years and months', () => {
    expect(formatTerm(0)).toBe('—');
    expect(formatTerm(5)).toBe('5 mo');
    expect(formatTerm(12)).toBe('1 yr');
    expect(formatTerm(13)).toBe('1 yr 1 mo');
    expect(formatTerm(172)).toBe('14 yr 4 mo');
  });

  test('formatMonthYear renders a short month-year label', () => {
    expect(formatMonthYear(null)).toBe('—');
    expect(formatMonthYear('2026-12-01')).toBe('Dec 2026');
  });
});
