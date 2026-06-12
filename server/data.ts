// Shared data layer — types, constants, data loaders, and utilities.
// Extracted from server/index.ts to enable route module imports.

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { BrokerAccount, SnapTradeConfig } from './brokers.js';
import type { SimplefinConfig } from './simplefin.js';
import { createLogger } from './logger.js';
import { decryptField, encryptField, walkSensitiveFields } from './crypto-keys.js';

const logFiles = createLogger('Files');
const logMigration = createLogger('Migration');
const logSnapshots = createLogger('Snapshots');
const logGold = createLogger('Gold');
const logAuth = createLogger('Auth');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Data directory - contains entity subdirectories
export const DATA_DIR =
  process.env.DOCVAULT_DATA_DIR ||
  process.env.TAXVAULT_DATA_DIR ||
  path.join(__dirname, '..', 'data');
export const CONFIG_PATH = path.join(DATA_DIR, '.docvault-config.json');
export const SETTINGS_PATH = path.join(DATA_DIR, '.docvault-settings.json');
export const RCLONE_CONFIG_PATH = path.join(DATA_DIR, '.rclone.conf');
export const SYNC_SCRIPT_PATH = path.join(__dirname, '..', 'scripts', 'sync-to-dropbox.sh');
export const SYNC_SCRIPT_DATA_PATH = path.join(DATA_DIR, 'sync-to-dropbox.sh');
export const SCHEDULE_STATUS_FILE = path.join(DATA_DIR, '.docvault-schedule-status.json');
export const PORT = Number(process.env.DOCVAULT_PORT) || 3005;

// ============================================================================
// Types
// ============================================================================

// Health "person" — a labeled data bucket for Apple Health exports.
// Stored in .docvault-health.json, NOT in the entity config. Health is a
// global sidebar section, not an entity.
export interface HealthPerson {
  id: string;
  name: string;
  color?: string;
  icon?: string;
  createdAt: string;
  archivedAt?: string | null;
}

export interface EntityConfig {
  id: string;
  name: string;
  color: string;
  path: string;
  icon?: string;
  type?: 'tax' | 'docs';
  description?: string;
  metadata?: Record<string, string | string[]>;
}

export interface Config {
  entities: EntityConfig[];
}

export interface CryptoExchangeConfig {
  id: 'coinbase' | 'gemini' | 'kraken';
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
  enabled: boolean;
}

export interface CryptoWalletConfig {
  id: string;
  address: string;
  chain: 'btc' | 'eth';
  label: string;
}

/**
 * A manually-recorded crypto holding — for assets DocVault can't fetch on its
 * own. The canonical case is Monero: a privacy coin with no queryable public
 * block explorer, so there's no address-based balance lookup the way BTC
 * (Blockstream) or ETH (Etherscan) have. The user enters the amount by hand and
 * we price it like any other asset via CoinGecko. This is the asset-side mirror
 * of the manual `LiabilityEntry` mechanism (debts SimpleFIN can't see).
 */
export interface CryptoManualHolding {
  id: string;
  /** Ticker symbol, e.g. 'XMR'. Priced via COINGECKO_IDS in server/crypto.ts. */
  asset: string;
  /** Quantity held. Trusted as-entered — there is nothing to reconcile against. */
  amount: number;
  /** Display label for the source card, e.g. 'Monero — cold wallet'. */
  label?: string;
  note?: string;
}

/**
 * A single External Source: a git repository of markdown that DocVault clones
 * into DATA_DIR/.external-sources/<id>/ and exposes to the UI + Chat. Only the
 * clean HTTPS URL is stored here — the auth token lives once on
 * ExternalSourcesConfig.githubToken (encrypted), and is never written into the
 * cloned repo's .git/config. See server/external-sources.ts.
 */
export interface ExternalRepo {
  id: string;
  name: string;
  /** Clean HTTPS clone URL — never contains an embedded credential. */
  url: string;
  /** Branch to track; omit to follow the remote's default branch. */
  branch?: string;
  enabled: boolean;
  /** ISO timestamp of the last successful sync. */
  lastSyncedAt?: string;
  /** Token-redacted error from the most recent sync, or null when healthy. */
  lastError?: string | null;
  /** Markdown files found at last sync. */
  fileCount?: number;
  /** Short commit SHA at last sync. */
  commit?: string;
}

export interface ExternalSourcesConfig {
  repos: ExternalRepo[];
  /**
   * GitHub personal access token (fine-grained, read-only Contents scope) used
   * to clone private repos over HTTPS. Encrypted at rest via walkSensitiveFields.
   * Supplied to git per-invocation as an Authorization header — never persisted
   * into any cloned repo's .git/config.
   */
  githubToken?: string;
}

export const DEFAULT_MODEL = 'claude-sonnet-4-6';
export const DEFAULT_OPENAI_MODEL = 'gpt-4o';

/** Direct-API model providers (parsing, forms, deep research). Chat is agent-based. */
export type ModelProvider = 'anthropic' | 'openai';

/**
 * Reasoning/thinking effort, one union across providers. Anthropic accepts
 * low→max ('xhigh' on the agent surface; the direct API tops out differently
 * per SDK), OpenAI/Codex accept minimal→xhigh — the per-surface clamps below
 * map whatever the user picked onto what each call site actually supports.
 * Unset = the provider's default.
 */
export type ModelEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Anthropic direct API (messages.create output_config.effort): low|medium|high|max. */
export function toAnthropicApiEffort(
  e: ModelEffort | undefined
): 'low' | 'medium' | 'high' | 'max' | undefined {
  if (!e) return undefined;
  if (e === 'minimal') return 'low';
  if (e === 'xhigh') return 'high';
  return e;
}

/** Claude Agent SDK (chat + agent engines): low|medium|high|xhigh|max. */
export function toClaudeAgentEffort(
  e: ModelEffort | undefined
): 'low' | 'medium' | 'high' | 'xhigh' | 'max' | undefined {
  if (!e) return undefined;
  return e === 'minimal' ? 'low' : e;
}

/** OpenAI reasoning_effort / Codex turn effort: minimal|low|medium|high|xhigh. */
export function toOpenAIEffort(
  e: ModelEffort | undefined
): 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | undefined {
  if (!e) return undefined;
  return e === 'max' ? 'xhigh' : e;
}

export interface ModelRef {
  provider: ModelProvider;
  model: string;
  /** Optional reasoning effort for this scope; unset = provider default. */
  effort?: ModelEffort;
}

