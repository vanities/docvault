// 1099-DIV parser — uses Anthropic tool use for guaranteed structured output.

import type { Parsed1099DIVSchema } from './schemas/index.js';
import type { DocumentParser } from './base.js';
import { readFileAsBase64, buildFileContent, callClaude, extractToolResult } from './base.js';

const SYSTEM_PROMPT = `You extract data from 1099-DIV (Dividends and Distributions) tax forms. Extract ALL visible data using the extract_1099_div tool. All monetary values must be numbers. Omit fields that are blank or not present.`;

const DIV_TOOL = {
  name: 'extract_1099_div',
  description: 'Extract structured data from a 1099-DIV tax form',
  input_schema: {
    type: 'object' as const,
    properties: {
      payerName: { type: 'string', description: 'Company/institution name' },
      payerTin: { type: 'string', description: "Payer's TIN" },
      recipientName: { type: 'string', description: "Recipient's name" },
      recipientTin: { type: 'string', description: "Recipient's TIN" },
      accountNumber: { type: 'string', description: 'Account number' },
      ordinaryDividends: { type: 'number', description: 'Box 1a - Total ordinary dividends' },
      qualifiedDividends: { type: 'number', description: 'Box 1b - Qualified dividends' },
      capitalGainDistributions: {
        type: 'number',
        description: 'Box 2a - Total capital gain distributions',
      },
      unrecaptured1250Gain: { type: 'number', description: 'Box 2b - Unrecap. Sec. 1250 gain' },
      section1202Gain: { type: 'number', description: 'Box 2c - Section 1202 gain' },
      collectiblesGain: { type: 'number', description: 'Box 2d - Collectibles (28%) gain' },
      section897Dividends: {
        type: 'number',
        description: 'Box 2e - Section 897 ordinary dividends',
      },
      section897CapitalGain: { type: 'number', description: 'Box 2f - Section 897 capital gain' },
      nondividendDistributions: {
        type: 'number',
        description: 'Box 3 - Nondividend distributions',
      },
      federalWithheld: { type: 'number', description: 'Box 4 - Federal income tax withheld' },
      section199ADividends: { type: 'number', description: 'Box 5 - Section 199A dividends' },
      investmentExpenses: { type: 'number', description: 'Box 6 - Investment expenses' },
      foreignTaxPaid: { type: 'number', description: 'Box 7 - Foreign tax paid' },
      foreignCountry: { type: 'string', description: 'Box 8 - Foreign country or U.S. possession' },
      cashLiquidation: { type: 'number', description: 'Box 9 - Cash liquidation distributions' },
      noncashLiquidation: {
        type: 'number',
        description: 'Box 10 - Noncash liquidation distributions',
      },
      exemptInterestDividends: {
        type: 'number',
        description: 'Box 12 - Exempt-interest dividends',
      },
      privateActivityBondDividends: {
        type: 'number',
        description: 'Box 13 - Private activity bond interest dividends',
      },
      stateTaxWithheld: { type: 'number', description: 'Box 14 - State tax withheld' },
      stateIncome: { type: 'number', description: 'Box 16 - State income' },
      taxYear: { type: 'number', description: 'The tax year' },
    },
    required: ['payerName'],
  },
};

export const div1099Parser: DocumentParser<Parsed1099DIVSchema> = {
  type: '1099-div',
  version: 1,

  async parse(filePath: string, filename: string): Promise<Parsed1099DIVSchema | null> {
    try {
      const fileData = await readFileAsBase64(filePath, filename);
      const fileContent = buildFileContent(fileData);

      console.log(`[1099-DIV Parser] Parsing ${filename}`);

      const response = await callClaude({
        system: SYSTEM_PROMPT,
        userContent: [
          fileContent,
          { type: 'text', text: 'Extract all data from this 1099-DIV form.' },
        ],
        maxTokens: 1024,
        tools: [DIV_TOOL],
        toolChoice: { type: 'tool', name: 'extract_1099_div' },
      });

      const result = extractToolResult(response) as Record<string, unknown> | null;
      if (!result) {
        console.error('[1099-DIV Parser] No tool result from Claude');
        return null;
      }

      return {
        ...result,
        _documentType: '1099-div',
        _parserVersion: 1,
        _parsedWith: '1099-div',
      } as Parsed1099DIVSchema;
    } catch (error) {
      console.error('[1099-DIV Parser] Error:', error);
      return null;
    }
  },
};
