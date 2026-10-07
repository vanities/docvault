// Outbound email via Resend (https://resend.com). A single fetch to the send
// API — no SDK dependency. Best-effort: logs and returns { ok:false } on any
// failure, never throws, so a scheduled task can fire-and-forget.
//
// The API key comes from getEmailConfig() (settings → RESEND_API_KEY env). The
// `from` domain must be verified in the Resend dashboard, or use the shared
// onboarding@resend.dev sender for testing.
//
// Every send declares a `purpose` (news / client / test). It decides which
// configured CC list applies by default — Newsstand editions and client-facing
// mail (invoices, the weekly timesheet report) each have their own — and it is
// recorded in the sent-mail log (email-log.ts) so sends can be audited by
// audience later.

import { randomUUID } from 'crypto';
import { getEmailConfig } from './data.js';
import type { EmailConfig } from './data.js';
import { createLogger } from './logger.js';
import { appendEmailLog, type EmailPurpose } from './email-log.js';

export type { EmailPurpose } from './email-log.js';

const log = createLogger('Email');
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export interface EmailAttachment {
  filename: string;
  /** Base64-encoded file content. */
  content: string;
  contentType?: string;
  /** Optional CID for inline images referenced as <img src="cid:...">. */
  contentId?: string;
}

export interface SendEmailInput {
  /** Why this email goes out — picks the default CC and tags the sent-mail log. */
  purpose: EmailPurpose;
  /** Recipient. Defaults to the configured toEmail. */
  to?: string;
  /** Sender "Name <addr>" or bare address. Defaults to fromName/fromEmail. */
  from?: string;
  /** Carbon copy. Defaults to the configured CC for `purpose`; pass '' to suppress it. */
  cc?: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: EmailAttachment[];
  /** Free-form context stored on the log entry (edition id, `invoice:<id>`, …). */
  ref?: string;
}

export interface SendEmailResult {
  ok: boolean;
  id?: string;
  error?: string;
}

interface ResendPayloadResult {
  payload?: Record<string, unknown>;
  recipients: string[];
  cc: string[];
  from?: string;
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

/** The configured CC list that applies to a purpose when the caller passes
 *  none. Test pings never CC anyone — they exist to verify the From domain. */
export function defaultCcFor(purpose: EmailPurpose, cc: EmailConfig['cc']): string | undefined {
  switch (purpose) {
    case 'news':
      return cc.news;
    case 'client':
      return cc.client;
    case 'test':
      return undefined;
  }
}

/** Build the exact Resend API payload. Exported for regression tests. */
export function buildResendPayload(
  input: SendEmailInput,
  cfg: Pick<EmailConfig, 'fromEmail' | 'fromName' | 'toEmail' | 'cc'>
): ResendPayloadResult {
  const from = input.from || defaultFrom(cfg.fromEmail, cfg.fromName);
  const recipients = parseRecipients(input.to ?? cfg.toEmail);
  // An explicit cc wins — including '' to suppress the configured default.
  const ccRaw = input.cc !== undefined ? input.cc : defaultCcFor(input.purpose, cfg.cc);
  // Never cc someone already on the To line; Resend would deliver twice.
  const toKeys = new Set(recipients.map((r) => r.toLowerCase()));
  const cc = parseRecipients(ccRaw).filter((a) => !toKeys.has(a.toLowerCase()));
  if (!from) return { from, recipients, cc, error: 'No from address configured' };
  if (!recipients.length) return { from, recipients, cc, error: 'No to address configured' };

  const payload: Record<string, unknown> = {
    from,
    to: recipients,
    subject: input.subject,
    html: input.html,
  };
  if (cc.length) payload.cc = cc;
  if (input.text) payload.text = input.text;
  if (input.attachments?.length) {
    payload.attachments = input.attachments.map((a) => ({
      filename: a.filename,
      content: a.content,
      ...(a.contentType ? { content_type: a.contentType } : {}),
      ...(a.contentId ? { content_id: a.contentId } : {}),
    }));
  }

  return { payload, recipients, cc, from };
}

/** Decoded byte length of a base64 string (ignores padding precision). */
function base64Bytes(b64: string): number {
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

/** Record the attempt in the sent-mail log. Never throws. */
async function recordAttempt(
  input: SendEmailInput,
  built: Pick<ResendPayloadResult, 'recipients' | 'cc' | 'from'>,
  outcome: SendEmailResult,
  elapsedMs: number
): Promise<void> {
  await appendEmailLog({
    id: randomUUID(),
    at: new Date().toISOString(),
    purpose: input.purpose,
    from: built.from ?? '',
    to: built.recipients,
    cc: built.cc,
    subject: input.subject,
    attachments: (input.attachments ?? []).map((a) => ({
      filename: a.filename,
      bytes: base64Bytes(a.content),
    })),
    ok: outcome.ok,
    ...(outcome.id ? { providerId: outcome.id } : {}),
    ...(outcome.error ? { error: outcome.error } : {}),
    elapsedMs,
    ...(input.ref ? { ref: input.ref } : {}),
  });
}

/**
 * Send an email via Resend. Best-effort — never throws. Returns
 * { ok:false, error } when unconfigured or the API rejects the request.
 * Every attempt — including config failures — lands in the sent-mail log.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const cfg = await getEmailConfig();
  const startedAt = Date.now();

  if (!cfg.apiKey) {
    log.warn(`[send] skipped — no Resend API key configured purpose=${input.purpose}`);
    const outcome = { ok: false, error: 'No Resend API key configured' };
    await recordAttempt(input, buildResendPayload(input, cfg), outcome, 0);
    return outcome;
  }
  const built = buildResendPayload(input, cfg);
  const { payload, recipients, cc, error } = built;
  if (error || !payload) {
    const outcome = { ok: false, error: error ?? 'Could not build email payload' };
    log.warn(`[send] rejected purpose=${input.purpose} — ${outcome.error}`);
    await recordAttempt(input, built, outcome, 0);
    return outcome;
  }

  log.info(
    `[send] purpose=${input.purpose} to=${recipients.length} recipient(s) [${recipients.map(redactEmail).join(', ')}] ` +
      (cc.length ? `cc=${cc.length} [${cc.map(redactEmail).join(', ')}] ` : '') +
      `subject="${input.subject.slice(0, 60)}" ` +
      `attachments=${input.attachments?.length ?? 0} htmlBytes=${input.html.length}` +
      (input.ref ? ` ref=${input.ref}` : '')
  );
  let outcome: SendEmailResult;
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
      outcome = { ok: false, error: msg };
    } else {
      const data = (await res.json().catch(() => ({}))) as { id?: string };
      log.info(`[send] ok in ${elapsed}ms id=${data.id ?? '?'}`);
      outcome = { ok: true, id: data.id };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`[send] threw in ${Date.now() - startedAt}ms — ${msg}`);
    outcome = { ok: false, error: msg };
  }
  await recordAttempt(input, built, outcome, Date.now() - startedAt);
  return outcome;
}
