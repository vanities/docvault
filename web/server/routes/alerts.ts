// DocVault Alerts routes (engine in server/alerts.ts).
//
//   GET    /api/alerts                          → { sources: [...source, job, hasDashboard], log }
//   POST   /api/alerts/report                   → { ok, emailed: 'trip' | 'reminder' | null }
//   POST   /api/alerts/report-failure           → { ok, emailed: 'blind' | null, failures }
//   PUT    /api/alerts/sources/:id/settings     → { ok, emails, values }
//   GET    /api/alerts/sources/:id/dashboard    → the source's dashboard.html, sandboxed
//   DELETE /api/alerts/sources/:id              → { ok }
//
// Turning a source's job on/off and "Check now" go through the existing
// POST /api/jobs?overwrite=true and POST /api/jobs/:id/run, like Settings → Jobs.

import { jsonResponse } from '../data.js';
import {
  AlertSettingsError,
  listAlerts,
  parseAlertFailure,
  parseAlertReport,
  parseAlertSettings,
  readAlertDashboard,
  removeAlertSource,
  reportAlertFailure,
  reportAlerts,
  setAlertSourceSettings,
} from '../alerts.js';
import { readJsonBody } from '../http.js';

// A dashboard is the owner's own HTML. `sandbox allow-scripts` gives it an opaque
// origin even when opened directly, so it can't ride DocVault's session, and
// connect-src 'none' keeps the data it is handed inside the page.
const DASHBOARD_HEADERS: Record<string, string> = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': [
    'sandbox allow-scripts',
    "default-src 'none'",
    "script-src 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
    "style-src 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com data:',
    'img-src data: blob:',
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'self'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

// detail.data is capped at 256 KB; this leaves room for checks and series.
const MAX_REPORT_BYTES = 512 * 1024;

function tooLarge(req: Request): boolean {
  const length = Number(req.headers.get('content-length') ?? '0');
  return Number.isFinite(length) && length > MAX_REPORT_BYTES;
}

async function parseBody<T>(req: Request, parse: (raw: unknown) => T): Promise<T | Response> {
  if (tooLarge(req)) return jsonResponse({ ok: false, error: 'Request body is too large' }, 413);
  let raw: unknown;
  try {
    raw = await readJsonBody<unknown>(req);
  } catch {
    return jsonResponse({ ok: false, error: 'Request body must be valid JSON' }, 400);
  }
  try {
    return parse(raw);
  } catch (err) {
    return jsonResponse(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      400
    );
  }
}

export async function handleAlertsRoutes(
  req: Request,
  _url: URL,
  pathname: string
): Promise<Response | null> {
  if (pathname !== '/api/alerts' && !pathname.startsWith('/api/alerts/')) return null;

  if (pathname === '/api/alerts' && req.method === 'GET') {
    return jsonResponse(await listAlerts());
  }

  if (pathname === '/api/alerts/report' && req.method === 'POST') {
    const input = await parseBody(req, parseAlertReport);
    if (input instanceof Response) return input;
    const outcome = await reportAlerts(input);
    return jsonResponse({
      ok: true,
      emailed: outcome.emailed,
      ...(outcome.emailError ? { emailError: outcome.emailError } : {}),
    });
  }

  if (pathname === '/api/alerts/report-failure' && req.method === 'POST') {
    const input = await parseBody(req, parseAlertFailure);
    if (input instanceof Response) return input;
    const outcome = await reportAlertFailure(input.sourceId, input.error);
    return jsonResponse({ ok: true, ...outcome });
  }

  const settingsMatch = /^\/api\/alerts\/sources\/([^/]+)\/settings$/.exec(pathname);
  if (settingsMatch && req.method === 'PUT') {
    const input = await parseBody(req, parseAlertSettings);
    if (input instanceof Response) return input;
    try {
      const source = await setAlertSourceSettings(decodeURIComponent(settingsMatch[1]), input);
      return source
        ? jsonResponse({ ok: true, emails: source.emails !== false, values: source.values ?? {} })
        : jsonResponse({ ok: false, error: 'Alert source not found' }, 404);
    } catch (err) {
      if (err instanceof AlertSettingsError) {
        return jsonResponse({ ok: false, error: err.message }, 400);
      }
      throw err;
    }
  }

  const dashboardMatch = /^\/api\/alerts\/sources\/([^/]+)\/dashboard$/.exec(pathname);
  if (dashboardMatch && req.method === 'GET') {
    const html = await readAlertDashboard(decodeURIComponent(dashboardMatch[1]));
    return html === null
      ? jsonResponse({ ok: false, error: 'This alert has no dashboard file' }, 404)
      : new Response(html, { headers: DASHBOARD_HEADERS });
  }

  const sourceMatch = /^\/api\/alerts\/sources\/([^/]+)$/.exec(pathname);
  if (sourceMatch && req.method === 'DELETE') {
    const removed = await removeAlertSource(decodeURIComponent(sourceMatch[1]));
    return removed
      ? jsonResponse({ ok: true })
      : jsonResponse({ ok: false, error: 'Alert source not found' }, 404);
  }

  return null;
}
