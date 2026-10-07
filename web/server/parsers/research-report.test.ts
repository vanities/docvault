// Invented in-memory PDFs only. The upload buffer must survive PDF.js worker transfers.
import { Buffer } from 'node:buffer';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, test } from 'vite-plus/test';
import { extractResearchText } from './research-report';

describe('research PDF source preservation', () => {
  test('extracts the text without detaching or changing the original source bytes', async () => {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    document.addPage().drawText('Acme Synthetic Research', { x: 30, y: 500, size: 14, font });
    const bytes = await document.save();
    // Request.arrayBuffer() gives the route an owned, exact-size ArrayBuffer.
    // A pooled Node Buffer would conceal the worker-transfer bug.
    const upload = Buffer.from(new Uint8Array(bytes).buffer);
    const expected = Buffer.from(upload);
    const result = await extractResearchText(upload);
    expect(result.pageCount).toBe(1);
    expect(result.text).toContain('Acme Synthetic Research');
    expect(result.inferredTitle).toBe('Acme Synthetic Research');
    expect(upload).toEqual(expected);
  });

  test('preserves malformed PDF bytes when extraction fails so the saved source can be inspected', async () => {
    const upload = Buffer.from(
      new TextEncoder().encode('%PDF-1.4\nSynthetic malformed PDF').buffer
    );
    const expected = Buffer.from(upload);
    await expect(extractResearchText(upload)).rejects.toThrow();
    expect(upload).toEqual(expected);
  });
});
