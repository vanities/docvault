import { access, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { describe, expect, test } from 'vite-plus/test';
import { seedExampleJobs } from './seed-example-jobs';
import { customJobScriptPath, ensureJobsLayout, jobsManifestsDir, jobsRoot } from './jobs';

// The bundled examples actually shipped in examples/jobs/manifests.
const EXAMPLE_IDS = [
  'benjamin-cowen-reports-daily',
  'benjamin-cowen-youtube-daily',
  'george-gammon-youtube-daily',
  'zerohedge-research',
];

type Manifest = {
  id: string;
  label: string;
  enabled: boolean;
  script: string;
  schedule: string;
  tags: string[];
};

async function withTempDataDir<T>(fn: (dataDir: string) => Promise<T>): Promise<T> {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'docvault-seed-'));
  try {
    return await fn(dataDir);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
}

async function readManifest(dataDir: string, id: string): Promise<Manifest> {
  return JSON.parse(
    await readFile(path.join(jobsManifestsDir(dataDir), `${id}.json`), 'utf8')
  ) as Manifest;
}

async function readMarker(dataDir: string): Promise<string[]> {
  return JSON.parse(
    await readFile(path.join(jobsRoot(dataDir), '.seeded-examples.json'), 'utf8')
  ) as string[];
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

describe('seedExampleJobs', () => {
  test('seeds every bundled example disabled, with its script and a marker', async () => {
    await withTempDataDir(async (dataDir) => {
      await seedExampleJobs(dataDir);

      for (const id of EXAMPLE_IDS) {
        const manifest = await readManifest(dataDir, id);
        expect(manifest.id).toBe(id);
        expect(manifest.enabled).toBe(false); // never auto-run
        expect(await exists(customJobScriptPath(dataDir, manifest.script))).toBe(true);
      }
      const marker = await readMarker(dataDir);
      for (const id of EXAMPLE_IDS) expect(marker).toContain(id);
    });
  });

  test('does not clobber a user edit on a later boot', async () => {
    await withTempDataDir(async (dataDir) => {
      await seedExampleJobs(dataDir);

      const id = 'zerohedge-research';
      const edited = { ...(await readManifest(dataDir, id)), label: 'My tuned ZH', enabled: true };
      await writeFile(path.join(jobsManifestsDir(dataDir), `${id}.json`), JSON.stringify(edited));

      await seedExampleJobs(dataDir); // second boot

      const after = await readManifest(dataDir, id);
      expect(after.label).toBe('My tuned ZH');
      expect(after.enabled).toBe(true);
    });
  });

  test('adopts a pre-existing manifest without overwriting it', async () => {
    await withTempDataDir(async (dataDir) => {
      await ensureJobsLayout(dataDir);
      const id = 'george-gammon-youtube-daily';
      const mine: Manifest = {
        id,
        label: 'My Gammon job',
        enabled: true,
        script: 'scripts/george-gammon-youtube.local.sh',
        schedule: 'daily',
        tags: ['mine'],
      };
      await writeFile(path.join(jobsManifestsDir(dataDir), `${id}.json`), JSON.stringify(mine));

      await seedExampleJobs(dataDir);

      const after = await readManifest(dataDir, id);
      expect(after.label).toBe('My Gammon job'); // untouched
      expect(after.enabled).toBe(true);
      expect(await readMarker(dataDir)).toContain(id); // but adopted into the marker
    });
  });

  test('does not resurrect an example the user deleted', async () => {
    await withTempDataDir(async (dataDir) => {
      await seedExampleJobs(dataDir);
      const id = 'benjamin-cowen-reports-daily';
      await rm(path.join(jobsManifestsDir(dataDir), `${id}.json`));

      await seedExampleJobs(dataDir); // must respect the marker, not reseed

      expect(await exists(path.join(jobsManifestsDir(dataDir), `${id}.json`))).toBe(false);
    });
  });
});
