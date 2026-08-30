// Guard: a test that mocks createLogger must stub EVERY method the real logger
// has. An incomplete mock passes until someone adds a `log.debug(...)` to a
// shared function, at which point unrelated suites fail with the unhelpful
// "log.debug is not a function" — which is exactly what happened when timing
// instrumentation was added to saveHealthStore (22 nutrition tests went red for
// a reason that had nothing to do with nutrition).
import { describe, expect, test } from 'vite-plus/test';
import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { createLogger } from './logger.js';

// Split so this file's own source does not match the marker it searches for.
const MOCK_MARKER = 'createLogger' + ': () =>';

const REAL_METHODS = Object.keys(createLogger('probe')).filter(
  (k) => typeof (createLogger('probe') as unknown as Record<string, unknown>)[k] === 'function'
);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.test.ts') || p.endsWith('.test.tsx')) out.push(p);
  }
  return out;
}

describe('createLogger mocks are complete', () => {
  test('the real logger exposes the methods we expect to stub', () => {
    // Sanity check so a rename of the logger API fails loudly here first.
    expect(REAL_METHODS).toEqual(expect.arrayContaining(['info', 'warn', 'error', 'debug']));
  });

  test('every test that mocks createLogger stubs all of its methods', () => {
    const roots = [path.resolve(__dirname), path.resolve(__dirname, '..', 'src')];
    const offenders: string[] = [];

    for (const root of roots) {
      for (const file of walk(root)) {
        if (path.resolve(file) === path.resolve(__filename)) continue; // this file names the pattern
        const content = readFileSync(file, 'utf-8');
        const idx = content.indexOf(MOCK_MARKER);
        if (idx === -1) continue;
        // The mock's object literal — bounded so we don't scan the whole file.
        const block = content.slice(idx, idx + 400);
        const missing = REAL_METHODS.filter((m) => !new RegExp(`\\b${m}\\s*:`).test(block));
        if (missing.length > 0) {
          offenders.push(`${path.relative(process.cwd(), file)} missing: ${missing.join(', ')}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
