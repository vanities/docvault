import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { describe, expect, test } from 'vite-plus/test';
import {
  createPoliticalJobManifest,
  listPoliticalJobManifests,
  parsePoliticalJobManifest,
  politicalJobManifestPath,
} from './political-jobs';

const exampleManifest = {
  id: 'benjamin-youtube-daily',
  label: 'Benjamin Cowen YouTube daily transcript pull',
  schedule: 'daily',
  script: 'scripts/benjamin-cowen-youtube.local.ts',
  enabled: true,
  tags: ['politics', 'macro', 'transcript', 'youtube'],
};

async function withTempDataDir<T>(fn: (dataDir: string) => Promise<T>): Promise<T> {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'docvault-political-jobs-'));
  try {
    return await fn(dataDir);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
}

describe('parsePoliticalJobManifest', () => {
  test('accepts a safe local manifest shape', () => {
    const manifest = parsePoliticalJobManifest(exampleManifest);

    expect(manifest).toEqual(exampleManifest);
  });

  test('rejects scripts outside the local scripts folder', () => {
    expect(() =>
      parsePoliticalJobManifest({
        id: 'bad',
        label: 'Bad',
        schedule: 'daily',
        script: '../steal.sh',
      })
    ).toThrow(/script must live under scripts\//);
  });

  test('rejects manifests without a stable id', () => {
    expect(() =>
      parsePoliticalJobManifest({
        id: 'not valid!',
        label: 'Bad',
        schedule: 'daily',
        script: 'scripts/bad.local.ts',
      })
    ).toThrow(/id/);
  });
});

describe('createPoliticalJobManifest', () => {
  test('creates a local manifest file in the political job inbox', async () => {
    await withTempDataDir(async (dataDir) => {
      const manifest = await createPoliticalJobManifest(exampleManifest, { dataDir });
      const records = await listPoliticalJobManifests(dataDir);

      expect(manifest).toEqual(exampleManifest);
      expect(records).toEqual([
        {
          status: 'valid',
          path: politicalJobManifestPath(dataDir, exampleManifest.id),
          manifest: exampleManifest,
        },
      ]);
    });
  });

  test('refuses to overwrite an existing manifest unless requested', async () => {
    await withTempDataDir(async (dataDir) => {
      await createPoliticalJobManifest(exampleManifest, { dataDir });

      await expect(createPoliticalJobManifest(exampleManifest, { dataDir })).rejects.toThrow(
        /already exists/
      );

      await expect(
        createPoliticalJobManifest(
          { ...exampleManifest, enabled: false },
          { dataDir, overwrite: true }
        )
      ).resolves.toMatchObject({ enabled: false });
    });
  });

  test('lists invalid local manifest files without throwing', async () => {
    await withTempDataDir(async (dataDir) => {
      await createPoliticalJobManifest(exampleManifest, { dataDir });
      await writeFile(politicalJobManifestPath(dataDir, 'bad-job'), '{not json', 'utf8');

      const records = await listPoliticalJobManifests(dataDir);
      expect(records).toHaveLength(2);
      expect(records[0]).toMatchObject({ status: 'invalid' });
      expect(records[1]).toMatchObject({ status: 'valid', manifest: exampleManifest });
    });
  });
});
