import type { DocumentType, ExpenseCategory } from '../types';

// Detect document type from filename and optional file path
export function detectDocumentType(filename: string, filePath?: string): DocumentType {
  const lower = filename.toLowerCase();
  const pathLower = filePath?.toLowerCase() || '';

  // Business document detection (check path for business-docs folder)
  if (pathLower.includes('business-docs/')) {
    if (
      /formation|articles.*incorporation|operating.*agreement|certificate.*formation/i.test(lower)
    )
      return 'formation';
    if (/ein|employer.*identification/i.test(lower)) return 'ein-letter';
    if (/license|permit|registration/i.test(lower)) return 'license';
    if (/contract|agreement|nda|w-?9/i.test(lower)) return 'business-agreement';
  }

  // Tax document detection
  if (/w-?2/i.test(lower)) return 'w2';
  if (/1099-?nec/i.test(lower)) return '1099-nec';
  if (/1099-?misc/i.test(lower)) return '1099-misc';
  if (/1099-?r/i.test(lower)) return '1099-r';
  if (/1099-?div/i.test(lower)) return '1099-div';
  if (/1099-?int/i.test(lower)) return '1099-int';
  if (/1099-?b/i.test(lower)) return '1099-b';
  if (/1099/i.test(lower)) return '1099-nec';
  if (/receipt|expense|purchase/i.test(lower)) return 'receipt';
  if (/invoice/i.test(lower)) return 'invoice';
  if (/koinly|coinbase|kraken|crypto|8949/i.test(lower)) return 'crypto';
  if (/\.tax\d{4}$|return|final/i.test(lower)) return 'return';
  if (/contract|agreement|w-?9|nda/i.test(lower)) return 'contract';

  // Business document detection by filename (for uploads)
  if (/formation|articles.*incorporation|certificate.*formation/i.test(lower)) return 'formation';
  if (/operating.?agreement/i.test(lower)) return 'operating-agreement';
  if (/ein|employer.*identification/i.test(lower)) return 'ein-letter';
  if (/license|permit|registration/i.test(lower)) return 'license';
  if (/insurance.?polic/i.test(lower)) return 'insurance-policy';

  // General document types
  if (/bank.?statement/i.test(lower)) return 'bank-statement';
  if (/credit.?card.?statement/i.test(lower)) return 'credit-card-statement';
  if (/statement/i.test(lower)) return 'statement';
  if (/medical.?record/i.test(lower)) return 'medical-record';
  if (/appraisal|assessment/i.test(lower)) return 'appraisal';
  if (/certificate|cert\b/i.test(lower)) return 'certificate';

  // Detect expenses from filename keywords or expenses folder path
  if (
    /software|equipment|meals|childcare|medical|travel|office|utility|subscription/i.test(lower) ||
    pathLower.includes('/expenses/')
  )
    return 'receipt';

  return 'other';
}

// Detect expense category from path/filename
export function detectExpenseCategory(path: string): ExpenseCategory | undefined {
  const lower = path.toLowerCase();

  if (lower.includes('childcare')) return 'childcare';
  if (lower.includes('medical')) return 'medical';
  if (lower.includes('meal') || lower.includes('food') || lower.includes('restaurant'))
    return 'meals';
  if (lower.includes('software') || lower.includes('subscription')) return 'software';
  if (lower.includes('equipment') || lower.includes('hardware')) return 'equipment';
  if (lower.includes('travel') || lower.includes('flight') || lower.includes('hotel'))
    return 'travel';

  return undefined;
}
