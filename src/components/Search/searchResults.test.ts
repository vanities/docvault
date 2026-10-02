import { describe, expect, test } from 'vite-plus/test';
import type { SearchResult } from '../../contexts/AppContext';
import { filterSearchResults, searchFileKind } from './searchResults';

const result = (name: string, overrides: Partial<SearchResult> = {}): SearchResult => ({
  entity: 'acme',
  entityName: 'Acme Company',
  name,
  path: `demo/${name}`,
  size: 100,
  lastModified: 1000,
  type: 'application/pdf',
  parsedData: null,
  ...overrides,
});

describe('search result controls', () => {
  test('classifies SVG and photos as images, with a separate PDF and other group', () => {
    expect(
      ['image/svg+xml', 'image/jpeg', 'application/pdf', 'text/plain', ''].map(searchFileKind)
    ).toEqual(['image', 'image', 'pdf', 'other', 'other']);
  });
  test('combines entity and file type without widening an empty scope', () => {
    const rows = [
      result('one.pdf'),
      result('two.jpg', { type: 'image/jpeg' }),
      result('three.pdf', { entity: 'studio' }),
    ];
    expect(filterSearchResults(rows, 'acme', 'pdf', 'name').map((r) => r.name)).toEqual([
      'one.pdf',
    ]);
    expect(filterSearchResults(rows, 'studio', 'image', 'name')).toEqual([]);
    expect(filterSearchResults(rows, 'missing', 'all', 'name')).toEqual([]);
  });
  test('filename sorting uses natural numbers', () => {
    expect(
      filterSearchResults([result('Demo_10.pdf'), result('Demo_2.pdf')], 'all', 'all', 'name').map(
        (r) => r.name
      )
    ).toEqual(['Demo_2.pdf', 'Demo_10.pdf']);
  });
  test('date sorting uses modification time and resolves ties consistently', () => {
    const rows = [
      result('B.pdf', { lastModified: 2000 }),
      result('Old.pdf'),
      result('A.pdf', { lastModified: 2000 }),
    ];
    expect(filterSearchResults(rows, 'all', 'all', 'newest').map((r) => r.name)).toEqual([
      'A.pdf',
      'B.pdf',
      'Old.pdf',
    ]);
    expect(filterSearchResults(rows, 'all', 'all', 'oldest').map((r) => r.name)).toEqual([
      'Old.pdf',
      'A.pdf',
      'B.pdf',
    ]);
  });
  test('largest first orders file size, including zero-byte files', () => {
    const rows = [
      result('empty.pdf', { size: 0 }),
      result('small.pdf'),
      result('large.pdf', { size: 5000 }),
    ];
    expect(filterSearchResults(rows, 'all', 'all', 'size').map((r) => r.name)).toEqual([
      'large.pdf',
      'small.pdf',
      'empty.pdf',
    ]);
  });
  test('filtering and sorting preserve the API response for clearing filters', () => {
    const rows = Object.freeze([
      Object.freeze(result('Z.pdf')),
      Object.freeze(result('A.pdf', { entity: 'studio' })),
    ]);
    const original = [...rows];
    filterSearchResults(rows, 'acme', 'pdf', 'name');
    expect(rows).toEqual(original);
  });
});
