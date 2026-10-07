import { afterAll, beforeEach, describe, expect, test, vi } from 'vite-plus/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const dataDir = vi.hoisted(() => {
  const os = require('node:os') as typeof import('node:os');
  const path = require('node:path') as typeof import('node:path');
  return path.join(
    os.tmpdir(),
    `docvault-brain-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
});
vi.mock('./data.js', () => ({ DATA_DIR: dataDir }));
import { appendBrainEntry, BRAIN_FILE, readBrain, writeBrain } from './brain.js';

beforeEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
  await fs.mkdir(dataDir, { recursive: true });
});
afterAll(() => fs.rm(dataDir, { recursive: true, force: true }));

describe('Brain storage', () => {
  test('missing memory is empty and a saved note round-trips', async () => {
    expect(await readBrain()).toEqual({ content: '', bytes: 0, updatedAt: null, exists: false });
    const saved = await writeBrain('# Preferences\n\nUse concise summaries.');
    expect(saved.content).toBe('# Preferences\n\nUse concise summaries.');
    expect(saved.exists).toBe(true);
    expect(saved.bytes).toBe(Buffer.byteLength(saved.content));
  });

  test('parallel appends retain every note and return each caller’s appended text', async () => {
    const notes = Array.from({ length: 24 }, (_, i) => `Synthetic note ${i}`);
    const results = await Promise.allSettled(
      notes.map((note) => appendBrainEntry(note, { date: '2026-01-01' }))
    );
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    const brain = await readBrain();
    for (const note of notes) expect(brain.content.split('\n')).toContain(`- (2026-01-01) ${note}`);
    expect(brain.content.match(/^# DocVault Brain$/gm)).toHaveLength(1);
    expect((await fs.readdir(dataDir)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  test('overlapping replacements return their own content and leave a complete final note', async () => {
    const notes = Array.from(
      { length: 24 },
      (_, i) => `# Replacement ${i}\n${'x'.repeat(i * 100)}`
    );
    const results = await Promise.allSettled(notes.map((note) => writeBrain(note)));
    for (const [index, result] of results.entries()) {
      expect(result.status).toBe('fulfilled');
      if (result.status === 'fulfilled') expect(result.value.content).toBe(notes[index]);
    }
    expect(notes).toContain((await readBrain()).content);
  });

  test('a failed write does not prevent later saves', async () => {
    await fs.mkdir(BRAIN_FILE);
    await expect(writeBrain('Blocked write')).rejects.toThrow();
    expect((await fs.readdir(dataDir)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    await fs.rm(BRAIN_FILE, { recursive: true });
    expect((await writeBrain('Recovered')).content).toBe('Recovered');
  });
});
