import { useMemo, useState } from 'react';
import { Search, FileText, Image, File, Loader2, FolderOpen, AlertTriangle } from 'lucide-react';
import { useAppContext, type SearchResult } from '../../contexts/AppContext';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Money } from '../common/Money';
import { filterSearchResults, type SearchFileKind, type SearchSort } from './searchResults';

const PAGE_SIZE = 50;
const SELECT_CLASS =
  'min-h-11 sm:min-h-9 w-full rounded-lg border border-border bg-surface-100 px-3 text-base sm:text-sm text-surface-900';

function ResultFileIcon({ fileType }: { fileType: string }) {
  const Icon = fileType.startsWith('image/')
    ? Image
    : fileType === 'application/pdf'
      ? FileText
      : File;
  return <Icon className="w-5 h-5 text-surface-700" aria-hidden />;
}
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function getAmount(parsed: Record<string, unknown> | null): number | null {
  if (!parsed) return null;
  for (const field of [
    'totalAmount',
    'amount',
    'wages',
    'nonemployeeCompensation',
    'ordinaryDividends',
    'interestIncome',
  ]) {
    if (typeof parsed[field] === 'number') return parsed[field];
  }
  return null;
}
function getVendor(parsed: Record<string, unknown> | null): string | null {
  if (!parsed) return null;
  for (const field of ['vendor', 'employerName', 'payerName']) {
    if (typeof parsed[field] === 'string') return parsed[field];
  }
  return null;
}
function ResultCard({ result }: { result: SearchResult }) {
  const { openFile, requestScopeChange } = useAppContext();
  const amount = getAmount(result.parsedData);
  const vendor = getVendor(result.parsedData);
  const yearMatch = result.path.match(/^(\d{4})\//);
  const year = yearMatch ? Number(yearMatch[1]) : null;
  const handleNavigate = () => {
    const view = result.path.startsWith('business-docs/')
      ? 'business-docs'
      : year
        ? 'tax-year'
        : 'all-files';
    void requestScopeChange({ entity: result.entity, ...(year ? { year } : {}), view });
  };
  return (
    <Card variant="glass" className="p-3 sm:p-4 min-w-0">
      <div className="flex items-start gap-3">
        <div className="hidden sm:flex size-10 bg-surface-300/40 rounded-lg items-center justify-center shrink-0">
          <ResultFileIcon fileType={result.type} />
        </div>
        <div className="flex-1 min-w-0">
          <button
            type="button"
            onClick={() => void openFile(result.entity, result.path)}
            aria-label={`Open ${result.name}`}
            className="min-h-11 sm:min-h-6 w-full text-left text-sm font-medium text-surface-950 break-all hover:text-accent-400 rounded focus-visible:outline-2 focus-visible:outline-accent-400"
          >
            {result.name}
          </button>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-xs text-surface-600">
            <span>{result.entityName}</span>
            {year && <span className="text-blue-400">{year}</span>}
            <span>{formatFileSize(result.size)}</span>
            {amount !== null && (
              <span className="font-semibold text-surface-900">
                <Money>
                  {amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                </Money>
              </span>
            )}
            {vendor && <span className="break-words text-surface-800">{vendor}</span>}
          </div>
          <p className="text-xs text-surface-600 mt-2 break-all font-mono">{result.path}</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleNavigate}
            aria-label={`Show folder for ${result.name} in ${result.entityName}`}
            className="mt-2 min-h-11 sm:min-h-8 -ml-2 text-accent-400"
          >
            <FolderOpen className="size-4" aria-hidden />
            Show folder
          </Button>
        </div>
      </div>
    </Card>
  );
}

// A new query starts a fresh result view; filtering and paging survive retries.
export function SearchResultsView() {
  const { searchQuery } = useAppContext();
  return <SearchResults key={searchQuery} />;
}
function SearchResults() {
  const { searchQuery, searchResults, isSearching, searchError, retrySearch, clearSearch } =
    useAppContext();
  const [entity, setEntity] = useState('all');
  const [kind, setKind] = useState<SearchFileKind>('all');
  const [sort, setSort] = useState<SearchSort>('name');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const entityOptions = useMemo(
    () =>
      [
        ...new Map(searchResults.map((result) => [result.entity, result.entityName])).entries(),
      ].sort((a, b) => a[1].localeCompare(b[1])),
    [searchResults]
  );
  const filtered = useMemo(
    () => filterSearchResults(searchResults, entity, kind, sort),
    [searchResults, entity, kind, sort]
  );
  const resetFilters = () => {
    setEntity('all');
    setKind('all');
    setVisibleCount(PAGE_SIZE);
  };
  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="flex items-start gap-2 mb-4 min-w-0">
        <Search className="w-5 h-5 text-surface-600 shrink-0 mt-1" aria-hidden />
        <div className="min-w-0">
          <h2 className="font-display text-lg text-surface-950 italic break-words">
            Search results for &ldquo;{searchQuery}&rdquo;
          </h2>
          <p role="status" className="text-sm text-surface-600 mt-1">
            {isSearching
              ? 'Searching all entities…'
              : searchError
                ? 'Search could not finish.'
                : `${filtered.length} of ${searchResults.length} files`}
          </p>
        </div>
      </div>
      {isSearching ? (
        <div className="flex items-center justify-center py-20 text-surface-600" aria-busy="true">
          <Loader2 className="w-6 h-6 animate-spin" aria-hidden />
          <span className="ml-2 text-sm">Searching…</span>
        </div>
      ) : searchError ? (
        <Card className="p-5 space-y-3">
          <div role="alert" className="flex items-start gap-2 text-sm text-danger-400">
            <AlertTriangle className="size-5 shrink-0" aria-hidden />
            <p>{searchError}</p>
          </div>
          <Button onClick={retrySearch} className="min-h-11">
            Retry search
          </Button>
        </Card>
      ) : searchResults.length === 0 ? (
        <Card className="flex flex-col items-center text-center py-12 px-4 text-surface-600 gap-3">
          <Search className="size-10 opacity-40" aria-hidden />
          <p className="text-sm break-words">
            No files found matching &ldquo;{searchQuery}&rdquo;.
          </p>
          <p className="text-xs">Try part of a filename, folder, vendor, or payer name.</p>
          <Button variant="outline" onClick={clearSearch} className="min-h-11">
            Back to documents
          </Button>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
            <label className="col-span-2 sm:col-span-1 text-xs text-surface-600 space-y-1">
              <span>Entity</span>
              <select
                aria-label="Entity"
                value={entity}
                onChange={(event) => {
                  setEntity(event.target.value);
                  setVisibleCount(PAGE_SIZE);
                }}
                className={SELECT_CLASS}
              >
                <option value="all">All entities</option>
                {entityOptions.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-surface-600 space-y-1">
              <span>File type</span>
              <select
                aria-label="File type"
                value={kind}
                onChange={(event) => {
                  setKind(event.target.value as SearchFileKind);
                  setVisibleCount(PAGE_SIZE);
                }}
                className={SELECT_CLASS}
              >
                <option value="all">All types</option>
                <option value="pdf">PDFs</option>
                <option value="image">Images</option>
                <option value="other">Other files</option>
              </select>
            </label>
            <label className="text-xs text-surface-600 space-y-1">
              <span>Sort by</span>
              <select
                aria-label="Sort by"
                value={sort}
                onChange={(event) => {
                  setSort(event.target.value as SearchSort);
                  setVisibleCount(PAGE_SIZE);
                }}
                className={SELECT_CLASS}
              >
                <option value="name">Filename</option>
                <option value="newest">Newest modified</option>
                <option value="oldest">Oldest modified</option>
                <option value="size">Largest first</option>
              </select>
            </label>
          </div>
          {(entity !== 'all' || kind !== 'all') && (
            <Button variant="ghost" onClick={resetFilters} className="min-h-11 mb-3">
              Clear filters
            </Button>
          )}
          {filtered.length === 0 ? (
            <Card className="p-6 text-center text-sm text-surface-600">
              <p>No files match these filters.</p>
              <Button variant="outline" onClick={resetFilters} className="mt-3 min-h-11">
                Show all results
              </Button>
            </Card>
          ) : (
            <div className="grid gap-3">
              {filtered.slice(0, visibleCount).map((result) => (
                <ResultCard key={`${result.entity}/${result.path}`} result={result} />
              ))}
            </div>
          )}
          {filtered.length > visibleCount && (
            <Button
              variant="outline"
              className="w-full mt-4 min-h-11"
              onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
            >
              Show more ({filtered.length - visibleCount} remaining)
            </Button>
          )}
        </>
      )}
    </div>
  );
}
