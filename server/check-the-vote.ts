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

export async function fetchCheckTheVoteJson<T>(path: string): Promise<T> {
  const config = getCheckTheVoteConfig();
  if (!config.configured) {
    throw new Error(`Check the Vote is not configured: ${config.reason}`);
  }

  const res = await fetch(`${config.baseUrl}${path}`, {
    headers: buildCheckTheVoteHeaders(config.apiKey),
  });

  if (!res.ok) {
    throw new Error(`Check the Vote request failed: ${res.status}`);
  }

  return (await res.json()) as T;
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
