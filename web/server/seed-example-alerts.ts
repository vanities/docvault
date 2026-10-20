// Seed bundled alert add-on dashboards into DATA_DIR/alerts/<id>/dashboard.html, once each.
//
// An add-on ships its check job (seeded disabled by seed-example-jobs.ts) and its page. This
// copies the page so the Alerts view can show it as soon as the owner turns the job on.
// A marker (DATA_DIR/alerts/.seeded-dashboards.json) records every id already handled, so a
// dashboard the owner deleted is not brought back and one they wrote is never overwritten.
// Best-effort: any failure is logged and skipped, never blocking boot.
import { constants as fsConstants, promises as fs, type Dirent } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ALERTS_DIR, DASHBOARD_FILE } from './alerts.js';
import { DATA_DIR } from './data.js';
import { createLogger } from './logger.js';

const log = createLogger('Alerts');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// <app>/examples/alerts/<id>/dashboard.html, shipped next to server/ by the Dockerfile's COPY examples/.
export const EXAMPLE_ALERTS_DIR = path.join(__dirname, '..', 'examples', 'alerts');
const MARKER_FILE = '.seeded-dashboards.json';
const SOURCE_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

async function loadMarker(file: string): Promise<Set<string>> {
  try {
    const ids: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
    return new Set(
      Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
    );
  } catch {
    return new Set();
  }
}

async function saveMarker(file: string, ids: Set<string>): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify([...ids].sort(), null, 2)}\n`);
  await fs.rename(tmp, file);
}

/** Copies each bundled add-on dashboard that hasn't been seeded before. Returns the ids copied. */
export async function seedExampleAlertDashboards(
  dataDir: string = DATA_DIR,
  examplesDir: string = EXAMPLE_ALERTS_DIR
): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(examplesDir, { withFileTypes: true });
  } catch {
    return []; // examples/ not shipped (e.g. a trimmed image): nothing to seed
  }
  const t0 = performance.now();
  const alertsRoot = path.join(dataDir, ALERTS_DIR);
  const markerFile = path.join(alertsRoot, MARKER_FILE);
  const seeded = await loadMarker(markerFile);
  const startedWith = seeded.size;
  const copied: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !SOURCE_ID_RE.test(entry.name) || seeded.has(entry.name)) continue;
    const src = path.join(examplesDir, entry.name, DASHBOARD_FILE);
    try {
      await fs.access(src);
    } catch {
      continue; // a folder without a dashboard, like the kit itself
    }
    const dest = path.join(alertsRoot, entry.name, DASHBOARD_FILE);
    try {
      await fs.mkdir(path.dirname(dest), { recursive: true });
      // COPYFILE_EXCL refuses to replace an existing file, even one that appears mid-copy.
      await fs.copyFile(src, dest, fsConstants.COPYFILE_EXCL);
      copied.push(entry.name);
      log.info(`[seed] dashboard for '${entry.name}'`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        log.warn(
          `[seed] skipped dashboard '${entry.name}': ${err instanceof Error ? err.message : String(err)}`
        );
        continue; // not marked, so the next boot retries
      }
      // The owner already has a dashboard for this id: adopt it and leave it alone.
    }
    seeded.add(entry.name);
  }

  if (seeded.size !== startedWith) await saveMarker(markerFile, seeded);
  if (copied.length > 0) {
    log.info(
      `[seed] copied ${copied.length} add-on dashboard(s) in ${(performance.now() - t0).toFixed(0)}ms`
    );
  }
  return copied;
}
