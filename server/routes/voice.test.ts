// Unit tests for the per-person voice routes. Uses a temp data dir so file
// I/O is safe (the chmod-555 trap in CI guards regressions), seeds a synthetic
// person, and never reaches a real TTS server — the test endpoint is exercised
// only on its config/precondition error paths. All fixture data is fabricated.

import { afterAll, beforeEach, describe, expect, test, vi } from 'vite-plus/test';
import { promises as fs } from 'fs';
import path from 'path';

// Point DATA_DIR at a throwaway directory BEFORE any handler code runs. ES
// module imports are hoisted above top-level statements, so assigning
// process.env after the imports is too late — data.ts reads DOCVAULT_DATA_DIR
// at module-load time. vi.hoisted runs before the import graph resolves.
const tmpDataDir = vi.hoisted(() => {
  const p = require('path') as typeof import('path');
  const o = require('os') as typeof import('os');
  const dir = p.join(o.tmpdir(), `docvault-voice-test-${Date.now()}`);
  process.env.DOCVAULT_DATA_DIR = dir;
  // The "TTS not configured" tests must not pick up a developer's real env.
  delete process.env.DOCVAULT_TTS_URL;
  delete process.env.DOCVAULT_TTS_API_KEY;
  return dir;
});

vi.mock('../logger.js', () => ({
  createLogger: () => ({
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    timer: () => () => 0,
  }),
}));

// Imports must follow the DATA_DIR + vi.mock setup.
// eslint-disable-next-line import/first
import { clampKnob, handleVoiceRoutes, sanitizeClipFilename } from './voice.js';

const HEALTH_STORE_PATH = path.join(tmpDataDir, '.docvault-health.json');
const PERSON_ID = 'person-test01';

async function seedPerson(): Promise<void> {
  await fs.mkdir(tmpDataDir, { recursive: true });
  await fs.writeFile(
    HEALTH_STORE_PATH,
    JSON.stringify(
      {
        version: 1,
        people: [{ id: PERSON_ID, name: 'Test Person', createdAt: '2026-01-01T00:00:00.000Z' }],
      },
      null,
      2
    )
  );
}

function makeReq(method: string, pathAndQuery: string, body?: BodyInit): [Request, URL, string] {
  const url = new URL(`http://localhost:3005${pathAndQuery}`);
  return [new Request(url, { method, body }), url, url.pathname];
}

async function dispatch(method: string, pathAndQuery: string, body?: BodyInit) {
  const [req, url, pathname] = makeReq(method, pathAndQuery, body);
  return handleVoiceRoutes(req, url, pathname);
}

const FAKE_AUDIO = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 5, 6, 7, 8]);

beforeEach(async () => {
  await fs.rm(tmpDataDir, { recursive: true, force: true });
  await seedPerson();
});

afterAll(async () => {
  await fs.rm(tmpDataDir, { recursive: true, force: true });
});

describe('dispatch', () => {
  test('returns null for non-voice paths', async () => {
    expect(await dispatch('GET', `/api/health/${PERSON_ID}/nutrition`)).toBeNull();
    expect(await dispatch('GET', '/api/health')).toBeNull();
  });

  test('404s for an unknown person', async () => {
    const res = await dispatch('GET', '/api/health/nobody/voice');
    expect(res?.status).toBe(404);
  });
});

