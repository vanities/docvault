// Invoice parser — uses Anthropic tool use for guaranteed structured output.
// Invoices are income documents (money owed TO the business), not expenses.
// Distinct from receipts (money paid BY the business).

import type { DocumentParser } from './base.js';
import {
  readFileAsBase64,
  buildFileContent,
  callClaude,
  extractToolResult,
} from './base.js';

const SYSTEM_PROMPT = `You extract data from invoices. An invoice is a document sent TO a client/customer requesting payment for services rendered or goods delivered. This is NOT a receipt (which records a payment made).

Extract ALL visible data using the extract_invoice tool. All monetary values must be numbers. Dates should be YYYY-MM-DD format. Omit fields that are blank or not present.

For consulting/freelance invoices: the vendor/sender is the service provider (the business sending the invoice), and the customer/billTo is who is being billed.`;

const INVOICE_TOOL = {
  name: 'extract_invoice',
  description: 'Extract structured data from an invoice',
  input_schema: {
    type: 'object' as const,
    properties: {
      // Who sent the invoice (the business)
      vendor: { type: 'string', description: 'Business/person who issued the invoice (sender)' },
      vendorAddress: { type: 'string', description: "Vendor's address" },
      vendorTin: { type: 'string', description: "Vendor's TIN/EIN" },
      // Who is being billed
      customer: { type: 'string', description: 'Client/customer being billed (billTo)' },
      customerAddress: { type: 'string', description: "Customer's address" },
      // Invoice details
      invoiceNumber: { type: 'string', description: 'Invoice number/ID' },
      invoiceDate: { type: 'string', description: 'Invoice date (YYYY-MM-DD)' },
      dueDate: { type: 'string', description: 'Payment due date (YYYY-MM-DD)' },
      // Line items
      lineItems: {
        type: 'array',
        description: 'Line items on the invoice',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string', description: 'Service/item description' },
            quantity: { type: 'number', description: 'Quantity or hours' },
            rate: { type: 'number', description: 'Rate per unit/hour' },
            amount: { type: 'number', description: 'Line total' },
          },
          required: ['description', 'amount'],
        },
      },
      // Totals
      subtotal: { type: 'number', description: 'Subtotal before tax' },
      tax: { type: 'number', description: 'Tax amount' },
      invoiceTotal: { type: 'number', description: 'Total amount due' },
      amountPaid: { type: 'number', description: 'Amount already paid' },
      balanceDue: { type: 'number', description: 'Remaining balance' },
      // Period
      periodStart: { type: 'string', description: 'Service period start (YYYY-MM-DD)' },
      periodEnd: { type: 'string', description: 'Service period end (YYYY-MM-DD)' },
      // Payment info
      paymentTerms: { type: 'string', description: 'Payment terms (e.g., Net 30)' },
      paymentMethod: { type: 'string', description: 'Preferred payment method' },
    },
    required: ['invoiceTotal'],
  },
};

export interface ParsedInvoiceSchema {
  _documentType: 'invoice';
  _parserVersion: number;
  _parsedWith: string;
  vendor?: string;
  vendorAddress?: string;
  vendorTin?: string;
  customer?: string;
  customerAddress?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  dueDate?: string;
  lineItems?: Array<{ description: string; quantity?: number; rate?: number; amount: number }>;
  subtotal?: number;
  tax?: number;
  invoiceTotal?: number;
  amountPaid?: number;
  balanceDue?: number;
  periodStart?: string;
  periodEnd?: string;
  paymentTerms?: string;
  paymentMethod?: string;
}

export const invoiceParser: DocumentParser<ParsedInvoiceSchema> = {
  type: 'invoice',
  version: 1,

  async parse(filePath: string, filename: string): Promise<ParsedInvoiceSchema | null> {
    try {
      const fileData = await readFileAsBase64(filePath, filename);
      const fileContent = buildFileContent(fileData);

      console.log(`[Invoice Parser] Parsing ${filename}`);

      const response = await callClaude({
        system: SYSTEM_PROMPT,
        userContent: [
          fileContent,
          { type: 'text', text: 'Extract all data from this invoice.' },
        ],
        maxTokens: 2048,
        tools: [INVOICE_TOOL],
        toolChoice: { type: 'tool', name: 'extract_invoice' },
      });

      const result = extractToolResult(response) as Record<string, unknown> | null;
      if (!result) {
        console.error('[Invoice Parser] No tool result from Claude');
        return null;
      }

      return {
        ...result,
        _documentType: 'invoice',
        _parserVersion: 1,
        _parsedWith: 'invoice',
      } as ParsedInvoiceSchema;
    } catch (error) {
      console.error('[Invoice Parser] Error:', error);
      return null;
    }
  },
};
