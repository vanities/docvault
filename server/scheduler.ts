// Scheduler — built-in recurring tasks (portfolio snapshots + Dropbox sync).
// Extracted from server/index.ts.

import { promises as fs } from 'fs';
import path from 'path';
import {
  DATA_DIR,
  CRYPTO_CACHE_FILE,
  BROKER_CACHE_FILE,
  SIMPLEFIN_CACHE_FILE,
  RCLONE_CONFIG_PATH,
  SYNC_SCRIPT_PATH,
  SYNC_SCRIPT_DATA_PATH,
  SCHEDULE_STATUS_FILE,
  loadSettings,
  saveSettings,
  loadGoldData,
  loadPropertyData,
  savePropertyData,
  fetchMetalSpotPrices,
  saveSnapshot,
  monthsBetween,
} from './data.js';
import type { Settings } from './data.js';
import { fetchAllBalances } from './crypto.js';
import { buildPortfolio, fetchAllSnapTradeHoldings, type BrokerAccount } from './brokers.js';
import {
  fetchBalances as fetchSimplefinBalances,
  type SimplefinBalanceCache,
} from './simplefin.js';
import { refreshAllQuantData } from './routes/quant.js';
import { refreshPolitics } from './politics/refresh.js';
import {
  startEdition,
  editionExistsForDate,
  weeklyEditionExistsForWeek,
  type EditionType,
} from './daily-news-store.js';
import { dailyNewsPlan, msUntilNextLocalHour } from './daily-news-schedule.js';
import { getConfiguredTimezone, zonedYMD } from './tz.js';
import { createLogger } from './logger.js';

// Scheduler — built-in cron-like recurring tasks
// ============================================================================

const logScheduler = createLogger('Scheduler');
const logSnapshots = createLogger('Snapshots');
const logSnapTrade = createLogger('SnapTrade');
const logSimpleFIN = createLogger('SimpleFIN');
const logDropbox = createLogger('Dropbox');
const logGold = createLogger('Gold');
const logQuant = createLogger('Quant');
const logPolitics = createLogger('Politics');

export const DEFAULT_SNAPSHOT_INTERVAL = 1440; // 24 hours in minutes
export const DEFAULT_DROPBOX_SYNC_INTERVAL = 15; // 15 minutes
export const DEFAULT_QUANT_REFRESH_INTERVAL = 1440; // 24 hours in minutes
export const DEFAULT_POLITICS_REFRESH_INTERVAL = 1440; // 24 hours in minutes
let snapshotTimer: ReturnType<typeof setInterval> | null = null;
let dropboxSyncTimer: ReturnType<typeof setInterval> | null = null;
let quantRefreshTimer: ReturnType<typeof setInterval> | null = null;
let politicsRefreshTimer: ReturnType<typeof setInterval> | null = null;
// Daily News fires at the configured local hour via a self-rescheduling
// timeout (not an interval) so the send minute doesn't drift with deploys.
let dailyNewsTimer: ReturnType<typeof setTimeout> | null = null;

// ============================================================================
// Schedule status tracking — persists last-ran timestamps per task to
// .docvault-schedule-status.json so the UI can surface staleness + errors.
// ============================================================================

export type ScheduleTaskName =
  | 'snapshot'
  | 'dropboxSync'
  | 'quantRefresh'
  | 'politicsRefresh'
  | 'dailyNewsRefresh'
  | 'encryptedBackup';

export interface ScheduleTaskStatus {
  lastRanAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastDurationMs: number | null;
  running: boolean;
}

export type ScheduleStatusMap = Record<ScheduleTaskName, ScheduleTaskStatus>;

function emptyStatus(): ScheduleTaskStatus {
  return {
    lastRanAt: null,
    lastSuccessAt: null,
    lastError: null,
    lastDurationMs: null,
    running: false,
  };
}

