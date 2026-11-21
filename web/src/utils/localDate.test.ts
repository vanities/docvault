/// <reference types="node" />
import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { afterEach, describe, expect, test, vi } from 'vite-plus/test';
import { todayISO } from './localDate';

const WEB = path.resolve(import.meta.dirname, '..', '..');

const UTC_TODAY =
  /new Date\(\)\.toISOString\(\)\.(?:split\('T'\)\[0\]|slice\(0, ?10\)|substring\(0, ?10\))/;

// Log files roll over on the UTC day so one day's lines stay in one file
// whatever timezone the settings name.
const ALLOWED = new Set(['server/logger.ts']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('local dates', () => {
  test('an evening entry keeps its own calendar day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2030, 0, 15, 20, 30));
    expect(todayISO(), '8:30 PM local on Jan 15 is still Jan 15').toBe('2030-01-15');
  });

  test('no code fills in today from the UTC day', () => {
    const offenders: string[] = [];
    for (const dir of ['src', 'server']) {
      for (const file of sourceFiles(path.join(WEB, dir))) {
        const rel = path.relative(WEB, file);
        if (ALLOWED.has(rel)) continue;
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (UTC_TODAY.test(line)) offenders.push(`${rel}:${i + 1}`);
          });
      }
    }
    expect(
      offenders,
      'use todayISO() from src/utils/localDate in the browser, calendarToday() from server/calendar-store on the server'
    ).toEqual([]);
  });
});
