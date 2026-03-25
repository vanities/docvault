// Analytics module — single source of truth for all data aggregation.
// Re-exports all analytics functions and types.

export * from './types.js';
export * from './extractors.js';
export { getIncomeSummary } from './income.js';
export type { IncomeSummaryResult, FileInfo } from './income.js';
export { getExpenseSummary } from './expenses.js';
export type { ExpenseSummaryResult, ExpenseSummaryItem } from './expenses.js';
export { getBankDepositSummary } from './bank-deposits.js';
export type { BankDepositSummaryResult } from './bank-deposits.js';
export { getTaxCalculation } from './tax-calc.js';
