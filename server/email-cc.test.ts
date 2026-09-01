import { describe, expect, test } from 'vite-plus/test';
import { buildResendPayload } from './email.js';

// All addresses here are fabricated. The configured `ccEmail` is copied on every
// outbound email; these lock down the three rules that make that safe:
// an explicit cc overrides config, '' suppresses it, and nobody is both To and Cc.
const CFG = {
  fromEmail: 'billing@example.com',
  fromName: 'Example LLC',
  toEmail: 'fallback@example.com',
  ccEmail: 'me@example.com',
};

const base = { subject: 'Invoice 1', html: '<p>hi</p>' };

describe('buildResendPayload cc', () => {
  test('applies the configured ccEmail when the caller passes none', () => {
    const { payload, cc } = buildResendPayload({ ...base, to: 'client@acme.test' }, CFG);
    expect(cc).toEqual(['me@example.com']);
    expect(payload?.cc).toEqual(['me@example.com']);
  });

  test('an explicit cc overrides the configured default', () => {
    const { payload } = buildResendPayload(
      { ...base, to: 'client@acme.test', cc: 'other@example.com' },
      CFG
    );
    expect(payload?.cc).toEqual(['other@example.com']);
  });

  test('an explicit empty cc suppresses the configured default', () => {
    const { payload, cc } = buildResendPayload({ ...base, to: 'client@acme.test', cc: '' }, CFG);
    expect(cc).toEqual([]);
    expect(payload).not.toHaveProperty('cc');
  });

  test('splits a multi-address cc the same way as to', () => {
    const { cc } = buildResendPayload(
      { ...base, to: 'client@acme.test', cc: 'a@example.com, b@example.com\nc@example.com' },
      CFG
    );
    expect(cc).toEqual(['a@example.com', 'b@example.com', 'c@example.com']);
  });

  test('never cc an address already on the To line, case-insensitively', () => {
    const { payload, cc } = buildResendPayload(
      { ...base, to: 'client@acme.test, ME@example.com' },
      CFG
    );
    expect(cc).toEqual([]);
    expect(payload).not.toHaveProperty('cc');
    expect(payload?.to).toEqual(['client@acme.test', 'ME@example.com']);
  });

  test('omits cc entirely when none is configured', () => {
    const { payload, cc } = buildResendPayload(
      { ...base, to: 'client@acme.test' },
      { ...CFG, ccEmail: undefined }
    );
    expect(cc).toEqual([]);
    expect(payload).not.toHaveProperty('cc');
  });

  test('a cc does not rescue a payload that has no recipients', () => {
    const { error } = buildResendPayload(
      { ...base, to: '' },
      { ...CFG, toEmail: undefined, ccEmail: 'me@example.com' }
    );
    expect(error).toBe('No to address configured');
  });
});