export async function loadScheduleStatus(): Promise<ScheduleStatusMap> {
  const base: ScheduleStatusMap = {
    snapshot: emptyStatus(),
    dropboxSync: emptyStatus(),
    quantRefresh: emptyStatus(),
    politicsRefresh: emptyStatus(),
    dailyNewsRefresh: emptyStatus(),
    encryptedBackup: emptyStatus(),
  };
  try {
    const raw = await fs.readFile(SCHEDULE_STATUS_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<ScheduleStatusMap>;
    return { ...base, ...parsed };
  } catch {
    return base;
  }
}

async function writeScheduleStatus(status: ScheduleStatusMap): Promise<void> {
  try {
    await fs.writeFile(SCHEDULE_STATUS_FILE, JSON.stringify(status, null, 2));
  } catch {
    /* non-fatal — status is best-effort */
  }
}

async function updateScheduleStatus(
  name: ScheduleTaskName,
  patch: Partial<ScheduleTaskStatus>
): Promise<void> {
  const status = await loadScheduleStatus();
  status[name] = { ...status[name], ...patch };
  await writeScheduleStatus(status);
}

/** Wraps a scheduled task, recording run timestamps + any thrown error. */
async function trackRun(name: ScheduleTaskName, fn: () => Promise<void>): Promise<void> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  await updateScheduleStatus(name, { lastRanAt: startedAt, running: true });
  try {
    await fn();
    await updateScheduleStatus(name, {
      lastSuccessAt: new Date().toISOString(),
      lastError: null,
      lastDurationMs: Date.now() - t0,
      running: false,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateScheduleStatus(name, {
      lastError: msg,
      lastDurationMs: Date.now() - t0,
      running: false,
    });
    throw err;
  }
}

export async function takePortfolioSnapshot(): Promise<void> {
  return trackRun('snapshot', takePortfolioSnapshotInner).catch((err) => {
    logSnapshots.error('Snapshot failed:', String(err));
  });
}

async function takePortfolioSnapshotInner(): Promise<void> {
  let settings = await loadSettings();

  // Refresh SnapTrade holdings before pricing (keeps positions current)
  if (settings.snaptrade?.userId) {
    try {
      const snapAccounts = await fetchAllSnapTradeHoldings(settings.snaptrade);
      if (!settings.brokers) settings.brokers = { accounts: [] };
      const manualAccounts = settings.brokers.accounts.filter((a) => !a.id.startsWith('snap-'));
      settings.brokers.accounts = [...manualAccounts, ...snapAccounts];
      await saveSettings(settings);
      settings = await loadSettings(); // re-read after save
      logSnapTrade.info(`SnapTrade holdings refreshed (${snapAccounts.length} accounts)`);
    } catch (err) {
      logSnapTrade.warn('SnapTrade refresh failed, using existing holdings:', String(err));
    }
  }

  // Fetch live broker prices (Yahoo Finance) and update cache
  const accounts: BrokerAccount[] = settings.brokers?.accounts || [];
  const brokerPortfolio = accounts.length > 0 ? await buildPortfolio(accounts) : null;
  if (brokerPortfolio) {
    try {
      await fs.writeFile(BROKER_CACHE_FILE, JSON.stringify(brokerPortfolio, null, 2));
      logSnapshots.info('Broker cache updated');
    } catch {
      // Non-critical — snapshot still saves
    }
  }

  // Fetch live crypto balances from exchanges/wallets and update cache
  let cryptoValue = 0;
  const cryptoConfig = settings.crypto || { exchanges: [], wallets: [] };
  const hasCryptoSources =
    cryptoConfig.exchanges.length > 0 ||
    cryptoConfig.wallets.length > 0 ||
    (cryptoConfig.manualHoldings?.length ?? 0) > 0;
  if (hasCryptoSources) {
    try {
      const cryptoPortfolio = await fetchAllBalances(
        cryptoConfig.exchanges,
        cryptoConfig.wallets,
        cryptoConfig.etherscanKey,
        cryptoConfig.manualHoldings
      );
      cryptoValue = cryptoPortfolio.totalUsdValue || 0;
      await fs.writeFile(CRYPTO_CACHE_FILE, JSON.stringify(cryptoPortfolio, null, 2));
      logSnapshots.info('Crypto cache updated');
    } catch (err) {
      logSnapshots.warn('Crypto fetch failed, using cached data:', String(err));
      // Fall back to cached data if live fetch fails
      try {
        const cryptoData = await fs.readFile(CRYPTO_CACHE_FILE, 'utf-8');
        const cached = JSON.parse(cryptoData);
        cryptoValue = cached.totalUsdValue || 0;
      } catch {
        // No cache either
      }
    }
  } else {
    // No sources configured — read cache if it exists (manual import, etc.)
    try {
      const cryptoData = await fs.readFile(CRYPTO_CACHE_FILE, 'utf-8');
      const cached = JSON.parse(cryptoData);
      cryptoValue = cached.totalUsdValue || 0;
    } catch {
      // No crypto data
    }
  }

  // Fetch live bank balances from SimpleFIN and update cache
  let bankValue = 0;
  if (settings.simplefin?.accessUrl) {
    try {
      const bankAccounts = await fetchSimplefinBalances(settings.simplefin);
      bankValue = bankAccounts.reduce((sum, a) => sum + (a.balance || 0), 0);
      const cache: SimplefinBalanceCache = {
        accounts: bankAccounts,
        lastUpdated: new Date().toISOString(),
      };
      await fs.writeFile(SIMPLEFIN_CACHE_FILE, JSON.stringify(cache, null, 2));
      logSimpleFIN.info('SimpleFIN bank cache updated');
    } catch (err) {
      logSimpleFIN.warn('SimpleFIN fetch failed, using cached data:', String(err));
      try {
        const bankData = await fs.readFile(SIMPLEFIN_CACHE_FILE, 'utf-8');
        const cached: SimplefinBalanceCache = JSON.parse(bankData);
        bankValue = cached.accounts.reduce((sum, a) => sum + (a.balance || 0), 0);
      } catch {
        // No cache
      }
    }
  } else {
    // No SimpleFIN configured — read cache if it exists
    try {
      const bankData = await fs.readFile(SIMPLEFIN_CACHE_FILE, 'utf-8');
      const cached: SimplefinBalanceCache = JSON.parse(bankData);
      bankValue = cached.accounts.reduce((sum, a) => sum + (a.balance || 0), 0);
    } catch {
      // No bank data
    }
  }

  // Compute gold/precious metals value from entries + spot prices
  let goldValue = 0;
  try {
    const goldData = await loadGoldData();
    if (goldData.entries.length > 0) {
      const spotPrices = await fetchMetalSpotPrices();
      for (const entry of goldData.entries) {
        const spotPrice = spotPrices[entry.metal] || 0;
        // Size denomination = pure metal content (e.g. "1 oz Eagle" = 1 oz pure gold)
        goldValue += entry.weightOz * entry.quantity * spotPrice;
      }
    }
  } catch (err) {
    logGold.warn('Gold value calc failed:', String(err));
  }

  // Compute property value + apply monthly mortgage amortization
  let propertyValue = 0;
  try {
    const propertyData = await loadPropertyData();
    const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
    let propertyChanged = false;

    for (const entry of propertyData.entries) {
      // Apply monthly amortization if mortgage exists and month has changed
      if (entry.mortgage && entry.mortgage.balance > 0 && entry.mortgage.monthlyPayment > 0) {
        const lastAmort = entry.lastAmortizationDate || '';
        if (lastAmort < currentMonth) {
          // Calculate how many months to apply (catch up if multiple missed)
          const monthsToApply = lastAmort ? monthsBetween(lastAmort, currentMonth) : 1; // first time: apply 1 month

          for (let i = 0; i < monthsToApply && entry.mortgage.balance > 0; i++) {
            const monthlyRate = entry.mortgage.rate / 12;
            const interestPayment = entry.mortgage.balance * monthlyRate;
            const principalPayment = Math.min(
              entry.mortgage.monthlyPayment - interestPayment,
              entry.mortgage.balance
            );
            entry.mortgage.balance = Math.max(
              0,
              +(entry.mortgage.balance - principalPayment).toFixed(2)
            );
          }

          entry.lastAmortizationDate = currentMonth;
          propertyChanged = true;
          logSnapshots.info(
            `Amortization applied for "${entry.name}": ${monthsToApply} month(s), new balance: $${entry.mortgage.balance}`
          );
        }
      }

      const equity = entry.currentValue - (entry.mortgage?.balance || 0);
      propertyValue += equity;
    }

    if (propertyChanged) {
      await savePropertyData(propertyData);
    }
  } catch (err) {
    logSnapshots.warn('Property value calc failed:', String(err));
  }

  const brokerValue = brokerPortfolio?.totalValue || 0;
  const today = zonedYMD(new Date(), getConfiguredTimezone(settings));

  await saveSnapshot({
    date: today,
    totalValue: cryptoValue + brokerValue + bankValue + goldValue + propertyValue,
    cryptoValue,
    brokerValue,
    bankValue,
    goldValue,
    propertyValue,
    shortTermGains: brokerPortfolio?.shortTermGains || 0,
    longTermGains: brokerPortfolio?.longTermGains || 0,
  });
  logSnapshots.info(`Portfolio snapshot saved for ${today}`);
}

async function createEncryptedConfigBackup(password: string): Promise<string | null> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  await updateScheduleStatus('encryptedBackup', { lastRanAt: startedAt, running: true });
  try {
    const { createBackupBundle, collectBackupFiles } = await import('./backup.js');

    // Refuse to overwrite the existing backup with an empty one — a missing
    // data dir should surface as an error, not silently clobber the prior
    // good backup.
    const files = await collectBackupFiles();
    if (Object.keys(files).length === 0) {
      await updateScheduleStatus('encryptedBackup', {
        lastError: 'No .docvault-*.json files found',
        lastDurationMs: Date.now() - t0,
        running: false,
      });
      return null;
    }

    const packed = await createBackupBundle(password);
    const backupPath = path.join(DATA_DIR, '.docvault-config-backup.enc');
    await fs.writeFile(backupPath, packed);
    logScheduler.info(
      `Encrypted config backup written (${Object.keys(files).length} files, ${packed.length} bytes)`
    );
    await updateScheduleStatus('encryptedBackup', {
      lastSuccessAt: new Date().toISOString(),
      lastError: null,
      lastDurationMs: Date.now() - t0,
      running: false,
    });
    return backupPath;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logScheduler.error('Encrypted config backup failed:', msg);
    await updateScheduleStatus('encryptedBackup', {
      lastError: msg,
      lastDurationMs: Date.now() - t0,
      running: false,
    });
    return null;
  }
}

/** Daily quant refresh — re-fetches Shiller SP500 + BTC-USD, writes to the
 *  quant cache, and appends a snapshot row to the history file so we can
 *  plot trend sparklines. Idempotent per day. */
export async function runQuantRefresh(): Promise<void> {
  return trackRun('quantRefresh', async () => {
    logQuant.info('Starting quant data refresh...');
    const result = await refreshAllQuantData();
    if (result.errors.length > 0) {
      logQuant.warn(`Refresh had errors: ${result.errors.join('; ')}`);
      throw new Error(result.errors.join('; '));
    }
    logQuant.info(
      `Quant refresh complete (btc=${result.btc ? 'ok' : 'fail'}, spxCycle=${result.spxCycle ? 'ok' : 'fail'})`
    );
  }).catch((err) => {
    logQuant.error('Quant refresh failed:', String(err));
  });
}

/** Daily politics refresh — forward-only ingest of recent bills, executive
 *  actions, and (later phases) politician trades into the politics feed cache.
 *  A missing Congress key or a single dead source is a soft error: the task only
 *  fails if EVERY source failed, so a partial feed still counts as success. */
export async function runPoliticsRefresh(): Promise<void> {
  return trackRun('politicsRefresh', async () => {
    logPolitics.info('Starting politics feed refresh...');
    const result = await refreshPolitics();
    if (result.errors.length > 0) {
      const anyOk = result.results.some((r) => r.ok);
      if (!anyOk) throw new Error(result.errors.join('; '));
      logPolitics.warn(`Politics refresh had soft errors: ${result.errors.join('; ')}`);
    }
    logPolitics.info(
      `Politics refresh complete (bills=${result.counts.bills} exec=${result.counts.executiveActions} trades=${result.counts.trades})`
    );
  }).catch((err) => {
    logPolitics.error('Politics refresh failed:', String(err));
  });
}

/**
 * Daily News tick — runs hourly but generates at most ONE edition per local
 * day, only once the clock passes the configured hour (see dailyNewsPlan). On
 * the configured weekday (and if none was made in the last 6 days) it produces
 * a weekly deep-dive; otherwise a daily digest. A silent no-op when not due —
 * trackRun only fires when an edition is actually kicked off, so the status
 * file isn't rewritten every hour.
 */
export async function runDailyNewsTick(): Promise<void> {
  try {
    const settings = await loadSettings();
    const plan = dailyNewsPlan(new Date(), settings.schedules, getConfiguredTimezone(settings));
    if (!plan) return;
    if (await editionExistsForDate(plan.today)) return;
    const wantWeekly = plan.isWeeklyDay && !(await weeklyEditionExistsForWeek(plan.weekStart));
    const editionType: EditionType = wantWeekly ? 'weekly' : 'daily';

    await trackRun('dailyNewsRefresh', async () => {
      logScheduler.info(`Daily News due — generating ${editionType} edition for ${plan.today}`);
      await startEdition(editionType, plan.today);
    });
  } catch (err) {
    logScheduler.error('Daily News tick failed:', String(err));
  }
}

export async function runDropboxSync(): Promise<void> {
  return trackRun('dropboxSync', async () => {
    // Create encrypted config backup before syncing (if password is configured)
    // The .enc file is written to DATA_DIR so the NAS cron script can rclone it
    const settings = await loadSettings();
    const backupPw = settings.schedules?.backupPassword;
    if (backupPw) {
      await createEncryptedConfigBackup(backupPw);
    }

    // Find the sync script: scripts/ dir first, then data dir
    let syncScript: string | null = null;
    for (const candidate of [SYNC_SCRIPT_PATH, SYNC_SCRIPT_DATA_PATH]) {
      const exists = await fs
        .access(candidate)
        .then(() => true)
        .catch(() => false);
      if (exists) {
        syncScript = candidate;
        break;
      }
    }

    if (syncScript) {
      const proc = Bun.spawn(['bash', syncScript], {
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, RCLONE_CONFIG: RCLONE_CONFIG_PATH },
      });
      await proc.exited;
      const stderr = await new Response(proc.stderr).text();
      if (proc.exitCode !== 0) {
        logDropbox.error(`Dropbox sync failed (exit: ${proc.exitCode}):`, stderr);
        throw new Error(`rclone exit ${proc.exitCode}: ${stderr.trim()}`);
      }
      logDropbox.info('Dropbox sync completed');
    } else {
      logDropbox.info('Dropbox sync skipped — no sync script found');
    }
  }).catch((err) => {
    logDropbox.error('Dropbox sync failed:', String(err));
  });
}

