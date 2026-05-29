import { describe, expect, test } from 'vite-plus/test';
import { parsePoliticalJobManifest } from './political-jobs';

describe('parsePoliticalJobManifest', () => {
  test('accepts a safe local manifest shape', () => {
    const manifest = parsePoliticalJobManifest({
      id: 'benjamin-youtube-daily',
      label: 'Benjamin YouTube daily transcript pull',
      schedule: 'daily',
      script: 'scripts/benjamin-youtube.local.ts',
      enabled: true,
      tags: ['politics', 'transcript', 'youtube'],
    });

    expect(manifest).toEqual({
      id: 'benjamin-youtube-daily',
      label: 'Benjamin YouTube daily transcript pull',
      schedule: 'daily',
      script: 'scripts/benjamin-youtube.local.ts',
      enabled: true,
      tags: ['politics', 'transcript', 'youtube'],
    });
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
