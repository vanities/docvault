import { useMemo, useState, useEffect } from 'react';
import { RefreshCw, Download, Briefcase } from 'lucide-react';
import { useAppContext, type TabType } from '../../contexts/AppContext';
import { useToast } from '../../hooks/useToast';
import { QuickStats } from '../Dashboard/QuickStats';
import { Solo401kCalculator } from '../Dashboard/Solo401kCalculator';
import { ReminderBanner } from '../Reminders/ReminderBanner';
import { TodoList } from '../Todos/TodoList';
import { EntityMetadataBanner } from '../EntityMetadata/EntityMetadataBanner';
import { UploadZone } from '../Documents/UploadZone';
import { DocumentList } from '../Documents/DocumentList';
import { IncomeSummary } from '../Summary/IncomeSummary';
import { ExpenseSummary } from '../Summary/ExpenseSummary';
import { InvoiceSummary } from '../Summary/InvoiceSummary';
import { StatementSummary } from '../Summary/StatementSummary';
import { useAnalytics } from '../../hooks/useAnalytics';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type {
  Entity,
  DocumentType,
  TaxDocument,
  IncomeSummary as IncomeSummaryType,
  ExpenseSummary as ExpenseSummaryType,
  InvoiceSummaryData,
  RetirementSummary,
  BankDepositSummary,
  Sale,
  MileageEntry,
} from '../../types';

