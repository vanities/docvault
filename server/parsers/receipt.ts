// Receipt/expense parser — uses Anthropic tool use for guaranteed structured output.
// Handles single receipts and multi-transaction payment histories (Venmo, PayPal, etc.)

import type { ParsedReceiptSchema } from './schemas/index.js';
import type { DocumentParser } from './base.js';
import { readFileAsBase64, buildFileContent, callClaude, extractToolResult } from './base.js';

const SYSTEM_PROMPT = `You extract data from receipts and expense documents. Extract ALL visible data using the extract_receipt tool. All monetary values must be numbers. Dates should be YYYY-MM-DD format.

For single receipts: extract the vendor, total amount, date, and line items if visible.
For payment histories (Venmo, PayPal, bank payment lists): extract each individual transaction with its date, description, and amount. Always calculate totalAmount as the sum of all transaction amounts.

Category should be one of: meals, software, equipment, childcare, medical, travel, office-supplies, professional-services, utilities, insurance, taxes-licenses, education, home-improvement, feed, other`;

const RECEIPT_TOOL = {
  name: 'extract_receipt',
  description: 'Extract structured data from a receipt or expense document',
  input_schema: {
    type: 'object' as const,
    properties: {
      vendor: { type: 'string', description: 'Store/business/payee name' },
      vendorAddress: { type: 'string', description: 'Full address if shown' },
      amount: { type: 'number', description: 'Total amount paid (for single receipts)' },
      subtotal: { type: 'number', description: 'Subtotal before tax' },
      tax: { type: 'number', description: 'Tax amount' },
      date: { type: 'string', description: 'Date of purchase (YYYY-MM-DD)' },
      paymentMethod: { type: 'string', description: 'Cash, credit card, etc.' },
      lastFourCard: { type: 'string', description: 'Last 4 digits of card' },
      items: {
        type: 'array',
        description: 'Line items',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string' },
            quantity: { type: 'number' },
            price: { type: 'number' },
          },
          required: ['description', 'price'],
        },
      },
      category: { type: 'string', description: 'Expense category' },
      transactions: {
        type: 'array',
        description: 'For payment histories: individual transactions',
        items: {
          type: 'object',
          properties: {
            amount: { type: 'number' },
            date: { type: 'string', description: 'YYYY-MM-DD' },
            description: { type: 'string' },
          },
          required: ['amount', 'date', 'description'],
        },
      },
      totalAmount: {
        type: 'number',
        description: 'Sum of all transaction amounts (for payment histories)',
      },
      transactionCount: { type: 'number', description: 'Number of transactions' },
      startDate: { type: 'string', description: 'Earliest transaction date' },
      endDate: { type: 'string', description: 'Latest transaction date' },
    },
    required: ['vendor'],
  },
};

export const receiptParser: DocumentParser<ParsedReceiptSchema> = {
  type: 'receipt',
  version: 1,

  async parse(filePath: string, filename: string): Promise<ParsedReceiptSchema | null> {
    try {
      const fileData = await readFileAsBase64(filePath, filename);
      const fileContent = buildFileContent(fileData);

      console.log(`[Receipt Parser] Parsing ${filename}`);

      const response = await callClaude({
        system: SYSTEM_PROMPT,
        userContent: [
          fileContent,
          { type: 'text', text: 'Extract all data from this receipt or expense document.' },
        ],
        maxTokens: 4096,
        tools: [RECEIPT_TOOL],
        toolChoice: { type: 'tool', name: 'extract_receipt' },
      });

      const result = extractToolResult(response) as Record<string, unknown> | null;
      if (!result) {
        console.error('[Receipt Parser] No tool result from Claude');
        return null;
      }

      return {
        ...result,
        _documentType: 'receipt',
        _parserVersion: 1,
        _parsedWith: 'receipt',
      } as ParsedReceiptSchema;
    } catch (error) {
      console.error('[Receipt Parser] Error:', error);
      return null;
    }
  },
};
