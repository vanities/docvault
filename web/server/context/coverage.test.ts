// Keeps every piece of DocVault data reachable by the AI surfaces.
//
// Scans the server code (tests excluded) for the names it gives data-folder
// files and folders, and requires each one to be listed by a context source,
// exempted with a reason, or on the shrinking not-wired list (coverage.ts).
// Same deliberately simple source-text approach as navigation-wiring.test.ts:
// it catches the common ways the code names data paths, and a new pattern that
// slips past it should be added to PATTERNS rather than worked around.

import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { describe, expect, test, vi } from 'vite-plus/test';

vi.hoisted(() => {
  process.env.DOCVAULT_DATA_DIR = `${process.env.TMPDIR ?? '/tmp'}/docvault-context-coverage-${Date.now()}`;
});

const { CONTEXT_SOURCES } = await import('./registry.js');
const { CONTEXT_EXEMPT, CONTEXT_NOT_WIRED_YET } = await import('./coverage.js');
const { NEWSSTAND_GROUP_DESKS } = await import('../daily-news.js');

const SERVER = path.resolve(__dirname, '..');

const PATTERNS: RegExp[] = [
  // '.docvault-alerts.json', `.docvault-portfolio-snapshots-${year}.json`
  /['`](\.docvault-[A-Za-z0-9.${}_-]+)['`]/g,
  // path.join(DATA_DIR, 'health'), path.join(dataDir, '.rclone.conf')
  /path\.(?:join|resolve)\(\s*(?:DATA_DIR|dataDir)\s*,\s*['`]([^'`/]+)['`]/g,
];

// export const ALERTS_DIR = 'alerts', joined to the data folder elsewhere. A
// constant that extends another one's name in the same file (JOBS_RUNS_DIR
// beside JOBS_DIR) is a subfolder of it, not a top-level data name.
const FOLDER_CONSTANT =
  /const\s+([A-Z_]*(?:_DIR|_DIRNAME|_INDEX|_STATE_FILE))\s*=\s*['`]([^'`/\s]+)['`]/g;

function topLevelFolderConstants(text: string): string[] {
  const all = [...text.matchAll(FOLDER_CONSTANT)].map((m) => ({ name: m[1], value: m[2] }));
  const parents = all.map((c) => c.name.replace(/_(?:DIR|DIRNAME)$/, '_')).filter((p) => p !== '');
  const isSubfolder = (name: string) =>
    /_(?:DIR|DIRNAME)$/.test(name) && parents.some((p) => name !== `${p}DIR` && name.startsWith(p));
  return all.filter((c) => !isSubfolder(c.name)).map((c) => c.value);
}

function serverFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === 'node_modules' ? [] : serverFiles(full);
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [full] : [];
  });
}

/** Data name -> the first server file that uses it. */
function scanDataNames(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of serverFiles(SERVER)) {
    const text = readFileSync(file, 'utf8');
    const names = [
      ...PATTERNS.flatMap((pattern) => [...text.matchAll(pattern)].map((m) => m[1])),
      ...topLevelFolderConstants(text),
    ];
    for (const raw of names) {
      const name = raw.replace(/\$\{[^}]*\}/g, '*');
      if (!found.has(name)) found.set(name, path.relative(SERVER, file));
    }
  }
  return found;
}

const used = scanDataNames();
const owned = new Map<string, string>();
for (const source of CONTEXT_SOURCES) {
  for (const f of source.files) owned.set(f, source.id);
}

describe('context coverage', () => {
  test('the scan finds the data files (guards against a broken scan passing vacuously)', () => {
    expect(used.has('.docvault-settings.json')).toBe(true);
    expect(used.has('health')).toBe(true);
    expect(used.has('alerts')).toBe(true);
    expect(used.size).toBeGreaterThan(50);
  });

  test('every data file is listed by a source, exempt, or on the not-wired list', () => {
    const unplaced = [...used]
      .filter(([name]) => !owned.has(name) && !CONTEXT_EXEMPT[name] && !CONTEXT_NOT_WIRED_YET[name])
      .map(([name, file]) => `${name} (used in server/${file})`);
    expect(
      unplaced,
      'No AI surface can read these. List each in a context source in server/context/sources/, ' +
        'or add it to CONTEXT_EXEMPT in server/context/coverage.ts with the reason it never ' +
        'belongs in AI context.'
    ).toEqual([]);
  });

  test('nothing on the not-wired list is already listed by a source', () => {
    const wired = Object.keys(CONTEXT_NOT_WIRED_YET).filter((name) => owned.has(name));
    expect(wired, 'Remove these from CONTEXT_NOT_WIRED_YET: a source lists them now.').toEqual([]);
  });

  test('exempt data is never also listed by a source', () => {
    expect(Object.keys(CONTEXT_EXEMPT).filter((name) => owned.has(name))).toEqual([]);
  });

  test('every listed, exempt and not-wired name is still used by the server', () => {
    const stale = [
      ...owned.keys(),
      ...Object.keys(CONTEXT_EXEMPT),
      ...Object.keys(CONTEXT_NOT_WIRED_YET),
    ].filter((name) => !used.has(name));
    expect(stale, 'These names no longer appear in the server code; fix or remove them.').toEqual(
      []
    );
  });

  test('every exemption says why', () => {
    for (const [name, reason] of Object.entries(CONTEXT_EXEMPT)) {
      expect(reason.trim().length, `${name} needs a real reason`).toBeGreaterThan(10);
    }
  });

  test('sources have unique ids and describe what they hold', () => {
    const ids = CONTEXT_SOURCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of CONTEXT_SOURCES) {
      expect(s.id).toMatch(/^[a-z0-9-]+$/);
      expect(s.description.length, `${s.id} description`).toBeGreaterThan(40);
      expect(s.files.length, `${s.id} files`).toBeGreaterThan(0);
      expect(typeof s.read, `${s.id} must have read()`).toBe('function');
    }
  });

  test('the Newsstand places every source group (on a desk, or read outside them)', () => {
    const missing = CONTEXT_SOURCES.filter((s) => !(s.group in NEWSSTAND_GROUP_DESKS)).map(
      (s) => `${s.id} (group ${s.group})`
    );
    expect(missing, 'Add the group to NEWSSTAND_GROUP_DESKS in server/daily-news.ts').toEqual([]);
  });
});
