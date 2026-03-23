// =============================================================================
// SimpleFIN Bridge Integration
// =============================================================================
// Connects to bank accounts (checking, savings, credit cards) via SimpleFIN.
// $15/year, designed for personal finance tools. Powered by MX (16,000+ US banks).
// API docs: https://beta-bridge.simplefin.org/info/developers

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

  const data: SimplefinResponse = await res.json();

  if (data.errors?.length) {
    console.warn('[SimpleFIN] Warnings:', data.errors);
  }

  return data.accounts.map((acct) => ({
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
