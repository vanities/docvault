import { EXPENSE_FOLDER_MAP, getBusinessSubfolder, isBusinessDocumentType } from '../config';
import type { DocumentType, ExpenseCategory } from '../types';

export function getDocumentDirectory(
  docType: DocumentType,
  taxYear: number,
  fileName: string,
  expenseCategory?: ExpenseCategory
): string {
  if (isBusinessDocumentType(docType)) {
    const subfolder = getBusinessSubfolder(docType);
    return `business-docs/${subfolder}`;
  }

  let destPath = `${taxYear}`;

  if (docType === 'w2') {
    destPath += '/income/w2';
  } else if (docType === '1098') {
    destPath += '/expenses/1098';
  } else if (docType === 'retirement-statement') {
    destPath += '/retirement';
  } else if (docType === 'k-1') {
    destPath += '/income/k-1';
  } else if (docType.startsWith('1099')) {
    destPath += '/income/1099';
  } else if (docType === 'receipt' && expenseCategory) {
    destPath += '/' + EXPENSE_FOLDER_MAP[expenseCategory];
  } else if (docType === 'receipt') {
    destPath += '/expenses/business';
  } else if (docType === 'bank-statement') {
    destPath += '/statements/bank';
  } else if (docType === 'credit-card-statement') {
    destPath += '/statements/credit-card';
  } else if (docType === 'crypto') {
    destPath += '/crypto';
  } else if (docType === 'return') {
    if (fileName.includes('.tax')) {
      destPath += '/turbotax';
    } else {
      destPath += '/returns';
    }
  } else if (docType === 'medical-record') {
    destPath += '/expenses/medical';
  } else {
    destPath += '/income/other';
  }

  return destPath;
}

export function getDocumentPath(
  docType: DocumentType,
  taxYear: number,
  fileName: string,
  expenseCategory?: ExpenseCategory
): string {
  return `${getDocumentDirectory(docType, taxYear, fileName, expenseCategory)}/${fileName}`;
}
