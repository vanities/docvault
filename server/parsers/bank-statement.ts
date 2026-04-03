// Bank statement parser — uses Anthropic tool use with bank-specific prompt hints.
// The key value: the tool schema guarantees `deposits` is ALWAYS the field name,
// eliminating the 5-way branching in financial-snapshot (deposits vs depositsAndAdditions
// vs transactions vs totalDeposits vs totalDepositsAndAdditions).

import type { ParsedBankStatementSchema } from './schemas/index.js';
import type { DocumentParser, ValidationResult } from './base.js';
import { readFileAsBase64, buildFileContent, callClaude, extractToolResult } from './base.js';
import { createLogger } from '../logger.js';

const log = createLogger('Bank Statement');

// Bank-specific prompt hints improve extraction accuracy for known layouts
const BANK_HINTS: Record<string, string> = {
  chase: `Chase Business statements use "DEPOSITS AND ADDITIONS" and "CHECKS AND OTHER WITHDRAWALS" sections. ACH deposits show "Orig CO Name:" prefix identifying the payer. Electronic deposits may show "Online Transfer From" for owner transfers.`,
  'navy-federal': `Navy Federal Credit Union statements list deposits as "Credits" and withdrawals as "Debits". Transfers between accounts show "TRANSFER" in the description.`,
  amex: `American Express statements show charges, payments, and credits. "Payment Received" entries are typically owner payments. Focus on extracting charges as withdrawals and payments as deposits.`,
  'wells-fargo': `Wells Fargo statements use "Deposits/Credits" and "Withdrawals/Debits" sections.`,
  'bank-of-america': `Bank of America statements use "Deposits and Other Credits" and "Withdrawals and Other Debits" sections.`,
};

// Detect bank from filename
function detectBank(filename: string): string | null {
  const lower = filename.toLowerCase();
  if (/chase/i.test(lower)) return 'chase';
  if (/navy.?federal|nfcu/i.test(lower)) return 'navy-federal';
  if (/amex|american.?express/i.test(lower)) return 'amex';
  if (/wells.?fargo/i.test(lower)) return 'wells-fargo';
  if (/bank.?of.?america|boa\b/i.test(lower)) return 'bank-of-america';
  return null;
}

function buildSystemPrompt(bank: string | null): string {
  let prompt = `You extract data from bank statements. Extract ALL visible data using the extract_bank_statement tool. All monetary values must be numbers. Dates should be YYYY-MM-DD format.

Extract EVERY individual deposit and withdrawal transaction listed on the statement. Each transaction should include the date, description, and amount. The totalDeposits should equal the sum of all deposit amounts, and totalWithdrawals should equal the sum of all withdrawal amounts.`;

  if (bank && BANK_HINTS[bank]) {
    prompt += `\n\nThis is a ${bank.replace(/-/g, ' ')} statement. ${BANK_HINTS[bank]}`;
  }

  return prompt;
}

const BANK_STATEMENT_TOOL = {
  name: 'extract_bank_statement',
  description: 'Extract structured data from a bank statement',
  input_schema: {
    type: 'object' as const,
    properties: {
      bankName: { type: 'string', description: 'Bank/institution name' },
      accountType: {
        type: 'string',
        description: 'Account type (e.g., Business Checking, Savings)',
      },
      accountNumberLast4: { type: 'string', description: 'Last 4 digits of account number' },
      statementPeriod: {
        type: 'object',
        description: 'Statement period',
        properties: {
          start: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
          end: { type: 'string', description: 'End date (YYYY-MM-DD)' },
        },
        required: ['start', 'end'],
      },
      beginningBalance: { type: 'number', description: 'Opening balance' },
      endingBalance: { type: 'number', description: 'Closing balance' },
      totalDeposits: { type: 'number', description: 'Total deposits/credits for the period' },
      totalWithdrawals: { type: 'number', description: 'Total withdrawals/debits for the period' },
      deposits: {
        type: 'array',
        description: 'All deposit/credit transactions',
        items: {
          type: 'object',
          properties: {
            date: { type: 'string', description: 'Transaction date (YYYY-MM-DD)' },
            description: { type: 'string', description: 'Transaction description' },
            amount: { type: 'number', description: 'Deposit amount (positive number)' },
          },
          required: ['date', 'description', 'amount'],
        },
      },
      withdrawals: {
        type: 'array',
        description: 'All withdrawal/debit transactions',
        items: {
          type: 'object',
          properties: {
            date: { type: 'string', description: 'Transaction date (YYYY-MM-DD)' },
            description: { type: 'string', description: 'Transaction description' },
            amount: { type: 'number', description: 'Withdrawal amount (positive number)' },
          },
          required: ['date', 'description', 'amount'],
        },
      },
    },
    required: ['bankName', 'totalDeposits'],
  },
};

