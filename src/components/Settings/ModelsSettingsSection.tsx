// Models & Chat — every task carries its own explicit model (no global default):
//   • Document parsing & forms — provider + model
//   • Chat backend — Claude (+ its model) or Codex (+ its model)
//   • Deep Research — Agent (Claude Code + WebSearch on the subscription) or
//     API (direct web_search; provider + model)
// Credentials (keys, tokens, Codex sign-in) live in the AI Credentials card.
// Model lists load live from each provider's /v1/models (GET /api/models).

import { useEffect, useState } from 'react';
import { Bot, Cpu, RefreshCw, Save, Sparkles } from 'lucide-react';
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
  deepResearch?: { mode?: 'agent' | 'api'; model?: ModelRef };
}

const DEFAULTS: Record<Provider, string> = { anthropic: 'claude-sonnet-4-6', openai: 'gpt-4o' };
const PROVIDERS: Provider[] = ['anthropic', 'openai'];
const CUSTOM = '__custom__';
const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-6';
const selectClass =
  'w-full text-[13px] bg-surface-100/60 border border-border/40 rounded-lg px-2 py-1.5';

export function ModelsSettingsSection() {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [claudeModel, setClaudeModel] = useState(DEFAULT_CLAUDE_MODEL);
  const [parsing, setParsing] = useState<ModelRef>({
    provider: 'anthropic',
    model: DEFAULTS.anthropic,
  });
  const [chatBackend, setChatBackend] = useState<'claude' | 'codex'>('claude');
  const [codexModel, setCodexModel] = useState('');
  const [drMode, setDrMode] = useState<'agent' | 'api'>('api');
  const [drModel, setDrModel] = useState<ModelRef>({
    provider: 'anthropic',
    model: DEFAULTS.anthropic,
  });

  const [modelsByProvider, setModelsByProvider] = useState<Record<Provider, string[]>>({
    anthropic: [],
    openai: [],
  });
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const res = await fetch(`${API_BASE}/settings`);
      const d: SettingsData = await res.json();
      const anthropicFallback: ModelRef = {
        provider: 'anthropic',
        model: d.claudeModel || DEFAULTS.anthropic,
      };
      setClaudeModel(d.claudeModel || DEFAULT_CLAUDE_MODEL);
      setParsing(d.modelRouting?.parsing ?? anthropicFallback);
      setChatBackend(d.chat?.backend === 'codex' ? 'codex' : 'claude');
      setCodexModel(d.chat?.codexModel ?? '');
      setDrMode(d.deepResearch?.mode === 'agent' ? 'agent' : 'api');
      setDrModel(d.deepResearch?.model ?? anthropicFallback);
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
      for (const { p, models } of results) {
        byProvider[p] = models;
      }
      setModelsByProvider(byProvider);
      if (refresh) {
        const live = results.filter((r) => r.source === 'live').length;
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
          claudeModel: claudeModel.trim() || DEFAULT_CLAUDE_MODEL,
          modelRouting: { parsing },
          chat: { backend: chatBackend, codexModel: codexModel.trim() },
          deepResearch: { mode: drMode, model: drModel },
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

  const drApiOpenaiFallback = drMode === 'api' && drModel.provider === 'openai';

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
        Each task uses its own explicit model. PDFs always parse on Anthropic (OpenAI can't read
        PDFs directly). Keys live in the AI Credentials card above.
      </p>

      <div className="space-y-5">
        <ScopeRow
          label="Document parsing & forms"
          value={parsing}
          onChange={setParsing}
          models={modelsByProvider}
        />

        {/* Chat backend + its model */}
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
          {chatBackend === 'claude' ? (
            <div className="mt-2">
              <label className="block text-[11px] text-surface-500 mb-1">Claude model</label>
              <ModelSelect
                value={claudeModel}
                onChange={setClaudeModel}
                models={modelsByProvider.anthropic}
              />
            </div>
          ) : (
            <div className="mt-2 space-y-2">
              <p className="text-[11px] text-surface-600 leading-relaxed">
                Codex runs server-side on your ChatGPT subscription with native file tools. Sign in
                via the <span className="font-medium">Sign in to Codex</span> button in AI
                Credentials.
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

        {/* Deep Research engine */}
        <div className="pt-3 border-t border-border/30">
          <label className="flex items-center gap-2 text-[13px] font-medium text-surface-800 mb-1">
            <Sparkles className="w-4 h-4" />
            Deep Research
            <span className="font-normal text-surface-500">(how research runs)</span>
          </label>
          <select
            value={drMode}
            onChange={(e) => setDrMode(e.target.value as 'agent' | 'api')}
            className={selectClass}
          >
            <option value="api">API — direct web_search call (provider + model)</option>
            <option value="agent">Agent — Claude Code + WebSearch on your subscription</option>
          </select>
          {drMode === 'api' ? (
            <div className="mt-2">
              <ScopeRow
                label="Research model"
                value={drModel}
                onChange={setDrModel}
                models={modelsByProvider}
              />
              {drApiOpenaiFallback && (
                <p className="text-[11px] text-amber-500/90 mt-1">
                  Native web search is Anthropic-only for now — an OpenAI pick falls back to a
                  Claude model until per-provider search is wired.
                </p>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-surface-600 mt-2 leading-relaxed">
              Runs Claude Code with WebSearch on your Claude subscription — an agentic loop (search
              → read → iterate). Uses the OAuth token from AI Credentials; no API billing.
            </p>
          )}
        </div>

        <Button onClick={save} size="sm" disabled={saving}>
          <Save className="w-4 h-4" />
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </Card>
  );
}

/** Anthropic-only model dropdown (live list + Custom…). For Claude chat model. */
function ModelSelect({
  value,
  onChange,
  models,
}: {
  value: string;
  onChange: (v: string) => void;
  models: string[];
}) {
  const [custom, setCustom] = useState(false);
  if (custom) {
    return (
      <Input
        type="text"
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={DEFAULT_CLAUDE_MODEL}
        className="text-[13px] font-mono"
      />
    );
  }
  return (
    <select
      value={value}
      onChange={(e) => {
        if (e.target.value === CUSTOM) {
          setCustom(true);
          return;
        }
        onChange(e.target.value);
      }}
      className={`${selectClass} font-mono`}
    >
      {!models.includes(value) && value && <option value={value}>{value}</option>}
      {models.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
      <option value={CUSTOM}>Custom…</option>
    </select>
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
