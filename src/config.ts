// =============================================================================
// DocVault Configuration
// =============================================================================
// Edit this file to customize entities, expense categories, and document types.
// Changes here will reflect throughout the app.

import type { Entity, DocumentType, ExpenseCategory } from './types';

// Folder structure within each tax year
export const TAX_YEAR_STRUCTURE = {
  'income/w2': ['w2'],
  'income/1099': ['1099-nec', '1099-misc', '1099-r', '1099-div', '1099-int', '1099-b'],
  'income/1098': ['1098'],
  'income/other': ['invoice', 'other'],
  'expenses/business': ['receipt'],
  'expenses/childcare': ['receipt'],
  'expenses/medical': ['receipt'],
  'statements/bank': ['bank-statement'],
  'statements/credit-card': ['credit-card-statement'],
  crypto: ['crypto'],
  returns: ['return'],
  turbotax: ['return'],
} as const;

// =============================================================================
// INCOME SOURCES (W-2 Employers, 1099 Payers)
// =============================================================================
// Track different income sources within an entity. Useful for joint filers
// or multiple jobs.

export interface IncomeSource {
  id: string;
  name: string;
  entity: Entity;
  type: 'w2' | '1099';
  person?: string; // For joint filers: "self", "spouse", etc.
}

export const INCOME_SOURCES: IncomeSource[] = [
  // Personal W-2s (joint filing)
  { id: 'adam-w2', name: "Adam's W-2", entity: 'personal', type: 'w2', person: 'self' },
  { id: 'spouse-w2', name: "Spouse's W-2", entity: 'personal', type: 'w2', person: 'spouse' },

  // AM2 LLC income
  { id: 'am2-1099', name: 'AM2 LLC 1099s', entity: 'am2-llc', type: '1099' },

  // Manna LLC income
  { id: 'manna-1099', name: 'Manna 1099s', entity: 'manna-llc', type: '1099' },
];

// =============================================================================
// DOCUMENT TYPES
// =============================================================================
// Standard tax document types. Rarely needs modification.

export const DOCUMENT_TYPES: {
  id: DocumentType;
  label: string;
  category: 'income' | 'expense' | 'crypto' | 'other' | 'business';
}[] = [
  { id: 'w2', label: 'W-2', category: 'income' },
  { id: '1099-nec', label: '1099-NEC', category: 'income' },
  { id: '1099-misc', label: '1099-MISC', category: 'income' },
  { id: '1099-r', label: '1099-R', category: 'income' },
  { id: '1099-div', label: '1099-DIV', category: 'income' },
  { id: '1099-int', label: '1099-INT', category: 'income' },
  { id: '1099-b', label: '1099-B', category: 'income' },
  { id: '1098', label: '1098 (Mortgage Interest)', category: 'other' },
  { id: 'receipt', label: 'Receipt', category: 'expense' },
  { id: 'invoice', label: 'Invoice', category: 'income' },
  { id: 'crypto', label: 'Crypto Report', category: 'crypto' },
  { id: 'return', label: 'Tax Return', category: 'other' },
  { id: 'contract', label: 'Contract', category: 'other' },
  { id: 'other', label: 'Other', category: 'other' },
  // Business documents (not tied to a tax year)
  { id: 'formation', label: 'Formation Docs', category: 'business' },
  { id: 'ein-letter', label: 'EIN Letter', category: 'business' },
  { id: 'license', label: 'License/Permit', category: 'business' },
  { id: 'business-agreement', label: 'Agreement/Contract', category: 'business' },
  { id: 'operating-agreement', label: 'Operating Agreement', category: 'business' },
  { id: 'insurance-policy', label: 'Insurance Policy', category: 'business' },
  // General document types (useful across entity types)
  { id: 'bank-statement', label: 'Bank Statement', category: 'other' },
  { id: 'credit-card-statement', label: 'Credit Card Statement', category: 'other' },
  { id: 'statement', label: 'Statement', category: 'other' },
  { id: 'letter', label: 'Letter/Correspondence', category: 'other' },
  { id: 'certificate', label: 'Certificate', category: 'other' },
  { id: 'medical-record', label: 'Medical Record', category: 'other' },
  { id: 'appraisal', label: 'Appraisal/Assessment', category: 'other' },
];