export const bankStatementParser: DocumentParser<ParsedBankStatementSchema> = {
  type: 'bank-statement',
  version: 1,

  async parse(filePath: string, filename: string): Promise<ParsedBankStatementSchema | null> {
    try {
      const fileData = await readFileAsBase64(filePath, filename);
      const fileContent = buildFileContent(fileData);

      // Detect bank for prompt hints
      const bank = detectBank(filename);
      const systemPrompt = buildSystemPrompt(bank);

      log.info(`Parsing ${filename} (bank: ${bank || 'unknown'})`);

      const response = await callClaude({
        system: systemPrompt,
        userContent: [
          fileContent,
          {
            type: 'text',
            text: 'Extract all data from this bank statement, including every transaction.',
          },
        ],
        maxTokens: 8192, // Bank statements can have many transactions
        tools: [BANK_STATEMENT_TOOL],
        toolChoice: { type: 'tool', name: 'extract_bank_statement' },
      });

      const result = extractToolResult(response) as Record<string, unknown> | null;
      if (!result) {
        log.error('No tool result from Claude');
        return null;
      }

      log.info(
        `Extracted: ${(result.deposits as unknown[])?.length || 0} deposits, ` +
          `${(result.withdrawals as unknown[])?.length || 0} withdrawals`
      );

      return {
        ...result,
        _documentType: 'bank-statement',
        _parserVersion: 1,
        _parsedWith: 'bank-statement',
      } as ParsedBankStatementSchema;
    } catch (error) {
      log.error('Error:', String(error));
      return null;
    }
  },

  validate(result: ParsedBankStatementSchema): ValidationResult {
    const warnings: string[] = [];

    // Verify balance equation: beginning + deposits - withdrawals ≈ ending
    if (
      result.beginningBalance !== undefined &&
      result.endingBalance !== undefined &&
      result.totalDeposits !== undefined &&
      result.totalWithdrawals !== undefined
    ) {
      const expected = result.beginningBalance + result.totalDeposits - result.totalWithdrawals;
      const diff = Math.abs(expected - result.endingBalance);
      if (diff > 1) {
        warnings.push(
          `Balance mismatch: ${result.beginningBalance} + ${result.totalDeposits} - ${result.totalWithdrawals} = ${expected.toFixed(2)}, but ending balance is ${result.endingBalance} (diff: $${diff.toFixed(2)})`
        );
      }
    }

    // Verify deposit array sum matches totalDeposits
    if (Array.isArray(result.deposits) && result.totalDeposits !== undefined) {
      const arraySum = result.deposits.reduce((s, d) => s + (d.amount || 0), 0);
      const diff = Math.abs(arraySum - result.totalDeposits);
      if (diff > 1) {
        warnings.push(
          `Deposit array sum ${arraySum.toFixed(2)} differs from totalDeposits ${result.totalDeposits} (diff: $${diff.toFixed(2)})`
        );
      }
    }

    return { valid: warnings.length === 0, warnings };
  },
};
