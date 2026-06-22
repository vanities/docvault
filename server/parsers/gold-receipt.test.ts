// Regression tests for the gold-receipt buffer parser. `callClaude` (and, for
// the ordering guard, `readFileAsBase64`) are mocked so no Anthropic call or
// real image decode happens. All data here is fabricated (generic filename,
// synthetic line-items), so this test is safe to track in CI.
//
// The headline test guards a subtle async race: parseGoldReceiptFromBuffer
// writes the upload to a /tmp file, then parses it from that path. A missing
// `await` on parse() let the `finally` unlink the temp file before parse() read
// it — so EVERY mobile scan failed with ENOENT and surfaced to the user as the
// misleading "No gold purchases found in this receipt."

import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test';
import { existsSync } from 'node:fs';

import * as base from './base.js';
import { parseGoldReceiptFromBuffer } from './gold-receipt.js';

// Silence the module-level logger so tests don't spray to stderr. Must include
// `debug` — parseGoldReceiptFromBuffer logs the buffering step at debug level.
vi.mock('../logger.js', () => ({
  createLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
}));

type CallClaudeMock = ReturnType<typeof vi.fn>;

function mockToolResult(callClaude: CallClaudeMock, result: Record<string, unknown> | null): void {
  callClaude.mockResolvedValue({
    content: result
      ? [{ type: 'tool_use', name: 'extract_gold_receipt', input: result }]
      : [{ type: 'text', text: 'no tool output' }],
  } as unknown as Awaited<ReturnType<typeof base.callClaude>>);
}

const SAMPLE_RECEIPT = {
  items: [
    { productId: 'american-eagle', metal: 'gold', size: '1oz', quantity: 2, purchasePrice: 2450.5 },
  ],
  dealer: 'Acme Metals',
  total: 4901,
};

describe('parseGoldReceiptFromBuffer', () => {
  let callClaudeSpy: CallClaudeMock;

  beforeEach(() => {
    callClaudeSpy = vi
      .spyOn(base, 'callClaude')
      .mockResolvedValue({ content: [] } as unknown as Awaited<
        ReturnType<typeof base.callClaude>
      >) as unknown as CallClaudeMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // THE REGRESSION GUARD — deterministic, independent of fs read latency.
  // We replace readFileAsBase64 with a stub that defers one macrotask and then
  // records whether the temp file still exists. With the un-awaited bug, the
  // `finally` unlinks the temp file synchronously (at t=0) before this stub
  // runs, so the file is already gone (in production the real read ENOENTs
  // here). The fix awaits parse(), deferring cleanup until after the read.
  //
  // Note: this asserts ordering, NOT real fs timing — a test that depends on
  // the threadpool winning/losing the race can pass on broken code.
  test('temp file survives until the parser reads it (await regression)', async () => {
    let tempFileExistedDuringRead: boolean | null = null;
    vi.spyOn(base, 'readFileAsBase64').mockImplementation(async (filePath: string) => {
      await new Promise((resolve) => setTimeout(resolve, 10)); // force a real async gap
      tempFileExistedDuringRead = existsSync(filePath);
      return {
        base64: '',
        mimeType: 'image/jpeg',
        mediaType: 'image/jpeg',
      } as Awaited<ReturnType<typeof base.readFileAsBase64>>;
    });
    mockToolResult(callClaudeSpy, SAMPLE_RECEIPT);

    const bytes = new TextEncoder().encode('fake-jpeg-bytes');
    const result = await parseGoldReceiptFromBuffer(bytes.buffer, 'IMG_4081.jpeg');

    expect(tempFileExistedDuringRead).toBe(true);
    expect(result).not.toBeNull();
    expect(result!.items?.[0].productId).toBe('american-eagle');
  });

  // Happy path through the real file read: write → read → parse → stamp.
  test('parses a receipt buffer into structured items', async () => {
    mockToolResult(callClaudeSpy, SAMPLE_RECEIPT);
    const bytes = new TextEncoder().encode('fake-jpeg-bytes');
    const result = await parseGoldReceiptFromBuffer(bytes.buffer, 'IMG_4081.jpeg');

    expect(result).not.toBeNull();
    expect(result!.items).toHaveLength(1);
    expect(result!.dealer).toBe('Acme Metals');
    expect(callClaudeSpy).toHaveBeenCalledTimes(1);
  });

  test('returns null when Claude omits the tool-use block', async () => {
    mockToolResult(callClaudeSpy, null);
    const bytes = new TextEncoder().encode('fake-pdf-bytes');
    const result = await parseGoldReceiptFromBuffer(bytes.buffer, 'receipt.pdf');

    expect(result).toBeNull();
  });
});
