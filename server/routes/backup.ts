import { promises as fs } from 'fs';
import path from 'path';
import { createDecipheriv, scryptSync } from 'crypto';
import { unzipSync } from 'fflate';
import { CONFIG_PATH, DATA_DIR, SETTINGS_PATH, jsonResponse } from '../data.js';
import { createBackupBundle } from '../backup.js';
import { readJsonBody } from '../http.js';

export async function handleBackupRoutes(req: Request, pathname: string): Promise<Response | null> {
  // GET /api/backup/latest — download the latest auto-generated encrypted backup
  if (pathname === '/api/backup/latest' && req.method === 'GET') {
    const backupPath = path.join(DATA_DIR, '.docvault-config-backup.enc');
    try {
      const data = await fs.readFile(backupPath);
      const stat = await fs.stat(backupPath);
      const dateStr = new Date(stat.mtime).toISOString().split('T')[0];
      return new Response(data, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="docvault-backup-${dateStr}.enc"`,
        },
      });
    } catch {
      return jsonResponse(
        {
          error:
            'No auto-backup found. Set a backup password in Schedules and wait for the next sync cycle.',
        },
        404
      );
    }
  }

  // POST /api/backup — create encrypted backup of all data
  // Body: { password: "..." }
  // Returns: binary blob (AES-256-GCM encrypted zip). Bundle shape and
  // encryption format are owned by server/backup.ts — both this endpoint
  // and the scheduler's auto-backup task go through that module.
  if (pathname === '/api/backup' && req.method === 'POST') {
    try {
      const { password } = await readJsonBody<{ password?: string }>(req);
      if (!password || typeof password !== 'string' || password.length < 4) {
        return jsonResponse({ error: 'Password must be at least 4 characters' }, 400);
      }
      const packed = await createBackupBundle(password);
      return new Response(new Uint8Array([...packed]), {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="docvault-backup-${new Date().toISOString().split('T')[0]}.enc"`,
        },
      });
    } catch (err) {
      return jsonResponse({ error: err instanceof Error ? err.message : 'Backup failed' }, 500);
    }
  }

  // POST /api/restore — restore from encrypted backup
  // Multipart form: password + file
  if (pathname === '/api/restore' && req.method === 'POST') {
    try {
      const formData = await req.formData();
      const password = formData.get('password') as string;
      const file = formData.get('file') as File;

      if (!password || !file) {
        return jsonResponse({ error: 'Missing password or file' }, 400);
      }

      const packed = Buffer.from(await file.arrayBuffer());
      if (packed.length < 44) {
        return jsonResponse({ error: 'Invalid backup file' }, 400);
      }

      // Unpack: salt(16) + iv(12) + authTag(16) + encrypted
      const salt = packed.subarray(0, 16);
      const iv = packed.subarray(16, 28);
      const authTag = packed.subarray(28, 44);
      const encrypted = packed.subarray(44);

      const key = scryptSync(password, salt, 32);
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);

      let decrypted: Buffer;
      try {
        decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      } catch {
        return jsonResponse({ error: 'Wrong password or corrupted backup' }, 400);
      }

      const unzipped = unzipSync(new Uint8Array(decrypted));
      const restored: string[] = [];
      // Guard against path traversal in maliciously crafted zips.
      const dataDirResolved = path.resolve(DATA_DIR);
      const safeWriteUnder = async (relPath: string, data: Uint8Array) => {
        const target = path.resolve(path.join(DATA_DIR, relPath));
        if (target !== dataDirResolved && !target.startsWith(dataDirResolved + path.sep)) {
          return; // refuse paths that escape the data dir
        }
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, data);
      };

      for (const [name, data] of Object.entries(unzipped)) {
        // Current format: .docvault-*.json files at root of zip
        if (name.startsWith('.docvault-') && name.endsWith('.json')) {
          await safeWriteUnder(name, data);
          restored.push(name);
        }
        // Current format: health/ subtree (Apple Health exports + Shortcut deltas)
        else if (name.startsWith('health/')) {
          await safeWriteUnder(name, data);
          restored.push(name);
        }
        // Legacy format: settings.json / config.json / data/* from older backups
        else if (name === 'settings.json') {
          await safeWriteUnder(path.basename(SETTINGS_PATH), data);
          restored.push(name);
        } else if (name === 'config.json') {
          await safeWriteUnder(path.basename(CONFIG_PATH), data);
          restored.push(name);
        } else if (name.startsWith('data/')) {
          const fileName = name.replace('data/', '');
          await safeWriteUnder(fileName, data);
          restored.push(fileName);
        }
      }

      return jsonResponse({ ok: true, restored });
    } catch (err) {
      return jsonResponse({ error: err instanceof Error ? err.message : 'Restore failed' }, 500);
    }
  }

  return null;
}
