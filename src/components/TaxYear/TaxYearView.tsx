import { useMemo } from 'react';
import { RefreshCw } from 'lucide-react';
import { useAppContext, type TabType } from '../../contexts/AppContext';
import { useToast } from '../../hooks/useToast';
import { useDocuments } from '../../hooks/useDocuments';
import { QuickStats } from '../Dashboard/QuickStats';
import { ReminderBanner } from '../Reminders/ReminderBanner';
import { TodoList } from '../Todos/TodoList';
import { UploadZone } from '../Documents/UploadZone';
import { DocumentList } from '../Documents/DocumentList';
import { IncomeSummary } from '../Summary/IncomeSummary';
import { ExpenseSummary } from '../Summary/ExpenseSummary';
import { EXPENSE_CATEGORIES } from '../../config';
import type {
  Entity,
  TaxDocument,
  IncomeSummary as IncomeSummaryType,
  ExpenseSummary as ExpenseSummaryType,
  ExpenseCategory,
} from '../../types';

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
  } = useAppContext();

  const { addToast } = useToast();
  const { updateDocument } = useDocuments();

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
    // Include receipts and any doc in an expenses folder
    const expenseDocs = scannedDocuments.filter(
      (d) => d.type === 'receipt' || d.filePath.toLowerCase().includes('/expenses/')
    );
    const categoryTotals = new Map<ExpenseCategory, { total: number; count: number }>();

    expenseDocs.forEach((doc) => {
      const data = doc.parsedData as Record<string, unknown> | undefined;
      if (!data) return;

      // Extract category — from parsed data or from file path
      let category = data.category as ExpenseCategory | undefined;
      if (!category && doc.filePath) {
        const pathLower = doc.filePath.toLowerCase();
        if (pathLower.includes('/equipment/')) category = 'equipment';
        else if (pathLower.includes('/software/')) category = 'software';
        else if (pathLower.includes('/meals/')) category = 'meals';
        else if (pathLower.includes('/childcare/')) category = 'childcare';
        else if (pathLower.includes('/medical/')) category = 'medical';
        else if (pathLower.includes('/travel/')) category = 'travel';
        else if (pathLower.includes('/office/')) category = 'office';
      }
      if (!category) return;

      // Extract amount — check multiple fields including nested
      let amount = 0;
      if (typeof data.amount === 'number') amount = data.amount;
      else if (typeof data.totalAmount === 'number') amount = data.totalAmount;
      else if (typeof data.total === 'number') amount = data.total;
      else {
        const financing = data.financing as Record<string, unknown> | undefined;
        if (financing) {
          if (typeof financing.cashPrice === 'number') amount = financing.cashPrice;
          else if (typeof financing.totalSalePrice === 'number') amount = financing.totalSalePrice;
        }
      }
      if (!amount) return;

      const existing = categoryTotals.get(category) || { total: 0, count: 0 };
      categoryTotals.set(category, {
        total: existing.total + amount,
        count: existing.count + 1,
      });
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

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-6">
      {/* Reminders */}
      <ReminderBanner />

      {/* Todos */}
      <TodoList />

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
      <div className="border-b border-border mb-6">
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
          onUpdate={updateDocument}
          onDelete={handleDeleteDoc}
          onParse={handleParseDocument}
          onMove={handleMoveDocument}
          entities={entities}
          availableYears={availableYears}
        />
      )}
      {activeTab === 'income' && (
        <IncomeSummary
          summary={incomeSummary}
          documents={filteredDocuments.filter((d) => d.type === 'w2' || d.type.startsWith('1099'))}
        />
      )}
      {activeTab === 'expenses' && (
        <ExpenseSummary
          summary={expenseSummary}
          documents={filteredDocuments.filter(
            (d) => d.type === 'receipt' || d.filePath.toLowerCase().includes('/expenses/')
          )}
        />
      )}
    </div>
  );
}
