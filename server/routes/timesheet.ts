// Timesheet route handlers — clients / projects / entries CRUD, rollup
// summary, and the mark-invoiced action. Invoice PDF generation lives in
// server/timesheet-invoice.ts (POST /api/timesheet/invoice).

import path from 'path';
import { promises as fs } from 'fs';
import { jsonResponse, getEntityPath, resolveUnder, ensureDir, loadSettings } from '../data.js';
import { sendEmail } from '../email.js';
import { readJsonBody } from '../http.js';
import {
  loadTimesheetStore,
  saveTimesheetStore,
  spanMinutes,
  isValidTime,
  isValidDate,
  entryAmount,
  nextInvoiceNumber,
  type Invoice,
  type InvoiceTemplate,
  type TimesheetEntry,
  type TimesheetStore,
} from '../timesheet-store.js';
import { buildInvoicePdf } from '../timesheet-invoice.js';
import {
  normalizeWeeklyReportConfig,
  weekWindow,
  collectReportRows,
  categoryTotals,
  buildReportCsv,
  buildReportHtml,
  sendWeeklyReport,
} from '../timesheet-report.js';
import { armWeeklyReportTimer } from '../scheduler.js';
import { zonedYMD, getConfiguredTimezone } from '../tz.js';
import { createLogger } from '../logger.js';

const log = createLogger('Timesheet');

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Normalize a color field: valid hex passes, '' clears, anything else is
 * rejected by returning undefined alongside `ok: false`. */
function parseColor(value: unknown): { ok: boolean; color?: string } {
  if (value === '' || value === null) return { ok: true }; // clear
  if (typeof value === 'string' && HEX_COLOR.test(value)) return { ok: true, color: value };
  return { ok: false };
}

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

  // ==========================================================================
  // Invoices — persisted records with line snapshots (billing history)
  // ==========================================================================

  const invoiceResult = await handleInvoiceRoutes(req, pathname);
  if (invoiceResult) return invoiceResult;

  const templateResult = await handleTemplateRoutes(req, pathname);
  if (templateResult) return templateResult;

  const weeklyReportResult = await handleWeeklyReportRoutes(req, url, pathname);
  if (weeklyReportResult) return weeklyReportResult;

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
    const body = await readJsonBody<{
      name?: string;
      currency?: string;
      color?: string;
      defaultTemplateId?: string;
      dueDays?: number | null;
      email?: string;
      autoFileEntityId?: string;
      archived?: boolean;
    }>(req);
    const store = await loadTimesheetStore();
    const client = store.clients.find((c) => c.id === clientMatch[1]);
    if (!client) return jsonResponse({ error: 'Client not found' }, 404);
    if (body.name !== undefined) client.name = body.name.trim();
    if (body.currency !== undefined) client.currency = body.currency.trim().toUpperCase();
    if (body.color !== undefined) {
      const parsed = parseColor(body.color);
      if (!parsed.ok) return jsonResponse({ error: 'Invalid color (want #rrggbb)' }, 400);
      if (parsed.color) client.color = parsed.color;
      else delete client.color;
    }
    if (body.defaultTemplateId !== undefined) {
      if (!body.defaultTemplateId) delete client.defaultTemplateId;
      else if (store.templates.some((t) => t.id === body.defaultTemplateId)) {
        client.defaultTemplateId = body.defaultTemplateId;
      } else {
        return jsonResponse({ error: 'Template not found' }, 404);
      }
    }
    if (body.dueDays !== undefined) {
      const days = Number(body.dueDays);
      if (body.dueDays === null || Number.isNaN(days) || days <= 0) delete client.dueDays;
      else client.dueDays = Math.round(days);
    }
    if (body.email !== undefined) {
      const email = body.email.trim();
      if (!email) delete client.email;
      else {
        // Comma/semicolon-separated lists are allowed (multiple recipients);
        // every piece must look like an address.
        const parts = email
          .split(/[,;]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        const valid = parts.length > 0 && parts.every((p) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p));
        if (!valid) return jsonResponse({ error: 'Invalid email (comma-separate multiple)' }, 400);
        client.email = parts.join(', ');
      }
    }
    if (body.autoFileEntityId !== undefined) {
      if (!body.autoFileEntityId) delete client.autoFileEntityId;
      else client.autoFileEntityId = body.autoFileEntityId;
    }
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
      color?: string;
      minimumInvoice?: number | null;
      emailTo?: string;
      emailFrom?: string;
      emailSubject?: string;
      emailBody?: string;
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
    if (body.color !== undefined) {
      const parsed = parseColor(body.color);
      if (!parsed.ok) return jsonResponse({ error: 'Invalid color (want #rrggbb)' }, 400);
      if (parsed.color) project.color = parsed.color;
      else delete project.color;
    }
    if (body.minimumInvoice !== undefined) {
      const min = Number(body.minimumInvoice);
      if (body.minimumInvoice === null || Number.isNaN(min) || min <= 0) {
        delete project.minimumInvoice;
      } else {
        project.minimumInvoice = min;
      }
    }
    // Email template fields: '' clears, otherwise stored verbatim (with
    // {{placeholders}} intact — substitution happens at draft time).
    for (const key of ['emailTo', 'emailFrom', 'emailSubject', 'emailBody'] as const) {
      if (body[key] !== undefined) {
        const value = body[key]!.trim();
        if (value) project[key] = value;
        else delete project[key];
      }
    }
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

