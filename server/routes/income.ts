// Additional income route handlers — recurring income not captured by parsed docs or bank statements.

import { loadIncomeData, saveIncomeData, jsonResponse } from '../data.js';
import type { IncomeSource } from '../data.js';

export async function handleIncomeRoutes(
  req: Request,
  _url: URL,
  pathname: string
): Promise<Response | null> {
  // GET /api/income - Get all income sources
  if (pathname === '/api/income' && req.method === 'GET') {
    const data = await loadIncomeData();
    return jsonResponse(data);
  }

  // POST /api/income - Create a new income source
  if (pathname === '/api/income' && req.method === 'POST') {
    const body = await req.json();
    const { name, amount, frequency, taxable, entity, notes } = body;

    if (!name || amount == null || !frequency) {
      return jsonResponse({ error: 'Missing required fields: name, amount, frequency' }, 400);
    }

    const validFrequencies = ['monthly', 'biweekly', 'weekly', 'quarterly', 'annually'];
    if (!validFrequencies.includes(frequency)) {
      return jsonResponse(
        { error: `Invalid frequency. Must be one of: ${validFrequencies.join(', ')}` },
        400
      );
    }

    const data = await loadIncomeData();
    const source: IncomeSource = {
      id: crypto.randomUUID(),
      name: name.trim(),
      amount: Number(amount),
      frequency,
      taxable: taxable !== false,
      entity: entity?.trim() || undefined,
      notes: notes?.trim() || undefined,
      createdAt: new Date().toISOString(),
    };

    data.sources.push(source);
    await saveIncomeData(data);
    return jsonResponse({ ok: true, source });
  }

  // PUT /api/income/:id - Update an income source
  const updateMatch = pathname.match(/^\/api\/income\/([^/]+)$/);
  if (updateMatch && req.method === 'PUT') {
    const id = updateMatch[1];
    const body = await req.json();
    const data = await loadIncomeData();
    const idx = data.sources.findIndex((s) => s.id === id);
    if (idx === -1) return jsonResponse({ error: 'Income source not found' }, 404);

    data.sources[idx] = { ...data.sources[idx], ...body, id };
    await saveIncomeData(data);
    return jsonResponse({ ok: true, source: data.sources[idx] });
  }

  // DELETE /api/income/:id - Delete an income source
  const deleteMatch = pathname.match(/^\/api\/income\/([^/]+)$/);
  if (deleteMatch && req.method === 'DELETE') {
    const id = deleteMatch[1];
    const data = await loadIncomeData();
    const filtered = data.sources.filter((s) => s.id !== id);
    if (filtered.length === data.sources.length) {
      return jsonResponse({ error: 'Income source not found' }, 404);
    }
    data.sources = filtered;
    await saveIncomeData(data);
    return jsonResponse({ ok: true });
  }

  return null;
}
