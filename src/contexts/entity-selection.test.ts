// Regression: the stale-entity fallback in AppContext must never revert the
// 'all' pseudo-entity. 'all' is client-side only (the sidebar's "All Entities"
// option) and never appears in the server's entity list, so a plain
// "is it in `entities`?" check snaps the selection back to entities[0] the
// moment the user picks it — which is exactly the bug de8f594 introduced.

import { describe, expect, test } from 'vite-plus/test';
import { isKnownEntitySelection } from './AppContext';
import type { EntityConfig } from '../hooks/useFileSystemServer';

const entities: EntityConfig[] = [
  { id: 'personal', name: 'Personal', color: 'blue', path: 'personal' },
  { id: 'acme-llc', name: 'Acme LLC', color: 'emerald', path: 'acme-llc' },
];

describe('isKnownEntitySelection', () => {
  test("treats the 'all' pseudo-entity as always valid", () => {
    expect(isKnownEntitySelection('all', entities)).toBe(true);
  });

  test("'all' stays valid even before the entity list loads", () => {
    // The effect early-returns on entities.length === 0, but the predicate
    // itself should not depend on the list being populated.
    expect(isKnownEntitySelection('all', [])).toBe(true);
  });

  test('accepts a real server-side entity id', () => {
    expect(isKnownEntitySelection('acme-llc', entities)).toBe(true);
  });

  test('rejects a stale id so the fallback still fires', () => {
    expect(isKnownEntitySelection('deleted-entity', entities)).toBe(false);
  });
});