// ============================================================================
// Invoice creation core
// ============================================================================

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

interface CreateInvoiceBody {
  clientId?: string;
  entryIds?: string[]; // explicit selection; otherwise from/to window
  projectId?: string; // bill only this project's entries
  from?: string; // date window over uninvoiced billable entries
  to?: string;
  templateId?: string;
  number?: string;
  comment?: string;
}

/** Assemble an Invoice record (+ the entries it bills) from a request body.
 * Pure over the loaded store — persistence/marking is the caller's choice,
 * so preview and create share exactly the same assembly. */
function assembleInvoice(
  store: TimesheetStore,
  body: CreateInvoiceBody
): { invoice: Invoice; entries: TimesheetEntry[]; template?: InvoiceTemplate } | { error: string } {
  const client = store.clients.find((c) => c.id === body.clientId);
  if (!client) return { error: 'Client not found' };
  // Template resolution: explicit pick → client default → first active.
  const template =
    (body.templateId ? store.templates.find((t) => t.id === body.templateId) : undefined) ??
    (client.defaultTemplateId
      ? store.templates.find((t) => t.id === client.defaultTemplateId)
      : undefined) ??
    store.templates.find((t) => !t.archived);
  const projectById = new Map(store.projects.map((p) => [p.id, p] as const));

  const wanted = body.entryIds ? new Set(body.entryIds) : null;
  const entries = store.entries
    .filter((e) => {
      if (projectById.get(e.projectId)?.clientId !== client.id) return false;
      if (body.projectId && e.projectId !== body.projectId) return false;
      if (wanted) return wanted.has(e.id);
      if (e.invoiced || !e.billable) return false;
      if (body.from && e.date < body.from) return false;
      if (body.to && e.date > body.to) return false;
      return true;
    })
    .sort((a, b) =>
      a.date === b.date ? a.start.localeCompare(b.start) : a.date.localeCompare(b.date)
    );
  if (entries.length === 0) return { error: 'No entries to invoice' };
  const already = entries.filter((e) => e.invoiced);
  if (wanted && already.length > 0) {
    return { error: `${already.length} selected entries are already invoiced` };
  }

  const issueDate = new Date().toISOString().slice(0, 10);
  const vat = template?.vat ?? 0;
  const totalMinutes = entries.reduce((s, e) => s + e.durationMinutes, 0);
  let subtotal = round2(entries.reduce((s, e) => s + e.amount, 0));

  // Retainer floors are per PROJECT: each project with a minimum that has
  // work on this invoice gets its own labeled top-up line when its billed
  // subtotal comes in under the floor. Projects without entries here are
  // not being billed this cycle, so their floors don't apply.
  const lines = entries.map((e) => ({
    date: e.date,
    description: e.description,
    projectName: projectById.get(e.projectId)?.name ?? e.projectId,
    minutes: e.durationMinutes,
    hourlyRate: e.hourlyRate,
    amount: e.amount,
  }));
  for (const pid of new Set(entries.map((e) => e.projectId))) {
    const project = projectById.get(pid);
    if (!project?.minimumInvoice) continue;
    const projSum = entries.filter((e) => e.projectId === pid).reduce((s, e) => s + e.amount, 0);
    if (projSum < project.minimumInvoice) {
      const topUp = round2(project.minimumInvoice - projSum);
      lines.push({
        date: issueDate,
        description: `Monthly minimum adjustment — ${project.name}`,
        projectName: '',
        minutes: 0,
        hourlyRate: 0,
        amount: topUp,
      });
      subtotal = round2(subtotal + topUp);
    }
  }

  const tax = round2(subtotal * (vat / 100));
  const invoice: Invoice = {
    id: crypto.randomUUID(),
    number: body.number?.trim() || nextInvoiceNumber(store.invoices, new Date().getFullYear()),
    clientId: client.id,
    clientName: client.name,
    issueDate,
    // Payment terms: client override wins, then the template's default.
    dueDate: addDays(issueDate, client.dueDays ?? template?.dueDays ?? 14),
    status: 'new',
    currency: client.currency || 'USD',
    totalMinutes,
    subtotal,
    vat,
    tax,
    total: round2(subtotal + tax),
    templateId: template?.id,
    ...(body.comment?.trim() ? { comment: body.comment.trim() } : {}),
    lines,
    entryIds: entries.map((e) => e.id),
    projectIds: [...new Set(entries.map((e) => e.projectId))],
    createdAt: new Date().toISOString(),
  };
  return { invoice, entries, template };
}

