import type { TaxDocument, Entity } from '../types';
import type { FileInfo } from '../hooks/useFileSystemServer';
import { detectDocumentType, detectExpenseCategory } from './documentDetection';

/**
 * Convert a FileInfo from the server into a TaxDocument.
 *
 * @param file - The file info from the API (may include parsedData, tags, notes)
 * @param entity - The entity this file belongs to
 * @param taxYear - The tax year (0 for business docs / all-files views)
 */
export function mapFileToDocument(
  file: FileInfo & { parsedData?: Record<string, unknown> },
  entity: Entity,
  taxYear: number
): TaxDocument {
  const docType = detectDocumentType(file.name, file.path);
  const expenseCategory = detectExpenseCategory(file.path);

  const doc: TaxDocument = {
    id: `${entity}/${file.path}-${file.lastModified}`,
    fileName: file.name,
    fileType: file.type,
    fileSize: file.size,
    filePath: file.path,
    type: docType,
    entity,
    taxYear,
    tags: file.tags || [],
    notes: file.notes || '',
    createdAt: new Date(file.lastModified).toISOString(),
    updatedAt: new Date(file.lastModified).toISOString(),
    parsedData: file.parsedData as TaxDocument['parsedData'],
  };

  // Add parsed data for receipts with detected category if not already parsed
  if (!doc.parsedData && docType === 'receipt' && expenseCategory) {
    doc.parsedData = {
      vendor: '',
      amount: 0,
      date: new Date(file.lastModified).toISOString().split('T')[0],
      category: expenseCategory,
    };
  }

  return doc;
}
