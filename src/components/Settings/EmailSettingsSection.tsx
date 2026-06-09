// Email (Resend) — outbound delivery for Newsstand editions. The API key is
// stored encrypted server-side (walkSensitiveFields) and falls back to the
// RESEND_API_KEY env var; this card only ever sees a "set · …1234" hint, never
// the full key. "Send test" hits POST /api/email/test to verify config + a
// verified sending domain in one click.

import { useEffect, useState } from 'react';
import { Mail, Save, Send } from 'lucide-react';
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
  enabled?: boolean;
  hasResendApiKey?: boolean;
  resendApiKeyHint?: string;
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
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [keyHint, setKeyHint] = useState('');

  const load = async () => {
    try {
      const d = await requestJson<{ email?: EmailData }>(`${API_BASE}/settings`);
      const e: EmailData = d.email ?? {};
      setEnabled(e.enabled ?? false);
      setFromEmail(e.fromEmail ?? '');
      setFromName(e.fromName ?? '');
      setToEmail(e.toEmail ?? '');
      setHasKey(e.hasResendApiKey ?? false);
      setKeyHint(e.resendApiKeyHint ?? '');
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const email: Record<string, unknown> = { enabled, fromEmail, fromName, toEmail };
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
    <Card variant="glass" className="p-6 mb-8">
      <h3 className="text-lg font-semibold text-surface-950 flex items-center gap-2 mb-1">
        <Mail className="w-5 h-5" />
        Email (Resend)
      </h3>
      <p className="text-[12px] text-surface-600 mb-4">
        Delivers Newsstand editions to your inbox — scheduled editions send automatically when this
        is on; you can also email any edition on demand from the Newsstand. The{' '}
        <span className="font-medium">From</span> domain must be verified in your Resend dashboard
        (or use <code className="font-mono">onboarding@resend.dev</code> for testing).
      </p>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-medium text-surface-900">Enable email delivery</p>
            <p className="text-[11px] text-surface-500">
              Auto-email scheduled editions when they publish.
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
              Every edition is sent to all of these recipients.
            </p>
          </div>
          <div>
            <label className="block text-[12px] text-surface-600 mb-1">
              Resend API key {hasKey && <span className="text-green-500">· set (…{keyHint})</span>}
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
  );
}