/** Values available as {{placeholder}}s in project email templates. */
function buildEmailSubstitutions(
  invoice: Invoice,
  clientName?: string,
  company?: string,
  projectName?: string
): Record<string, string> {
  // Billing month: the month of the first line's work, else the month before
  // the issue date (matches the user's issue-on-the-1st cadence).
  const firstLineDate = invoice.lines[0]?.date as string | undefined;
  const monthSource = firstLineDate
    ? new Date(`${firstLineDate}T00:00:00`)
    : (() => {
        const d = new Date(`${invoice.issueDate}T00:00:00`);
        d.setMonth(d.getMonth() - 1);
        return d;
      })();
  return {
    number: invoice.number,
    client: clientName ?? invoice.clientName,
    project: projectName ?? '',
    total: `$${invoice.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
    dueDate: invoice.dueDate,
    issueDate: invoice.issueDate,
    month: monthSource.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    hours: (invoice.totalMinutes / 60).toFixed(2),
    company: company ?? '',
  };
}

/** Render an invoice PDF and save it into an entity's year folder, using the
 * repo's {Source}_{Type}_{Date} document naming with collision suffixes.
 * Returns "entityId:relative/path" or null when the entity is unknown. */
async function fileInvoicePdf(
  invoice: Invoice,
  template: InvoiceTemplate | undefined,
  entityId: string
): Promise<string | null> {
  const entityPath = await getEntityPath(entityId);
  if (!entityPath) return null;
  const year = invoice.issueDate.slice(0, 4);
  const dir = resolveUnder(entityPath, year);
  if (!dir) return null;
  await ensureDir(dir);
  const safeClient = invoice.clientName.replace(/[^\w-]+/g, '');
  const base = `${safeClient}_Invoice_${invoice.issueDate}`;
  let filename = `${base}.pdf`;
  for (let n = 2; ; n++) {
    try {
      await fs.access(path.join(dir, filename));
      filename = `${base}_${n}.pdf`;
    } catch {
      break;
    }
  }
  const pdf = await buildInvoicePdf(invoice, template);
  await fs.writeFile(path.join(dir, filename), Buffer.from(pdf));
  return `${entityId}:${year}/${filename}`;
}

function pdfResponse(pdf: Uint8Array, invoice: Invoice): Response {
  const safeNumber = invoice.number.replace(/[^\w-]+/g, '-');
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Invoice_${safeNumber}_${invoice.clientId}.pdf"`,
    },
  });
}