export function startScheduler(schedules: Settings['schedules'] = {}): void {
  // Clear existing timers
  if (snapshotTimer) clearInterval(snapshotTimer);
  if (dropboxSyncTimer) clearInterval(dropboxSyncTimer);
  if (quantRefreshTimer) clearInterval(quantRefreshTimer);
  if (politicsRefreshTimer) clearInterval(politicsRefreshTimer);
  if (dailyNewsTimer) clearTimeout(dailyNewsTimer);
  snapshotTimer = null;
  dropboxSyncTimer = null;
  quantRefreshTimer = null;
  politicsRefreshTimer = null;
  dailyNewsTimer = null;

  const snapshotEnabled = schedules?.snapshotEnabled !== false; // default on
  const snapshotMinutes = schedules?.snapshotIntervalMinutes || DEFAULT_SNAPSHOT_INTERVAL;

  const dropboxEnabled = schedules?.dropboxSyncEnabled !== false; // default on
  const dropboxMinutes = schedules?.dropboxSyncIntervalMinutes || DEFAULT_DROPBOX_SYNC_INTERVAL;

  const quantEnabled = schedules?.quantRefreshEnabled !== false; // default on
  const quantMinutes = schedules?.quantRefreshIntervalMinutes || DEFAULT_QUANT_REFRESH_INTERVAL;

  const politicsEnabled = schedules?.politicsRefreshEnabled !== false; // default on
  const politicsMinutes =
    schedules?.politicsRefreshIntervalMinutes || DEFAULT_POLITICS_REFRESH_INTERVAL;

  if (snapshotEnabled) {
    snapshotTimer = setInterval(takePortfolioSnapshot, snapshotMinutes * 60 * 1000);
    logScheduler.info(`Portfolio snapshot: every ${snapshotMinutes}m`);
  } else {
    logScheduler.info('Portfolio snapshot: disabled');
  }

  if (dropboxEnabled) {
    dropboxSyncTimer = setInterval(runDropboxSync, dropboxMinutes * 60 * 1000);
    logScheduler.info(`Dropbox sync: every ${dropboxMinutes}m`);
  } else {
    logScheduler.info('Dropbox sync: disabled');
  }

  if (quantEnabled) {
    quantRefreshTimer = setInterval(runQuantRefresh, quantMinutes * 60 * 1000);
    logScheduler.info(`Quant refresh: every ${quantMinutes}m`);
  } else {
    logScheduler.info('Quant refresh: disabled');
  }

  if (politicsEnabled) {
    politicsRefreshTimer = setInterval(runPoliticsRefresh, politicsMinutes * 60 * 1000);
    logScheduler.info(`Politics refresh: every ${politicsMinutes}m`);
  } else {
    logScheduler.info('Politics refresh: disabled');
  }

  // Daily News is OPT-IN (default off). Fires AT the configured local hour
  // (self-rescheduling timeout, recomputed from Intl each time so deploys
  // don't drift the send minute and DST self-corrects), plus an immediate
  // catch-up tick — both safe because the store dedups once per local day.
  if (schedules?.dailyNewsEnabled === true) {
    const hour = schedules.dailyNewsHour ?? 7;
    const armNextDailyNews = (): void => {
      void loadSettings().then((s) => {
        const tz = getConfiguredTimezone(s);
        const delayMs = msUntilNextLocalHour(new Date(), hour, tz);
        dailyNewsTimer = setTimeout(() => {
          void runDailyNewsTick().finally(armNextDailyNews);
        }, delayMs);
        logScheduler.info(
          `Daily News: next check in ${Math.round(delayMs / 60000)}m ` +
            `(publishes ${String(hour).padStart(2, '0')}:00 ${tz}, weekly day ${schedules.dailyNewsWeeklyDay ?? 0})`
        );
      });
    };
    // Catch-up: a restart after the publish hour still gets today's edition.
    void runDailyNewsTick().finally(armNextDailyNews);
  } else {
    logScheduler.info('Daily News: disabled');
  }
}

