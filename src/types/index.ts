// =============================================================================
// Type Definitions
// =============================================================================
// For configuration values (entities, categories, etc.), see src/config.ts

// Entity types - dynamic, loaded from server config
export type Entity = string;

// Document types
export type DocumentType =
  | 'w2'
  | '1099-nec'
  | '1099-misc'
  | '1099-r'
  | '1099-div'
  | '1099-int'
  | '1099-b'
  | 'receipt'
  | 'invoice'
  | 'crypto'
  | 'return'
  | 'contract'
  | 'other'
  // Business documents (not tied to a tax year)
  | 'formation'
  | 'ein-letter'
  | 'license'
  | 'business-agreement';

// Expense categories for Schedule C
export type ExpenseCategory =
  | 'meals'
  | 'software'
  | 'equipment'
  | 'office-supplies'
  | 'professional-services'
  | 'travel'
  | 'utilities'
  | 'insurance'
  | 'childcare'
  | 'medical'
  | 'education'
  | 'other';

// Parsed data structures
export interface ParsedW2 {
  employer: string;
  employerAddress?: string;
  ein: string;
  wages: number; // Box 1
  federalWithheld: number; // Box 2
  socialSecurityWages: number; // Box 3
  socialSecurityTax: number; // Box 4
  medicareWages: number; // Box 5
  medicareTax: number; // Box 6
  stateWages?: number; // Box 16
  stateWithheld?: number; // Box 17
  localWages?: number; // Box 18
  localWithheld?: number; // Box 19
  incomeSourceId?: string; // Links to INCOME_SOURCES in config
}

export interface Parsed1099 {
  payer: string;
  payerAddress?: string;
  payerTin: string;
  amount: number; // Box varies by 1099 type
  federalWithheld?: number;
  stateWithheld?: number;
  accountNumber?: string;
  incomeSourceId?: string; // Links to INCOME_SOURCES in config
}

export interface ParsedReceipt {
  vendor: string;
  amount: number;
  date: string; // ISO date string
  category: ExpenseCategory;
  description?: string;
  paymentMethod?: string;
}

export interface ParsedCrypto {
  source: 'koinly' | 'coinbase' | 'kraken' | 'other';
  taxYear: number;
  shortTermGains: number;
  longTermGains: number;
  totalProceeds: number;
  costBasis: number;
  transactions?: number;
}

// Main document interface
export interface TaxDocument {
  id: string;
  fileName: string;
  fileType: string; // e.g., 'application/pdf', 'image/png'
  fileSize: number;
  filePath?: string; // Local path if available
  type: DocumentType;
  entity: Entity;
  taxYear: number;
  tags: string[];
  notes?: string;
  incomeSourceId?: string; // For W-2s: links to INCOME_SOURCES
  parsedData?: ParsedW2 | Parsed1099 | ParsedReceipt | ParsedCrypto;
  createdAt: string; // ISO date string
  updatedAt: string; // ISO date string
}

// Summary types for dashboard
export interface IncomeSummary {
  entity: Entity;
  taxYear: number;
  w2Total: number;
  w2Count: number;
  income1099Total: number;
  income1099Count: number;
  totalIncome: number;
  federalWithheld: number;
  stateWithheld: number;
}

export interface ExpenseSummaryItem {
  category: ExpenseCategory;
  total: number;
  deductibleAmount: number;
  count: number;
}

export interface ExpenseSummary {
  entity: Entity;
  taxYear: number;
  items: ExpenseSummaryItem[];
  totalExpenses: number;
  totalDeductible: number;
}

// Reminders
export interface Reminder {
  id: string;
  entityId: Entity;
  title: string;
  dueDate: string; // YYYY-MM-DD
  recurrence?: 'yearly' | 'monthly' | 'quarterly' | null;
  status: 'pending' | 'completed' | 'dismissed';
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

// Todos
export interface Todo {
  id: string;
  title: string;
  status: 'pending' | 'completed';
  createdAt: string;
  updatedAt: string;
}

// App state
export interface AppState {
  selectedEntity: Entity;
  selectedTaxYear: number;
  documents: TaxDocument[];
}

// Filing status for TurboTax workflow
export interface TaxYearStatus {
  year: number;
  status: 'in-progress' | 'ready-to-file' | 'filed';
  filedDate?: string;
  confirmationNumber?: string;
  turboTaxFile?: string;
  returnPdf?: string;
}
