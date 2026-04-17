// W-2 parser — uses Anthropic tool use for guaranteed structured output.
// Focused prompt and strict JSON schema instead of the 320-line generic prompt.

import type { ParsedW2Schema } from './schemas/index.js';
import type { DocumentParser, ValidationResult } from './base.js';
import { readFileAsBase64, buildFileContent, callClaude, extractToolResult } from './base.js';
import { createLogger } from '../logger.js';

const log = createLogger('W-2');

const SYSTEM_PROMPT = `You extract data from W-2 (Wage and Tax Statement) forms. Extract ALL visible data from the document using the extract_w2 tool. All monetary values must be numbers. Omit fields that are blank or not present on the form.`;

const W2_TOOL = {
  name: 'extract_w2',
  description: 'Extract structured data from a W-2 tax form',
  input_schema: {
    type: 'object' as const,
    properties: {
      employerName: { type: 'string', description: 'Employer name' },
      employerAddress: { type: 'string', description: 'Full street address' },
      employerCity: { type: 'string', description: 'City' },
      employerState: { type: 'string', description: 'State (2-letter code)' },
      employerZip: { type: 'string', description: 'ZIP code' },
      employerPhone: { type: 'string', description: 'Phone number' },
      ein: { type: 'string', description: 'Employer Identification Number (XX-XXXXXXX)' },
      employeeName: { type: 'string', description: "Employee's full name" },
      employeeSsn: { type: 'string', description: "Employee's SSN (last 4 visible)" },
      employeeAddress: { type: 'string', description: "Employee's address" },
      wages: { type: 'number', description: 'Box 1 - Wages, tips, other compensation' },
      federalWithheld: { type: 'number', description: 'Box 2 - Federal income tax withheld' },
      socialSecurityWages: { type: 'number', description: 'Box 3 - Social security wages' },
      socialSecurityTax: { type: 'number', description: 'Box 4 - Social security tax withheld' },
      medicareWages: { type: 'number', description: 'Box 5 - Medicare wages and tips' },
      medicareTax: { type: 'number', description: 'Box 6 - Medicare tax withheld' },
      socialSecurityTips: { type: 'number', description: 'Box 7 - Social security tips' },
      allocatedTips: { type: 'number', description: 'Box 8 - Allocated tips' },
      dependentCareBenefits: { type: 'number', description: 'Box 10 - Dependent care benefits' },
      nonqualifiedPlans: { type: 'number', description: 'Box 11 - Nonqualified plans' },
      box12: {
        type: 'array',
        description: 'Box 12 entries (e.g., 401k contributions)',
        items: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'Box 12 code (e.g., D, DD, W)' },
            amount: { type: 'number', description: 'Amount' },
          },
          required: ['code', 'amount'],
        },
      },
      statutoryEmployee: { type: 'boolean', description: 'Box 13 - Statutory employee' },
      retirementPlan: { type: 'boolean', description: 'Box 13 - Retirement plan' },
      thirdPartySickPay: { type: 'boolean', description: 'Box 13 - Third-party sick pay' },
      other: { type: 'string', description: 'Box 14 - Other' },
      stateEmployerId: { type: 'string', description: "Box 15 - State/Employer's state ID" },
      stateWages: { type: 'number', description: 'Box 16 - State wages' },
      stateWithheld: { type: 'number', description: 'Box 17 - State income tax' },
      localWages: { type: 'number', description: 'Box 18 - Local wages' },
      localWithheld: { type: 'number', description: 'Box 19 - Local income tax' },
      localityName: { type: 'string', description: 'Box 20 - Locality name' },
      taxYear: { type: 'number', description: 'The tax year' },
    },
    required: ['employerName', 'wages'],
  },
};

export const w2Parser: DocumentParser<ParsedW2Schema> = {
  type: 'w2',
  version: 1,

  async parse(filePath: string, filename: string): Promise<ParsedW2Schema | null> {
    try {
      const fileData = await readFileAsBase64(filePath, filename);
      const fileContent = buildFileContent(fileData);

      log.info(`Parsing ${filename}`);

      const response = await callClaude({
        system: SYSTEM_PROMPT,
        userContent: [fileContent, { type: 'text', text: 'Extract all data from this W-2 form.' }],
        maxTokens: 2048,
        tools: [W2_TOOL],
        toolChoice: { type: 'tool', name: 'extract_w2' },
        purpose: 'parse-w2',
      });

      const result = extractToolResult(response) as Record<string, unknown> | null;
      if (!result) {
        log.error('No tool result from Claude');
        return null;
      }

      log.debug('Extracted:', JSON.stringify(result, null, 2));

      return {
        ...result,
        _documentType: 'w2',
        _parserVersion: 1,
        _parsedWith: 'w2',
      } as ParsedW2Schema;
    } catch (error) {
      log.error('Error:', String(error));
      return null;
    }
  },

  validate(result: ParsedW2Schema): ValidationResult {
    const warnings: string[] = [];

    // SS tax should be ~6.2% of SS wages
    if (result.socialSecurityWages && result.socialSecurityTax) {
      const expectedSsTax = result.socialSecurityWages * 0.062;
      const diff = Math.abs(result.socialSecurityTax - expectedSsTax);
      if (diff > 1) {
        warnings.push(
          `SS tax ${result.socialSecurityTax} differs from expected ${expectedSsTax.toFixed(2)} (6.2% of ${result.socialSecurityWages})`
        );
      }
    }

    // Medicare tax should be ~1.45% of Medicare wages
    if (result.medicareWages && result.medicareTax) {
      const expectedMedicareTax = result.medicareWages * 0.0145;
      const diff = Math.abs(result.medicareTax - expectedMedicareTax);
      if (diff > 1) {
        warnings.push(
          `Medicare tax ${result.medicareTax} differs from expected ${expectedMedicareTax.toFixed(2)} (1.45% of ${result.medicareWages})`
        );
      }
    }

    return { valid: warnings.length === 0, warnings };
  },
};
