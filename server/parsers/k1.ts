// Schedule K-1 parser — uses Anthropic tool use for guaranteed structured output.
// Handles K-1s from partnerships (1065), S-corps (1120-S), and trusts (1041).

import type { ParsedK1Schema } from './schemas/index.js';
import type { DocumentParser } from './base.js';
import {
  readFileAsBase64,
  buildFileContent,
  callClaude,
  extractToolResult,
} from './base.js';

const SYSTEM_PROMPT = `You extract data from Schedule K-1 tax forms. These come from partnerships (Form 1065), S-corporations (Form 1120-S), or trusts/estates (Form 1041). Extract ALL visible data using the extract_k1 tool. All monetary values must be numbers. Losses should be negative numbers. Omit fields that are blank or not present.

Pay special attention to:
- formType: Determine from the form header (1065 = partnership, 1120-S = s-corp, 1041 = trust)
- Box 1 (ordinaryIncome): This is the most important field for SE tax
- Box 14 (selfEmploymentEarnings): Critical for self-employment tax calculation
- Box 19 (distributions): Not the same as income — this is cash taken out`;

const K1_TOOL = {
  name: 'extract_k1',
  description: 'Extract structured data from a Schedule K-1 tax form',
  input_schema: {
    type: 'object' as const,
    properties: {
      entityName: { type: 'string', description: 'Partnership/S-Corp/Trust name' },
      entityEin: { type: 'string', description: 'Entity EIN (XX-XXXXXXX)' },
      formType: { type: 'string', enum: ['partnership', 's-corp', 'trust'], description: 'Form type (1065=partnership, 1120-S=s-corp, 1041=trust)' },
      partnerName: { type: 'string', description: 'Partner/shareholder/beneficiary name' },
      partnerTin: { type: 'string', description: "Partner's TIN" },
      partnerAddress: { type: 'string', description: "Partner's address" },
      ordinaryIncome: { type: 'number', description: 'Box 1 - Ordinary business income (loss)' },
      rentalIncome: { type: 'number', description: 'Box 2 - Net rental real estate income (loss)' },
      otherRentalIncome: { type: 'number', description: 'Box 3 - Other net rental income (loss)' },
      guaranteedPayments: { type: 'number', description: 'Box 4 - Guaranteed payments' },
      interestIncome: { type: 'number', description: 'Box 5 - Interest income' },
      dividends: { type: 'number', description: 'Box 6 - Ordinary dividends' },
      royalties: { type: 'number', description: 'Box 7 - Royalties' },
      shortTermCapitalGain: { type: 'number', description: 'Box 8 - Net short-term capital gain (loss)' },
      longTermCapitalGain: { type: 'number', description: 'Box 9a - Net long-term capital gain (loss)' },
      section1231Gain: { type: 'number', description: 'Box 10 - Net section 1231 gain (loss)' },
      otherIncome: { type: 'number', description: 'Box 11 - Other income (loss)' },
      section179Deduction: { type: 'number', description: 'Box 12 - Section 179 deduction' },
      otherDeductions: { type: 'number', description: 'Box 13 - Other deductions' },
      selfEmploymentEarnings: { type: 'number', description: 'Box 14 - Self-employment earnings (loss)' },
      credits: { type: 'number', description: 'Box 15 - Credits' },
      foreignTransactions: { type: 'number', description: 'Box 16 - Foreign transactions' },
      altMinTaxItems: { type: 'number', description: 'Box 17 - AMT items' },
      taxExemptIncome: { type: 'number', description: 'Box 18 - Tax-exempt income' },
      distributions: { type: 'number', description: 'Box 19 - Distributions' },
      otherInfo: { type: 'string', description: 'Box 20 - Other information' },
      taxYear: { type: 'number', description: 'The tax year' },
    },
    required: ['entityName'],
  },
};

export const k1Parser: DocumentParser<ParsedK1Schema> = {
  type: 'k-1',
  version: 1,

  async parse(filePath: string, filename: string): Promise<ParsedK1Schema | null> {
    try {
      const fileData = await readFileAsBase64(filePath, filename);
      const fileContent = buildFileContent(fileData);

      console.log(`[K-1 Parser] Parsing ${filename}`);

      const response = await callClaude({
        system: SYSTEM_PROMPT,
        userContent: [
          fileContent,
          { type: 'text', text: 'Extract all data from this Schedule K-1 form.' },
        ],
        maxTokens: 2048,
        tools: [K1_TOOL],
        toolChoice: { type: 'tool', name: 'extract_k1' },
      });

      const result = extractToolResult(response) as Record<string, unknown> | null;
      if (!result) {
        console.error('[K-1 Parser] No tool result from Claude');
        return null;
      }

      return {
        ...result,
        _documentType: 'k-1',
        _parserVersion: 1,
        _parsedWith: 'k-1',
      } as ParsedK1Schema;
    } catch (error) {
      console.error('[K-1 Parser] Error:', error);
      return null;
    }
  },
};
