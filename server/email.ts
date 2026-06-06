// Outbound email via Resend (https://resend.com). A single fetch to the send
// API — no SDK dependency. Best-effort: logs and returns { ok:false } on any
// failure, never throws, so a scheduled task can fire-and-forget.
//
// The API key comes from getEmailConfig() (settings → RESEND_API_KEY env). The
// `from` domain must be verified in the Resend dashboard, or use the shared
// onboarding@resend.dev sender for testing.

import { getEmailConfig } from './data.js';
import { createLogger } from './logger.js';

const log = createLogger('Email');
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export interface EmailAttachment {
  filename: string;
  /** Base64-encoded file content. */
  content: string;
  contentType?: string;
}

export interface SendEmailInput {
  /** Recipient. Defaults to the configured toEmail. */
  to?: string;
  /** Sender "Name <addr>" or bare address. Defaults to fromName/fromEmail. */
  from?: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: EmailAttachment[];
}

export interface SendEmailResult {
  ok: boolean;
  id?: string;
  error?: string;
}

/** Build a "Name <addr>" from-header out of config, or a bare address. */
function defaultFrom(fromEmail?: string, fromName?: string): string | undefined {
  if (!fromEmail) return undefined;
  return fromName ? `${fromName} <${fromEmail}>` : fromEmail;
}

/** Mask an email for logs: alice@example.com → a***@e***.com (no PII). */
function redactEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!domain) return '***';
  return `${user.slice(0, 1)}***@${domain.replace(/^[^.]+/, (m) => m.slice(0, 1) + '***')}`;
}

/** Split a recipients string (comma / semicolon / newline separated) into a
 *  deduped list of addresses — lets the single `toEmail` setting hold a list of
 *  people. Resend's `to` accepts up to 50 addresses. */
function parseRecipients(s: string | undefined): string[] {
  if (!s) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of s.split(/[,;\n]+/)) {
    const addr = raw.trim();
    const key = addr.toLowerCase();
    if (addr && !seen.has(key)) {
      seen.add(key);
      out.push(addr);
    }
  }
  return out;
}

/**
 * Send an email via Resend. Best-effort — never throws. Returns
 * { ok:false, error } when unconfigured or the API rejects the request.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const cfg = await getEmailConfig();
  const startedAt = Date.now();

  if (!cfg.apiKey) {
    log.warn('[send] skipped — no Resend API key configured');
    return { ok: false, error: 'No Resend API key configured' };
  }
  const from = input.from || defaultFrom(cfg.fromEmail, cfg.fromName);
  const recipients = parseRecipients(input.to ?? cfg.toEmail);
  if (!from) return { ok: false, error: 'No from address configured' };
  if (!recipients.length) return { ok: false, error: 'No to address configured' };

  const payload: Record<string, unknown> = {
    from,
    to: recipients,
    subject: input.subject,
    html: input.html,
  };
  if (input.text) payload.text = input.text;
  if (input.attachments?.length) {
    payload.attachments = input.attachments.map((a) => ({
      filename: a.filename,
      content: a.content,
      ...(a.contentType ? { content_type: a.contentType } : {}),
    }));
  }

  log.info(
    `[send] to=${recipients.length} recipient(s) [${recipients.map(redactEmail).join(', ')}] ` +
      `subject="${input.subject.slice(0, 60)}" ` +
      `attachments=${input.attachments?.length ?? 0} htmlBytes=${input.html.length}`
  );
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const elapsed = Date.now() - startedAt;
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      const msg = `Resend ${res.status}: ${bodyText.slice(0, 300)}`;
      log.error(`[send] failed in ${elapsed}ms — ${msg}`);
      return { ok: false, error: msg };
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    log.info(`[send] ok in ${elapsed}ms id=${data.id ?? '?'}`);
    return { ok: true, id: data.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`[send] threw in ${Date.now() - startedAt}ms — ${msg}`);
    return { ok: false, error: msg };
  }
}
