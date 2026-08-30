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
}

interface SimplefinResponse {
  errors?: string[];
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
  const baseUrl = config.accessUrl.replace(/\/+$/, '');
  const url = `${baseUrl}/accounts`;

  // Extract Basic Auth from the access URL
  const parsed = new URL(url);
  const auth = Buffer.from(`${parsed.username}:${parsed.password}`).toString('base64');

  // Remove credentials from URL for fetch
  parsed.username = '';
  parsed.password = '';

  const res = await fetch(parsed.toString(), {
    headers: {
      Authorization: `Basic ${auth}`,
    },
  });

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
    throw new Error(`SimpleFIN error (${res.status}): ${body || res.statusText}`);
  }

  const data = (await res.json()) as SimplefinResponse;

  // SimpleFIN signals a broken connection IN THE BODY, with HTTP 200: the
  // `errors` array carries things like "Connection to <bank> needs attention"
  // while `accounts` comes back empty or short. Treating that as success means
  // the caller sees no exception, sums an empty list to $0, records that as the
  // day's bank balance, and overwrites the fallback cache with the empty list —
  // destroying the only data that could have covered the outage.
  const accounts = data.accounts ?? [];
  if (data.errors?.length) {
    log.warn(
      `SimpleFIN reported ${data.errors.length} connection error(s):`,
      JSON.stringify(data.errors)
    );
  }
  if (accounts.length === 0) {
    // A configured connection never legitimately returns zero accounts.
    const detail = data.errors?.length ? `: ${data.errors.join('; ')}` : ' (no errors reported)';
    throw new Error(`SimpleFIN returned no accounts${detail}`);
  }
  log.info(
    `[balances] fetched ${accounts.length} accounts, ${data.errors?.length ?? 0} connection error(s)`
  );

  return accounts.map((acct) => ({
    id: acct.id,
    name: acct.name,
    connId: acct.org?.id || '',
    currency: acct.currency,
    balance: parseFloat(acct.balance) || 0,
    availableBalance: acct['available-balance'] ? parseFloat(acct['available-balance']) : null,
    balanceDate: acct['balance-date'] || null,
    connectionName: acct.org?.name || undefined,
  }));
}
