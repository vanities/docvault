import {
  AUTH_ENABLED,
  AUTH_PASSWORD,
  AUTH_USERNAME,
  DATA_DIR,
  DEFAULT_MODEL,
  PUBLIC_ROUTES,
  createSession,
  getCodexAuthStatus,
  getSessionToken,
  isAuthenticated,
  jsonResponse,
  loadConfig,
  loadSettings,
  saveSettings,
  sessionCookie,
  sessions,
  type ModelEffort,
} from '../data.js';
import { readJsonBody } from '../http.js';
import { isValidTimeZone } from '../tz.js';

const EFFORT_LEVELS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

function effortOf(v: unknown): ModelEffort | undefined {
  return typeof v === 'string' && EFFORT_LEVELS.has(v) ? (v as ModelEffort) : undefined;
}

/** Validate a posted {provider, model, effort?} ref; null = invalid/absent. */
function modelRefOf(
  ref: unknown
): { provider: 'anthropic' | 'openai'; model: string; effort?: ModelEffort } | null {
  if (!ref || typeof ref !== 'object') return null;
  const r = ref as { provider?: unknown; model?: unknown; effort?: unknown };
  if (r.provider !== 'anthropic' && r.provider !== 'openai') return null;
  if (typeof r.model !== 'string' || !r.model.trim()) return null;
  const effort = effortOf(r.effort);
  return { provider: r.provider, model: r.model.trim(), ...(effort ? { effort } : {}) };
}

export async function handleAuthRoutes(req: Request, pathname: string): Promise<Response | null> {
  // --- Auth: login endpoint ---
  if (pathname === '/api/login' && req.method === 'POST') {
    if (!AUTH_ENABLED) {
      return jsonResponse({ ok: true, message: 'Auth not enabled' });
    }
    const { username, password } = await readJsonBody<{ username?: string; password?: string }>(
      req
    );
    if (username === AUTH_USERNAME && password === AUTH_PASSWORD) {
      const token = createSession();
      const res = jsonResponse({ ok: true });
      res.headers.set('Set-Cookie', sessionCookie(token));
      return res;
    }
    return jsonResponse({ error: 'Invalid credentials' }, 401);
  }

  // --- Auth: logout endpoint ---
  if (pathname === '/api/logout' && req.method === 'POST') {
    const token = getSessionToken(req);
    if (token) sessions.delete(token);
    const res = jsonResponse({ ok: true });
    res.headers.set('Set-Cookie', sessionCookie('deleted', 0));
    return res;
  }

  return null;
}

export function rejectUnauthorizedApiRequest(req: Request, pathname: string): Response | null {
  if (AUTH_ENABLED && pathname.startsWith('/api/') && !PUBLIC_ROUTES.has(pathname)) {
    if (!isAuthenticated(req)) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }
  }
  return null;
}

