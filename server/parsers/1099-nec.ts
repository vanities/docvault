// 1099-NEC parser — uses Anthropic tool use for guaranteed structured output.

import type { Parsed1099NECSchema } from './schemas/index.js';
import type { DocumentParser, ValidationResult } from './base.js';
import { readFileAsBase64, buildFileContent, callClaude, extractToolResult } from './base.js';
import { createLogger } from '../logger.js';

const log = createLogger('1099-NEC');

const SYSTEM_PROMPT = `You extract data from 1099-NEC (Nonemployee Compensation) tax forms. Extract ALL visible data using the extract_1099_nec tool. All monetary values must be numbers. Omit fields that are blank or not present.`;

const NEC_TOOL = {
  name: 'extract_1099_nec',
  description: 'Extract structured data from a 1099-NEC tax form',
  input_schema: {
    type: 'object' as const,
    properties: {
      payerName: { type: 'string', description: 'Company/person name' },
      payerAddress: { type: 'string', description: 'Full street address' },
      payerCity: { type: 'string', description: 'City' },
      payerState: { type: 'string', description: 'State' },
      payerZip: { type: 'string', description: 'ZIP code' },
      payerCountry: { type: 'string', description: 'Country (if shown)' },
      payerPhone: { type: 'string', description: 'Phone number' },
      payerTin: { type: 'string', description: "Payer's TIN (XX-XXXXXXX)" },
      recipientName: { type: 'string', description: "Recipient's name" },
      recipientTin: { type: 'string', description: "Recipient's TIN (may be masked)" },
      recipientAddress: { type: 'string', description: "Recipient's address" },
      accountNumber: { type: 'string', description: 'Account number' },
      nonemployeeCompensation: { type: 'number', description: 'Box 1 - Nonemployee compensation' },
      payerMadeDirectSales: { type: 'boolean', description: 'Box 2 - Direct sales checkbox' },
      federalWithheld: { type: 'number', description: 'Box 4 - Federal income tax withheld' },
      stateTaxWithheld: { type: 'number', description: 'Box 5 - State tax withheld' },
      statePayerStateNo: { type: 'string', description: "Box 6 - State/Payer's state no." },
      stateIncome: { type: 'number', description: 'Box 7 - State income' },
      taxYear: { type: 'number', description: 'Tax year (from "For calendar year XXXX")' },
    },
    required: ['payerName', 'nonemployeeCompensation'],
  },
};

export const nec1099Parser: DocumentParser<Parsed1099NECSchema> = {
  type: '1099-nec',
  version: 1,

  async parse(filePath: string, filename: string): Promise<Parsed1099NECSchema | null> {
    try {
      const fileData = await readFileAsBase64(filePath, filename);
      const fileContent = buildFileContent(fileData);

      log.info(`Parsing ${filename}`);

      const response = await callClaude({
        system: SYSTEM_PROMPT,
        userContent: [
          fileContent,
          { type: 'text', text: 'Extract all data from this 1099-NEC form.' },
        ],
        maxTokens: 1024,
        tools: [NEC_TOOL],
        toolChoice: { type: 'tool', name: 'extract_1099_nec' },
      });

      const result = extractToolResult(response) as Record<string, unknown> | null;
      if (!result) {
        log.error('No tool result from Claude');
        return null;
      }

      log.debug('Extracted:', JSON.stringify(result, null, 2));

      return {
        ...result,
        _documentType: '1099-nec',
        _parserVersion: 1,
        _parsedWith: '1099-nec',
      } as Parsed1099NECSchema;
    } catch (error) {
      log.error('Error:', String(error));
      return null;
    }
  },

  validate(result: Parsed1099NECSchema): ValidationResult {
    const warnings: string[] = [];

    if (result.nonemployeeCompensation !== undefined && result.nonemployeeCompensation <= 0) {
      warnings.push(`Nonemployee compensation is ${result.nonemployeeCompensation} (expected > 0)`);
    }

    return { valid: warnings.length === 0, warnings };
  },
};
