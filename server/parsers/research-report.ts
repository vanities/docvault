// Research-report text extractor — pulls raw text out of analyst research PDFs
// (Benjamin Cowen's Macro Risk Memos, Lyn Alden notes, Fidelity outlooks, etc.).
//
// Deliberately AI-free: no Claude Vision call, no structured schema. Text is
// enough for reading + search; users add their own notes. An AI summarizer
// can be layered on later as an opt-in action without touching this module.
//
// History:
//   1.0.0 — initial: extracts text per page via unpdf (pdfjs wrapper).

import { extractText, getDocumentProxy } from 'unpdf';
import { createLogger } from '../logger.js';

const log = createLogger('ResearchReportExtractor');

export const RESEARCH_EXTRACTOR_VERSION = '1.0.0';

export interface ExtractedResearchText {
  /** Extractor schema version — bump when the output shape changes. */
  extractorVersion: string;
  /** Concatenated plain text across all pages, pages separated by form-feed (\f). */
  text: string;
  /** Number of pages in the PDF. */
  pageCount: number;
  /** Best-effort title — first non-empty line of the first page, truncated. */
  inferredTitle?: string;
}

/** Trim to a single line up to `max` chars — used for inferred titles. */
function firstLine(text: string, max = 120): string | undefined {
  const trimmed = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!trimmed) return undefined;
  return trimmed.length > max ? trimmed.slice(0, max - 1).trimEnd() + '…' : trimmed;
}

/**
 * Extract plain text from a PDF buffer. Throws on malformed / encrypted PDFs
 * so the caller can surface a real error to the UI.
 */
export async function extractResearchText(buffer: Buffer): Promise<ExtractedResearchText> {
  // unpdf expects a Uint8Array. Convert from Node Buffer without copying.
  const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const pdf = await getDocumentProxy(bytes);
  const pageCount = pdf.numPages;

  // mergePages=false returns one string per page so we can format with clear
  // separators (form-feed) the UI can render as page breaks.
  const { text } = await extractText(pdf, { mergePages: false });
  const pages: string[] = Array.isArray(text) ? text : [text];
  const combined = pages.join('\n\f\n');

  const inferredTitle = firstLine(pages[0] ?? '');

  log.info(
    `Extracted text from PDF: ${pageCount} pages, ${combined.length} chars, title="${inferredTitle ?? '?'}"`
  );

  return {
    extractorVersion: RESEARCH_EXTRACTOR_VERSION,
    text: combined,
    pageCount,
    inferredTitle,
  };
}
