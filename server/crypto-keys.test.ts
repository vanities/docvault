// Tests for server/crypto-keys.ts
//
// Committed to git (exception in .gitignore, same pattern as quant.test.ts):
// pure crypto primitives, no personal data. All inputs below are synthetic.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test';
import {
  __resetEnvKeyCacheForTesting,
  assertMasterKeyConfigured,
  decryptField,
  decryptWithKey,
  deriveKey,
  encryptField,
  encryptWithKey,
  isEncryptedValue,
  walkSensitiveFields,
} from './crypto-keys.js';
import type { Settings } from './data.js';

// ============================================================================
// Primitives (key-parameterized)
// ============================================================================

describe('deriveKey', () => {
  test('same input yields same 32-byte key', () => {
    const a = deriveKey('correct horse battery staple hunter2');
    const b = deriveKey('correct horse battery staple hunter2');
    expect(a.length).toBe(32);
    expect(a.equals(b)).toBe(true);
  });

  test('different inputs yield different keys', () => {
    const a = deriveKey('key-one-very-long');
    const b = deriveKey('key-two-very-long');
    expect(a.equals(b)).toBe(false);
  });
});

describe('isEncryptedValue', () => {
  test('identifies enc:v1: prefix', () => {
    expect(isEncryptedValue('enc:v1:abc')).toBe(true);
  });

  test('rejects other strings', () => {
    expect(isEncryptedValue('sk-ant-api03-xyz')).toBe(false);
    expect(isEncryptedValue('')).toBe(false);
    expect(isEncryptedValue(undefined)).toBe(false);
    expect(isEncryptedValue(null)).toBe(false);
    expect(isEncryptedValue(42)).toBe(false);
  });
});

describe('encryptWithKey + decryptWithKey round-trip', () => {
  const key = deriveKey('test-master-key-0123456789abcdef');

  test('round-trips plaintext', () => {
    const plaintext = 'sk-ant-api03-SECRET-TEST-VALUE';
    const ct = encryptWithKey(plaintext, key);
    expect(ct).toBeDefined();
    expect(ct!.startsWith('enc:v1:')).toBe(true);
    expect(decryptWithKey(ct, key)).toBe(plaintext);
  });

  test('round-trips values with special characters', () => {
    const plaintext = 'line1\nline2\t"quoted"  https://u:p@h/path?q=1&x=2';
    const ct = encryptWithKey(plaintext, key);
    expect(decryptWithKey(ct, key)).toBe(plaintext);
  });

  test('round-trips unicode', () => {
    const plaintext = 'héllo 你好 🔐 émojis-ok';
    expect(decryptWithKey(encryptWithKey(plaintext, key), key)).toBe(plaintext);
  });

  test('round-trips long values (PEM-like)', () => {
    const plaintext =
      '-----BEGIN EC PRIVATE KEY-----\n' + 'ABCD'.repeat(200) + '\n-----END EC PRIVATE KEY-----\n';
    expect(decryptWithKey(encryptWithKey(plaintext, key), key)).toBe(plaintext);
  });
});

describe('encryptWithKey — semantic security', () => {
  test('same plaintext with same key produces DIFFERENT ciphertexts (random IV)', () => {
    const key = deriveKey('the-key-16plus-chars');
    const a = encryptWithKey('hello', key);
    const b = encryptWithKey('hello', key);
    expect(a).not.toBe(b);
    // But both still decrypt to "hello":
    expect(decryptWithKey(a, key)).toBe('hello');
    expect(decryptWithKey(b, key)).toBe('hello');
  });
});

describe('encryptWithKey — idempotence', () => {
  const key = deriveKey('idempotence-test-key');

  test('already-encrypted value passes through unchanged', () => {
    const ct = encryptWithKey('original', key);
    const ct2 = encryptWithKey(ct, key);
    expect(ct2).toBe(ct);
  });
});

describe('encryptWithKey / decryptWithKey — empty & nullish', () => {
  const key = deriveKey('empty-tests-key-padded');

  test('undefined passes through both ways', () => {
    expect(encryptWithKey(undefined, key)).toBeUndefined();
    expect(decryptWithKey(undefined, key)).toBeUndefined();
  });

  test('empty string passes through both ways', () => {
    expect(encryptWithKey('', key)).toBe('');
    expect(decryptWithKey('', key)).toBe('');
  });
});

