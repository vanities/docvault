// Seed bundled example custom jobs into DATA_DIR/jobs on boot — DISABLED.
//
// Custom-job manifests + scripts live in the *data dir*, not the repo, so a
// fresh DocVault install starts with none. This copies the curated examples
// under examples/jobs/ into the data dir the first time, with enabled:false so
// nothing runs unsolicited. Users opt in from Settings → Jobs.
//
// Idempotent + non-destructive (see seedExampleJobs docs). Best-effort: never
// blocks boot — any failure is logged and skipped.

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash, randomUUID } from 'crypto';
import { DATA_DIR } from './data.js';
import {
  customJobScriptPath,
  ensureJobsLayout,
  jobsManifestsDir,
  jobsRoot,
  parseCustomJobManifest,
  type CustomJobManifest,
} from './jobs.js';
import { createLogger } from './logger.js';

const log = createLogger('Jobs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Bundled examples sit at <app>/examples/jobs, a sibling of server/. Shipped
// into the Docker image via `COPY examples/` (see Dockerfile).
const EXAMPLES_DIR = path.join(__dirname, '..', 'examples', 'jobs');

// Exact hashes of the previously shipped collectors. Upgrade only untouched
// defaults; a custom script, manifest path, or deleted job is always preserved.
const PREVIOUS_SCRIPT_HASHES: Record<string, string> = {
  'scripts/benjamin-cowen-youtube.local.sh':
    '1884c83d92f95a8748d3288afa62c0555c8a3babe9aa3e27353c1d1dfee103f5',
  'scripts/casually-finance-youtube.local.sh':
    'e24b2ca43c8192bec0d4cdf479619bcdb25a8338d7181f818c1feed6e9f62ea0',
  'scripts/cto-larsson-youtube.local.sh':
    'cfda9cd5fea6d0254c0e9beec9fbb9a23f7fb59ed68ab955f0ac81ca9907d84a',
  'scripts/eurodollar-university-youtube.local.sh':
    '605585ad7d2a9be65212d6ad1c046b3c05265d36e0cf70df6fba02a7b4868e67',
  'scripts/fireship-youtube.local.sh':
    '603000a09f634ab3b44852fbc12c044845020b4e29ed6d758111b3f725ae04fa',
  'scripts/gamers-nexus-youtube.local.sh':
    '25a0eea924adfa581aa98d41b6653c08f8faa94a190a5ce42c9a9083e6c9886d',
  'scripts/george-gammon-youtube.local.sh':
    'b2f05a427ee6ef3d61d7348ec54b1a03d9fa771f8cb471e826a239f193ad5c1b',
  'scripts/huberman-lab-youtube.local.sh':
    '01a8950de083fee061608a95e6f9e7d017092e1866d382d0db3f9966eadae023',
  'scripts/theo-youtube.local.sh':
    '977e6436e72b130a16f372b97fc2753e7bfdcb2d0ba68073917ca068aa3ee77a',
};

export async function upgradeExampleScript(
  dataDir: string,
  manifest: CustomJobManifest,
  newBody: string,
  previousHashes = PREVIOUS_SCRIPT_HASHES
): Promise<boolean> {
  const previousHash = previousHashes[manifest.script];
  if (!previousHash) return false;
  const dest = customJobScriptPath(dataDir, manifest.script);
  let oldBody: string;
  try {
    if (!(await fs.lstat(dest)).isFile()) return false;
    oldBody = await fs.readFile(dest, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
  if (createHash('sha256').update(oldBody).digest('hex') !== previousHash) return false;
  const temp = `${dest}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, newBody.replace(/\r\n?/g, '\n'), { mode: 0o700 });
    // Recheck immediately before publication so an intervening edit is kept.
    if ((await fs.readFile(dest, 'utf8')) !== oldBody) return false;
    await fs.rename(temp, dest);
  } finally {
    await fs.unlink(temp).catch(() => {});
  }
  log.info(`Updated untouched default collector '${manifest.id}' with retry diagnostics`);
  return true;
}

function seededMarkerPath(dataDir: string): string {
  return path.join(jobsRoot(dataDir), '.seeded-examples.json');
}

async function loadSeededMarker(dataDir: string): Promise<Set<string>> {
  try {
    const arr = JSON.parse(await fs.readFile(seededMarkerPath(dataDir), 'utf8'));
    return new Set(Array.isArray(arr) ? (arr as string[]) : []);
  } catch {
    return new Set();
  }
}

async function saveSeededMarker(dataDir: string, ids: Set<string>): Promise<void> {
  const finalPath = seededMarkerPath(dataDir);
  // Write-then-rename so a concurrent reader never sees a half-written file.
  const tmp = `${finalPath}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify([...ids].sort(), null, 2)}\n`);
  await fs.rename(tmp, finalPath);
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function listExampleManifestFiles(): Promise<string[]> {
  try {
    const dir = path.join(EXAMPLES_DIR, 'manifests');
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith('.json'))
      .map((e) => path.join(dir, e.name))
      .sort();
  } catch {
    // No bundled examples present (e.g. examples/ not shipped) — nothing to do.
    return [];
  }
}

/**
 * Copy bundled example custom jobs into DATA_DIR/jobs, disabled, exactly once.
 *
 * A marker file (DATA_DIR/jobs/.seeded-examples.json) records every example id
 * we've already handled, which makes the behavior:
 *  - a job the user deleted is not resurrected, and an edited/enabled manifest
 *    is never reverted;
 *  - an example whose manifest already exists (e.g. the maintainer's own copy)
 *    is adopted into the marker and left as-is; untouched scripts from a known
 *    previous bundled version receive the new collector implementation;
 *  - otherwise the script is copied and the manifest written with enabled:false.
 */
export async function seedExampleJobs(dataDir: string = DATA_DIR): Promise<void> {
  const manifestFiles = await listExampleManifestFiles();
  if (manifestFiles.length === 0) return;

  await ensureJobsLayout(dataDir);
  const seeded = await loadSeededMarker(dataDir);
  const startedWith = seeded.size;
  let wrote = 0;

  for (const file of manifestFiles) {
    try {
      const manifest: CustomJobManifest = parseCustomJobManifest(
        JSON.parse(await fs.readFile(file, 'utf8'))
      );
      const destManifest = path.join(jobsManifestsDir(dataDir), `${manifest.id}.json`);
      if (await fileExists(destManifest)) {
        const existing = parseCustomJobManifest(
          JSON.parse(await fs.readFile(destManifest, 'utf8'))
        );
        if (existing.script === manifest.script) {
          await upgradeExampleScript(
            dataDir,
            existing,
            await fs.readFile(path.join(EXAMPLES_DIR, manifest.script), 'utf8')
          );
        }
        // Manifest, enabled state, schedule, and custom script edits stay intact.
        seeded.add(manifest.id);
        continue;
      }
      if (seeded.has(manifest.id)) continue;

      // Write the script before the manifest so the scheduler never observes a
      // manifest pointing at a missing script.
      const srcScript = path.join(EXAMPLES_DIR, manifest.script);
      const destScript = customJobScriptPath(dataDir, manifest.script);
      await fs.mkdir(path.dirname(destScript), { recursive: true });
      const body = await fs.readFile(srcScript, 'utf8');
      await fs.writeFile(destScript, body.replace(/\r\n?/g, '\n'), { mode: 0o700 });

      // Force disabled regardless of what the bundled manifest says.
      const seededManifest = { ...manifest, enabled: false };
      await fs.writeFile(destManifest, `${JSON.stringify(seededManifest, null, 2)}\n`, {
        mode: 0o600,
      });

      seeded.add(manifest.id);
      wrote += 1;
      log.info(`Seeded example job '${manifest.id}' (disabled)`);
    } catch (err) {
      log.warn(
        `Skipped example job ${path.basename(file)}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  if (seeded.size !== startedWith) await saveSeededMarker(dataDir, seeded);
  if (wrote > 0) log.info(`Seeded ${wrote} example custom job(s) into ${jobsRoot(dataDir)}`);
}
