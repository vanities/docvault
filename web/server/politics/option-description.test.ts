// Option-description parsing — golden tests against REAL House PTR DESCRIPTION
// strings (public congressional disclosures, Nancy Pelosi filings 2025–2026).

import { describe, expect, test } from 'vite-plus/test';
import { formatOptionLabel, parseOptionDescription } from './option-description.js';

describe('parseOptionDescription — real disclosure strings', () => {
  test('purchased calls with strike + expiry', () => {
    expect(
      parseOptionDescription(
        'Purchased 50 call options with a strike price of $150 and an expiration date of 1/16/26.'
      )
    ).toEqual({
      optionType: 'call',
      action: 'purchase',
      contracts: 50,
      strike: 150,
      expiry: '2026-01-16',
      shares: null,
    });
  });

  test('purchased calls, 2-digit forward year', () => {
    expect(
      parseOptionDescription(
        'Purchased 20 call options with a strike price of $120 and an expiration date of 1/15/27.'
      )
    ).toMatchObject({ contracts: 20, strike: 120, expiry: '2027-01-15', action: 'purchase' });
  });

  test('exercised calls — captures contracts, strike, expiry, resulting shares', () => {
    expect(
      parseOptionDescription(
        'Exercised 500 call options purchased 11/22/23 (50,000 shares) at a strike price of $12 with an expiration date of 12/20/24.'
      )
    ).toEqual({
      optionType: 'call',
      action: 'exercise',
      contracts: 500,
      strike: 12,
      expiry: '2024-12-20',
      shares: 50000,
    });
  });

  test('exercised calls with two open dates ("2/12/24 & 2/21/24")', () => {
    expect(
      parseOptionDescription(
        'Exercised 140 call options purchased 2/12/24 & 2/21/24 (14,000 shares) at a strike price of $100 with an expiration date of 12/20/24.'
      )
    ).toMatchObject({
      action: 'exercise',
      contracts: 140,
      strike: 100,
      shares: 14000,
      expiry: '2024-12-20',
    });
  });

  test('puts are distinguished from calls', () => {
    expect(
      parseOptionDescription(
        'Purchased 10 put options with a strike price of $90 and an expiration date of 6/20/25.'
      )
    ).toMatchObject({ optionType: 'put', action: 'purchase', strike: 90, expiry: '2025-06-20' });
  });

  test('a wrapped expiry still parses once the lines are joined', () => {
    // The PDF wraps "...expiration date of" onto the next line ("1/16/26.").
    expect(
      parseOptionDescription(
        'Exercised 50 call options purchased 1/14/25 (5,000 shares) at a strike price of $150 with an expiration date of 1/16/26.'
      )
    ).toMatchObject({ strike: 150, expiry: '2026-01-16', shares: 5000 });
  });

  test('non-option descriptions return null', () => {
    expect(parseOptionDescription('Sold 31,600 shares.')).toBeNull();
    expect(parseOptionDescription('Purchased 25,000 shares.')).toBeNull();
    expect(
      parseOptionDescription('Contribution of 7,704 shares held personally to Donor-Advised Fund.')
    ).toBeNull();
    expect(parseOptionDescription('')).toBeNull();
    expect(parseOptionDescription(null)).toBeNull();
  });
});

describe('formatOptionLabel', () => {
  test('compact contract label', () => {
    expect(
      formatOptionLabel('GOOGL', {
        optionType: 'call',
        action: 'purchase',
        contracts: 20,
        strike: 150,
        expiry: '2027-01-15',
        shares: null,
      })
    ).toBe('GOOGL $150C 1/15/27');
  });

  test('put label without strike falls back gracefully', () => {
    expect(
      formatOptionLabel('AAPL', {
        optionType: 'put',
        action: 'sale',
        contracts: null,
        strike: null,
        expiry: null,
        shares: null,
      })
    ).toBe('AAPL Puts');
  });
});
