// Shared types for the analytics module.
// These are the canonical return types for all analytics functions.

// A single income line item extracted from a parsed document
export interface IncomeItem {
  source: string; // employer name, payer name, entity name
  amount: number;
  type:
    | 'W-2'
    | '1099-NEC'
    | '1099-DIV'
    | '1099-INT'
    | '1099-B'
    | '1099-R'
    | '1099-MISC'
    | 'K-1'
    | 'other';
  details?: Record<string, unknown>;
  filePath?: string; // source file path for traceability
}

// A single expense line item
export interface ExpenseItem {
  vendor: string;
  amount: number;
  category: string;
  date?: string;
  filePath?: string;
}

// A single deposit transaction from a bank statement
export interface DepositTransaction {
  date: string;
  description: string;
  amount: number;
  isOwnerContribution: boolean;
  isRevenueDeposit: boolean;
}

// Monthly bank deposit summary
export interface MonthlyDeposits {
  month: string; // "2025-01"
  deposits: number;
  ownerContributions: number;
  revenueDeposits: number;
  sources: DepositTransaction[];
  notes?: string;
}

// Quarterly deposit summary
export interface QuarterlyDeposits {
  quarter: string; // "Q1", "Q2", etc.
  deposits: number;
  revenueDeposits: number;
  ownerContributions: number;
}

// Capital gains breakdown
export interface CapitalGainsItem {
  source: string;
  shortTermGainLoss: number;
  longTermGainLoss: number;
  totalGainLoss: number;
  details?: Record<string, unknown>;
  filePath?: string;
}

// A single invoice line item
export interface InvoiceItem {
  customer: string;
  amount: number;
  date?: string;
  invoiceNumber?: string;
  filePath?: string;
}

// Retirement contribution item
export interface RetirementItem {
  institution: string;
  accountType: string;
  employerContributions: number;
  employeeContributions: number;
  totalContributions: number;
  filePath?: string;
}

// Tax calculation summary
export interface TaxCalculation {
  wages: number;
  federalWithheld: number;
  w2Details: { employer: string; wages: number; withheld: number }[];
  scheduleCIncome: number;
  capitalGains: { shortTerm: number; longTerm: number; total: number };
  dividends: { ordinary: number; qualified: number };
  otherIncome: number;
  estimatedTotalIncome: number;
  seTax: number;
  seTaxDeduction: number;
  retirementDeduction: number;
  estimatedAdjustments: number;
  estimatedAGI: number;
  estimatedPayments: {
    note: string;
    quarterly: { label: string; due: string }[];
  };
  // Extended fields for federal tax view comparison
  interestIncome: number;
  taxablePension: number;
  taxableIRA: number;
  k1Income: number;
  miscIncome: number;
  stakingIncome: number;
  k1SEEarnings: number;
  cryptoCapitalGains: { shortTerm: number; longTerm: number; total: number };
  standardDeduction: number;
  qbiDeduction: number;
  estimatedTaxableIncome: number;
  estimatedIncomeTax: number;
  niit: number;
  estimatedTotalTax: number;
}

// Form 2210 annualized income periods
export interface Form2210Period {
  label: string;
  cumulativeDeposits: number;
  cumulativeRevenue: number;
  cumulativeOwnerContributions: number;
}

// The loose parsed data type from .docvault-parsed.json
// This is what the extractors accept — both new-schema and legacy data
export type ParsedData = Record<string, unknown>;

// Metadata from .docvault-metadata.json
export interface DocumentMetadata {
  tracked?: boolean;
  tags?: string[];
  notes?: string;
}
