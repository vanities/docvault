// Expense aggregation — builds ExpenseSummary from parsed documents for an entity/year.

import type { ExpenseItem, ParsedData, DocumentMetadata } from './types.js';
import type { FileInfo } from './income.js';
import { extractExpense } from './extractors.js';

export interface ExpenseCategoryConfig {
  deductionRate: number;
  scheduleCLine?: string;
}

// Default expense category config — deduction rates and Schedule C lines
// Matches src/config.ts EXPENSE_CATEGORIES
const EXPENSE_CATEGORIES: Record<string, ExpenseCategoryConfig> = {
  meals: { deductionRate: 0.5, scheduleCLine: 'Line 24b' },
  software: { deductionRate: 1.0, scheduleCLine: 'Line 18' },
  equipment: { deductionRate: 1.0, scheduleCLine: 'Line 13' },
  'office-supplies': { deductionRate: 1.0, scheduleCLine: 'Line 18' },
  'professional-services': { deductionRate: 1.0, scheduleCLine: 'Line 17' },
  travel: { deductionRate: 1.0, scheduleCLine: 'Line 24a' },
  utilities: { deductionRate: 1.0, scheduleCLine: 'Line 25' },
  insurance: { deductionRate: 1.0, scheduleCLine: 'Line 15' },
  'taxes-licenses': { deductionRate: 1.0, scheduleCLine: 'Line 23' },
  childcare: { deductionRate: 1.0 },
  medical: { deductionRate: 1.0 },
  education: { deductionRate: 1.0 },
  'home-improvement': { deductionRate: 0 },
  feed: { deductionRate: 1.0, scheduleCLine: 'Line 22' },
  other: { deductionRate: 1.0, scheduleCLine: 'Line 27a' },
};

export interface ExpenseSummaryItem {
  category: string;
  total: number;
  deductibleAmount: number;
  count: number;
}

export interface ExpenseSummaryResult {
  items: ExpenseSummaryItem[];
  totalExpenses: number;
  totalDeductible: number;
  expenses: ExpenseItem[]; // raw items for detailed display
}

export function getExpenseSummary(
  entityId: string,
  _year: string,
  parsedDataMap: Record<string, ParsedData>,
  metadataMap: Record<string, DocumentMetadata>,
  files: FileInfo[]
): ExpenseSummaryResult {
  const expenses: ExpenseItem[] = [];

  for (const file of files) {
    const parsedKey = `${entityId}/${file.path}`;
    const parsed = parsedDataMap[parsedKey];
    const meta = metadataMap[parsedKey];
    if (meta?.tracked === false) continue;
    if (!parsed) continue;

    const expense = extractExpense(parsed, file.name);
    if (expense) {
      // Try to infer category from file path if not set
      if (!expense.category || expense.category === 'other') {
        const pathCategory = inferCategoryFromPath(file.path);
        if (pathCategory) expense.category = pathCategory;
      }
      expenses.push({ ...expense, filePath: file.path });
    }
  }

  // Group by category
  const byCategory: Record<string, { total: number; count: number }> = {};
  for (const exp of expenses) {
    const cat = exp.category || 'other';
    if (!byCategory[cat]) byCategory[cat] = { total: 0, count: 0 };
    byCategory[cat].total += exp.amount;
    byCategory[cat].count++;
  }

  const items: ExpenseSummaryItem[] = Object.entries(byCategory)
    .map(([category, { total, count }]) => {
      const config = EXPENSE_CATEGORIES[category] || EXPENSE_CATEGORIES.other;
      return {
        category,
        total,
        deductibleAmount: total * config.deductionRate,
        count,
      };
    })
    .filter((item) => item.total > 0)
    .sort((a, b) => b.total - a.total);

  const totalExpenses = items.reduce((s, i) => s + i.total, 0);
  const totalDeductible = items.reduce((s, i) => s + i.deductibleAmount, 0);

  return { items, totalExpenses, totalDeductible, expenses };
}

// Infer expense category from the file path structure
// e.g., "2025/expenses/meals/file.pdf" → "meals"
function inferCategoryFromPath(filePath: string): string | null {
  const parts = filePath.split('/');
  const expIdx = parts.indexOf('expenses');
  if (expIdx >= 0 && expIdx < parts.length - 1) {
    const candidate = parts[expIdx + 1];
    if (EXPENSE_CATEGORIES[candidate]) return candidate;
    // Check for subfolder names that map to categories
    if (candidate === 'business') return null; // "business" is not a category
    if (candidate === '1098') return null; // 1098 is a form, not a category
  }
  return null;
}
