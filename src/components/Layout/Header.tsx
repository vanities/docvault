import { RefreshCw, Sparkles } from 'lucide-react';
import { useAppContext } from '../../contexts/AppContext';
import { useToast } from '../../hooks/useToast';
import { TaxYearSelector } from '../Dashboard/TaxYearSelector';

export function Header() {
  const {
    dataDir,
    activeView,
    selectedEntity,
    selectedYear,
    setSelectedYear,
    availableYears,
    scannedDocuments,
    setScannedDocuments,
    isProcessing,
    isParsing,
    setIsParsing,
    scanTaxYear,
    parseAllFiles,
    isScanning,
  } = useAppContext();

  const { addToast } = useToast();

  // Rescan files
  const handleRescan = async () => {
    const docs = await scanTaxYear(selectedEntity, selectedYear);
    setScannedDocuments(docs);
  };

  // Parse all files with Claude Vision AI
  const handleParseAll = async () => {
    setIsParsing(true);
    const result = await parseAllFiles(selectedEntity, selectedYear);
    setIsParsing(false);

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

  // Only show tax year controls when in tax-year view
  const showTaxYearControls = activeView === 'tax-year';

  return (
    <header className="glass-strong h-14 flex items-center px-6 border-b border-border relative z-20">
      <div className="flex items-center gap-3 flex-1">
        <p className="text-xs text-surface-600 truncate max-w-[300px] font-mono">{dataDir}</p>
      </div>

      {/* Tax Year Controls - only visible in tax-year view */}
      {showTaxYearControls && (
        <div className="flex items-center gap-2">
          <button
            onClick={handleParseAll}
            disabled={isProcessing || scannedDocuments.length === 0 || selectedEntity === 'all'}
            className="flex items-center gap-2 px-3 py-1.5 text-[13px] font-medium text-purple-400 bg-purple-500/10 hover:bg-purple-500/20 rounded-lg transition-all duration-150 disabled:opacity-40"
            title={
              selectedEntity === 'all'
                ? 'Select a specific entity to parse all'
                : 'Parse all documents with Claude AI'
            }
          >
            <Sparkles className={`w-3.5 h-3.5 ${isParsing ? 'animate-pulse' : ''}`} />
            {isParsing ? 'Parsing...' : 'Parse All'}
          </button>

          <button
            onClick={handleRescan}
            disabled={isProcessing}
            className="p-1.5 text-surface-600 hover:text-surface-900 hover:bg-surface-300/40 rounded-lg transition-all duration-150 disabled:opacity-40"
            title="Rescan folder"
          >
            <RefreshCw className={`w-4 h-4 ${isScanning ? 'animate-spin' : ''}`} />
          </button>

          <TaxYearSelector
            selectedYear={selectedYear}
            availableYears={availableYears}
            onYearChange={setSelectedYear}
            disabled={isProcessing}
          />
        </div>
      )}
    </header>
  );
}
