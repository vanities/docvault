// 1099-R parser — uses Anthropic tool use for guaranteed structured output.
// 1099-R covers distributions from pensions, annuities, retirement plans, IRAs, etc.

import type { Parsed1099RSchema } from './schemas/index.js';
import type { DocumentParser } from './base.js';
import { readFileAsBase64, buildFileContent, callClaude, extractToolResult } from './base.js';
import { createLogger } from '../logger.js';

const log = createLogger('1099-R');

const SYSTEM_PROMPT = `You extract data from 1099-R (Distributions From Pensions, Annuities, Retirement or Profit-Sharing Plans, IRAs, Insurance Contracts, etc.) tax forms. Extract ALL visible data using the extract_1099_r tool. All monetary values must be numbers. Distribution codes are important — extract them exactly as printed (e.g., "1", "7", "G"). Omit fields that are blank or not present.`;

const R_TOOL = {
  name: 'extract_1099_r',
  description: 'Extract structured data from a 1099-R tax form',
  input_schema: {
    type: 'object' as const,
    properties: {
      payerName: { type: 'string', description: "Payer's name (institution)" },
      payerTin: { type: 'string', description: "Payer's TIN" },
      recipientName: { type: 'string', description: "Recipient's name" },
      recipientTin: { type: 'string', description: "Recipient's TIN" },
      accountNumber: { type: 'string', description: 'Account number' },
      grossDistribution: { type: 'number', description: 'Box 1 - Gross distribution' },
      taxableAmount: { type: 'number', description: 'Box 2a - Taxable amount' },
      taxableAmountNotDetermined: {
        type: 'boolean',
        description: 'Box 2b - Taxable amount not determined',
      },
      totalDistribution: { type: 'boolean', description: 'Box 2b - Total distribution' },
      capitalGain: { type: 'number', description: 'Box 3 - Capital gain' },
      federalWithheld: { type: 'number', description: 'Box 4 - Federal income tax withheld' },
      distributionCode: {
        type: 'string',
        description: 'Box 7 - Distribution code(s) (e.g., "1", "7", "G")',
      },
      otherAmount: { type: 'number', description: 'Box 8 - Other amount' },
      otherPercentage: {
        type: 'number',
        description: 'Box 9a - Your percentage of total distribution',
      },
      employeeContributions: {
        type: 'number',
        description:
          'Box 5 - Employee contributions/Designated Roth contributions or insurance premiums',
      },
      netUnrealizedAppreciation: {
        type: 'number',
        description: 'Box 6 - Net unrealized appreciation in employers securities',
      },
      stateTaxWithheld: { type: 'number', description: 'Box 12 - State tax withheld' },
      stateIncome: { type: 'number', description: 'Box 14 - State distribution' },
      localTaxWithheld: { type: 'number', description: 'Box 15 - Local tax withheld' },
      localIncome: { type: 'number', description: 'Box 17 - Local distribution' },
      taxYear: { type: 'number', description: 'The tax year' },
    },
    required: ['payerName', 'grossDistribution'],
  },
};

export const r1099Parser: DocumentParser<Parsed1099RSchema> = {
  type: '1099-r',
  version: 1,

  async parse(filePath: string, filename: string): Promise<Parsed1099RSchema | null> {
    try {
      const fileData = await readFileAsBase64(filePath, filename);
      const fileContent = buildFileContent(fileData);

      log.info(`Parsing ${filename}`);

      const response = await callClaude({
        system: SYSTEM_PROMPT,
        userContent: [
          fileContent,
          { type: 'text', text: 'Extract all data from this 1099-R form.' },
        ],
        maxTokens: 1024,
        tools: [R_TOOL],
        toolChoice: { type: 'tool', name: 'extract_1099_r' },
      });

      const result = extractToolResult(response) as Record<string, unknown> | null;
      if (!result) {
        log.error('No tool result from Claude');
        return null;
      }

      return {
        ...result,
        _documentType: '1099-r',
        _parserVersion: 1,
        _parsedWith: '1099-r',
      } as Parsed1099RSchema;
    } catch (error) {
      log.error('Error:', String(error));
      return null;
    }
  },
};
