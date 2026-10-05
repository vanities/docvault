// =============================================================================
// SimpleFIN Bridge Integration
// =============================================================================
// Connects to bank accounts (checking, savings, credit cards) via SimpleFIN.
// $15/year, designed for personal finance tools. Powered by MX (16,000+ US banks).
// API docs: https://beta-bridge.simplefin.org/info/developers

import { createLogger } from './logger.js';

const log = createLogger('SimpleFIN');

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface SimplefinConfig {
  accessUrl: string; // https://user:pass@host/simplefin (contains Basic Auth)
}

export interface SimplefinAccount {
  id: string;
  name: string;
  connId: string;
  currency: string;
  balance: number;
  availableBalance: number | null;
  balanceDate: number | null; // Unix timestamp
  connectionName?: string;
}

export interface SimplefinBalanceCache {
  accounts: SimplefinAccount[];
  lastUpdated: string;
  connectionErrors?: string[];
}

// Raw API response types
interface SimplefinRawOrg {
  name: string;
  domain?: string;
  url?: string;
  id?: string;
}

interface SimplefinRawAccount {
  id: string;
  name: string;
  currency: string;
  balance: string; // numeric string
  'available-balance'?: string;
  'balance-date'?: number;
  org?: SimplefinRawOrg;
  conn_id?: string;
  conn_name?: string;
}

interface SimplefinResponse {
  errors?: string[];
  errlist?: Array<{ code: string; msg: string; conn_id?: string }>;
  connections?: Array<{ conn_id: string; name: string }>;
  accounts: SimplefinRawAccount[];
}

// -----------------------------------------------------------------------------
// Setup Token Exchange (one-time)
// -----------------------------------------------------------------------------

export async function claimSetupToken(setupToken: string): Promise<string> {
  // Setup token is base64-encoded claim URL
  const claimUrl = Buffer.from(setupToken, 'base64').toString('utf-8');

  const res = await fetch(claimUrl, {
    method: 'POST',
    headers: { 'Content-Length': '0' },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 403) {
      throw new Error(
        'Setup token already claimed or invalid. Generate a new one from SimpleFIN Bridge.'
      );
    }
    throw new Error(`SimpleFIN claim failed (${res.status}): ${body || res.statusText}`);
  }

  const accessUrl = await res.text();
  if (!accessUrl || !accessUrl.startsWith('http')) {
    throw new Error('Invalid access URL received from SimpleFIN');
  }

  return accessUrl.trim();
}

// -----------------------------------------------------------------------------
// Fetch Balances
// -----------------------------------------------------------------------------

export async function fetchBalances(config: SimplefinConfig): Promise<SimplefinAccount[]> {
  return (await fetchBalanceSnapshot(config)).accounts;
}

/** Keep provider warnings alongside the balances so cached views still show
 * which connections need attention, even when other accounts fetched fine. */
export async function fetchBalanceSnapshot(
  config: SimplefinConfig
): Promise<SimplefinBalanceCache> {
  const baseUrl = config.accessUrl.replace(/\/+$/, '');
  const url = `${baseUrl}/accounts`;

  // Extract Basic Auth from the access URL
  const parsed = new URL(url);
  const auth = Buffer.from(`${parsed.username}:${parsed.password}`).toString('base64');

  // Remove credentials from URL for fetch
  parsed.username = '';
  parsed.password = '';

  let res: Response;
  for (let attempt = 1; ; attempt++) {
    try {
      res = await fetch(parsed.toString(), {
        headers: { Authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(30_000),
      });
      // Quota failures need time to replenish; immediate retries spend more
      // of the Bridge's daily allowance without repairing the connection.
      if (attempt === 3 || res.status < 500) break;
      await res.body?.cancel();
      log.warn(`[balances] HTTP ${res.status}; attempt=${attempt}/3 retryInMs=${1000 * attempt}`);
    } catch (error) {
      if (attempt === 3) throw error;
      log.warn(
        `[balances] request failed: ${error instanceof Error ? error.message : String(error)}; attempt=${attempt}/3 retryInMs=${1000 * attempt}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 403) {
      throw new Error(
        'SimpleFIN authentication failed. Your access URL may be invalid or expired.'
      );
    }
    if (res.status === 402) {
      throw new Error('SimpleFIN subscription required. Renew at beta-bridge.simplefin.org');
    }
    if (res.status === 429) throw new Error('SimpleFIN request quota reached. Try again later.');
    throw new Error(`SimpleFIN error (${res.status}): ${body || res.statusText}`);
  }

  const data = (await res.json()) as SimplefinResponse;
  const errors = data.errlist?.length
    ? data.errlist.map((error) => {
        const name = data.connections?.find(
          (connection) => connection.conn_id === error.conn_id
        )?.name;
        return name && !error.msg.includes(name) ? `${name}: ${error.msg}` : error.msg;
      })
    : (data.errors ?? []);

  // SimpleFIN signals a broken connection IN THE BODY, with HTTP 200: the
  // `errors` array carries things like "Connection to <bank> needs attention"
  // while `accounts` comes back empty or short. Treating that as success means
  // the caller sees no exception, sums an empty list to $0, records that as the
  // day's bank balance, and overwrites the fallback cache with the empty list —
  // destroying the only data that could have covered the outage.
  const accounts = data.accounts ?? [];
  if (errors.length) {
    log.warn(`SimpleFIN reported ${errors.length} connection error(s):`, JSON.stringify(errors));
  }
  if (accounts.length === 0) {
    // A configured connection never legitimately returns zero accounts.
    const detail = errors.length ? `: ${errors.join('; ')}` : ' (no errors reported)';
    throw new Error(`SimpleFIN returned no accounts${detail}`);
  }
  log.info(`[balances] fetched ${accounts.length} accounts, ${errors.length} connection error(s)`);

  const mapped = accounts.map((acct) => ({
    id: acct.id,
    name: acct.name,
    connId: acct.conn_id || acct.org?.id || '',
    currency: acct.currency,
    balance: parseFloat(acct.balance) || 0,
    availableBalance: acct['available-balance'] ? parseFloat(acct['available-balance']) : null,
    balanceDate: acct['balance-date'] || null,
    connectionName:
      acct.conn_name ||
      data.connections?.find((connection) => connection.conn_id === acct.conn_id)?.name ||
      acct.org?.name ||
      undefined,
  }));
  return {
    accounts: mapped,
    lastUpdated: new Date().toISOString(),
    connectionErrors: errors,
  };
}
