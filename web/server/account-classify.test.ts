// Account classification tests. SimpleFIN returns no account type, so the type
// is inferred from the name — which makes substring matching dangerous.
//
// Every name, mask, and balance below is fabricated. "PASCHKE" is a stand-in
// for the real shape of the bug: a surname where the letter run "chk" appears
// INSIDE the word (pas-CHK-e), which the old `includes('chk')` check read as
// the CHK checking abbreviation and used to file business credit cards under
// Checking. Plenty of surnames have that run, so the case belongs in the suite.
import { describe, expect, test } from 'vite-plus/test';
import {
  ACCOUNT_ANNOTATION_TYPES,
  accountIconKind,
  accountTypeLabel,
  categorizeAccount,
  isAccountAnnotationType,
} from './account-classify.js';

describe('categorizeAccount — substring safety', () => {
  test('a name containing the "chk" letter run is NOT a checking account', () => {
    // The regression: a card issued in a personal name, with no product word.
    expect(categorizeAccount('J. PASCHKE (4242)', undefined, -42.42)).toBe('other-liability');
    expect(accountTypeLabel('J. PASCHKE (4242)', undefined, -42.42)).not.toBe('Checking');
  });

  test('a standalone CHK token still reads as checking', () => {
    expect(categorizeAccount('BUS COMPLETE CHK (1111)', undefined, 500.0)).toBe('depository');
    expect(accountTypeLabel('BUS COMPLETE CHK (1111)', undefined, 500.0)).toBe('Checking');
  });

  test('"Checking" spelled out still reads as checking', () => {
    expect(accountTypeLabel('EveryDay Checking - 5555', undefined, 2500.0)).toBe('Checking');
  });
});

describe('categorizeAccount — annotation wins over the name', () => {
  test('an annotated credit card beats an unhelpful name', () => {
    const ann = { type: 'credit-card' as const };
    expect(categorizeAccount('J. PASCHKE (4242)', ann, -42.42)).toBe('credit-card');
    expect(accountTypeLabel('J. PASCHKE (4242)', ann, -42.42)).toBe('Credit Card');
    expect(accountIconKind('J. PASCHKE (4242)', ann, -42.42)).toBe('card');
  });

  test('an annotation overrides even a name that looks depository', () => {
    const ann = { type: 'credit-card' as const };
    expect(categorizeAccount('BUS COMPLETE CHK (1111)', ann, -10)).toBe('credit-card');
  });

  test('type "other" does not hijack the name inference', () => {
    // 'other' is a catch-all note, not a category claim — the name should still win.
    const ann = { type: 'other' as const };
    expect(categorizeAccount('Acme Rewards Visa (2222)', ann, -321.0)).toBe('credit-card');
  });
});

describe('categorizeAccount — a negative balance is never cash', () => {
  test('an unrecognized name with money owed is flagged, not filed as checking', () => {
    expect(categorizeAccount('Mystery Account (9999)', undefined, -100)).toBe('other-liability');
    expect(accountTypeLabel('Mystery Account (9999)', undefined, -100)).toBe('Liability');
  });

  test('an unrecognized name in the black is a plain depository account', () => {
    expect(categorizeAccount('Mystery Account (9999)', undefined, 100)).toBe('depository');
    expect(accountTypeLabel('Mystery Account (9999)', undefined, 100)).toBe('Account');
  });

  test('a zero balance is not treated as a liability', () => {
    expect(categorizeAccount('Mystery Account (9999)', undefined, 0)).toBe('depository');
  });
});

describe('categorizeAccount — product names', () => {
  test.each([
    ['Acme Prime Rewards Visa Signature (2222)', 'credit-card', 'Credit Card'],
    ['Globex Gold Card — American Express (6666)', 'credit-card', 'Credit Card'],
    ['Checking Line of Credit - 5555', 'line-of-credit', 'Line of Credit'],
    ['New Vehicle Loan - 7777', 'auto-loan', 'Auto Loan'],
    ['Money Market Savings - 8888', 'depository', 'Money Market'],
    ['Membership Share Savings - 1234', 'depository', 'Savings'],
    ['ACME BUS TOTAL SAV (3333)', 'depository', 'Savings'],
  ])('%s -> %s / %s', (name, category, label) => {
    expect(categorizeAccount(name, undefined, 0)).toBe(category);
    expect(accountTypeLabel(name, undefined, 0)).toBe(label);
  });

  test('"line of credit" is not swallowed by the word "Checking" in the name', () => {
    // "Checking Line of Credit" contains "checking" but is a borrowing line.
    expect(accountTypeLabel('Checking Line of Credit - 5555', undefined, 0)).toBe('Line of Credit');
  });
});

describe('ACCOUNT_ANNOTATION_TYPES', () => {
  test('every option value is a valid annotation type', () => {
    for (const t of ACCOUNT_ANNOTATION_TYPES) {
      expect(isAccountAnnotationType(t.value)).toBe(true);
    }
  });

  test('an unknown string is rejected', () => {
    expect(isAccountAnnotationType('')).toBe(false);
    expect(isAccountAnnotationType('checking')).toBe(false);
  });
});
