// =============================================================================
// TaxVault Configuration
// =============================================================================
// Edit this file to customize entities, expense categories, and document types.
// Changes here will reflect throughout the app.

import type { Entity, DocumentType, ExpenseCategory } from './types';

// =============================================================================
// ENTITIES (Tax Filing Entities)
// =============================================================================
// Add or remove entities as needed. Each entity represents a separate
// tax filing unit (personal, LLC, etc.)

export const ENTITIES: {
  id: Entity;
  name: string;
  color: 'blue' | 'green' | 'amber' | 'purple' | 'pink' | 'red';
}[] = [
  { id: 'personal', name: 'Personal', color: 'blue' },
  { id: 'am2-llc', name: 'AM2 LLC', color: 'green' },
  { id: 'manna-llc', name: 'Manna of the Valley LLC', color: 'amber' },
];

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
  category: 'income' | 'expense' | 'crypto' | 'other';
}[] = [
  { id: 'w2', label: 'W-2', category: 'income' },
  { id: '1099-nec', label: '1099-NEC', category: 'income' },
  { id: '1099-misc', label: '1099-MISC', category: 'income' },
  { id: '1099-r', label: '1099-R', category: 'income' },
  { id: '1099-div', label: '1099-DIV', category: 'income' },
  { id: '1099-int', label: '1099-INT', category: 'income' },
  { id: '1099-b', label: '1099-B', category: 'income' },
  { id: 'receipt', label: 'Receipt', category: 'expense' },
  { id: 'invoice', label: 'Invoice', category: 'income' },
  { id: 'crypto', label: 'Crypto Report', category: 'crypto' },
  { id: 'return', label: 'Tax Return', category: 'other' },
  { id: 'contract', label: 'Contract', category: 'other' },
  { id: 'other', label: 'Other', category: 'other' },
];

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
}[] = [
  { id: 'meals', label: 'Meals & Entertainment', deductionRate: 0.5, scheduleC: 'Line 24b' },
  { id: 'software', label: 'Software & Subscriptions', deductionRate: 1, scheduleC: 'Line 27a' },
  { id: 'equipment', label: 'Equipment & Hardware', deductionRate: 1, scheduleC: 'Line 13' },
  { id: 'office-supplies', label: 'Office Supplies', deductionRate: 1, scheduleC: 'Line 18' },
  {
    id: 'professional-services',
    label: 'Professional Services',
    deductionRate: 1,
    scheduleC: 'Line 17',
  },
  { id: 'travel', label: 'Travel', deductionRate: 1, scheduleC: 'Line 24a' },
  { id: 'utilities', label: 'Utilities', deductionRate: 1, scheduleC: 'Line 25' },
  { id: 'insurance', label: 'Insurance', deductionRate: 1, scheduleC: 'Line 15' },
  { id: 'childcare', label: 'Childcare', deductionRate: 1 },
  { id: 'medical', label: 'Medical', deductionRate: 1 },
  { id: 'education', label: 'Education', deductionRate: 1 },
  { id: 'other', label: 'Other', deductionRate: 1, scheduleC: 'Line 27a' },
];
