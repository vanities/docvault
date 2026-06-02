// AI Labs — credentials for the AI model providers (Anthropic + OpenAI),
// grouped in one card. The Models section consumes these keys for its per-task
// provider/model routing; the OpenAI base URL can point at a local
// OpenAI-compatible server (Ollama, LM Studio, etc.). Saving the OpenAI key
// broadcasts `docvault:models-refresh` so the Models section reloads its live
// model list (a freshly-added key unlocks the provider's /v1/models endpoint).

import { useEffect, useState } from 'react';
import { CheckCircle, Eye, EyeOff, Key, Save, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { useToast } from '../../hooks/useToast';
import { API_BASE } from '../../constants';

interface SettingsData {
  hasAnthropicKey?: boolean;
  keySource?: 'settings' | 'env';
  keyHint?: string;
  claudeModel?: string;
  hasOpenaiKey?: boolean;
  openaiKeyHint?: string;
  openaiBaseUrl?: string;
}

const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-6';

export function AiLabsKeysSection() {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Anthropic
  const [anthropicInput, setAnthropicInput] = useState('');
  const [hasAnthropicKey, setHasAnthropicKey] = useState(false);
  const [anthropicSource, setAnthropicSource] = useState<'settings' | 'env' | undefined>();
  const [anthropicHint, setAnthropicHint] = useState<string | undefined>();
  const [showAnthropic, setShowAnthropic] = useState(false);
  const [claudeModel, setClaudeModel] = useState(DEFAULT_CLAUDE_MODEL);
  const [anthropicModels, setAnthropicModels] = useState<string[]>([]);
  const [customModel, setCustomModel] = useState(false);

  // OpenAI
  const [openaiInput, setOpenaiInput] = useState('');
  const [hasOpenaiKey, setHasOpenaiKey] = useState(false);
  const [openaiHint, setOpenaiHint] = useState<string | undefined>();
  const [showOpenai, setShowOpenai] = useState(false);
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState('');

  const load = async () => {
    try {
      const res = await fetch(`${API_BASE}/settings`);
      const d: SettingsData = await res.json();
      setHasAnthropicKey(!!d.hasAnthropicKey);
      setAnthropicSource(d.keySource);
      setAnthropicHint(d.keyHint);
      if (d.claudeModel) setClaudeModel(d.claudeModel);
      setAnthropicInput('');
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

  // Live Anthropic model list for the Default Claude model dropdown.
  useEffect(() => {
    fetch(`${API_BASE}/models?provider=anthropic`)
      .then((r) => r.json())
      .then((d: { models?: string[] }) => setAnthropicModels(d.models ?? []))
      .catch(() => {
        /* dropdown falls back to the current value + Custom */
      });
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

  const saveClaudeModel = async (model: string) => {
    try {
      await post({ claudeModel: model });
    } catch {
      /* non-fatal — model persists on next successful save */
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
        AI Labs
      </h3>
      <p className="text-[12px] text-surface-600 mb-4">
        API keys for the AI model providers. The Models section below uses these for per-task
        provider/model routing.
      </p>

      <div className="space-y-5">
        {/* ── Anthropic ───────────────────────────────── */}
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

          <label className="block text-[12px] font-medium text-surface-700 mt-3 mb-1">
            Default Claude model
          </label>
          {customModel ? (
            <Input
              type="text"
              autoFocus
              value={claudeModel}
              onChange={(e) => setClaudeModel(e.target.value)}
              onBlur={() => void saveClaudeModel(claudeModel)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveClaudeModel(claudeModel);
              }}
              placeholder={DEFAULT_CLAUDE_MODEL}
              className="text-[13px] font-mono"
            />
          ) : (
            <select
              value={claudeModel}
              onChange={(e) => {
                if (e.target.value === '__custom__') {
                  setCustomModel(true);
                  return;
                }
                setClaudeModel(e.target.value);
                void saveClaudeModel(e.target.value);
              }}
              className="w-full text-[13px] font-mono bg-surface-100/60 border border-border/40 rounded-lg px-2 py-1.5"
            >
              {!anthropicModels.includes(claudeModel) && claudeModel && (
                <option value={claudeModel}>{claudeModel}</option>
              )}
              {anthropicModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
              <option value="__custom__">Custom…</option>
            </select>
          )}
          <p className="text-[11px] text-surface-500 mt-1">
            Fallback for any task not given an explicit model in the Models section. Live Anthropic
            list — pick “Custom…” to type any id.
          </p>
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
      </div>
    </Card>
  );
}
