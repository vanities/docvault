// Credit card statement parser — uses Anthropic tool use for guaranteed structured output.

import type { ParsedCreditCardSchema } from './schemas/index.js';
import type { DocumentParser } from './base.js';
import { readFileAsBase64, buildFileContent, callClaude, extractToolResult } from './base.js';
import { createLogger } from '../logger.js';

const log = createLogger('Credit Card');

const SYSTEM_PROMPT = `You extract data from credit card statements. Extract ALL visible data using the extract_credit_card_statement tool. All monetary values must be numbers. Dates should be YYYY-MM-DD format. Omit fields that are blank or not present.`;

const CREDIT_CARD_TOOL = {
  name: 'extract_credit_card_statement',
  description: 'Extract structured data from a credit card statement',
  input_schema: {
    type: 'object' as const,
    properties: {
      institution: { type: 'string', description: 'Card issuer (e.g., Chase, Capital One, Amex)' },
      accountNumber: { type: 'string', description: 'Masked card number' },
      newBalance: { type: 'number', description: 'Statement balance / new balance' },
      previousBalance: { type: 'number', description: 'Previous balance' },
      payments: { type: 'number', description: 'Payments made during period' },
      purchases: { type: 'number', description: 'Total purchases during period' },
      creditLimit: { type: 'number', description: 'Credit limit' },
      paymentDueDate: { type: 'string', description: 'Payment due date (YYYY-MM-DD)' },
      statementDate: { type: 'string', description: 'Statement date (YYYY-MM-DD)' },
      statementPeriod: {
        type: 'string',
        description: 'Statement period (e.g., 11/22/25 - 12/21/25)',
      },
    },
    required: ['institution', 'newBalance'],
  },
};

export const creditCardParser: DocumentParser<ParsedCreditCardSchema> = {
  type: 'credit-card-statement',
  version: 1,

  async parse(filePath: string, filename: string): Promise<ParsedCreditCardSchema | null> {
    try {
      const fileData = await readFileAsBase64(filePath, filename);
      const fileContent = buildFileContent(fileData);

      log.info(`Parsing ${filename}`);

      const response = await callClaude({
        system: SYSTEM_PROMPT,
        userContent: [
          fileContent,
          { type: 'text', text: 'Extract all data from this credit card statement.' },
        ],
        maxTokens: 1024,
        tools: [CREDIT_CARD_TOOL],
        toolChoice: { type: 'tool', name: 'extract_credit_card_statement' },
        purpose: 'parse-credit-card',
      });

      const result = extractToolResult(response) as Record<string, unknown> | null;
      if (!result) {
        log.error('No tool result from Claude');
        return null;
      }

      return {
        ...result,
        _documentType: 'credit-card-statement',
        _parserVersion: 1,
        _parsedWith: 'credit-card-statement',
      } as ParsedCreditCardSchema;
    } catch (error) {
      log.error('Error:', String(error));
      return null;
    }
  },
};
