// Tests for server/backup.ts
//
// Committed to git (exception in .gitignore, same pattern as quant.test.ts /
// crypto-keys.test.ts): all fixtures are synthetic, no personal data.
//
// Strategy: create a throwaway data dir via tmpdir(), seed it with a few
// `.docvault-*.json` files and a `health/<person>/exports/<file>` subtree,
// pass that path explicitly to `createBackupBundle`, decrypt + unzip, and
// assert the contents match. This verifies the bundle shape end-to-end and
// catches any regression in what gets captured (e.g., health/ dropping out).

import { describe, expect, test, beforeEach, afterEach } from 'vite-plus/test';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { randomBytes, createDecipheriv, scryptSync } from 'crypto';
import { unzipSync } from 'fflate';
import { collectBackupFiles, createBackupBundle } from './backup.js';

let scratchDir = '';

async function unpackBundle(bundle: Buffer, password: string): Promise<Record<string, Uint8Array>> {
  const salt = bundle.subarray(0, 16);
  const iv = bundle.subarray(16, 28);
  const tag = bundle.subarray(28, 44);
  const ct = bundle.subarray(44);
  const key = scryptSync(password, salt, 32);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const zipped = Buffer.concat([decipher.update(ct), decipher.final()]);
  return unzipSync(new Uint8Array(zipped));
}

describe('backup bundle round-trip', () => {
  beforeEach(async () => {
    scratchDir = path.join(
      tmpdir(),
      `docvault-backup-test-${Date.now()}-${randomBytes(4).toString('hex')}`
    );
    await fs.mkdir(scratchDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(scratchDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  test('captures every .docvault-*.json at the data-dir root', async () => {
    await fs.writeFile(
      path.join(scratchDir, '.docvault-settings.json'),
      JSON.stringify({ anthropicKey: 'synthetic-key-value' })
    );
    await fs.writeFile(
      path.join(scratchDir, '.docvault-config.json'),
      JSON.stringify({ entities: [] })
    );
    await fs.writeFile(
      path.join(scratchDir, '.docvault-parsed.json'),
      JSON.stringify({ foo: 'bar' })
    );
    // A file that should NOT be captured (wrong extension)
    await fs.writeFile(path.join(scratchDir, '.docvault-reminders.json.bak'), 'stale');
    // A file that should NOT be captured (wrong prefix)
    await fs.writeFile(path.join(scratchDir, 'random.json'), 'nope');

    const bundle = await createBackupBundle('password-1234', scratchDir);
    const unpacked = await unpackBundle(bundle, 'password-1234');

    expect(Object.keys(unpacked).sort()).toEqual(
      ['.docvault-config.json', '.docvault-parsed.json', '.docvault-settings.json'].sort()
    );
  });

  test('captures health/ subtree recursively with binary fidelity', async () => {
    await fs.writeFile(path.join(scratchDir, '.docvault-settings.json'), JSON.stringify({}));
    const exportsDir = path.join(scratchDir, 'health', 'person-abc', 'exports');
    const deltasDir = path.join(scratchDir, 'health', 'person-abc', 'deltas');
    await fs.mkdir(exportsDir, { recursive: true });
    await fs.mkdir(deltasDir, { recursive: true });

    // "Binary" file with non-UTF-8 bytes — must round-trip identically.
    const binaryPayload = Buffer.from([0x00, 0xff, 0x42, 0xca, 0xfe, 0xba, 0xbe]);
    await fs.writeFile(path.join(exportsDir, 'export.zip'), binaryPayload);
    await fs.writeFile(path.join(exportsDir, 'export.xml'), '<HealthData>fake</HealthData>');
    await fs.writeFile(path.join(deltasDir, '2026-04-15.json'), JSON.stringify({ steps: 1234 }));

    const bundle = await createBackupBundle('pw', scratchDir);
    const unpacked = await unpackBundle(bundle, 'pw');

    expect(unpacked['health/person-abc/exports/export.zip']).toBeDefined();
    expect(
      Buffer.from(unpacked['health/person-abc/exports/export.zip']).equals(binaryPayload)
    ).toBe(true);
    expect(new TextDecoder().decode(unpacked['health/person-abc/exports/export.xml'])).toBe(
      '<HealthData>fake</HealthData>'
    );
    expect(new TextDecoder().decode(unpacked['health/person-abc/deltas/2026-04-15.json'])).toBe(
      JSON.stringify({ steps: 1234 })
    );
  });

  test('handles missing health/ directory without error', async () => {
    await fs.writeFile(path.join(scratchDir, '.docvault-settings.json'), '{"ok":true}');
    const bundle = await createBackupBundle('pw', scratchDir);
    const unpacked = await unpackBundle(bundle, 'pw');
    expect(Object.keys(unpacked)).toEqual(['.docvault-settings.json']);
  });

  test('wrong password fails to decrypt', async () => {
    await fs.writeFile(path.join(scratchDir, '.docvault-settings.json'), '{}');
    const bundle = await createBackupBundle('correct-password', scratchDir);
    await expect(unpackBundle(bundle, 'wrong-password')).rejects.toThrow();
  });

  test('two bundles from same input are not byte-identical (random salt+iv)', async () => {
    await fs.writeFile(path.join(scratchDir, '.docvault-settings.json'), '{"v":1}');
    const a = await createBackupBundle('pw', scratchDir);
    const b = await createBackupBundle('pw', scratchDir);
    expect(a.equals(b)).toBe(false);
    const ua = await unpackBundle(a, 'pw');
    const ub = await unpackBundle(b, 'pw');
    expect(Object.keys(ua)).toEqual(Object.keys(ub));
    expect(new TextDecoder().decode(ua['.docvault-settings.json'])).toBe(
      new TextDecoder().decode(ub['.docvault-settings.json'])
    );
  });

  test('collectBackupFiles: returns empty object on nonexistent dir', async () => {
    const nonexistent = path.join(scratchDir, 'does-not-exist');
    const result = await collectBackupFiles(nonexistent);
    expect(result).toEqual({});
  });
});