// Initialize scheduler on startup — take an immediate snapshot then start intervals
loadSettings()
  .then(async (settings) => {
    startScheduler(settings.schedules);
    // Run first snapshot immediately so we don't wait 24h after container start
    logScheduler.info('Taking initial snapshot on startup...');
    await takePortfolioSnapshot();
    // Warm the quant cache + seed the snapshot file on first boot
    if (settings.schedules?.quantRefreshEnabled !== false) {
      logScheduler.info('Taking initial quant refresh on startup...');
      void runQuantRefresh();
    }
    if (settings.schedules?.politicsRefreshEnabled !== false) {
      logScheduler.info('Taking initial politics refresh on startup...');
      void runPoliticsRefresh();
    }
    // Daily News opt-in: the tick is a no-op unless an edition is due, so this
    // safely catches "server was down at the publish hour, came up later".
    if (settings.schedules?.dailyNewsEnabled === true) {
      logScheduler.info('Checking Daily News on startup...');
      void runDailyNewsTick();
    }
    // Run an initial Dropbox sync on boot so the encrypted backup stays fresh
    // even when container restarts happen more often than the sync interval.
    if (settings.schedules?.dropboxSyncEnabled !== false) {
      logScheduler.info('Running initial Dropbox sync on startup...');
      void runDropboxSync();
    }
  })
  .catch(() => {
    startScheduler();
  });
