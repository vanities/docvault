// Timesheet route handlers — clients / projects / entries CRUD, rollup
// summary, and the mark-invoiced action. Invoice PDF generation lives in
// server/timesheet-invoice.ts (POST /api/timesheet/invoice).

import { jsonResponse } from '../data.js';
import { readJsonBody } from '../http.js';
import {
  loadTimesheetStore,
  saveTimesheetStore,
  spanMinutes,
  isValidTime,
  isValidDate,
  entryAmount,
  type TimesheetEntry,
} from '../timesheet-store.js';
import { buildInvoicePdf } from '../timesheet-invoice.js';
import { createLogger } from '../logger.js';

const log = createLogger('Timesheet');

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Unique id derived from a display name; suffixes on collision. */
function uniqueId(name: string, taken: Set<string>): string {
  const base = slug(name) || 'item';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

export async function handleTimesheetRoutes(
  req: Request,
  url: URL,
  pathname: string
): Promise<Response | null> {
  if (!pathname.startsWith('/api/timesheet')) return null;

  // GET /api/timesheet - full store (clients + projects + entries)
  if (pathname === '/api/timesheet' && req.method === 'GET') {
    return jsonResponse(await loadTimesheetStore());
  }

  // ==========================================================================
  // Entries
  // ==========================================================================

  // POST /api/timesheet/entries - log a completed entry (manual start/end)
  if (pathname === '/api/timesheet/entries' && req.method === 'POST') {
    const body = await readJsonBody<{
      projectId?: string;
      date?: string;
      start?: string;
      end?: string;
      description?: string;
      hourlyRate?: number; // optional override; defaults to project rate
      billable?: boolean;
    }>(req);
    const { projectId, date, start, end } = body;
    if (!projectId || !date || !start || !end) {
      return jsonResponse({ error: 'Missing projectId, date, start, or end' }, 400);
    }
    if (!isValidDate(date)) return jsonResponse({ error: 'Invalid date (want YYYY-MM-DD)' }, 400);
    if (!isValidTime(start) || !isValidTime(end)) {
      return jsonResponse({ error: 'Invalid start/end (want HH:MM)' }, 400);
    }
    const store = await loadTimesheetStore();
    const project = store.projects.find((p) => p.id === projectId);
    if (!project) return jsonResponse({ error: 'Project not found' }, 404);

    const durationMinutes = spanMinutes(start, end);
    if (durationMinutes === 0) return jsonResponse({ error: 'Zero-length entry' }, 400);
    const billable = body.billable !== false;
    const hourlyRate = body.hourlyRate !== undefined ? Number(body.hourlyRate) : project.hourlyRate;
    const entry: TimesheetEntry = {
      id: crypto.randomUUID(),
      projectId,
      date,
      start,
      end,
      durationMinutes,
      description: body.description?.trim() || '',
      hourlyRate,
      amount: entryAmount(durationMinutes, hourlyRate, billable),
      billable,
      invoiced: false,
    };
    store.entries.push(entry);
    await saveTimesheetStore(store);
    log.info(`[entry] logged ${durationMinutes}min on project=${projectId} date=${date}`);
    return jsonResponse({ ok: true, entry });
  }

  // PUT /api/timesheet/entries/:id - edit an entry
  const entryMatch = pathname.match(/^\/api\/timesheet\/entries\/([^/]+)$/);
  if (entryMatch && req.method === 'PUT') {
    const body = await readJsonBody<{
      projectId?: string;
      date?: string;
      start?: string;
      end?: string;
      description?: string;
      hourlyRate?: number;
      billable?: boolean;
      invoiced?: boolean;
    }>(req);
    const store = await loadTimesheetStore();
    const entry = store.entries.find((e) => e.id === entryMatch[1]);
    if (!entry) return jsonResponse({ error: 'Entry not found' }, 404);

    if (body.projectId !== undefined) {
      if (!store.projects.some((p) => p.id === body.projectId)) {
        return jsonResponse({ error: 'Project not found' }, 404);
      }
      entry.projectId = body.projectId;
    }
    if (body.date !== undefined) {
      if (!isValidDate(body.date)) return jsonResponse({ error: 'Invalid date' }, 400);
      entry.date = body.date;
    }
    if (body.start !== undefined) {
      if (!isValidTime(body.start)) return jsonResponse({ error: 'Invalid start' }, 400);
      entry.start = body.start;
    }
    if (body.end !== undefined) {
      if (!isValidTime(body.end)) return jsonResponse({ error: 'Invalid end' }, 400);
      entry.end = body.end;
    }
    if (body.description !== undefined) entry.description = body.description.trim();
    if (body.hourlyRate !== undefined) entry.hourlyRate = Number(body.hourlyRate);
    if (body.billable !== undefined) entry.billable = body.billable;
    if (body.invoiced !== undefined) {
      entry.invoiced = body.invoiced;
      if (body.invoiced) entry.invoicedAt = new Date().toISOString();
      else delete entry.invoicedAt;
    }
    // Re-derive: duration from times, amount from duration/rate/billable.
    entry.durationMinutes = spanMinutes(entry.start, entry.end);
    if (entry.durationMinutes === 0) return jsonResponse({ error: 'Zero-length entry' }, 400);
    entry.amount = entryAmount(entry.durationMinutes, entry.hourlyRate, entry.billable);
    await saveTimesheetStore(store);
    return jsonResponse({ ok: true, entry });
  }

  // DELETE /api/timesheet/entries/:id
  if (entryMatch && req.method === 'DELETE') {
    const store = await loadTimesheetStore();
    const before = store.entries.length;
    store.entries = store.entries.filter((e) => e.id !== entryMatch[1]);
    if (store.entries.length === before) return jsonResponse({ error: 'Entry not found' }, 404);
    await saveTimesheetStore(store);
    return jsonResponse({ ok: true });
  }

  // POST /api/timesheet/mark-invoiced - flip a batch of entries to invoiced
  if (pathname === '/api/timesheet/mark-invoiced' && req.method === 'POST') {
    const body = await readJsonBody<{ entryIds?: string[] }>(req);
    if (!Array.isArray(body.entryIds) || body.entryIds.length === 0) {
      return jsonResponse({ error: 'Missing entryIds' }, 400);
    }
    const store = await loadTimesheetStore();
    const ids = new Set(body.entryIds);
    const now = new Date().toISOString();
    let updated = 0;
    for (const entry of store.entries) {
      if (ids.has(entry.id) && !entry.invoiced) {
        entry.invoiced = true;
        entry.invoicedAt = now;
        updated++;
      }
    }
    await saveTimesheetStore(store);
    log.info(`[invoice] marked ${updated}/${body.entryIds.length} entries invoiced`);
    return jsonResponse({ ok: true, updated });
  }

  // POST /api/timesheet/invoice - render an invoice PDF for a client's
  // uninvoiced billable entries (or an explicit entryIds subset). Does NOT
  // flip the invoiced flag — review the PDF first, then mark-invoiced.
  if (pathname === '/api/timesheet/invoice' && req.method === 'POST') {
    const body = await readJsonBody<{
      clientId?: string;
      entryIds?: string[];
      invoiceNumber?: string;
      from?: string[];
      notes?: string;
    }>(req);
    if (!body.clientId) return jsonResponse({ error: 'Missing clientId' }, 400);
    const store = await loadTimesheetStore();
    const client = store.clients.find((c) => c.id === body.clientId);
    if (!client) return jsonResponse({ error: 'Client not found' }, 404);
    const projectById = new Map(store.projects.map((p) => [p.id, p] as const));

    const wanted = body.entryIds ? new Set(body.entryIds) : null;
    const entries = store.entries
      .filter((e) => {
        if (projectById.get(e.projectId)?.clientId !== body.clientId) return false;
        if (wanted) return wanted.has(e.id);
        return !e.invoiced && e.billable;
      })
      .sort((a, b) =>
        a.date === b.date ? a.start.localeCompare(b.start) : a.date.localeCompare(b.date)
      );
    if (entries.length === 0) return jsonResponse({ error: 'No entries to invoice' }, 400);

    const issueDate = new Date().toISOString().slice(0, 10);
    const invoiceNumber =
      body.invoiceNumber?.trim() || `${issueDate.replace(/-/g, '')}-${client.id}`;
    const pdf = await buildInvoicePdf({
      invoiceNumber,
      issueDate,
      clientName: client.name,
      currency: client.currency || 'USD',
      from: body.from,
      notes: body.notes,
      lines: entries.map((e) => ({
        date: e.date,
        description: e.description,
        projectName: projectById.get(e.projectId)?.name ?? e.projectId,
        minutes: e.durationMinutes,
        hourlyRate: e.hourlyRate,
        amount: e.amount,
      })),
    });
    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Invoice_${client.id}_${issueDate}.pdf"`,
      },
    });
  }

  // ==========================================================================
  // Clients
  // ==========================================================================

  // POST /api/timesheet/clients
  if (pathname === '/api/timesheet/clients' && req.method === 'POST') {
    const body = await readJsonBody<{ name?: string; currency?: string }>(req);
    if (!body.name?.trim()) return jsonResponse({ error: 'Missing name' }, 400);
    const store = await loadTimesheetStore();
    const client = {
      id: uniqueId(body.name, new Set(store.clients.map((c) => c.id))),
      name: body.name.trim(),
      currency: body.currency?.trim().toUpperCase() || 'USD',
      archived: false,
    };
    store.clients.push(client);
    await saveTimesheetStore(store);
    return jsonResponse({ ok: true, client });
  }

  // PUT /api/timesheet/clients/:id
  const clientMatch = pathname.match(/^\/api\/timesheet\/clients\/([^/]+)$/);
  if (clientMatch && req.method === 'PUT') {
    const body = await readJsonBody<{ name?: string; currency?: string; archived?: boolean }>(req);
    const store = await loadTimesheetStore();
    const client = store.clients.find((c) => c.id === clientMatch[1]);
    if (!client) return jsonResponse({ error: 'Client not found' }, 404);
    if (body.name !== undefined) client.name = body.name.trim();
    if (body.currency !== undefined) client.currency = body.currency.trim().toUpperCase();
    if (body.archived !== undefined) client.archived = body.archived;
    await saveTimesheetStore(store);
    return jsonResponse({ ok: true, client });
  }

  // DELETE /api/timesheet/clients/:id - only when no projects reference it
  if (clientMatch && req.method === 'DELETE') {
    const store = await loadTimesheetStore();
    if (!store.clients.some((c) => c.id === clientMatch[1])) {
      return jsonResponse({ error: 'Client not found' }, 404);
    }
    if (store.projects.some((p) => p.clientId === clientMatch[1])) {
      return jsonResponse({ error: 'Client has projects — archive it instead' }, 409);
    }
    store.clients = store.clients.filter((c) => c.id !== clientMatch[1]);
    await saveTimesheetStore(store);
    return jsonResponse({ ok: true });
  }

  // ==========================================================================
  // Projects
  // ==========================================================================

  // POST /api/timesheet/projects
  if (pathname === '/api/timesheet/projects' && req.method === 'POST') {
    const body = await readJsonBody<{ clientId?: string; name?: string; hourlyRate?: number }>(req);
    if (!body.name?.trim() || !body.clientId) {
      return jsonResponse({ error: 'Missing name or clientId' }, 400);
    }
    const store = await loadTimesheetStore();
    if (!store.clients.some((c) => c.id === body.clientId)) {
      return jsonResponse({ error: 'Client not found' }, 404);
    }
    const project = {
      id: uniqueId(body.name, new Set(store.projects.map((p) => p.id))),
      clientId: body.clientId,
      name: body.name.trim(),
      hourlyRate: body.hourlyRate !== undefined ? Number(body.hourlyRate) : 0,
      archived: false,
    };
    store.projects.push(project);
    await saveTimesheetStore(store);
    return jsonResponse({ ok: true, project });
  }

  // PUT /api/timesheet/projects/:id — rate changes affect FUTURE entries only
  const projectMatch = pathname.match(/^\/api\/timesheet\/projects\/([^/]+)$/);
  if (projectMatch && req.method === 'PUT') {
    const body = await readJsonBody<{
      name?: string;
      clientId?: string;
      hourlyRate?: number;
      archived?: boolean;
    }>(req);
    const store = await loadTimesheetStore();
    const project = store.projects.find((p) => p.id === projectMatch[1]);
    if (!project) return jsonResponse({ error: 'Project not found' }, 404);
    if (body.clientId !== undefined) {
      if (!store.clients.some((c) => c.id === body.clientId)) {
        return jsonResponse({ error: 'Client not found' }, 404);
      }
      project.clientId = body.clientId;
    }
    if (body.name !== undefined) project.name = body.name.trim();
    if (body.hourlyRate !== undefined) project.hourlyRate = Number(body.hourlyRate);
    if (body.archived !== undefined) project.archived = body.archived;
    await saveTimesheetStore(store);
    return jsonResponse({ ok: true, project });
  }

  // DELETE /api/timesheet/projects/:id - only when no entries reference it
  if (projectMatch && req.method === 'DELETE') {
    const store = await loadTimesheetStore();
    if (!store.projects.some((p) => p.id === projectMatch[1])) {
      return jsonResponse({ error: 'Project not found' }, 404);
    }
    if (store.entries.some((e) => e.projectId === projectMatch[1])) {
      return jsonResponse({ error: 'Project has entries — archive it instead' }, 409);
    }
    store.projects = store.projects.filter((p) => p.id !== projectMatch[1]);
    await saveTimesheetStore(store);
    return jsonResponse({ ok: true });
  }

  // ==========================================================================
  // Summary rollup
  // ==========================================================================

  // GET /api/timesheet/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
  // Rollups over the window (default: all time) plus the uninvoiced totals
  // (always all-time — pending billing has no date window).
  if (pathname === '/api/timesheet/summary' && req.method === 'GET') {
    const from = url.searchParams.get('from') ?? '';
    const to = url.searchParams.get('to') ?? '';
    const store = await loadTimesheetStore();
    const projectById = new Map(store.projects.map((p) => [p.id, p] as const));

    const inWindow = store.entries.filter(
      (e) => (from === '' || e.date >= from) && (to === '' || e.date <= to)
    );

    const byProject = new Map<string, { minutes: number; amount: number; entries: number }>();
    for (const e of inWindow) {
      const agg = byProject.get(e.projectId) ?? { minutes: 0, amount: 0, entries: 0 };
      agg.minutes += e.durationMinutes;
      agg.amount += e.amount;
      agg.entries += 1;
      byProject.set(e.projectId, agg);
    }

    const uninvoicedByClient = new Map<
      string,
      { minutes: number; amount: number; entries: number }
    >();
    for (const e of store.entries) {
      if (e.invoiced || !e.billable) continue;
      const clientId = projectById.get(e.projectId)?.clientId ?? 'unknown';
      const agg = uninvoicedByClient.get(clientId) ?? { minutes: 0, amount: 0, entries: 0 };
      agg.minutes += e.durationMinutes;
      agg.amount += e.amount;
      agg.entries += 1;
      uninvoicedByClient.set(clientId, agg);
    }

    const round2 = (n: number) => Math.round(n * 100) / 100;
    return jsonResponse({
      window: { from: from || null, to: to || null },
      totalMinutes: inWindow.reduce((s, e) => s + e.durationMinutes, 0),
      totalAmount: round2(inWindow.reduce((s, e) => s + e.amount, 0)),
      projects: [...byProject.entries()].map(([projectId, agg]) => ({
        projectId,
        clientId: projectById.get(projectId)?.clientId ?? null,
        minutes: agg.minutes,
        amount: round2(agg.amount),
        entries: agg.entries,
      })),
      uninvoiced: [...uninvoicedByClient.entries()].map(([clientId, agg]) => ({
        clientId,
        minutes: agg.minutes,
        amount: round2(agg.amount),
        entries: agg.entries,
      })),
    });
  }

  return null;
}
