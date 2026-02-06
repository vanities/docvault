import { useState, useEffect } from 'react';
import { Vault, FolderOpen, RefreshCw, AlertCircle } from 'lucide-react';
import { EntitySwitcher } from './EntitySwitcher';
import { TaxYearSelector } from './TaxYearSelector';
import { QuickStats } from './QuickStats';
import { UploadZone } from '../Documents/UploadZone';
import { DocumentList } from '../Documents/DocumentList';
import { IncomeSummary } from '../Summary/IncomeSummary';
import { ExpenseSummary } from '../Summary/ExpenseSummary';
import { useDocuments } from '../../hooks/useDocuments';
import { useFileSystem } from '../../hooks/useFileSystem';
import type { Entity, TaxDocument } from '../../types';

type TabType = 'documents' | 'income' | 'expenses';

export function Dashboard() {
  const currentYear = new Date().getFullYear();
  const [selectedEntity, setSelectedEntity] = useState<Entity>('personal');
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [activeTab, setActiveTab] = useState<TabType>('documents');
  const [scannedDocuments, setScannedDocuments] = useState<TaxDocument[]>([]);

  const { updateDocument, deleteDocument, getIncomeSummary, getExpenseSummary } = useDocuments();

  const {
    hasAccess,
    rootPath,
    isScanning,
    error: fsError,
    requestDirectoryAccess,
    scanTaxYear,
    importFile,
  } = useFileSystem();

  // Scan files when entity or year changes
  useEffect(() => {
    if (hasAccess) {
      scanTaxYear(selectedEntity, selectedYear).then(setScannedDocuments);
    }
  }, [hasAccess, selectedEntity, selectedYear, scanTaxYear]);

  // Rescan files
  const handleRescan = async () => {
    const docs = await scanTaxYear(selectedEntity, selectedYear);
    setScannedDocuments(docs);
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
      taxYear,
      expenseCategory as TaxDocument['parsedData'] extends { category: infer C } ? C : undefined
    );

    if (success) {
      // Rescan to pick up new file
      await handleRescan();
    }
  };

  // Get available tax years (current year and last 5 years)
  const availableYears = Array.from({ length: 6 }, (_, i) => currentYear - i);

  // Use scanned documents
  const filteredDocuments = scannedDocuments;
  const incomeSummary = getIncomeSummary(selectedEntity, selectedYear);
  const expenseSummary = getExpenseSummary(selectedEntity, selectedYear);

  const tabs: { id: TabType; label: string }[] = [
    { id: 'documents', label: 'Documents' },
    { id: 'income', label: 'Income' },
    { id: 'expenses', label: 'Expenses' },
  ];

  // Show folder access prompt if no access
  if (!hasAccess) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-xl border border-gray-200 p-8 max-w-md text-center">
          <div className="p-4 bg-blue-100 rounded-full w-fit mx-auto mb-4">
            <FolderOpen className="w-8 h-8 text-blue-600" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Welcome to TaxVault</h1>
          <p className="text-gray-600 mb-6">
            To get started, select your tax documents folder. This should be your main taxes
            directory (e.g., Dropbox/important/taxes).
          </p>
          <button
            onClick={requestDirectoryAccess}
            className="w-full bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 transition-colors"
          >
            Select Folder
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
                <p className="text-xs text-gray-500">{rootPath}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleRescan}
                disabled={isScanning}
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
                title="Rescan folder"
              >
                <RefreshCw className={`w-5 h-5 ${isScanning ? 'animate-spin' : ''}`} />
              </button>
              <TaxYearSelector
                selectedYear={selectedYear}
                availableYears={availableYears}
                onYearChange={setSelectedYear}
              />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Entity Switcher */}
        <div className="mb-6">
          <EntitySwitcher selectedEntity={selectedEntity} onEntityChange={setSelectedEntity} />
        </div>

        {/* Quick Stats */}
        <div className="mb-6">
          <QuickStats
            incomeSummary={incomeSummary}
            expenseSummary={expenseSummary}
            documentCount={filteredDocuments.length}
          />
        </div>

        {/* Upload Zone */}
        <div className="mb-6">
          <UploadZone entity={selectedEntity} taxYear={selectedYear} onUpload={handleImport} />
        </div>

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
    </div>
  );
}
