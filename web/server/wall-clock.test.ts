// Pure wall-clock formatting tests. No I/O, no fixtures beyond clock strings.

import { describe, expect, test } from 'vite-plus/test';
import {
  formatTimeRange,
  formatWallClock,
  formatWallClockShort,
  isValidTime,
} from './wall-clock.js';

describe('isValidTime', () => {
  test('accepts zero-padded 24-hour times only', () => {
    expect(isValidTime('00:00')).toBe(true);
    expect(isValidTime('23:59')).toBe(true);
    expect(isValidTime('24:00')).toBe(false);
    expect(isValidTime('12:60')).toBe(false);
    expect(isValidTime('9:00')).toBe(false);
    expect(isValidTime('09:00:00')).toBe(false);
    expect(isValidTime('5pm')).toBe(false);
  });
});

describe('formatWallClock', () => {
  test('12-hour display around midnight and noon', () => {
    expect(formatWallClock('00:05')).toBe('12:05 AM');
    expect(formatWallClock('09:30')).toBe('9:30 AM');
    expect(formatWallClock('12:00')).toBe('12:00 PM');
    expect(formatWallClock('17:00')).toBe('5:00 PM');
  });

  test('hour24 passes the value through', () => {
    expect(formatWallClock('17:00', true)).toBe('17:00');
  });

  test('short form drops :00 for grid chips', () => {
    expect(formatWallClockShort('17:00')).toBe('5pm');
    expect(formatWallClockShort('17:30')).toBe('5:30pm');
    expect(formatWallClockShort('00:00')).toBe('12am');
    expect(formatWallClockShort('12:15')).toBe('12:15pm');
  });

  test('range shows both ends, or just the start', () => {
    expect(formatTimeRange('14:00', '15:30')).toBe('2:00 PM – 3:30 PM');
    expect(formatTimeRange('17:00')).toBe('5:00 PM');
  });
});