export interface Settings {
  anthropicKey?: string;
  /**
   * Optional Claude OAuth subscription token (Bearer). When present, the
   * Anthropic SDK is configured with `authToken` instead of `apiKey`, which
   * routes calls through the Claude.ai subscription instead of API billing.
   * Generate with `claude setup-token` or the OAuth flow.
   */
  anthropicAuthToken?: string;
  claudeModel?: string;
  /**
   * HTTP endpoint for an OpenAI-compatible /audio/transcriptions service —
   * e.g. whisper.cpp server, faster-whisper-server, parakeet-mlx server.
   * The /api/transcribe route forwards multipart audio uploads here.
   */
  transcribeUrl?: string;
  /** Model name passed to the transcription service (e.g. "parakeet-tdt-0.6b-v2", "whisper-large-v3"). */
  transcribeModel?: string;
  /**
   * Optional bearer token for the transcription service. Sent as
   * `Authorization: Bearer <key>` to the upstream /v1/audio/transcriptions
   * endpoint. Encrypted at rest. For Parakeet, matches `PARAKEET_API_KEY`.
   */
  transcribeApiKey?: string;
  /**
   * HTTP endpoint for an OpenAI-compatible /audio/speech text-to-speech
   * service — e.g. chatterbox-tts-api on a LAN GPU box. Used for voice-clone
   * test playback and Daily News narration.
   */
  ttsUrl?: string;
  /** Optional bearer token for the TTS service. Encrypted at rest. */
  ttsApiKey?: string;
  /**
   * Language code attached to cloned voices in the TTS server's library
   * (e.g. "en", "fr", "es"). Default "en".
   */
  ttsLanguage?: string;
  crypto?: {
    exchanges: CryptoExchangeConfig[];
    wallets: CryptoWalletConfig[];
    /** Hand-entered holdings for assets with no fetchable source (e.g. Monero). */
    manualHoldings?: CryptoManualHolding[];
    etherscanKey?: string;
  };
  brokers?: {
    accounts: BrokerAccount[];
  };
  snaptrade?: SnapTradeConfig;
  simplefin?: SimplefinConfig;
  geoapifyApiKey?: string;
  /** FRED (Federal Reserve Economic Data) API key — used by the Quant section
   *  for long-history SP500, treasury yields, macro series. Free at
   *  https://fred.stlouisfed.org/docs/api/api_key.html */
  fredApiKey?: string;
  /** Congress.gov API key — used by the Politics section to ingest recent bills
   *  (and signings/vetoes). Free at https://api.congress.gov/sign-up/ */
  congressApiKey?: string;
  schedules?: {
    snapshotIntervalMinutes?: number; // default 1440 (24h)
    dropboxSyncIntervalMinutes?: number; // default 15
    dropboxSyncEnabled?: boolean;
    snapshotEnabled?: boolean;
    quantRefreshIntervalMinutes?: number; // default 1440 (24h)
    quantRefreshEnabled?: boolean;
    politicsRefreshIntervalMinutes?: number; // default 1440 (24h)
    politicsRefreshEnabled?: boolean;
    /**
     * Daily News — a synthesized morning newspaper. The task ticks hourly but
     * generates at most one edition per day (in `timezone`), only once that
     * zone's clock passes `dailyNewsHour`. On `dailyNewsWeeklyDay` it produces
     * a weekly deep-dive.
     */
    dailyNewsEnabled?: boolean;
    dailyNewsHour?: number; // 0-23, interpreted in `timezone` below, default 7
    dailyNewsWeeklyDay?: number; // 0-6 (0=Sunday), weekly deep-dive day, default 0
    /**
     * IANA timezone (e.g. 'America/Chicago') the Daily News publish-hour,
     * weekly-day, and edition date are evaluated in. Without it the scheduler
     * reads the container's clock — UTC in Docker — so "publish at 9" fires at
     * 09:00 UTC. Default 'UTC'. Set via Settings → Schedules.
     */
    timezone?: string;
    backupPassword?: string; // if set, encrypted config backup is pushed to Dropbox on sync
  };
  /**
   * Shared secret used by iOS Shortcuts (or any other client) to POST daily
   * Health data to `/api/health/:personId/ingest`. Generated on first use
   * via `getOrCreateHealthIngestToken`. Rotate by clearing this field and
   * calling the getter again.
   */
  healthIngestToken?: string;
  /**
   * External Sources — git repositories of markdown cloned into
   * DATA_DIR/.external-sources/ and surfaced in the UI + Chat. See
   * server/external-sources.ts.
   */
  externalSources?: ExternalSourcesConfig;
  /**
   * OpenAI (or any OpenAI-compatible endpoint, including a self-hosted local
   * model) credentials for the DIRECT-API call sites (parsing, forms, deep
   * research). `baseUrl` points the SDK at a non-OpenAI endpoint, e.g.
   * `http://nas:11434/v1` for Ollama. Chat is agent-based, configured elsewhere.
   */
  openai?: { apiKey?: string; baseUrl?: string };
  /**
   * Which provider + model each direct-API scope uses. An omitted scope falls
   * back to Anthropic with `claudeModel`. Chat is NOT here — it's an agent backend.
   */
  modelRouting?: {
    parsing?: ModelRef;
  };
  /**
   * Chat agent backend. 'claude' (default) drives Claude Code via the agent SDK
   * with curated in-process MCP tools. 'codex' drives `codex app-server` on the
   * OpenAI/ChatGPT subscription with NATIVE tools over a secrets-excluded view
   * of the data dir (no MCP — matches t3code). See server/llm/codex-chat.ts.
   */
  chat?: {
    backend?: 'claude' | 'codex';
    /** Reasoning effort for the Claude chat backend; unset = model default. */
    claudeEffort?: ModelEffort;
    /** Codex model, e.g. 'gpt-5.5'. */
    codexModel?: string;
    /** Reasoning effort for the Codex chat backend; unset = plan default. */
    codexEffort?: ModelEffort;
    /** CODEX_HOME on the host — dir holding auth.json from `codex login`. */
    codexHome?: string;
    /** Codex binary path; default 'codex' (resolved on PATH). */
    codexBinary?: string;
  };
  /**
   * Deep Research engine: 'api' (direct web_search call, provider-flexible) or
   * 'agent' (Claude Code + WebSearch on the subscription). `model` is the
   * API-mode model.
   */
  deepResearch?: { mode?: 'agent' | 'api'; agentBackend?: 'claude' | 'codex'; model?: ModelRef };
  /**
   * Daily News engine — same three-way shape as deepResearch. 'api' (direct
   * messages.create, any provider) or 'agent' (Claude Code / Codex on the
   * subscription). Unlike Deep Research it uses NO web_search — it synthesizes
   * the owner's own data — so an OpenAI API-mode pick works directly.
   * `title` is the masthead name (generic default in getDailyNewsTitle).
   */
  dailyNews?: {
    mode?: 'agent' | 'api';
    agentBackend?: 'claude' | 'codex';
    model?: ModelRef;
    title?: string;
    /** Selected house-style theme id (see server/daily-news-themes.ts). */
    theme?: string;
    /** Generate an AI headline image per edition (OpenAI; opt-in, costs per image). */
    headlineImage?: boolean;
    /** OpenAI image model id (from /v1/models); defaults to gpt-image-1. */
    imageModel?: string;
    /**
     * Edition narration: which person's cloned voice reads the paper
     * (clips live in Health → person → Voice), and the default playback
     * speed for the in-app player / emailed audio. personId unset = off.
     * exaggeration (0.25–2) and cfgWeight (0–1) tune the clone's delivery;
     * unset = the TTS server's own defaults.
     */
    narration?: {
      personId?: string;
      defaultSpeed?: number;
      exaggeration?: number;
      cfgWeight?: number;
    };
  };
  /**
   * Outbound email via Resend — delivers the Daily News edition + test pings.
   * `resendApiKey` is encrypted at rest (walkSensitiveFields) and falls back to
   * the RESEND_API_KEY env var. The `fromEmail` domain must be verified in the
   * Resend dashboard (or use onboarding@resend.dev for testing).
   */
  email?: {
    provider?: 'resend';
    resendApiKey?: string;
    fromEmail?: string;
    fromName?: string;
    toEmail?: string;
    enabled?: boolean;
  };
  /**
   * Weather location for the Daily News forecast (Open-Meteo — no API key).
   * Disabled/empty by default so a fork shows no weather until a location is set.
   */
  weather?: {
    enabled?: boolean;
    latitude?: number;
    longitude?: number;
    /** Human label for the forecast box, e.g. "Spring Hill, TN". */
    label?: string;
    units?: 'F' | 'C';
    /**
     * IANA timezone for this location (e.g. 'America/Chicago'), auto-derived
     * from the geocoded city (Open-Meteo returns it). This is the app-wide
     * source of truth for "what zone are we in" — scheduling, health
     * day-bucketing, and report dates all resolve through
     * getConfiguredTimezone() (see tz.ts), which reads this first.
     */
    timezone?: string;
  };
}

