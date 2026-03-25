import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseWithAI } from './parsers/ai.js';
import { zipSync } from 'fflate';
import { withAILimit } from './aiLimiter.js';
import { fetchAllBalances, fetchSourceBalance, fetchCryptoGains } from './crypto.js';
import {
  buildPortfolio,
  registerSnapTradeUser,
  getSnapTradeConnectUrl,
  fetchAllSnapTradeHoldings,
  deleteSnapTradeUser,
  initSnapTrade,
  extractSnapTradeError,
  type BrokerAccount,
  type SnapTradeConfig,
} from './brokers.js';
import {
  claimSetupToken,
  fetchBalances as fetchSimplefinBalances,
  type SimplefinConfig,
  type SimplefinBalanceCache,
} from './simplefin.js';

// Shared data layer — all types, constants, loaders, and utilities
import {
  DATA_DIR,
  CONFIG_PATH,
  SETTINGS_PATH,
  PORT,
  DEFAULT_MODEL,
  PARSED_DATA_FILE,
  REMINDERS_FILE,
  METADATA_FILE,
  ASSETS_FILE,
  CONTRIBUTIONS_FILE,
  TODOS_FILE,
  SALES_FILE,
  MILEAGE_FILE,
  GOLD_FILE,
  PROPERTY_FILE,
  CRYPTO_CACHE_FILE,
  BROKER_CACHE_FILE,
  SIMPLEFIN_CACHE_FILE,
  GOLD_RECEIPTS_DIR,
  AUTH_ENABLED,
  AUTH_USERNAME,
  AUTH_PASSWORD,
  PUBLIC_ROUTES,
  loadConfig,
  saveConfig,
  loadSettings,
  saveSettings,
  loadParsedData,
  saveParsedData,
  setParsedDataForFile,
  loadMetadata,
  saveMetadata,
  loadReminders,
  saveReminders,
  loadAssets,
  saveAssets,
  loadContributions,
  saveContributions,
  loadTodos,
  saveTodos,
  loadSalesData,
  saveSalesData,
  loadMileageData,
  saveMileageData,
  loadGoldData,
  saveGoldData,
  loadPropertyData,
  savePropertyData,
  loadSnapshots,
  saveSnapshot,
  fetchMetalSpotPrices,
  getMimeType,
  scanDirectory,
  ensureDir,
  jsonResponse,
  corsHeaders,
  getEntityPath,
  monthsBetween,
  createSession,
  isValidSession,
  getSessionToken,
  sessionCookie,
  isAuthenticated,
  snapshotFileForYear,
  loadSnapshotsForYear,
} from './data.js';
import type {
  EntityConfig,
  Config,
  Settings,
  FileInfo,
  ParsedData,
  DocMetadata,
  Reminder,
  AssetsData,
  ContributionsData,
  Contribution401k,
  Todo,
  SalesData,
  SaleProduct,
  Sale,
  MileageData,
  Vehicle,
  MileageEntry,
  SavedAddress,
  GoldData,
  GoldEntry,
  PropertyData,
  PropertyEntry,
  PropertyAddress,
  PropertyMortgage,
  PortfolioSnapshot,
  BusinessAsset,
  CryptoExchangeConfig,
  CryptoWalletConfig,
} from './data.js';

// Re-export for parsers/base.ts which imports from ./index.js
export { getClaudeModel, getAnthropicKey } from './data.js';

// Route modules
import { handleFinancialSnapshotRoutes } from './routes/financial-snapshot.js';
import { handleDownloadRoutes } from './routes/downloads.js';
import { handleCryptoRoutes } from './routes/crypto.js';
import { handleBrokersRoutes } from './routes/brokers.js';
import { handleSalesRoutes } from './routes/sales.js';
import { handleMileageRoutes } from './routes/mileage.js';
import { handleGoldRoutes } from './routes/gold.js';
import { handlePropertyRoutes } from './routes/property.js';
import { handleMiscRoutes } from './routes/misc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));


