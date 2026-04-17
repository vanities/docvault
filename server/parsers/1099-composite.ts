// 1099-Composite parser — year-end brokerage statements (Vanguard, Fidelity, etc.)
// containing multiple 1099 forms (DIV, INT, B, MISC) in one PDF.
// Uses Anthropic tool use for guaranteed structured output.
// Enhanced: extracts per-transaction 1099-B data when available.

import type { Parsed1099CompositeSchema } from './schemas/index.js';
import type { DocumentParser } from './base.js';
import { readFileAsBase64, buildFileContent, callClaude, extractToolResult } from './base.js';
import { createLogger } from '../logger.js';

const log = createLogger('1099-Composite');

const SYSTEM_PROMPT = `You extract data from composite/consolidated 1099 tax statements. These are year-end brokerage statements (from Vanguard, Fidelity, Schwab, etc.) that contain multiple 1099 forms in a single PDF.

Extract ALL data using the extract_1099_composite tool. Include:
- The 1099-DIV section (dividends) if present
- The 1099-INT section (interest) if present
- The 1099-B section (proceeds from broker transactions) if present — include summary totals AND individual transactions if visible
- The 1099-MISC section if present
- Summary totals across all sections

For the 1099-B section, extract per-transaction data when available:
- Each security sold (name, symbol/CUSIP if shown)
- Date acquired, date sold
- Proceeds, cost basis, gain/loss
- Whether short-term or long-term
- Box category (A, B, C for short-term covered/noncovered; D, E, F for long-term)

All monetary values must be numbers. Omit sections that have no data.`;

const COMPOSITE_TOOL = {
  name: 'extract_1099_composite',
  description: 'Extract structured data from a composite/consolidated 1099 statement',
  input_schema: {
    type: 'object' as const,
    properties: {
      payer: { type: 'string', description: 'Brokerage/institution name' },
      payerTin: { type: 'string', description: "Payer's TIN" },
      accountNumber: { type: 'string', description: 'Account number' },
      div: {
        type: 'object',
        description: '1099-DIV section',
        properties: {
          ordinaryDividends: { type: 'number', description: 'Box 1a - Total ordinary dividends' },
          qualifiedDividends: { type: 'number', description: 'Box 1b - Qualified dividends' },
          capitalGainDistributions: {
            type: 'number',
            description: 'Box 2a - Capital gain distributions',
          },
          section199ADividends: { type: 'number', description: 'Box 5 - Section 199A dividends' },
          foreignTaxPaid: { type: 'number', description: 'Box 7 - Foreign tax paid' },
          nondividendDistributions: {
            type: 'number',
            description: 'Box 3 - Nondividend distributions',
          },
          federalWithheld: { type: 'number', description: 'Box 4 - Federal tax withheld' },
          exemptInterestDividends: {
            type: 'number',
            description: 'Box 12 - Exempt-interest dividends',
          },
        },
      },
      int: {
        type: 'object',
        description: '1099-INT section',
        properties: {
          interestIncome: { type: 'number', description: 'Box 1 - Interest income' },
          federalWithheld: { type: 'number', description: 'Box 4 - Federal tax withheld' },
          taxExemptInterest: { type: 'number', description: 'Box 8 - Tax-exempt interest' },
        },
      },
      b: {
        type: 'object',
        description: '1099-B section (proceeds from broker transactions)',
        properties: {
          shortTermProceeds: { type: 'number', description: 'Short-term total proceeds' },
          shortTermCostBasis: { type: 'number', description: 'Short-term total cost basis' },
          shortTermGainLoss: { type: 'number', description: 'Short-term net gain/loss' },
          longTermProceeds: { type: 'number', description: 'Long-term total proceeds' },
          longTermCostBasis: { type: 'number', description: 'Long-term total cost basis' },
          longTermGainLoss: { type: 'number', description: 'Long-term net gain/loss' },
          totalProceeds: { type: 'number', description: 'Total proceeds' },
          totalCostBasis: { type: 'number', description: 'Total cost basis' },
          totalGainLoss: { type: 'number', description: 'Total net gain/loss' },
          federalWithheld: { type: 'number', description: 'Federal tax withheld' },
          transactions: {
            type: 'array',
            description: 'Individual sale transactions (if visible on statement)',
            items: {
              type: 'object',
              properties: {
                security: { type: 'string', description: 'Security name' },
                symbol: { type: 'string', description: 'Ticker symbol' },
                cusip: { type: 'string', description: 'CUSIP number' },
                dateAcquired: { type: 'string', description: 'Date acquired' },
                dateSold: { type: 'string', description: 'Date sold' },
                quantity: { type: 'number', description: 'Shares sold' },
                proceeds: { type: 'number', description: 'Sale proceeds' },
                costBasis: { type: 'number', description: 'Cost basis' },
                gainLoss: { type: 'number', description: 'Gain or loss' },
                term: {
                  type: 'string',
                  enum: ['short', 'long'],
                  description: 'Short-term or long-term',
                },
                boxCategory: { type: 'string', description: 'Box category (A, B, C, D, E, F)' },
              },
              required: ['security', 'proceeds', 'costBasis', 'gainLoss'],
            },
          },
        },
      },
      misc: {
        type: 'object',
        description: '1099-MISC section',
        properties: {
          rents: { type: 'number' },
          royalties: { type: 'number' },
          otherIncome: { type: 'number' },
          federalWithheld: { type: 'number' },
        },
      },
      totalDividendIncome: {
        type: 'number',
        description: 'Total dividend income across all sections',
      },
      totalInterestIncome: {
        type: 'number',
        description: 'Total interest income across all sections',
      },
      totalCapitalGains: { type: 'number', description: 'Net capital gains from 1099-B' },
      totalFederalWithheld: {
        type: 'number',
        description: 'Total federal tax withheld across all sections',
      },
      taxYear: { type: 'number', description: 'The tax year' },
    },
    required: ['payer'],
  },
};

