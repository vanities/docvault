// Models settings — choose which provider + model runs each direct-API task
// (document parsing/forms, and Deep Research), plus the OpenAI key + optional
// base URL (for a self-hosted OpenAI-compatible local model). Chat is NOT here —
// it's an agent backend, configured in its own section.

import { useEffect, useState } from 'react';
import { CheckCircle, Cpu, Eye, EyeOff, Key, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { useToast } from '../../hooks/useToast';
import { API_BASE } from '../../constants';

type Provider = 'anthropic' | 'openai';
interface ModelRef {
  provider: Provider;
  model: string;
}
interface SettingsData {
  claudeModel?: string;
  hasOpenaiKey?: boolean;
  openaiKeyHint?: string;
  openaiBaseUrl?: string;
  modelRouting?: { parsing?: ModelRef; research?: ModelRef };
}

const DEFAULTS: Record<Provider, string> = { anthropic: 'claude-sonnet-4-6', openai: 'gpt-4o' };

export function ModelsSettingsSection() {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [parsing, setParsing] = useState<ModelRef>({
    provider: 'anthropic',
    model: DEFAULTS.anthropic,
  });
  const [research, setResearch] = useState<ModelRef>({
    provider: 'anthropic',
    model: DEFAULTS.anthropic,
  });

  const [hasOpenaiKey, setHasOpenaiKey] = useState(false);
  const [openaiKeyHint, setOpenaiKeyHint] = useState<string | undefined>();
  const [openaiKeyInput, setOpenaiKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState('');

  const load = async () => {
    try {
      const res = await fetch(`${API_BASE}/settings`);
      const d: SettingsData = await res.json();
      const fallback: ModelRef = {
        provider: 'anthropic',
        model: d.claudeModel || DEFAULTS.anthropic,
      };
      setParsing(d.modelRouting?.parsing ?? fallback);
      setResearch(d.modelRouting?.research ?? fallback);
      setHasOpenaiKey(!!d.hasOpenaiKey);
      setOpenaiKeyHint(d.openaiKeyHint);
      setOpenaiBaseUrl(d.openaiBaseUrl ?? '');
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
      const body: Record<string, unknown> = { modelRouting: { parsing, research }, openaiBaseUrl };
      if (openaiKeyInput.trim()) body.openaiApiKey = openaiKeyInput.trim();
      const res = await fetch(`${API_BASE}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if ((await res.json()).ok) {
        addToast('Model settings saved', 'success');
        setOpenaiKeyInput('');
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

  const clearKey = async () => {
    setSaving(true);
    try {
      await fetch(`${API_BASE}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearOpenaiApiKey: true }),
      });
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

  const usesOpenai = parsing.provider === 'openai' || research.provider === 'openai';

  return (
    <Card variant="glass" className="p-6 mb-8">
      <h3 className="text-lg font-semibold text-surface-950 mb-1 flex items-center gap-2">
        <Cpu className="w-5 h-5" />
        Models
      </h3>
      <p className="text-[12px] text-surface-600 mb-4">
        Choose which provider + model runs each task. Parsing covers document parsing and form
        auto-fill; Research is Deep Research. Chat is configured separately — it uses an agent
        backend. PDFs always parse on Anthropic (OpenAI can't read PDFs directly).
      </p>

      <div className="space-y-5">
        <ScopeRow label="Document parsing & forms" value={parsing} onChange={setParsing} />
        <ScopeRow label="Deep Research" value={research} onChange={setResearch} />

        <div className="pt-3 border-t border-border/30">
          <label className="flex items-center gap-2 text-[13px] font-medium text-surface-800 mb-2">
            <Key className="w-4 h-4" />
            OpenAI API key
            <span className="font-normal text-surface-500">
              {usesOpenai
                ? '(required for the OpenAI selections above)'
                : '(needed if you switch a task to OpenAI)'}
            </span>
          </label>
          {hasOpenaiKey && !openaiKeyInput ? (
            <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
              <CheckCircle className="w-5 h-5 text-emerald-400" />
              <span className="flex-1 text-[13px] text-emerald-400 font-medium">
                Key set <span className="font-mono text-emerald-400/70">…{openaiKeyHint}</span>
              </span>
              <Button variant="ghost-danger" size="xs" onClick={clearKey} disabled={saving}>
                Remove
              </Button>
            </div>
          ) : (
            <div className="relative">
              <Input
                type={showKey ? 'text' : 'password'}
                value={openaiKeyInput}
                onChange={(e) => setOpenaiKeyInput(e.target.value)}
                placeholder="sk-…"
                className="pr-10 text-[13px] font-mono"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
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
        </div>

        <Button onClick={save} size="sm" disabled={saving}>
          <Save className="w-4 h-4" />
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </Card>
  );
}

function ScopeRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ModelRef;
  onChange: (v: ModelRef) => void;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end gap-2">
      <div className="flex-1">
        <label className="block text-[13px] font-medium text-surface-800 mb-1">{label}</label>
        <select
          value={value.provider}
          onChange={(e) => {
            const provider = e.target.value as Provider;
            onChange({ provider, model: DEFAULTS[provider] });
          }}
          className="w-full text-[13px] bg-surface-100/60 border border-border/40 rounded-lg px-2 py-1.5"
        >
          <option value="anthropic">Anthropic (Claude)</option>
          <option value="openai">OpenAI</option>
        </select>
      </div>
      <div className="flex-1">
        <label className="block text-[11px] text-surface-500 mb-1">Model</label>
        <Input
          type="text"
          value={value.model}
          onChange={(e) => onChange({ ...value, model: e.target.value })}
          placeholder={DEFAULTS[value.provider]}
          className="text-[13px] font-mono"
        />
      </div>
    </div>
  );
}