async function handleInvoiceRoutes(req: Request, pathname: string): Promise<Response | null> {
  // POST /api/timesheet/invoices - create: persist record, mark entries
  if (pathname === '/api/timesheet/invoices' && req.method === 'POST') {
    const body = await readJsonBody<CreateInvoiceBody>(req);
    const store = await loadTimesheetStore();
    const result = assembleInvoice(store, body);
    if ('error' in result) return jsonResponse({ error: result.error }, 400);
    if (store.invoices.some((i) => i.number === result.invoice.number)) {
      return jsonResponse({ error: `Invoice number ${result.invoice.number} already exists` }, 409);
    }
    const now = new Date().toISOString();
    for (const entry of result.entries) {
      entry.invoiced = true;
      entry.invoicedAt = now;
      entry.invoiceId = result.invoice.id;
    }
    store.invoices.push(result.invoice);

    // Auto-file: drop the rendered PDF into the client's configured entity
    // docs (year folder). Best-effort — a filing failure never blocks billing.
    const autoEntity = store.clients.find(
      (c) => c.id === result.invoice.clientId
    )?.autoFileEntityId;
    if (autoEntity) {
      try {
        const filed = await fileInvoicePdf(result.invoice, result.template, autoEntity);
        if (filed) result.invoice.filedPath = filed;
      } catch (err) {
        log.warn(`[invoice] auto-file failed for ${result.invoice.number}: ${String(err)}`);
      }
    }

    await saveTimesheetStore(store);
    log.info(
      `[invoice] created ${result.invoice.number} for client=${result.invoice.clientId}: ${result.entries.length} entries${result.invoice.filedPath ? ` (filed: ${result.invoice.filedPath})` : ''}`
    );
    return jsonResponse({ ok: true, invoice: result.invoice });
  }

  // POST /api/timesheet/invoices/preview - render the PDF without persisting
  if (pathname === '/api/timesheet/invoices/preview' && req.method === 'POST') {
    const body = await readJsonBody<CreateInvoiceBody>(req);
    const store = await loadTimesheetStore();
    const result = assembleInvoice(store, body);
    if ('error' in result) return jsonResponse({ error: result.error }, 400);
    return pdfResponse(await buildInvoicePdf(result.invoice, result.template), result.invoice);
  }

  // GET /api/timesheet/invoices/:id/pdf - re-render a stored invoice
  const pdfMatch = pathname.match(/^\/api\/timesheet\/invoices\/([^/]+)\/pdf$/);
  if (pdfMatch && req.method === 'GET') {
    const store = await loadTimesheetStore();
    const invoice = store.invoices.find((i) => i.id === pdfMatch[1]);
    if (!invoice) return jsonResponse({ error: 'Invoice not found' }, 404);
    // Line-less invoices (Kimai imports) render as a summary PDF.
    const template = invoice.templateId
      ? store.templates.find((t) => t.id === invoice.templateId)
      : store.templates.find((t) => !t.archived);
    return pdfResponse(await buildInvoicePdf(invoice, template), invoice);
  }

  // GET /api/timesheet/invoices/:id/email-draft - resolve the email template
  // into a concrete draft for the compose modal. Placeholders are substituted
  // HERE (single implementation); the modal edits the result freely.
  const draftMatch = pathname.match(/^\/api\/timesheet\/invoices\/([^/]+)\/email-draft$/);
  if (draftMatch && req.method === 'GET') {
    const store = await loadTimesheetStore();
    const invoice = store.invoices.find((i) => i.id === draftMatch[1]);
    if (!invoice) return jsonResponse({ error: 'Invoice not found' }, 404);
    const client = store.clients.find((c) => c.id === invoice.clientId);
    const pdfTemplate = invoice.templateId
      ? store.templates.find((t) => t.id === invoice.templateId)
      : store.templates.find((t) => !t.archived);
    // First billed project with any email defaults supplies the template.
    const emailProject = (invoice.projectIds ?? [])
      .map((pid) => store.projects.find((p) => p.id === pid))
      .find((p) => p && (p.emailTo || p.emailFrom || p.emailSubject || p.emailBody));

    const firstProjectName = store.projects.find(
      (p) => p.id === (invoice.projectIds ?? [])[0]
    )?.name;
    const sub = buildEmailSubstitutions(
      invoice,
      client?.name,
      pdfTemplate?.company,
      firstProjectName
    );
    const apply = (tpl: string) => tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key) => sub[key] ?? m);
    return jsonResponse({
      to: apply(emailProject?.emailTo ?? '') || client?.email || '',
      from: apply(emailProject?.emailFrom ?? ''), // '' = configured default sender
      subject: apply(emailProject?.emailSubject ?? `Invoice {{number}} from {{company}}`),
      body: apply(
        emailProject?.emailBody ??
          `Hi,\n\nPlease find attached invoice {{number}} for {{total}}, due {{dueDate}}.\n\nThank you!`
      ),
      attachment: `Invoice_${invoice.number.replace(/[^\w-]+/g, '-')}.pdf`,
      sentAt: invoice.sentAt ?? null,
      sentTo: invoice.sentTo ?? null,
      placeholders: Object.keys(sub),
    });
  }

  // POST /api/timesheet/invoices/:id/send - deliver EXACTLY the composed
  // email (to/from/subject/body come from the modal) with the PDF attached.
  const sendMatch = pathname.match(/^\/api\/timesheet\/invoices\/([^/]+)\/send$/);
  if (sendMatch && req.method === 'POST') {
    const body = await readJsonBody<{
      to?: string;
      from?: string;
      subject?: string;
      body?: string;
    }>(req);
    const store = await loadTimesheetStore();
    const invoice = store.invoices.find((i) => i.id === sendMatch[1]);
    if (!invoice) return jsonResponse({ error: 'Invoice not found' }, 404);
    const to = body.to?.trim();
    if (!to) return jsonResponse({ error: 'Missing recipient' }, 400);
    const subject = body.subject?.trim() || `Invoice ${invoice.number}`;
    const text = body.body ?? '';
    const html = text
      .split(/\n{2,}/)
      .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
      .join('\n');
    const template = invoice.templateId
      ? store.templates.find((t) => t.id === invoice.templateId)
      : store.templates.find((t) => !t.archived);
    const pdf = await buildInvoicePdf(invoice, template);
    const result = await sendEmail({
      to,
      ...(body.from?.trim() ? { from: body.from.trim() } : {}),
      subject,
      html,
      text,
      attachments: [
        {
          filename: `Invoice_${invoice.number.replace(/[^\w-]+/g, '-')}.pdf`,
          content: Buffer.from(pdf).toString('base64'),
          contentType: 'application/pdf',
        },
      ],
    });
    if (!result.ok) return jsonResponse({ error: result.error ?? 'Email send failed' }, 502);
    invoice.sentAt = new Date().toISOString();
    invoice.sentTo = to;
    await saveTimesheetStore(store);
    log.info(`[invoice] sent ${invoice.number} (id=${result.id ?? 'n/a'})`);
    return jsonResponse({ ok: true, sentTo: to, sentAt: invoice.sentAt });
  }

  // PUT /api/timesheet/invoices/:id - status / comment updates
  const invoiceMatch = pathname.match(/^\/api\/timesheet\/invoices\/([^/]+)$/);
  if (invoiceMatch && req.method === 'PUT') {
    const body = await readJsonBody<{
      status?: Invoice['status'];
      paymentDate?: string;
      comment?: string;
    }>(req);
    const store = await loadTimesheetStore();
    const invoice = store.invoices.find((i) => i.id === invoiceMatch[1]);
    if (!invoice) return jsonResponse({ error: 'Invoice not found' }, 404);
    if (body.status !== undefined) {
      if (!['new', 'paid', 'canceled'].includes(body.status)) {
        return jsonResponse({ error: 'Invalid status' }, 400);
      }
      invoice.status = body.status;
      if (body.status === 'paid') {
        invoice.paymentDate = body.paymentDate || new Date().toISOString().slice(0, 10);
      } else {
        delete invoice.paymentDate;
      }
    }
    if (body.comment !== undefined) invoice.comment = body.comment.trim() || undefined;
    await saveTimesheetStore(store);
    return jsonResponse({ ok: true, invoice });
  }

  // DELETE /api/timesheet/invoices/:id - remove record, un-invoice entries
  if (invoiceMatch && req.method === 'DELETE') {
    const store = await loadTimesheetStore();
    const invoice = store.invoices.find((i) => i.id === invoiceMatch[1]);
    if (!invoice) return jsonResponse({ error: 'Invoice not found' }, 404);
    let released = 0;
    for (const entry of store.entries) {
      if (entry.invoiceId === invoice.id) {
        entry.invoiced = false;
        delete entry.invoicedAt;
        delete entry.invoiceId;
        released++;
      }
    }
    store.invoices = store.invoices.filter((i) => i.id !== invoice.id);
    await saveTimesheetStore(store);
    log.info(`[invoice] deleted ${invoice.number}, released ${released} entries back to open`);
    return jsonResponse({ ok: true, released });
  }

  return null;
}