export const composite1099Parser: DocumentParser<Parsed1099CompositeSchema> = {
  type: '1099-composite',
  version: 1,

  async parse(filePath: string, filename: string): Promise<Parsed1099CompositeSchema | null> {
    try {
      const fileData = await readFileAsBase64(filePath, filename);
      const fileContent = buildFileContent(fileData);

      log.info(`Parsing ${filename}`);

      const response = await callClaude({
        system: SYSTEM_PROMPT,
        userContent: [
          fileContent,
          {
            type: 'text',
            text: 'Extract all data from this composite/consolidated 1099 statement, including per-transaction 1099-B details if available.',
          },
        ],
        maxTokens: 16384, // Composites can be 20+ pages with many transactions
        tools: [COMPOSITE_TOOL],
        toolChoice: { type: 'tool', name: 'extract_1099_composite' },
        purpose: 'parse-1099-composite',
      });

      const result = extractToolResult(response) as Record<string, unknown> | null;
      if (!result) {
        log.error('No tool result from Claude');
        return null;
      }

      // Log transaction count if available
      const b = result.b as Record<string, unknown> | undefined;
      const txnCount = Array.isArray(b?.transactions) ? (b.transactions as unknown[]).length : 0;
      log.info(
        `Extracted: ` +
          `DIV=${result.div ? 'yes' : 'no'} INT=${result.int ? 'yes' : 'no'} ` +
          `B=${result.b ? 'yes' : 'no'} (${txnCount} txns) MISC=${result.misc ? 'yes' : 'no'}`
      );

      return {
        ...result,
        _documentType: '1099-composite',
        _parserVersion: 1,
        _parsedWith: '1099-composite',
      } as Parsed1099CompositeSchema;
    } catch (error) {
      log.error('Error:', String(error));
      return null;
    }
  },
};
