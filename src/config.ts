// =============================================================================
// DocVault Configuration
// =============================================================================
// Edit this file to customize entities, expense categories, and document types.
// Changes here will reflect throughout the app.

import type { DocumentType, ExpenseCategory } from './types';

// Folder structure within each tax year
export const TAX_YEAR_STRUCTURE = {
  'income/w2': ['w2'],
  'income/1099': [
    '1099-nec',
    '1099-misc',
    '1099-r',
    '1099-div',
    '1099-int',
    '1099-b',
    '1099-composite',
  ],
  'income/k-1': ['k-1'],
  'expenses/1098': ['1098'],
  'income/other': ['invoice', 'other'],
  retirement: ['retirement-statement'],
  'expenses/business': ['receipt'],
  'expenses/childcare': ['receipt'],
  'expenses/medical': ['receipt'],
  'expenses/home-improvement': ['receipt'],
  'statements/bank': ['bank-statement'],
  'statements/credit-card': ['credit-card-statement'],
  crypto: ['crypto'],
  returns: ['return'],
  turbotax: ['return'],
} as const;

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
  { id: '1099-composite', label: '1099 Composite', category: 'income' },
  { id: 'k-1', label: 'Schedule K-1', category: 'income' },
  { id: '1098', label: '1098 (Mortgage Interest)', category: 'other' },
  { id: 'retirement-statement', label: 'Retirement Statement', category: 'other' },
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
  color: string; // Tailwind color classes: "bg-{color}-500/15 text-{color}-400"
}[] = [
  {
    id: 'meals',
    label: 'Meals & Entertainment',
    deductionRate: 0.5,
    scheduleC: 'Line 24b',
    folder: 'business',
    color: 'bg-orange-500/15 text-orange-400',
  },
  {
    id: 'software',
    label: 'Software & Subscriptions',
    deductionRate: 1,
    scheduleC: 'Line 27a',
    folder: 'business',
    color: 'bg-blue-500/15 text-blue-400',
  },
  {
    id: 'equipment',
    label: 'Equipment & Hardware',
    deductionRate: 1,
    scheduleC: 'Line 13',
    folder: 'business',
    color: 'bg-slate-500/15 text-slate-400',
  },
  {
    id: 'office-supplies',
    label: 'Office Supplies',
    deductionRate: 1,
    scheduleC: 'Line 18',
    folder: 'business',
    color: 'bg-cyan-500/15 text-cyan-400',
  },
  {
    id: 'professional-services',
    label: 'Professional Services',
    deductionRate: 1,
    scheduleC: 'Line 17',
    folder: 'business',
    color: 'bg-indigo-500/15 text-indigo-400',
  },
  {
    id: 'travel',
    label: 'Travel',
    deductionRate: 1,
    scheduleC: 'Line 24a',
    folder: 'business',
    color: 'bg-sky-500/15 text-sky-400',
  },
  {
    id: 'utilities',
    label: 'Utilities',
    deductionRate: 1,
    scheduleC: 'Line 25',
    folder: 'business',
    color: 'bg-yellow-500/15 text-yellow-400',
  },
  {
    id: 'insurance',
    label: 'Insurance',
    deductionRate: 1,
    scheduleC: 'Line 15',
    folder: 'business',
    color: 'bg-teal-500/15 text-teal-400',
  },
  {
    id: 'taxes-licenses',
    label: 'Taxes & Licenses',
    deductionRate: 1,
    scheduleC: 'Line 23',
    folder: 'business',
    color: 'bg-red-500/15 text-red-400',
  },
  {
    id: 'childcare',
    label: 'Childcare',
    deductionRate: 1,
    folder: 'childcare',
    color: 'bg-pink-500/15 text-pink-400',
  },
  {
    id: 'medical',
    label: 'Medical',
    deductionRate: 1,
    folder: 'medical',
    color: 'bg-rose-500/15 text-rose-400',
  },
  {
    id: 'education',
    label: 'Education',
    deductionRate: 1,
    folder: 'business',
    color: 'bg-violet-500/15 text-violet-400',
  },
  {
    id: 'home-improvement',
    label: 'Home Improvement',
    deductionRate: 0,
    folder: 'home-improvement',
    color: 'bg-stone-500/15 text-stone-400',
  },
  {
    id: 'feed',
    label: 'Feed & Livestock Supplies',
    deductionRate: 1,
    scheduleC: 'Schedule F Line 29',
    folder: 'business',
    color: 'bg-lime-500/15 text-lime-400',
  },
  {
    id: 'livestock',
    label: 'Livestock Purchases',
    deductionRate: 1,
    scheduleC: 'Schedule F Line 33',
    folder: 'business',
    color: 'bg-amber-500/15 text-amber-400',
  },
  {
    id: 'other',
    label: 'Other',
    deductionRate: 1,
    scheduleC: 'Line 27a',
    folder: 'business',
    color: 'bg-neutral-500/15 text-neutral-400',
  },
];

// =============================================================================
// COLOR HELPERS
// =============================================================================
// Shared color functions used by DocumentCard and DocumentViewer.

export function getDocumentTypeColor(type: DocumentType): string {
  const docType = DOCUMENT_TYPES.find((dt) => dt.id === type);
  switch (docType?.category) {
    case 'income':
      return 'bg-emerald-500/15 text-emerald-400';
    case 'expense':
      return 'bg-red-500/15 text-red-400';
    case 'crypto':
      return 'bg-purple-500/15 text-purple-400';
    default:
      return 'bg-surface-400/15 text-surface-800';
  }
}

export function getExpenseCategoryColor(categoryId: ExpenseCategory): string {
  return (
    EXPENSE_CATEGORIES.find((c) => c.id === categoryId)?.color ??
    'bg-neutral-500/15 text-neutral-400'
  );
}

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
  'home-improvement': 'expenses/home-improvement',
  feed: 'expenses/business',
  livestock: 'expenses/business',
  other: 'expenses/business',
};
