// Field-level encryption for sensitive settings (API keys, exchange secrets,
// backup password, health ingest token, SimpleFIN access URL, etc).
//
// This module is the SINGLE SOURCE OF TRUTH for:
//   - Which settings fields are "sensitive" (see `walkSensitiveFields`)
//   - The at-rest encryption format (AES-256-GCM + scrypt, "enc:v1:<base64>")
//   - The master-key env-var contract (DOCVAULT_MASTER_KEY)
//
// Shape of the encrypted string:
//   "enc:v1:" + base64( iv(12 bytes) || authTag(16 bytes) || ciphertext )
//
// Two layers exposed:
//   A) PRIMITIVES — take an explicit key argument. Used by the rotation
//      script in scripts/ to re-encrypt under a different key without
//      touching the server's env-var state.
//        deriveKey(), encryptWithKey(), decryptWithKey()
//   B) SERVER WRAPPERS — use the cached env-derived key. Used by runtime
//      code paths (loadSettings / saveSettings).
//        encryptField(), decryptField(), assertMasterKeyConfigured()

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import type { Settings } from './data.js';

const MASTER_KEY_ENV = 'DOCVAULT_MASTER_KEY';
const ENC_PREFIX = 'enc:v1:';
const MIN_KEY_LENGTH = 16;

// Fixed per-install salt. A random salt would need to be persisted next to
// the ciphertexts — defeating the purpose. With a high-entropy master key
// (32 random bytes from `openssl rand -base64 32`), the salt is not
// load-bearing for security; it just parameterizes the KDF.
const SALT = Buffer.from('docvault-field-encryption-v1', 'utf-8');

// ============================================================================
// Primitives — parameterized by key
// ============================================================================

export function deriveKey(masterKey: string): Buffer {
  return scryptSync(masterKey, SALT, 32);
}

export function isEncryptedValue(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(ENC_PREFIX);
}

export function encryptWithKey(plaintext: string | undefined, key: Buffer): string | undefined {
  if (plaintext === undefined || plaintext === null || plaintext === '') return plaintext;
  if (isEncryptedValue(plaintext)) return plaintext;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ENC_PREFIX + Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decryptWithKey(value: string | undefined, key: Buffer): string | undefined {
  if (value === undefined || value === null || value === '') return value;
  if (!isEncryptedValue(value)) return value;
  const packed = Buffer.from(value.slice(ENC_PREFIX.length), 'base64');
  if (packed.length < 28) {
    throw new Error('Invalid encrypted field: payload too short');
  }
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const ct = packed.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf-8');
  } catch {
    throw new Error(
      `Failed to decrypt field — wrong ${MASTER_KEY_ENV}? ` +
        `If the master key was rotated, restore the prior value or re-enter the underlying secret.`
    );
  }
}

// ============================================================================
// Server wrappers — use env-derived key (cached)
// ============================================================================

let cachedEnvKey: Buffer | null = null;

function envDerivedKey(): Buffer {
  if (cachedEnvKey) return cachedEnvKey;
  const masterKey = process.env[MASTER_KEY_ENV];
  if (!masterKey) {
    throw new Error(
      `${MASTER_KEY_ENV} environment variable is not set. ` +
        `Generate one with 'openssl rand -base64 32' and add it to your Unraid Docker template.`
    );
  }
  if (masterKey.length < MIN_KEY_LENGTH) {
    throw new Error(
      `${MASTER_KEY_ENV} must be at least ${MIN_KEY_LENGTH} characters (current length: ${masterKey.length}). ` +
        `Generate a strong one with 'openssl rand -base64 32'.`
    );
  }
  cachedEnvKey = deriveKey(masterKey);
  return cachedEnvKey;
}

export function assertMasterKeyConfigured(): void {
  envDerivedKey();
}

// Test-only: reset the cached env-derived key so tests can exercise
// different DOCVAULT_MASTER_KEY values in a single process. Never call from
// production code — the cache is what keeps scrypt from running per request.
export function __resetEnvKeyCacheForTesting(): void {
  cachedEnvKey = null;
}

export function encryptField(plaintext: string | undefined): string | undefined {
  return encryptWithKey(plaintext, envDerivedKey());
}

export function decryptField(value: string | undefined): string | undefined {
  return decryptWithKey(value, envDerivedKey());
}

// ============================================================================
// Single source of truth: which Settings fields are sensitive
// ============================================================================

type Transformer = (v: string | undefined) => string | undefined;

// Walk every sensitive field in `settings` and apply `transform`.
// Returns a deep-clone so the caller's input is never mutated.
//
// IMPORTANT: when adding a new sensitive field, extend THIS FUNCTION only.
// Both server-side encrypt/decrypt and the rotation script feed through here.
export function walkSensitiveFields(settings: Settings, transform: Transformer): Settings {
  const out = JSON.parse(JSON.stringify(settings)) as Settings;
  if (out.anthropicKey) out.anthropicKey = transform(out.anthropicKey);
  if (out.fredApiKey) out.fredApiKey = transform(out.fredApiKey);
  if (out.geoapifyApiKey) out.geoapifyApiKey = transform(out.geoapifyApiKey);
  if (out.healthIngestToken) out.healthIngestToken = transform(out.healthIngestToken);
  if (out.schedules?.backupPassword) {
    out.schedules.backupPassword = transform(out.schedules.backupPassword);
  }
  if (out.crypto) {
    if (out.crypto.etherscanKey) out.crypto.etherscanKey = transform(out.crypto.etherscanKey);
    if (out.crypto.exchanges) {
      for (const ex of out.crypto.exchanges) {
        if (ex.apiKey) ex.apiKey = transform(ex.apiKey) ?? ex.apiKey;
        if (ex.apiSecret) ex.apiSecret = transform(ex.apiSecret) ?? ex.apiSecret;
        if (ex.passphrase) ex.passphrase = transform(ex.passphrase);
      }
    }
  }
  if (out.snaptrade) {
    if (out.snaptrade.consumerKey) {
      out.snaptrade.consumerKey = transform(out.snaptrade.consumerKey) ?? out.snaptrade.consumerKey;
    }
    if (out.snaptrade.userSecret) out.snaptrade.userSecret = transform(out.snaptrade.userSecret);
  }
  if (out.simplefin?.accessUrl) {
    out.simplefin.accessUrl = transform(out.simplefin.accessUrl) ?? out.simplefin.accessUrl;
  }
  return out;
}
