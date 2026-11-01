// Reply-address building/parsing and quoted-reply stripping. Fabricated addresses only.
import { describe, expect, test } from 'vite-plus/test';
import {
  buildReplyLocalPart,
  extractAddress,
  parseReplyLocalPart,
  stripQuotedReply,
} from './reply-address.js';

describe('reply local parts', () => {
  test('build and parse round-trip', () => {
    const local = buildReplyLocalPart('aabbccdd-1111-4222-8333-444455556666', 'abcdef0123456789');
    expect(local).toBe('a-aabbccdd-abcdef0123456789');
    expect(parseReplyLocalPart(local)).toEqual({
      idPrefix: 'aabbccdd',
      token: 'abcdef0123456789',
    });
  });

  test('parsing is case-insensitive and trims', () => {
    expect(parseReplyLocalPart(' A-AABBCCDD-ABCDEF0123456789 ')).toEqual({
      idPrefix: 'aabbccdd',
      token: 'abcdef0123456789',
    });
  });

  test('anything that is not an assignment address parses to null', () => {
    for (const bad of [
      'a-aabbccdd',
      'a-aabbccdd-shorttoken',
      'b-aabbccdd-abcdef0123456789',
      'a-aabbccdd-abcdef0123456789-extra',
      'a-aabbccdd-abcdef0123456789+tag',
      'dvtest7q',
      '',
    ]) {
      expect(parseReplyLocalPart(bad)).toBeNull();
    }
  });
});

describe('extractAddress', () => {
  test('reads angled, bare and missing forms, lowercased', () => {
    expect(extractAddress('John Doe <John@Example.COM>')).toBe('john@example.com');
    expect(extractAddress('owner@example.com')).toBe('owner@example.com');
    expect(extractAddress('not an address')).toBeNull();
    expect(extractAddress('')).toBeNull();
    expect(extractAddress(undefined)).toBeNull();
  });
});

describe('stripQuotedReply', () => {
  test('cuts at a one-line "On ... wrote:" attribution (Proton, Apple Mail)', () => {
    const text = [
      'Switch to hourly checks please.',
      '',
      'On Saturday, November 1st, 2026 at 7:15 AM, DocVault Assignments <a-1@r.test> wrote:',
      '> Not safe yet: 3/5 green',
    ].join('\n');
    expect(stripQuotedReply(text)).toBe('Switch to hourly checks please.');
  });

  test('cuts at a wrapped two-line attribution (Gmail)', () => {
    const text = [
      'Yes, go ahead.',
      '',
      'On Sat, Nov 1, 2026 at 9:00 AM DocVault Assignments',
      '<a-1@r.test> wrote:',
      '> details',
    ].join('\n');
    expect(stripQuotedReply(text)).toBe('Yes, go ahead.');
  });

  test('cuts at the first "> " quote line or an Outlook divider', () => {
    expect(stripQuotedReply('Thanks!\n> earlier email')).toBe('Thanks!');
    expect(stripQuotedReply('Thanks!\n________________________________\nFrom: X')).toBe('Thanks!');
  });

  test('keeps a message with no quoted history, trimmed', () => {
    expect(stripQuotedReply('  Just checking in.\n')).toBe('Just checking in.');
    // Starts with "On " but no "wrote:" follows, so it is prose, not an attribution.
    expect(stripQuotedReply('On balance, I think we should wait.')).toBe(
      'On balance, I think we should wait.'
    );
  });
});
