import { Search, FileText, Image, File, Loader2 } from 'lucide-react';
import { useAppContext, type SearchResult } from '../../contexts/AppContext';

function ResultFileIcon({ fileType, className }: { fileType: string; className?: string }) {
  if (fileType.startsWith('image/')) return <Image className={className} />;
  if (fileType === 'application/pdf') return <FileText className={className} />;
  return <File className={className} />;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getAmount(parsed: Record<string, unknown> | null): number | null {
  if (!parsed) return null;
  if (typeof parsed.totalAmount === 'number') return parsed.totalAmount;
  if (typeof parsed.amount === 'number') return parsed.amount;
  if (typeof parsed.wages === 'number') return parsed.wages;
  if (typeof parsed.nonemployeeCompensation === 'number') return parsed.nonemployeeCompensation;
  if (typeof parsed.ordinaryDividends === 'number') return parsed.ordinaryDividends;
  if (typeof parsed.interestIncome === 'number') return parsed.interestIncome;
  return null;
}

function getVendor(parsed: Record<string, unknown> | null): string | null {
  if (!parsed) return null;
  if (typeof parsed.vendor === 'string') return parsed.vendor;
  if (typeof parsed.employerName === 'string') return parsed.employerName;
  if (typeof parsed.payerName === 'string') return parsed.payerName;
  return null;
}

function ResultCard({ result }: { result: SearchResult }) {
  const { openFile, setSelectedEntity, setSelectedYear, setActiveView, clearSearch } =
    useAppContext();

  const amount = getAmount(result.parsedData);
  const vendor = getVendor(result.parsedData);
  const yearMatch = result.path.match(/^(\d{4})\//);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : null;

  const handleClick = () => {
    openFile(result.entity, result.path);
  };

  const handleNavigate = () => {
    setSelectedEntity(result.entity);
    if (result.path.startsWith('business-docs/')) {
      setActiveView('business-docs');
    } else if (year) {
      setSelectedYear(year);
      setActiveView('tax-year');
    } else {
      setActiveView('all-files');
    }
    clearSearch();
  };

  return (
    <div
      onClick={handleClick}
      className="glass-card rounded-xl p-4 hover:border-border-strong transition-all duration-200 cursor-pointer group"
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 bg-surface-300/40 rounded-lg flex items-center justify-center flex-shrink-0">
          <ResultFileIcon fileType={result.type} className="w-5 h-5 text-surface-700" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-surface-950 truncate">{result.name}</p>
              <p className="text-[11px] text-surface-600 mt-0.5">
                {formatFileSize(result.size)}
                {amount !== null && (
                  <span className="ml-1.5 font-semibold text-surface-900">
                    · $
                    {amount.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleNavigate();
              }}
              className="inline-flex px-2 py-0.5 rounded-md text-[11px] font-medium bg-accent-500/15 text-accent-400 hover:bg-accent-500/25 transition-colors"
            >
              {result.entityName}
            </button>

            {year && (
              <span className="inline-flex px-2 py-0.5 rounded-md text-[11px] font-medium bg-blue-500/15 text-blue-400">
                {year}
              </span>
            )}

            {result.path.startsWith('business-docs/') && (
              <span className="inline-flex px-2 py-0.5 rounded-md text-[11px] font-medium bg-purple-500/15 text-purple-400">
                Business
              </span>
            )}

            {vendor && (
              <span className="inline-flex px-2 py-0.5 rounded-md text-[11px] font-medium bg-surface-400/15 text-surface-800">
                {vendor}
              </span>
            )}
          </div>

          <p className="text-[11px] text-surface-600 mt-1.5 truncate font-mono">{result.path}</p>
        </div>
      </div>
    </div>
  );
}

export function SearchResultsView() {
  const { searchQuery, searchResults, isSearching } = useAppContext();

  return (
    <div className="p-6">
      <div className="flex items-center gap-2 mb-5">
        <Search className="w-5 h-5 text-surface-600" />
        <h2 className="font-display text-lg text-surface-950 italic">
          Search results for "{searchQuery}"
        </h2>
        {!isSearching && (
          <span className="text-[13px] text-surface-600 ml-1">
            ({searchResults.length} result{searchResults.length !== 1 ? 's' : ''})
          </span>
        )}
      </div>

      {isSearching ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 text-surface-600 animate-spin" />
          <span className="ml-2 text-[13px] text-surface-600">Searching...</span>
        </div>
      ) : searchResults.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-surface-600">
          <Search className="w-10 h-10 mb-3 opacity-30" />
          <p className="text-[13px]">No files found matching "{searchQuery}"</p>
        </div>
      ) : (
        <div className="grid gap-2">
          {searchResults.map((result, i) => (
            <ResultCard key={`${result.entity}-${result.path}-${i}`} result={result} />
          ))}
        </div>
      )}
    </div>
  );
}
