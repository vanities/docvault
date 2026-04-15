// useAnalytics — fetches aggregated summaries from the backend analytics endpoint.
// Replaces the ~570 lines of useMemo aggregation in TaxYearView.

import { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../constants';
import type {
  IncomeSummary,
  ExpenseSummary,
  BankDepositSummary,
  InvoiceSummaryData,
  RetirementSummary,
  ExpenseCategory,
} from '../types';

// Types matching the /api/analytics/quick-stats response
interface AnalyticsExpenseItem {
  category: string;
  total: number;
  deductibleAmount: number;
  count: number;
}

interface AnalyticsIncomeItem {
  source: string;
  amount: number;
  type: string;
  details?: Record<string, unknown>;
  filePath?: string;
}

interface BankDepositMonth {
  month: string;
  deposits: number;
  ownerContributions: number;
  revenueDeposits: number;
  sources: {
    date: string;
    description: string;
    amount: number;
    isOwnerContribution: boolean;
    isRevenueDeposit: boolean;
  }[];
  notes?: string;
}

interface BankDepositSummaryResponse {
  totalDeposits: number;
  totalRevenue: number;
  totalOwnerContributions: number;
  statementCount: number;
  monthly: BankDepositMonth[];
  quarterly: {
    quarter: string;
    deposits: number;
    revenueDeposits: number;
    ownerContributions: number;
  }[];
}

interface InvoiceCustomerGroup {
  customer: string;
  total: number;
  count: number;
}

interface InvoicesResponse {
  invoiceTotal: number;
  invoiceCount: number;
  byCustomer: InvoiceCustomerGroup[];
}

interface RetirementResponse {
  totalContributions: number;
  employerContributions: number;
  employeeContributions: number;
  statementCount: number;
  byAccount: { institution: string; accountType: string; total: number }[];
}

interface QuickStatsResponse {
  entityId: string;
  year: string;
  income: IncomeSummary & { items: AnalyticsIncomeItem[] };
  expenses: ExpenseSummary & {
    items: AnalyticsExpenseItem[];
    expenses: {
      vendor: string;
      amount: number;
      category: string;
      date?: string;
      filePath?: string;
    }[];
  };
  bankDeposits: Record<string, BankDepositSummaryResponse>;
  invoices: InvoicesResponse;
  retirement: RetirementResponse | null;
  documentCount: number;
}

interface UseAnalyticsResult {
  incomeSummary: IncomeSummary;
  expenseSummary: ExpenseSummary;
  invoiceSummary: InvoiceSummaryData;
  retirementSummary: RetirementSummary | null;
  bankDepositSummary: BankDepositSummary | null;
  bankDepositDetails: Record<string, BankDepositSummaryResponse>;
  incomeItems: AnalyticsIncomeItem[];
  documentCount: number;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const emptyIncome: IncomeSummary = {
  entity: '',
  taxYear: 0,
  w2Total: 0,
  w2Count: 0,
  income1099Total: 0,
  income1099Count: 0,
  k1Total: 0,
  k1Count: 0,
  salesTotal: 0,
  salesCount: 0,
  totalIncome: 0,
  federalWithheld: 0,
  stateWithheld: 0,
  capitalGainsTotal: 0,
  capitalGainsShortTerm: 0,
  capitalGainsLongTerm: 0,
};

const emptyExpenses: ExpenseSummary = {
  entity: '',
  taxYear: 0,
  items: [],
  totalExpenses: 0,
  totalDeductible: 0,
  mileageTotal: 0,
  mileageDeduction: 0,
  mileageCount: 0,
};

export function useAnalytics(
  entity: string,
  year: number,
  includeHidden = false
): UseAnalyticsResult {
  const [data, setData] = useState<QuickStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!entity || !year) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    const qs = includeHidden ? '?includeHidden=true' : '';
    fetch(`${API_BASE}/analytics/quick-stats/${entity}/${year}${qs}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((result: QuickStatsResponse) => {
        if (!cancelled) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [entity, year, refreshKey, includeHidden]);

  const emptyInvoices: InvoiceSummaryData = {
    entity,
    taxYear: year,
    invoiceTotal: 0,
    invoiceCount: 0,
    byCustomer: [],
  };

  if (!data) {
    return {
      incomeSummary: { ...emptyIncome, entity, taxYear: year },
      expenseSummary: { ...emptyExpenses, entity, taxYear: year },
      invoiceSummary: emptyInvoices,
      retirementSummary: null,
      bankDepositSummary: null,
      bankDepositDetails: {},
      incomeItems: [],
      documentCount: 0,
      loading,
      error,
      refresh,
    };
  }

  // Map response to frontend types
  const incomeSummary: IncomeSummary = {
    entity,
    taxYear: year,
    w2Total: data.income.w2Total,
    w2Count: data.income.w2Count,
    income1099Total: data.income.income1099Total,
    income1099Count: data.income.income1099Count,
    k1Total: data.income.k1Total,
    k1Count: data.income.k1Count,
    salesTotal: data.income.salesTotal,
    salesCount: data.income.salesCount,
    totalIncome: data.income.totalIncome,
    federalWithheld: data.income.federalWithheld,
    stateWithheld: data.income.stateWithheld,
    capitalGainsTotal: data.income.capitalGainsTotal,
    capitalGainsShortTerm: data.income.capitalGainsShortTerm,
    capitalGainsLongTerm: data.income.capitalGainsLongTerm,
  };

  const expenseSummary: ExpenseSummary = {
    entity,
    taxYear: year,
    items: data.expenses.items.map((i) => ({
      category: i.category as ExpenseCategory,
      total: i.total,
      deductibleAmount: i.deductibleAmount,
      count: i.count,
    })),
    totalExpenses: data.expenses.totalExpenses,
    totalDeductible: data.expenses.totalDeductible,
    mileageTotal: data.expenses.mileageTotal,
    mileageDeduction: data.expenses.mileageDeduction,
    mileageCount: data.expenses.mileageCount,
  };

  // Aggregate bank deposits across entities
  let totalDeposits = 0;
  let totalRevenue = 0;
  let totalOwnerContributions = 0;
  let depositCount = 0;
  let statementCount = 0;
  const accountMap = new Map<string, { institution: string; accountType: string; total: number }>();

  for (const [, summary] of Object.entries(data.bankDeposits)) {
    totalDeposits += summary.totalDeposits;
    totalRevenue += summary.totalRevenue ?? 0;
    totalOwnerContributions += summary.totalOwnerContributions ?? 0;
    statementCount += summary.statementCount;
    for (const m of summary.monthly) {
      depositCount += m.sources.length;
    }
  }

  const bankDepositSummary: BankDepositSummary | null =
    totalDeposits > 0
      ? {
          totalDeposits,
          totalRevenue,
          totalOwnerContributions,
          depositCount,
          statementCount,
          byAccount: Array.from(accountMap.values()),
        }
      : null;

  // Map invoices response
  const invoiceSummary: InvoiceSummaryData = {
    entity,
    taxYear: year,
    invoiceTotal: data.invoices?.invoiceTotal || 0,
    invoiceCount: data.invoices?.invoiceCount || 0,
    byCustomer: data.invoices?.byCustomer || [],
  };

  // Map retirement response
  const retirementSummary: RetirementSummary | null = data.retirement
    ? {
        totalContributions: data.retirement.totalContributions,
        employerContributions: data.retirement.employerContributions,
        employeeContributions: data.retirement.employeeContributions,
        statementCount: data.retirement.statementCount,
        byAccount: data.retirement.byAccount,
      }
    : null;

  return {
    incomeSummary,
    expenseSummary,
    invoiceSummary,
    retirementSummary,
    bankDepositSummary,
    bankDepositDetails: data.bankDeposits,
    incomeItems: data.income.items,
    documentCount: data.documentCount,
    loading,
    error,
    refresh,
  };
}
