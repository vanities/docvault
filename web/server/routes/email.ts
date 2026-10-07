// Outbound email routes — the Settings → Email test ping and the sent-mail log.
//
//   POST /api/email/test                          → send a test email (verify Resend)
//   GET  /api/email/log?limit=100&purpose=client  → { entries: [newest first] }
//
// The log is written by sendEmail() itself (server/email.ts → email-log.ts);
// this file only reads it.

import { jsonResponse } from '../data.js';
import { sendEmail } from '../email.js';
import { isEmailPurpose, readEmailLog } from '../email-log.js';
import { createLogger } from '../logger.js';

const log = createLogger('EmailRoutes');

export async function handleEmailRoutes(
  req: Request,
  url: URL,
  pathname: string
): Promise<Response | null> {
  if (!pathname.startsWith('/api/email/')) return null;

  // POST /api/email/test — fire a tiny test email so the user can verify their
  // Resend config + verified sending domain from the Settings UI. Purpose
  // `test` never CCs anyone.
  if (pathname === '/api/email/test' && req.method === 'POST') {
    const res = await sendEmail({
      purpose: 'test',
      subject: 'DocVault test email',
      html: '<p>This is a test email from DocVault. If you can read this, Resend is wired up correctly.</p>',
    });
    return jsonResponse(res, res.ok ? 200 : 400);
  }

  // GET /api/email/log — newest-first slice of every send attempt.
  if (pathname === '/api/email/log' && req.method === 'GET') {
    const t0 = performance.now();
    const limitRaw = Number(url.searchParams.get('limit') ?? '100');
    const purposeRaw = url.searchParams.get('purpose') ?? undefined;
    if (purposeRaw !== undefined && !isEmailPurpose(purposeRaw)) {
      return jsonResponse({ error: `Unknown purpose "${purposeRaw}"` }, 400);
    }
    const entries = await readEmailLog({
      limit: Number.isFinite(limitRaw) ? limitRaw : undefined,
      purpose: purposeRaw,
    });
    log.debug(
      `[log] purpose=${purposeRaw ?? 'all'} returned=${entries.length} in ${(performance.now() - t0).toFixed(1)}ms`
    );
    return jsonResponse({ entries });
  }

  return null;
}
