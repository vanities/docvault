/// <reference types="node" />
// Navigation wiring invariants — guards the 3-place contract documented in
// CLAUDE.md. Whenever a new view is added to the sidebar (any sidebar: main
// or Health section), it MUST also appear in:
//   1. NavView union in AppContext.tsx
//   2. `validViews` Set in AppContext.tsx (hash routing + localStorage restore)
//   3. The switch in Layout.tsx
//
// Forgetting any of these causes silent, confusing failures:
//   - Miss from NavView → TypeScript catches, usually.
//   - Miss from validViews → hash routing falls back to 'tax-year', sidebar
//     click looks like it worked but the wrong page renders.
//   - Miss from Layout switch → default case renders TaxYearView, same UX.
//
// This test parses the source files with simple regex and cross-checks the
// three lists. It's not a perfect parser, but it catches the common failure
// mode (you added a sidebar button and forgot validViews) that burned us
// when `'health-nutrition'` was missing after the Nutrition tab shipped.

import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, test } from 'vite-plus/test';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

const appContextSrc = read('src/contexts/AppContext.tsx');
const layoutSrc = read('src/components/Layout/Layout.tsx');
const mainSidebarSrc = read('src/components/Layout/Sidebar.tsx');
const healthSidebarSrc = read('src/components/Layout/HealthSidebarSection.tsx');

// ---------------------------------------------------------------------------
// Extractors — deliberately dumb regexes to keep test changes narrow when the
// source files drift on whitespace or unrelated code.
// ---------------------------------------------------------------------------

/** Extract the string literals inside `validViews`'s `new Set<string>([ ... ])` in AppContext.tsx. */
function extractValidViews(source: string): Set<string> {
  const match = source.match(
    /validViews\s*=\s*(?:useMemo\([\s\S]*?=>\s*)?new Set<string>\(\[([\s\S]*?)\]\)/
  );
  if (!match) throw new Error('Could not find validViews Set in AppContext.tsx');
  const literals = match[1].match(/'([^']+)'/g) ?? [];
  return new Set(literals.map((l) => l.slice(1, -1)));
}

/** Extract the NavView string literal members from the NavView union in AppContext.tsx. */
function extractNavViewUnion(source: string): Set<string> {
  const match = source.match(/export type NavView\s*=([\s\S]*?);/);
  if (!match) throw new Error('Could not find NavView union in AppContext.tsx');
  const literals = match[1].match(/'([^']+)'/g) ?? [];
  return new Set(literals.map((l) => l.slice(1, -1)));
}

/** Extract every `case 'xxx':` in Layout.tsx's renderContent() switch. */
function extractLayoutCases(source: string): Set<string> {
  const matches = source.matchAll(/case '([^']+)':/g);
  const views = new Set<string>();
  for (const m of matches) views.add(m[1]);
  return views;
}

/** Extract every `view="xxx"` attribute in sidebar files. */
function extractSidebarViews(source: string): Set<string> {
  const matches = source.matchAll(/view="([^"]+)"/g);
  const views = new Set<string>();
  for (const m of matches) views.add(m[1]);
  return views;
}

// ---------------------------------------------------------------------------
// Test fixtures — read once, share across tests
// ---------------------------------------------------------------------------

const navViewUnion = extractNavViewUnion(appContextSrc);
const validViews = extractValidViews(appContextSrc);
const layoutCases = extractLayoutCases(layoutSrc);
// Union of every sidebar's buttons (main + health + any future sidebars).
const sidebarViews = new Set([
  ...extractSidebarViews(mainSidebarSrc),
  ...extractSidebarViews(healthSidebarSrc),
]);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('navigation wiring invariants', () => {
  test('sanity check: non-empty sidebar + validViews + Layout switch', () => {
    expect(sidebarViews.size).toBeGreaterThan(5);
    expect(validViews.size).toBeGreaterThan(5);
    expect(layoutCases.size).toBeGreaterThan(5);
    expect(navViewUnion.size).toBeGreaterThan(5);
  });

  test('every sidebar button view is in the NavView union', () => {
    const missing = [...sidebarViews].filter((v) => !navViewUnion.has(v));
    expect(
      missing,
      `Sidebar references views missing from NavView union: ${missing.join(', ')}`
    ).toEqual([]);
  });

  test('every sidebar button view is in validViews (hash routing will work)', () => {
    const missing = [...sidebarViews].filter((v) => !validViews.has(v));
    expect(
      missing,
      `Sidebar references views missing from validViews Set in AppContext.tsx — ` +
        `hash routing to #${missing[0] ?? 'xxx'} would silently fall back to 'tax-year'. ` +
        `Missing: ${missing.join(', ')}`
    ).toEqual([]);
  });

  test('every sidebar button view has a case in Layout.tsx', () => {
    const missing = [...sidebarViews].filter((v) => !layoutCases.has(v));
    expect(
      missing,
      `Sidebar references views without a Layout.tsx switch case — ` +
        `the default (TaxYearView) will render. Missing: ${missing.join(', ')}`
    ).toEqual([]);
  });

  test('every validViews entry is in the NavView union (no orphan string literals)', () => {
    const missing = [...validViews].filter((v) => !navViewUnion.has(v));
    expect(
      missing,
      `validViews contains strings not in NavView union: ${missing.join(', ')}`
    ).toEqual([]);
  });

  test('every validViews entry has a Layout.tsx case OR is reachable via search fallback', () => {
    // 'search' isn't a route case — SearchResultsView is rendered via
    // `searchActive` short-circuit in Layout. Any other mismatch is a bug.
    const allowedWithoutCase = new Set<string>(['search']);
    const missing = [...validViews].filter(
      (v) => !layoutCases.has(v) && !allowedWithoutCase.has(v)
    );
    expect(
      missing,
      `validViews contains strings without a Layout.tsx case: ${missing.join(', ')}`
    ).toEqual([]);
  });
});