// ============================================================================
// Invoice templates
// ============================================================================

function templateFromBody(
  body: Partial<InvoiceTemplate>,
  existing?: InvoiceTemplate
): InvoiceTemplate {
  const strLines = (v: unknown, fallback: string[]): string[] =>
    Array.isArray(v) ? v.map((s) => String(s)) : fallback;
  return {
    id: existing?.id ?? crypto.randomUUID(),
    name: (body.name ?? existing?.name ?? 'Template').trim(),
    title: (body.title ?? existing?.title ?? 'Invoice').trim(),
    company: (body.company ?? existing?.company ?? '').trim(),
    address: strLines(body.address, existing?.address ?? []),
    contact: strLines(body.contact, existing?.contact ?? []),
    paymentTerms: (body.paymentTerms ?? existing?.paymentTerms ?? '').trim(),
    paymentDetails: strLines(body.paymentDetails, existing?.paymentDetails ?? []),
    dueDays: body.dueDays !== undefined ? Number(body.dueDays) : (existing?.dueDays ?? 14),
    vat: body.vat !== undefined ? Number(body.vat) : (existing?.vat ?? 0),
    descriptionStyle:
      body.descriptionStyle === 'truncate' || body.descriptionStyle === 'wrap'
        ? body.descriptionStyle
        : (existing?.descriptionStyle ?? 'wrap'),
    archived: body.archived ?? existing?.archived ?? false,
  };
}

