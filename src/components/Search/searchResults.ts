import type { SearchResult } from '../../contexts/AppContext';

export type SearchFileKind = 'all' | 'pdf' | 'image' | 'other';
export type SearchSort = 'name' | 'newest' | 'oldest' | 'size';

export function searchFileKind(type: string): Exclude<SearchFileKind, 'all'> {
  if (type === 'application/pdf') return 'pdf';
  return type.startsWith('image/') ? 'image' : 'other';
}

export function filterSearchResults(
  results: readonly SearchResult[],
  entity: string,
  kind: SearchFileKind,
  sort: SearchSort
): SearchResult[] {
  return results
    .filter(
      (result) =>
        (entity === 'all' || result.entity === entity) &&
        (kind === 'all' || searchFileKind(result.type) === kind)
    )
    .sort((a, b) => {
      const nameOrder = a.name.localeCompare(b.name, undefined, { numeric: true });
      if (sort === 'newest') return b.lastModified - a.lastModified || nameOrder;
      if (sort === 'oldest') return a.lastModified - b.lastModified || nameOrder;
      if (sort === 'size') return b.size - a.size || nameOrder;
      return nameOrder;
    });
}
