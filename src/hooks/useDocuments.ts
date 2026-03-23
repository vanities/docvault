import { useState, useEffect, useCallback } from 'react';
import type {
  TaxDocument,
  Entity,
  DocumentType,
  ExpenseCategory,
  IncomeSummary,
  ExpenseSummary,
  TaxYearStatus,
} from '../types';
import { EXPENSE_CATEGORIES } from '../config';

const STORAGE_KEY = 'docvault_documents';
const STATUS_STORAGE_KEY = 'docvault_tax_years';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function loadFromStorage<T>(key: string, defaultValue: T): T {
  try {
    const stored = localStorage.getItem(key);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error(`Error loading from localStorage key ${key}:`, e);
  }
  return defaultValue;
}

function saveToStorage<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error(`Error saving to localStorage key ${key}:`, e);
  }
}

export function useDocuments() {
  const [documents, setDocuments] = useState<TaxDocument[]>(() => loadFromStorage(STORAGE_KEY, []));
  const [taxYearStatuses, setTaxYearStatuses] = useState<TaxYearStatus[]>(() =>
    loadFromStorage(STATUS_STORAGE_KEY, [])
  );

  // Persist documents to localStorage
  useEffect(() => {
    saveToStorage(STORAGE_KEY, documents);
  }, [documents]);

  // Persist tax year statuses
  useEffect(() => {
    saveToStorage(STATUS_STORAGE_KEY, taxYearStatuses);
  }, [taxYearStatuses]);

  // Add a new document
  const addDocument = useCallback(
    (
      file: File,
      type: DocumentType,
      entity: Entity,
      taxYear: number,
      parsedData?: TaxDocument['parsedData']
    ): TaxDocument => {
      const now = new Date().toISOString();
      const newDoc: TaxDocument = {
        id: generateId(),
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        type,
        entity,
        taxYear,
        tags: [],
        tracked: true,
        parsedData,
        createdAt: now,
        updatedAt: now,
      };
      setDocuments((prev) => [...prev, newDoc]);
      return newDoc;
    },
    []
  );

  // Update a document
  const updateDocument = useCallback((id: string, updates: Partial<TaxDocument>) => {
    setDocuments((prev) =>
      prev.map((doc) =>
        doc.id === id ? { ...doc, ...updates, updatedAt: new Date().toISOString() } : doc
      )
    );
  }, []);

  // Delete a document
  const deleteDocument = useCallback((id: string) => {
    setDocuments((prev) => prev.filter((doc) => doc.id !== id));
  }, []);

  // Filter documents by entity and year
  const getFilteredDocuments = useCallback(
    (entity: Entity, taxYear: number) => {
      return documents.filter((doc) => doc.entity === entity && doc.taxYear === taxYear);
    },
    [documents]
  );

  // Get income summary for an entity and year
  const getIncomeSummary = useCallback(
    (entity: Entity, taxYear: number): IncomeSummary => {
      const docs = documents.filter((doc) => doc.entity === entity && doc.taxYear === taxYear);

      const w2Docs = docs.filter((d) => d.type === 'w2');
      const income1099Docs = docs.filter((d) => d.type.startsWith('1099'));

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
          | { amount?: number; federalWithheld?: number; stateWithheld?: number }
          | undefined;
        if (data) {
          income1099Total += data.amount || 0;
          federalWithheld += data.federalWithheld || 0;
          stateWithheld += data.stateWithheld || 0;
        }
      });

      const k1Docs = docs.filter((d) => d.type === 'k-1');
      let k1Total = 0;
      k1Docs.forEach((doc) => {
        const data = doc.parsedData as
          | { ordinaryIncome?: number; guaranteedPayments?: number }
          | undefined;
        if (data) {
          k1Total += (data.ordinaryIncome || 0) + (data.guaranteedPayments || 0);
        }
      });

      return {
        entity,
        taxYear,
        w2Total,
        w2Count: w2Docs.length,
        income1099Total,
        income1099Count: income1099Docs.length,
        k1Total,
        k1Count: k1Docs.length,
        totalIncome: w2Total + income1099Total + k1Total,
        federalWithheld,
        stateWithheld,
        capitalGainsTotal: 0,
        capitalGainsShortTerm: 0,
        capitalGainsLongTerm: 0,
      };
    },
    [documents]
  );

  // Get expense summary for an entity and year
  const getExpenseSummary = useCallback(
    (entity: Entity, taxYear: number): ExpenseSummary => {
      const docs = documents.filter(
        (doc) => doc.entity === entity && doc.taxYear === taxYear && doc.type === 'receipt'
      );

      const categoryTotals = new Map<ExpenseCategory, { total: number; count: number }>();

      docs.forEach((doc) => {
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
        entity,
        taxYear,
        items,
        totalExpenses,
        totalDeductible,
      };
    },
    [documents]
  );

  // Get available tax years from documents
  const getAvailableTaxYears = useCallback((): number[] => {
    const years = new Set(documents.map((d) => d.taxYear));
    // Always include current year and previous year
    const currentYear = new Date().getFullYear();
    years.add(currentYear);
    years.add(currentYear - 1);
    return Array.from(years).sort((a, b) => b - a);
  }, [documents]);

  // Update tax year status
  const updateTaxYearStatus = useCallback((year: number, updates: Partial<TaxYearStatus>) => {
    setTaxYearStatuses((prev) => {
      const existing = prev.find((s) => s.year === year);
      if (existing) {
        return prev.map((s) => (s.year === year ? { ...s, ...updates } : s));
      }
      return [...prev, { year, status: 'in-progress', ...updates }];
    });
  }, []);

  // Get tax year status
  const getTaxYearStatus = useCallback(
    (year: number): TaxYearStatus | undefined => {
      return taxYearStatuses.find((s) => s.year === year);
    },
    [taxYearStatuses]
  );

  // Bulk add documents (for imports)
  const bulkAddDocuments = useCallback(
    (newDocs: Omit<TaxDocument, 'id' | 'createdAt' | 'updatedAt'>[]) => {
      const now = new Date().toISOString();
      const docsWithIds = newDocs.map((doc) => ({
        ...doc,
        id: generateId(),
        createdAt: now,
        updatedAt: now,
      }));
      setDocuments((prev) => [...prev, ...docsWithIds]);
    },
    []
  );

  // Clear all documents (with confirmation)
  const clearAllDocuments = useCallback(() => {
    setDocuments([]);
    setTaxYearStatuses([]);
  }, []);

  return {
    documents,
    addDocument,
    updateDocument,
    deleteDocument,
    getFilteredDocuments,
    getIncomeSummary,
    getExpenseSummary,
    getAvailableTaxYears,
    updateTaxYearStatus,
    getTaxYearStatus,
    bulkAddDocuments,
    clearAllDocuments,
  };
}