async function handleTemplateRoutes(req: Request, pathname: string): Promise<Response | null> {
  // POST /api/timesheet/templates
  if (pathname === '/api/timesheet/templates' && req.method === 'POST') {
    const body = await readJsonBody<Partial<InvoiceTemplate>>(req);
    if (!body.name?.trim()) return jsonResponse({ error: 'Missing name' }, 400);
    const store = await loadTimesheetStore();
    const template = templateFromBody(body);
    store.templates.push(template);
    await saveTimesheetStore(store);
    return jsonResponse({ ok: true, template });
  }

  const templateMatch = pathname.match(/^\/api\/timesheet\/templates\/([^/]+)$/);
  if (templateMatch && req.method === 'PUT') {
    const body = await readJsonBody<Partial<InvoiceTemplate>>(req);
    const store = await loadTimesheetStore();
    const idx = store.templates.findIndex((t) => t.id === templateMatch[1]);
    if (idx === -1) return jsonResponse({ error: 'Template not found' }, 404);
    store.templates[idx] = templateFromBody(body, store.templates[idx]);
    await saveTimesheetStore(store);
    return jsonResponse({ ok: true, template: store.templates[idx] });
  }

  if (templateMatch && req.method === 'DELETE') {
    const store = await loadTimesheetStore();
    if (!store.templates.some((t) => t.id === templateMatch[1])) {
      return jsonResponse({ error: 'Template not found' }, 404);
    }
    if (store.invoices.some((i) => i.templateId === templateMatch[1])) {
      return jsonResponse({ error: 'Template used by invoices — archive it instead' }, 409);
    }
    store.templates = store.templates.filter((t) => t.id !== templateMatch[1]);
    await saveTimesheetStore(store);
    return jsonResponse({ ok: true });
  }

  return null;
}