// =============================================================================
// BUSINESS DOCUMENT FOLDER STRUCTURE
// =============================================================================
// Maps document types to subfolders within business-docs/

export const BUSINESS_FOLDER_STRUCTURE: Record<string, string[]> = {
  formation: ['formation'],
  contracts: ['business-agreement', 'contract'],
  ein: ['ein-letter'],
  licenses: ['license'],
  agreements: ['operating-agreement'],
  insurance: ['insurance-policy'],
};

// Helper to check if a document type is a business document
export function isBusinessDocumentType(docType: DocumentType): boolean {
  const businessTypes: DocumentType[] = [
    'formation',
    'ein-letter',
    'license',
    'business-agreement',
    'operating-agreement',
    'insurance-policy',
  ];
  return businessTypes.includes(docType);
}

// Get the subfolder for a business document type
export function getBusinessSubfolder(docType: DocumentType): string {
  for (const [folder, types] of Object.entries(BUSINESS_FOLDER_STRUCTURE)) {
    if (types.includes(docType)) {
      return folder;
    }
  }
  return 'other';
}

// =============================================================================
// EXPENSE CATEGORIES (Schedule C)
// =============================================================================
// IRS expense categories with deduction rates and Schedule C line references.
// - deductionRate: 1 = 100% deductible, 0.5 = 50% deductible (e.g., meals)
// - scheduleC: The Schedule C line where this expense is reported

export const EXPENSE_CATEGORIES: {
  id: ExpenseCategory;
  label: string;
  deductionRate: number;
  scheduleC?: string;
  folder?: string; // Maps to folder in expenses/
}[] = [
  {
    id: 'meals',
    label: 'Meals & Entertainment',
    deductionRate: 0.5,
    scheduleC: 'Line 24b',
    folder: 'business',
  },
  {
    id: 'software',
    label: 'Software & Subscriptions',
    deductionRate: 1,
    scheduleC: 'Line 27a',
    folder: 'business',
  },
  {
    id: 'equipment',
    label: 'Equipment & Hardware',
    deductionRate: 1,
    scheduleC: 'Line 13',
    folder: 'business',
  },
  {
    id: 'office-supplies',
    label: 'Office Supplies',
    deductionRate: 1,
    scheduleC: 'Line 18',
    folder: 'business',
  },
  {
    id: 'professional-services',
    label: 'Professional Services',
    deductionRate: 1,
    scheduleC: 'Line 17',
    folder: 'business',
  },
  { id: 'travel', label: 'Travel', deductionRate: 1, scheduleC: 'Line 24a', folder: 'business' },
  {
    id: 'utilities',
    label: 'Utilities',
    deductionRate: 1,
    scheduleC: 'Line 25',
    folder: 'business',
  },
  {
    id: 'insurance',
    label: 'Insurance',
    deductionRate: 1,
    scheduleC: 'Line 15',
    folder: 'business',
  },
  {
    id: 'taxes-licenses',
    label: 'Taxes & Licenses',
    deductionRate: 1,
    scheduleC: 'Line 23',
    folder: 'business',
  },
  { id: 'childcare', label: 'Childcare', deductionRate: 1, folder: 'childcare' },
  { id: 'medical', label: 'Medical', deductionRate: 1, folder: 'medical' },
  { id: 'education', label: 'Education', deductionRate: 1, folder: 'business' },
  { id: 'other', label: 'Other', deductionRate: 1, scheduleC: 'Line 27a', folder: 'business' },
];

// =============================================================================
// EXPENSE FOLDER MAP
// =============================================================================
// Maps expense categories to folder paths within a tax year directory.
// Used by importFile and getDestPath in useFileSystemServer.

export const EXPENSE_FOLDER_MAP: Record<ExpenseCategory, string> = {
  childcare: 'expenses/childcare',
  medical: 'expenses/medical',
  meals: 'expenses/business',
  software: 'expenses/business',
  equipment: 'expenses/business',
  'office-supplies': 'expenses/business',
  'professional-services': 'expenses/business',
  travel: 'expenses/business',
  utilities: 'expenses/business',
  insurance: 'expenses/business',
  education: 'expenses/business',
  'taxes-licenses': 'expenses/business',
  other: 'expenses/business',
};