describe('clip lifecycle', () => {
  test('upload → list → fetch audio → delete roundtrip', async () => {
    const up = await dispatch(
      'POST',
      `/api/health/${PERSON_ID}/voice/clips?filename=take-one.wav`,
      FAKE_AUDIO
    );
    expect(up?.status).toBe(200);
    const upBody = (await up!.json()) as { clip: { filename: string; size: number } };
    expect(upBody.clip.filename).toBe('take-one.wav');
    expect(upBody.clip.size).toBe(FAKE_AUDIO.byteLength);

    const list = await dispatch('GET', `/api/health/${PERSON_ID}/voice`);
    expect(list?.status).toBe(200);
    const listBody = (await list!.json()) as {
      clips: Array<{ filename: string }>;
      ttsConfigured: boolean;
      voiceName: string;
    };
    expect(listBody.clips.map((c) => c.filename)).toEqual(['take-one.wav']);
    expect(listBody.ttsConfigured).toBe(false);
    expect(listBody.voiceName).toBe(`docvault-${PERSON_ID}`);

    const audio = await dispatch('GET', `/api/health/${PERSON_ID}/voice/clips/take-one.wav`);
    expect(audio?.status).toBe(200);
    expect(audio?.headers.get('Content-Type')).toBe('audio/wav');
    expect(new Uint8Array(await audio!.arrayBuffer())).toEqual(FAKE_AUDIO);

    const del = await dispatch('DELETE', `/api/health/${PERSON_ID}/voice/clips/take-one.wav`);
    expect(del?.status).toBe(200);
    const after = await dispatch('GET', `/api/health/${PERSON_ID}/voice`);
    expect(((await after!.json()) as { clips: unknown[] }).clips).toEqual([]);
  });

  test('duplicate filenames get a numeric suffix', async () => {
    await dispatch('POST', `/api/health/${PERSON_ID}/voice/clips?filename=take.wav`, FAKE_AUDIO);
    const second = await dispatch(
      'POST',
      `/api/health/${PERSON_ID}/voice/clips?filename=take.wav`,
      FAKE_AUDIO
    );
    const body = (await second!.json()) as { clip: { filename: string } };
    expect(body.clip.filename).toBe('take-2.wav');
  });

  test('rejects uploads without a usable audio filename', async () => {
    const missing = await dispatch('POST', `/api/health/${PERSON_ID}/voice/clips`, FAKE_AUDIO);
    expect(missing?.status).toBe(400);
    const badExt = await dispatch(
      'POST',
      `/api/health/${PERSON_ID}/voice/clips?filename=evil.exe`,
      FAKE_AUDIO
    );
    expect(badExt?.status).toBe(400);
  });

  test('rejects empty uploads', async () => {
    const res = await dispatch(
      'POST',
      `/api/health/${PERSON_ID}/voice/clips?filename=empty.wav`,
      new Uint8Array()
    );
    expect(res?.status).toBe(400);
  });

  test('traversal-shaped clip names cannot reach outside the voice dir', async () => {
    // %2F survives URL parsing as an opaque path segment; after decoding the
    // route reduces it to a basename, so the read targets the voice dir only.
    const res = await dispatch(
      'GET',
      `/api/health/${PERSON_ID}/voice/clips/..%2F..%2F.docvault-settings.json`
    );
    // .json is not an audio extension → rejected outright.
    expect(res?.status).toBe(400);

    const wavShaped = await dispatch(
      'GET',
      `/api/health/${PERSON_ID}/voice/clips/..%2F..%2Fsecret.wav`
    );
    // Reduced to "secret.wav" inside the (empty) voice dir → not found.
    expect(wavShaped?.status).toBe(404);
  });
});

describe('sanitizeClipFilename', () => {
  test('keeps clean names, strips directories, rejects junk', () => {
    expect(sanitizeClipFilename('take one.m4a')).toBe('take one.m4a');
    expect(sanitizeClipFilename('../../etc/passwd.wav')).toBe('passwd.wav');
    expect(sanitizeClipFilename('.hidden.wav')).toBeNull();
    expect(sanitizeClipFilename('noext')).toBeNull();
    expect(sanitizeClipFilename(null)).toBeNull();
    expect(sanitizeClipFilename('weird$chars!.mp3')).toBe('weird_chars_.mp3');
  });
});

describe('clampKnob', () => {
  test('passes in-range values, clamps out-of-range, coerces numeric strings', () => {
    expect(clampKnob(0.5, 0.25, 2)).toBe(0.5);
    expect(clampKnob(9, 0.25, 2)).toBe(2);
    expect(clampKnob(0, 0.25, 2)).toBe(0.25);
    expect(clampKnob('0.75', 0, 1)).toBe(0.75);
  });

  test('non-numeric input means "use the server default"', () => {
    expect(clampKnob('abc', 0, 1)).toBeUndefined();
    expect(clampKnob('', 0, 1)).toBeUndefined();
    expect(clampKnob(undefined, 0, 1)).toBeUndefined();
    expect(clampKnob(null, 0, 1)).toBeUndefined();
    expect(clampKnob(NaN, 0, 1)).toBeUndefined();
    expect(clampKnob({}, 0, 1)).toBeUndefined();
  });
});

describe('voice test endpoint preconditions', () => {
  test('400s with a settings pointer when no TTS server is configured', async () => {
    await dispatch('POST', `/api/health/${PERSON_ID}/voice/clips?filename=ref.wav`, FAKE_AUDIO);
    const res = await dispatch('POST', `/api/health/${PERSON_ID}/voice/test`, JSON.stringify({}));
    expect(res?.status).toBe(400);
    const body = (await res!.json()) as { error: string };
    expect(body.error).toContain('Settings');
  });

  test('400s when the person has no clips (with TTS configured)', async () => {
    await fs.writeFile(
      path.join(tmpDataDir, '.docvault-settings.json'),
      JSON.stringify({ ttsUrl: 'http://tts.test:4123' })
    );
    const res = await dispatch('POST', `/api/health/${PERSON_ID}/voice/test`, JSON.stringify({}));
    expect(res?.status).toBe(400);
    const body = (await res!.json()) as { error: string };
    expect(body.error).toContain('clip');
  });
});