// ============================================================================
// Weekly report — scheduled categorized summary for a billing contact
// ============================================================================

async function handleWeeklyReportRoutes(
  req: Request,
  url: URL,
  pathname: string
): Promise<Response | null> {
  // GET /api/timesheet/weekly-report/config
  if (pathname === '/api/timesheet/weekly-report/config' && req.method === 'GET') {
    const store = await loadTimesheetStore();
    return jsonResponse({ config: normalizeWeeklyReportConfig(store.weeklyReport) });
  }

  // PUT /api/timesheet/weekly-report/config - save + re-arm the send timer.
  // The lastSent* watermarks are server-owned: whatever the client submits,
  // the stored values win, so a stale form can't reopen an already-sent week.
  if (pathname === '/api/timesheet/weekly-report/config' && req.method === 'PUT') {
    const body = await readJsonBody<Record<string, unknown>>(req);
    const store = await loadTimesheetStore();
    const existing = normalizeWeeklyReportConfig(store.weeklyReport);
    const next = normalizeWeeklyReportConfig(body);
    if (existing.lastSentWeek) next.lastSentWeek = existing.lastSentWeek;
    if (existing.lastSentAt) next.lastSentAt = existing.lastSentAt;
    store.weeklyReport = next;
    await saveTimesheetStore(store);
    armWeeklyReportTimer();
    log.info(
      `[weekly-report] config saved: enabled=${next.enabled} day=${next.day} hour=${next.hour} ` +
        `rules=${next.categories.length}`
    );
    return jsonResponse({ ok: true, config: next });
  }

  // GET /api/timesheet/weekly-report/preview?end=YYYY-MM-DD - dry-run render
  if (pathname === '/api/timesheet/weekly-report/preview' && req.method === 'GET') {
    const store = await loadTimesheetStore();
    const cfg = normalizeWeeklyReportConfig(store.weeklyReport);
    const endParam = url.searchParams.get('end');
    if (endParam && !isValidDate(endParam)) {
      return jsonResponse({ error: 'end must be YYYY-MM-DD' }, 400);
    }
    const settings = await loadSettings();
    const tz = cfg.timezone ?? getConfiguredTimezone(settings);
    const window = weekWindow(endParam || zonedYMD(new Date(), tz));
    const rows = collectReportRows(store, cfg, window);
    return jsonResponse({
      window,
      rows,
      categories: categoryTotals(rows).map(({ category, minutes, amount }) => ({
        category,
        minutes,
        amount,
      })),
      totalMinutes: rows.reduce((s, r) => s + r.minutes, 0),
      totalAmount: rows.reduce((s, r) => s + r.amount, 0),
      csv: buildReportCsv(rows),
      html: buildReportHtml(rows, window),
    });
  }

  // POST /api/timesheet/weekly-report/send - manual off-cycle send; records
  // the same dedup watermark as the scheduler, so sending by hand on the
  // configured send-day suppresses that day's automatic delivery.
  if (pathname === '/api/timesheet/weekly-report/send' && req.method === 'POST') {
    const body = await readJsonBody<{ end?: string }>(req);
    if (body.end !== undefined && !isValidDate(body.end)) {
      return jsonResponse({ error: 'end must be YYYY-MM-DD' }, 400);
    }
    const store = await loadTimesheetStore();
    const cfg = normalizeWeeklyReportConfig(store.weeklyReport);
    const settings = await loadSettings();
    const tz = cfg.timezone ?? getConfiguredTimezone(settings);
    const result = await sendWeeklyReport(body.end || zonedYMD(new Date(), tz));
    if (!result.ok) return jsonResponse({ error: result.error ?? 'Send failed' }, 502);
    return jsonResponse(result);
  }

  return null;
}
