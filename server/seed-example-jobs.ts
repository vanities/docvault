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
 *  - an id in the marker is never touched again — a job the user deleted is not
 *    resurrected, and a job the user edited/enabled is never reverted;
 *  - an example whose manifest already exists (e.g. the maintainer's own copy)
 *    is adopted into the marker and left exactly as-is;
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
      if (seeded.has(manifest.id)) continue;

      const destManifest = path.join(jobsManifestsDir(dataDir), `${manifest.id}.json`);
      if (await fileExists(destManifest)) {
        // The user already has this job — adopt it so we never reseed it, and
        // leave their copy (and its enabled state) untouched.
        seeded.add(manifest.id);
        continue;
      }

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
