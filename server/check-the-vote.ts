export type CheckTheVoteEnv = {
  CHECKTHEVOTE_BASE_URL?: string;
  CHECKTHEVOTE_API_KEY?: string;
};

export type CheckTheVoteConfig =
  | { configured: false; reason: 'missing_base_url' | 'missing_api_key' }
  | { configured: true; baseUrl: string; apiKey: string };

export function getCheckTheVoteConfig(env: CheckTheVoteEnv = process.env): CheckTheVoteConfig {
  const rawBaseUrl = env.CHECKTHEVOTE_BASE_URL?.trim();
  const apiKey = env.CHECKTHEVOTE_API_KEY?.trim();

  if (!rawBaseUrl) return { configured: false, reason: 'missing_base_url' };
  if (!apiKey) return { configured: false, reason: 'missing_api_key' };

  return {
    configured: true,
    baseUrl: rawBaseUrl.replace(/\/+$/, ''),
    apiKey,
  };
}

export function buildCheckTheVoteHeaders(apiKey: string): Record<string, string> {
  return {
    accept: 'application/json',
    authorization: `Bearer ${apiKey}`,
  };
}

export type CheckTheVoteFetch = typeof fetch;

async function fetchCheckTheVoteJsonWithConfig<T>(
  config: Extract<CheckTheVoteConfig, { configured: true }>,
  path: string,
  fetchFn: CheckTheVoteFetch
): Promise<T> {
  const res = await fetchFn(`${config.baseUrl}${path}`, {
    headers: buildCheckTheVoteHeaders(config.apiKey),
  });

  if (!res.ok) {
    throw new Error(`Check the Vote request failed for ${path}: HTTP ${res.status}`);
  }

  return (await res.json()) as T;
}

export async function fetchCheckTheVoteJson<T>(path: string): Promise<T> {
  const config = getCheckTheVoteConfig();
  if (!config.configured) {
    throw new Error(`Check the Vote is not configured: ${config.reason}`);
  }

  return fetchCheckTheVoteJsonWithConfig<T>(config, path, fetch);
}

export type CheckTheVotePolitics =
  | { configured: false; ok: false; reason: 'missing_base_url' | 'missing_api_key' }
  | {
      configured: true;
      ok: boolean;
      baseUrl: string;
      checkedAt: string;
      health?: unknown;
      sync?: unknown;
      votes?: unknown;
      trades?: unknown;
      filings?: unknown;
      error?: string;
    };

const POLITICS_PATHS = [
  ['health', '/api/v1/health'],
  ['sync', '/api/v1/sync'],
  ['votes', '/api/v1/votes/recent'],
  ['trades', '/api/v1/trades/recent'],
  ['filings', '/api/v1/trade-filings/recent'],
] as const;

export async function loadCheckTheVotePolitics(
  env: CheckTheVoteEnv = process.env,
  fetchFn: CheckTheVoteFetch = fetch
): Promise<CheckTheVotePolitics> {
  const config = getCheckTheVoteConfig(env);
  if (!config.configured) {
    return { configured: false, ok: false, reason: config.reason };
  }

  const checkedAt = new Date().toISOString();
  const result: Extract<CheckTheVotePolitics, { configured: true }> = {
    configured: true,
    ok: true,
    baseUrl: config.baseUrl,
    checkedAt,
  };

  try {
    for (const [key, path] of POLITICS_PATHS) {
      result[key] = await fetchCheckTheVoteJsonWithConfig<unknown>(config, path, fetchFn);
    }
    return result;
  } catch (err) {
    return {
      ...result,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export type CheckTheVoteStatus =
  | { configured: false; ok: false; reason: 'missing_base_url' | 'missing_api_key' }
  | {
      configured: true;
      ok: boolean;
      baseUrl: string;
      checkedAt: string;
      service?: string;
      error?: string;
    };

export async function loadCheckTheVoteStatus(
  env: CheckTheVoteEnv = process.env,
  fetchFn: CheckTheVoteFetch = fetch
): Promise<CheckTheVoteStatus> {
  const config = getCheckTheVoteConfig(env);
  if (!config.configured) {
    return { configured: false, ok: false, reason: config.reason };
  }

  const checkedAt = new Date().toISOString();
  try {
    const res = await fetchFn(`${config.baseUrl}/api/v1/health`, {
      headers: buildCheckTheVoteHeaders(config.apiKey),
    });
    if (!res.ok) {
      return {
        configured: true,
        ok: false,
        baseUrl: config.baseUrl,
        checkedAt,
        error: `HTTP ${res.status}`,
      };
    }
    const body = (await res.json().catch(() => ({}))) as { service?: string };
    return {
      configured: true,
      ok: true,
      baseUrl: config.baseUrl,
      checkedAt,
      service: body.service,
    };
  } catch (err) {
    return {
      configured: true,
      ok: false,
      baseUrl: config.baseUrl,
      checkedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