describe('decryptWithKey — passthrough for plaintext', () => {
  const key = deriveKey('passthrough-test-key');

  test('value without enc:v1: prefix returns unchanged (legacy compat)', () => {
    expect(decryptWithKey('plain-legacy-value', key)).toBe('plain-legacy-value');
  });
});

describe('decryptWithKey — wrong key rejected', () => {
  test('GCM auth-tag mismatch throws', () => {
    const goodKey = deriveKey('the-correct-master-key');
    const wrongKey = deriveKey('a-totally-different-key');
    const ct = encryptWithKey('confidential', goodKey)!;
    expect(() => decryptWithKey(ct, wrongKey)).toThrow(/Failed to decrypt/);
  });

  test('tampered ciphertext throws', () => {
    const key = deriveKey('tamper-detection-test-key');
    const ct = encryptWithKey('confidential payload worth a few bytes', key)!;
    // Flip a character in the middle of the base64 payload (away from end
    // padding) — GCM auth tag must catch any mutation to iv/tag/ciphertext.
    const prefix = ct.slice(0, 'enc:v1:'.length);
    const body = ct.slice('enc:v1:'.length);
    const midIdx = Math.floor(body.length / 2);
    const swapped = body[midIdx] === 'A' ? 'B' : 'A';
    const mutated = prefix + body.slice(0, midIdx) + swapped + body.slice(midIdx + 1);
    expect(mutated).not.toBe(ct); // sanity: we actually changed something
    expect(() => decryptWithKey(mutated, key)).toThrow();
  });

  test('truncated payload throws with specific message', () => {
    const key = deriveKey('truncation-test-key-ok');
    expect(() => decryptWithKey('enc:v1:YQ==', key)).toThrow(/too short/);
  });
});

// ============================================================================
// Env-derived wrappers
// ============================================================================

describe('encryptBytes + decryptBytes round-trip', () => {
  const key = deriveKey('bytes-test-key-long-enough');

  test('round-trips a text payload as Buffer', async () => {
    const { encryptBytes, decryptBytes } = await import('./crypto-keys.js');
    const plaintext = Buffer.from('hello DNA traits', 'utf-8');
    const ct = encryptBytes(plaintext, key);
    expect(ct.length).toBeGreaterThan(28); // at least iv(12) + tag(16)
    expect(decryptBytes(ct, key).equals(plaintext)).toBe(true);
  });

  test('preserves binary fidelity (non-UTF-8 bytes)', async () => {
    const { encryptBytes, decryptBytes } = await import('./crypto-keys.js');
    const binary = Buffer.from([0x00, 0xff, 0x42, 0xca, 0xfe, 0xba, 0xbe, 0xde, 0xad]);
    const ct = encryptBytes(binary, key);
    expect(decryptBytes(ct, key).equals(binary)).toBe(true);
  });

  test('wrong key rejected', async () => {
    const { encryptBytes, decryptBytes } = await import('./crypto-keys.js');
    const wrongKey = deriveKey('a-different-bytes-key');
    const ct = encryptBytes(Buffer.from('secret'), key);
    expect(() => decryptBytes(ct, wrongKey)).toThrow(/Failed to decrypt bytes/);
  });

  test('truncated payload throws', async () => {
    const { decryptBytes } = await import('./crypto-keys.js');
    expect(() => decryptBytes(Buffer.alloc(10), key)).toThrow(/shorter than header/);
  });
});

