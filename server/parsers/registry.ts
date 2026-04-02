// Parser registry — routes document parsing to type-specific parsers.
// Falls back to the generic parser for unimplemented document types.

import type { ParsedTaxDocument } from './pdf.js';
import type { DocumentParser } from './base.js';
import { toLegacyParsedData } from './base.js';
import { genericParser, detectDocumentTypeFromFilename } from './generic.js';
import { detectDocumentType } from './detect-type.js';

// Registry: document type string -> parser instance
const registry = new Map<string, DocumentParser>();

export function registerParser(parser: DocumentParser): void {
  registry.set(parser.type, parser);
  console.log(`[Parser Registry] Registered parser: ${parser.type} (v${parser.version})`);
}

export function getParser(type: string): DocumentParser | undefined {
  return registry.get(type);
}

export function listParsers(): string[] {
  return Array.from(registry.keys());
}

// Map filename-based detection hints to canonical document type strings
// The filename detector returns uppercase/mixed-case like "W-2", "1099-NEC",
// but the registry uses lowercase canonical types like "w2", "1099-nec".
const hintToCanonical: Record<string, string> = {
  'W-2': 'w2',
  '1099-NEC': '1099-nec',
  '1099-MISC': '1099-misc',
  '1099-DIV': '1099-div',
  '1099-INT': '1099-int',
  '1099-composite': '1099-composite',
  '1099-B': '1099-b',
  '1099-R': '1099-r',
  '1098': '1098',
  'K-1': 'k-1',
  invoice: 'invoice',
  receipt: 'receipt',
  'operating-agreement': 'operating-agreement',
  'insurance-policy': 'insurance-policy',
  'retirement-statement': 'retirement-statement',
  'bank-statement': 'bank-statement',
  'credit-card-statement': 'credit-card-statement',
  statement: 'statement',
  certificate: 'certificate',
  'medical-record': 'medical-record',
  appraisal: 'appraisal',
  'koinly-8949': 'koinly-8949',
  'koinly-schedule': 'koinly-schedule',
};

// Main entry point — replaces parseWithAI() as the parser router.
// Detects document type, finds the right parser, runs it, and returns
// a legacy-compatible ParsedTaxDocument.
export async function routeParse(
  filePath: string,
  filename: string,
  forceType?: string
): Promise<ParsedTaxDocument | null> {
  // 1. Detect type — filename first (free), then LLM if needed
  let detectedType: string;
  if (forceType) {
    detectedType = forceType;
  } else {
    const filenameHint = detectDocumentTypeFromFilename(filename);
    const canonicalHint = hintToCanonical[filenameHint] || filenameHint;

    if (canonicalHint === 'unknown') {
      // Filename didn't match — use LLM classification
      detectedType = await detectDocumentType(filePath, filename);
    } else {
      detectedType = canonicalHint;
    }
  }

  // 2. Look up type-specific parser, fall back to generic
  const parser = registry.get(detectedType) || genericParser;
  const isTypeSpecific = registry.has(detectedType);

  console.log(
    `[Parser Registry] Routing ${filename} → ${parser.type} parser` +
      (isTypeSpecific ? ' (type-specific)' : ' (generic fallback)') +
      ` [detected: ${detectedType}]`
  );

  // 3. Parse
  const result = await parser.parse(filePath, filename);
  if (!result) return null;

  // 4. Validate (if parser supports it)
  if (parser.validate) {
    const { warnings } = parser.validate(result);
    for (const w of warnings) {
      console.warn(`[Parser:${parser.type}] Validation: ${w}`);
    }
  }

  // 5. For type-specific parsers, convert to legacy format.
  //    The generic parser already returns ParsedTaxDocument directly.
  if (isTypeSpecific) {
    const legacy = toLegacyParsedData(result as Record<string, unknown>, detectedType);
    return {
      ...legacy,
      // Attach parser metadata (consumers ignore unknown fields)
      _parsedWith: parser.type,
      _parserVersion: parser.version,
      _detectedType: detectedType,
    } as ParsedTaxDocument;
  }

  // Generic parser result — pass through with metadata
  return {
    ...(result as Record<string, unknown>),
    _parsedWith: 'generic',
    _parserVersion: genericParser.version,
    _detectedType: detectedType,
  } as ParsedTaxDocument;
}

// Initialize: register all parsers.
// Type-specific parsers are imported and registered here to avoid circular deps.
// Add new parsers here as they are built.
import { w2Parser } from './w2.js';
import { nec1099Parser } from './1099-nec.js';
import { div1099Parser } from './1099-div.js';
import { int1099Parser } from './1099-int.js';
import { r1099Parser } from './1099-r.js';
import { misc1099Parser } from './1099-misc.js';
import { bankStatementParser } from './bank-statement.js';
import { k1Parser } from './k1.js';
import { receiptParser } from './receipt.js';
import { creditCardParser } from './credit-card.js';
import { parser1098 } from './1098.js';
import { composite1099Parser } from './1099-composite.js';
import { koinly8949Parser } from './koinly-8949.js';
import { koinlyScheduleParser } from './koinly-schedule.js';
import { invoiceParser } from './invoice.js';

registerParser(genericParser);
registerParser(w2Parser);
registerParser(nec1099Parser);
registerParser(div1099Parser);
registerParser(int1099Parser);
registerParser(r1099Parser);
registerParser(misc1099Parser);
registerParser(bankStatementParser);
registerParser(k1Parser);
registerParser(receiptParser);
registerParser(creditCardParser);
registerParser(parser1098);
registerParser(composite1099Parser);
registerParser(koinly8949Parser);
registerParser(koinlyScheduleParser);
registerParser(invoiceParser);
