// Scheduler — built-in recurring tasks (portfolio snapshots + Dropbox sync).
// Extracted from server/index.ts.

import { promises as fs } from 'fs';
import path from 'path';
import {
  DATA_DIR,
  CRYPTO_CACHE_FILE,
  BROKER_CACHE_FILE,
  SIMPLEFIN_CACHE_FILE,
  loadSettings,
  saveSettings,
  loadGoldData,
  loadPropertyData,
  savePropertyData,
  fetchMetalSpotPrices,
  saveSnapshot,
  monthsBetween,
} from './data.js';
import type { Settings, PortfolioSnapshot } from './data.js';
import { fetchAllBalances } from './crypto.js';
import { buildPortfolio, fetchAllSnapTradeHoldings } from './brokers.js';
import { fetchBalances as fetchSimplefinBalances } from './simplefin.js';
import { refreshAllQuantData } from './routes/quant.js';
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

const DEFAULT_SNAPSHOT_INTERVAL = 1440; // 24 hours in minutes
const DEFAULT_DROPBOX_SYNC_INTERVAL = 15; // 15 minutes
const DEFAULT_QUANT_REFRESH_INTERVAL = 1440; // 24 hours in minutes
const SYNC_SCRIPT_PATH = path.join(__dirname, '..', 'scripts', 'sync-to-dropbox.sh');
const SYNC_SCRIPT_DATA_PATH = path.join(DATA_DIR, 'sync-to-dropbox.sh');
const RCLONE_CONFIG_PATH = path.join(DATA_DIR, '.rclone.conf');

let snapshotTimer: ReturnType<typeof setInterval> | null = null;
let dropboxSyncTimer: ReturnType<typeof setInterval> | null = null;
let quantRefreshTimer: ReturnType<typeof setInterval> | null = null;

export async function takePortfolioSnapshot(): Promise<void> {
  try {
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
    const hasCryptoSources = cryptoConfig.exchanges.length > 0 || cryptoConfig.wallets.length > 0;
    if (hasCryptoSources) {
      try {
        const cryptoPortfolio = await fetchAllBalances(
          cryptoConfig.exchanges,
          cryptoConfig.wallets,
          cryptoConfig.etherscanKey
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
    const today = new Date().toISOString().split('T')[0];

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
  } catch (err) {
    logSnapshots.error('Snapshot failed:', String(err));
  }
}

async function createEncryptedConfigBackup(password: string): Promise<string | null> {
  try {
    // Collect all .docvault-*.json config files
    const filesToBackup: Record<string, string> = {};
    const files = await fs.readdir(DATA_DIR);
    for (const name of files) {
      if (name.startsWith('.docvault-') && name.endsWith('.json')) {
        try {
          filesToBackup[name] = await fs.readFile(path.join(DATA_DIR, name), 'utf-8');
        } catch {
          /* skip unreadable */
        }
      }
    }

    if (Object.keys(filesToBackup).length === 0) return null;

    // Zip
    const zipData: Record<string, Uint8Array> = {};
    for (const [name, content] of Object.entries(filesToBackup)) {
      zipData[name] = new TextEncoder().encode(content);
    }
    const zipped = zipSync(zipData);

    // Encrypt with AES-256-GCM (same format as /api/backup)
    const { createCipheriv, randomBytes, scryptSync } = await import('crypto');
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = scryptSync(password, salt, 32);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(zipped), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Pack: salt(16) + iv(12) + authTag(16) + encrypted
    const packed = Buffer.concat([salt, iv, authTag, encrypted]);

    // Write to data dir as .docvault-config-backup.enc
    const backupPath = path.join(DATA_DIR, '.docvault-config-backup.enc');
    await fs.writeFile(backupPath, packed);
    logScheduler.info(
      `Encrypted config backup written (${Object.keys(filesToBackup).length} files, ${packed.length} bytes)`
    );
    return backupPath;
  } catch (err) {
    logScheduler.error('Encrypted config backup failed:', String(err));
    return null;
  }
}

/** Daily quant refresh — re-fetches Shiller SP500 + BTC-USD, writes to the
 *  quant cache, and appends a snapshot row to the history file so we can
 *  plot trend sparklines. Idempotent per day. */
export async function runQuantRefresh(): Promise<void> {
  try {
    logQuant.info('Starting quant data refresh...');
    const result = await refreshAllQuantData();
    if (result.errors.length > 0) {
      logQuant.warn(`Refresh had errors: ${result.errors.join('; ')}`);
    }
    logQuant.info(
      `Quant refresh complete (btc=${result.btc ? 'ok' : 'fail'}, spxCycle=${result.spxCycle ? 'ok' : 'fail'})`
    );
  } catch (err) {
    logQuant.error('Quant refresh failed:', String(err));
  }
}

export async function runDropboxSync(): Promise<void> {
  try {
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
      } else {
        logDropbox.info('Dropbox sync completed');
      }
    } else {
      logDropbox.info('Dropbox sync skipped — no sync script found');
    }
  } catch (err) {
    logDropbox.error('Dropbox sync failed:', String(err));
  }
}

export function startScheduler(schedules: Settings['schedules'] = {}): void {
  // Clear existing timers
  if (snapshotTimer) clearInterval(snapshotTimer);
  if (dropboxSyncTimer) clearInterval(dropboxSyncTimer);
  if (quantRefreshTimer) clearInterval(quantRefreshTimer);
  snapshotTimer = null;
  dropboxSyncTimer = null;
  quantRefreshTimer = null;

  const snapshotEnabled = schedules?.snapshotEnabled !== false; // default on
  const snapshotMinutes = schedules?.snapshotIntervalMinutes || DEFAULT_SNAPSHOT_INTERVAL;

  const dropboxEnabled = schedules?.dropboxSyncEnabled !== false; // default on
  const dropboxMinutes = schedules?.dropboxSyncIntervalMinutes || DEFAULT_DROPBOX_SYNC_INTERVAL;

  // Quant refresh defaults to on (no setting yet — always daily).
  const quantMinutes = DEFAULT_QUANT_REFRESH_INTERVAL;

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

  quantRefreshTimer = setInterval(runQuantRefresh, quantMinutes * 60 * 1000);
  logScheduler.info(`Quant refresh: every ${quantMinutes}m`);
}

// Initialize scheduler on startup — take an immediate snapshot then start intervals
loadSettings()
  .then(async (settings) => {
    startScheduler(settings.schedules);
    // Run first snapshot immediately so we don't wait 24h after container start
    logScheduler.info('Taking initial snapshot on startup...');
    await takePortfolioSnapshot();
    // Warm the quant cache + seed the snapshot file on first boot
    logScheduler.info('Taking initial quant refresh on startup...');
    void runQuantRefresh();
  })
  .catch(() => {
    startScheduler();
  });
