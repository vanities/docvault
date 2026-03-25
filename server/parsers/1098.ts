// 1098 parser — Mortgage Interest Statement, Student Loan Interest (1098-E), etc.
// Uses Anthropic tool use for guaranteed structured output.

import type { Parsed1098Schema } from './schemas/index.js';
import type { DocumentParser } from './base.js';
import {
  readFileAsBase64,
  buildFileContent,
  callClaude,
  extractToolResult,
} from './base.js';

const SYSTEM_PROMPT = `You extract data from 1098 series tax forms (Mortgage Interest Statement, 1098-E Student Loan Interest, 1098-T Tuition). Extract ALL visible data using the extract_1098 tool. All monetary values must be numbers. Omit fields that are blank or not present.`;

const TOOL_1098 = {
  name: 'extract_1098',
  description: 'Extract structured data from a 1098 tax form',
  input_schema: {
    type: 'object' as const,
    properties: {
      lender: { type: 'string', description: 'Lending institution / servicer name' },
      lenderTin: { type: 'string', description: "Lender's TIN" },
      loanNumber: { type: 'string', description: 'Loan/account number' },
      borrowerName: { type: 'string', description: "Borrower's name" },
      borrowerTin: { type: 'string', description: "Borrower's TIN" },
      borrowerAddress: { type: 'string', description: "Borrower's address" },
      mortgageInterest: { type: 'number', description: 'Box 1 - Mortgage interest received from borrower' },
      outstandingPrincipal: { type: 'number', description: 'Box 2 - Outstanding mortgage principal' },
      mortgageOriginationDate: { type: 'string', description: 'Box 3 - Mortgage origination date' },
      refundOfOverpaidInterest: { type: 'number', description: 'Box 4 - Refund of overpaid interest' },
      mortgageInsurancePremiums: { type: 'number', description: 'Box 5 - Mortgage insurance premiums' },
      pointsPaid: { type: 'number', description: 'Box 6 - Points paid on purchase' },
      propertyAddress: { type: 'string', description: 'Box 7 - Address of property securing mortgage' },
      propertyTax: { type: 'number', description: 'Box 10 - Property tax' },
      // 1098-E fields
      studentLoanInterest: { type: 'number', description: '1098-E Box 1 - Student loan interest received' },
      // 1098-T fields
      tuitionPayments: { type: 'number', description: '1098-T Box 1 - Payments received for qualified tuition' },
      scholarshipsGrants: { type: 'number', description: '1098-T Box 5 - Scholarships or grants' },
      formVariant: { type: 'string', description: 'Form type: 1098, 1098-E, or 1098-T' },
      taxYear: { type: 'number', description: 'The tax year' },
    },
    required: ['lender'],
  },
};

export const parser1098: DocumentParser<Parsed1098Schema> = {
  type: '1098',
  version: 1,

  async parse(filePath: string, filename: string): Promise<Parsed1098Schema | null> {
    try {
      const fileData = await readFileAsBase64(filePath, filename);
      const fileContent = buildFileContent(fileData);

      console.log(`[1098 Parser] Parsing ${filename}`);

      const response = await callClaude({
        system: SYSTEM_PROMPT,
        userContent: [
          fileContent,
          { type: 'text', text: 'Extract all data from this 1098 form.' },
        ],
        maxTokens: 1024,
        tools: [TOOL_1098],
        toolChoice: { type: 'tool', name: 'extract_1098' },
      });

      const result = extractToolResult(response) as Record<string, unknown> | null;
      if (!result) {
        console.error('[1098 Parser] No tool result from Claude');
        return null;
      }

      return {
        ...result,
        _documentType: '1098',
        _parserVersion: 1,
        _parsedWith: '1098',
      } as Parsed1098Schema;
    } catch (error) {
      console.error('[1098 Parser] Error:', error);
      return null;
    }
  },
};
