// Email (Resend) — outbound delivery for Newsstand editions, invoices and the
// weekly timesheet report. The API key is stored encrypted server-side
// (walkSensitiveFields) and falls back to the RESEND_API_KEY env var; this card
// only ever sees a "set · …1234" hint, never the full key. "Send test" hits
// POST /api/email/test to verify config + a verified sending domain in one click.
//
// CC is split by audience: one list rides on Newsstand editions, another on
// client-facing mail. They used to be one "always CC" field, which copied the
// owner on their own newspaper — hence the split.
//
// The "Sent mail" panel below reads GET /api/email/log — every attempt the
// server made (success or failure), newest first, so a missing edition or an
// unpaid invoice can be traced to the exact send.

import { Fragment, useCallback, useEffect, useState } from 'react';
import { Mail, RefreshCw, Save, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { useToast } from '../../hooks/useToast';
import { API_BASE } from '../../constants';
import { requestJson } from '../../api/client';

interface EmailData {
  fromEmail?: string;
  fromName?: string;
  toEmail?: string;
  cc?: { news?: string; client?: string };
  enabled?: boolean;
  hasResendApiKey?: boolean;
  resendApiKeyHint?: string;
}

type EmailPurpose = 'news' | 'client' | 'test';

interface EmailLogEntry {
  id: string;
  at: string;
  purpose: EmailPurpose;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  attachments: { filename: string; bytes: number }[];
  ok: boolean;
  providerId?: string;
  error?: string;
  elapsedMs: number;
  ref?: string;
}

const PURPOSE_LABEL: Record<EmailPurpose, string> = {
  news: 'Newsstand',
  client: 'Client',
  test: 'Test',
};

const PURPOSE_TONE: Record<EmailPurpose, string> = {
  news: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  client: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  test: 'bg-surface-400/20 text-surface-700',
};

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function EmailSettingsSection() {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [fromEmail, setFromEmail] = useState('');
  const [fromName, setFromName] = useState('');
  const [toEmail, setToEmail] = useState('');
  const [ccNews, setCcNews] = useState('');
  const [ccClient, setCcClient] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [keyHint, setKeyHint] = useState('');

  const [logEntries, setLogEntries] = useState<EmailLogEntry[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const [logFilter, setLogFilter] = useState<EmailPurpose | 'all'>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = async () => {
    try {
      const d = await requestJson<{ email?: EmailData }>(`${API_BASE}/settings`);
      const e: EmailData = d.email ?? {};
      setEnabled(e.enabled ?? false);
      setFromEmail(e.fromEmail ?? '');
      setFromName(e.fromName ?? '');
      setToEmail(e.toEmail ?? '');
      setCcNews(e.cc?.news ?? '');
      setCcClient(e.cc?.client ?? '');
      setHasKey(e.hasResendApiKey ?? false);
      setKeyHint(e.resendApiKeyHint ?? '');
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  const loadLog = useCallback(async (purpose: EmailPurpose | 'all') => {
    setLogLoading(true);
    try {
      const qs = new URLSearchParams({ limit: '100' });
      if (purpose !== 'all') qs.set('purpose', purpose);
      const d = await requestJson<{ entries?: EmailLogEntry[] }>(`${API_BASE}/email/log?${qs}`);
      setLogEntries(d.entries ?? []);
    } catch {
      setLogEntries([]);
    } finally {
      setLogLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    void loadLog(logFilter);
  }, [logFilter, loadLog]);

  const save = async () => {
    setSaving(true);
    try {
      const email: Record<string, unknown> = {
        enabled,
        fromEmail,
        fromName,
        toEmail,
        cc: { news: ccNews, client: ccClient },
      };
      if (apiKey.trim()) email.resendApiKey = apiKey.trim();
      const d = await requestJson<{ ok?: boolean }>(`${API_BASE}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (d.ok) {
        addToast('Email settings saved', 'success');
        setApiKey('');
        await load();
      } else {
        addToast('Failed to save', 'error');
      }
    } catch {
      addToast('Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const d = await requestJson<{ ok?: boolean; error?: string }>(`${API_BASE}/email/test`, {
        method: 'POST',
      });
      if (d.ok) addToast('Test email sent', 'success');
      else addToast(`Test failed: ${d.error ?? 'unknown error'}`, 'error');
    } catch {
      addToast('Test failed', 'error');
    } finally {
      setTesting(false);
      void loadLog(logFilter);
    }
  };

  if (loading) {
    return (
      <Card variant="glass" className="p-6 mb-8">
        <div className="text-center py-4 text-surface-600">Loading…</div>
      </Card>
    );
  }

  return (
    <>
      <Card variant="glass" className="p-6 mb-8">
        <h3 className="text-lg font-semibold text-surface-950 flex items-center gap-2 mb-1">
          <Mail className="w-5 h-5" />
          Email (Resend)
        </h3>
        <p className="text-[12px] text-surface-600 mb-4">
          Powers all outbound email from DocVault: Newsstand editions <em>and</em> invoice emails
          sent from the Timesheet. The <span className="font-medium">From</span> domain must be
          verified in your Resend dashboard (or use{' '}
          <code className="font-mono">onboarding@resend.dev</code> for testing).
        </p>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[13px] font-medium text-surface-900">Enable email delivery</p>
              <p className="text-[11px] text-surface-500">
                Auto-email scheduled Newsstand editions when they publish. Manual sends (an edition
                on demand, invoice emails) work regardless — they only need the key and From below.
              </p>
            </div>
            <button
              onClick={() => setEnabled(!enabled)}
              className={`relative w-10 h-5 rounded-full transition-colors ${enabled ? 'bg-violet-500' : 'bg-surface-400'}`}
            >
              <span
                className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                style={{ left: enabled ? 22 : 2 }}
              />
            </button>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] text-surface-600 mb-1">From email</label>
              <Input
                type="email"
                value={fromEmail}
                onChange={(e) => setFromEmail(e.target.value)}
                placeholder="news@yourdomain.com"
                className="text-[13px]"
              />
            </div>
            <div>
              <label className="block text-[12px] text-surface-600 mb-1">From name</label>
              <Input
                type="text"
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
                placeholder="The DocVault Dispatch"
                className="text-[13px]"
              />
            </div>
            <p className="sm:col-span-2 text-[11px] text-surface-500 -mt-1">
              This From is the <span className="font-medium">default sender for everything</span> —
              Newsstand editions and Timesheet invoice emails alike. Invoice sends can override it
              per project (project → Email tab) or per email in the compose window.
            </p>
            <div className="sm:col-span-2">
              <label className="block text-[12px] text-surface-600 mb-1">
                To (one address per line, or comma-separated)
              </label>
              <textarea
                value={toEmail}
                onChange={(e) => setToEmail(e.target.value)}
                placeholder={'you@example.com\nspouse@example.com'}
                rows={2}
                className="w-full text-[13px] bg-surface-100/60 border border-border/40 rounded-lg px-2.5 py-1.5 resize-y"
              />
              <p className="text-[11px] text-surface-500 mt-1">
                Every Newsstand edition goes to all of these. Invoice emails do NOT use this list —
                their recipients come from the customer profile / project template / compose window.
              </p>
            </div>
            <div>
              <label className="block text-[12px] text-surface-600 mb-1">
                CC on Newsstand editions
              </label>
              <textarea
                value={ccNews}
                onChange={(e) => setCcNews(e.target.value)}
                placeholder="archive@example.com"
                rows={2}
                className="w-full text-[13px] bg-surface-100/60 border border-border/40 rounded-lg px-2.5 py-1.5 resize-y"
              />
              <p className="text-[11px] text-surface-500 mt-1">
                Copied on daily and weekly editions only. Leave empty if everyone who should get the
                paper is already on the To list above.
              </p>
            </div>
            <div>
              <label className="block text-[12px] text-surface-600 mb-1">CC on client emails</label>
              <textarea
                value={ccClient}
                onChange={(e) => setCcClient(e.target.value)}
                placeholder="you@example.com"
                rows={2}
                className="w-full text-[13px] bg-surface-100/60 border border-border/40 rounded-lg px-2.5 py-1.5 resize-y"
              />
              <p className="text-[11px] text-surface-500 mt-1">
                Copied on invoices and the weekly timesheet report — your own record of what went
                out to clients. The invoice compose window can override it per email.
              </p>
            </div>
            <p className="sm:col-span-2 text-[11px] text-surface-500 -mt-1">
              Anyone already on the To line is skipped, so nobody is delivered twice. Test emails
              never CC.
            </p>
            <div>
              <label className="block text-[12px] text-surface-600 mb-1">
                Resend API key{' '}
                {hasKey && <span className="text-green-500">· set (…{keyHint})</span>}
              </label>
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={hasKey ? '•••••••• (leave blank to keep)' : 're_…'}
                className="text-[13px] font-mono"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={save} size="sm" disabled={saving}>
              <Save className="w-4 h-4" />
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button variant="ghost" size="sm" onClick={sendTest} disabled={testing || !hasKey}>
              <Send className="w-4 h-4" />
              {testing ? 'Sending…' : 'Send test'}
            </Button>
          </div>
        </div>
      </Card>

      <Card variant="glass" className="p-6 mb-8">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h3 className="text-lg font-semibold text-surface-950 flex items-center gap-2 mb-1">
              <Send className="w-5 h-5" />
              Sent mail
            </h3>
            <p className="text-[12px] text-surface-600">
              Every email DocVault tried to send — Newsstand editions, invoices, the weekly
              timesheet report and test pings — newest first, including failures. The last 500 are
              kept.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void loadLog(logFilter)}
            disabled={logLoading}
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${logLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          {(['all', 'news', 'client', 'test'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setLogFilter(p)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                logFilter === p
                  ? 'bg-violet-500 text-white'
                  : 'bg-surface-200/60 text-surface-700 hover:bg-surface-300/60'
              }`}
            >
              {p === 'all' ? 'All' : PURPOSE_LABEL[p]}
            </button>
          ))}
          <span className="ml-auto text-[11px] text-surface-500">
            {logEntries.length} {logEntries.length === 1 ? 'email' : 'emails'}
          </span>
        </div>

        {logEntries.length === 0 ? (
          <p className="text-[12px] text-surface-500 py-6 text-center">
            {logLoading ? 'Loading…' : 'Nothing sent yet.'}
          </p>
        ) : (
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-surface-500">
                  <th className="px-2 py-1.5 font-semibold">When</th>
                  <th className="px-2 py-1.5 font-semibold">Kind</th>
                  <th className="px-2 py-1.5 font-semibold">To</th>
                  <th className="px-2 py-1.5 font-semibold">Subject</th>
                  <th className="px-2 py-1.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {logEntries.map((e) => {
                  const open = expanded === e.id;
                  return (
                    <Fragment key={e.id}>
                      <tr
                        onClick={() => setExpanded(open ? null : e.id)}
                        className="border-t border-border/30 hover:bg-surface-100/50 cursor-pointer align-top"
                      >
                        <td className="px-2 py-1.5 whitespace-nowrap text-surface-700">
                          {fmtWhen(e.at)}
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${PURPOSE_TONE[e.purpose]}`}
                          >
                            {PURPOSE_LABEL[e.purpose]}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-surface-800 max-w-[220px] truncate">
                          {e.to.join(', ')}
                          {e.cc.length > 0 && (
                            <span className="text-surface-500"> · cc {e.cc.length}</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-surface-900 max-w-[320px] truncate">
                          {e.subject}
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          {e.ok ? (
                            <span className="text-emerald-600 dark:text-emerald-400">Sent</span>
                          ) : (
                            <span className="text-red-600 dark:text-red-400">Failed</span>
                          )}
                        </td>
                      </tr>
                      {open && (
                        <tr className="bg-surface-100/40">
                          <td colSpan={5} className="px-3 py-2">
                            <dl className="grid sm:grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[11px]">
                              <dt className="text-surface-500">From</dt>
                              <dd className="text-surface-800 break-all">{e.from || '—'}</dd>
                              <dt className="text-surface-500">To</dt>
                              <dd className="text-surface-800 break-all">
                                {e.to.join(', ') || '—'}
                              </dd>
                              <dt className="text-surface-500">CC</dt>
                              <dd className="text-surface-800 break-all">
                                {e.cc.join(', ') || '—'}
                              </dd>
                              <dt className="text-surface-500">Subject</dt>
                              <dd className="text-surface-800">{e.subject}</dd>
                              <dt className="text-surface-500">Attachments</dt>
                              <dd className="text-surface-800">
                                {e.attachments.length
                                  ? e.attachments
                                      .map((a) => `${a.filename} (${fmtBytes(a.bytes)})`)
                                      .join(', ')
                                  : '—'}
                              </dd>
                              <dt className="text-surface-500">Result</dt>
                              <dd className={e.ok ? 'text-emerald-600' : 'text-red-600'}>
                                {e.ok ? `Sent in ${e.elapsedMs} ms` : e.error || 'Failed'}
                                {e.providerId && (
                                  <span className="text-surface-500"> · Resend {e.providerId}</span>
                                )}
                              </dd>
                              {e.ref && (
                                <>
                                  <dt className="text-surface-500">Ref</dt>
                                  <dd className="text-surface-800 font-mono">{e.ref}</dd>
                                </>
                              )}
                            </dl>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
