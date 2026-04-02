import { useState, useMemo } from 'react';
import { RefreshCw, Sparkles, Search, X, Menu, ChevronDown } from 'lucide-react';
import { useAppContext } from '../../contexts/AppContext';
import { useToast } from '../../hooks/useToast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function Header() {
  const {
    dataDir,
    setSidebarOpen,
    activeView,
    selectedEntity,
    selectedYear,
    entities,
    scannedDocuments,
    setScannedDocuments,
    isProcessing,
    isParsing,
    setIsParsing,
    scanTaxYear,
    parseAllFiles,
    isScanning,
    searchQuery,
    setSearchQuery,
    clearSearch,
    searchActive,
  } = useAppContext();

  const { addToast } = useToast();
  const [parseProgress, setParseProgress] = useState<{
    current: number;
    total: number;
    fileName: string;
  } | null>(null);

  // Count unparsed income/expense files
  const unparsedCount = useMemo(() => {
    return scannedDocuments.filter((doc) => {
      const pathLower = (doc.filePath ?? '').toLowerCase();
      const isIncomeOrExpense = pathLower.includes('/income/') || pathLower.includes('/expenses/');
      return isIncomeOrExpense && !doc.parsedData;
    }).length;
  }, [scannedDocuments]);

  // Rescan files
  const handleRescan = async () => {
    const docs = await scanTaxYear(selectedEntity, selectedYear);
    setScannedDocuments(docs);
  };

  // Parse files with Claude Vision AI
  const handleParse = async (unparsedOnly: boolean) => {
    setIsParsing(true);
    setParseProgress(null);
    const result = await parseAllFiles(selectedEntity, selectedYear, {
      filter: ['income', 'expenses'],
      unparsedOnly,
      onProgress: setParseProgress,
    });
    setIsParsing(false);
    setParseProgress(null);

    if (result) {
      if (result.failed === 0) {
        addToast(`Successfully parsed ${result.parsed} files`, 'success');
      } else {
        addToast(
          `Parsed ${result.parsed} of ${result.total} files. ${result.failed} failed.`,
          result.failed > result.parsed ? 'error' : 'info'
        );
      }
      // Rescan to get updated parsed data
      await handleRescan();
    } else {
      addToast('Failed to parse files', 'error');
    }
  };

  // Only show tax year controls when in tax-year view and not searching
  const showTaxYearControls = activeView === 'tax-year' && !searchActive;

  return (
    <header className="glass-strong h-14 flex items-center px-4 md:px-6 gap-3 border-b border-border relative z-20">
      {/* Hamburger — mobile only */}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => setSidebarOpen(true)}
        className="md:hidden -ml-1"
      >
        <Menu className="w-5 h-5" />
      </Button>

      {/* Entity + Year — mobile only */}
      {!searchActive && (
        <div className="md:hidden flex items-center gap-1.5 min-w-0">
          <span className="text-[13px] font-semibold text-surface-950 truncate">
            {selectedEntity === 'all'
              ? 'All Entities'
              : (entities.find((e) => e.id === selectedEntity)?.name ?? selectedEntity)}
          </span>
          <span className="text-[12px] text-surface-600 shrink-0">{selectedYear}</span>
        </div>
      )}

      {/* Data dir — desktop only */}
      <div className="hidden md:flex items-center gap-3 flex-1">
        <p className="text-xs text-surface-600 truncate max-w-[300px] font-mono">{dataDir}</p>
      </div>

      {/* Search Bar */}
      <div className="relative flex items-center flex-1 md:flex-none">
        <Search className="absolute left-2.5 w-3.5 h-3.5 text-surface-600 pointer-events-none" />
        <Input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search all files..."
          className="w-full md:w-56 h-8 pl-8 pr-7 text-[13px] rounded-lg"
        />
        {searchQuery && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={clearSearch}
            className="absolute right-1 top-1/2 -translate-y-1/2"
          >
            <X className="w-3 h-3" />
          </Button>
        )}
      </div>

      {/* Tax Year Controls - desktop only, visible in tax-year view when not searching */}
      {showTaxYearControls && (
        <div className="hidden md:flex items-center gap-2 ml-4">
          {/* Split parse button */}
          <div className="flex items-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleParse(true)}
              disabled={isProcessing || unparsedCount === 0 || selectedEntity === 'all'}
              className="text-purple-400 bg-purple-500/10 hover:bg-purple-500/20 rounded-l-lg rounded-r-none"
              title={
                selectedEntity === 'all'
                  ? 'Select a specific entity to parse'
                  : 'Parse unparsed income & expenses with Claude AI'
              }
            >
              <Sparkles className={`w-3.5 h-3.5 ${isParsing ? 'animate-pulse' : ''}`} />
              <span className="hidden sm:inline">
                {parseProgress
                  ? `${parseProgress.current}/${parseProgress.total}`
                  : isParsing
                    ? 'Parsing...'
                    : `Parse ${unparsedCount} unparsed`}
              </span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  disabled={
                    isProcessing || scannedDocuments.length === 0 || selectedEntity === 'all'
                  }
                  className="text-purple-400 bg-purple-500/10 hover:bg-purple-500/20 rounded-l-none rounded-r-lg border-l border-purple-500/20"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={unparsedCount === 0} onClick={() => handleParse(true)}>
                  Parse {unparsedCount} unparsed
                </DropdownMenuItem>
                <DropdownMenuItem className="text-warn-400" onClick={() => handleParse(false)}>
                  Force re-parse all
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={handleRescan} disabled={isProcessing}>
                <RefreshCw className={`w-4 h-4 ${isScanning ? 'animate-spin' : ''}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Rescan folder</TooltipContent>
          </Tooltip>
        </div>
      )}

      {/* Parse progress bar */}
      {parseProgress && (
        <div className="absolute bottom-0 left-0 right-0 translate-y-full z-10">
          <div className="h-1 bg-purple-500/10">
            <div
              className="h-full bg-purple-400 transition-all duration-300"
              style={{ width: `${(parseProgress.current / parseProgress.total) * 100}%` }}
            />
          </div>
          <div className="px-4 py-1 bg-surface-100/90 backdrop-blur-sm border-b border-border text-[11px] text-surface-600 truncate">
            Parsing {parseProgress.current}/{parseProgress.total}: {parseProgress.fileName}
          </div>
        </div>
      )}
    </header>
  );
}
