// Shared backup bundle logic.
//
// This module is the SINGLE SOURCE OF TRUTH for:
//   - What goes into the encrypted config bundle (`.docvault-config-backup.enc`)
//   - The pack format: salt(16) || iv(12) || authTag(16) || ciphertext
//   - The encryption scheme: scrypt-derived AES-256-GCM, same as /api/backup
//     and /api/restore from the beginning.
//
// Two consumers today:
//   1. POST /api/backup (server/index.ts) — streams bytes back to the client
//   2. Scheduler's encryptedBackup task (server/scheduler.ts) — writes the
//      bytes to `.docvault-config-backup.enc` for the Dropbox push
//
// Both call `createBackupBundle(password)` and do nothing else backup-related.
// Any new rule about "what ends up in the bundle" belongs in `collectBackupFiles`.
//
// NOTE: this is layered *on top of* field-level encryption in
// server/crypto-keys.ts. The JSON files we read from disk already contain
// `enc:v1:...` tagged ciphertexts for sensitive fields — we don't re-encrypt
// those values, we just bundle the files as-is. That gives the final backup
// bundle its belt-and-suspenders property: sensitive fields are protected by
// the master key AND the whole archive is protected by the backup password.

import { promises as fs } from 'fs';
import path from 'path';
import { zipSync } from 'fflate';
import { DATA_DIR } from './data.js';

// Recursively collect files under `absDir` into `out`, keyed by their path
// relative to `relDir` (so `health/person-x/exports/file.zip` stays the key).
async function collectDirRecursive(
  absDir: string,
  relDir: string,
  out: Record<string, Uint8Array>
): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    // Directory doesn't exist or unreadable — not an error, just nothing to collect.
    return;
  }
  for (const entry of entries) {
    const absChild = path.join(absDir, entry.name);
    const relChild = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await collectDirRecursive(absChild, relChild, out);
    } else if (entry.isFile()) {
      try {
        const buf = await fs.readFile(absChild);
        out[relChild] = new Uint8Array(buf);
      } catch {
        /* skip unreadable file */
      }
    }
  }
}

/**
 * Collect everything that should go into the backup bundle.
 *
 * Captures:
 *   1. All `.docvault-*.json` files at the data-dir root (structured state —
 *      settings, config, parsed data, health summaries, reminders, etc.)
 *   2. The entire `health/` subtree (Apple Health raw zip/xml exports +
 *      iOS Shortcut daily deltas). health/ is NOT in the Dropbox rclone map,
 *      so the encrypted bundle is its only off-site copy.
 *
 * Does NOT capture:
 *   - Entity document subdirectories (synced directly by the sync script)
 *   - Receipts directory (NAS-only; low-priority loss)
 *
 * `dataDir` defaults to the module-wide DATA_DIR. Tests pass a scratch dir.
 * Returns a map keyed by path-relative-to-`dataDir`, with raw bytes as values.
 * Binary-safe — callers should not assume text content.
 */
export async function collectBackupFiles(
  dataDir: string = DATA_DIR
): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = {};

  // 1) Top-level .docvault-*.json files
  try {
    const entries = await fs.readdir(dataDir);
    for (const name of entries) {
      if (name.startsWith('.docvault-') && name.endsWith('.json')) {
        try {
          const buf = await fs.readFile(path.join(dataDir, name));
          files[name] = new Uint8Array(buf);
        } catch {
          /* skip unreadable file */
        }
      }
    }
  } catch {
    /* data dir not readable */
  }

  // 2) health/ subtree (recursive)
  await collectDirRecursive(path.join(dataDir, 'health'), 'health', files);

  return files;
}

/**
 * Build the full encrypted backup bundle.
 *
 * Flow: collectBackupFiles → zipSync → AES-256-GCM encrypt with a
 * scrypt-derived key → pack as salt||iv||authTag||ciphertext.
 *
 * The restore handler in server/index.ts understands this exact format;
 * don't change the pack layout without updating restore too.
 *
 * `dataDir` defaults to DATA_DIR. Exposed for tests; production callers
 * should omit it.
 */
export async function createBackupBundle(
  password: string,
  dataDir: string = DATA_DIR
): Promise<Buffer> {
  const files = await collectBackupFiles(dataDir);
  const zipped = zipSync(files);

  const { createCipheriv, randomBytes, scryptSync } = await import('crypto');
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(password, salt, 32);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(zipped), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([salt, iv, authTag, encrypted]);
}