/** Download dropdown for zip exports */
function DownloadDropdown({
  entity,
  year,
  onDownload,
}: {
  entity: string;
  year: number;
  onDownload: (
    entity: string,
    year: number,
    filter: 'income' | 'expenses' | 'invoices' | 'all'
  ) => Promise<void>;
}) {
  const options: { label: string; filter: 'all' | 'income' | 'expenses' | 'invoices' }[] = [
    { label: 'Download All', filter: 'all' },
    { label: 'Download Income', filter: 'income' },
    { label: 'Download Expenses', filter: 'expenses' },
    { label: 'Download Invoices', filter: 'invoices' },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-1.5 px-3 py-1.5 mb-1 text-[13px] font-medium text-surface-700 hover:text-surface-950 bg-surface-200/50 hover:bg-surface-200 border border-border rounded-lg transition-colors">
          <Download className="w-4 h-4" />
          <span className="hidden sm:inline">Download</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {options.map((opt) => (
          <DropdownMenuItem
            key={opt.filter}
            onClick={() => void onDownload(entity, year, opt.filter)}
          >
            <Download className="w-3.5 h-3.5" />
            {opt.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Extract vendor/customer from an invoice document */
function getInvoiceVendor(doc: TaxDocument): string {
  const data = doc.parsedData as Record<string, unknown> | undefined;
  if (data) {
    if (typeof data.billTo === 'string' && data.billTo) return data.billTo;
    if (typeof data.customerName === 'string' && data.customerName) return data.customerName;
    if (typeof data.vendor === 'string' && data.vendor) return data.vendor;
  }
  // Fall back to filename: {Source}_{Type}_{Date}.ext
  const base = doc.fileName.replace(/\.[^.]+$/, '');
  const parts = base.split('_');
  const typeKeywords = ['invoice', 'Invoice'];
  const typeIdx = parts.findIndex((p) =>
    typeKeywords.some((kw) => p.toLowerCase() === kw.toLowerCase())
  );
  if (typeIdx > 0) return parts.slice(0, typeIdx).join(' ');
  return parts[0] || 'Unknown';
}

export function TaxYearView() {
  const {
    selectedEntity,
    selectedYear,
    scannedDocuments,
    setScannedDocuments,
    activeTab,
    setActiveTab,
    entities,
    availableYears,
    isScanning,
    isProcessing,
    scanTaxYear,
    importFile,
    deleteFile,
    parseFile,
    moveFile,
    relocateFile,
    updateDocMetadata,
    downloadZip,
    downloadCpaPackage,
    setActiveView,
  } = useAppContext();

  const { addToast } = useToast();

  // Sales and mileage data for integration into tax year summaries
  const [salesData, setSalesData] = useState<Sale[]>([]);
  const [mileageData, setMileageData] = useState<{ entries: MileageEntry[]; irsRate: number }>({
    entries: [],
    irsRate: 0.7,
  });

  useEffect(() => {
    fetch('/api/sales')
      .then((r) => r.json())
      .then((data: { sales?: Sale[] }) => setSalesData(data.sales || []))
      .catch(() => setSalesData([]));
  }, []);

  useEffect(() => {
    fetch('/api/mileage')
      .then((r) => r.json())
      .then((data: { entries?: MileageEntry[]; irsRate?: number }) =>
        setMileageData({ entries: data.entries || [], irsRate: data.irsRate || 0.7 })
      )
      .catch(() => setMileageData({ entries: [], irsRate: 0.7 }));
  }, []);

  // Update document in the scanned documents list and persist metadata
  const handleUpdateDoc = (id: string, updates: Partial<TaxDocument>) => {
    setScannedDocuments((prev) =>
      prev.map((doc) => (doc.id === id ? { ...doc, ...updates } : doc))
    );
    // Persist tags, notes, and tracked to server
    if ('tags' in updates || 'notes' in updates || 'tracked' in updates) {
      const doc = scannedDocuments.find((d) => d.id === id);
      if (doc?.filePath) {
        const merged = { ...doc, ...updates };
        void updateDocMetadata(doc.entity, doc.filePath, {
          tags: merged.tags,
          notes: merged.notes || '',
          ...('tracked' in updates ? { tracked: updates.tracked } : {}),
        });
      }
    }
  };

  // Delete a document via server API
  const handleDeleteDoc = async (id: string) => {
    const doc = scannedDocuments.find((d) => d.id === id);
    if (!doc?.filePath) return;

    const success = await deleteFile(doc.entity, doc.filePath);
    if (success) {
      setScannedDocuments((prev) => prev.filter((d) => d.id !== id));
      addToast('Document deleted', 'success');
    } else {
      addToast('Failed to delete document', 'error');
    }
  };

  // Parse a single document with Claude Vision AI
  const handleParseDocument = async (doc: TaxDocument): Promise<TaxDocument | null> => {
    if (!doc.filePath) {
      addToast('No file path for document', 'error');
      return null;
    }

    // Use the document's entity, not selectedEntity (which could be "all")
    const parsedData = await parseFile(doc.entity, doc.filePath);

    if (parsedData) {
      addToast('Document parsed successfully', 'success');
      // Update the document in our local state
      const updatedDoc = { ...doc, parsedData: parsedData as unknown as TaxDocument['parsedData'] };
      setScannedDocuments((prev) => prev.map((d) => (d.id === doc.id ? updatedDoc : d)));
      // Refresh backend analytics to pick up new parsed data
      analytics.refresh();
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
    parsedData?: TaxDocument['parsedData'],
    customFilename?: string
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
      expenseCategory as ExpenseCategory | undefined,
      customFilename,
      parsedData as Record<string, unknown> | undefined
    );

    if (success) {
      // Rescan to pick up new file
      const docs = await scanTaxYear(selectedEntity, selectedYear);
      setScannedDocuments(docs);
      // Refresh backend analytics
      analytics.refresh();
    }
  };

  // Move document to different entity/year
  const handleMoveDocument = async (
    fromEntity: Entity,
    fromPath: string,
    toEntity: Entity,
    toYear: number
  ): Promise<boolean> => {
    const success = await moveFile(fromEntity, fromPath, toEntity, toYear);
    if (success) {
      addToast(`Document moved to ${toEntity} / ${toYear}`, 'success');
      // Rescan to update the list
      const docs = await scanTaxYear(selectedEntity, selectedYear);
      setScannedDocuments(docs);
    } else {
      addToast('Failed to move document', 'error');
    }
    return success;
  };

  // Relocate document (type/entity/year change from inline edit)
  const handleRelocateDocument = async (
    fromEntity: Entity,
    fromPath: string,
    toEntity: Entity,
    toYear: number,
    newDocType: DocumentType
  ): Promise<boolean> => {
    const success = await relocateFile(fromEntity, fromPath, toEntity, toYear, newDocType);
    if (success) {
      addToast('Document moved', 'success');
      const docs = await scanTaxYear(selectedEntity, selectedYear);
      setScannedDocuments(docs);
    } else {
      addToast('Failed to move document', 'error');
    }
    return success;
  };

  // Use scanned documents
  const filteredDocuments = scannedDocuments;

  // Filter to tracked documents for summary computations
  const trackedDocuments = useMemo(
    () => scannedDocuments.filter((d) => d.tracked !== false),
    [scannedDocuments]
  );

  // Filter sales by year and entity
  const yearSales = useMemo(() => {
    const byYear = salesData.filter((s) => s.date.startsWith(String(selectedYear)));
    if (selectedEntity === 'all') return byYear;
    return byYear.filter((s) => s.entity === selectedEntity);
  }, [salesData, selectedYear, selectedEntity]);

  // Filter mileage by year and entity
  const yearMileage = useMemo(() => {
    return mileageData.entries.filter((e) => {
      if (!e.date.startsWith(String(selectedYear))) return false;
      if (selectedEntity === 'all') return true;
      return e.entity === selectedEntity;
    });
  }, [mileageData.entries, selectedYear, selectedEntity]);

  // --- Backend-driven analytics ---
  const analytics = useAnalytics(selectedEntity, selectedYear);

  // Merge backend analytics with local sales data
  const incomeSummary = useMemo((): IncomeSummaryType => {
    const salesTotal = yearSales.reduce((sum, s) => sum + s.total, 0);
    return {
      ...analytics.incomeSummary,
      salesTotal,
      salesCount: yearSales.length,
      totalIncome: analytics.incomeSummary.totalIncome + salesTotal,
    };
  }, [analytics.incomeSummary, yearSales]);

  const expenseSummary = useMemo((): ExpenseSummaryType => {
    // Merge in mileage data (not yet in backend analytics)
    const mileageTotal = yearMileage.reduce((sum, e) => sum + (e.tripMiles || 0), 0);
    const mileageDeduction = yearMileage.reduce(
      (sum, e) => sum + (e.tripMiles || 0) * mileageData.irsRate,
      0
    );
    return {
      ...analytics.expenseSummary,
      mileageTotal,
      mileageDeduction,
      mileageCount: yearMileage.length,
      totalDeductible: analytics.expenseSummary.totalDeductible + mileageDeduction,
    };
  }, [analytics.expenseSummary, yearMileage, mileageData.irsRate]);

  const bankDepositSummary = analytics.bankDepositSummary;
  const invoiceSummary = analytics.invoiceSummary;
  const retirementSummary = analytics.retirementSummary;

  // --- "All" variants for hidden/untracked docs (fetched with includeHidden) ---
  const allAnalytics = useAnalytics(
    selectedEntity,
    selectedYear,
  );

  const hasHiddenDocs = scannedDocuments.some((d) => d.tracked === false);

  const allIncomeSummary = useMemo((): IncomeSummaryType | undefined => {
    if (!hasHiddenDocs) return undefined;
    // For "all with hidden", just return the same analytics since backend metadata
    // filtering handles tracked status. TODO: add ?includeHidden=true support
    return undefined;
  }, [hasHiddenDocs]);

  const allExpenseSummary = useMemo((): ExpenseSummaryType | undefined => {
    if (!hasHiddenDocs) return undefined;
    return undefined;
  }, [hasHiddenDocs]);

  const allInvoiceSummary = useMemo((): InvoiceSummaryData | undefined => {
    if (!hasHiddenDocs) return undefined;
    return undefined;
  }, [hasHiddenDocs]);

  const allRetirementSummary = useMemo((): RetirementSummary | null => {
    if (!hasHiddenDocs) return null;
    return null;
  }, [hasHiddenDocs]);

  const allBankDepositSummary = useMemo((): BankDepositSummary | null => {
    if (!hasHiddenDocs) return null;
    return null;
  }, [hasHiddenDocs]);

  const tabs: { id: TabType; label: string }[] = [
    { id: 'documents', label: 'Documents' },
    { id: 'income', label: 'Income' },
    { id: 'expenses', label: 'Expenses' },
    { id: 'invoices', label: 'Invoices' },
    { id: 'statements', label: 'Statements' },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-6">
      {/* Reminders */}
      <ReminderBanner />

      {/* Entity Metadata */}
      <EntityMetadataBanner entityConfig={entities.find((e) => e.id === selectedEntity)} />

      {/* Todos */}
      <TodoList />

      {/* Quick Stats */}
      <div className="mb-6">
        <QuickStats
          incomeSummary={incomeSummary}
          expenseSummary={expenseSummary}
          invoiceSummary={invoiceSummary}
          documentCount={filteredDocuments.length}
          allIncomeSummary={allIncomeSummary}
          allExpenseSummary={allExpenseSummary}
          allInvoiceSummary={allInvoiceSummary}
          allDocumentCount={hasHiddenDocs ? scannedDocuments.length : undefined}
          retirementSummary={retirementSummary}
          allRetirementSummary={allRetirementSummary}
          bankDepositSummary={bankDepositSummary}
          allBankDepositSummary={allBankDepositSummary}
        />
      </div>

      {/* Solo 401(k) Calculator — only for LLC/self-employment entities (not personal W-2) */}
      {selectedEntity !== 'all' &&
        selectedEntity !== 'personal' &&
        entities.find((e) => e.id === selectedEntity)?.type === 'tax' &&
        (invoiceSummary.invoiceTotal > 0 || (bankDepositSummary?.totalDeposits ?? 0) > 0) && (
          <div className="mb-6">
            <Solo401kCalculator
              defaultGross={
                bankDepositSummary && bankDepositSummary.totalDeposits > 0
                  ? bankDepositSummary.totalDeposits
                  : invoiceSummary.invoiceTotal
              }
              defaultExpenses={expenseSummary.totalDeductible}
              taxYear={selectedYear}
              entity={selectedEntity}
            />
          </div>
        )}

      {/* Upload Zone - hidden when viewing all entities */}
      {selectedEntity !== 'all' && (
        <div className="mb-6">
          <UploadZone
            entity={selectedEntity}
            taxYear={selectedYear}
            availableYears={availableYears}
            onUpload={handleImport}
            disabled={isProcessing}
          />
        </div>
      )}

      {/* Tab Navigation */}
      <div className="border-b border-border mb-6">
        <div className="flex items-center justify-between">
          <nav className="flex gap-4 md:gap-6">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  pb-3 pt-1 md:pt-0 px-1 text-[13px] font-medium border-b-2 transition-all duration-200
                  ${
                    activeTab === tab.id
                      ? 'border-accent-400 text-accent-400'
                      : 'border-transparent text-surface-700 hover:text-surface-900 hover:border-surface-500'
                  }
                `}
              >
                {tab.label}
                {tab.id === 'documents' && (
                  <span className="ml-2 text-[11px] text-surface-600">
                    ({filteredDocuments.length})
                  </span>
                )}
              </button>
            ))}
          </nav>

          {/* CPA Package + Download Dropdown */}
          {selectedEntity !== 'all' && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => downloadCpaPackage(selectedEntity, selectedYear)}
                className="flex items-center gap-1.5 px-3 py-1.5 mb-1 text-[13px] font-medium text-white bg-accent-500 hover:bg-accent-600 border border-accent-600 rounded-lg transition-colors"
              >
                <Briefcase className="w-4 h-4" />
                <span className="hidden sm:inline">CPA Package</span>
              </button>
              <DownloadDropdown
                entity={selectedEntity}
                year={selectedYear}
                onDownload={downloadZip}
              />
            </div>
          )}
        </div>
      </div>

      {/* Scanning indicator */}
      {isScanning && (
        <div className="mb-4 flex items-center gap-2 text-sm text-surface-700">
          <RefreshCw className="w-4 h-4 animate-spin text-accent-400" />
          Scanning files...
        </div>
      )}

      {/* Tab Content */}
      {activeTab === 'documents' && (
        <DocumentList
          documents={filteredDocuments}
          onUpdate={handleUpdateDoc}
          onDelete={handleDeleteDoc}
          onParse={handleParseDocument}
          onMove={handleMoveDocument}
          onRelocate={handleRelocateDocument}
          entities={entities}
          availableYears={availableYears}
        />
      )}
      {activeTab === 'income' && (
        <IncomeSummary
          summary={incomeSummary}
          documents={trackedDocuments.filter((d) => d.type === 'w2' || d.type.startsWith('1099'))}
          onDownload={
            selectedEntity !== 'all'
              ? () => downloadZip(selectedEntity, selectedYear, 'income')
              : undefined
          }
          onNavigateToSales={() => setActiveView('sales')}
        />
      )}
      {activeTab === 'expenses' && (
        <ExpenseSummary
          summary={expenseSummary}
          documents={trackedDocuments.filter(
            (d) => d.type === 'receipt' || d.filePath?.toLowerCase().includes('/expenses/')
          )}
          onDownload={
            selectedEntity !== 'all'
              ? () => downloadZip(selectedEntity, selectedYear, 'expenses')
              : undefined
          }
          onNavigateToMileage={() => setActiveView('mileage')}
        />
      )}
      {activeTab === 'invoices' && (
        <InvoiceSummary
          summary={invoiceSummary}
          documents={trackedDocuments.filter((d) => d.type === 'invoice')}
          onDownload={
            selectedEntity !== 'all'
              ? () => downloadZip(selectedEntity, selectedYear, 'invoices')
              : undefined
          }
        />
      )}
      {activeTab === 'statements' && (
        <StatementSummary
          bankDocs={trackedDocuments.filter((d) => d.type === 'bank-statement')}
          ccDocs={trackedDocuments.filter((d) => d.type === 'credit-card-statement')}
          incomeDocs={trackedDocuments.filter((d) => d.type === 'w2' || d.type.startsWith('1099'))}
          incomeSummary={incomeSummary}
        />
      )}
    </div>
  );
}