export async function handleSettingsRoutes(
  req: Request,
  pathname: string
): Promise<Response | null> {
  // GET /api/config
  if (pathname === '/api/config' && req.method === 'GET') {
    const config = await loadConfig();
    return jsonResponse({ dataDir: DATA_DIR, ...config });
  }

  // GET /api/settings
  if (pathname === '/api/settings' && req.method === 'GET') {
    const settings = await loadSettings();
    const hasSettingsKey = !!settings.anthropicKey;
    const hasEnvKey = !!process.env.ANTHROPIC_API_KEY;

    let keySource: 'settings' | 'env' | undefined;
    let keyHint: string | undefined;

    if (hasSettingsKey) {
      keySource = 'settings';
      keyHint = settings.anthropicKey!.slice(-4);
    } else if (hasEnvKey) {
      keySource = 'env';
      keyHint = process.env.ANTHROPIC_API_KEY!.slice(-4);
    }

    const hasSettingsAuth = !!settings.anthropicAuthToken;
    const hasEnvAuth = !!process.env.ANTHROPIC_AUTH_TOKEN;
    let authSource: 'settings' | 'env' | undefined;
    let authHint: string | undefined;
    if (hasSettingsAuth) {
      authSource = 'settings';
      authHint = settings.anthropicAuthToken!.slice(-4);
    } else if (hasEnvAuth) {
      authSource = 'env';
      authHint = process.env.ANTHROPIC_AUTH_TOKEN!.slice(-4);
    }

    return jsonResponse({
      hasAnthropicKey: hasSettingsKey || hasEnvKey,
      keySource,
      keyHint,
      hasAnthropicAuthToken: hasSettingsAuth || hasEnvAuth,
      authSource,
      authHint,
      claudeModel: settings.claudeModel || DEFAULT_MODEL,
      hasGeoapifyKey: !!settings.geoapifyApiKey,
      geoapifyKeyHint: settings.geoapifyApiKey ? settings.geoapifyApiKey.slice(-4) : undefined,
      hasFredKey: !!settings.fredApiKey,
      fredKeyHint: settings.fredApiKey ? settings.fredApiKey.slice(-4) : undefined,
      hasCongressKey: !!settings.congressApiKey,
      congressKeyHint: settings.congressApiKey ? settings.congressApiKey.slice(-4) : undefined,
      transcribeUrl: settings.transcribeUrl ?? '',
      transcribeModel: settings.transcribeModel ?? '',
      hasTranscribeApiKey: !!settings.transcribeApiKey,
      transcribeApiKeyHint: settings.transcribeApiKey
        ? settings.transcribeApiKey.slice(-4)
        : undefined,
      ttsUrl: settings.ttsUrl ?? '',
      ttsLanguage: settings.ttsLanguage ?? '',
      hasTtsApiKey: !!settings.ttsApiKey,
      ttsApiKeyHint: settings.ttsApiKey ? settings.ttsApiKey.slice(-4) : undefined,
      // Direct-API model providers + per-scope routing (parsing, research)
      hasOpenaiKey: !!(settings.openai?.apiKey || process.env.OPENAI_API_KEY),
      openaiKeyHint: settings.openai?.apiKey
        ? settings.openai.apiKey.slice(-4)
        : process.env.OPENAI_API_KEY
          ? process.env.OPENAI_API_KEY.slice(-4)
          : undefined,
      openaiBaseUrl: settings.openai?.baseUrl ?? '',
      modelRouting: settings.modelRouting ?? {},
      chat: settings.chat ?? {},
      deepResearch: settings.deepResearch ?? {},
      dailyNews: settings.dailyNews ?? {},
      email: {
        provider: 'resend',
        fromEmail: settings.email?.fromEmail ?? '',
        fromName: settings.email?.fromName ?? '',
        toEmail: settings.email?.toEmail ?? '',
        enabled: settings.email?.enabled ?? false,
        hasResendApiKey: !!(settings.email?.resendApiKey || process.env.RESEND_API_KEY),
        resendApiKeyHint: settings.email?.resendApiKey
          ? settings.email.resendApiKey.slice(-4)
          : process.env.RESEND_API_KEY
            ? process.env.RESEND_API_KEY.slice(-4)
            : undefined,
      },
      weather: settings.weather ?? {},
      hasCodexAuth: (await getCodexAuthStatus()).signedIn,
    });
  }

  // POST /api/settings
  if (pathname === '/api/settings' && req.method === 'POST') {
    const body = await readJsonBody<{
      clearAnthropicKey?: boolean;
      anthropicKey?: string;
      claudeModel?: string;
      geoapifyApiKey?: string;
      fredApiKey?: string;
      congressApiKey?: string;
      clearAnthropicAuthToken?: boolean;
      anthropicAuthToken?: string;
      transcribeUrl?: string;
      transcribeModel?: string;
      clearTranscribeApiKey?: boolean;
      transcribeApiKey?: string;
      ttsUrl?: string;
      ttsLanguage?: string;
      clearTtsApiKey?: boolean;
      ttsApiKey?: string;
      clearOpenaiApiKey?: boolean;
      openaiApiKey?: string;
      openaiBaseUrl?: string;
      modelRouting?: { parsing?: { provider?: unknown; model?: unknown } | null };
      chat?: unknown;
      deepResearch?: unknown;
      dailyNews?: unknown;
      email?: unknown;
      weather?: unknown;
    }>(req);
    const settings = await loadSettings();

    if (body.clearAnthropicKey) {
      delete settings.anthropicKey;
    } else if (body.anthropicKey) {
      settings.anthropicKey = body.anthropicKey;
    }

    if (body.claudeModel !== undefined) {
      if (body.claudeModel) {
        settings.claudeModel = body.claudeModel;
      } else {
        delete settings.claudeModel;
      }
    }

    if (body.geoapifyApiKey !== undefined) {
      if (body.geoapifyApiKey) {
        settings.geoapifyApiKey = body.geoapifyApiKey;
      } else {
        delete settings.geoapifyApiKey;
      }
    }

    if (body.fredApiKey !== undefined) {
      if (body.fredApiKey) {
        settings.fredApiKey = body.fredApiKey;
      } else {
        delete settings.fredApiKey;
      }
    }

    if (body.congressApiKey !== undefined) {
      if (body.congressApiKey) {
        settings.congressApiKey = body.congressApiKey;
      } else {
        delete settings.congressApiKey;
      }
    }

    if (body.clearAnthropicAuthToken) {
      delete settings.anthropicAuthToken;
    } else if (body.anthropicAuthToken !== undefined) {
      if (body.anthropicAuthToken) {
        settings.anthropicAuthToken = body.anthropicAuthToken;
      } else {
        delete settings.anthropicAuthToken;
      }
    }

    if (body.transcribeUrl !== undefined) {
      const v = String(body.transcribeUrl).trim();
      if (v) settings.transcribeUrl = v;
      else delete settings.transcribeUrl;
    }

    if (body.transcribeModel !== undefined) {
      const v = String(body.transcribeModel).trim();
      if (v) settings.transcribeModel = v;
      else delete settings.transcribeModel;
    }

    if (body.clearTranscribeApiKey) {
      delete settings.transcribeApiKey;
    } else if (body.transcribeApiKey !== undefined) {
      const v = String(body.transcribeApiKey).trim();
      if (v) settings.transcribeApiKey = v;
      else delete settings.transcribeApiKey;
    }

    if (body.ttsUrl !== undefined) {
      const v = String(body.ttsUrl).trim();
      if (v) settings.ttsUrl = v;
      else delete settings.ttsUrl;
    }

    if (body.ttsLanguage !== undefined) {
      const v = String(body.ttsLanguage).trim().toLowerCase();
      if (v) settings.ttsLanguage = v;
      else delete settings.ttsLanguage;
    }

    if (body.clearTtsApiKey) {
      delete settings.ttsApiKey;
    } else if (body.ttsApiKey !== undefined) {
      const v = String(body.ttsApiKey).trim();
      if (v) settings.ttsApiKey = v;
      else delete settings.ttsApiKey;
    }

    // --- Model providers + routing ---
    if (body.clearOpenaiApiKey) {
      if (settings.openai) delete settings.openai.apiKey;
    } else if (body.openaiApiKey !== undefined) {
      const v = String(body.openaiApiKey).trim();
      if (v) settings.openai = { ...(settings.openai ?? {}), apiKey: v };
      else if (settings.openai) delete settings.openai.apiKey;
    }

    if (body.openaiBaseUrl !== undefined) {
      const v = String(body.openaiBaseUrl).trim();
      if (v) settings.openai = { ...(settings.openai ?? {}), baseUrl: v };
      else if (settings.openai) delete settings.openai.baseUrl;
    }

    if (body.modelRouting && typeof body.modelRouting === 'object') {
      settings.modelRouting = settings.modelRouting ?? {};
      for (const scope of ['parsing'] as const) {
        const ref = body.modelRouting[scope];
        const parsed = modelRefOf(ref);
        if (ref === null) {
          delete settings.modelRouting[scope];
        } else if (parsed) {
          settings.modelRouting[scope] = parsed;
        }
      }
    }

    // Chat agent backend (claude | codex) + per-backend effort + codex model/home/binary.
    if (body.chat && typeof body.chat === 'object') {
      settings.chat = settings.chat ?? {};
      const c = body.chat as {
        backend?: unknown;
        claudeEffort?: unknown;
        codexModel?: unknown;
        codexEffort?: unknown;
        codexHome?: unknown;
        codexBinary?: unknown;
      };
      if (c.backend === 'claude' || c.backend === 'codex') settings.chat.backend = c.backend;
      for (const k of ['codexModel', 'codexHome', 'codexBinary'] as const) {
        const v = c[k];
        if (typeof v === 'string') settings.chat[k] = v.trim() || undefined;
      }
      // '' clears the effort back to the provider default; invalid values are ignored.
      for (const k of ['claudeEffort', 'codexEffort'] as const) {
        const v = c[k];
        if (v === '') delete settings.chat[k];
        else {
          const e = effortOf(v);
          if (e) settings.chat[k] = e;
        }
      }
    }

    // Deep Research engine: mode ('api' | 'agent') + API-mode model.
    if (body.deepResearch && typeof body.deepResearch === 'object') {
      settings.deepResearch = settings.deepResearch ?? {};
      const dr = body.deepResearch as { mode?: unknown; agentBackend?: unknown; model?: unknown };
      if (dr.mode === 'agent' || dr.mode === 'api') settings.deepResearch.mode = dr.mode;
      if (dr.agentBackend === 'claude' || dr.agentBackend === 'codex')
        settings.deepResearch.agentBackend = dr.agentBackend;
      const parsed = modelRefOf(dr.model);
      if (dr.model === null) {
        delete settings.deepResearch.model;
      } else if (parsed) {
        settings.deepResearch.model = parsed;
      }
    }

    // Daily News engine: same shape as deepResearch (mode/agentBackend/model) + masthead title.
    if (body.dailyNews && typeof body.dailyNews === 'object') {
      settings.dailyNews = settings.dailyNews ?? {};
      const dn = body.dailyNews as {
        mode?: unknown;
        agentBackend?: unknown;
        model?: unknown;
        title?: unknown;
        theme?: unknown;
        headlineImage?: unknown;
        imageModel?: unknown;
        narration?: unknown;
      };
      if (dn.mode === 'agent' || dn.mode === 'api') settings.dailyNews.mode = dn.mode;
      if (dn.agentBackend === 'claude' || dn.agentBackend === 'codex')
        settings.dailyNews.agentBackend = dn.agentBackend;
      const parsed = modelRefOf(dn.model);
      if (dn.model === null) {
        delete settings.dailyNews.model;
      } else if (parsed) {
        settings.dailyNews.model = parsed;
      }
      if (typeof dn.title === 'string') {
        const t = dn.title.trim();
        if (t) settings.dailyNews.title = t;
        else delete settings.dailyNews.title;
      }
      if (typeof dn.theme === 'string') {
        const t = dn.theme.trim();
        if (t) settings.dailyNews.theme = t;
        else delete settings.dailyNews.theme;
      }
      if (typeof dn.headlineImage === 'boolean') {
        settings.dailyNews.headlineImage = dn.headlineImage;
      }
      if (typeof dn.imageModel === 'string') {
        const m = dn.imageModel.trim();
        if (m) settings.dailyNews.imageModel = m;
        else delete settings.dailyNews.imageModel;
      }
      if (dn.narration && typeof dn.narration === 'object') {
        const n = dn.narration as {
          personId?: unknown;
          defaultSpeed?: unknown;
          exaggeration?: unknown;
          cfgWeight?: unknown;
        };
        const cur = settings.dailyNews.narration ?? {};
        if (typeof n.personId === 'string') {
          const p = n.personId.trim();
          if (p) cur.personId = p;
          else delete cur.personId;
        }
        if (typeof n.defaultSpeed === 'number' && Number.isFinite(n.defaultSpeed)) {
          cur.defaultSpeed = Math.min(3, Math.max(0.5, n.defaultSpeed));
        }
        if (typeof n.exaggeration === 'number' && Number.isFinite(n.exaggeration)) {
          cur.exaggeration = Math.min(2, Math.max(0.25, n.exaggeration));
        } else if (n.exaggeration === null) {
          delete cur.exaggeration;
        }
        if (typeof n.cfgWeight === 'number' && Number.isFinite(n.cfgWeight)) {
          cur.cfgWeight = Math.min(1, Math.max(0, n.cfgWeight));
        } else if (n.cfgWeight === null) {
          delete cur.cfgWeight;
        }
        if (Object.keys(cur).length) settings.dailyNews.narration = cur;
        else delete settings.dailyNews.narration;
      }
    }

    // Outbound email (Resend) — resendApiKey is encrypted at rest via walkSensitiveFields.
    if (body.email && typeof body.email === 'object') {
      settings.email = settings.email ?? { provider: 'resend' };
      settings.email.provider = 'resend';
      const em = body.email as {
        fromEmail?: unknown;
        fromName?: unknown;
        toEmail?: unknown;
        enabled?: unknown;
        resendApiKey?: unknown;
        clearResendApiKey?: unknown;
      };
      for (const k of ['fromEmail', 'fromName', 'toEmail'] as const) {
        const v = em[k];
        if (typeof v === 'string') settings.email[k] = v.trim() || undefined;
      }
      if (typeof em.enabled === 'boolean') settings.email.enabled = em.enabled;
      if (em.clearResendApiKey) {
        delete settings.email.resendApiKey;
      } else if (typeof em.resendApiKey === 'string' && em.resendApiKey.trim()) {
        settings.email.resendApiKey = em.resendApiKey.trim();
      }
    }

    // Weather location for the Daily News forecast (Open-Meteo — keyless).
    if (body.weather && typeof body.weather === 'object') {
      settings.weather = settings.weather ?? {};
      const w = body.weather as {
        enabled?: unknown;
        latitude?: unknown;
        longitude?: unknown;
        label?: unknown;
        units?: unknown;
        timezone?: unknown;
      };
      if (typeof w.enabled === 'boolean') settings.weather.enabled = w.enabled;
      if (typeof w.latitude === 'number' && w.latitude >= -90 && w.latitude <= 90) {
        settings.weather.latitude = w.latitude;
      }
      if (typeof w.longitude === 'number' && w.longitude >= -180 && w.longitude <= 180) {
        settings.weather.longitude = w.longitude;
      }
      if (typeof w.label === 'string') settings.weather.label = w.label.trim() || undefined;
      if (w.units === 'F' || w.units === 'C') settings.weather.units = w.units;
      // IANA timezone for this location — derived from the geocoded city (or a
      // manual override). The app-wide source of truth (see tz.ts).
      if (isValidTimeZone(w.timezone)) settings.weather.timezone = w.timezone;
    }

    await saveSettings(settings);
    return jsonResponse({ ok: true });
  }

  return null;
}