export interface FileInfo {
  name: string;
  path: string;
  size: number;
  lastModified: number;
  type: string;
  isDirectory: boolean;
}

export interface ParsedData {
  [key: string]: string | number | boolean | null;
}

// ============================================================================
// Config Management
// ============================================================================

export async function loadConfig(): Promise<Config> {
  let config: Config;
  try {
    const content = await fs.readFile(CONFIG_PATH, 'utf-8');
    config = JSON.parse(content);
  } catch {
    // Default config
    config = {
      entities: [{ id: 'personal', name: 'Personal', color: 'blue', path: 'personal' }],
    };
  }

  return config;
}

export async function saveConfig(config: Config): Promise<void> {
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// ============================================================================
// Settings Management
// ============================================================================

export async function loadSettings(): Promise<Settings> {
  try {
    const content = await fs.readFile(SETTINGS_PATH, 'utf-8');
    const raw = JSON.parse(content) as Settings;
    return walkSensitiveFields(raw, decryptField);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    logAuth.error(`Failed to load settings: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  const toPersist = walkSensitiveFields(settings, encryptField);
  await ensureDir(path.dirname(SETTINGS_PATH));
  const tmp = `${SETTINGS_PATH}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, `${JSON.stringify(toPersist, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tmp, SETTINGS_PATH);
}

// One-shot migration: read the settings file, re-save it. Because saveSettings
// now encrypts sensitive fields and encryptField is idempotent (values already
// tagged "enc:v1:" pass through), running this after an upgrade converts any
// legacy plaintext values in place. Safe to call on every boot.
export async function migrateSettingsEncryption(): Promise<{
  encrypted: number;
  skipped: number;
}> {
  const logMig = createLogger('CryptoMigration');
  let rawContent: string;
  try {
    rawContent = await fs.readFile(SETTINGS_PATH, 'utf-8');
  } catch {
    return { encrypted: 0, skipped: 0 };
  }
  const raw = JSON.parse(rawContent) as Settings;

  // Count plaintext sensitive fields before migration
  let plaintextCount = 0;
  let encryptedCount = 0;
  walkSensitiveFields(raw, (v) => {
    if (typeof v === 'string' && v.length > 0) {
      if (v.startsWith('enc:v1:')) encryptedCount++;
      else plaintextCount++;
    }
    return v;
  });

  if (plaintextCount === 0) {
    return { encrypted: 0, skipped: encryptedCount };
  }

  const encrypted = walkSensitiveFields(raw, encryptField);
  await fs.writeFile(SETTINGS_PATH, JSON.stringify(encrypted, null, 2));
  logMig.info(
    `Migrated ${plaintextCount} sensitive field(s) to encrypted form (${encryptedCount} were already encrypted)`
  );
  return { encrypted: plaintextCount, skipped: encryptedCount };
}

/** The Claude model for Claude chat (settings.claudeModel, else DEFAULT_MODEL). */
export async function getClaudeModel(): Promise<string> {
  const settings = await loadSettings();
  return settings.claudeModel || DEFAULT_MODEL;
}

/** Resolve a direct-API {provider, model}; unset falls back to Anthropic + DEFAULT_MODEL. */
function resolveModel(ref: ModelRef | undefined): ModelRef {
  if (ref?.provider && ref.model) {
    return {
      provider: ref.provider,
      model: ref.model,
      ...(ref.effort ? { effort: ref.effort } : {}),
    };
  }
  return { provider: 'anthropic', model: DEFAULT_MODEL };
}

/** Reasoning effort for the Claude chat backend (Settings → Models). */
export async function getClaudeChatEffort(): Promise<ModelEffort | undefined> {
  const settings = await loadSettings();
  return settings.chat?.claudeEffort;
}

/** Provider + model for the parsing scope (all parsers + form decode/autofill). */
export async function getParsingModel(): Promise<ModelRef> {
  const settings = await loadSettings();
  return resolveModel(settings.modelRouting?.parsing);
}

export type DeepResearchMode = 'agent' | 'api';

/**
 * Deep Research config: 'api' = direct messages.create + native web_search
 * (provider-flexible); 'agent' = Claude Code + WebSearch on the subscription
 * (agentic loop). `model` is used by API mode.
 */
export async function getDeepResearchConfig(): Promise<{
  mode: DeepResearchMode;
  agentBackend: 'claude' | 'codex';
  model: ModelRef;
}> {
  const settings = await loadSettings();
  const mode: DeepResearchMode = settings.deepResearch?.mode === 'agent' ? 'agent' : 'api';
  const agentBackend = settings.deepResearch?.agentBackend === 'codex' ? 'codex' : 'claude';
  return { mode, agentBackend, model: resolveModel(settings.deepResearch?.model) };
}

/**
 * Daily News config — mirrors getDeepResearchConfig. 'api' uses `model` (any
 * provider; no web_search dependency, so OpenAI works directly); 'agent' runs
 * Claude Code or Codex on the subscription. Defaults to 'api' (the most robust
 * for unattended cron — a stored API key doesn't expire like an OAuth session).
 */
export async function getDailyNewsConfig(): Promise<{
  mode: DeepResearchMode;
  agentBackend: 'claude' | 'codex';
  model: ModelRef;
  theme: string;
  headlineImage: boolean;
  imageModel: string;
}> {
  const settings = await loadSettings();
  const mode: DeepResearchMode = settings.dailyNews?.mode === 'agent' ? 'agent' : 'api';
  const agentBackend = settings.dailyNews?.agentBackend === 'codex' ? 'codex' : 'claude';
  return {
    mode,
    agentBackend,
    model: resolveModel(settings.dailyNews?.model),
    theme: settings.dailyNews?.theme || 'brew', // default house style: Morning Brew
    headlineImage: settings.dailyNews?.headlineImage ?? false,
    imageModel: settings.dailyNews?.imageModel || 'gpt-image-2',
  };
}

/** Masthead title for the Daily News edition. Generic default — repo is public. */
export async function getDailyNewsTitle(): Promise<string> {
  const settings = await loadSettings();
  return settings.dailyNews?.title?.trim() || 'The DocVault Dispatch';
}

export interface EmailConfig {
  provider: 'resend';
  apiKey?: string;
  fromEmail?: string;
  fromName?: string;
  toEmail?: string;
  enabled: boolean;
}

/** Outbound email (Resend) config. apiKey: settings value overrides RESEND_API_KEY env. */
export async function getEmailConfig(): Promise<EmailConfig> {
  const settings = await loadSettings();
  return {
    provider: 'resend',
    apiKey: settings.email?.resendApiKey || process.env.RESEND_API_KEY,
    fromEmail: settings.email?.fromEmail,
    fromName: settings.email?.fromName,
    toEmail: settings.email?.toEmail,
    enabled: settings.email?.enabled ?? false,
  };
}

export interface WeatherConfig {
  enabled: boolean;
  latitude?: number;
  longitude?: number;
  label: string;
  units: 'F' | 'C';
}

/** Daily News weather location (Open-Meteo). Enabled only with a lat/lon set. */
export async function getWeatherConfig(): Promise<WeatherConfig> {
  const w = (await loadSettings()).weather;
  return {
    enabled:
      w?.enabled === true && typeof w.latitude === 'number' && typeof w.longitude === 'number',
    latitude: w?.latitude,
    longitude: w?.longitude,
    label: w?.label || 'Local',
    units: w?.units === 'C' ? 'C' : 'F',
  };
}

export type ChatBackend = 'claude' | 'codex';

/** Which agent backend powers chat: 'claude' (default) or 'codex' (OpenAI sub). */
export async function getChatBackend(): Promise<ChatBackend> {
  const settings = await loadSettings();
  return settings.chat?.backend === 'codex' ? 'codex' : 'claude';
}

/**
 * Codex chat config. An unset model lets codex pick its account/plan default
 * rather than us guessing a slug. Settings override environment.
 */
export async function getCodexChatConfig(): Promise<{
  model?: string;
  effort?: ModelEffort;
  codexHome?: string;
  binaryPath?: string;
}> {
  const settings = await loadSettings();
  return {
    model: settings.chat?.codexModel || undefined,
    effort: settings.chat?.codexEffort,
    codexHome: settings.chat?.codexHome || process.env.CODEX_HOME || undefined,
    binaryPath: settings.chat?.codexBinary || process.env.CODEX_BINARY || undefined,
  };
}

/** Whether codex has a usable auth.json (from `codex login`) in CODEX_HOME. */
export async function getCodexAuthStatus(): Promise<{ signedIn: boolean }> {
  const { codexHome } = await getCodexChatConfig();
  const home = codexHome || (process.env.HOME ? path.join(process.env.HOME, '.codex') : '');
  if (!home) return { signedIn: false };
  try {
    const raw = await fs.readFile(path.join(home, 'auth.json'), 'utf-8');
    const auth = JSON.parse(raw) as { tokens?: { access_token?: string } };
    return { signedIn: !!auth.tokens?.access_token };
  } catch {
    return { signedIn: false };
  }
}

/** OpenAI (or OpenAI-compatible) credentials. Settings override environment. */
export async function getOpenAIConfig(): Promise<{ apiKey?: string; baseUrl?: string }> {
  const settings = await loadSettings();
  return {
    apiKey: settings.openai?.apiKey || process.env.OPENAI_API_KEY,
    baseUrl: settings.openai?.baseUrl || undefined,
  };
}

// Get the Anthropic API key (settings override environment)
export async function getAnthropicKey(): Promise<string | undefined> {
  // Settings file takes priority (allows override)
  const settings = await loadSettings();
  if (settings.anthropicKey) {
    return settings.anthropicKey;
  }
  // Fall back to environment variable
  return process.env.ANTHROPIC_API_KEY;
}

/**
 * Get the Claude OAuth subscription bearer token, if configured.
 * Settings override environment. When present, this should be preferred over
 * the API key — the Anthropic SDK accepts it via `authToken`, which routes
 * calls through a Claude.ai subscription instead of API billing.
 */
export async function getAnthropicAuthToken(): Promise<string | undefined> {
  const settings = await loadSettings();
  if (settings.anthropicAuthToken) {
    return settings.anthropicAuthToken;
  }
  return process.env.ANTHROPIC_AUTH_TOKEN;
}

export interface TranscribeConfig {
  url?: string;
  model?: string;
  apiKey?: string;
}

/**
 * Get transcription service config. Falls back to env vars
 * (DOCVAULT_TRANSCRIBE_URL, DOCVAULT_TRANSCRIBE_MODEL, DOCVAULT_TRANSCRIBE_API_KEY)
 * if not in settings.
 */
export async function getTranscribeConfig(): Promise<TranscribeConfig> {
  const settings = await loadSettings();
  return {
    url: settings.transcribeUrl || process.env.DOCVAULT_TRANSCRIBE_URL,
    model: settings.transcribeModel || process.env.DOCVAULT_TRANSCRIBE_MODEL,
    apiKey: settings.transcribeApiKey || process.env.DOCVAULT_TRANSCRIBE_API_KEY,
  };
}

/**
 * Get text-to-speech service config. Falls back to env vars
 * (DOCVAULT_TTS_URL, DOCVAULT_TTS_API_KEY) if not in settings.
 */
export async function getTtsConfig(): Promise<{
  url?: string;
  apiKey?: string;
  language: string;
}> {
  const settings = await loadSettings();
  return {
    url: settings.ttsUrl || process.env.DOCVAULT_TTS_URL,
    apiKey: settings.ttsApiKey || process.env.DOCVAULT_TTS_API_KEY,
    language: settings.ttsLanguage?.trim() || process.env.DOCVAULT_TTS_LANGUAGE || 'en',
  };
}

/**
 * Get the Health ingest token, generating a fresh 32-char random token on
 * first call and persisting it to .docvault-settings.json. Used to auth
 * Shortcut → DocVault POSTs on `/api/health/:personId/ingest`.
 */
export async function getOrCreateHealthIngestToken(): Promise<string> {
  const settings = await loadSettings();
  if (settings.healthIngestToken && settings.healthIngestToken.length >= 16) {
    return settings.healthIngestToken;
  }
  // Generate: 32 url-safe chars. Use crypto.getRandomValues for quality.
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const token = Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  settings.healthIngestToken = token;
  await saveSettings(settings);
  return token;
}

// ============================================================================
// Helpers
// ============================================================================

export function getMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    csv: 'text/csv',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel',
    txf: 'text/plain',
    html: 'text/html',
    js: 'application/javascript',
    mjs: 'application/javascript',
    css: 'text/css',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    eot: 'application/vnd.ms-fontobject',
    map: 'application/json',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ods: 'application/vnd.oasis.opendocument.spreadsheet',
    numbers: 'application/x-iwork-numbers-sffnumbers',
    pages: 'application/x-iwork-pages-sffpages',
    txt: 'text/plain',
    json: 'application/json',
  };
  return mimeTypes[ext || ''] || 'application/octet-stream';
}

export async function scanDirectory(dirPath: string, basePath: string = ''): Promise<FileInfo[]> {
  const files: FileInfo[] = [];

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      // Skip hidden files
      if (entry.name.startsWith('.')) continue;
      if (entry.isSymbolicLink()) {
        logFiles.warn(`[scan] skipping symlink under ${basePath || '.'}: ${entry.name}`);
        continue;
      }

      const fullPath = path.join(dirPath, entry.name);
      const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        // Recursively scan subdirectories
        const subFiles = await scanDirectory(fullPath, relativePath);
        files.push(...subFiles);
      } else {
        const stats = await fs.stat(fullPath);
        files.push({
          name: entry.name,
          path: relativePath,
          size: stats.size,
          lastModified: stats.mtimeMs,
          type: getMimeType(entry.name),
          isDirectory: false,
        });
      }
    }
  } catch (err) {
    logFiles.error(`Error scanning ${dirPath}: ${err}`);
  }

  return files;
}

export function resolveUnder(baseDir: string, relPath: string): string | null {
  const base = path.resolve(baseDir);
  const target = path.resolve(baseDir, relPath);
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) return null;
  return target;
}

export async function realpathUnder(baseDir: string, targetPath: string): Promise<string | null> {
  const [baseReal, targetReal] = await Promise.all([fs.realpath(baseDir), fs.realpath(targetPath)]);
  if (targetReal !== baseReal && !targetReal.startsWith(`${baseReal}${path.sep}`)) return null;
  return targetReal;
}

export async function ensureDir(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch {
    // Directory might already exist
  }
}

export function jsonResponse(data: object, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

export function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

// Get entity path, resolving symlinks
export async function getEntityPath(entityId: string): Promise<string | null> {
  const config = await loadConfig();
  const entity = config.entities.find((e) => e.id === entityId);
  if (!entity) return null;

  const entityPath = resolveUnder(DATA_DIR, entity.path);
  if (!entityPath) {
    logFiles.warn(`[entity] refusing path outside data dir for entity ${entityId}`);
    return null;
  }

  // Check if path exists
  try {
    await fs.access(entityPath);
  } catch {
    // Try to create it
    await ensureDir(entityPath);
  }

  try {
    const contained = await realpathUnder(DATA_DIR, entityPath);
    if (!contained) {
      logFiles.warn(`[entity] refusing symlink escape for entity ${entityId}`);
      return null;
    }
  } catch (err) {
    logFiles.warn(
      `[entity] failed realpath containment check for ${entityId}: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
  return entityPath;
}

// ============================================================================
// Parsed Data Storage
// ============================================================================

export const PARSED_DATA_FILE = path.join(DATA_DIR, '.docvault-parsed.json');
export const LEGACY_PARSED_DATA_FILE = path.join(DATA_DIR, '.taxvault-parsed.json');
export const REMINDERS_FILE = path.join(DATA_DIR, '.docvault-reminders.json');

// Migrate legacy parsed data file on first load
export let parsedDataMigrated = false;
export async function migrateParsedData(): Promise<void> {
  if (parsedDataMigrated) return;
  parsedDataMigrated = true;
  try {
    await fs.access(PARSED_DATA_FILE);
    // New file exists, no migration needed
  } catch {
    try {
      await fs.access(LEGACY_PARSED_DATA_FILE);
      await fs.rename(LEGACY_PARSED_DATA_FILE, PARSED_DATA_FILE);
      logMigration.info('Renamed .taxvault-parsed.json -> .docvault-parsed.json');
    } catch {
      // Neither file exists, that's fine
    }
  }
}

export async function loadParsedData(): Promise<Record<string, ParsedData>> {
  await migrateParsedData();
  try {
    const content = await fs.readFile(PARSED_DATA_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

export async function saveParsedData(data: Record<string, ParsedData>): Promise<void> {
  await fs.writeFile(PARSED_DATA_FILE, JSON.stringify(data, null, 2));
}

// ============================================================================
// Document Metadata Storage (tags, notes)
// ============================================================================

export const METADATA_FILE = path.join(DATA_DIR, '.docvault-metadata.json');

export interface DocMetadata {
  tags?: string[];
  notes?: string;
  tracked?: boolean;
}

export async function loadMetadata(): Promise<Record<string, DocMetadata>> {
  try {
    const content = await fs.readFile(METADATA_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

export async function saveMetadata(data: Record<string, DocMetadata>): Promise<void> {
  await fs.writeFile(METADATA_FILE, JSON.stringify(data, null, 2));
}

// ============================================================================
// Reminders Storage
// ============================================================================

export interface Reminder {
  id: string;
  entityId: string;
  title: string;
  dueDate: string; // ISO date (YYYY-MM-DD)
  recurrence?: 'yearly' | 'monthly' | 'quarterly' | null;
  status: 'pending' | 'completed' | 'dismissed';
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export async function loadReminders(): Promise<Reminder[]> {
  try {
    const content = await fs.readFile(REMINDERS_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return [];
  }
}

export async function saveReminders(reminders: Reminder[]): Promise<void> {
  await fs.writeFile(REMINDERS_FILE, JSON.stringify(reminders, null, 2));
}

// ============================================================================
// Business Assets Storage
// ============================================================================

export const ASSETS_FILE = path.join(DATA_DIR, '.docvault-assets.json');

export interface BusinessAsset {
  id: string;
  name: string;
  value: number;
}

export type AssetsData = Record<string, BusinessAsset[]>; // keyed by entity

export async function loadAssets(): Promise<AssetsData> {
  try {
    const content = await fs.readFile(ASSETS_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

export async function saveAssets(assets: AssetsData): Promise<void> {
  await fs.writeFile(ASSETS_FILE, JSON.stringify(assets, null, 2));
}

// ============================================================================
// 401k Contributions Storage
// ============================================================================

export const CONTRIBUTIONS_FILE = path.join(DATA_DIR, '.docvault-contributions.json');

export interface Contribution401k {
  id: string;
  date: string;
  amount: number;
  type: 'employee' | 'employer';
}

// Keyed by "entity/year" e.g. "my-llc/2025"
export type ContributionsData = Record<string, Contribution401k[]>;

export async function loadContributions(): Promise<ContributionsData> {
  try {
    const content = await fs.readFile(CONTRIBUTIONS_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

export async function saveContributions(data: ContributionsData): Promise<void> {
  await fs.writeFile(CONTRIBUTIONS_FILE, JSON.stringify(data, null, 2));
}

// ============================================================================
// Estimated Tax Payments Storage
// ============================================================================

export const ESTIMATED_TAX_FILE = path.join(DATA_DIR, '.docvault-estimated-taxes.json');

export interface EstimatedTaxPayment {
  id: string;
  date: string; // YYYY-MM-DD (date payment was made)
  quarter: 1 | 2 | 3 | 4;
  amount: number;
}

export interface EstimatedTaxConfig {
  annualTarget: number; // total estimated tax for the year (e.g., safe harbor amount)
}

// Keyed by "entity/year" e.g. "consulting-llc/2026"
export type EstimatedTaxData = Record<
  string,
  {
    payments: EstimatedTaxPayment[];
    config: EstimatedTaxConfig;
  }
>;

export async function loadEstimatedTaxes(): Promise<EstimatedTaxData> {
  try {
    const content = await fs.readFile(ESTIMATED_TAX_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

export async function saveEstimatedTaxes(data: EstimatedTaxData): Promise<void> {
  await fs.writeFile(ESTIMATED_TAX_FILE, JSON.stringify(data, null, 2));
}

// ============================================================================
// Federal Tax Storage (filed 1040 data by year)
// ============================================================================

export const FEDERAL_TAX_FILE = path.join(DATA_DIR, '.docvault-federal.json');

export interface FederalTaxIncome {
  wages: number;
  interestIncome: number;
  dividendIncome: number;
  businessIncome: number;
  rentalK1Income: number;
  capitalGains: number;
  taxableIRA: number;
  taxablePension: number;
  taxableSS: number;
  unemployment: number;
  otherIncome: number;
  totalIncome: number;
}

export interface FederalTaxAdjustments {
  iraDeduction: number;
  educatorExpenses: number;
  hsaDeduction: number;
  studentLoanInterest: number;
  seTaxDeduction: number;
  sepDeduction: number;
  otherAdjustments: number;
  totalAdjustments: number;
}

export interface FederalTaxDeductions {
  standardOrItemized: number;
  qbiDeduction: number;
  totalDeductions: number;
}

export interface FederalTaxTax {
  incomeTax: number;
  amt: number;
  seTax: number;
  additionalTaxQualifiedPlans: number;
  niit: number;
  totalTax: number;
}

export interface FederalTaxCredits {
  foreignTaxCredit: number;
  childCareCredit: number;
  elderlyCredit: number;
  educationCredit: number;
  retirementSavingsCredit: number;
  childTaxCredit: number;
  totalCredits: number;
}

export interface FederalTaxPayments {
  incomeTaxWithheld: number;
  eic: number;
  additionalChildTaxCredit: number;
  excessSocialSecurity: number;
  estimatedPayments: number;
  totalPayments: number;
}

export interface FederalTaxBalance {
  amountOwed: number;
  underpaymentPenalty: number;
  totalOwed: number;
}

export interface FederalTaxFiled {
  filed: boolean;
  filedDate?: string;
  income: FederalTaxIncome;
  adjustments: FederalTaxAdjustments;
  agi: number;
  deductions: FederalTaxDeductions;
  taxableIncome: number;
  tax: FederalTaxTax;
  credits: FederalTaxCredits;
  payments: FederalTaxPayments;
  balance: FederalTaxBalance;
}

// Keyed by year string e.g. "2025"
export type FederalTaxData = Record<string, FederalTaxFiled>;

export async function loadFederalTax(): Promise<FederalTaxData> {
  try {
    const content = await fs.readFile(FEDERAL_TAX_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

export async function saveFederalTax(data: FederalTaxData): Promise<void> {
  await fs.writeFile(FEDERAL_TAX_FILE, JSON.stringify(data, null, 2));
}

// ============================================================================
// Todos Storage
// ============================================================================

export const TODOS_FILE = path.join(DATA_DIR, '.docvault-todos.json');
export const SALES_FILE = path.join(DATA_DIR, '.docvault-sales.json');
export const MILEAGE_FILE = path.join(DATA_DIR, '.docvault-mileage.json');
export const GOLD_FILE = path.join(DATA_DIR, '.docvault-gold.json');
export const PROPERTY_FILE = path.join(DATA_DIR, '.docvault-property.json');
export const CRYPTO_CACHE_FILE = path.join(DATA_DIR, '.docvault-crypto-cache.json');
export const QUANT_SNAPSHOTS_FILE = path.join(DATA_DIR, '.docvault-quant-snapshots.json');
export const POLITICS_CACHE_FILE = path.join(DATA_DIR, '.docvault-politics.json');
export const STRATEGY_HISTORY_FILE = path.join(DATA_DIR, '.docvault-strategy-history.json');
export const HEALTH_ANALYSIS_HISTORY_FILE = path.join(
  DATA_DIR,
  '.docvault-health-analysis-history.json'
);
export const BROKER_CACHE_FILE = path.join(DATA_DIR, '.docvault-broker-cache.json');
export const BROKER_ACTIVITIES_FILE = path.join(DATA_DIR, '.docvault-broker-activities.json');
export const SIMPLEFIN_CACHE_FILE = path.join(DATA_DIR, '.docvault-simplefin-cache.json');
export const INCOME_FILE = path.join(DATA_DIR, '.docvault-income.json');
export const LIABILITIES_FILE = path.join(DATA_DIR, '.docvault-liabilities.json');
export const ACCOUNT_ANNOTATIONS_FILE = path.join(DATA_DIR, '.docvault-account-annotations.json');

export interface PortfolioSnapshot {
  date: string;
  totalValue: number;
  cryptoValue: number;
  brokerValue: number;
  bankValue?: number;
  goldValue?: number;
  propertyValue?: number;
  shortTermGains: number;
  longTermGains: number;
}

export function snapshotFileForYear(year: number): string {
  return path.join(DATA_DIR, `.docvault-portfolio-snapshots-${year}.json`);
}

export async function loadSnapshotsForYear(year: number): Promise<PortfolioSnapshot[]> {
  try {
    const data = await fs.readFile(snapshotFileForYear(year), 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export async function loadSnapshots(years?: number[]): Promise<PortfolioSnapshot[]> {
  // If specific years requested, load those; otherwise load current + previous year
  const targetYears = years || [new Date().getFullYear(), new Date().getFullYear() - 1];

  // Also check for legacy single-file format and migrate
  const legacyFile = path.join(DATA_DIR, '.docvault-portfolio-snapshots.json');
  try {
    const legacyData = await fs.readFile(legacyFile, 'utf-8');
    const legacySnapshots: PortfolioSnapshot[] = JSON.parse(legacyData);
    if (legacySnapshots.length > 0) {
      // Migrate: group by year and write to year-based files
      const byYear = new Map<number, PortfolioSnapshot[]>();
      for (const snap of legacySnapshots) {
        const y = parseInt(snap.date.split('-')[0]);
        if (!byYear.has(y)) byYear.set(y, []);
        byYear.get(y)!.push(snap);
      }
      for (const [y, snaps] of byYear) {
        await fs.writeFile(snapshotFileForYear(y), JSON.stringify(snaps, null, 2));
      }
      // Remove legacy file after successful migration
      await fs.unlink(legacyFile);
      logSnapshots.info(`Migrated ${legacySnapshots.length} snapshots from legacy file`);
    }
  } catch {
    // No legacy file — normal case
  }

  const all: PortfolioSnapshot[] = [];
  for (const year of targetYears) {
    const yearSnapshots = await loadSnapshotsForYear(year);
    all.push(...yearSnapshots);
  }
  return all.sort((a, b) => a.date.localeCompare(b.date));
}

export async function saveSnapshot(snapshot: PortfolioSnapshot): Promise<void> {
  const year = parseInt(snapshot.date.split('-')[0]);
  const snapshots = await loadSnapshotsForYear(year);
  // Replace today's snapshot if it exists, otherwise append
  const idx = snapshots.findIndex((s) => s.date === snapshot.date);
  if (idx >= 0) {
    snapshots[idx] = snapshot;
  } else {
    snapshots.push(snapshot);
  }
  await fs.writeFile(snapshotFileForYear(year), JSON.stringify(snapshots, null, 2));
}

export interface Todo {
  id: string;
  title: string;
  status: 'pending' | 'completed';
  createdAt: string;
  updatedAt: string;
}

export async function loadTodos(): Promise<Todo[]> {
  try {
    const content = await fs.readFile(TODOS_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return [];
  }
}

export async function saveTodos(todos: Todo[]): Promise<void> {
  await fs.writeFile(TODOS_FILE, JSON.stringify(todos, null, 2));
}

// ============================================================================
// Sales Storage
// ============================================================================

export interface SaleProduct {
  id: string;
  name: string;
  price: number;
}

export interface Sale {
  id: string;
  person: string;
  productId: string;
  quantity: number;
  total: number;
  date: string;
  entity?: string;
  createdAt: string;
}

export interface SalesData {
  products: SaleProduct[];
  sales: Sale[];
}

export async function loadSalesData(): Promise<SalesData> {
  try {
    const content = await fs.readFile(SALES_FILE, 'utf-8');
    const data = JSON.parse(content);
    return {
      products: data.products || [],
      sales: data.sales || [],
    };
  } catch {
    return { products: [], sales: [] };
  }
}

export async function saveSalesData(data: SalesData): Promise<void> {
  await fs.writeFile(SALES_FILE, JSON.stringify(data, null, 2));
}

// ============================================================================
// Mileage Storage
// ============================================================================

export interface Vehicle {
  id: string;
  name: string;
  year?: number;
  make?: string;
  model?: string;
}

export interface MileageEntry {
  id: string;
  date: string;
  vehicleId: string;
  odometerStart?: number;
  odometerEnd?: number;
  tripMiles?: number;
  gallons?: number;
  totalCost?: number;
  purpose?: string;
  entity?: string;
  createdAt: string;
}

export interface SavedAddress {
  id: string;
  label: string; // e.g., "Home", "Office"
  formatted: string;
  lat: number;
  lon: number;
}

export interface MileageData {
  vehicles: Vehicle[];
  entries: MileageEntry[];
  irsRate: number;
  savedAddresses?: SavedAddress[];
}

export async function loadMileageData(): Promise<MileageData> {
  try {
    const content = await fs.readFile(MILEAGE_FILE, 'utf-8');
    const data = JSON.parse(content);
    return {
      vehicles: data.vehicles || [],
      entries: data.entries || [],
      irsRate: data.irsRate ?? 0.7,
      savedAddresses: data.savedAddresses || [],
    };
  } catch {
    return { vehicles: [], entries: [], irsRate: 0.7, savedAddresses: [] };
  }
}

export async function saveMileageData(data: MileageData): Promise<void> {
  await fs.writeFile(MILEAGE_FILE, JSON.stringify(data, null, 2));
}

// ============================================================================
// Gold / Precious Metals Storage
// ============================================================================

export interface GoldEntry {
  id: string;
  metal: 'gold' | 'silver' | 'platinum' | 'palladium';
  productId: string;
  customDescription?: string;
  coinYear?: number;
  size: string;
  weightOz: number;
  purity: number;
  purchasePrice: number;
  purchaseDate: string;
  dealer?: string;
  quantity: number;
  notes?: string;
  receiptPath?: string;
  createdAt: string;
}

export const GOLD_RECEIPTS_DIR = path.join(DATA_DIR, 'gold-receipts');

export interface GoldData {
  entries: GoldEntry[];
}

export async function loadGoldData(): Promise<GoldData> {
  try {
    const content = await fs.readFile(GOLD_FILE, 'utf-8');
    const data = JSON.parse(content);
    return { entries: data.entries || [] };
  } catch {
    return { entries: [] };
  }
}

export async function saveGoldData(data: GoldData): Promise<void> {
  await fs.writeFile(GOLD_FILE, JSON.stringify(data, null, 2));
}

// Spot price cache (Yahoo Finance futures: GC=F, SI=F, PL=F, PA=F)
export let metalPriceCache: Record<string, number> = {};
export let metalPriceCacheTime = 0;
export const METAL_PRICE_CACHE_TTL = 300_000; // 5 minutes

export const METAL_FUTURES: Record<string, string> = {
  gold: 'GC=F',
  silver: 'SI=F',
  platinum: 'PL=F',
  palladium: 'PA=F',
};

export async function fetchMetalSpotPrices(): Promise<Record<string, number>> {
  const now = Date.now();
  if (
    Object.keys(metalPriceCache).length > 0 &&
    now - metalPriceCacheTime < METAL_PRICE_CACHE_TTL
  ) {
    return metalPriceCache;
  }

  const symbols = Object.values(METAL_FUTURES).join(',');
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${symbols}&range=1d&interval=1d`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error(`Yahoo Finance returned ${res.status}`);

    const data = (await res.json()) as {
      spark?: {
        result?: { symbol: string; response?: { meta?: { regularMarketPrice?: number } }[] }[];
      };
    } & Record<string, { close?: number[] } | undefined>;
    const prices: Record<string, number> = {};

    for (const [metal, ticker] of Object.entries(METAL_FUTURES)) {
      const flat = data[ticker];
      if (flat?.close?.length) {
        prices[metal] = flat.close[flat.close.length - 1];
        continue;
      }
      const spark = data.spark?.result?.find((r: { symbol: string }) => r.symbol === ticker);
      const close = spark?.response?.[0]?.meta?.regularMarketPrice;
      if (close) prices[metal] = close;
    }

    metalPriceCache = prices;
    metalPriceCacheTime = now;
    return prices;
  } catch (err) {
    logGold.warn(`Spot price fetch failed: ${err}`);
    return metalPriceCache; // return stale cache if available
  }
}

// ============================================================================
// Property / Real Estate Storage
// ============================================================================

export interface PropertyAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
}

export interface PropertyMortgage {
  lender: string;
  balance: number;
  rate: number;
  monthlyPayment: number;
}

export interface PropertyEntry {
  id: string;
  name: string;
  type: string;
  address: PropertyAddress;
  acreage?: number;
  squareFeet?: number;
  purchaseDate: string;
  purchasePrice: number;
  currentValue: number;
  currentValueDate?: string;
  annualPropertyTax?: number;
  mortgage?: PropertyMortgage;
  lastAmortizationDate?: string; // YYYY-MM — last month amortization was applied
  notes?: string;
  createdAt: string;
}

export interface PropertyData {
  entries: PropertyEntry[];
}

// Count months between two YYYY-MM strings
export function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

export async function loadPropertyData(): Promise<PropertyData> {
  try {
    const content = await fs.readFile(PROPERTY_FILE, 'utf-8');
    const data = JSON.parse(content);
    return { entries: data.entries || [] };
  } catch {
    return { entries: [] };
  }
}

export async function savePropertyData(data: PropertyData): Promise<void> {
  await fs.writeFile(PROPERTY_FILE, JSON.stringify(data, null, 2));
}

// Queue to serialize writes to parsed data file
export let parsedDataWriteQueue: Promise<void> = Promise.resolve();

export async function setParsedDataForFile(filePath: string, data: ParsedData): Promise<void> {
  parsedDataWriteQueue = parsedDataWriteQueue.then(async () => {
    const allData = await loadParsedData();
    allData[filePath] = data;
    await saveParsedData(allData);
  });
  await parsedDataWriteQueue;
}

// ============================================================================
// Additional Income Sources
// ============================================================================

export interface IncomeSource {
  id: string;
  name: string;
  amount: number;
  frequency: 'monthly' | 'biweekly' | 'weekly' | 'quarterly' | 'annually';
  taxable: boolean;
  entity?: string;
  notes?: string;
  createdAt: string;
}

export interface IncomeData {
  sources: IncomeSource[];
}

export async function loadIncomeData(): Promise<IncomeData> {
  try {
    const content = await fs.readFile(INCOME_FILE, 'utf-8');
    const data = JSON.parse(content);
    return { sources: data.sources || [] };
  } catch {
    return { sources: [] };
  }
}

export async function saveIncomeData(data: IncomeData): Promise<void> {
  await fs.writeFile(INCOME_FILE, JSON.stringify(data, null, 2));
}

// ============================================================================
// Manual Liabilities (non-SimpleFIN debts — equipment loans, private notes, etc.)
// ============================================================================

export type LiabilityType =
  | 'equipment-loan'
  | 'auto-loan'
  | 'personal-loan'
  | 'student-loan'
  | 'mortgage'
  | 'construction-loan'
  | 'credit-line'
  | 'other';

export interface LiabilityEntry {
  id: string;
  name: string;
  lender?: string;
  type: LiabilityType;
  originalBalance?: number;
  balance: number;
  rate: number;
  monthlyPayment: number;
  termMonths?: number;
  startDate?: string;
  payoffDate?: string;
  entity?: string;
  notes?: string;
  createdAt: string;
}

export interface LiabilitiesData {
  entries: LiabilityEntry[];
}

export async function loadLiabilities(): Promise<LiabilitiesData> {
  try {
    const content = await fs.readFile(LIABILITIES_FILE, 'utf-8');
    const data = JSON.parse(content);
    return { entries: data.entries || [] };
  } catch {
    return { entries: [] };
  }
}

export async function saveLiabilities(data: LiabilitiesData): Promise<void> {
  await fs.writeFile(LIABILITIES_FILE, JSON.stringify(data, null, 2));
}

// ============================================================================
// Account Annotations (rates, types for SimpleFIN accounts)
// ============================================================================

export interface AccountAnnotation {
  rate?: number; // interest rate as decimal (e.g., 0.02 for 2%)
  type?: 'auto-loan' | 'personal-loan' | 'student-loan' | 'credit-card' | 'mortgage' | 'other';
  originalBalance?: number;
  term?: number; // months
  startDate?: string; // YYYY-MM-DD
  monthlyPayment?: number;
  notes?: string;
}

// Keyed by SimpleFIN account ID
export type AccountAnnotationsData = Record<string, AccountAnnotation>;

export async function loadAccountAnnotations(): Promise<AccountAnnotationsData> {
  try {
    const content = await fs.readFile(ACCOUNT_ANNOTATIONS_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

export async function saveAccountAnnotations(data: AccountAnnotationsData): Promise<void> {
  await fs.writeFile(ACCOUNT_ANNOTATIONS_FILE, JSON.stringify(data, null, 2));
}

// ============================================================================
// Authentication
// ============================================================================

export interface AuthConfig {
  username: string;
  password: string | undefined;
  enabled: boolean;
  allowUnauthenticated: boolean;
  startupAllowed: boolean;
  startupError: string | null;
}

function envFlagEnabled(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true' || value?.toLowerCase() === 'yes';
}

export function parseAuthConfig(env: NodeJS.ProcessEnv): AuthConfig {
  const username = env.DOCVAULT_USERNAME?.trim() || 'admin';
  const password = env.DOCVAULT_PASSWORD;
  const enabled = !!password;
  const allowUnauthenticated = envFlagEnabled(env.DOCVAULT_ALLOW_UNAUTHENTICATED);
  const startupAllowed = enabled || allowUnauthenticated;
  return {
    username,
    password,
    enabled,
    allowUnauthenticated,
    startupAllowed,
    startupError: startupAllowed
      ? null
      : 'DOCVAULT_PASSWORD is required at server startup. For local/demo-only use, set DOCVAULT_ALLOW_UNAUTHENTICATED=true explicitly.',
  };
}

export const AUTH_CONFIG = parseAuthConfig(process.env);
export const AUTH_USERNAME = AUTH_CONFIG.username;
export const AUTH_PASSWORD = AUTH_CONFIG.password;
export const AUTH_ENABLED = AUTH_CONFIG.enabled;
export const AUTH_ALLOW_UNAUTHENTICATED = AUTH_CONFIG.allowUnauthenticated;

export function assertAuthConfiguredForStartup(config: AuthConfig = AUTH_CONFIG): void {
  if (!config.startupAllowed) {
    throw new Error(config.startupError ?? 'Authentication is not configured');
  }
}

// In-memory session store: token -> expiry timestamp
export const sessions = new Map<string, number>();
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 days in seconds
export const SESSION_COOKIE = 'docvault_session';

export function createSession(): string {
  const token = crypto.randomUUID();
  sessions.set(token, Date.now() + SESSION_MAX_AGE * 1000);
  return token;
}

export function isValidSession(token: string): boolean {
  const expiry = sessions.get(token);
  if (!expiry) return false;
  if (Date.now() > expiry) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export function getSessionToken(req: Request): string | null {
  const cookie = req.headers.get('cookie');
  if (!cookie) return null;
  const match = cookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  return match ? match[1] : null;
}

export function sessionCookie(token: string, maxAge = SESSION_MAX_AGE): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export function isAuthenticated(req: Request): boolean {
  if (!AUTH_ENABLED) return true;
  const token = getSessionToken(req);
  return token !== null && isValidSession(token);
}

// Routes that don't require auth (status must be open so frontend can check auth state)
export const PUBLIC_ROUTES = new Set(['/api/login', '/api/status']);

if (AUTH_ENABLED) {
  logAuth.info(`Authentication enabled for user "${AUTH_USERNAME}"`);
} else if (AUTH_ALLOW_UNAUTHENTICATED) {
  logAuth.warn('Authentication disabled by explicit DOCVAULT_ALLOW_UNAUTHENTICATED opt-in');
} else {
  logAuth.warn('Authentication password missing; direct server startup will fail closed');
}
