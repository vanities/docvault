// Gold/precious metals receipt parser — uses Anthropic tool use for structured output.
// Replaces the inline parser at POST /api/gold/parse-receipt in server/index.ts.

import type { DocumentParser } from './base.js';
import { readFileAsBase64, buildFileContent, callClaude, extractToolResult } from './base.js';
import { createLogger } from '../logger.js';

const log = createLogger('Gold Receipt');

const SYSTEM_PROMPT = `You analyze receipts and invoices for precious metals purchases (gold, silver, platinum, palladium coins and bars). Extract purchase details using the extract_gold_receipt tool.

Known products and their properties:
- American Gold Eagle: 22K (0.9167 purity), sizes: 1oz, 1/2oz, 1/4oz, 1/10oz
- American Gold Buffalo: 24K (0.9999), 1oz only
- Canadian Gold Maple Leaf: 24K (0.9999), sizes: 1oz, 1/2oz, 1/4oz, 1/10oz
- South African Krugerrand: 22K (0.9167), sizes: 1oz, 1/2oz, 1/4oz, 1/10oz
- Austrian Gold Philharmonic: 24K (0.9999), sizes: 1oz, 1/2oz, 1/4oz, 1/10oz
- Chinese Gold Panda: 24K (0.999), sizes: 1oz, 1/2oz, 1/4oz, 1/10oz
- British Gold Britannia: 24K (0.9999), sizes: 1oz, 1/2oz, 1/4oz, 1/10oz
- American Silver Eagle: 0.999, 1oz
- American Platinum Eagle: 0.9995, sizes: 1oz, 1/2oz, 1/4oz, 1/10oz
- Gold/Silver/Platinum Bars: various sizes (1/10oz to 100oz)

IMPORTANT:
- purchasePrice must be PER PIECE, not total. Divide total by quantity if needed.
- Match to the closest known productId. Use "custom" for specialty/collectible rounds.
- For "custom" items, include the FULL product name in "description".`;

const GOLD_RECEIPT_TOOL = {
  name: 'extract_gold_receipt',
  description: 'Extract structured data from a precious metals receipt',
  input_schema: {
    type: 'object' as const,
    properties: {
      items: {
        type: 'array',
        description: 'Line items — one per product purchased',
        items: {
          type: 'object',
          properties: {
            productId: {
              type: 'string',
              enum: [
                'american-eagle',
                'american-buffalo',
                'canadian-maple-leaf',
                'south-african-krugerrand',
                'austrian-philharmonic',
                'chinese-panda',
                'british-britannia',
                'gold-bar',
                'american-silver-eagle',
                'silver-bar',
                'silver-round',
                'american-platinum-eagle',
                'platinum-bar',
                'custom',
              ],
              description: 'Product ID',
            },
            metal: { type: 'string', enum: ['gold', 'silver', 'platinum', 'palladium'] },
            size: {
              type: 'string',
              enum: ['1/10oz', '1/4oz', '1/2oz', '1oz', '2oz', '5oz', '10oz', '1kg', '100oz'],
            },
            coinYear: { type: 'number', description: 'Mint year (if visible)' },
            quantity: { type: 'number', description: 'Number of pieces' },
            purchasePrice: { type: 'number', description: 'Price PER PIECE (not total)' },
            description: { type: 'string', description: 'Full product name as shown on receipt' },
          },
          required: ['productId', 'metal', 'size', 'quantity', 'purchasePrice'],
        },
      },
      dealer: { type: 'string', description: 'Dealer/vendor name' },
      purchaseDate: { type: 'string', description: 'Purchase date (YYYY-MM-DD)' },
      orderNumber: { type: 'string', description: 'Order/invoice number' },
      subtotal: { type: 'number', description: 'Subtotal before tax/shipping' },
      shipping: { type: 'number', description: 'Shipping cost' },
      tax: { type: 'number', description: 'Tax amount' },
      total: { type: 'number', description: 'Total amount paid' },
    },
    required: ['items', 'dealer', 'total'],
  },
};

export interface ParsedGoldReceiptSchema {
  _documentType: 'gold-receipt';
  _parserVersion: number;
  _parsedWith: string;
  items?: Array<{
    productId: string;
    metal: string;
    size: string;
    coinYear?: number;
    quantity: number;
    purchasePrice: number;
    description?: string;
  }>;
  dealer?: string;
  purchaseDate?: string;
  orderNumber?: string;
  subtotal?: number;
  shipping?: number;
  tax?: number;
  total?: number;
}

const goldReceiptParser: DocumentParser<ParsedGoldReceiptSchema> = {
  type: 'gold-receipt',
  version: 1,

  async parse(filePath: string, filename: string): Promise<ParsedGoldReceiptSchema | null> {
    try {
      const fileData = await readFileAsBase64(filePath, filename);
      const fileContent = buildFileContent(fileData);

      log.info(`Parsing ${filename}`);

      const response = await callClaude({
        system: SYSTEM_PROMPT,
        userContent: [
          fileContent,
          { type: 'text', text: 'Extract all purchase details from this precious metals receipt.' },
        ],
        maxTokens: 2048,
        tools: [GOLD_RECEIPT_TOOL],
        toolChoice: { type: 'tool', name: 'extract_gold_receipt' },
        purpose: 'parse-gold-receipt',
      });

      const result = extractToolResult(response) as Record<string, unknown> | null;
      if (!result) {
        log.error('No tool result from Claude');
        return null;
      }

      return {
        ...result,
        _documentType: 'gold-receipt',
        _parserVersion: 1,
        _parsedWith: 'gold-receipt',
      } as ParsedGoldReceiptSchema;
    } catch (error) {
      log.error('Error:', String(error));
      return null;
    }
  },
};

// Standalone parse function for the /api/gold/parse-receipt endpoint.
// Accepts raw file bytes (from req.arrayBuffer()) instead of a file path.
export async function parseGoldReceiptFromBuffer(
  buffer: ArrayBuffer,
  filename: string
): Promise<ParsedGoldReceiptSchema | null> {
  // Write to a temp file so we can use the standard parser
  const { writeFileSync, unlinkSync } = await import('fs');
  const tmpPath = `/tmp/gold-receipt-${Date.now()}-${filename}`;
  try {
    writeFileSync(tmpPath, Buffer.from(buffer));
    return goldReceiptParser.parse(tmpPath, filename);
  } finally {
    try {
      unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
  }
}
