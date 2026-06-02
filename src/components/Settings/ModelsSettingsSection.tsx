// Models & Chat — choose what runs each task. Default model is the fallback;
// Document parsing/forms and Deep Research are direct-API scopes; Chat backend
// picks the chat AGENT (Claude Code vs Codex on the OpenAI sub). Credentials
// (keys, tokens, Codex sign-in) live in the AI Credentials card above.
//
// Model lists load live from each provider's /v1/models (GET /api/models), so
// new releases show up automatically; "Custom…" types any id.

import { useEffect, useState } from 'react';
import { Bot, Cpu, RefreshCw, Save } from 'lucide-react';
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
  modelRouting?: { parsing?: ModelRef };
  chat?: { backend?: 'claude' | 'codex'; codexModel?: string };
}

const DEFAULTS: Record<Provider, string> = { anthropic: 'claude-sonnet-4-6', openai: 'gpt-4o' };
const PROVIDERS: Provider[] = ['anthropic', 'openai'];
const CUSTOM = '__custom__';
const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-6';

export function ModelsSettingsSection() {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [defaultModel, setDefaultModel] = useState(DEFAULT_CLAUDE_MODEL);
  const [defaultCustom, setDefaultCustom] = useState(false);
  const [parsing, setParsing] = useState<ModelRef>({
    provider: 'anthropic',
    model: DEFAULTS.anthropic,
  });
  const [chatBackend, setChatBackend] = useState<'claude' | 'codex'>('claude');
  const [codexModel, setCodexModel] = useState('');

  // Live model lists per provider, fetched from /api/models.
  const [modelsByProvider, setModelsByProvider] = useState<Record<Provider, string[]>>({
    anthropic: [],
    openai: [],
  });
  const [modelSource, setModelSource] = useState<Record<Provider, string>>({
    anthropic: '',
    openai: '',
  });
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const res = await fetch(`${API_BASE}/settings`);
      const d: SettingsData = await res.json();
      const fallback: ModelRef = {
        provider: 'anthropic',
        model: d.claudeModel || DEFAULTS.anthropic,
      };
      setDefaultModel(d.claudeModel || DEFAULT_CLAUDE_MODEL);
      setParsing(d.modelRouting?.parsing ?? fallback);
      setChatBackend(d.chat?.backend === 'codex' ? 'codex' : 'claude');
      setCodexModel(d.chat?.codexModel ?? '');
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  const fetchModels = async (refresh = false) => {
    if (refresh) setRefreshing(true);
    try {
      const results = await Promise.all(
        PROVIDERS.map((p) =>
          fetch(`${API_BASE}/models?provider=${p}${refresh ? '&refresh=1' : ''}`)
            .then((r) => r.json())
            .then((d) => ({
              p,
              models: (d.models as string[]) ?? [],
              source: (d.source as string) ?? 'error',
            }))
            .catch(() => ({ p, models: [] as string[], source: 'error' }))
        )
      );
      const byProvider: Record<Provider, string[]> = { anthropic: [], openai: [] };
      const bySource: Record<Provider, string> = { anthropic: '', openai: '' };
      for (const { p, models, source } of results) {
        byProvider[p] = models;
        bySource[p] = source;
      }
      setModelsByProvider(byProvider);
      setModelSource(bySource);
      if (refresh) {
        const live = PROVIDERS.filter((p) => bySource[p] === 'live').length;
        addToast(
          live
            ? `Refreshed model lists (${live}/2 live)`
            : 'Refreshed (using cached/fallback lists)',
          live ? 'success' : 'info'
        );
      }
    } finally {
      if (refresh) setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
    void fetchModels();
    // The AI Credentials card broadcasts this after the OpenAI key/base URL
    // changes, since a freshly-added key unlocks the live model list.
    const onRefresh = () => {
      void load();
      void fetchModels(true);
    };
    window.addEventListener('docvault:models-refresh', onRefresh);
    return () => window.removeEventListener('docvault:models-refresh', onRefresh);
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          claudeModel: defaultModel.trim() || DEFAULT_CLAUDE_MODEL,
          modelRouting: { parsing },
          chat: { backend: chatBackend, codexModel: codexModel.trim() },
        }),
      });
      if ((await res.json()).ok) {
        addToast('Models & Chat saved', 'success');
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

  if (loading) {
    return (
      <Card variant="glass" className="p-6 mb-8">
        <div className="text-center py-4 text-surface-600">Loading…</div>
      </Card>
    );
  }

  const usesOpenai = parsing.provider === 'openai';
  const openaiFallback = modelSource.openai === 'fallback';
  const anthropicModels = modelsByProvider.anthropic;
  const selectClass =
    'w-full text-[13px] bg-surface-100/60 border border-border/40 rounded-lg px-2 py-1.5';

  return (
    <Card variant="glass" className="p-6 mb-8">
      <div className="flex items-start justify-between gap-2 mb-1">
        <h3 className="text-lg font-semibold text-surface-950 flex items-center gap-2">
          <Cpu className="w-5 h-5" />
          Models &amp; Chat
        </h3>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => void fetchModels(true)}
          disabled={refreshing}
          title="Re-fetch each provider's current model list"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Refreshing…' : 'Refresh models'}
        </Button>
      </div>
      <p className="text-[12px] text-surface-600 mb-4">
        What runs each task. PDFs always parse on Anthropic (OpenAI can't read PDFs directly). Keys
        live in the AI Credentials card above.
      </p>

      <div className="space-y-5">
        {/* Default (fallback) model — Anthropic */}
        <div className="flex flex-col sm:flex-row sm:items-end gap-2">
          <div className="flex-1">
            <label className="block text-[13px] font-medium text-surface-800 mb-1">
              Default Claude model{' '}
              <span className="font-normal text-surface-500">
                (Deep Research, image analysis, Claude chat; parsing fallback)
              </span>
            </label>
            {defaultCustom ? (
              <Input
                type="text"
                autoFocus
                value={defaultModel}
                onChange={(e) => setDefaultModel(e.target.value)}
                placeholder={DEFAULT_CLAUDE_MODEL}
                className="text-[13px] font-mono"
              />
            ) : (
              <select
                value={defaultModel}
                onChange={(e) => {
                  if (e.target.value === CUSTOM) {
                    setDefaultCustom(true);
                    return;
                  }
                  setDefaultModel(e.target.value);
                }}
                className={`${selectClass} font-mono`}
              >
                {!anthropicModels.includes(defaultModel) && defaultModel && (
                  <option value={defaultModel}>{defaultModel}</option>
                )}
                {anthropicModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
                <option value={CUSTOM}>Custom…</option>
              </select>
            )}
          </div>
        </div>

        <ScopeRow
          label="Document parsing & forms"
          value={parsing}
          onChange={setParsing}
          models={modelsByProvider}
        />

        {/* Chat agent backend */}
        <div className="pt-3 border-t border-border/30">
          <label className="flex items-center gap-2 text-[13px] font-medium text-surface-800 mb-1">
            <Bot className="w-4 h-4" />
            Chat backend
            <span className="font-normal text-surface-500">(which agent powers Chat)</span>
          </label>
          <select
            value={chatBackend}
            onChange={(e) => setChatBackend(e.target.value as 'claude' | 'codex')}
            className={selectClass}
          >
            <option value="claude">Claude (Claude Code — curated tools)</option>
            <option value="codex">Codex (OpenAI subscription — native tools)</option>
          </select>
          {chatBackend === 'codex' && (
            <div className="mt-2 space-y-2">
              <p className="text-[11px] text-surface-600 leading-relaxed">
                Codex runs server-side on your ChatGPT subscription with native file tools over a
                read-only, secrets-excluded view of the data dir. Sign in via the{' '}
                <span className="font-medium">Sign in to Codex</span> button in AI Credentials.
              </p>
              <label className="block text-[11px] text-surface-500">Codex model (optional)</label>
              <Input
                type="text"
                value={codexModel}
                onChange={(e) => setCodexModel(e.target.value)}
                placeholder="leave blank for codex's account default"
                className="text-[13px] font-mono"
              />
            </div>
          )}
        </div>

        {usesOpenai && openaiFallback && (
          <p className="text-[11px] text-amber-500/90 -mt-2">
            Showing a built-in fallback list for OpenAI — add your OpenAI key in the AI Credentials
            card above to load the live model list.
          </p>
        )}

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
  models,
}: {
  label: string;
  value: ModelRef;
  onChange: (v: ModelRef) => void;
  models: Record<Provider, string[]>;
}) {
  const [custom, setCustom] = useState(false);
  // Reset custom mode when the provider changes (model resets to a default).
  useEffect(() => {
    setCustom(false);
  }, [value.provider]);

  const list = models[value.provider] ?? [];
  const knownValue = list.includes(value.model);
  const selectClass =
    'w-full text-[13px] bg-surface-100/60 border border-border/40 rounded-lg px-2 py-1.5';

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
          className={selectClass}
        >
          <option value="anthropic">Anthropic (Claude)</option>
          <option value="openai">OpenAI</option>
        </select>
      </div>
      <div className="flex-1">
        <label className="block text-[11px] text-surface-500 mb-1">Model</label>
        <select
          value={custom ? CUSTOM : value.model}
          onChange={(e) => {
            if (e.target.value === CUSTOM) {
              setCustom(true);
              return;
            }
            setCustom(false);
            onChange({ ...value, model: e.target.value });
          }}
          className={`${selectClass} font-mono`}
        >
          {/* Preserve a saved custom/unknown id as a selectable option */}
          {!knownValue && value.model && !custom && (
            <option value={value.model}>{value.model}</option>
          )}
          {list.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
          <option value={CUSTOM}>Custom…</option>
        </select>
        {custom && (
          <Input
            type="text"
            autoFocus
            value={value.model}
            onChange={(e) => onChange({ ...value, model: e.target.value })}
            placeholder="model id, e.g. gpt-4o-mini"
            className="text-[13px] font-mono mt-1.5"
          />
        )}
      </div>
    </div>
  );
}
