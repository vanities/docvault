// Guard: server code must NEVER import from src/ — the Docker runtime image
// ships server/ + dist/ but not src/, so such an import boots fine locally
// and crash-loops the container in production (this exact incident happened
// with calendar-sky importing the calendar math from src on 2026-08-02).
// Shared pure modules belong in server/ with the frontend importing them.

import { describe, expect, test } from 'vite-plus/test';
import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

describe('server/ never imports from src/', () => {
  test('no ../src imports anywhere under server/', () => {
    const serverDir = path.resolve(__dirname);
    const offenders: string[] = [];
    for (const file of walk(serverDir)) {
      const content = readFileSync(file, 'utf-8');
      if (/from\s+['"](\.\.\/)+src\//.test(content)) {
        offenders.push(path.relative(serverDir, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
