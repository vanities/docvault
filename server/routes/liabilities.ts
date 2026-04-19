// Manual liabilities route handlers — debts not tracked by SimpleFIN
// (equipment loans, private notes, future construction loans, etc.).
// Rolled into monthlyDebtService + DTI in financial-snapshot.

import { loadLiabilities, saveLiabilities, jsonResponse } from '../data.js';
import type { LiabilityEntry, LiabilityType } from '../data.js';

const VALID_TYPES: LiabilityType[] = [
  'equipment-loan',
  'auto-loan',
  'personal-loan',
  'student-loan',
  'mortgage',
  'construction-loan',
  'credit-line',
  'other',
];

export async function handleLiabilityRoutes(
  req: Request,
  _url: URL,
  pathname: string
): Promise<Response | null> {
  if (pathname === '/api/liabilities' && req.method === 'GET') {
    return jsonResponse(await loadLiabilities());
  }

  if (pathname === '/api/liabilities' && req.method === 'POST') {
    const body = await req.json();
    const {
      name,
      lender,
      type,
      originalBalance,
      balance,
      rate,
      monthlyPayment,
      termMonths,
      startDate,
      payoffDate,
      entity,
      notes,
    } = body;

    if (!name || balance == null || monthlyPayment == null || rate == null || !type) {
      return jsonResponse(
        { error: 'Missing required fields: name, type, balance, rate, monthlyPayment' },
        400
      );
    }
    if (!VALID_TYPES.includes(type)) {
      return jsonResponse(
        { error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` },
        400
      );
    }

    const data = await loadLiabilities();
    const entry: LiabilityEntry = {
      id: crypto.randomUUID(),
      name: name.trim(),
      lender: lender?.trim() || undefined,
      type,
      originalBalance: originalBalance != null ? Number(originalBalance) : undefined,
      balance: Number(balance),
      rate: Number(rate),
      monthlyPayment: Number(monthlyPayment),
      termMonths: termMonths != null ? Number(termMonths) : undefined,
      startDate: startDate?.trim() || undefined,
      payoffDate: payoffDate?.trim() || undefined,
      entity: entity?.trim() || undefined,
      notes: notes?.trim() || undefined,
      createdAt: new Date().toISOString(),
    };

    data.entries.push(entry);
    await saveLiabilities(data);
    return jsonResponse({ ok: true, entry });
  }

  const updateMatch = pathname.match(/^\/api\/liabilities\/([^/]+)$/);
  if (updateMatch && req.method === 'PUT') {
    const id = updateMatch[1];
    const body = await req.json();
    const data = await loadLiabilities();
    const idx = data.entries.findIndex((e) => e.id === id);
    if (idx === -1) return jsonResponse({ error: 'Liability not found' }, 404);

    if (body.type && !VALID_TYPES.includes(body.type)) {
      return jsonResponse(
        { error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` },
        400
      );
    }

    data.entries[idx] = { ...data.entries[idx], ...body, id };
    await saveLiabilities(data);
    return jsonResponse({ ok: true, entry: data.entries[idx] });
  }

  if (updateMatch && req.method === 'DELETE') {
    const id = updateMatch[1];
    const data = await loadLiabilities();
    const filtered = data.entries.filter((e) => e.id !== id);
    if (filtered.length === data.entries.length) {
      return jsonResponse({ error: 'Liability not found' }, 404);
    }
    data.entries = filtered;
    await saveLiabilities(data);
    return jsonResponse({ ok: true });
  }

  return null;
}
