// Koinly Schedule D / Schedule 1 parser — extracts crypto tax summary data.
// Uses Anthropic tool use for guaranteed structured output.

import type { ParsedKoinlyScheduleSchema } from './schemas/index.js';
import type { DocumentParser } from './base.js';
import {
  readFileAsBase64,
  buildFileContent,
  callClaude,
  extractToolResult,
} from './base.js';

const SYSTEM_PROMPT = `You extract data from Koinly-generated tax schedule documents. These may be:

1. **Schedule D** (Capital Gains and Losses Summary) — contains:
   - Part I: Short-term gains/losses (lines 1-7)
   - Part II: Long-term gains/losses (lines 8-15)
   - Part III: Summary (lines 16-22)

2. **Schedule 1** (Additional Income and Adjustments) — contains:
   - Line 8v: Digital asset income (staking, airdrops, mining, etc.)
   - Other income lines

Extract ALL visible data using the extract_koinly_schedule tool. All monetary values must be numbers.`;

const KOINLY_SCHEDULE_TOOL = {
  name: 'extract_koinly_schedule',
  description: 'Extract structured data from a Koinly Schedule D or Schedule 1',
  input_schema: {
    type: 'object' as const,
    properties: {
      scheduleType: { type: 'string', enum: ['D', '1', 'both'], description: 'Which schedule this is' },
      // Schedule D fields
      shortTermGainLoss: { type: 'number', description: 'Schedule D Part I - Total short-term gain/loss' },
      longTermGainLoss: { type: 'number', description: 'Schedule D Part II - Total long-term gain/loss' },
      totalGainLoss: { type: 'number', description: 'Schedule D Part III - Combined gain/loss' },
      // Schedule 1 fields
      digitalAssetIncome: { type: 'number', description: 'Schedule 1 Line 8v - Digital asset income (staking, etc.)' },
      otherIncome: {
        type: 'array',
        description: 'Other income line items from Schedule 1',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string' },
            amount: { type: 'number' },
            lineNumber: { type: 'string' },
          },
          required: ['description', 'amount'],
        },
      },
      taxYear: { type: 'number', description: 'Tax year' },
    },
    required: [],
  },
};

export const koinlyScheduleParser: DocumentParser<ParsedKoinlyScheduleSchema> = {
  type: 'koinly-schedule',
  version: 1,

  async parse(filePath: string, filename: string): Promise<ParsedKoinlyScheduleSchema | null> {
    try {
      const fileData = await readFileAsBase64(filePath, filename);
      const fileContent = buildFileContent(fileData);

      console.log(`[Koinly Schedule Parser] Parsing ${filename}`);

      const response = await callClaude({
        system: SYSTEM_PROMPT,
        userContent: [
          fileContent,
          { type: 'text', text: 'Extract all data from this Koinly tax schedule.' },
        ],
        maxTokens: 2048,
        tools: [KOINLY_SCHEDULE_TOOL],
        toolChoice: { type: 'tool', name: 'extract_koinly_schedule' },
      });

      const result = extractToolResult(response) as Record<string, unknown> | null;
      if (!result) {
        console.error('[Koinly Schedule Parser] No tool result from Claude');
        return null;
      }

      return {
        ...result,
        _documentType: 'koinly-schedule',
        _parserVersion: 1,
        _parsedWith: 'koinly-schedule',
      } as ParsedKoinlyScheduleSchema;
    } catch (error) {
      console.error('[Koinly Schedule Parser] Error:', error);
      return null;
    }
  },
};
