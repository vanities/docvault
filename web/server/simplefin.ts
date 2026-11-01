// =============================================================================
// SimpleFIN Bridge Integration
// =============================================================================
// Connects to bank accounts (checking, savings, credit cards) via SimpleFIN.
// $15/year, designed for personal finance tools. Powered by MX (16,000+ US banks).
// API docs: https://beta-bridge.simplefin.org/info/developers

import { createLogger } from './logger.js';
import { deriveConnectionIssues, type SimplefinIssue } from './simplefin-health.js';
import { unixToYmd, type BankTransaction } from './bank-transactions.js';

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
  connectionIssues?: SimplefinIssue[];
}

/** A fetch result. `transactions` is present only when the fetch asked for
 * them, and never belongs in the balance cache. */
export interface SimplefinSnapshot extends SimplefinBalanceCache {
  transactions?: BankTransaction[];
}

export interface SimplefinFetchOptions {
  /** Unix seconds. Set to also fetch transactions posted since then. */
  transactionsSince?: number;
}

export class SimplefinFetchError extends Error {
  issues: SimplefinIssue[];
  constructor(message: string, issues: SimplefinIssue[]) {
    super(message);
    this.name = 'SimplefinFetchError';
    this.issues = issues;
  }
}

// Raw API response types
interface SimplefinRawOrg {
  name: string;
  domain?: string;
  url?: string;
  id?: string;
}

interface SimplefinRawTransaction {
  id: string;
  posted: number; // Unix timestamp
  amount: string; // numeric string, negative = money out
  description?: string;
  payee?: string;
  memo?: string;
  transacted_at?: number;
  pending?: boolean;
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
  transactions?: SimplefinRawTransaction[];
}

// SimpleFIN reports a long date range as an error entry ("exceeds limit of 90
// days and was capped", "exceeds recommended range of 45 days") while still
// returning data. It is not a broken connection, so it must not reach the Banks
// page as one.
const RANGE_CAP_NOTICE = /date range exceeds/i;

interface SimplefinResponse {
  errors?: string[];
  errlist?: Array<{ code: string; msg?: string; message?: string; conn_id?: string }>;
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
  config: SimplefinConfig,
  opts: SimplefinFetchOptions = {}
): Promise<SimplefinSnapshot> {
  const baseUrl = config.accessUrl.replace(/\/+$/, '');
  const url = `${baseUrl}/accounts`;

  // Extract Basic Auth from the access URL
  const parsed = new URL(url);
  const auth = Buffer.from(`${parsed.username}:${parsed.password}`).toString('base64');

  // Remove credentials from URL for fetch
  parsed.username = '';
  parsed.password = '';
  parsed.searchParams.set('version', '2');
  const withTransactions = typeof opts.transactionsSince === 'number';
  if (withTransactions) {
    parsed.searchParams.set('start-date', String(Math.floor(opts.transactionsSince!)));
  } else {
    parsed.searchParams.set('balances-only', '1');
  }

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
      const message = 'SimpleFIN authentication failed. Check the app access token in Settings.';
      throw new SimplefinFetchError(message, [{ id: 'access', kind: 'access', message }]);
    }
    if (res.status === 402) {
      const message = 'SimpleFIN subscription required. Renew at beta-bridge.simplefin.org';
      throw new SimplefinFetchError(message, [
        { id: 'subscription', kind: 'subscription', message },
      ]);
    }
    if (res.status === 429) {
      const message = 'SimpleFIN request quota reached. Try again later.';
      throw new SimplefinFetchError(message, [{ id: 'quota', kind: 'quota', message }]);
    }
    throw new Error(`SimpleFIN error (${res.status}): ${body || res.statusText}`);
  }

  const data = (await res.json()) as SimplefinResponse;
  const isCapNotice = (message?: string) => RANGE_CAP_NOTICE.test(message ?? '');
  const capNotices =
    (data.errlist ?? []).filter((e) => isCapNotice(e.msg || e.message)).length +
    (data.errors ?? []).filter((m) => isCapNotice(m)).length;
  if (capNotices) {
    log.info(`[transactions] SimpleFIN capped the requested date range (${capNotices} notice(s))`);
    data.errlist = data.errlist?.filter((e) => !isCapNotice(e.msg || e.message));
    data.errors = data.errors?.filter((m) => !isCapNotice(m));
  }
  const connectionIssues = deriveConnectionIssues(
    data.errlist?.length
      ? data.errlist.map((error) => {
          const message = error.msg || error.message || 'Bank connection needs attention';
          let connection = data.connections?.find(
            (connection) => connection.conn_id === error.conn_id
          );
          // Bridge occasionally returns an error ID different from its connection
          // rows. An unambiguous bank name still identifies the affected data.
          if (!connection) {
            const matches = data.connections?.filter((entry) => message.includes(entry.name)) ?? [];
            if (matches.length === 1) connection = matches[0];
          }
          const name = connection?.name;
          const dates = (data.accounts ?? [])
            .filter((account) => connection && account.conn_id === connection.conn_id)
            .map((account) => account['balance-date'] ?? 0);
          const latest = Math.max(0, ...dates);
          return {
            message: name && !message.includes(name) ? `${name}: ${message}` : message,
            code: error.code,
            connectionId: connection?.conn_id ?? error.conn_id,
            connectionName: name,
            lastBankDataAt: latest > 0 ? new Date(latest * 1000).toISOString() : undefined,
          };
        })
      : (data.errors ?? []).map((message) => ({ message }))
  );
  const errors = connectionIssues.map((issue) => issue.message);

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
    const message = `SimpleFIN returned no accounts${detail}`;
    throw new SimplefinFetchError(
      message,
      connectionIssues.length ? connectionIssues : [{ id: 'sync', kind: 'sync', message }]
    );
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

  let transactions: BankTransaction[] | undefined;
  if (withTransactions) {
    transactions = [];
    let skipped = 0;
    for (const acct of accounts) {
      for (const t of acct.transactions ?? []) {
        const amount = parseFloat(t.amount);
        // Pending rows carry posted=0 and can still change or vanish.
        if (t.pending || !t.id || !(t.posted > 0) || !Number.isFinite(amount)) {
          skipped++;
          continue;
        }
        transactions.push({
          id: String(t.id),
          accountId: acct.id,
          posted: unixToYmd(t.posted),
          amount,
          description: (t.description ?? '').trim(),
          ...(t.payee?.trim() ? { payee: t.payee.trim() } : {}),
          ...(t.memo?.trim() ? { memo: t.memo.trim() } : {}),
          ...(t.transacted_at && t.transacted_at > 0
            ? { transactedAt: unixToYmd(t.transacted_at) }
            : {}),
        });
      }
    }
    log.info(
      `[transactions] fetched ${transactions.length} posted transaction(s) across ` +
        `${accounts.length} accounts since ${unixToYmd(opts.transactionsSince!)}; skipped ${skipped} pending or malformed`
    );
  }

  return {
    accounts: mapped,
    lastUpdated: new Date().toISOString(),
    connectionErrors: errors,
    connectionIssues,
    ...(transactions ? { transactions } : {}),
  };
}