describe('env-based wrappers', () => {
  const TEST_MASTER_KEY = 'x'.repeat(32);

  beforeEach(() => {
    __resetEnvKeyCacheForTesting();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    __resetEnvKeyCacheForTesting();
  });

  test('throws when DOCVAULT_MASTER_KEY is unset', () => {
    vi.stubEnv('DOCVAULT_MASTER_KEY', '');
    expect(() => assertMasterKeyConfigured()).toThrow(/DOCVAULT_MASTER_KEY.*not set/);
  });

  test('throws when DOCVAULT_MASTER_KEY is too short', () => {
    vi.stubEnv('DOCVAULT_MASTER_KEY', 'short');
    expect(() => assertMasterKeyConfigured()).toThrow(/at least 16 characters/);
  });

  test('accepts 16-char key', () => {
    vi.stubEnv('DOCVAULT_MASTER_KEY', 'x'.repeat(16));
    expect(() => assertMasterKeyConfigured()).not.toThrow();
  });

  test('encryptField + decryptField round-trip via env', () => {
    vi.stubEnv('DOCVAULT_MASTER_KEY', TEST_MASTER_KEY);
    const ct = encryptField('api-key-under-env');
    expect(ct!.startsWith('enc:v1:')).toBe(true);
    expect(decryptField(ct)).toBe('api-key-under-env');
  });

  test('encryptField is idempotent', () => {
    vi.stubEnv('DOCVAULT_MASTER_KEY', TEST_MASTER_KEY);
    const ct = encryptField('value-once');
    expect(encryptField(ct)).toBe(ct);
  });

  test('key cache: changing env without reset is not detected (by design)', () => {
    vi.stubEnv('DOCVAULT_MASTER_KEY', TEST_MASTER_KEY);
    const ct = encryptField('value-under-A');
    // Simulate env swap without reset — cache still uses the first derived key.
    vi.stubEnv('DOCVAULT_MASTER_KEY', 'y'.repeat(32));
    expect(decryptField(ct)).toBe('value-under-A'); // cache kept 'x'-derived key
    // After explicit reset, new key is picked up:
    __resetEnvKeyCacheForTesting();
    expect(() => decryptField(ct)).toThrow(/Failed to decrypt/);
  });
});

// ============================================================================
// walkSensitiveFields — the single source of truth
// ============================================================================

