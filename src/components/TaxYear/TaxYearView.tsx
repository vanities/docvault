import { useMemo, useState, useRef, useEffect } from 'react';
import { RefreshCw, Download, ChevronDown, Briefcase } from 'lucide-react';
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
import { EXPENSE_CATEGORIES } from '../../config';
import { useAnalytics } from '../../hooks/useAnalytics';
import type {
  Entity,
  DocumentType,
  TaxDocument,
  IncomeSummary as IncomeSummaryType,
  ExpenseSummary as ExpenseSummaryType,
  InvoiceSummaryData,
  RetirementSummary,
  BankDepositSummary,
  ExpenseCategory,
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
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const options: { label: string; filter: 'all' | 'income' | 'expenses' | 'invoices' }[] = [
    { label: 'Download All', filter: 'all' },
    { label: 'Download Income', filter: 'income' },
    { label: 'Download Expenses', filter: 'expenses' },
    { label: 'Download Invoices', filter: 'invoices' },
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-1.5 mb-1 text-[13px] font-medium text-surface-700 hover:text-surface-950 bg-surface-200/50 hover:bg-surface-200 border border-border rounded-lg transition-colors"
      >
        <Download className="w-4 h-4" />
        <span className="hidden sm:inline">Download</span>
        <ChevronDown className="w-3.5 h-3.5" />
      </button>

      {open && (
        <div className="absolute right-0 mt-1 glass-strong rounded-lg shadow-2xl z-20 py-1 min-w-[180px] animate-scale-in">
          {options.map((opt) => (
            <button
              key={opt.filter}
              onClick={() => {
                void onDownload(entity, year, opt.filter);
                setOpen(false);
              }}
              className="w-full px-3 py-2 text-left text-[13px] text-surface-800 hover:bg-surface-300/30 flex items-center gap-2"
            >
              <Download className="w-3.5 h-3.5" />
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
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

  // --- Remaining local computations (invoice, retirement, hidden docs) ---

  // Compute income summary from tracked documents (LEGACY — kept only for "all" variants)
  const _legacyIncomeSummary = useMemo((): IncomeSummaryType => {
    const w2Docs = trackedDocuments.filter((d) => d.type === 'w2');
    const income1099Docs = trackedDocuments.filter((d) => d.type.startsWith('1099'));

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
    let capitalGainsTotal = 0;
    let capitalGainsShortTerm = 0;
    let capitalGainsLongTerm = 0;

    income1099Docs.forEach((doc) => {
      const data = doc.parsedData as Record<string, unknown> | undefined;
      if (!data) return;

      if (doc.type === '1099-composite') {
        // Composite: dividend + interest + misc income (NOT capital gains)
        const div = data.div as Record<string, number> | undefined;
        const int = data.int as Record<string, number> | undefined;
        const b = data.b as Record<string, number> | undefined;
        const misc = data.misc as Record<string, number> | undefined;
        income1099Total += Number(div?.ordinaryDividends || data.totalDividendIncome || 0);
        income1099Total += Number(int?.interestIncome || data.totalInterestIncome || 0);
        income1099Total +=
          Number(misc?.rents || 0) + Number(misc?.royalties || 0) + Number(misc?.otherIncome || 0);
        federalWithheld += Number(data.totalFederalWithheld || 0);
        // Capital gains tracked separately
        if (b) {
          const st = Number(b.shortTermGainLoss || 0);
          const lt = Number(b.longTermGainLoss || 0);
          capitalGainsShortTerm += st;
          capitalGainsLongTerm += lt;
          capitalGainsTotal += Number(b.totalGainLoss || data.totalCapitalGains || st + lt);
        }
      } else if (doc.type === '1099-b') {
        // Standalone 1099-B: capital gains only, NOT income
        const st = Number(data.shortTermGainLoss || 0);
        const lt = Number(data.longTermGainLoss || 0);
        capitalGainsShortTerm += st;
        capitalGainsLongTerm += lt;
        capitalGainsTotal += Number(data.totalGainLoss || st + lt);
        federalWithheld += Number(data.federalWithheld || 0);
      } else {
        // Regular 1099s (NEC, MISC, DIV, INT, R)
        income1099Total += Number(
          (data as { nonemployeeCompensation?: number }).nonemployeeCompensation ||
            (data as { ordinaryDividends?: number }).ordinaryDividends ||
            (data as { interestIncome?: number }).interestIncome ||
            (data as { amount?: number }).amount ||
            0
        );
        federalWithheld += Number(data.federalWithheld || 0);
      }
    });

    const salesTotal = yearSales.reduce((sum, s) => sum + s.total, 0);

    return {
      entity: selectedEntity,
      taxYear: selectedYear,
      w2Total,
      w2Count: w2Docs.length,
      income1099Total,
      income1099Count: income1099Docs.length,
      k1Total: 0,
      k1Count: 0,
      salesTotal,
      salesCount: yearSales.length,
      totalIncome: w2Total + income1099Total + salesTotal,
      federalWithheld,
      stateWithheld,
      capitalGainsTotal,
      capitalGainsShortTerm,
      capitalGainsLongTerm,
    };
  }, [trackedDocuments, selectedEntity, selectedYear, yearSales]);

  // Compute expense summary from tracked documents (LEGACY — kept only for "all" variants)
  const _legacyExpenseSummary = useMemo((): ExpenseSummaryType => {
    // Include receipts and any doc in an expenses folder
    const expenseDocs = trackedDocuments.filter(
      (d) => d.type === 'receipt' || (d.filePath ?? '').toLowerCase().includes('/expenses/')
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
        else if (pathLower.includes('/office/')) category = 'office-supplies';
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

    const mileageTotal = yearMileage.reduce((sum, e) => sum + (e.tripMiles || 0), 0);
    const mileageDeduction = yearMileage.reduce(
      (sum, e) => sum + (e.tripMiles || 0) * mileageData.irsRate,
      0
    );

    return {
      entity: selectedEntity,
      taxYear: selectedYear,
      items,
      totalExpenses,
      totalDeductible: totalDeductible + mileageDeduction,
      mileageTotal,
      mileageDeduction,
      mileageCount: yearMileage.length,
    };
  }, [trackedDocuments, selectedEntity, selectedYear, yearMileage, mileageData.irsRate]);

  // Compute invoice summary from tracked documents
  const invoiceSummary = useMemo((): InvoiceSummaryData => {
    const invoiceDocs = trackedDocuments.filter((d) => d.type === 'invoice');

    // Group by customer/vendor
    const customerMap = new Map<string, { total: number; count: number }>();
    for (const doc of invoiceDocs) {
      const data = doc.parsedData as Record<string, unknown> | undefined;
      const customer = getInvoiceVendor(doc);
      const amount = data
        ? typeof data.totalAmount === 'number'
          ? data.totalAmount
          : typeof data.amount === 'number'
            ? data.amount
            : typeof data.total === 'number'
              ? data.total
              : typeof data.subtotal === 'number'
                ? data.subtotal
                : 0
        : 0;

      const existing = customerMap.get(customer) || { total: 0, count: 0 };
      customerMap.set(customer, {
        total: existing.total + amount,
        count: existing.count + 1,
      });
    }

    const byCustomer = Array.from(customerMap.entries())
      .map(([customer, { total, count }]) => ({ customer, total, count }))
      .sort((a, b) => b.total - a.total);

    return {
      entity: selectedEntity,
      taxYear: selectedYear,
      invoiceTotal: byCustomer.reduce((sum, g) => sum + g.total, 0),
      invoiceCount: invoiceDocs.length,
      byCustomer,
    };
  }, [trackedDocuments, selectedEntity, selectedYear]);

  // --- "All docs" summaries (including hidden/untracked) for QuickStats alt values ---

  const hasHiddenDocs = scannedDocuments.length !== trackedDocuments.length;

  const allIncomeSummary = useMemo((): IncomeSummaryType | undefined => {
    if (!hasHiddenDocs) return undefined;
    const w2Docs = scannedDocuments.filter((d) => d.type === 'w2');
    const income1099Docs = scannedDocuments.filter((d) => d.type.startsWith('1099'));
    let w2Total = 0,
      federalWithheld = 0,
      stateWithheld = 0;
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
    let capitalGainsTotal = 0;
    let capitalGainsShortTerm = 0;
    let capitalGainsLongTerm = 0;

    income1099Docs.forEach((doc) => {
      const data = doc.parsedData as Record<string, unknown> | undefined;
      if (!data) return;

      if (doc.type === '1099-composite') {
        const div = data.div as Record<string, number> | undefined;
        const int = data.int as Record<string, number> | undefined;
        const b = data.b as Record<string, number> | undefined;
        const misc = data.misc as Record<string, number> | undefined;
        income1099Total += Number(div?.ordinaryDividends || data.totalDividendIncome || 0);
        income1099Total += Number(int?.interestIncome || data.totalInterestIncome || 0);
        income1099Total +=
          Number(misc?.rents || 0) + Number(misc?.royalties || 0) + Number(misc?.otherIncome || 0);
        federalWithheld += Number(data.totalFederalWithheld || 0);
        if (b) {
          const st = Number(b.shortTermGainLoss || 0);
          const lt = Number(b.longTermGainLoss || 0);
          capitalGainsShortTerm += st;
          capitalGainsLongTerm += lt;
          capitalGainsTotal += Number(b.totalGainLoss || data.totalCapitalGains || st + lt);
        }
      } else if (doc.type === '1099-b') {
        const st = Number(data.shortTermGainLoss || 0);
        const lt = Number(data.longTermGainLoss || 0);
        capitalGainsShortTerm += st;
        capitalGainsLongTerm += lt;
        capitalGainsTotal += Number(data.totalGainLoss || st + lt);
        federalWithheld += Number(data.federalWithheld || 0);
      } else {
        income1099Total += Number(
          (data as { nonemployeeCompensation?: number }).nonemployeeCompensation ||
            (data as { ordinaryDividends?: number }).ordinaryDividends ||
            (data as { interestIncome?: number }).interestIncome ||
            (data as { amount?: number }).amount ||
            0
        );
        federalWithheld += Number(data.federalWithheld || 0);
      }
    });

    const allSalesTotal = yearSales.reduce((sum, s) => sum + s.total, 0);

    return {
      entity: selectedEntity,
      taxYear: selectedYear,
      w2Total,
      w2Count: w2Docs.length,
      income1099Total,
      income1099Count: income1099Docs.length,
      k1Total: 0,
      k1Count: 0,
      salesTotal: allSalesTotal,
      salesCount: yearSales.length,
      totalIncome: w2Total + income1099Total + allSalesTotal,
      federalWithheld,
      stateWithheld,
      capitalGainsTotal,
      capitalGainsShortTerm,
      capitalGainsLongTerm,
    };
  }, [scannedDocuments, hasHiddenDocs, selectedEntity, selectedYear, yearSales]);

  const allExpenseSummary = useMemo((): ExpenseSummaryType | undefined => {
    if (!hasHiddenDocs) return undefined;
    const expenseDocs = scannedDocuments.filter(
      (d) => d.type === 'receipt' || (d.filePath ?? '').toLowerCase().includes('/expenses/')
    );
    const categoryTotals = new Map<ExpenseCategory, { total: number; count: number }>();
    expenseDocs.forEach((doc) => {
      const data = doc.parsedData as Record<string, unknown> | undefined;
      if (!data) return;
      let category = data.category as ExpenseCategory | undefined;
      if (!category && doc.filePath) {
        const pathLower = doc.filePath.toLowerCase();
        if (pathLower.includes('/equipment/')) category = 'equipment';
        else if (pathLower.includes('/software/')) category = 'software';
        else if (pathLower.includes('/meals/')) category = 'meals';
        else if (pathLower.includes('/childcare/')) category = 'childcare';
        else if (pathLower.includes('/medical/')) category = 'medical';
        else if (pathLower.includes('/travel/')) category = 'travel';
        else if (pathLower.includes('/office/')) category = 'office-supplies';
      }
      if (!category) return;
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
      categoryTotals.set(category, { total: existing.total + amount, count: existing.count + 1 });
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
    const allMileageTotal = yearMileage.reduce((sum, e) => sum + (e.tripMiles || 0), 0);
    const allMileageDeduction = yearMileage.reduce(
      (sum, e) => sum + (e.tripMiles || 0) * mileageData.irsRate,
      0
    );
    return {
      entity: selectedEntity,
      taxYear: selectedYear,
      items,
      totalExpenses: items.reduce((sum, item) => sum + item.total, 0),
      totalDeductible:
        items.reduce((sum, item) => sum + item.deductibleAmount, 0) + allMileageDeduction,
      mileageTotal: allMileageTotal,
      mileageDeduction: allMileageDeduction,
      mileageCount: yearMileage.length,
    };
  }, [
    scannedDocuments,
    hasHiddenDocs,
    selectedEntity,
    selectedYear,
    yearMileage,
    mileageData.irsRate,
  ]);

  const allInvoiceSummary = useMemo((): InvoiceSummaryData | undefined => {
    if (!hasHiddenDocs) return undefined;
    const invoiceDocs = scannedDocuments.filter((d) => d.type === 'invoice');
    const customerMap = new Map<string, { total: number; count: number }>();
    for (const doc of invoiceDocs) {
      const data = doc.parsedData as Record<string, unknown> | undefined;
      const customer = getInvoiceVendor(doc);
      const amount = data
        ? typeof data.totalAmount === 'number'
          ? data.totalAmount
          : typeof data.amount === 'number'
            ? data.amount
            : typeof data.total === 'number'
              ? data.total
              : typeof data.subtotal === 'number'
                ? data.subtotal
                : 0
        : 0;
      const existing = customerMap.get(customer) || { total: 0, count: 0 };
      customerMap.set(customer, { total: existing.total + amount, count: existing.count + 1 });
    }
    const byCustomer = Array.from(customerMap.entries())
      .map(([customer, { total, count }]) => ({ customer, total, count }))
      .sort((a, b) => b.total - a.total);
    return {
      entity: selectedEntity,
      taxYear: selectedYear,
      invoiceTotal: byCustomer.reduce((sum, g) => sum + g.total, 0),
      invoiceCount: invoiceDocs.length,
      byCustomer,
    };
  }, [scannedDocuments, hasHiddenDocs, selectedEntity, selectedYear]);

  // Compute retirement summary from tracked documents
  const retirementSummary = useMemo((): RetirementSummary | null => {
    const retirementDocs = trackedDocuments.filter(
      (d) => d.type === 'retirement-statement' || d.filePath?.toLowerCase().includes('/retirement/')
    );
    if (retirementDocs.length === 0) return null;

    let totalEmployer = 0;
    let totalEmployee = 0;
    let totalContributions = 0;
    const accountMap = new Map<
      string,
      { institution: string; accountType: string; total: number }
    >();

    for (const doc of retirementDocs) {
      const data = doc.parsedData as Record<string, unknown> | undefined;
      const employer = Number(data?.employerContributions || 0);
      const employee = Number(data?.employeeContributions || 0);
      const total = Number(data?.totalContributions || employer + employee);
      totalEmployer += employer;
      totalEmployee += employee;
      totalContributions += total;

      const institution = (data?.institution || doc.fileName.split('_')[0] || 'Unknown') as string;
      const accountType = (data?.accountType || 'Retirement') as string;
      const key = `${institution}|${accountType}`;
      const existing = accountMap.get(key);
      if (existing) {
        existing.total += total;
      } else {
        accountMap.set(key, { institution, accountType, total });
      }
    }

    return {
      totalContributions,
      employerContributions: totalEmployer,
      employeeContributions: totalEmployee,
      statementCount: retirementDocs.length,
      byAccount: Array.from(accountMap.values()),
    };
  }, [trackedDocuments]);

  const allRetirementSummary = useMemo((): RetirementSummary | null => {
    if (!hasHiddenDocs) return null;
    const retirementDocs = scannedDocuments.filter(
      (d) => d.type === 'retirement-statement' || d.filePath?.toLowerCase().includes('/retirement/')
    );
    if (retirementDocs.length === 0) return null;

    let totalEmployer = 0;
    let totalEmployee = 0;
    let totalContributions = 0;
    const accountMap = new Map<
      string,
      { institution: string; accountType: string; total: number }
    >();

    for (const doc of retirementDocs) {
      const data = doc.parsedData as Record<string, unknown> | undefined;
      const employer = Number(data?.employerContributions || 0);
      const employee = Number(data?.employeeContributions || 0);
      const total = Number(data?.totalContributions || employer + employee);
      totalEmployer += employer;
      totalEmployee += employee;
      totalContributions += total;

      const institution = (data?.institution || doc.fileName.split('_')[0] || 'Unknown') as string;
      const accountType = (data?.accountType || 'Retirement') as string;
      const key = `${institution}|${accountType}`;
      const existing = accountMap.get(key);
      if (existing) {
        existing.total += total;
      } else {
        accountMap.set(key, { institution, accountType, total });
      }
    }

    return {
      totalContributions,
      employerContributions: totalEmployer,
      employeeContributions: totalEmployee,
      statementCount: retirementDocs.length,
      byAccount: Array.from(accountMap.values()),
    };
  }, [scannedDocuments, hasHiddenDocs]);

  // Helper: extract deposit total from parsed data (AI parser uses inconsistent field names)
  const getDepositTotal = (data: Record<string, unknown> | undefined): number => {
    if (!data) return 0;
    if (typeof data.totalDeposits === 'number') return data.totalDeposits;
    if (typeof data.totalDepositsAndAdditions === 'number') return data.totalDepositsAndAdditions;
    if (Array.isArray(data.deposits))
      return (data.deposits as { amount: number }[]).reduce((s, d) => s + (d.amount || 0), 0);
    if (Array.isArray(data.depositsAndAdditions))
      return (data.depositsAndAdditions as { amount: number }[]).reduce(
        (s, d) => s + (d.amount || 0),
        0
      );
    if (Array.isArray(data.transactions))
      return (data.transactions as { amount: number; type?: string }[])
        .filter((t) => t.type === 'deposit' || (t.amount > 0 && t.type !== 'withdrawal'))
        .reduce((s, t) => s + (t.amount || 0), 0);
    return 0;
  };

  // Compute bank deposit summary from tracked documents (LEGACY — kept only for "all" variant)
  const _legacyBankDepositSummary = useMemo((): BankDepositSummary | null => {
    const bankDocs = trackedDocuments.filter((d) => d.type === 'bank-statement');
    if (bankDocs.length === 0) return null;

    let totalDeposits = 0;
    let depositCount = 0;
    const accountMap = new Map<
      string,
      { institution: string; accountType: string; total: number }
    >();

    for (const doc of bankDocs) {
      const data = doc.parsedData as Record<string, unknown> | undefined;
      const deposits = getDepositTotal(data);
      const count = Number(data?.depositCount || data?.depositsCount || 0);
      totalDeposits += deposits;
      depositCount += count;

      const institution = (data?.institution || doc.fileName.split('_')[0] || 'Bank') as string;
      const accountType = (data?.accountType || 'Checking') as string;
      const key = `${institution}|${accountType}`;
      const existing = accountMap.get(key);
      if (existing) {
        existing.total += deposits;
      } else {
        accountMap.set(key, { institution, accountType, total: deposits });
      }
    }

    if (totalDeposits === 0) return null;

    return {
      totalDeposits,
      depositCount,
      statementCount: bankDocs.length,
      byAccount: Array.from(accountMap.values()),
    };
  }, [trackedDocuments]);

  const allBankDepositSummary = useMemo((): BankDepositSummary | null => {
    if (!hasHiddenDocs) return null;
    const bankDocs = scannedDocuments.filter((d) => d.type === 'bank-statement');
    if (bankDocs.length === 0) return null;

    let totalDeposits = 0;
    let depositCount = 0;
    const accountMap = new Map<
      string,
      { institution: string; accountType: string; total: number }
    >();

    for (const doc of bankDocs) {
      const data = doc.parsedData as Record<string, unknown> | undefined;
      const deposits = getDepositTotal(data);
      const count = Number(data?.depositCount || data?.depositsCount || 0);
      totalDeposits += deposits;
      depositCount += count;

      const institution = (data?.institution || doc.fileName.split('_')[0] || 'Bank') as string;
      const accountType = (data?.accountType || 'Checking') as string;
      const key = `${institution}|${accountType}`;
      const existing = accountMap.get(key);
      if (existing) {
        existing.total += deposits;
      } else {
        accountMap.set(key, { institution, accountType, total: deposits });
      }
    }

    if (totalDeposits === 0) return null;

    return {
      totalDeposits,
      depositCount,
      statementCount: bankDocs.length,
      byAccount: Array.from(accountMap.values()),
    };
  }, [scannedDocuments, hasHiddenDocs]);

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
