// 1099-INT parser — uses Anthropic tool use for guaranteed structured output.

import type { Parsed1099INTSchema } from './schemas/index.js';
import type { DocumentParser } from './base.js';
import {
  readFileAsBase64,
  buildFileContent,
  callClaude,
  extractToolResult,
} from './base.js';

const SYSTEM_PROMPT = `You extract data from 1099-INT (Interest Income) tax forms. Extract ALL visible data using the extract_1099_int tool. All monetary values must be numbers. Omit fields that are blank or not present.`;

const INT_TOOL = {
  name: 'extract_1099_int',
  description: 'Extract structured data from a 1099-INT tax form',
  input_schema: {
    type: 'object' as const,
    properties: {
      payerName: { type: 'string', description: 'Company/institution name' },
      payerTin: { type: 'string', description: "Payer's TIN" },
      recipientName: { type: 'string', description: "Recipient's name" },
      recipientTin: { type: 'string', description: "Recipient's TIN" },
      accountNumber: { type: 'string', description: 'Account number' },
      interestIncome: { type: 'number', description: 'Box 1 - Interest income' },
      earlyWithdrawalPenalty: { type: 'number', description: 'Box 2 - Early withdrawal penalty' },
      interestOnSavingsBonds: { type: 'number', description: 'Box 3 - Interest on U.S. Savings Bonds and Treasury obligations' },
      federalWithheld: { type: 'number', description: 'Box 4 - Federal income tax withheld' },
      investmentExpenses: { type: 'number', description: 'Box 5 - Investment expenses' },
      foreignTaxPaid: { type: 'number', description: 'Box 6 - Foreign tax paid' },
      foreignCountry: { type: 'string', description: 'Box 7 - Foreign country or U.S. possession' },
      taxExemptInterest: { type: 'number', description: 'Box 8 - Tax-exempt interest' },
      privateActivityBondInterest: { type: 'number', description: 'Box 9 - Private activity bond interest' },
      marketDiscount: { type: 'number', description: 'Box 10 - Market discount' },
      bondPremium: { type: 'number', description: 'Box 11 - Bond premium' },
      bondPremiumTreasury: { type: 'number', description: 'Box 12 - Bond premium on Treasury obligations' },
      bondPremiumTaxExempt: { type: 'number', description: 'Box 13 - Bond premium on tax-exempt bond' },
      taxExemptCusip: { type: 'string', description: 'Box 14 - CUSIP no.' },
      stateTaxWithheld: { type: 'number', description: 'Box 15 - State tax withheld' },
      stateIncome: { type: 'number', description: 'Box 17 - State income' },
      taxYear: { type: 'number', description: 'The tax year' },
    },
    required: ['payerName'],
  },
};

export const int1099Parser: DocumentParser<Parsed1099INTSchema> = {
  type: '1099-int',
  version: 1,

  async parse(filePath: string, filename: string): Promise<Parsed1099INTSchema | null> {
    try {
      const fileData = await readFileAsBase64(filePath, filename);
      const fileContent = buildFileContent(fileData);

      console.log(`[1099-INT Parser] Parsing ${filename}`);

      const response = await callClaude({
        system: SYSTEM_PROMPT,
        userContent: [
          fileContent,
          { type: 'text', text: 'Extract all data from this 1099-INT form.' },
        ],
        maxTokens: 1024,
        tools: [INT_TOOL],
        toolChoice: { type: 'tool', name: 'extract_1099_int' },
      });

      const result = extractToolResult(response) as Record<string, unknown> | null;
      if (!result) {
        console.error('[1099-INT Parser] No tool result from Claude');
        return null;
      }

      return {
        ...result,
        _documentType: '1099-int',
        _parserVersion: 1,
        _parsedWith: '1099-int',
      } as Parsed1099INTSchema;
    } catch (error) {
      console.error('[1099-INT Parser] Error:', error);
      return null;
    }
  },
};
