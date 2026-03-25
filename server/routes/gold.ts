// Gold route handlers.
// Extracted from server/index.ts.

import { promises as fs } from 'fs';
import path from 'path';
import { loadGoldData, saveGoldData, fetchMetalSpotPrices, jsonResponse, ensureDir, corsHeaders, GOLD_RECEIPTS_DIR, DATA_DIR } from '../data.js';
import { parseGoldReceiptFromBuffer } from '../parsers/gold-receipt.js';

export async function handleGoldRoutes(
  req: Request,
  url: URL,
  pathname: string
): Promise<Response | null> {


  // ========================================================================
  // Gold / Precious Metals API
  // ========================================================================

  // GET /api/gold - Get all gold entries + spot prices
  if (pathname === '/api/gold' && req.method === 'GET') {
    const [data, spotPrices] = await Promise.all([loadGoldData(), fetchMetalSpotPrices()]);
    return jsonResponse({ ...data, spotPrices });
  }

  // GET /api/gold/spot - Get current spot prices only
  if (pathname === '/api/gold/spot' && req.method === 'GET') {
    const spotPrices = await fetchMetalSpotPrices();
    return jsonResponse({ ...spotPrices, lastUpdated: new Date().toISOString() });
  }

  // POST /api/gold - Create a new gold entry
  if (pathname === '/api/gold' && req.method === 'POST') {
    const body = await req.json();
    const {
      metal,
      productId,
      customDescription,
      coinYear,
      size,
      weightOz,
      purity,
      purchasePrice,
      purchaseDate,
      dealer,
      quantity,
      notes,
    } = body;

    if (
      !metal ||
      !productId ||
      !size ||
      !weightOz ||
      !purity ||
      !purchasePrice ||
      !purchaseDate ||
      !quantity
    ) {
      return jsonResponse({ error: 'Missing required fields' }, 400);
    }

    const data = await loadGoldData();
    const entry: GoldEntry = {
      id: crypto.randomUUID(),
      metal,
      productId,
      customDescription: customDescription?.trim() || undefined,
      coinYear: coinYear ? Number(coinYear) : undefined,
      size,
      weightOz: Number(weightOz),
      purity: Number(purity),
      purchasePrice: Number(purchasePrice),
      purchaseDate,
      dealer: dealer?.trim() || undefined,
      quantity: Number(quantity),
      notes: notes?.trim() || undefined,
      createdAt: new Date().toISOString(),
    };

    data.entries.push(entry);
    await saveGoldData(data);
    return jsonResponse({ ok: true, entry });
  }

  // PUT /api/gold/:id - Update a gold entry
  const goldUpdateMatch = pathname.match(/^\/api\/gold\/([^/]+)$/);
  if (goldUpdateMatch && req.method === 'PUT') {
    const entryId = goldUpdateMatch[1];
    const body = await req.json();
    const data = await loadGoldData();
    const idx = data.entries.findIndex((e) => e.id === entryId);
    if (idx === -1) return jsonResponse({ error: 'Entry not found' }, 404);

    data.entries[idx] = { ...data.entries[idx], ...body, id: entryId };
    await saveGoldData(data);
    return jsonResponse({ ok: true, entry: data.entries[idx] });
  }

  // DELETE /api/gold/:id - Delete a gold entry
  const goldDeleteMatch = pathname.match(/^\/api\/gold\/([^/]+)$/);
  if (goldDeleteMatch && req.method === 'DELETE') {
    const entryId = goldDeleteMatch[1];
    const data = await loadGoldData();
    const filtered = data.entries.filter((e) => e.id !== entryId);
    if (filtered.length === data.entries.length) {
      return jsonResponse({ error: 'Entry not found' }, 404);
    }
    data.entries = filtered;
    await saveGoldData(data);
    return jsonResponse({ ok: true });
  }

  // POST /api/gold/:id/receipt - Upload a receipt for a gold entry
  const goldReceiptUploadMatch = pathname.match(/^\/api\/gold\/([^/]+)\/receipt$/);
  if (goldReceiptUploadMatch && req.method === 'POST') {
    const entryId = goldReceiptUploadMatch[1];
    const data = await loadGoldData();
    const entry = data.entries.find((e) => e.id === entryId);
    if (!entry) return jsonResponse({ error: 'Entry not found' }, 404);

    const body = await req.arrayBuffer();
    const filename = url.searchParams.get('filename') || 'receipt.pdf';
    const ext = filename.split('.').pop()?.toLowerCase() || 'pdf';
    const receiptFilename = `${entryId}.${ext}`;

    await fs.mkdir(GOLD_RECEIPTS_DIR, { recursive: true });
    await fs.writeFile(path.join(GOLD_RECEIPTS_DIR, receiptFilename), Buffer.from(body));

    entry.receiptPath = receiptFilename;
    await saveGoldData(data);
    return jsonResponse({ ok: true, receiptPath: receiptFilename });
  }

  // GET /api/gold/:id/receipt - Serve a receipt file
  const goldReceiptGetMatch = pathname.match(/^\/api\/gold\/([^/]+)\/receipt$/);
  if (goldReceiptGetMatch && req.method === 'GET') {
    const entryId = goldReceiptGetMatch[1];
    const data = await loadGoldData();
    const entry = data.entries.find((e) => e.id === entryId);
    if (!entry?.receiptPath) return jsonResponse({ error: 'No receipt' }, 404);

    const filePath = path.join(GOLD_RECEIPTS_DIR, entry.receiptPath);
    try {
      const file = Bun.file(filePath);
      if (!(await file.exists())) return jsonResponse({ error: 'File not found' }, 404);
      return new Response(file, {
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch {
      return jsonResponse({ error: 'File not found' }, 404);
    }
  }

  // DELETE /api/gold/:id/receipt - Remove a receipt from a gold entry
  const goldReceiptDeleteMatch = pathname.match(/^\/api\/gold\/([^/]+)\/receipt$/);
  if (goldReceiptDeleteMatch && req.method === 'DELETE') {
    const entryId = goldReceiptDeleteMatch[1];
    const data = await loadGoldData();
    const entry = data.entries.find((e) => e.id === entryId);
    if (!entry) return jsonResponse({ error: 'Entry not found' }, 404);

    if (entry.receiptPath) {
      try {
        await fs.unlink(path.join(GOLD_RECEIPTS_DIR, entry.receiptPath));
      } catch {
        // File may already be gone
      }
      delete entry.receiptPath;
      await saveGoldData(data);
    }
    return jsonResponse({ ok: true });
  }

  // POST /api/gold/parse-receipt - AI parse a receipt to extract gold purchase info
  if (pathname === '/api/gold/parse-receipt' && req.method === 'POST') {
    try {
      const body = await req.arrayBuffer();
      const filename = url.searchParams.get('filename') || 'receipt.pdf';

      const { parseGoldReceiptFromBuffer } = await import('./parsers/gold-receipt.js');
      const parsed = await parseGoldReceiptFromBuffer(body, filename);

      if (!parsed) {
        return jsonResponse({ error: 'Failed to parse receipt' }, 500);
      }

      // Strip parser metadata, return in the format the frontend expects
      const { _documentType, _parserVersion, _parsedWith, ...data } = parsed;
      console.log('[Gold AI] Parsed receipt:', JSON.stringify(data, null, 2));
      return jsonResponse({ ok: true, ...data });
    } catch (err) {
      console.error('[Gold AI] Parse error:', err);
      return jsonResponse({ error: 'Failed to parse receipt', details: String(err) }, 500);
    }
  }
  return null;
}
