// Document type detection — two-tier approach:
// 1. Filename-based regex detection (free, instant)
// 2. Lightweight LLM classification fallback (cheap, for unknown filenames)

import { readFileAsBase64, buildFileContent, callClaude, extractTextResponse } from './base.js';
import { detectDocumentTypeFromFilename } from './generic.js';

// All valid document types the detector can return
const VALID_TYPES = new Set([
  'w2',
  '1099-nec',
  '1099-misc',
  '1099-div',
  '1099-int',
  '1099-b',
  '1099-composite',
  '1099-r',
  '1098',
  'k-1',
  'schedule-c',
  'bank-statement',
  'credit-card-statement',
  'receipt',
  'retirement-statement',
  'operating-agreement',
  'insurance-policy',
  'statement',
  'letter',
  'certificate',
  'medical-record',
  'appraisal',
  'koinly-8949',
  'koinly-schedule',
  'other',
]);

// Map filename hints (mixed-case) to canonical types (lowercase)
const hintToCanonical: Record<string, string> = {
  'W-2': 'w2',
  '1099-NEC': '1099-nec',
  '1099-MISC': '1099-misc',
  '1099-DIV': '1099-div',
  '1099-INT': '1099-int',
  '1099-composite': '1099-composite',
  '1099-B': '1099-b',
  '1098': '1098',
  'K-1': 'k-1',
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
};

const CLASSIFICATION_PROMPT = `You classify tax and financial documents. Look at this document and respond with ONLY one of these types (nothing else):

w2, 1099-nec, 1099-misc, 1099-div, 1099-int, 1099-b, 1099-composite, 1099-r, 1098, k-1, schedule-c, bank-statement, credit-card-statement, receipt, retirement-statement, operating-agreement, insurance-policy, statement, letter, certificate, medical-record, appraisal, koinly-8949, koinly-schedule, other

Respond with ONLY the type string, nothing else.`;

// Detect document type from filename first, then LLM if needed.
// Returns a canonical lowercase type string.
export async function detectDocumentType(filePath: string, filename: string): Promise<string> {
  // Tier 1: Filename regex (free, instant)
  const filenameHint = detectDocumentTypeFromFilename(filename);
  if (filenameHint !== 'unknown') {
    const canonical = hintToCanonical[filenameHint] || filenameHint;
    console.log(`[Type Detector] Filename match: ${filename} → ${canonical}`);
    return canonical;
  }

  // Tier 2: LLM classification (cheap, one API call with small max_tokens)
  try {
    console.log(`[Type Detector] Filename unknown, using LLM for: ${filename}`);
    const fileData = await readFileAsBase64(filePath, filename);
    const fileContent = buildFileContent(fileData);

    const response = await callClaude({
      system: CLASSIFICATION_PROMPT,
      userContent: [fileContent, { type: 'text', text: 'What type of document is this?' }],
      maxTokens: 50,
    });

    const text = extractTextResponse(response);
    if (text) {
      const detected = text.trim().toLowerCase();
      if (VALID_TYPES.has(detected)) {
        console.log(`[Type Detector] LLM classified: ${filename} → ${detected}`);
        return detected;
      }
      console.warn(
        `[Type Detector] LLM returned invalid type "${detected}", falling back to "other"`
      );
    }
  } catch (error) {
    console.error('[Type Detector] LLM classification failed:', error);
  }

  return 'other';
}
