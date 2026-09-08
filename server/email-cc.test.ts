import { describe, expect, test } from 'vite-plus/test';
import { buildResendPayload, defaultCcFor } from './email.js';
import { resolveEmailCc } from './data.js';

// All addresses here are fabricated. Each send declares a purpose, and the
// configured CC is split by audience: `cc.news` rides on Newsstand editions,
// `cc.client` on invoices / the weekly timesheet report, and test pings never
// CC. These lock down the rules that make that safe: the right list applies
// per purpose, an explicit cc overrides config, '' suppresses it, nobody is
// both To and Cc, and the legacy single `ccEmail` still maps onto client mail.
const CFG = {
  fromEmail: 'billing@example.com',
  fromName: 'Example LLC',
  toEmail: 'fallback@example.com',
  cc: { news: 'news-copy@example.com', client: 'me@example.com' },
};

const base = { subject: 'Invoice 1', html: '<p>hi</p>' };
const client = { ...base, purpose: 'client' as const };

describe('defaultCcFor', () => {
  test('news → cc.news, client → cc.client, test → nothing', () => {
    expect(defaultCcFor('news', CFG.cc)).toBe('news-copy@example.com');
    expect(defaultCcFor('client', CFG.cc)).toBe('me@example.com');
    expect(defaultCcFor('test', CFG.cc)).toBeUndefined();
  });
});

describe('buildResendPayload cc by purpose', () => {
  test('a client send applies the client CC when the caller passes none', () => {
    const { payload, cc } = buildResendPayload({ ...client, to: 'client@acme.test' }, CFG);
    expect(cc).toEqual(['me@example.com']);
    expect(payload?.cc).toEqual(['me@example.com']);
  });

  test('a news send applies the news CC, not the client one', () => {
    const { payload } = buildResendPayload({ ...base, purpose: 'news' }, CFG);
    expect(payload?.to).toEqual(['fallback@example.com']);
    expect(payload?.cc).toEqual(['news-copy@example.com']);
  });

  test('a news send with no news CC configured copies nobody — the client CC must not leak', () => {
    const { payload, cc } = buildResendPayload(
      { ...base, purpose: 'news' },
      { ...CFG, cc: { client: 'me@example.com' } }
    );
    expect(cc).toEqual([]);
    expect(payload).not.toHaveProperty('cc');
  });

  test('a test ping never CCs even when both lists are configured', () => {
    const { payload, cc } = buildResendPayload({ ...base, purpose: 'test' }, CFG);
    expect(cc).toEqual([]);
    expect(payload).not.toHaveProperty('cc');
  });

  test('an explicit cc overrides the configured default', () => {
    const { payload } = buildResendPayload(
      { ...client, to: 'client@acme.test', cc: 'other@example.com' },
      CFG
    );
    expect(payload?.cc).toEqual(['other@example.com']);
  });

  test('an explicit empty cc suppresses the configured default', () => {
    const { payload, cc } = buildResendPayload({ ...client, to: 'client@acme.test', cc: '' }, CFG);
    expect(cc).toEqual([]);
    expect(payload).not.toHaveProperty('cc');
  });

  test('splits a multi-address cc the same way as to', () => {
    const { cc } = buildResendPayload(
      { ...client, to: 'client@acme.test', cc: 'a@example.com, b@example.com\nc@example.com' },
      CFG
    );
    expect(cc).toEqual(['a@example.com', 'b@example.com', 'c@example.com']);
  });

  test('never cc an address already on the To line, case-insensitively', () => {
    const { payload, cc } = buildResendPayload(
      { ...client, to: 'client@acme.test, ME@example.com' },
      CFG
    );
    expect(cc).toEqual([]);
    expect(payload).not.toHaveProperty('cc');
    expect(payload?.to).toEqual(['client@acme.test', 'ME@example.com']);
  });

  test('omits cc entirely when none is configured', () => {
    const { payload, cc } = buildResendPayload(
      { ...client, to: 'client@acme.test' },
      { ...CFG, cc: {} }
    );
    expect(cc).toEqual([]);
    expect(payload).not.toHaveProperty('cc');
  });

  test('a cc does not rescue a payload that has no recipients', () => {
    const { error } = buildResendPayload({ ...client, to: '' }, { ...CFG, toEmail: undefined });
    expect(error).toBe('No to address configured');
  });
});

describe('resolveEmailCc (settings → per-purpose lists)', () => {
  test('the legacy single ccEmail maps onto client mail only', () => {
    expect(resolveEmailCc({ ccEmail: 'me@example.com' })).toEqual({
      news: undefined,
      client: 'me@example.com',
    });
  });

  test('a split cc object wins over the legacy field', () => {
    expect(
      resolveEmailCc({ ccEmail: 'old@example.com', cc: { news: 'n@example.com', client: '' } })
    ).toEqual({ news: 'n@example.com', client: undefined });
  });

  test('an empty client slot in the split object does NOT fall back to the legacy value', () => {
    // Once the user has saved the split form, clearing a box must mean "no CC".
    expect(resolveEmailCc({ ccEmail: 'old@example.com', cc: {} })).toEqual({
      news: undefined,
      client: undefined,
    });
  });

  test('whitespace-only lists resolve to undefined', () => {
    expect(resolveEmailCc({ cc: { news: '  ', client: '\n' } })).toEqual({
      news: undefined,
      client: undefined,
    });
  });

  test('no email settings at all → no CC anywhere', () => {
    expect(resolveEmailCc(undefined)).toEqual({ news: undefined, client: undefined });
  });
});
