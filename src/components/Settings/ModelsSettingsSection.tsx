// Models & Chat — every task carries its own explicit model (no global default):
//   • Document parsing & forms — provider + model
//   • Chat backend — Claude (+ its model) or Codex (+ its model)
//   • Deep Research — Agent (Claude Code + WebSearch on the subscription) or
//     API (direct web_search; provider + model)
// Credentials (keys, tokens, Codex sign-in) live in the AI Credentials card.
// Model lists load live from each provider's /v1/models (GET /api/models).

import { useCallback, useEffect, useState } from 'react';
import { Bot, Cpu, Newspaper, RefreshCw, Save, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { useToast } from '../../hooks/useToast';
import { API_BASE } from '../../constants';

type Provider = 'anthropic' | 'openai';
type ModelEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
interface ModelRef {
  provider: Provider;
  model: string;
  effort?: ModelEffort;
}
interface SettingsData {
  claudeModel?: string;
  modelRouting?: { parsing?: ModelRef };
  chat?: {
    backend?: 'claude' | 'codex';
    claudeEffort?: ModelEffort;
    codexModel?: string;
    codexEffort?: ModelEffort;
  };
  deepResearch?: { mode?: 'agent' | 'api'; agentBackend?: 'claude' | 'codex'; model?: ModelRef };
  dailyNews?: {
    mode?: 'agent' | 'api';
    agentBackend?: 'claude' | 'codex';
    model?: ModelRef;
    title?: string;
    theme?: string;
    headlineImage?: boolean;
    imageModel?: string;
  };
}

const DEFAULTS: Record<Provider, string> = { anthropic: 'claude-sonnet-4-6', openai: 'gpt-4o' };
const PROVIDERS: Provider[] = ['anthropic', 'openai'];
// Reasoning-effort levels each provider accepts; the server clamps the rest
// per call surface (e.g. the direct Anthropic API has no 'xhigh').
const EFFORTS: Record<Provider, ModelEffort[]> = {
  anthropic: ['low', 'medium', 'high', 'xhigh', 'max'],
  openai: ['minimal', 'low', 'medium', 'high', 'xhigh'],
};
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
  const [claudeEffort, setClaudeEffort] = useState<ModelEffort | ''>('');
  const [codexModel, setCodexModel] = useState('');
  const [codexEffort, setCodexEffort] = useState<ModelEffort | ''>('');
  const [drMode, setDrMode] = useState<'agent' | 'api'>('api');
  const [drAgentBackend, setDrAgentBackend] = useState<'claude' | 'codex'>('claude');
  const [drModel, setDrModel] = useState<ModelRef>({
    provider: 'anthropic',
    model: DEFAULTS.anthropic,
  });
  const [dnMode, setDnMode] = useState<'agent' | 'api'>('api');
  const [dnAgentBackend, setDnAgentBackend] = useState<'claude' | 'codex'>('claude');
  const [dnModel, setDnModel] = useState<ModelRef>({
    provider: 'anthropic',
    model: DEFAULTS.anthropic,
  });
  const [dnTitle, setDnTitle] = useState('');
  const [dnTheme, setDnTheme] = useState('brew');
  const [dnHeadlineImage, setDnHeadlineImage] = useState(false);
  const [dnImageModel, setDnImageModel] = useState('gpt-image-2');
  const [themes, setThemes] = useState<Array<{ id: string; label: string }>>([]);

  const [modelsByProvider, setModelsByProvider] = useState<Record<Provider, string[]>>({
    anthropic: [],
    openai: [],
  });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
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
      setClaudeEffort(d.chat?.claudeEffort ?? '');
      setCodexModel(d.chat?.codexModel ?? '');
      setCodexEffort(d.chat?.codexEffort ?? '');
      setDrMode(d.deepResearch?.mode === 'agent' ? 'agent' : 'api');
      setDrAgentBackend(d.deepResearch?.agentBackend === 'codex' ? 'codex' : 'claude');
      setDrModel(d.deepResearch?.model ?? anthropicFallback);
      setDnMode(d.dailyNews?.mode === 'agent' ? 'agent' : 'api');
      setDnAgentBackend(d.dailyNews?.agentBackend === 'codex' ? 'codex' : 'claude');
      setDnModel(d.dailyNews?.model ?? anthropicFallback);
      setDnTitle(d.dailyNews?.title ?? '');
      setDnTheme(d.dailyNews?.theme ?? 'brew');
      setDnHeadlineImage(d.dailyNews?.headlineImage ?? false);
      setDnImageModel(d.dailyNews?.imageModel ?? 'gpt-image-2');
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchModels = useCallback(
    async (refresh = false) => {
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
    },
    [addToast]
  );

  useEffect(() => {
    void load();
    void fetchModels();
    void fetch(`${API_BASE}/daily-news/themes`)
      .then((r) => r.json())
      .then((d) => setThemes(d.cycle ? [d.cycle, ...(d.themes ?? [])] : (d.themes ?? [])))
      .catch(() => setThemes([]));
    const onRefresh = () => {
      void load();
      void fetchModels(true);
    };
    window.addEventListener('docvault:models-refresh', onRefresh);
    return () => window.removeEventListener('docvault:models-refresh', onRefresh);
  }, [fetchModels, load]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          claudeModel: claudeModel.trim() || DEFAULT_CLAUDE_MODEL,
          modelRouting: { parsing },
          chat: {
            backend: chatBackend,
            claudeEffort,
            codexModel: codexModel.trim(),
            codexEffort,
          },
          deepResearch: { mode: drMode, agentBackend: drAgentBackend, model: drModel },
          dailyNews: {
            mode: dnMode,
            agentBackend: dnAgentBackend,
            model: dnModel,
            title: dnTitle.trim(),
            theme: dnTheme,
            headlineImage: dnHeadlineImage,
            imageModel: dnImageModel,
          },
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
            <div className="mt-2 flex flex-col sm:flex-row gap-2">
              <div className="flex-1">
                <label className="block text-[11px] text-surface-500 mb-1">Claude model</label>
                <ModelSelect
                  value={claudeModel}
                  onChange={setClaudeModel}
                  models={modelsByProvider.anthropic}
                />
              </div>
              <div className="sm:w-40">
                <EffortSelect
                  provider="anthropic"
                  value={claudeEffort}
                  onChange={setClaudeEffort}
                />
              </div>
            </div>
          ) : (
            <div className="mt-2 space-y-2">
              <p className="text-[11px] text-surface-600 leading-relaxed">
                Codex runs server-side on your ChatGPT subscription with native file tools. Sign in
                via the <span className="font-medium">Sign in to Codex</span> button in AI
                Credentials.
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1">
                  <label className="block text-[11px] text-surface-500 mb-1">
                    Codex model (optional)
                  </label>
                  <Input
                    type="text"
                    value={codexModel}
                    onChange={(e) => setCodexModel(e.target.value)}
                    placeholder="leave blank for codex's account default"
                    className="text-[13px] font-mono"
                  />
                </div>
                <div className="sm:w-40">
                  <EffortSelect provider="openai" value={codexEffort} onChange={setCodexEffort} />
                </div>
              </div>
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
            <div className="mt-2 space-y-2">
              <label className="block text-[11px] text-surface-500">Agent (subscription)</label>
              <select
                value={drAgentBackend}
                onChange={(e) => {
                  const backend = e.target.value as 'claude' | 'codex';
                  setDrAgentBackend(backend);
                  // Keep the scope's ModelRef coherent with the backend's provider.
                  const provider: Provider = backend === 'codex' ? 'openai' : 'anthropic';
                  if (drModel.provider !== provider) {
                    setDrModel({
                      provider,
                      model: DEFAULTS[provider],
                      ...(drModel.effort ? { effort: drModel.effort } : {}),
                    });
                  }
                }}
                className={selectClass}
              >
                <option value="claude">Claude — Claude Code + WebSearch (Claude sub)</option>
                <option value="codex">Codex — app-server + web_search (OpenAI sub)</option>
              </select>
              <p className="text-[11px] text-surface-600 leading-relaxed">
                {drAgentBackend === 'codex'
                  ? 'Runs codex with web search on your OpenAI/ChatGPT subscription — an agentic loop, no API billing. Sign in via AI Credentials.'
                  : 'Runs Claude Code with WebSearch on your Claude subscription — an agentic loop (search → read → iterate), no API billing. Uses the OAuth token from AI Credentials.'}
              </p>
              <AgentModelRow
                backend={drAgentBackend}
                value={drModel}
                onChange={setDrModel}
                models={modelsByProvider}
              />
            </div>
          )}
        </div>

        {/* Newsstand engine — same three-way choice as Deep Research, but no
            web search (it synthesizes your own data), so any provider works. */}
        <div className="pt-3 border-t border-border/30">
          <label className="flex items-center gap-2 text-[13px] font-medium text-surface-800 mb-1">
            <Newspaper className="w-4 h-4" />
            Newsstand
            <span className="font-normal text-surface-500">(how the newspaper is written)</span>
          </label>
          <select
            value={dnMode}
            onChange={(e) => setDnMode(e.target.value as 'agent' | 'api')}
            className={selectClass}
          >
            <option value="api">API — direct call (provider + model)</option>
            <option value="agent">Agent — Claude Code or Codex on your subscription</option>
          </select>
          {dnMode === 'api' ? (
            <div className="mt-2">
              <ScopeRow
                label="Edition model"
                value={dnModel}
                onChange={setDnModel}
                models={modelsByProvider}
              />
              <p className="text-[11px] text-surface-500 mt-1">
                Newsstand synthesizes your own data (no web search), so any provider works here.
              </p>
            </div>
          ) : (
            <div className="mt-2 space-y-2">
              <label className="block text-[11px] text-surface-500">Agent (subscription)</label>
              <select
                value={dnAgentBackend}
                onChange={(e) => {
                  const backend = e.target.value as 'claude' | 'codex';
                  setDnAgentBackend(backend);
                  // Keep the scope's ModelRef coherent with the backend's provider.
                  const provider: Provider = backend === 'codex' ? 'openai' : 'anthropic';
                  if (dnModel.provider !== provider) {
                    setDnModel({
                      provider,
                      model: DEFAULTS[provider],
                      ...(dnModel.effort ? { effort: dnModel.effort } : {}),
                    });
                  }
                }}
                className={selectClass}
              >
                <option value="claude">Claude — Claude Code (Claude sub)</option>
                <option value="codex">Codex — app-server (OpenAI sub)</option>
              </select>
              <p className="text-[11px] text-surface-600 leading-relaxed">
                Runs on your subscription (no API billing). API mode is recommended for the
                unattended morning run — a stored API key doesn't expire like an OAuth session.
              </p>
              <AgentModelRow
                backend={dnAgentBackend}
                value={dnModel}
                onChange={setDnModel}
                models={modelsByProvider}
              />
            </div>
          )}
          <div className="mt-3">
            <label className="block text-[11px] text-surface-500 mb-1">Theme (house style)</label>
            <select
              value={dnTheme}
              onChange={(e) => setDnTheme(e.target.value)}
              className={selectClass}
            >
              {(themes.length ? themes : [{ id: 'brew', label: 'Morning Brew' }]).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            {dnTheme === 'cycle' && (
              <p className="text-[11px] text-surface-500 mt-1">
                Each day&apos;s edition uses the next house style, rotating through them all across
                the week.
              </p>
            )}
          </div>
          <div className="mt-3">
            <label className="block text-[11px] text-surface-500 mb-1">Masthead title</label>
            <Input
              type="text"
              value={dnTitle}
              onChange={(e) => setDnTitle(e.target.value)}
              placeholder="The DocVault Dispatch"
              className="text-[13px]"
            />
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <div>
              <label className="block text-[12px] font-medium text-surface-800">
                Headline image
              </label>
              <p className="text-[11px] text-surface-500">
                Generate an AI hero image per edition, matched to the theme (OpenAI · costs per
                image).
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDnHeadlineImage(!dnHeadlineImage)}
              className={`relative w-10 h-5 rounded-full flex-shrink-0 transition-colors ${dnHeadlineImage ? 'bg-violet-500' : 'bg-surface-400'}`}
            >
              <span
                className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                style={{ left: dnHeadlineImage ? 22 : 2 }}
              />
            </button>
          </div>
          {dnHeadlineImage && (
            <div className="mt-2">
              <label className="block text-[11px] text-surface-500 mb-1">
                Image model (OpenAI)
              </label>
              <ModelSelect
                value={dnImageModel}
                onChange={setDnImageModel}
                models={modelsByProvider.openai.filter((m) => /image|dall-?e/i.test(m))}
              />
              <p className="text-[11px] text-surface-500 mt-1">
                Pulled from your OpenAI models. Defaults to gpt-image-2 (OpenAI's newest); falls
                back to it if the chosen model isn't available to your account.
              </p>
            </div>
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

/**
 * Reasoning-effort dropdown. '' = the provider's default (the param is simply
 * not sent). Lists only the levels the given provider understands.
 */
function EffortSelect({
  provider,
  value,
  onChange,
  label = 'Effort',
}: {
  provider: Provider;
  value: ModelEffort | '';
  onChange: (v: ModelEffort | '') => void;
  label?: string;
}) {
  return (
    <div>
      <label className="block text-[11px] text-surface-500 mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as ModelEffort | '')}
        className={selectClass}
        title="How much reasoning/thinking the model applies — higher is smarter but slower and costlier"
      >
        <option value="">Default</option>
        {EFFORTS[provider].map((e) => (
          <option key={e} value={e}>
            {e}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Model + effort row for the agent (subscription) engines. The provider is
 * implied by the chosen backend (claude → Anthropic, codex → OpenAI); every
 * change rewrites the scope's ModelRef so it stays coherent with the backend.
 */
function AgentModelRow({
  backend,
  value,
  onChange,
  models,
}: {
  backend: 'claude' | 'codex';
  value: ModelRef;
  onChange: (v: ModelRef) => void;
  models: Record<Provider, string[]>;
}) {
  const provider: Provider = backend === 'codex' ? 'openai' : 'anthropic';
  const model = value.provider === provider ? value.model : DEFAULTS[provider];
  return (
    <div className="flex flex-col sm:flex-row gap-2">
      <div className="flex-1">
        <label className="block text-[11px] text-surface-500 mb-1">
          {backend === 'codex' ? 'Codex model' : 'Claude model'}
        </label>
        <ModelSelect
          value={model}
          onChange={(m) =>
            onChange({ provider, model: m, ...(value.effort ? { effort: value.effort } : {}) })
          }
          models={models[provider]}
        />
      </div>
      <div className="sm:w-40">
        <EffortSelect
          provider={provider}
          value={value.effort ?? ''}
          onChange={(effort) =>
            onChange(effort ? { provider, model, effort } : { provider, model })
          }
        />
      </div>
    </div>
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
      <div className="sm:w-36">
        <EffortSelect
          provider={value.provider}
          value={value.effort ?? ''}
          onChange={(effort) =>
            onChange(
              effort ? { ...value, effort } : { provider: value.provider, model: value.model }
            )
          }
        />
      </div>
    </div>
  );
}
