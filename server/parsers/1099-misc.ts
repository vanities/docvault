// 1099-MISC parser — uses Anthropic tool use for guaranteed structured output.

import type { Parsed1099MISCSchema } from './schemas/index.js';
import type { DocumentParser } from './base.js';
import { readFileAsBase64, buildFileContent, callClaude, extractToolResult } from './base.js';
import { createLogger } from '../logger.js';

const log = createLogger('1099-MISC');

const SYSTEM_PROMPT = `You extract data from 1099-MISC (Miscellaneous Information) tax forms. Extract ALL visible data using the extract_1099_misc tool. All monetary values must be numbers. Omit fields that are blank or not present.`;

const MISC_TOOL = {
  name: 'extract_1099_misc',
  description: 'Extract structured data from a 1099-MISC tax form',
  input_schema: {
    type: 'object' as const,
    properties: {
      payerName: { type: 'string', description: 'Company/person name' },
      payerAddress: { type: 'string', description: 'Full address' },
      payerTin: { type: 'string', description: "Payer's TIN" },
      recipientName: { type: 'string', description: "Recipient's name" },
      recipientTin: { type: 'string', description: "Recipient's TIN" },
      accountNumber: { type: 'string', description: 'Account number' },
      rents: { type: 'number', description: 'Box 1 - Rents' },
      royalties: { type: 'number', description: 'Box 2 - Royalties' },
      otherIncome: { type: 'number', description: 'Box 3 - Other income' },
      federalWithheld: { type: 'number', description: 'Box 4 - Federal income tax withheld' },
      fishingBoatProceeds: { type: 'number', description: 'Box 5 - Fishing boat proceeds' },
      medicalPayments: { type: 'number', description: 'Box 6 - Medical and health care payments' },
      substitutePayments: {
        type: 'number',
        description: 'Box 8 - Substitute payments in lieu of dividends',
      },
      cropInsurance: { type: 'number', description: 'Box 9 - Crop insurance proceeds' },
      grossProceeds: { type: 'number', description: 'Box 10 - Gross proceeds paid to an attorney' },
      fishPurchased: { type: 'number', description: 'Box 11 - Fish purchased for resale' },
      section409ADeferrals: { type: 'number', description: 'Box 12 - Section 409A deferrals' },
      goldenParachute: { type: 'number', description: 'Box 13 - Excess golden parachute payments' },
      nonqualifiedDeferred: {
        type: 'number',
        description: 'Box 14 - Nonqualified deferred compensation',
      },
      stateTaxWithheld: { type: 'number', description: 'Box 16 - State tax withheld' },
      stateIncome: { type: 'number', description: 'Box 18 - State income' },
      taxYear: { type: 'number', description: 'The tax year' },
    },
    required: ['payerName'],
  },
};

export const misc1099Parser: DocumentParser<Parsed1099MISCSchema> = {
  type: '1099-misc',
  version: 1,

  async parse(filePath: string, filename: string): Promise<Parsed1099MISCSchema | null> {
    try {
      const fileData = await readFileAsBase64(filePath, filename);
      const fileContent = buildFileContent(fileData);

      log.info(`Parsing ${filename}`);

      const response = await callClaude({
        system: SYSTEM_PROMPT,
        userContent: [
          fileContent,
          { type: 'text', text: 'Extract all data from this 1099-MISC form.' },
        ],
        maxTokens: 1024,
        tools: [MISC_TOOL],
        toolChoice: { type: 'tool', name: 'extract_1099_misc' },
      });

      const result = extractToolResult(response) as Record<string, unknown> | null;
      if (!result) {
        log.error('No tool result from Claude');
        return null;
      }

      return {
        ...result,
        _documentType: '1099-misc',
        _parserVersion: 1,
        _parsedWith: '1099-misc',
      } as Parsed1099MISCSchema;
    } catch (error) {
      log.error('Error:', String(error));
      return null;
    }
  },
};
