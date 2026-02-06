import { useState, useEffect, useMemo } from 'react';
import { Vault, RefreshCw, AlertCircle, Server, Sparkles, Cpu, Zap, Settings } from 'lucide-react';
import { useToast } from '../../hooks/useToast';
import { EntitySwitcher } from './EntitySwitcher';
import { TaxYearSelector } from './TaxYearSelector';
import { QuickStats } from './QuickStats';
import { UploadZone } from '../Documents/UploadZone';
import { DocumentList } from '../Documents/DocumentList';
import { IncomeSummary } from '../Summary/IncomeSummary';
import { ExpenseSummary } from '../Summary/ExpenseSummary';
import { SettingsModal } from '../Settings/SettingsModal';
import { useDocuments } from '../../hooks/useDocuments';
import { useFileSystemServer } from '../../hooks/useFileSystemServer';
import { EXPENSE_CATEGORIES } from '../../config';
import type {
  Entity,
  TaxDocument,
  IncomeSummary as IncomeSummaryType,
  ExpenseSummary as ExpenseSummaryType,
  ExpenseCategory,
} from '../../types';

type TabType = 'documents' | 'income' | 'expenses';

export function Dashboard() {
  const currentYear = new Date().getFullYear();
  const [selectedEntity, setSelectedEntity] = useState<Entity>(() => {
    const saved = localStorage.getItem('taxvault-entity');
    return (saved as Entity) || 'personal';
  });
  const [selectedYear, setSelectedYear] = useState(() => {
    const saved = localStorage.getItem('taxvault-year');
    return saved ? parseInt(saved, 10) : currentYear;
  });
  const [activeTab, setActiveTab] = useState<TabType>('documents');
  const [scannedDocuments, setScannedDocuments] = useState<TaxDocument[]>([]);

  const { addToast } = useToast();
  const { updateDocument, deleteDocument } = useDocuments();

  const {
    isConnected,
    dataDir,
    isScanning,
    error: fsError,
    entities,
    checkConnection,
    getYearsForEntity,
    scanTaxYear,
    importFile,
    parseFile,
    parseAllFiles,
    addEntity,
    removeEntity,
    moveFile,
  } = useFileSystemServer();
  const [entityYears, setEntityYears] = useState<number[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [useAI, setUseAI] = useState(true); // Default to AI parsing
  const [showSettings, setShowSettings] = useState(false);

  // Global processing state - disables UI during operations
  const isProcessing = isScanning || isParsing;

  // Persist selections to localStorage
  useEffect(() => {
    localStorage.setItem('taxvault-entity', selectedEntity);
  }, [selectedEntity]);

  useEffect(() => {
    localStorage.setItem('taxvault-year', String(selectedYear));
  }, [selectedYear]);

  // Fetch available years when entity changes
  useEffect(() => {
    if (isConnected) {
      getYearsForEntity(selectedEntity).then(setEntityYears);
    }
  }, [isConnected, selectedEntity, getYearsForEntity]);

  // Scan files when entity or year changes
  useEffect(() => {
    if (isConnected) {
      scanTaxYear(selectedEntity, selectedYear).then(setScannedDocuments);
    }
  }, [isConnected, selectedEntity, selectedYear, scanTaxYear]);

  // Rescan files
  const handleRescan = async () => {
    const docs = await scanTaxYear(selectedEntity, selectedYear);
    setScannedDocuments(docs);
  };

  // Parse all files
  const handleParseAll = async () => {
    setIsParsing(true);
    const result = await parseAllFiles(selectedEntity, selectedYear, useAI);
    setIsParsing(false);

    if (result) {
      if (result.failed === 0) {
        addToast(`Successfully parsed ${result.parsed} files${useAI ? ' with AI' : ''}`, 'success');
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

  // Parse a single document
  const handleParseDocument = async (
    doc: TaxDocument,
    forceAI = false
  ): Promise<TaxDocument | null> => {
    if (!doc.filePath) {
      addToast('No file path for document', 'error');
      return null;
    }

    const shouldUseAI = forceAI || useAI;
    const parsedData = await parseFile(selectedEntity, doc.filePath, shouldUseAI);

    if (parsedData) {
      addToast(`Document parsed successfully${shouldUseAI ? ' with AI' : ''}`, 'success');
      // Update the document in our local state
      const updatedDoc = { ...doc, parsedData: parsedData as TaxDocument['parsedData'] };
      setScannedDocuments((prev) => prev.map((d) => (d.id === doc.id ? updatedDoc : d)));
      return updatedDoc;
    } else {
      addToast('Failed to parse document', 'error');
      return null;
    }
  };

  // Handle file import from drop zone
  const handleImport = async (
    file: File,
    docType: TaxDocument['type'],
    entity: Entity,
    taxYear: number,
    parsedData?: TaxDocument['parsedData']
  ) => {
    const expenseCategory =
      docType === 'receipt' && parsedData
        ? (parsedData as { category?: string }).category
        : undefined;

    const success = await importFile(
      file,
      docType,
      entity,
      taxYear,
      expenseCategory as TaxDocument['parsedData'] extends { category: infer C } ? C : undefined
    );

    if (success) {
      // Rescan to pick up new file
      await handleRescan();
    }
  };

  // Get available tax years (from server or default to current year and last 5 years)
  const availableYears =
    entityYears.length > 0 ? entityYears : Array.from({ length: 6 }, (_, i) => currentYear - i);

  // Move document to different entity/year
  const handleMoveDocument = async (
    fromPath: string,
    toEntity: Entity,
    toYear: number
  ): Promise<boolean> => {
    const success = await moveFile(selectedEntity, fromPath, toEntity, toYear);
    if (success) {
      addToast(`Document moved to ${toEntity} / ${toYear}`, 'success');
      // Rescan to update the list
      await handleRescan();
    } else {
      addToast('Failed to move document', 'error');
    }
    return success;
  };

  // Use scanned documents
  const filteredDocuments = scannedDocuments;

  // Compute income summary from scanned documents
  const incomeSummary = useMemo((): IncomeSummaryType => {
    const w2Docs = scannedDocuments.filter((d) => d.type === 'w2');
    const income1099Docs = scannedDocuments.filter((d) => d.type.startsWith('1099'));

    let w2Total = 0;
    let federalWithheld = 0;
    let stateWithheld = 0;

    w2Docs.forEach((doc) => {
      const data = doc.parsedData as
        | { wages?: number; federalWithheld?: number; stateWithheld?: number }
        | undefined;
      if (data) {
        w2Total += data.wages || 0;
        federalWithheld += data.federalWithheld || 0;
        stateWithheld += data.stateWithheld || 0;
      }
    });

    let income1099Total = 0;
    income1099Docs.forEach((doc) => {
      const data = doc.parsedData as
        | { nonemployeeCompensation?: number; amount?: number; federalWithheld?: number }
        | undefined;
      if (data) {
        income1099Total += data.nonemployeeCompensation || data.amount || 0;
        federalWithheld += data.federalWithheld || 0;
      }
    });

    return {
      entity: selectedEntity,
      taxYear: selectedYear,
      w2Total,
      w2Count: w2Docs.length,
      income1099Total,
      income1099Count: income1099Docs.length,
      totalIncome: w2Total + income1099Total,
      federalWithheld,
      stateWithheld,
    };
  }, [scannedDocuments, selectedEntity, selectedYear]);

  // Compute expense summary from scanned documents
  const expenseSummary = useMemo((): ExpenseSummaryType => {
    const receiptDocs = scannedDocuments.filter((d) => d.type === 'receipt');
    const categoryTotals = new Map<ExpenseCategory, { total: number; count: number }>();

    receiptDocs.forEach((doc) => {
      const data = doc.parsedData as { category?: ExpenseCategory; amount?: number } | undefined;
      if (data && data.category && data.amount) {
        const existing = categoryTotals.get(data.category) || { total: 0, count: 0 };
        categoryTotals.set(data.category, {
          total: existing.total + data.amount,
          count: existing.count + 1,
        });
      }
    });

    const items = EXPENSE_CATEGORIES.map((cat) => {
      const totals = categoryTotals.get(cat.id) || { total: 0, count: 0 };
      return {
        category: cat.id,
        total: totals.total,
        deductibleAmount: totals.total * cat.deductionRate,
        count: totals.count,
      };
    }).filter((item) => item.total > 0);

    const totalExpenses = items.reduce((sum, item) => sum + item.total, 0);
    const totalDeductible = items.reduce((sum, item) => sum + item.deductibleAmount, 0);

    return {
      entity: selectedEntity,
      taxYear: selectedYear,
      items,
      totalExpenses,
      totalDeductible,
    };
  }, [scannedDocuments, selectedEntity, selectedYear]);

  const tabs: { id: TabType; label: string }[] = [
    { id: 'documents', label: 'Documents' },
    { id: 'income', label: 'Income' },
    { id: 'expenses', label: 'Expenses' },
  ];

  // Show server connection error if not connected
  if (!isConnected) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-xl border border-gray-200 p-8 max-w-md text-center">
          <div className="p-4 bg-red-100 rounded-full w-fit mx-auto mb-4">
            <Server className="w-8 h-8 text-red-600" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Server Not Connected</h1>
          <p className="text-gray-600 mb-6">
            The TaxVault API server is not running. Start it with:
            <code className="block mt-2 bg-gray-100 p-2 rounded text-sm font-mono">
              bun run server
            </code>
          </p>
          <button
            onClick={checkConnection}
            className="w-full bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 transition-colors"
          >
            Retry Connection
          </button>
          {fsError && (
            <p className="mt-4 text-sm text-red-600 flex items-center justify-center gap-2">
              <AlertCircle className="w-4 h-4" />
              {fsError}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-600 rounded-lg">
                <Vault className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">TaxVault</h1>
                <p className="text-xs text-gray-500">{dataDir}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {/* AI Toggle */}
              <button
                onClick={() => setUseAI(!useAI)}
                disabled={isProcessing}
                className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 ${
                  useAI
                    ? 'text-green-700 bg-green-50 hover:bg-green-100'
                    : 'text-gray-600 bg-gray-100 hover:bg-gray-200'
                }`}
                title={
                  useAI
                    ? 'Using Claude AI for parsing (more accurate)'
                    : 'Using regex parsing (faster, less accurate)'
                }
              >
                {useAI ? <Cpu className="w-4 h-4" /> : <Zap className="w-4 h-4" />}
                {useAI ? 'AI' : 'Fast'}
              </button>
              <button
                onClick={handleParseAll}
                disabled={isProcessing || scannedDocuments.length === 0 || selectedEntity === 'all'}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-purple-600 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors disabled:opacity-50"
                title={
                  selectedEntity === 'all'
                    ? 'Select a specific entity to parse all'
                    : `Parse all documents${useAI ? ' with Claude AI' : ''}`
                }
              >
                <Sparkles className={`w-4 h-4 ${isParsing ? 'animate-pulse' : ''}`} />
                {isParsing ? 'Parsing...' : 'Parse All'}
              </button>
              <button
                onClick={handleRescan}
                disabled={isProcessing}
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
                title="Rescan folder"
              >
                <RefreshCw className={`w-5 h-5 ${isScanning ? 'animate-spin' : ''}`} />
              </button>
              <TaxYearSelector
                selectedYear={selectedYear}
                availableYears={availableYears}
                onYearChange={setSelectedYear}
                disabled={isProcessing}
              />
              <button
                onClick={() => setShowSettings(true)}
                disabled={isProcessing}
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
                title="Settings"
              >
                <Settings className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Entity Switcher */}
        <div className="mb-6">
          <EntitySwitcher
            selectedEntity={selectedEntity}
            entities={entities}
            onEntityChange={setSelectedEntity}
            onAddEntity={addEntity}
            onRemoveEntity={removeEntity}
            disabled={isProcessing}
          />
        </div>

        {/* Quick Stats */}
        <div className="mb-6">
          <QuickStats
            incomeSummary={incomeSummary}
            expenseSummary={expenseSummary}
            documentCount={filteredDocuments.length}
          />
        </div>

        {/* Upload Zone - hidden when viewing all entities */}
        {selectedEntity !== 'all' && (
          <div className="mb-6">
            <UploadZone
              entity={selectedEntity}
              taxYear={selectedYear}
              onUpload={handleImport}
              disabled={isProcessing}
            />
          </div>
        )}

        {/* Tab Navigation */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="flex gap-6">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  pb-3 px-1 text-sm font-medium border-b-2 transition-colors
                  ${
                    activeTab === tab.id
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }
                `}
              >
                {tab.label}
                {tab.id === 'documents' && (
                  <span className="ml-2 text-xs text-gray-400">({filteredDocuments.length})</span>
                )}
              </button>
            ))}
          </nav>
        </div>

        {/* Scanning indicator */}
        {isScanning && (
          <div className="mb-4 flex items-center gap-2 text-sm text-gray-500">
            <RefreshCw className="w-4 h-4 animate-spin" />
            Scanning files...
          </div>
        )}

        {/* Tab Content */}
        {activeTab === 'documents' && (
          <DocumentList
            documents={filteredDocuments}
            onUpdate={updateDocument}
            onDelete={deleteDocument}
            onParse={(doc) => handleParseDocument(doc, useAI)}
            onMove={handleMoveDocument}
            entities={entities}
            availableYears={availableYears}
          />
        )}
        {activeTab === 'income' && (
          <IncomeSummary
            summary={incomeSummary}
            documents={filteredDocuments.filter(
              (d) => d.type === 'w2' || d.type.startsWith('1099')
            )}
          />
        )}
        {activeTab === 'expenses' && (
          <ExpenseSummary
            summary={expenseSummary}
            documents={filteredDocuments.filter((d) => d.type === 'receipt')}
          />
        )}
      </main>

      {/* Settings Modal */}
      <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
}
