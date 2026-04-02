// Koinly Form 8949 parser — extracts crypto capital gains/losses per exchange.
// Uses Anthropic tool use for guaranteed structured output.

import type { ParsedKoinly8949Schema } from './schemas/index.js';
import type { DocumentParser } from './base.js';
import { readFileAsBase64, buildFileContent, callClaude, extractToolResult } from './base.js';

const SYSTEM_PROMPT = `You extract data from Koinly-generated Form 8949 PDFs. These report crypto capital gains and losses organized by exchange and holding period.

The form has sections for:
- Short-term transactions (Box A/B/C for covered/noncovered/no 1099-B)
- Long-term transactions (Box D/E/F for covered/noncovered/no 1099-B)

For crypto, most transactions are Box C (short-term, no 1099-B) or Box F (long-term, no 1099-B).

Koinly groups transactions by exchange (Coinbase, Kraken, Non-custodial, etc.) with summary totals per group. Extract each group's summary — you do NOT need to extract every individual transaction row, just the per-exchange summary totals.

All monetary values must be numbers. Use the extract_koinly_8949 tool.`;

const KOINLY_8949_TOOL = {
  name: 'extract_koinly_8949',
  description: 'Extract structured data from a Koinly Form 8949',
  input_schema: {
    type: 'object' as const,
    properties: {
      shortTerm: {
        type: 'array',
        description: 'Short-term capital gains groups',
        items: {
          type: 'object',
          properties: {
            exchange: {
              type: 'string',
              description: 'Exchange name (e.g., Coinbase, Kraken, Non-custodial)',
            },
            boxCategory: { type: 'string', description: 'Box category (A, B, or C)' },
            proceeds: { type: 'number', description: 'Total proceeds' },
            costBasis: { type: 'number', description: 'Total cost basis' },
            adjustment: { type: 'number', description: 'Adjustment amount (column g)' },
            gainLoss: { type: 'number', description: 'Net gain or loss' },
            transactionCount: {
              type: 'number',
              description: 'Number of transactions in this group',
            },
          },
          required: ['exchange', 'proceeds', 'costBasis', 'gainLoss'],
        },
      },
      longTerm: {
        type: 'array',
        description: 'Long-term capital gains groups',
        items: {
          type: 'object',
          properties: {
            exchange: { type: 'string', description: 'Exchange name' },
            boxCategory: { type: 'string', description: 'Box category (D, E, or F)' },
            proceeds: { type: 'number', description: 'Total proceeds' },
            costBasis: { type: 'number', description: 'Total cost basis' },
            adjustment: { type: 'number', description: 'Adjustment amount' },
            gainLoss: { type: 'number', description: 'Net gain or loss' },
            transactionCount: {
              type: 'number',
              description: 'Number of transactions in this group',
            },
          },
          required: ['exchange', 'proceeds', 'costBasis', 'gainLoss'],
        },
      },
      totalShortTermGainLoss: { type: 'number', description: 'Total short-term gain/loss' },
      totalLongTermGainLoss: { type: 'number', description: 'Total long-term gain/loss' },
      taxYear: { type: 'number', description: 'Tax year' },
    },
    required: [],
  },
};

export const koinly8949Parser: DocumentParser<ParsedKoinly8949Schema> = {
  type: 'koinly-8949',
  version: 1,

  async parse(filePath: string, filename: string): Promise<ParsedKoinly8949Schema | null> {
    try {
      const fileData = await readFileAsBase64(filePath, filename);
      const fileContent = buildFileContent(fileData);

      console.log(`[Koinly 8949 Parser] Parsing ${filename}`);

      const response = await callClaude({
        system: SYSTEM_PROMPT,
        userContent: [
          fileContent,
          {
            type: 'text',
            text: 'Extract all capital gains/losses data from this Koinly Form 8949, grouped by exchange.',
          },
        ],
        maxTokens: 8192,
        tools: [KOINLY_8949_TOOL],
        toolChoice: { type: 'tool', name: 'extract_koinly_8949' },
      });

      const result = extractToolResult(response) as Record<string, unknown> | null;
      if (!result) {
        console.error('[Koinly 8949 Parser] No tool result from Claude');
        return null;
      }

      return {
        ...result,
        _documentType: 'koinly-8949',
        _parserVersion: 1,
        _parsedWith: 'koinly-8949',
      } as ParsedKoinly8949Schema;
    } catch (error) {
      console.error('[Koinly 8949 Parser] Error:', error);
      return null;
    }
  },
};