// Request Handler
// ============================================================================

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pathname = url.pathname;

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  // --- Auth: login endpoint ---
  if (pathname === '/api/login' && req.method === 'POST') {
    if (!AUTH_ENABLED) {
      return jsonResponse({ ok: true, message: 'Auth not enabled' });
    }
    const body = await req.json();
    const { username, password } = body;
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

  // --- Auth: gate API routes ---
  if (AUTH_ENABLED && pathname.startsWith('/api/') && !PUBLIC_ROUTES.has(pathname)) {
    if (!isAuthenticated(req)) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }
  }

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

    return jsonResponse({
      hasAnthropicKey: hasSettingsKey || hasEnvKey,
      keySource,
      keyHint,
      claudeModel: settings.claudeModel || DEFAULT_MODEL,
      hasGeoapifyKey: !!settings.geoapifyApiKey,
      geoapifyKeyHint: settings.geoapifyApiKey ? settings.geoapifyApiKey.slice(-4) : undefined,
    });
  }

  // POST /api/settings
  if (pathname === '/api/settings' && req.method === 'POST') {
    const body = await req.json();
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

    await saveSettings(settings);
    return jsonResponse({ ok: true });
  }

  // =========================================================================
  // Encrypted Backup / Restore
  // =========================================================================

  // GET /api/backup/latest — download the latest auto-generated encrypted backup
  if (pathname === '/api/backup/latest' && req.method === 'GET') {
    const backupPath = path.join(DATA_DIR, '.docvault-config-backup.enc');
    try {
      const data = await fs.readFile(backupPath);
      const stat = await fs.stat(backupPath);
      const dateStr = new Date(stat.mtime).toISOString().split('T')[0];
      return new Response(data, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="docvault-backup-${dateStr}.enc"`,
        },
      });
    } catch {
      return jsonResponse(
        {
          error:
            'No auto-backup found. Set a backup password in Schedules and wait for the next sync cycle.',
        },
        404
      );
    }
  }

  // POST /api/backup — create encrypted backup of all data
  // Body: { password: "..." }
  // Returns: binary blob (AES-256-GCM encrypted zip)
  if (pathname === '/api/backup' && req.method === 'POST') {
    try {
      const { password } = await req.json();
      if (!password || typeof password !== 'string' || password.length < 4) {
        return jsonResponse({ error: 'Password must be at least 4 characters' }, 400);
      }

      // Collect all .docvault-* files from the data dir
      const filesToBackup: Record<string, string> = {};

      try {
        const files = await fs.readdir(DATA_DIR);
        for (const name of files) {
          if (name.startsWith('.docvault-') && name.endsWith('.json')) {
            try {
              filesToBackup[name] = await fs.readFile(path.join(DATA_DIR, name), 'utf-8');
            } catch {
              /* skip unreadable files */
            }
          }
        }
      } catch {
        /* data dir not readable */
      }

      // Create zip
      const zipData: Record<string, Uint8Array> = {};
      for (const [name, content] of Object.entries(filesToBackup)) {
        zipData[name] = new TextEncoder().encode(content);
      }
      const zipped = zipSync(zipData);

      // Encrypt with AES-256-GCM
      const { createCipheriv, randomBytes, scryptSync } = await import('crypto');
      const salt = randomBytes(16);
      const iv = randomBytes(12);
      const key = scryptSync(password, salt, 32);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(zipped), cipher.final()]);
      const authTag = cipher.getAuthTag();

      // Pack: salt(16) + iv(12) + authTag(16) + encrypted
      const packed = Buffer.concat([salt, iv, authTag, encrypted]);

      return new Response(packed, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="docvault-backup-${new Date().toISOString().split('T')[0]}.enc"`,
        },
      });
    } catch (err) {
      return jsonResponse({ error: err instanceof Error ? err.message : 'Backup failed' }, 500);
    }
  }

  // POST /api/restore — restore from encrypted backup
  // Multipart form: password + file
  if (pathname === '/api/restore' && req.method === 'POST') {
    try {
      const formData = await req.formData();
      const password = formData.get('password') as string;
      const file = formData.get('file') as File;

      if (!password || !file) {
        return jsonResponse({ error: 'Missing password or file' }, 400);
      }

      const packed = Buffer.from(await file.arrayBuffer());
      if (packed.length < 44) {
        return jsonResponse({ error: 'Invalid backup file' }, 400);
      }

      // Unpack: salt(16) + iv(12) + authTag(16) + encrypted
      const salt = packed.subarray(0, 16);
      const iv = packed.subarray(16, 28);
      const authTag = packed.subarray(28, 44);
      const encrypted = packed.subarray(44);

      const { createDecipheriv, scryptSync } = await import('crypto');
      const key = scryptSync(password, salt, 32);
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);

      let decrypted: Buffer;
      try {
        decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      } catch {
        return jsonResponse({ error: 'Wrong password or corrupted backup' }, 400);
      }

      // Unzip
      const { unzipSync } = await import('fflate');
      const unzipped = unzipSync(new Uint8Array(decrypted));

      const restored: string[] = [];
      for (const [name, data] of Object.entries(unzipped)) {
        const content = new TextDecoder().decode(data);
        // Current format: .docvault-*.json files at root of zip
        if (name.startsWith('.docvault-') && name.endsWith('.json')) {
          await fs.writeFile(path.join(DATA_DIR, name), content);
          restored.push(name);
        }
        // Legacy format: settings.json / config.json / data/* from older backups
        else if (name === 'settings.json') {
          await fs.writeFile(SETTINGS_PATH, content);
          restored.push(name);
        } else if (name === 'config.json') {
          await fs.writeFile(CONFIG_PATH, content);
          restored.push(name);
        } else if (name.startsWith('data/')) {
          const fileName = name.replace('data/', '');
          await fs.writeFile(path.join(DATA_DIR, fileName), content);
          restored.push(fileName);
        }
      }

      return jsonResponse({ ok: true, restored });
    } catch (err) {
      return jsonResponse({ error: err instanceof Error ? err.message : 'Restore failed' }, 500);
    }
  }
  // crypto routes (extracted to routes/crypto.ts)
  const cryptoResponse = await handleCryptoRoutes(req, url, pathname);
  if (cryptoResponse) return cryptoResponse;
  // brokers routes (extracted to routes/brokers.ts)
  const brokersResponse = await handleBrokersRoutes(req, url, pathname);
  if (brokersResponse) return brokersResponse;


  // =========================================================================
  // Portfolio Snapshots
  // =========================================================================

  // GET /api/portfolio/snapshots — get historical snapshots (?year=2025 or ?year=2025,2026)
  if (pathname === '/api/portfolio/snapshots' && req.method === 'GET') {
    const yearParam = url.searchParams.get('year');
    const years = yearParam
      ? yearParam
          .split(',')
          .map((y) => parseInt(y))
          .filter((y) => !isNaN(y))
      : undefined; // undefined = current + previous year (default)
    const snapshots = await loadSnapshots(years);
    return jsonResponse(snapshots);
  }

  // POST /api/portfolio/snapshot — take a snapshot now (also runs on schedule)
  if (pathname === '/api/portfolio/snapshot' && req.method === 'POST') {
    try {
      await takePortfolioSnapshot();
      const currentYear = new Date().getFullYear();
      const snapshots = await loadSnapshotsForYear(currentYear);
      const snapshot = snapshots[snapshots.length - 1];
      return jsonResponse({ ok: true, snapshot });
    } catch (err) {
      return jsonResponse({ error: err instanceof Error ? err.message : 'Snapshot failed' }, 500);
    }
  }

  // =========================================================================
  // SnapTrade Endpoints
  // =========================================================================

  // GET /api/snaptrade/status — check if SnapTrade is configured
  if (pathname === '/api/snaptrade/status' && req.method === 'GET') {
    const settings = await loadSettings();
    const st = settings.snaptrade;
    return jsonResponse({
      configured: !!(st?.clientId && st?.consumerKey),
      registered: !!(st?.userId && st?.userSecret),
      clientId: st?.clientId ? st.clientId.slice(0, 8) + '...' : undefined,
    });
  }

  // POST /api/snaptrade/setup — save SnapTrade credentials and register user
  if (pathname === '/api/snaptrade/setup' && req.method === 'POST') {
    const body = await req.json();
    const { clientId, consumerKey } = body;
    if (!clientId || !consumerKey) {
      return jsonResponse({ error: 'Missing clientId or consumerKey' }, 400);
    }

    const settings = await loadSettings();
    settings.snaptrade = { clientId, consumerKey };

    try {
      const { userId, userSecret } = await registerSnapTradeUser(settings.snaptrade);
      settings.snaptrade.userId = userId;
      settings.snaptrade.userSecret = userSecret;
      await saveSettings(settings);
      return jsonResponse({ ok: true, userId });
    } catch (err) {
      await saveSettings(settings);
      const detail = extractSnapTradeError(err);
      console.error('[SnapTrade setup]', detail);
      return jsonResponse({ error: detail }, 500);
    }
  }

  // GET /api/snaptrade/connect — get connection portal URL
  if (pathname === '/api/snaptrade/connect' && req.method === 'GET') {
    const settings = await loadSettings();
    if (!settings.snaptrade?.clientId) {
      return jsonResponse({ error: 'SnapTrade not configured' }, 400);
    }

    try {
      const redirectUrl = await getSnapTradeConnectUrl(settings.snaptrade);
      return jsonResponse({ redirectUrl });
    } catch (err) {
      const detail = extractSnapTradeError(err);
      console.error('[SnapTrade connect]', detail);
      return jsonResponse({ error: detail }, 500);
    }
  }

  // POST /api/snaptrade/sync — fetch holdings from all SnapTrade-connected accounts
  if (pathname === '/api/snaptrade/sync' && req.method === 'POST') {
    const settings = await loadSettings();
    if (!settings.snaptrade?.userId) {
      return jsonResponse({ error: 'SnapTrade not registered' }, 400);
    }

    try {
      const snapAccounts = await fetchAllSnapTradeHoldings(settings.snaptrade);

      // Merge with existing manual accounts (replace snap- accounts, keep manual)
      if (!settings.brokers) settings.brokers = { accounts: [] };
      const manualAccounts = settings.brokers.accounts.filter((a) => !a.id.startsWith('snap-'));
      settings.brokers.accounts = [...manualAccounts, ...snapAccounts];
      await saveSettings(settings);

      return jsonResponse({ ok: true, synced: snapAccounts.length });
    } catch (err) {
      const detail = extractSnapTradeError(err);
      console.error('[SnapTrade sync]', detail);
      return jsonResponse({ error: detail }, 500);
    }
  }

  // DELETE /api/snaptrade — remove SnapTrade config and user
  if (pathname === '/api/snaptrade' && req.method === 'DELETE') {
    const settings = await loadSettings();
    if (settings.snaptrade?.clientId) {
      try {
        await deleteSnapTradeUser(settings.snaptrade);
      } catch {
        // Best effort cleanup
      }
    }
    delete settings.snaptrade;
    // Also remove snap- accounts
    if (settings.brokers) {
      settings.brokers.accounts = settings.brokers.accounts.filter(
        (a) => !a.id.startsWith('snap-')
      );
    }
    await saveSettings(settings);
    return jsonResponse({ ok: true });
  }

  // =========================================================================
  // =========================================================================
  // SimpleFIN Endpoints
  // =========================================================================

  // GET /api/simplefin/status — check if SimpleFIN is configured
  if (pathname === '/api/simplefin/status' && req.method === 'GET') {
    const settings = await loadSettings();
    return jsonResponse({
      configured: !!settings.simplefin?.accessUrl,
    });
  }

  // POST /api/simplefin/setup — claim a setup token and save access URL
  if (pathname === '/api/simplefin/setup' && req.method === 'POST') {
    const body = await req.json();
    const { setupToken } = body;
    if (!setupToken) {
      return jsonResponse({ error: 'Missing setupToken' }, 400);
    }
    try {
      const accessUrl = await claimSetupToken(setupToken);
      const settings = await loadSettings();
      settings.simplefin = { accessUrl };
      await saveSettings(settings);
      return jsonResponse({ ok: true });
    } catch (err) {
      console.error('[SimpleFIN setup]', err instanceof Error ? err.message : err);
      return jsonResponse({ error: err instanceof Error ? err.message : 'Setup failed' }, 500);
    }
  }

  // GET /api/simplefin/balances — fetch balances
  if (pathname === '/api/simplefin/balances' && req.method === 'GET') {
    const settings = await loadSettings();
    if (!settings.simplefin?.accessUrl) {
      return jsonResponse({ accounts: [], lastUpdated: '' });
    }

    const cached = url.searchParams.get('cached') === '1';
    if (cached) {
      try {
        const content = await fs.readFile(SIMPLEFIN_CACHE_FILE, 'utf-8');
        return jsonResponse(JSON.parse(content));
      } catch {
        return jsonResponse({ accounts: [], lastUpdated: '' });
      }
    }

    try {
      const accounts = await fetchSimplefinBalances(settings.simplefin);
      const cache: SimplefinBalanceCache = {
        accounts,
        lastUpdated: new Date().toISOString(),
      };
      await fs.writeFile(SIMPLEFIN_CACHE_FILE, JSON.stringify(cache, null, 2)).catch(() => {});
      return jsonResponse(cache);
    } catch (err) {
      console.error('[SimpleFIN balances]', err instanceof Error ? err.message : err);
      return jsonResponse(
        { error: err instanceof Error ? err.message : 'Failed to fetch balances' },
        500
      );
    }
  }

  // DELETE /api/simplefin — remove SimpleFIN config
  if (pathname === '/api/simplefin' && req.method === 'DELETE') {
    const settings = await loadSettings();
    delete settings.simplefin;
    await saveSettings(settings);
    try {
      await fs.unlink(SIMPLEFIN_CACHE_FILE);
    } catch {
      /* ignore */
    }
    return jsonResponse({ ok: true });
  }

  // GET /api/status
  if (pathname === '/api/status' && req.method === 'GET') {
    try {
      await fs.access(DATA_DIR);
      const stats = await fs.stat(DATA_DIR);
      const config = await loadConfig();
      return jsonResponse({
        ok: true,
        dataDir: DATA_DIR,
        isDirectory: stats.isDirectory(),
        entities: config.entities,
        authRequired: AUTH_ENABLED,
        authenticated: isAuthenticated(req),
      });
    } catch {
      return jsonResponse({
        ok: false,
        dataDir: DATA_DIR,
        error: 'Data directory not accessible',
        authRequired: AUTH_ENABLED,
        authenticated: isAuthenticated(req),
      });
    }
  }

  // GET /api/entities
  if (pathname === '/api/entities' && req.method === 'GET') {
    const config = await loadConfig();
    return jsonResponse({ entities: config.entities });
  }

  // POST /api/entities - Add new entity
  if (pathname === '/api/entities' && req.method === 'POST') {
    const body = await req.json();
    const { id, name, color } = body;

    if (!id || !name) {
      return jsonResponse({ error: 'Missing id or name' }, 400);
    }

    const config = await loadConfig();

    // Check if entity already exists
    if (config.entities.find((e) => e.id === id)) {
      return jsonResponse({ error: 'Entity already exists' }, 400);
    }

    // Create entity directory
    const entityPath = path.join(DATA_DIR, id);
    await ensureDir(entityPath);

    // Add to config
    config.entities.push({
      id,
      name,
      color: color || 'gray',
      path: id,
    });
    await saveConfig(config);

    return jsonResponse({ ok: true, entity: config.entities[config.entities.length - 1] });
  }

  // PUT /api/entities/:id - Update entity
  const entityUpdateMatch = pathname.match(/^\/api\/entities\/([^/]+)$/);
  if (entityUpdateMatch && req.method === 'PUT') {
    const entityId = entityUpdateMatch[1];
    const body = await req.json();
    const { name, color, icon, description } = body;

    const config = await loadConfig();
    const entityIndex = config.entities.findIndex((e) => e.id === entityId);

    if (entityIndex === -1) {
      return jsonResponse({ error: 'Entity not found' }, 404);
    }

    // Update fields if provided
    if (name) config.entities[entityIndex].name = name;
    if (color) config.entities[entityIndex].color = color;
    if (icon !== undefined) (config.entities[entityIndex] as Record<string, unknown>).icon = icon;
    if (description !== undefined) config.entities[entityIndex].description = description;

    await saveConfig(config);

    return jsonResponse({ ok: true, entity: config.entities[entityIndex] });
  }

  // DELETE /api/entities/:id
  const entityDeleteMatch = pathname.match(/^\/api\/entities\/([^/]+)$/);
  if (entityDeleteMatch && req.method === 'DELETE') {
    const entityId = entityDeleteMatch[1];
    const config = await loadConfig();

    const entityIndex = config.entities.findIndex((e) => e.id === entityId);
    if (entityIndex === -1) {
      return jsonResponse({ error: 'Entity not found' }, 404);
    }

    // Don't delete personal
    if (entityId === 'personal') {
      return jsonResponse({ error: 'Cannot delete personal entity' }, 400);
    }

    config.entities.splice(entityIndex, 1);
    await saveConfig(config);

    return jsonResponse({ ok: true });
  }

  // GET /api/years/:entity
  const yearsMatch = pathname.match(/^\/api\/years\/([^/]+)$/);
  if (yearsMatch && req.method === 'GET') {
    const entityId = yearsMatch[1];
    const entityPath = await getEntityPath(entityId);

    if (!entityPath) {
      return jsonResponse({ error: 'Entity not found' }, 404);
    }

    try {
      const entries = await fs.readdir(entityPath, { withFileTypes: true });
      const years = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => e.name)
        // Match tax years: 19xx or 20xx (not things like "1099s")
        .filter((name) => /^(19|20)\d{2}($|\D)/.test(name))
        .sort()
        .reverse();
      return jsonResponse({ years });
    } catch (err) {
      return jsonResponse({ error: 'Failed to list years', details: String(err) }, 500);
    }
  }

  // GET /api/years (legacy - defaults to personal)
  if (pathname === '/api/years' && req.method === 'GET') {
    const entityPath = await getEntityPath('personal');
    if (!entityPath) {
      return jsonResponse({ years: [] });
    }

    try {
      const entries = await fs.readdir(entityPath, { withFileTypes: true });
      const years = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => e.name)
        // Match tax years: 19xx or 20xx (not things like "1099s")
        .filter((name) => /^(19|20)\d{2}($|\D)/.test(name))
        .sort()
        .reverse();
      return jsonResponse({ years });
    } catch {
      return jsonResponse({ years: [] });
    }
  }

  // GET /api/files/:entity/:year
  const filesEntityYearMatch = pathname.match(/^\/api\/files\/([^/]+)\/(\d{4}.*)$/);
  if (filesEntityYearMatch && req.method === 'GET') {
    const entityId = filesEntityYearMatch[1];
    const year = filesEntityYearMatch[2];

    const entityPath = await getEntityPath(entityId);
    if (!entityPath) {
      return jsonResponse({ error: 'Entity not found' }, 404);
    }

    const yearPath = path.join(entityPath, year);

    try {
      await fs.access(yearPath);
      const files = await scanDirectory(yearPath, year);

      // Attach parsed data and metadata to files
      const parsedDataMap = await loadParsedData();
      const metadataMap = await loadMetadata();
      const filesWithData = files.map((f) => {
        const key = `${entityId}/${f.path}`;
        const meta = metadataMap[key];
        return {
          ...f,
          parsedData: parsedDataMap[key] || null,
          tags: meta?.tags || [],
          notes: meta?.notes || '',
          tracked: meta?.tracked !== false,
        };
      });

      return jsonResponse({ files: filesWithData });
    } catch {
      return jsonResponse({ files: [] });
    }
  }

  // GET /api/files/:year (legacy - defaults to personal)
  const filesYearMatch = pathname.match(/^\/api\/files\/(\d{4}.*)$/);
  if (filesYearMatch && req.method === 'GET') {
    const year = filesYearMatch[1];
    const entityPath = await getEntityPath('personal');

    if (!entityPath) {
      return jsonResponse({ files: [] });
    }

    const yearPath = path.join(entityPath, year);

    try {
      await fs.access(yearPath);
      const files = await scanDirectory(yearPath, year);
      return jsonResponse({ files });
    } catch {
      return jsonResponse({ files: [] });
    }
  }

  // GET /api/file/:entity/... (serve file)
  if (pathname.startsWith('/api/file/') && req.method === 'GET') {
    const pathParts = pathname.slice('/api/file/'.length).split('/');
    const entityId = pathParts[0];
    const filePath = decodeURIComponent(pathParts.slice(1).join('/'));

    const entityPath = await getEntityPath(entityId);
    if (!entityPath) {
      return jsonResponse({ error: 'Entity not found' }, 404);
    }

    const fullPath = path.join(entityPath, filePath);

    // Security: ensure we're still within entity path
    if (!fullPath.startsWith(entityPath)) {
      return jsonResponse({ error: 'Access denied' }, 403);
    }

    try {
      await fs.access(fullPath);
      const stats = await fs.stat(fullPath);

      if (stats.isDirectory()) {
        return jsonResponse({ error: 'Path is a directory' }, 400);
      }

      const content = await fs.readFile(fullPath);
      const mimeType = getMimeType(fullPath);

      return new Response(content, {
        headers: {
          'Content-Type': mimeType,
          'Content-Length': String(stats.size),
          ...corsHeaders(),
        },
      });
    } catch {
      return jsonResponse({ error: 'File not found' }, 404);
    }
  }

  // DELETE /api/file/:entity/...
  if (pathname.startsWith('/api/file/') && req.method === 'DELETE') {
    const pathParts = pathname.slice('/api/file/'.length).split('/');
    const entityId = pathParts[0];
    const filePath = decodeURIComponent(pathParts.slice(1).join('/'));

    const entityPath = await getEntityPath(entityId);
    if (!entityPath) {
      return jsonResponse({ error: 'Entity not found' }, 404);
    }

    const fullPath = path.join(entityPath, filePath);

    if (!fullPath.startsWith(entityPath)) {
      return jsonResponse({ error: 'Access denied' }, 403);
    }

    try {
      await fs.unlink(fullPath);
      return jsonResponse({ ok: true });
    } catch (err) {
      return jsonResponse({ error: 'Failed to delete file', details: String(err) }, 500);
    }
  }

  // POST /api/upload
  if (pathname === '/api/upload' && req.method === 'POST') {
    const entityId = url.searchParams.get('entity') || 'personal';
    const destPath = url.searchParams.get('path');
    const filename = url.searchParams.get('filename');

    if (!destPath || !filename) {
      return jsonResponse({ error: 'Missing path or filename' }, 400);
    }

    const entityPath = await getEntityPath(entityId);
    if (!entityPath) {
      return jsonResponse({ error: 'Entity not found' }, 404);
    }

    const fullDir = path.join(entityPath, destPath);
    const fullPath = path.join(fullDir, filename);

    if (!fullPath.startsWith(entityPath)) {
      return jsonResponse({ error: 'Access denied' }, 403);
    }

    try {
      await ensureDir(fullDir);
      const body = await req.arrayBuffer();
      await fs.writeFile(fullPath, Buffer.from(body));

      return jsonResponse({ ok: true, path: path.join(destPath, filename) });
    } catch (err) {
      return jsonResponse({ error: 'Failed to save file', details: String(err) }, 500);
    }
  }

  // POST /api/mkdir
  if (pathname === '/api/mkdir' && req.method === 'POST') {
    const body = await req.json();
    const { entity: entityId, path: dirPath } = body;

    if (!dirPath) {
      return jsonResponse({ error: 'Missing path' }, 400);
    }

    const entityPath = await getEntityPath(entityId || 'personal');
    if (!entityPath) {
      return jsonResponse({ error: 'Entity not found' }, 404);
    }

    const fullPath = path.join(entityPath, dirPath);

    if (!fullPath.startsWith(entityPath)) {
      return jsonResponse({ error: 'Access denied' }, 403);
    }

    try {
      await ensureDir(fullPath);
      return jsonResponse({ ok: true, path: dirPath });
    } catch (err) {
      return jsonResponse({ error: 'Failed to create directory', details: String(err) }, 500);
    }
  }

  // POST /api/parse/:entity/:filePath - Parse a single file using Claude Vision AI
  if (pathname.startsWith('/api/parse/') && req.method === 'POST') {
    const pathParts = pathname.slice('/api/parse/'.length).split('/');
    const entityId = pathParts[0];
    const filePath = decodeURIComponent(pathParts.slice(1).join('/'));

    const entityPath = await getEntityPath(entityId);
    if (!entityPath) {
      return jsonResponse({ error: 'Entity not found' }, 404);
    }

    const fullPath = path.join(entityPath, filePath);

    if (!fullPath.startsWith(entityPath)) {
      return jsonResponse({ error: 'Access denied' }, 403);
    }

    try {
      await fs.access(fullPath);

      const filename = path.basename(fullPath);

      let parsedData: ParsedData = {
        parsed: true,
        parsedAt: new Date().toISOString(),
      };

      // Always use AI parsing
      console.log(`[Parse] Using Claude Vision AI for ${filename}`);
      const aiData = await parseWithAI(fullPath, filename);
      if (aiData) {
        parsedData = {
          ...parsedData,
          ...aiData,
        };
      }

      // Save parsed data
      await setParsedDataForFile(`${entityId}/${filePath}`, parsedData);

      return jsonResponse({ ok: true, parsedData });
    } catch (err) {
      return jsonResponse({ error: 'Failed to parse file', details: String(err) }, 500);
    }
  }

  // POST /api/parse-all/:entity/:year - Parse all files in a year using Claude Vision AI
  // Query params:
  //   ?filter=expenses,invoices  - Only parse files matching these path/filename patterns
  //   ?unparsed=true             - Only parse files that haven't been parsed yet
  if (pathname.startsWith('/api/parse-all/') && req.method === 'POST') {
    const pathParts = pathname.slice('/api/parse-all/'.length).split('/');
    const entityId = pathParts[0];
    const year = pathParts[1];

    const filterParam = url.searchParams.get('filter');
    const unparsedOnly = url.searchParams.get('unparsed') === 'true';
    const filters = filterParam ? filterParam.split(',').map((f) => f.trim().toLowerCase()) : [];

    const entityPath = await getEntityPath(entityId);
    if (!entityPath) {
      return jsonResponse({ error: 'Entity not found' }, 404);
    }

    const yearPath = path.join(entityPath, year);

    try {
      await fs.access(yearPath);
      let files = await scanDirectory(yearPath, year);

      // Load existing parsed data for filtering
      const existingParsedData = await loadParsedData();

      // Filter files if requested
      if (filters.length > 0) {
        files = files.filter((file) => {
          const fileLower = file.path.toLowerCase();
          const nameLower = file.name.toLowerCase();
          return filters.some((f) => {
            if (f === 'expenses') return fileLower.includes('/expenses/');
            if (f === 'invoices') return /invoice/i.test(nameLower);
            if (f === 'income') return fileLower.includes('/income/');
            return fileLower.includes(`/${f}/`) || nameLower.includes(f);
          });
        });
      }

      // Filter to unparsed only if requested
      if (unparsedOnly) {
        files = files.filter((file) => !existingParsedData[`${entityId}/${file.path}`]);
      }

      let parsed = 0;
      let failed = 0;

      // Stream progress as NDJSON
      const stream = new ReadableStream({
        async start(controller) {
          const enc = new TextEncoder();
          for (let i = 0; i < files.length; i++) {
            const file = files[i];
            controller.enqueue(
              enc.encode(
                JSON.stringify({
                  type: 'progress',
                  current: i + 1,
                  total: files.length,
                  fileName: file.name,
                }) + '\n'
              )
            );

            try {
              const fullPath = path.join(entityPath, file.path);

              let parsedData: ParsedData = {
                parsed: true,
                parsedAt: new Date().toISOString(),
              };

              console.log(`[Parse All] Using Claude Vision AI for ${file.name}`);
              const aiData = await parseWithAI(fullPath, file.name);
              if (aiData) {
                parsedData = {
                  ...parsedData,
                  ...aiData,
                };
                await setParsedDataForFile(`${entityId}/${file.path}`, parsedData);
                parsed++;
              } else {
                console.error(`AI returned no data for ${file.name}`);
                failed++;
              }
            } catch (err) {
              console.error(`Failed to parse ${file.path}:`, err);
              failed++;
            }
          }

          controller.enqueue(
            enc.encode(
              JSON.stringify({ type: 'done', ok: true, parsed, failed, total: files.length }) + '\n'
            )
          );
          controller.close();
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'application/x-ndjson',
          'Cache-Control': 'no-cache',
        },
      });
    } catch (err) {
      return jsonResponse({ error: 'Failed to parse files', details: String(err) }, 500);
    }
  }

  // POST /api/move
  if (pathname === '/api/move' && req.method === 'POST') {
    const body = await req.json();
    const { entity: entityId, from, to } = body;

    if (!from || !to) {
      return jsonResponse({ error: 'Missing from or to path' }, 400);
    }

    const entityPath = await getEntityPath(entityId || 'personal');
    if (!entityPath) {
      return jsonResponse({ error: 'Entity not found' }, 404);
    }

    const fromPath = path.join(entityPath, from);
    const toPath = path.join(entityPath, to);

    if (!fromPath.startsWith(entityPath) || !toPath.startsWith(entityPath)) {
      return jsonResponse({ error: 'Access denied' }, 403);
    }

    try {
      await ensureDir(path.dirname(toPath));
      await fs.rename(fromPath, toPath);
      return jsonResponse({ ok: true });
    } catch (err) {
      return jsonResponse({ error: 'Failed to move file', details: String(err) }, 500);
    }
  }

  // POST /api/rename - Rename a file in place (same directory, new name)
  if (pathname === '/api/rename' && req.method === 'POST') {
    const body = await req.json();
    const { entity: entityId, filePath, newFilename } = body;

    if (!filePath || !newFilename) {
      return jsonResponse({ error: 'Missing filePath or newFilename' }, 400);
    }

    if (newFilename.includes('/') || newFilename.includes('\\')) {
      return jsonResponse({ error: 'newFilename must not contain path separators' }, 400);
    }

    const entityPath = await getEntityPath(entityId || 'personal');
    if (!entityPath) {
      return jsonResponse({ error: 'Entity not found' }, 404);
    }

    const oldFullPath = path.join(entityPath, filePath);
    const dir = path.dirname(oldFullPath);
    const newFullPath = path.join(dir, newFilename);

    if (!oldFullPath.startsWith(entityPath) || !newFullPath.startsWith(entityPath)) {
      return jsonResponse({ error: 'Access denied' }, 403);
    }

    try {
      // Check source exists
      await fs.access(oldFullPath);

      // Check destination doesn't already exist
      try {
        await fs.access(newFullPath);
        return jsonResponse({ error: 'A file with that name already exists' }, 409);
      } catch {
        // Good — destination doesn't exist
      }

      // Rename on disk
      await fs.rename(oldFullPath, newFullPath);

      // Build old and new keys for parsed data / metadata
      const oldKey = `${entityId}/${filePath}`;
      const newPath = filePath.replace(/[^/]+$/, newFilename);
      const newKey = `${entityId}/${newPath}`;

      // Update parsed data key
      const parsedData = await loadParsedData();
      if (parsedData[oldKey]) {
        parsedData[newKey] = parsedData[oldKey];
        delete parsedData[oldKey];
        await saveParsedData(parsedData);
      }

      // Update metadata key
      const metadata = await loadMetadata();
      if (metadata[oldKey]) {
        metadata[newKey] = metadata[oldKey];
        delete metadata[oldKey];
        await saveMetadata(metadata);
      }

      return jsonResponse({ ok: true, newPath });
    } catch (err) {
      return jsonResponse({ error: 'Failed to rename file', details: String(err) }, 500);
    }
  }

  // GET /api/business-docs/:entity - Get business documents (not tied to tax year)
  const businessDocsMatch = pathname.match(/^\/api\/business-docs\/([^/]+)$/);
  if (businessDocsMatch && req.method === 'GET') {
    const entityId = businessDocsMatch[1];

    const entityPath = await getEntityPath(entityId);
    if (!entityPath) {
      return jsonResponse({ error: 'Entity not found' }, 404);
    }

    const businessDocsPath = path.join(entityPath, 'business-docs');

    try {
      await fs.access(businessDocsPath);
      const files = await scanDirectory(businessDocsPath, 'business-docs');

      // Attach parsed data and metadata to files
      const parsedDataMap = await loadParsedData();
      const metadataMap = await loadMetadata();
      const filesWithData = files.map((f) => {
        const key = `${entityId}/${f.path}`;
        const meta = metadataMap[key];
        return {
          ...f,
          parsedData: parsedDataMap[key] || null,
          tags: meta?.tags || [],
          notes: meta?.notes || '',
          tracked: meta?.tracked !== false,
        };
      });

      return jsonResponse({ files: filesWithData });
    } catch {
      // Directory doesn't exist yet - return empty
      return jsonResponse({ files: [] });
    }
  }

  // GET /api/files-all/:entity - Get all files recursively (for non-tax entities)
  const filesAllMatch = pathname.match(/^\/api\/files-all\/([^/]+)$/);
  if (filesAllMatch && req.method === 'GET') {
    const entityId = filesAllMatch[1];

    const entityPath = await getEntityPath(entityId);
    if (!entityPath) {
      return jsonResponse({ error: 'Entity not found' }, 404);
    }

    try {
      await fs.access(entityPath);
      const files = await scanDirectory(entityPath, '');

      // Attach parsed data and metadata to files
      const parsedDataMap = await loadParsedData();
      const metadataMap = await loadMetadata();
      const filesWithData = files.map((f) => {
        const key = `${entityId}/${f.path}`;
        const meta = metadataMap[key];
        return {
          ...f,
          parsedData: parsedDataMap[key] || null,
          tags: meta?.tags || [],
          notes: meta?.notes || '',
          tracked: meta?.tracked !== false,
        };
      });

      return jsonResponse({ files: filesWithData });
    } catch {
      return jsonResponse({ files: [] });
    }
  }

  // POST /api/move-between - Move file between different entities
  if (pathname === '/api/move-between' && req.method === 'POST') {
    const body = await req.json();
    const { fromEntity, fromPath: from, toEntity, toPath: to } = body;

    if (!fromEntity || !from || !toEntity || !to) {
      return jsonResponse({ error: 'Missing required fields' }, 400);
    }

    const fromEntityPath = await getEntityPath(fromEntity);
    const toEntityPath = await getEntityPath(toEntity);

    if (!fromEntityPath) {
      return jsonResponse({ error: 'Source entity not found' }, 404);
    }
    if (!toEntityPath) {
      return jsonResponse({ error: 'Destination entity not found' }, 404);
    }

    const fullFromPath = path.join(fromEntityPath, from);
    const fullToPath = path.join(toEntityPath, to);

    // Security check
    if (!fullFromPath.startsWith(fromEntityPath) || !fullToPath.startsWith(toEntityPath)) {
      return jsonResponse({ error: 'Access denied' }, 403);
    }

    try {
      // Check source file exists
      await fs.access(fullFromPath);

      // Create destination directory
      await ensureDir(path.dirname(fullToPath));

      // Copy then delete (safer than rename across filesystems)
      await fs.copyFile(fullFromPath, fullToPath);
      await fs.unlink(fullFromPath);

      // Update parsed data and metadata keys if they exist
      const oldKey = `${fromEntity}/${from}`;
      const newKey = `${toEntity}/${to}`;

      const parsedData = await loadParsedData();
      if (parsedData[oldKey]) {
        parsedData[newKey] = parsedData[oldKey];
        delete parsedData[oldKey];
        await saveParsedData(parsedData);
      }

      const metadata = await loadMetadata();
      if (metadata[oldKey]) {
        metadata[newKey] = metadata[oldKey];
        delete metadata[oldKey];
        await saveMetadata(metadata);
      }

      return jsonResponse({ ok: true });
    } catch (err) {
      return jsonResponse({ error: 'Failed to move file', details: String(err) }, 500);
    }
  }

  // PUT /api/metadata - Update document metadata (tags, notes, tracked)
  if (pathname === '/api/metadata' && req.method === 'PUT') {
    const body = await req.json();
    const { entity, filePath: fp, tags, notes, tracked } = body;

    if (!entity || !fp) {
      return jsonResponse({ error: 'Missing entity or filePath' }, 400);
    }

    const key = `${entity}/${fp}`;
    const metadata = await loadMetadata();
    const existing = metadata[key] || {};

    if (tags !== undefined) existing.tags = tags;
    if (notes !== undefined) existing.notes = notes;
    if (tracked !== undefined) existing.tracked = tracked;

    // Clean up empty entries (only if all fields are default/empty)
    const hasContent =
      (existing.tags && existing.tags.length > 0) || existing.notes || existing.tracked === false;
    if (!hasContent) {
      delete metadata[key];
    } else {
      metadata[key] = existing;
    }

    await saveMetadata(metadata);
    return jsonResponse({ ok: true });
  }

  // GET /api/tax-summary/:year - Get consolidated tax data across all tax entities
  const taxSummaryMatch = pathname.match(/^\/api\/tax-summary\/(\d{4})$/);
  if (taxSummaryMatch && req.method === 'GET') {
    const year = taxSummaryMatch[1];

    try {
      const config = await loadConfig();
      const parsedDataMap = await loadParsedData();
      const metadataMap = await loadMetadata();
      const taxEntities = config.entities.filter(
        (e) => (e as Record<string, unknown>).type === 'tax'
      );

      // Use centralized analytics module
      const { getIncomeSummary, getExpenseSummary } = await import('./analytics/index.js');

      const summary: Record<
        string,
        {
          entity: EntityConfig;
          documents: { name: string; path: string; type: string; parsedData: ParsedData | null }[];
          income: { source: string; amount: number; type: string }[];
          expenses: { vendor: string; amount: number; category: string }[];
        }
      > = {};

      for (const entity of taxEntities) {
        const entityPath = await getEntityPath(entity.id);
        if (!entityPath) continue;

        const yearPath = path.join(entityPath, year);
        let files: FileInfo[] = [];
        try {
          await fs.access(yearPath);
          files = await scanDirectory(yearPath, year);
        } catch {
          continue;
        }

        // Build document list (still needed for response)
        const documents: { name: string; path: string; type: string; parsedData: ParsedData | null }[] = [];
        for (const file of files) {
          const parsedKey = `${entity.id}/${file.path}`;
          const parsed = parsedDataMap[parsedKey] || null;
          const meta = metadataMap[parsedKey];
          if (meta?.tracked === false) continue;
          documents.push({ name: file.name, path: file.path, type: file.type, parsedData: parsed });
        }

        // Use analytics extractors for income and expenses
        const analyticsFiles = files.map((f) => ({ name: f.name, path: f.path, type: f.type }));
        const incomeSummary = getIncomeSummary(entity.id, year, parsedDataMap, metadataMap, analyticsFiles);
        const expenseSummary = getExpenseSummary(entity.id, year, parsedDataMap, metadataMap, analyticsFiles);

        summary[entity.id] = {
          entity,
          documents,
          income: incomeSummary.items.map((i) => ({ source: i.source, amount: i.amount, type: i.type })),
          expenses: expenseSummary.expenses.map((e) => ({ vendor: e.vendor, amount: e.amount, category: e.category })),
        };
      }

      return jsonResponse({ year, summary });
    } catch (err) {
      return jsonResponse({ error: 'Failed to generate tax summary', details: String(err) }, 500);
    }
  }

  // GET /api/analytics/quick-stats/:entity/:year - All summaries in one request for frontend
  const quickStatsMatch = pathname.match(/^\/api\/analytics\/quick-stats\/([^/]+)\/(\d{4})$/);
  if (quickStatsMatch && req.method === 'GET') {
    const [, entityId, year] = quickStatsMatch;
    const includeHidden = url.searchParams.get('includeHidden') === 'true';

    try {
      const config = await loadConfig();
      const parsedDataMap = await loadParsedData();
      const metadataMap = includeHidden ? {} : await loadMetadata();
      const { getIncomeSummary, getExpenseSummary, getBankDepositSummary, getInvoiceSummary, getRetirementSummary } =
        await import('./analytics/index.js');

      // Support "all" entity by iterating all tax entities
      const entities =
        entityId === 'all'
          ? config.entities.filter((e) => (e as Record<string, unknown>).type === 'tax')
          : config.entities.filter((e) => e.id === entityId);

      if (entities.length === 0) {
        return jsonResponse({ error: 'Entity not found' }, 404);
      }

      // Aggregate across all matching entities
      const allIncome: { items: ReturnType<typeof getIncomeSummary>['items'] } = { items: [] };
      const allExpenses: { expenses: ReturnType<typeof getExpenseSummary>['expenses'] } = { expenses: [] };
      let totalW2 = 0,
        totalW2Count = 0,
        total1099 = 0,
        total1099Count = 0,
        totalK1 = 0,
        totalK1Count = 0,
        totalCapGainsST = 0,
        totalCapGainsLT = 0,
        totalFederalWithheld = 0,
        totalStateWithheld = 0,
        totalExpenses = 0,
        totalDeductible = 0,
        documentCount = 0;
      const expenseItems: ReturnType<typeof getExpenseSummary>['items'] = [];
      const bankDeposits: Record<string, ReturnType<typeof getBankDepositSummary>> = {};
      let invoiceTotal = 0, invoiceCount = 0;
      const invoiceByCustomer = new Map<string, { total: number; count: number }>();
      let retirementResult: ReturnType<typeof getRetirementSummary> = null;

      for (const entity of entities) {
        const entityPath = await getEntityPath(entity.id);
        if (!entityPath) continue;

        const yearPath = path.join(entityPath, year);
        let files: FileInfo[] = [];
        try {
          await fs.access(yearPath);
          files = await scanDirectory(yearPath, year);
        } catch {
          continue;
        }

        documentCount += files.length;
        const analyticsFiles = files.map((f) => ({ name: f.name, path: f.path, type: f.type }));

        // Income
        const inc = getIncomeSummary(entity.id, year, parsedDataMap, metadataMap, analyticsFiles);
        allIncome.items.push(...inc.items);
        totalW2 += inc.w2Total;
        totalW2Count += inc.w2Count;
        total1099 += inc.income1099Total;
        total1099Count += inc.income1099Count;
        totalK1 += inc.k1Total;
        totalK1Count += inc.k1Count;
        totalCapGainsST += inc.capitalGainsShortTerm;
        totalCapGainsLT += inc.capitalGainsLongTerm;
        totalFederalWithheld += inc.federalWithheld;
        totalStateWithheld += inc.stateWithheld;

        // Expenses
        const exp = getExpenseSummary(entity.id, year, parsedDataMap, metadataMap, analyticsFiles);
        allExpenses.expenses.push(...exp.expenses);
        totalExpenses += exp.totalExpenses;
        totalDeductible += exp.totalDeductible;
        for (const item of exp.items) {
          const existing = expenseItems.find((e) => e.category === item.category);
          if (existing) {
            existing.total += item.total;
            existing.deductibleAmount += item.deductibleAmount;
            existing.count += item.count;
          } else {
            expenseItems.push({ ...item });
          }
        }

        // Invoices
        const invSummary = getInvoiceSummary(entity.id, year, parsedDataMap, metadataMap, analyticsFiles);
        invoiceTotal += invSummary.invoiceTotal;
        invoiceCount += invSummary.invoiceCount;
        for (const cust of invSummary.byCustomer) {
          const existing = invoiceByCustomer.get(cust.customer);
          if (existing) { existing.total += cust.total; existing.count += cust.count; }
          else { invoiceByCustomer.set(cust.customer, { total: cust.total, count: cust.count }); }
        }

        // Retirement
        const retSummary = getRetirementSummary(entity.id, year, parsedDataMap, metadataMap, analyticsFiles);
        if (retSummary) {
          if (!retirementResult) {
            retirementResult = { ...retSummary };
          } else {
            retirementResult.totalContributions += retSummary.totalContributions;
            retirementResult.employerContributions += retSummary.employerContributions;
            retirementResult.employeeContributions += retSummary.employeeContributions;
            retirementResult.statementCount += retSummary.statementCount;
            retirementResult.byAccount.push(...retSummary.byAccount);
          }
        }

        // Bank deposits
        const statementsPath = path.join(entityPath, year, 'statements', 'bank');
        try {
          await fs.access(statementsPath);
          const statementFiles = await fs.readdir(statementsPath);
          const depositSummary = getBankDepositSummary(
            entity.id,
            year,
            parsedDataMap,
            metadataMap,
            statementFiles
          );
          if (depositSummary.monthly.length > 0) {
            bankDeposits[entity.id] = depositSummary;
          }
        } catch {
          /* no statements dir */
        }
      }

      const totalCapGains = totalCapGainsST + totalCapGainsLT;

      return jsonResponse({
        entityId,
        year,
        income: {
          w2Total: totalW2,
          w2Count: totalW2Count,
          income1099Total: total1099,
          income1099Count: total1099Count,
          k1Total: totalK1,
          k1Count: totalK1Count,
          capitalGainsShortTerm: totalCapGainsST,
          capitalGainsLongTerm: totalCapGainsLT,
          capitalGainsTotal: totalCapGains,
          federalWithheld: totalFederalWithheld,
          stateWithheld: totalStateWithheld,
          totalIncome: totalW2 + total1099 + totalK1 + totalCapGains,
          salesTotal: 0, // TODO: integrate sales data
          salesCount: 0,
          items: allIncome.items,
        },
        expenses: {
          items: expenseItems.sort((a, b) => b.total - a.total),
          totalExpenses,
          totalDeductible,
          mileageTotal: 0, // TODO: integrate mileage
          mileageDeduction: 0,
          mileageCount: 0,
          expenses: allExpenses.expenses,
        },
        bankDeposits,
        invoices: {
          invoiceTotal,
          invoiceCount,
          byCustomer: Array.from(invoiceByCustomer.entries())
            .map(([customer, { total, count }]) => ({ customer, total, count }))
            .sort((a, b) => b.total - a.total),
        },
        retirement: retirementResult,
        documentCount,
      });
    } catch (err) {
      return jsonResponse(
        { error: 'Failed to generate analytics', details: String(err) },
        500
      );
    }
  }

  // Financial snapshot (extracted to routes/financial-snapshot.ts)
  const snapshotResponse = await handleFinancialSnapshotRoutes(req, url, pathname);
  if (snapshotResponse) return snapshotResponse;
  // misc routes (extracted to routes/misc.ts)
  const miscResponse = await handleMiscRoutes(req, url, pathname);
  if (miscResponse) return miscResponse;

  // sales routes (extracted to routes/sales.ts)
  const salesResponse = await handleSalesRoutes(req, url, pathname);
  if (salesResponse) return salesResponse;

  // mileage routes (extracted to routes/mileage.ts)
  const mileageResponse = await handleMileageRoutes(req, url, pathname);
  if (mileageResponse) return mileageResponse;

  // gold routes (extracted to routes/gold.ts)
  const goldResponse = await handleGoldRoutes(req, url, pathname);
  if (goldResponse) return goldResponse;

  // property routes (extracted to routes/property.ts)
  const propertyResponse = await handlePropertyRoutes(req, url, pathname);
  if (propertyResponse) return propertyResponse;

  // ========================================================================
  // Geocode API (Geoapify proxy)
  // ========================================================================

  // GET /api/geocode/enabled - Check if Geoapify API key is configured
  if (pathname === '/api/geocode/enabled' && req.method === 'GET') {
    const settings = await loadSettings();
    return jsonResponse({ enabled: !!settings.geoapifyApiKey });
  }

  // GET /api/geocode/autocomplete?text=... - Proxy to Geoapify autocomplete
  if (pathname === '/api/geocode/autocomplete' && req.method === 'GET') {
    const text = url.searchParams.get('text');
    if (!text || text.length < 2) {
      return jsonResponse({ results: [] });
    }

    const settings = await loadSettings();
    if (!settings.geoapifyApiKey) {
      return jsonResponse({ error: 'Geoapify API key not configured' }, 400);
    }

    try {
      const apiUrl = `https://api.geoapify.com/v1/geocode/autocomplete?text=${encodeURIComponent(text)}&format=json&apiKey=${encodeURIComponent(settings.geoapifyApiKey)}`;
      const res = await fetch(apiUrl);
      const data = await res.json();
      return jsonResponse(data);
    } catch (err) {
      console.error('Geoapify autocomplete error:', err);
      return jsonResponse({ error: 'Failed to fetch autocomplete results' }, 500);
    }
  }

  // GET /api/geocode/route?from_lat=...&from_lon=...&to_lat=...&to_lon=... - Proxy to Geoapify routing
  if (pathname === '/api/geocode/route' && req.method === 'GET') {
    const fromLat = url.searchParams.get('from_lat');
    const fromLon = url.searchParams.get('from_lon');
    const toLat = url.searchParams.get('to_lat');
    const toLon = url.searchParams.get('to_lon');

    if (!fromLat || !fromLon || !toLat || !toLon) {
      return jsonResponse({ error: 'Missing coordinates' }, 400);
    }

    const settings = await loadSettings();
    if (!settings.geoapifyApiKey) {
      return jsonResponse({ error: 'Geoapify API key not configured' }, 400);
    }

    try {
      const apiUrl = `https://api.geoapify.com/v1/routing?waypoints=${encodeURIComponent(`${fromLat},${fromLon}|${toLat},${toLon}`)}&mode=drive&apiKey=${encodeURIComponent(settings.geoapifyApiKey)}`;
      const res = await fetch(apiUrl);
      const data = (await res.json()) as { features?: { properties?: { distance?: number } }[] };
      const distanceMeters = data.features?.[0]?.properties?.distance;
      if (distanceMeters == null) {
        return jsonResponse({ error: 'No route found' }, 404);
      }
      const distanceMiles = Math.round((distanceMeters / 1609.34) * 10) / 10;
      return jsonResponse({ miles: distanceMiles, meters: distanceMeters });
    } catch (err) {
      console.error('Geoapify routing error:', err);
      return jsonResponse({ error: 'Failed to calculate route' }, 500);
    }
  }

  // ========================================================================
  // Dropbox / rclone API
  // ========================================================================

  // GET /api/dropbox/status - Check rclone config and Dropbox connection
  if (pathname === '/api/dropbox/status' && req.method === 'GET') {
    const configExists = await fs
      .access(RCLONE_CONFIG_PATH)
      .then(() => true)
      .catch(() => false);
    const rcloneInstalled = await Bun.spawn(['which', 'rclone'], {
      stdout: 'pipe',
      stderr: 'pipe',
    }).exited.then((code) => code === 0);
    const syncScriptExists =
      (await fs
        .access(SYNC_SCRIPT_DATA_PATH)
        .then(() => true)
        .catch(() => false)) ||
      (await fs
        .access(SYNC_SCRIPT_PATH)
        .then(() => true)
        .catch(() => false));

    if (!rcloneInstalled) {
      return jsonResponse({
        configured: false,
        rcloneInstalled: false,
        message: 'rclone not installed in container',
      });
    }
    if (!configExists) {
      return jsonResponse({
        configured: false,
        rcloneInstalled: true,
        syncScript: syncScriptExists,
        message: 'No rclone config found. Set up Dropbox token in Settings.',
      });
    }

    // Test the connection
    const proc = Bun.spawn(['rclone', 'about', 'dropbox:', '--json'], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, RCLONE_CONFIG: RCLONE_CONFIG_PATH },
    });
    await proc.exited;
    if (proc.exitCode === 0) {
      const about = JSON.parse(await new Response(proc.stdout).text());
      return jsonResponse({
        configured: true,
        rcloneInstalled: true,
        syncScript: syncScriptExists,
        connected: true,
        usage: about,
      });
    }
    const stderr = await new Response(proc.stderr).text();
    return jsonResponse({
      configured: true,
      rcloneInstalled: true,
      syncScript: syncScriptExists,
      connected: false,
      error: stderr.trim(),
    });
  }

  // POST /api/dropbox/authorize - Save rclone token from `rclone authorize "dropbox"` output
  if (pathname === '/api/dropbox/authorize' && req.method === 'POST') {
    const body = await req.json();
    const { token } = body;
    if (!token) {
      return jsonResponse({ error: 'Missing token' }, 400);
    }

    // Write rclone config
    const config = `[dropbox]\ntype = dropbox\ntoken = ${typeof token === 'string' ? token : JSON.stringify(token)}\n`;
    await fs.writeFile(RCLONE_CONFIG_PATH, config);
    return jsonResponse({ ok: true, message: 'Dropbox configured' });
  }

  // POST /api/dropbox/sync - Trigger a manual sync now
  if (pathname === '/api/dropbox/sync' && req.method === 'POST') {
    void runDropboxSync();
    return jsonResponse({ ok: true, message: 'Sync started' });
  }

  // GET /api/search?q=query - Search all files across all entities and years
  if (pathname === '/api/search' && req.method === 'GET') {
    const query = url.searchParams.get('q')?.toLowerCase();
    if (!query || query.length < 2) {
      return jsonResponse({ files: [] });
    }

    try {
      const config = await loadConfig();
      const parsedDataMap = await loadParsedData();
      const allResults: {
        entity: string;
        entityName: string;
        name: string;
        path: string;
        size: number;
        lastModified: number;
        type: string;
        parsedData: ParsedData | null;
      }[] = [];

      for (const entity of config.entities) {
        const entityPath = await getEntityPath(entity.id);
        if (!entityPath) continue;

        // Scan everything under the entity
        const files = await scanDirectory(entityPath, '');

        for (const file of files) {
          const nameLower = file.name.toLowerCase();
          const pathLower = file.path.toLowerCase();
          const parsedKey = `${entity.id}/${file.path}`;
          const parsed = parsedDataMap[parsedKey] || null;

          // Search filename and path
          let match = nameLower.includes(query) || pathLower.includes(query);

          // Search parsed data fields (vendor, employer, payer, etc.)
          if (!match && parsed) {
            const searchableFields = [
              'vendor',
              'employerName',
              'payerName',
              'recipientName',
              'billTo',
              'customerName',
              'category',
              'description',
            ];
            for (const field of searchableFields) {
              const val = parsed[field];
              if (typeof val === 'string' && val.toLowerCase().includes(query)) {
                match = true;
                break;
              }
            }
            // Search items descriptions
            if (!match && Array.isArray(parsed.items)) {
              for (const item of parsed.items as { description?: string }[]) {
                if (item.description && item.description.toLowerCase().includes(query)) {
                  match = true;
                  break;
                }
              }
            }
          }

          if (match) {
            allResults.push({
              entity: entity.id,
              entityName: entity.name,
              name: file.name,
              path: file.path,
              size: file.size,
              lastModified: file.lastModified,
              type: file.type,
              parsedData: parsed,
            });
          }
        }
      }

      return jsonResponse({ files: allResults });
    } catch (err) {
      return jsonResponse({ error: 'Search failed', details: String(err) }, 500);
    }
  }

  // GET /api/sync-status - Get Dropbox sync status
  if (pathname === '/api/sync-status' && req.method === 'GET') {
    try {
      const statusPath = path.join(DATA_DIR, '.docvault-sync-status.json');
      const content = await fs.readFile(statusPath, 'utf-8');
      return jsonResponse(JSON.parse(content));
    } catch {
      return jsonResponse({
        status: 'unknown',
        lastSync: null,
        errors: 0,
        entitiesSynced: 0,
        nextSync: null,
      });
    }
  }

  // GET /api/cache-status - Get last-updated timestamps from crypto & broker caches
  if (pathname === '/api/cache-status' && req.method === 'GET') {
    const readTimestamp = async (filePath: string): Promise<string | null> => {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const data = JSON.parse(content);
        return data.lastUpdated || null;
      } catch {
        return null;
      }
    };
    const [cryptoLastUpdated, brokerLastUpdated, bankLastUpdated] = await Promise.all([
      readTimestamp(CRYPTO_CACHE_FILE),
      readTimestamp(BROKER_CACHE_FILE),
      readTimestamp(SIMPLEFIN_CACHE_FILE),
    ]);
    return jsonResponse({ cryptoLastUpdated, brokerLastUpdated, bankLastUpdated });
  }

  // GET /api/schedules - Get current schedule config and status
  if (pathname === '/api/schedules' && req.method === 'GET') {
    const settings = await loadSettings();
    const schedules = settings.schedules || {};
    return jsonResponse({
      snapshotEnabled: schedules.snapshotEnabled !== false,
      snapshotIntervalMinutes: schedules.snapshotIntervalMinutes || DEFAULT_SNAPSHOT_INTERVAL,
      dropboxSyncEnabled: schedules.dropboxSyncEnabled !== false,
      dropboxSyncIntervalMinutes:
        schedules.dropboxSyncIntervalMinutes || DEFAULT_DROPBOX_SYNC_INTERVAL,
      backupPasswordSet: !!schedules.backupPassword,
    });
  }

  // PUT /api/schedules - Update schedule config and restart timers
  if (pathname === '/api/schedules' && req.method === 'PUT') {
    try {
      const body = await req.json();
      const settings = await loadSettings();
      settings.schedules = {
        snapshotEnabled: body.snapshotEnabled ?? true,
        snapshotIntervalMinutes: body.snapshotIntervalMinutes || DEFAULT_SNAPSHOT_INTERVAL,
        dropboxSyncEnabled: body.dropboxSyncEnabled ?? true,
        dropboxSyncIntervalMinutes:
          body.dropboxSyncIntervalMinutes || DEFAULT_DROPBOX_SYNC_INTERVAL,
        backupPassword: body.backupPassword || settings.schedules?.backupPassword,
      };
      await saveSettings(settings);
      startScheduler(settings.schedules);
      return jsonResponse({ ok: true, schedules: settings.schedules });
    } catch (err) {
      return jsonResponse(
        { error: err instanceof Error ? err.message : 'Failed to update schedules' },
        500
      );
    }
  }

  // POST /api/save-parsed - Save parsed data for a file
  if (pathname === '/api/save-parsed' && req.method === 'POST') {
    try {
      const body = await req.json();
      const { entity: entityId, filePath, parsedData: parsedDataObj } = body;

      if (!entityId || !filePath || !parsedDataObj) {
        return jsonResponse({ error: 'Missing entity, filePath, or parsedData' }, 400);
      }

      const fileKey = `${entityId}/${filePath}`;
      await setParsedDataForFile(fileKey, {
        parsed: true,
        parsedAt: new Date().toISOString(),
        ...parsedDataObj,
      });

      console.log(`[Save Parsed] Saved parsed data for ${fileKey}`);
      return jsonResponse({ ok: true });
    } catch (err) {
      return jsonResponse({ error: 'Failed to save parsed data', details: String(err) }, 500);
    }
  }

  // POST /api/suggest-filename - Use Claude AI to analyze a file and suggest naming metadata
  if (pathname === '/api/suggest-filename' && req.method === 'POST') {
    try {
      const body = await req.arrayBuffer();
      const filename = url.searchParams.get('filename') || 'document';
      const taxYear = url.searchParams.get('year') || String(new Date().getFullYear());

      // Determine file type
      const ext = filename.split('.').pop()?.toLowerCase();
      let mimeType = 'application/pdf';
      if (ext === 'png') mimeType = 'image/png';
      else if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';
      else if (ext === 'gif') mimeType = 'image/gif';
      else if (ext === 'webp') mimeType = 'image/webp';

      const base64Data = Buffer.from(body).toString('base64');

      // Get API key
      const apiKey = await getAnthropicKey();
      if (!apiKey) {
        return jsonResponse({ error: 'Anthropic API key not configured' }, 400);
      }

      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const anthropic = new Anthropic({ apiKey, maxRetries: 0 });

      const isPdf = mimeType === 'application/pdf';

      const fileContent = isPdf
        ? {
            type: 'document' as const,
            source: {
              type: 'base64' as const,
              media_type: 'application/pdf' as const,
              data: base64Data,
            },
          }
        : {
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
              data: base64Data,
            },
          };

      const model = await getClaudeModel();
      const response = await withAILimit(() =>
        anthropic.messages.create({
          model,
          max_tokens: 4096,
          system: `You analyze tax documents, suggest standardized filenames, and extract all parsed data.

Naming convention: {Source}_{Type}_{Date}.{ext}
- Source: Company/vendor/employer name in Title_Case (e.g., "Google", "Acme_Corp", "OpenAI")
- Type: Document type keyword
- Date: Always LAST. Year only for annual docs (W-2, 1099), YYYY-MM for invoices, YYYY-MM-DD for receipts

Document type patterns:
- W-2: {Employer}_W2_{Year}.pdf
- 1099-NEC: {Payer}_1099-nec_{Year}.pdf
- 1099-DIV: {Payer}_1099-div_{Year}.pdf
- 1099-INT: {Payer}_1099-int_{Year}.pdf
- 1099-MISC: {Payer}_1099-misc_{Year}.pdf
- Invoice: {Client}_Invoice_{Year}-{MM}.pdf
- Receipt/Expense: {Vendor}_{category}_{Description}_{Date}.ext
  Categories: meals, software, equipment, travel, office, childcare, medical
- Crypto: {Source}_Crypto_{Year}.ext
- Return: Return_filed_{Year}.pdf
- Contract/W-9: {Company}_W9_{Year}.pdf
- Formation: Articles_of_Organization.pdf
- EIN: EIN_Letter.pdf
- License: Business_License_{Year}.pdf
- Operating Agreement: Operating_Agreement.pdf
- Insurance Policy: {Provider}_Insurance_Policy_{Year}.pdf
- 1099-Composite: {Brokerage}_1099-composite_{Year}.pdf
- 1098 Mortgage Interest: {Lender}_1098_{Year}.pdf
- Retirement Statement: {Institution}_Retirement_{Year}.pdf
- Bank Statement: {Institution}_Bank_Statement_{Year}-{MM}.pdf
- Credit Card Statement: {Issuer}_CC_Statement_{Year}-{MM}.pdf
- Statement: {Institution}_Statement_{Year}-{MM}.pdf
- Certificate: {Issuer}_Certificate_{Year}.pdf
- Medical Record: {Provider}_Medical_Record_{Date}.pdf
- Appraisal: {Subject}_Appraisal_{Year}.pdf

Respond ONLY with valid JSON. No markdown.`,
          messages: [
            {
              role: 'user',
              content: [
                fileContent,
                {
                  type: 'text',
                  text: `Analyze this document (current tax year context: ${taxYear}). Return JSON with TWO sections:

1. "naming" - for filename generation:
{
  "source": "Company or vendor name (plain text, spaces ok)",
  "documentType": "w2|1099-nec|1099-misc|1099-div|1099-int|1099-b|1099-composite|1099-r|1098|retirement-statement|receipt|invoice|crypto|return|contract|formation|ein-letter|license|business-agreement|operating-agreement|insurance-policy|bank-statement|credit-card-statement|statement|letter|certificate|medical-record|appraisal|other",
  "expenseCategory": "meals|software|equipment|travel|office-supplies|professional-services|utilities|insurance|taxes-licenses|childcare|medical|education|other" (only if receipt/expense),
  "description": "short description if receipt" (optional),
  "year": YYYY (the year from the document - tax year for W-2/1099, or date year for receipts/invoices),
  "month": 1-12 (if visible on document),
  "day": 1-31 (if visible on document)
}

IMPORTANT: If a document is a PAYMENT RECEIPT or CONFIRMATION for a filing fee (e.g. annual report filing fee, state registration fee, business license renewal), classify it as "receipt" with expenseCategory "taxes-licenses".

2. "parsedData" - full extracted data from the document:
- For receipts/expenses: { vendor, vendorAddress, amount, totalAmount, subtotal, tax, date (YYYY-MM-DD), paymentMethod, lastFourCard, items: [{description, quantity, price}], category }
- For W-2: { employerName, ein, wages, federalWithheld, stateWithheld, socialSecurityWages, socialSecurityTax, medicareWages, medicareTax, etc }
- For 1099-NEC: { payerName, nonemployeeCompensation, federalWithheld, etc }
- For 1099-DIV: { payerName, ordinaryDividends, qualifiedDividends, federalWithheld, etc }
- For 1099-INT: { payerName, interestIncome, federalWithheld, etc }
- For 1098: { lender, loanNumber, borrowerName, mortgageInterest, outstandingPrincipal, mortgageInsurancePremiums, pointsPaid, propertyAddress, propertyTax, taxYear }
- For invoices: { vendor, amount, date, invoiceNumber, items, etc }
- For retirement statements: { institution, accountType, accountNumber, employerContributions, employeeContributions, totalContributions, taxYear }
- For bank statements: { institution, accountType, accountNumber (last 4), totalDeposits (sum of all credits/deposits for the period), depositCount (number of deposit transactions), endingBalance (closing balance at end of statement period), startDate (YYYY-MM-DD), endDate (YYYY-MM-DD), periodLabel (e.g. "January 2025") }
- For credit card statements: { institution, accountType (e.g. "Business Credit Card"), accountNumber (last 4), endingBalance (statement closing balance / amount owed), startDate (YYYY-MM-DD), endDate (YYYY-MM-DD), periodLabel (e.g. "December 2025") }
- Include ALL visible fields. All monetary values as numbers.

Return: { "naming": {...}, "parsedData": {...} }`,
                },
              ],
            },
          ],
        })
      );

      const textContent = response.content.find((c) => c.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        return jsonResponse({ error: 'No response from AI' }, 500);
      }

      let jsonStr = textContent.text;
      const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }

      const parsed = JSON.parse(jsonStr);

      // Support both formats: nested { naming, parsedData } or flat (legacy)
      const suggestion = parsed.naming || parsed;
      const parsedData = parsed.parsedData || null;

      console.log(`[AI Filename] Suggested for ${filename}:`, suggestion);
      if (parsedData) {
        console.log(`[AI Filename] Parsed data keys:`, Object.keys(parsedData));
      }

      return jsonResponse({ ok: true, suggestion, parsedData });
    } catch (err) {
      console.error('[AI Filename] Error:', err);
      return jsonResponse({ error: 'Failed to analyze file', details: String(err) }, 500);
    }
  }

  // ========================================================================
  // Zip Download
  // ========================================================================

  // Downloads (extracted to routes/downloads.ts)
  const downloadResponse = await handleDownloadRoutes(req, url, pathname);
  if (downloadResponse) return downloadResponse;


  // ========================================================================
  // Static file serving (built frontend)
  // ========================================================================

  // Only serve static files for non-API routes
  if (!pathname.startsWith('/api/')) {
    const STATIC_DIR = path.join(__dirname, '..', 'dist');

    try {
      // Try to serve the exact file requested
      let filePath = path.join(STATIC_DIR, pathname);

      // Security: ensure we're within STATIC_DIR
      const resolvedPath = path.resolve(filePath);
      if (!resolvedPath.startsWith(path.resolve(STATIC_DIR))) {
        return jsonResponse({ error: 'Access denied' }, 403);
      }

      let file = Bun.file(filePath);
      if (await file.exists()) {
        return new Response(file, {
          headers: {
            'Content-Type': getMimeType(filePath) || 'application/octet-stream',
            'Cache-Control': pathname.includes('/assets/')
              ? 'public, max-age=31536000, immutable'
              : 'no-cache',
          },
        });
      }

      // SPA fallback: serve index.html for client-side routes
      filePath = path.join(STATIC_DIR, 'index.html');
      file = Bun.file(filePath);
      if (await file.exists()) {
        return new Response(file, {
          headers: {
            'Content-Type': 'text/html',
            'Cache-Control': 'no-cache',
          },
        });
      }
    } catch {
      // Static dir doesn't exist (dev mode) — fall through to 404
    }
  }

  // 404 for unmatched routes
  return jsonResponse({ error: 'Not found' }, 404);
}

// ============================================================================
// Scheduler (extracted to scheduler.ts)
import { startScheduler, takePortfolioSnapshot, runDropboxSync } from './scheduler.js';


// ============================================================================
// Start server using Bun's native server
// ============================================================================

const server = Bun.serve({
  port: PORT,
  fetch: handleRequest,
  idleTimeout: 120, // 2 minutes for AI parsing
  maxRequestBodySize: 1024 * 1024 * 1024, // 1 GB — large PDFs, manuals, etc.
});

console.log(`DocVault API server running on http://localhost:${server.port}`);
console.log(`Data directory: ${DATA_DIR}`);
