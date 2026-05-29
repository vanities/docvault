import { describe, expect, test } from 'vitest';
import { parseDomain } from './research';

describe('parseDomain', () => {
  test('accepts finance, health, and politics domains', () => {
    expect(parseDomain('finance')).toBe('finance');
    expect(parseDomain('health')).toBe('health');
    expect(parseDomain('politics')).toBe('politics');
  });

  test('defaults unknown or missing domains to finance for legacy callers', () => {
    expect(parseDomain(undefined)).toBe('finance');
    expect(parseDomain('unknown')).toBe('finance');
  });
});
