// AI Credentials — all provider auth in one card: Anthropic API key, Claude
// OAuth subscription token, OpenAI API key + base URL, and one-click Codex
// sign-in (device-auth). Model/agent ROUTING lives in the Models & Chat card;
// this card is purely credentials. (File name kept as AiLabsKeysSection so
// SettingsView's import is stable.)

import { useEffect, useState } from 'react';
import { CheckCircle, Eye, EyeOff, Key, LogIn, Save, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { useToast } from '../../hooks/useToast';
import { API_BASE } from '../../constants';

interface SettingsData {
  hasAnthropicKey?: boolean;
  keySource?: 'settings' | 'env';
  keyHint?: string;
  hasAnthropicAuthToken?: boolean;
  authSource?: 'settings' | 'env';
  authHint?: string;
  hasOpenaiKey?: boolean;
  openaiKeyHint?: string;
  openaiBaseUrl?: string;
}

export function AiLabsKeysSection() {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Anthropic API key
  const [anthropicInput, setAnthropicInput] = useState('');
  const [hasAnthropicKey, setHasAnthropicKey] = useState(false);
  const [anthropicSource, setAnthropicSource] = useState<'settings' | 'env' | undefined>();
  const [anthropicHint, setAnthropicHint] = useState<string | undefined>();
  const [showAnthropic, setShowAnthropic] = useState(false);

  // Claude OAuth subscription token (alternative to the API key)
  const [hasAuth, setHasAuth] = useState(false);
  const [authSource, setAuthSource] = useState<'settings' | 'env' | undefined>();
  const [authHint, setAuthHint] = useState<string | undefined>();
  const [authInput, setAuthInput] = useState('');
  const [showAuth, setShowAuth] = useState(false);
  const [savingAuth, setSavingAuth] = useState(false);

  // OpenAI
  const [openaiInput, setOpenaiInput] = useState('');
  const [hasOpenaiKey, setHasOpenaiKey] = useState(false);
  const [openaiHint, setOpenaiHint] = useState<string | undefined>();
  const [showOpenai, setShowOpenai] = useState(false);
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState('');

  // Codex sign-in (device-auth)
  const [loggingIntoCodex, setLoggingIntoCodex] = useState(false);
  const [codexLoginOutput, setCodexLoginOutput] = useState<string[]>([]);

  const load = async () => {
    try {
      const res = await fetch(`${API_BASE}/settings`);
      const d: SettingsData = await res.json();
      setHasAnthropicKey(!!d.hasAnthropicKey);
      setAnthropicSource(d.keySource);
      setAnthropicHint(d.keyHint);
      setAnthropicInput('');
      setHasAuth(!!d.hasAnthropicAuthToken);
      setAuthSource(d.authSource);
      setAuthHint(d.authHint);
      setHasOpenaiKey(!!d.hasOpenaiKey);
      setOpenaiHint(d.openaiKeyHint);
      setOpenaiBaseUrl(d.openaiBaseUrl ?? '');
      setOpenaiInput('');
    } catch {
      /* ignore — keys just show as unset */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const post = async (body: Record<string, unknown>): Promise<boolean> => {
    const res = await fetch(`${API_BASE}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return !!(await res.json()).ok;
  };

  const saveAnthropic = async () => {
    if (!anthropicInput.trim()) return;
    setSaving(true);
    try {
      if (await post({ anthropicKey: anthropicInput.trim() })) {
        addToast('Anthropic key saved', 'success');
        await load();
      } else {
        addToast('Failed to save Anthropic key', 'error');
      }
    } catch {
      addToast('Failed to save Anthropic key', 'error');
    } finally {
      setSaving(false);
    }
  };

  const clearAnthropic = async () => {
    setSaving(true);
    try {
      await post({ clearAnthropicKey: true });
      addToast('Anthropic key removed', 'success');
      await load();
    } catch {
      addToast('Failed to remove key', 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveAuth = async () => {
    if (!authInput.trim()) return;
    setSavingAuth(true);
    try {
      if (await post({ anthropicAuthToken: authInput.trim() })) {
        addToast('Claude OAuth token saved', 'success');
        setAuthInput('');
        await load();
      } else {
        addToast('Failed to save token', 'error');
      }
    } catch {
      addToast('Failed to save token', 'error');
    } finally {
      setSavingAuth(false);
    }
  };

  const clearAuth = async () => {
    setSavingAuth(true);
    try {
      await post({ clearAnthropicAuthToken: true });
      addToast('Claude OAuth token removed', 'success');
      await load();
    } catch {
      addToast('Failed to remove token', 'error');
    } finally {
      setSavingAuth(false);
    }
  };

  const saveOpenai = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { openaiBaseUrl };
      if (openaiInput.trim()) body.openaiApiKey = openaiInput.trim();
      if (await post(body)) {
        addToast('OpenAI settings saved', 'success');
        setOpenaiInput('');
        await load();
        // A freshly-added key unlocks the live OpenAI model list — nudge the
        // Models section to re-fetch it.
        window.dispatchEvent(new Event('docvault:models-refresh'));
      } else {
        addToast('Failed to save', 'error');
      }
    } catch {
      addToast('Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  const clearOpenai = async () => {
    setSaving(true);
    try {
      await post({ clearOpenaiApiKey: true });
      addToast('OpenAI key removed', 'success');
      await load();
    } catch {
      addToast('Failed to remove key', 'error');
    } finally {
      setSaving(false);
    }
  };

  // Drive `codex login --device-auth` on the server over SSE. Codex streams a
  // verification URL + code (shown below the button); the user authorizes in any
  // browser and codex writes auth.json to CODEX_HOME on the NAS.
  const handleCodexLogin = () => {
    setCodexLoginOutput([]);
    setLoggingIntoCodex(true);
    const es = new EventSource(`${API_BASE}/codex/login`);
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data) as {
          type: string;
          text?: string;
          ok?: boolean;
          message?: string;
        };
        if (ev.type === 'line' && ev.text) {
          setCodexLoginOutput((prev) => [...prev, ev.text as string]);
        } else if (ev.type === 'done') {
          es.close();
          setLoggingIntoCodex(false);
          addToast(
            ev.ok ? 'Signed in to Codex' : 'Codex sign-in failed',
            ev.ok ? 'success' : 'error'
          );
        } else if (ev.type === 'error') {
          es.close();
          setLoggingIntoCodex(false);
          addToast(`Codex sign-in error: ${ev.message ?? 'unknown'}`, 'error');
        }
      } catch {
        /* ignore malformed event */
      }
    };
    es.onerror = () => {
      es.close();
      setLoggingIntoCodex(false);
    };
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
      <h3 className="text-lg font-semibold text-surface-950 mb-1 flex items-center gap-2">
        <Sparkles className="w-5 h-5" />
        AI Credentials
      </h3>
      <p className="text-[12px] text-surface-600 mb-4">
        Provider keys and sign-ins. Which model or chat agent actually runs is chosen in the Models
        &amp; Chat card below.
      </p>

      <div className="space-y-5">
        {/* ── Anthropic API key ───────────────────────── */}
        <div>
          <label className="flex items-center gap-2 text-[13px] font-medium text-surface-800 mb-2">
            <Key className="w-4 h-4" />
            Anthropic API key
          </label>

          {hasAnthropicKey && anthropicSource === 'settings' ? (
            <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
              <CheckCircle className="w-5 h-5 text-emerald-400" />
              <span className="flex-1 text-[13px] text-emerald-400 font-medium">
                Key set
                {anthropicHint && (
                  <span className="font-mono text-emerald-400/70 ml-2">…{anthropicHint}</span>
                )}
              </span>
              <Button variant="ghost-danger" size="xs" onClick={clearAnthropic} disabled={saving}>
                Remove
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {anthropicSource === 'env' && (
                <div className="flex items-center gap-2 p-3 bg-info-500/10 border border-info-500/20 rounded-xl">
                  <CheckCircle className="w-5 h-5 text-info-400" />
                  <span className="flex-1 text-[13px] text-info-400 font-medium">
                    Environment variable
                    {anthropicHint && (
                      <span className="font-mono text-info-400/70 ml-2">…{anthropicHint}</span>
                    )}
                  </span>
                </div>
              )}
              <div className="relative">
                <Input
                  type={showAnthropic ? 'text' : 'password'}
                  value={anthropicInput}
                  onChange={(e) => setAnthropicInput(e.target.value)}
                  placeholder={anthropicSource === 'env' ? 'Enter key to override…' : 'sk-ant-…'}
                  className="pr-10 text-[13px] font-mono"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setShowAnthropic(!showAnthropic)}
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                >
                  {showAnthropic ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
              {anthropicSource !== 'env' && (
                <p className="text-[11px] text-surface-600">
                  Get your API key at{' '}
                  <a
                    href="https://console.anthropic.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent-400 hover:underline"
                  >
                    console.anthropic.com
                  </a>
                </p>
              )}
            </div>
          )}

          {anthropicInput && (
            <Button onClick={saveAnthropic} size="sm" disabled={saving} className="mt-2">
              <Save className="w-4 h-4" />
              {saving ? 'Saving…' : 'Save key'}
            </Button>
          )}
        </div>

        {/* ── Claude OAuth subscription token ──────────── */}
        <div className="pt-4 border-t border-border/30">
          <label className="flex items-center gap-2 text-[13px] font-medium text-surface-800 mb-2">
            <Key className="w-4 h-4" />
            Claude OAuth token
            <span className="font-normal text-surface-500">
              (use your Claude.ai subscription instead of API billing)
            </span>
          </label>

          {hasAuth && authSource === 'settings' ? (
            <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
              <CheckCircle className="w-5 h-5 text-emerald-400" />
              <span className="flex-1 text-[13px] text-emerald-400 font-medium">
                Token set
                {authHint && (
                  <span className="font-mono text-emerald-400/70 ml-2">…{authHint}</span>
                )}
              </span>
              <Button variant="ghost-danger" size="xs" onClick={clearAuth} disabled={savingAuth}>
                Remove
              </Button>
            </div>
          ) : hasAuth && authSource === 'env' ? (
            <div className="flex items-center gap-2 p-3 bg-info-500/10 border border-info-500/20 rounded-xl">
              <CheckCircle className="w-5 h-5 text-info-400" />
              <span className="flex-1 text-[13px] text-info-400 font-medium">
                Set via ANTHROPIC_AUTH_TOKEN env
                {authHint && <span className="font-mono text-info-400/70 ml-2">…{authHint}</span>}
              </span>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="relative">
                <Input
                  type={showAuth ? 'text' : 'password'}
                  value={authInput}
                  onChange={(e) => setAuthInput(e.target.value)}
                  placeholder="sk-ant-oat01-… or paste from `claude setup-token`"
                  className="pr-10 text-[13px] font-mono"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setShowAuth(!showAuth)}
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                >
                  {showAuth ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
              <p className="text-[11px] text-surface-600">
                Run <code className="font-mono">claude setup-token</code> on a machine where Claude
                Code is signed in to mint a long-lived token, then paste it here.
              </p>
              {authInput && (
                <Button onClick={saveAuth} size="sm" disabled={savingAuth}>
                  <Save className="w-4 h-4" />
                  {savingAuth ? 'Saving…' : 'Save token'}
                </Button>
              )}
            </div>
          )}
        </div>

        {/* ── OpenAI ──────────────────────────────────── */}
        <div className="pt-4 border-t border-border/30">
          <label className="flex items-center gap-2 text-[13px] font-medium text-surface-800 mb-2">
            <Key className="w-4 h-4" />
            OpenAI API key
          </label>

          {hasOpenaiKey && !openaiInput ? (
            <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
              <CheckCircle className="w-5 h-5 text-emerald-400" />
              <span className="flex-1 text-[13px] text-emerald-400 font-medium">
                Key set
                {openaiHint && (
                  <span className="font-mono text-emerald-400/70 ml-2">…{openaiHint}</span>
                )}
              </span>
              <Button variant="ghost-danger" size="xs" onClick={clearOpenai} disabled={saving}>
                Remove
              </Button>
            </div>
          ) : (
            <div className="relative">
              <Input
                type={showOpenai ? 'text' : 'password'}
                value={openaiInput}
                onChange={(e) => setOpenaiInput(e.target.value)}
                placeholder="sk-…"
                className="pr-10 text-[13px] font-mono"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => setShowOpenai(!showOpenai)}
                className="absolute right-2 top-1/2 -translate-y-1/2"
              >
                {showOpenai ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </Button>
            </div>
          )}

          <label className="block text-[12px] font-medium text-surface-700 mt-3 mb-1">
            Base URL{' '}
            <span className="font-normal text-surface-500">
              (optional — point at a local OpenAI-compatible model)
            </span>
          </label>
          <Input
            type="text"
            value={openaiBaseUrl}
            onChange={(e) => setOpenaiBaseUrl(e.target.value)}
            placeholder="https://api.openai.com/v1  ·  or  http://nas:11434/v1 for Ollama"
            className="text-[13px] font-mono"
          />

          <Button onClick={saveOpenai} size="sm" disabled={saving} className="mt-3">
            <Save className="w-4 h-4" />
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>

        {/* ── Codex sign-in (ChatGPT subscription) ─────── */}
        <div className="pt-4 border-t border-border/30">
          <label className="flex items-center gap-2 text-[13px] font-medium text-surface-800 mb-2">
            <LogIn className="w-4 h-4" />
            Codex sign-in
            <span className="font-normal text-surface-500">(ChatGPT subscription)</span>
          </label>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleCodexLogin}
            disabled={loggingIntoCodex}
          >
            <LogIn className="w-4 h-4" />
            {loggingIntoCodex ? 'Waiting for authorization…' : 'Sign in to Codex'}
          </Button>
          <p className="text-[11px] text-surface-500 mt-1">
            Runs codex device-auth on the server — a verification link + code appears below. Open it
            in any browser, authorize, and the token saves to the NAS. Used by the Codex chat
            backend (set in Models &amp; Chat).
          </p>
          {codexLoginOutput.length > 0 && (
            <pre className="mt-2 bg-surface-0 border border-border/40 rounded p-2 text-[11px] overflow-x-auto whitespace-pre-wrap break-words">
              {codexLoginOutput.join('\n')}
            </pre>
          )}
        </div>
      </div>
    </Card>
  );
}
