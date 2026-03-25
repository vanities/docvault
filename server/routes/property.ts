// Property route handlers.
// Extracted from server/index.ts.

import { promises as fs } from 'fs';
import path from 'path';
import { loadPropertyData, savePropertyData, jsonResponse } from '../data.js';

export async function handlePropertyRoutes(
  req: Request,
  url: URL,
  pathname: string
): Promise<Response | null> {


  // ========================================================================
  // Property / Real Estate API
  // ========================================================================

  // GET /api/property - Get all property entries
  if (pathname === '/api/property' && req.method === 'GET') {
    const data = await loadPropertyData();
    return jsonResponse(data);
  }

  // POST /api/property - Create a new property entry
  if (pathname === '/api/property' && req.method === 'POST') {
    const body = await req.json();
    const {
      name,
      type,
      address,
      acreage,
      squareFeet,
      purchaseDate,
      purchasePrice,
      currentValue,
      annualPropertyTax,
      mortgage,
      notes,
    } = body;

    if (
      !name ||
      !type ||
      !address ||
      !purchaseDate ||
      purchasePrice == null ||
      currentValue == null
    ) {
      return jsonResponse({ error: 'Missing required fields' }, 400);
    }

    const data = await loadPropertyData();
    const entry: PropertyEntry = {
      id: crypto.randomUUID(),
      name: name.trim(),
      type,
      address,
      acreage: acreage ? Number(acreage) : undefined,
      squareFeet: squareFeet ? Number(squareFeet) : undefined,
      purchaseDate,
      purchasePrice: Number(purchasePrice),
      currentValue: Number(currentValue),
      currentValueDate: new Date().toISOString().split('T')[0],
      annualPropertyTax: annualPropertyTax ? Number(annualPropertyTax) : undefined,
      mortgage: mortgage?.lender
        ? {
            lender: mortgage.lender,
            balance: Number(mortgage.balance || 0),
            rate: Number(mortgage.rate || 0),
            monthlyPayment: Number(mortgage.monthlyPayment || 0),
          }
        : undefined,
      notes: notes?.trim() || undefined,
      createdAt: new Date().toISOString(),
    };

    data.entries.push(entry);
    await savePropertyData(data);
    return jsonResponse({ ok: true, entry });
  }

  // PUT /api/property/:id - Update a property entry
  const propertyUpdateMatch = pathname.match(/^\/api\/property\/([^/]+)$/);
  if (propertyUpdateMatch && req.method === 'PUT') {
    const entryId = propertyUpdateMatch[1];
    const body = await req.json();
    const data = await loadPropertyData();
    const idx = data.entries.findIndex((e) => e.id === entryId);
    if (idx === -1) return jsonResponse({ error: 'Property not found' }, 404);

    // Update currentValueDate if currentValue changed
    if (body.currentValue !== undefined && body.currentValue !== data.entries[idx].currentValue) {
      body.currentValueDate = new Date().toISOString().split('T')[0];
    }

    data.entries[idx] = { ...data.entries[idx], ...body, id: entryId };
    await savePropertyData(data);
    return jsonResponse({ ok: true, entry: data.entries[idx] });
  }

  // DELETE /api/property/:id - Delete a property entry
  const propertyDeleteMatch = pathname.match(/^\/api\/property\/([^/]+)$/);
  if (propertyDeleteMatch && req.method === 'DELETE') {
    const entryId = propertyDeleteMatch[1];
    const data = await loadPropertyData();
    const filtered = data.entries.filter((e) => e.id !== entryId);
    if (filtered.length === data.entries.length) {
      return jsonResponse({ error: 'Property not found' }, 404);
    }
    data.entries = filtered;
    await savePropertyData(data);
    return jsonResponse({ ok: true });
  }
  return null;
}
