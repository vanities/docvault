/**
 * File naming utilities following NAMING_STANDARD.md
 * Pattern: {Source}_{Type}_{Date}.{ext}
 */

import type { DocumentType, ExpenseCategory } from '../types';

interface FilenameParams {
  source: string; // Company/vendor/employer name
  docType: DocumentType;
  year: number;
  month?: number; // For invoices (1-12)
  day?: number; // For receipts with specific date
  expenseCategory?: ExpenseCategory;
  description?: string; // Optional description for receipts
  extension: string;
}

/**
 * Convert a string to Title_Case with underscores
 * "art city" -> "Art_City"
 * "FUNFUNFUN" -> "Funfunfun"
 */
function toTitleCase(str: string): string {
  return str
    .trim()
    .split(/[\s_-]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('_');
}

/**
 * Convert description to hyphenated lowercase
 * "Client Meeting" -> "Client-meeting"
 */
function toHyphenated(str: string): string {
  return str
    .trim()
    .split(/[\s_]+/)
    .map((word, i) =>
      i === 0 ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word.toLowerCase()
    )
    .join('-');
}

/**
 * Get the document type suffix for the filename
 */
function getTypeLabel(docType: DocumentType): string {
  const typeMap: Record<DocumentType, string> = {
    w2: 'W2',
    '1099-nec': '1099-nec',
    '1099-misc': '1099-misc',
    '1099-r': '1099-r',
    '1099-div': '1099-div',
    '1099-int': '1099-int',
    '1099-b': '1099-b',
    '1099-composite': '1099-composite',
    '1098': '1098',
    'k-1': 'K-1',
    receipt: '', // Will use category instead
    invoice: 'Invoice',
    crypto: 'Crypto',
    return: '', // Special handling
    contract: 'W9',
    other: '',
    // Business document types
    formation: '',
    'ein-letter': '',
    license: '',
    'business-agreement': 'Contractor_Agreement',
    'bank-statement': 'Bank_Statement',
    'credit-card-statement': 'CC_Statement',
    'retirement-statement': 'Retirement',
    statement: 'Statement',
    letter: 'Letter',
    certificate: 'Certificate',
    'medical-record': 'Medical_Record',
    appraisal: 'Appraisal',
    'operating-agreement': 'Operating_Agreement',
    'insurance-policy': 'Insurance_Policy',
  };
  return typeMap[docType] || '';
}

/**
 * Get the expense category label for receipts
 */
function getCategoryLabel(category: ExpenseCategory): string {
  const categoryMap: Record<ExpenseCategory, string> = {
    meals: 'meals',
    software: 'software',
    equipment: 'equipment',
    travel: 'travel',
    'office-supplies': 'office',
    childcare: 'childcare',
    medical: 'medical',
    'professional-services': 'services',
    utilities: 'utilities',
    insurance: 'insurance',
    education: 'education',
    'home-improvement': 'home-improvement',
    'taxes-licenses': 'taxes',
    other: 'expense',
  };
  return categoryMap[category] || 'expense';
}

/**
 * Generate a standardized filename following NAMING_STANDARD.md
 */
export function generateStandardFilename(params: FilenameParams): string {
  const { source, docType, year, month, day, expenseCategory, description, extension } = params;

  const sourcePart = toTitleCase(source);
  const ext = extension.startsWith('.') ? extension : `.${extension}`;

  // Business documents (no year in filename)
  if (docType === 'formation') {
    return `Articles_of_Organization${ext}`;
  }
  if (docType === 'ein-letter') {
    return `EIN_Letter${ext}`;
  }
  if (docType === 'license') {
    return `Business_License_${year}${ext}`;
  }
  if (docType === 'business-agreement') {
    return `${sourcePart}_Contractor_Agreement${ext}`;
  }

  // W-2: {Employer}_W2_{Year}.pdf
  if (docType === 'w2') {
    return `${sourcePart}_W2_${year}${ext}`;
  }

  // 1099: {Payer}_1099-{type}_{Year}.pdf
  if (docType.startsWith('1099')) {
    const typeLabel = getTypeLabel(docType);
    return `${sourcePart}_${typeLabel}_${year}${ext}`;
  }

  // K-1: {Entity}_K-1_{Year}.pdf
  if (docType === 'k-1') {
    return `${sourcePart}_K-1_${year}${ext}`;
  }

  // Invoice: {Client}_Invoice_{Year}-{MM}.pdf
  if (docType === 'invoice') {
    const monthStr = month ? String(month).padStart(2, '0') : '01';
    return `${sourcePart}_Invoice_${year}-${monthStr}${ext}`;
  }

  // Receipt: {Vendor}_{Category}_{Date}.ext or {Vendor}_{Category}_{Description}_{Date}.ext
  if (docType === 'receipt' && expenseCategory) {
    const categoryLabel = getCategoryLabel(expenseCategory);
    const monthStr = month ? String(month).padStart(2, '0') : '01';
    const dayStr = day ? String(day).padStart(2, '0') : '01';
    const datePart = day ? `${year}-${monthStr}-${dayStr}` : `${year}`;

    if (description) {
      const descPart = toHyphenated(description);
      return `${sourcePart}_${categoryLabel}_${descPart}_${datePart}${ext}`;
    }
    return `${sourcePart}_${categoryLabel}_${datePart}${ext}`;
  }

  // Crypto: {Source}_Crypto_{Year}.ext
  if (docType === 'crypto') {
    return `${sourcePart}_Crypto_${year}${ext}`;
  }

  // Return: Return_{Status}_{Year}.pdf
  if (docType === 'return') {
    // Check if it's a TurboTax file
    if (ext.includes('.tax')) {
      return `TurboTax_${year}${ext}`;
    }
    return `Return_filed_${year}${ext}`;
  }

  // Contract (W-9): {Company}_W9_{Year}.pdf
  if (docType === 'contract') {
    return `${sourcePart}_W9_${year}${ext}`;
  }

  // Retirement Statement: {Institution}_Retirement_{Year}.pdf
  if (docType === 'retirement-statement') {
    return `${sourcePart}_Retirement_${year}${ext}`;
  }

  // Bank Statement: {Institution}_Bank_Statement_{Year}-{MM}.pdf
  if (docType === 'bank-statement') {
    const monthStr = month ? String(month).padStart(2, '0') : '01';
    return `${sourcePart}_Bank_Statement_${year}-${monthStr}${ext}`;
  }

  // Credit Card Statement: {Issuer}_CC_Statement_{Year}-{MM}.pdf
  if (docType === 'credit-card-statement') {
    const monthStr = month ? String(month).padStart(2, '0') : '01';
    return `${sourcePart}_CC_Statement_${year}-${monthStr}${ext}`;
  }

  // Default: {Source}_{Year}.ext
  return `${sourcePart}_${year}${ext}`;
}

/**
 * Extract file extension from filename
 */
export function getExtension(filename: string): string {
  const match = filename.match(/\.[^.]+$/);
  return match ? match[0] : '';
}

/**
 * Try to extract source/vendor from original filename
 */
export function extractSourceFromFilename(filename: string): string {
  // Remove extension
  const nameWithoutExt = filename.replace(/\.[^.]+$/, '');

  // Common patterns to extract source
  const patterns = [
    /^([A-Za-z_]+)[-_](?:Invoice|W-?2|1099|Receipt)/i,
    /^([A-Za-z_]+)\s+Invoice/i,
    /^([A-Za-z_]+)\s+(?:Form_)?W-?2/i,
    /from[-_]([A-Za-z_]+)/i,
  ];

  for (const pattern of patterns) {
    const match = nameWithoutExt.match(pattern);
    if (match) {
      return match[1].replace(/[_-]/g, ' ').trim();
    }
  }

  // Return empty if can't extract
  return '';
}