describe('walkSensitiveFields', () => {
  test('returns a deep clone — does NOT mutate input', () => {
    const original: Settings = { anthropicKey: 'A' };
    const snapshot = JSON.parse(JSON.stringify(original));
    walkSensitiveFields(original, () => 'MUTATED');
    expect(original).toEqual(snapshot);
  });

  test('handles empty settings without error', () => {
    const calls: Array<string | undefined> = [];
    const out = walkSensitiveFields({}, (v) => {
      calls.push(v);
      return v;
    });
    expect(out).toEqual({});
    expect(calls).toEqual([]);
  });

  test('transforms anthropicKey', () => {
    const out = walkSensitiveFields({ anthropicKey: 'plain' }, (v) => (v ? `X(${v})` : v));
    expect(out.anthropicKey).toBe('X(plain)');
  });

  test('transforms all top-level string secrets', () => {
    const s: Settings = {
      anthropicKey: 'A',
      fredApiKey: 'F',
      geoapifyApiKey: 'G',
      healthIngestToken: 'H',
    };
    const out = walkSensitiveFields(s, (v) => (v ? `E(${v})` : v));
    expect(out.anthropicKey).toBe('E(A)');
    expect(out.fredApiKey).toBe('E(F)');
    expect(out.geoapifyApiKey).toBe('E(G)');
    expect(out.healthIngestToken).toBe('E(H)');
  });

  test('transforms schedules.backupPassword', () => {
    const s: Settings = { schedules: { backupPassword: 'bpw' } };
    const out = walkSensitiveFields(s, (v) => (v ? `E(${v})` : v));
    expect(out.schedules?.backupPassword).toBe('E(bpw)');
  });

  test('transforms crypto.etherscanKey and preserves unrelated fields', () => {
    const s: Settings = {
      crypto: {
        exchanges: [],
        wallets: [{ id: 'w1', address: '0xPUBLIC_NOT_SECRET', chain: 'eth', label: 'hot' }],
        etherscanKey: 'ESK',
      },
    };
    const out = walkSensitiveFields(s, (v) => (v ? `E(${v})` : v));
    expect(out.crypto?.etherscanKey).toBe('E(ESK)');
    expect(out.crypto?.wallets).toEqual(s.crypto?.wallets);
  });

  test('transforms every exchange credential field', () => {
    const s: Settings = {
      crypto: {
        exchanges: [
          {
            id: 'gemini',
            apiKey: 'GK',
            apiSecret: 'GS',
            passphrase: 'GP',
            enabled: true,
          },
          {
            id: 'kraken',
            apiKey: 'KK',
            apiSecret: 'KS',
            enabled: false,
          },
        ],
        wallets: [],
      },
    };
    const out = walkSensitiveFields(s, (v) => (v ? `E(${v})` : v));
    expect(out.crypto?.exchanges[0].apiKey).toBe('E(GK)');
    expect(out.crypto?.exchanges[0].apiSecret).toBe('E(GS)');
    expect(out.crypto?.exchanges[0].passphrase).toBe('E(GP)');
    expect(out.crypto?.exchanges[0].enabled).toBe(true); // non-secret preserved
    expect(out.crypto?.exchanges[1].apiKey).toBe('E(KK)');
    expect(out.crypto?.exchanges[1].apiSecret).toBe('E(KS)');
    expect(out.crypto?.exchanges[1].passphrase).toBeUndefined();
  });

  test('transforms snaptrade credential fields; preserves clientId/userId', () => {
    const s: Settings = {
      snaptrade: {
        clientId: 'PUBLIC_CLIENT_ID',
        consumerKey: 'CONSUMER_SECRET',
        userId: 'user-123',
        userSecret: 'USER_SECRET',
      },
    };
    const out = walkSensitiveFields(s, (v) => (v ? `E(${v})` : v));
    expect(out.snaptrade?.clientId).toBe('PUBLIC_CLIENT_ID');
    expect(out.snaptrade?.userId).toBe('user-123');
    expect(out.snaptrade?.consumerKey).toBe('E(CONSUMER_SECRET)');
    expect(out.snaptrade?.userSecret).toBe('E(USER_SECRET)');
  });

  test('transforms simplefin.accessUrl', () => {
    const s: Settings = {
      simplefin: { accessUrl: 'https://user:pass@host/simplefin' },
    };
    const out = walkSensitiveFields(s, (v) => (v ? `E(${v})` : v));
    expect(out.simplefin?.accessUrl).toBe('E(https://user:pass@host/simplefin)');
  });

  test('no-op when sub-objects are missing', () => {
    const s: Settings = { claudeModel: 'claude-sonnet-4-6' };
    const out = walkSensitiveFields(s, () => 'MUTATED');
    expect(out.claudeModel).toBe('claude-sonnet-4-6');
    expect(out.crypto).toBeUndefined();
    expect(out.snaptrade).toBeUndefined();
    expect(out.simplefin).toBeUndefined();
  });

  test('full encrypt → decrypt round-trip across all sensitive fields', () => {
    const key = deriveKey('full-roundtrip-test-key-00');
    const original: Settings = {
      anthropicKey: 'sk-ant-REDACTED',
      fredApiKey: 'FRED_K',
      geoapifyApiKey: 'GEO_K',
      healthIngestToken: 'HIT_K',
      claudeModel: 'claude-sonnet-4-6',
      schedules: {
        backupPassword: 'hunter2-very-secure',
        snapshotEnabled: true,
      },
      crypto: {
        exchanges: [
          {
            id: 'coinbase',
            apiKey: 'CB_KEY',
            apiSecret: '-----BEGIN EC-----\nxxx\n-----END EC-----\n',
            enabled: true,
          },
        ],
        wallets: [{ id: 'w', address: '0xABC', chain: 'eth', label: 'x' }],
        etherscanKey: 'ESK',
      },
      snaptrade: {
        clientId: 'CLIENT_PUB',
        consumerKey: 'CK',
        userId: 'user-1',
        userSecret: 'US',
      },
      simplefin: { accessUrl: 'https://u:p@h/simplefin' },
    };
    const encrypted = walkSensitiveFields(original, (v) => encryptWithKey(v, key));
    const decrypted = walkSensitiveFields(encrypted, (v) => decryptWithKey(v, key));
    expect(decrypted).toEqual(original);

    // Spot-check that at least one actually was ciphertext mid-flight:
    expect(encrypted.anthropicKey?.startsWith('enc:v1:')).toBe(true);
    expect(encrypted.crypto?.exchanges[0].apiSecret?.startsWith('enc:v1:')).toBe(true);
    expect(encrypted.snaptrade?.userSecret?.startsWith('enc:v1:')).toBe(true);
    expect(encrypted.simplefin?.accessUrl?.startsWith('enc:v1:')).toBe(true);
    // Non-secrets stayed plain:
    expect(encrypted.claudeModel).toBe('claude-sonnet-4-6');
    expect(encrypted.crypto?.wallets).toEqual(original.crypto?.wallets);
    expect(encrypted.snaptrade?.clientId).toBe('CLIENT_PUB');
  });
});
