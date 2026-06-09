import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from './logger.js';
import { parseWithAI } from './parsers/ai.js';
import { withAILimit } from './aiLimiter.js';
import { geocodePlace } from './weather.js';

// Shared data layer — all types, constants, loaders, and utilities
import {
  DATA_DIR,
  RCLONE_CONFIG_PATH,
  SYNC_SCRIPT_PATH,
  SYNC_SCRIPT_DATA_PATH,
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
  getCodexAuthStatus,
  saveSettings,
  migrateSettingsEncryption,
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
  resolveUnder,
  realpathUnder,
  ensureDir,
  jsonResponse,
  corsHeaders,
  getEntityPath,
  monthsBetween,
  createSession,
  isValidSession,
  getSessionToken,
  sessionCookie,
  sessions,
  isAuthenticated,
  snapshotFileForYear,
  loadSnapshotsForYear,
  getClaudeModel,
  getAnthropicKey,
  assertAuthConfiguredForStartup,
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

import { isValidTimeZone, getConfiguredTimezone } from './tz.js';

// Route modules
import { handleFinancialSnapshotRoutes } from './routes/financial-snapshot.js';
import { handleHealthSnapshotRoutes } from './routes/health-snapshot.js';
import { handleDownloadRoutes } from './routes/downloads.js';
import { handleCryptoRoutes } from './routes/crypto.js';
import { handleQuantRoutes } from './routes/quant.js';
import { handleQuantTickerRoutes } from './routes/quant-tickers.js';
import { handleBrokersRoutes } from './routes/brokers.js';
import { handleSalesRoutes } from './routes/sales.js';
import { handleMileageRoutes } from './routes/mileage.js';
import { handleGoldRoutes } from './routes/gold.js';
import { handlePropertyRoutes } from './routes/property.js';
import { handleIncomeRoutes } from './routes/income.js';
import { handleLiabilityRoutes } from './routes/liabilities.js';
import { handleAccountAnnotationRoutes } from './routes/account-annotations.js';
import { handleMiscRoutes } from './routes/misc.js';
import { handleHealthRoutes } from './routes/health.js';
import { handleDNARoutes } from './routes/dna.js';
import { handleAncestryRoutes } from './routes/ancestry.js';
import { handleNutritionRoutes } from './routes/nutrition.js';
import { handleSicknessRoutes } from './routes/sickness.js';
import { handleHealthAnalysisRoutes } from './routes/health-analysis.js';
import { handleStrategyRoutes } from './routes/strategy.js';
import { handleResearchRoutes, recoverStaleTranscriptions } from './routes/research.js';
import { handlePoliticsRoutes } from './routes/politics.js';
import { handleJobRoutes } from './routes/jobs.js';
import { handlePoliticalJobRoutes } from './routes/political-jobs.js';
import { handleCryptoYieldsRoutes } from './routes/crypto-yields.js';
import { handleChatRoutes } from './routes/chat.js';
import { handleTranscribeRoutes } from './routes/transcribe.js';
import { handleExternalSourcesRoutes } from './routes/external-sources.js';
import { handleBrainRoutes } from './routes/brain.js';
import { handleFormsRoutes } from './routes/forms.js';
import { handleDeepResearchRoutes } from './routes/deep-research.js';
import { handleDailyNewsRoutes } from './routes/daily-news.js';
import { handleModelsRoutes } from './routes/models.js';
import { handleCodexAuthRoutes } from './routes/codex-auth.js';
import { handleBackupRoutes } from './routes/backup.js';
import {
  handleBrokerIntegrationRoutes,
  handlePortfolioSnapshotRoutes,
} from './routes/broker-integrations.js';
import {
  handleAuthRoutes,
  handleSettingsRoutes,
  rejectUnauthorizedApiRequest,
} from './routes/system.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Module-level loggers
const logHttp = createLogger('HTTP');
const logClaude = createLogger('Claude');
const logSnaptrade = createLogger('SnapTrade');
const logSimplefin = createLogger('SimpleFIN');
const logGeo = createLogger('Geo');

// Noisy routes to skip HTTP logging (frequent health-check style polls)
const SILENT_ROUTES = new Set(['/api/status', '/api/config']);

const SMALL_REQUEST_BODY_LIMIT_BYTES = 10 * 1024 * 1024;
const LARGE_REQUEST_BODY_LIMIT_BYTES = 512 * 1024 * 1024;
const LARGE_BODY_ROUTE_PREFIXES = [
  '/api/upload',
  '/api/research/files/',
  '/api/research/upload',
  '/api/health/import',
  '/api/forms',
  '/api/transcribe',
  '/api/dna/upload',
  '/api/ancestry/upload',
  '/api/nutrition',
  '/api/gold/receipt',
];

function requestBodyLimitFor(pathname: string, method: string): number | null {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null;
  if (LARGE_BODY_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return LARGE_REQUEST_BODY_LIMIT_BYTES;
  }
  return SMALL_REQUEST_BODY_LIMIT_BYTES;
}

function rejectOversizedRequest(req: Request, pathname: string): Response | null {
  const limit = requestBodyLimitFor(pathname, req.method);
  if (!limit) return null;
  const declaredLength = Number(req.headers.get('content-length') ?? '0');
  if (!Number.isFinite(declaredLength) || declaredLength <= limit) return null;
  logHttp.warn(
    `[body-limit] rejected ${req.method} ${pathname}: declared=${declaredLength} limit=${limit}`
  );
  return jsonResponse({ error: 'Request body too large' }, 413);
}

function isSafeInlineFileMime(mimeType: string): boolean {
  return mimeType === 'application/pdf' || /^image\/(png|jpe?g|gif|webp)$/i.test(mimeType);
}

function attachmentFilename(filename: string): string {
  return path.basename(filename).replace(/["\r\n]/g, '_') || 'download';
}

// Request Handler
// ============================================================================

export async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pathname = url.pathname;

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (!SILENT_ROUTES.has(pathname)) {
    logHttp.info(`${req.method} ${pathname}`);
  }

  const oversized = rejectOversizedRequest(req, pathname);
  if (oversized) return oversized;

  const authResponse = await handleAuthRoutes(req, pathname);
  if (authResponse) return authResponse;

  const unauthorized = rejectUnauthorizedApiRequest(req, pathname);
  if (unauthorized) return unauthorized;

  const settingsResponse = await handleSettingsRoutes(req, pathname);
  if (settingsResponse) return settingsResponse;

  const backupResponse = await handleBackupRoutes(req, pathname);
  if (backupResponse) return backupResponse;

  // crypto routes (extracted to routes/crypto.ts)
  const cryptoResponse = await handleCryptoRoutes(req, url, pathname);
  if (cryptoResponse) return cryptoResponse;
  // brokers routes (extracted to routes/brokers.ts)
  const brokersResponse = await handleBrokersRoutes(req, url, pathname);
  if (brokersResponse) return brokersResponse;
  // quant ticker prices (extracted to routes/quant-tickers.ts) — matched
  // before the broader quant routes so the prices endpoint always wins.
  const quantTickerResponse = await handleQuantTickerRoutes(req, url, pathname);
  if (quantTickerResponse) return quantTickerResponse;

  // quant routes (extracted to routes/quant.ts)
  const quantResponse = await handleQuantRoutes(req, url, pathname);
  if (quantResponse) return quantResponse;

  // Generic Jobs API — one surface for built-in scheduler tasks and local custom jobs
  const jobsResponse = await handleJobRoutes(req, url, pathname);
  if (jobsResponse) return jobsResponse;

  // Legacy political job manifest API kept for compatibility with the initial Politics prototype
  const politicalJobResponse = await handlePoliticalJobRoutes(req, url, pathname);
  if (politicalJobResponse) return politicalJobResponse;

  const portfolioSnapshotResponse = await handlePortfolioSnapshotRoutes(req, url, pathname);
  if (portfolioSnapshotResponse) return portfolioSnapshotResponse;

  const brokerIntegrationResponse = await handleBrokerIntegrationRoutes(req, url, pathname);
  if (brokerIntegrationResponse) return brokerIntegrationResponse;

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

    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(String(id))) {
      return jsonResponse({ error: 'Invalid entity id' }, 400);
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
    if (body.metadata !== undefined) {
      // Merge metadata (shallow merge — allows setting individual keys, null deletes)
      const existing = config.entities[entityIndex].metadata || {};
      const merged = { ...existing, ...body.metadata };
      // Remove keys set to null (deletion signal)
      for (const [key, value] of Object.entries(merged)) {
        if (value === null) delete merged[key];
      }
      config.entities[entityIndex].metadata = merged;
    }

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

    const yearPath = resolveUnder(entityPath, year);
    if (!yearPath) return jsonResponse({ error: 'Access denied' }, 403);

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

    const yearPath = resolveUnder(entityPath, year);
    if (!yearPath) return jsonResponse({ error: 'Access denied' }, 403);

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

    const fullPath = resolveUnder(entityPath, filePath);
    if (!fullPath) {
      return jsonResponse({ error: 'Access denied' }, 403);
    }

    try {
      await fs.access(fullPath);
      const realPath = await realpathUnder(entityPath, fullPath);
      if (!realPath) {
        logHttp.warn(`[file] rejected symlink escape for entity=${entityId}`);
        return jsonResponse({ error: 'Access denied' }, 403);
      }
      const stats = await fs.stat(realPath);

      if (stats.isDirectory()) {
        return jsonResponse({ error: 'Path is a directory' }, 400);
      }

      const content = await fs.readFile(realPath);
      const detectedMimeType = getMimeType(fullPath);
      const inline = isSafeInlineFileMime(detectedMimeType);
      const headers: Record<string, string> = {
        'Content-Type': inline ? detectedMimeType : 'application/octet-stream',
        'Content-Length': String(stats.size),
        'X-Content-Type-Options': 'nosniff',
        ...corsHeaders(),
      };
      if (!inline) {
        headers['Content-Disposition'] = `attachment; filename="${attachmentFilename(fullPath)}"`;
      }

      return new Response(content, { headers });
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

    const fullPath = resolveUnder(entityPath, filePath);
    if (!fullPath) {
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

    if (filename !== path.basename(filename) || filename === '.' || filename === '..') {
      return jsonResponse({ error: 'Invalid filename' }, 400);
    }

    const fullDir = resolveUnder(entityPath, destPath);
    if (!fullDir) {
      return jsonResponse({ error: 'Access denied' }, 403);
    }
    let finalFilename = filename;
    let fullPath = path.join(fullDir, finalFilename);

    try {
      await ensureDir(fullDir);

      // Avoid silent overwrites: append _2, _3, etc. if file exists
      const ext = path.extname(filename);
      const base = filename.slice(0, -ext.length || undefined);
      let counter = 2;
      while (true) {
        try {
          await fs.access(fullPath);
          // File exists — try next suffix
          finalFilename = `${base}_${counter}${ext}`;
          fullPath = path.join(fullDir, finalFilename);
          counter++;
        } catch {
          break; // File doesn't exist — safe to write
        }
      }

      const body = await req.arrayBuffer();
      await fs.writeFile(fullPath, Buffer.from(body));

      return jsonResponse({ ok: true, path: path.join(destPath, finalFilename) });
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

    const fullPath = resolveUnder(entityPath, dirPath);
    if (!fullPath) {
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

    const fullPath = resolveUnder(entityPath, filePath);
    if (!fullPath) {
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
      logClaude.info(`Using Claude Vision AI for ${filename}`);
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

    const yearPath = resolveUnder(entityPath, year);
    if (!yearPath) return jsonResponse({ error: 'Access denied' }, 403);

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

              logClaude.info(`[Parse All] Using Claude Vision AI for ${file.name}`);
              const aiData = await parseWithAI(fullPath, file.name);
              if (aiData) {
                parsedData = {
                  ...parsedData,
                  ...aiData,
                };
                await setParsedDataForFile(`${entityId}/${file.path}`, parsedData);
                parsed++;
              } else {
                logClaude.warn(`AI returned no data for ${file.name}`);
                failed++;
              }
            } catch (err) {
              logClaude.error(`Failed to parse ${file.path}: ${err}`);
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

    const resolvedEntityId = entityId || 'personal';
    const entityPath = await getEntityPath(resolvedEntityId);
    if (!entityPath) {
      return jsonResponse({ error: 'Entity not found' }, 404);
    }

    const fromPath = resolveUnder(entityPath, from);
    const toPath = resolveUnder(entityPath, to);

    if (!fromPath || !toPath) {
      return jsonResponse({ error: 'Access denied' }, 403);
    }

    try {
      await ensureDir(path.dirname(toPath));
      try {
        await fs.access(toPath);
        return jsonResponse({ error: 'Destination already exists' }, 409);
      } catch {
        // Destination does not exist — safe to move.
      }

      await fs.rename(fromPath, toPath);

      const oldKey = `${resolvedEntityId}/${from}`;
      const newKey = `${resolvedEntityId}/${to}`;

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

    const oldFullPath = resolveUnder(entityPath, filePath);
    if (!oldFullPath) {
      return jsonResponse({ error: 'Access denied' }, 403);
    }
    const dir = path.dirname(oldFullPath);
    const newFullPath = resolveUnder(dir, newFilename);

    if (!newFullPath || !resolveUnder(entityPath, path.relative(entityPath, newFullPath))) {
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

    const fullFromPath = resolveUnder(fromEntityPath, from);
    const fullToPath = resolveUnder(toEntityPath, to);

    // Security check
    if (!fullFromPath || !fullToPath) {
      return jsonResponse({ error: 'Access denied' }, 403);
    }

    try {
      // Check source file exists
      await fs.access(fullFromPath);

      // Create destination directory
      await ensureDir(path.dirname(fullToPath));

      try {
        await fs.access(fullToPath);
        return jsonResponse({ error: 'Destination already exists' }, 409);
      } catch {
        // Destination does not exist — safe to move.
      }

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
        const documents: {
          name: string;
          path: string;
          type: string;
          parsedData: ParsedData | null;
        }[] = [];
        for (const file of files) {
          const parsedKey = `${entity.id}/${file.path}`;
          const parsed = parsedDataMap[parsedKey] || null;
          const meta = metadataMap[parsedKey];
          if (meta?.tracked === false) continue;
          documents.push({ name: file.name, path: file.path, type: file.type, parsedData: parsed });
        }

        // Use analytics extractors for income and expenses
        const analyticsFiles = files.map((f) => ({ name: f.name, path: f.path, type: f.type }));
        const incomeSummary = getIncomeSummary(
          entity.id,
          year,
          parsedDataMap,
          metadataMap,
          analyticsFiles
        );
        const expenseSummary = getExpenseSummary(
          entity.id,
          year,
          parsedDataMap,
          metadataMap,
          analyticsFiles
        );

        summary[entity.id] = {
          entity,
          documents,
          income: incomeSummary.items.map((i) => ({
            source: i.source,
            amount: i.amount,
            type: i.type,
          })),
          expenses: expenseSummary.expenses.map((e) => ({
            vendor: e.vendor,
            amount: e.amount,
            category: e.category,
          })),
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
      const {
        getIncomeSummary,
        getExpenseSummary,
        getBankDepositSummary,
        getInvoiceSummary,
        getRetirementSummary,
      } = await import('./analytics/index.js');

      // Support "all" entity by iterating all tax entities
      const entities =
        entityId === 'all'
          ? config.entities.filter((e) => (e as Record<string, unknown>).type === 'tax')
          : config.entities.filter((e) => e.id === entityId);

      if (entities.length === 0) {
        return jsonResponse({ error: 'Entity not found' }, 404);
      }

      // Load sales + mileage data for integration
      const salesData = await loadSalesData();
      const mileageRawData = await loadMileageData();

      // Aggregate across all matching entities
      const allIncome: { items: ReturnType<typeof getIncomeSummary>['items'] } = { items: [] };
      const allExpenses: { expenses: ReturnType<typeof getExpenseSummary>['expenses'] } = {
        expenses: [],
      };
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
      let invoiceTotal = 0,
        invoiceCount = 0;
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
        const invSummary = getInvoiceSummary(
          entity.id,
          year,
          parsedDataMap,
          metadataMap,
          analyticsFiles
        );
        invoiceTotal += invSummary.invoiceTotal;
        invoiceCount += invSummary.invoiceCount;
        for (const cust of invSummary.byCustomer) {
          const existing = invoiceByCustomer.get(cust.customer);
          if (existing) {
            existing.total += cust.total;
            existing.count += cust.count;
          } else {
            invoiceByCustomer.set(cust.customer, { total: cust.total, count: cust.count });
          }
        }

        // Retirement
        const retSummary = getRetirementSummary(
          entity.id,
          year,
          parsedDataMap,
          metadataMap,
          analyticsFiles
        );
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

      // Sales integration — filter by matching entities and year
      const matchingEntityIds = new Set(entities.map((e) => e.id));
      const yearSales = salesData.sales.filter((s) => {
        if (!s.date.startsWith(year)) return false;
        if (entityId === 'all') return true;
        return s.entity === entityId || (!s.entity && matchingEntityIds.has(entityId));
      });
      const salesTotal = yearSales.reduce((sum, s) => sum + s.total, 0);
      const salesCount = yearSales.length;

      // Mileage integration — filter by matching entities and year
      const yearMileage = mileageRawData.entries.filter((e) => {
        if (!e.date.startsWith(year)) return false;
        if (entityId === 'all') return true;
        return e.entity === entityId || (!e.entity && matchingEntityIds.has(entityId));
      });
      const mileageTotal = yearMileage.reduce((sum, e) => sum + (e.tripMiles || 0), 0);
      const mileageCount = yearMileage.length;
      const mileageDeduction = mileageTotal * mileageRawData.irsRate;

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
          totalIncome: totalW2 + total1099 + totalK1 + totalCapGains + salesTotal,
          salesTotal,
          salesCount,
          items: allIncome.items,
        },
        expenses: {
          items: expenseItems.sort((a, b) => b.total - a.total),
          totalExpenses,
          totalDeductible: totalDeductible + mileageDeduction,
          mileageTotal,
          mileageDeduction,
          mileageCount,
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
      return jsonResponse({ error: 'Failed to generate analytics', details: String(err) }, 500);
    }
  }

  // Financial snapshot (extracted to routes/financial-snapshot.ts)
  const snapshotResponse = await handleFinancialSnapshotRoutes(req, url, pathname);
  if (snapshotResponse) return snapshotResponse;

  // Health snapshot — consolidated per-person Apple Health + clinical + DNA
  // for LLM consumption. Registered before handleHealthRoutes so the top-level
  // `/api/health-snapshot` path is matched here; handleHealthRoutes only cares
  // about `/api/health/*` so there's no regex collision, but the ordering
  // documents the routing intent.
  const healthSnapshotResponse = await handleHealthSnapshotRoutes(req, url, pathname);
  if (healthSnapshotResponse) return healthSnapshotResponse;
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

  // income routes (additional recurring income sources)
  const incomeResponse = await handleIncomeRoutes(req, url, pathname);
  if (incomeResponse) return incomeResponse;

  // liability routes (manual debts not tracked by SimpleFIN)
  const liabilityResponse = await handleLiabilityRoutes(req, url, pathname);
  if (liabilityResponse) return liabilityResponse;

  // account annotation routes (rates/types for SimpleFIN accounts)
  const annotationResponse = await handleAccountAnnotationRoutes(req, url, pathname);
  if (annotationResponse) return annotationResponse;

  // DNA routes (ancestry/23andMe raw data — encrypted at rest with master key)
  // Registered before health so the `/api/health/:personId/dna/*` prefix
  // is dispatched here; health's regex doesn't touch /dna/* paths but order
  // makes the routing intent explicit.
  const dnaResponse = await handleDNARoutes(req, url, pathname);
  if (dnaResponse) return dnaResponse;

  // Ancestry routes — ethnicity-report screenshot/PDF uploads, vision-parsed
  // to structured regions + journeys. Same encrypt-at-rest pattern as DNA;
  // source image and parsed JSON both protected by the master key.
  const ancestryResponse = await handleAncestryRoutes(req, url, pathname);
  if (ancestryResponse) return ancestryResponse;

  // Nutrition routes — supplement/food label parsing + dose tracking.
  // Same registration pattern as DNA: the nutrition regex catches
  // `/api/health/:personId/nutrition/*` before handleHealthRoutes sees it.
  const nutritionResponse = await handleNutritionRoutes(req, url, pathname);
  if (nutritionResponse) return nutritionResponse;

  // Sickness routes — manually-logged illness episodes with symptoms + meds.
  // Registered before handleHealthRoutes so `/api/health/:personId/sickness/*`
  // dispatches here.
  const sicknessResponse = await handleSicknessRoutes(req, url, pathname);
  if (sicknessResponse) return sicknessResponse;

  // health routes (Apple Health exports, people, parsed summaries)
  const healthResponse = await handleHealthRoutes(req, url, pathname);
  if (healthResponse) return healthResponse;

  // Health analysis routes — AI-generated health narratives (like strategy
  // for financial). Pre-health-prefix so there's no regex collision.
  const healthAnalysisResponse = await handleHealthAnalysisRoutes(req, url, pathname);
  if (healthAnalysisResponse) return healthAnalysisResponse;

  // strategy routes (AI-generated investment strategy history)
  const strategyResponse = await handleStrategyRoutes(req, url, pathname);
  if (strategyResponse) return strategyResponse;

  // Politics feed — in-container ingest of bills, executive actions, and trades
  const politicsResponse = await handlePoliticsRoutes(req, url, pathname);
  if (politicsResponse) return politicsResponse;

  // research routes (analyst PDF uploads + text extraction for Quant/Politics sections)
  const researchResponse = await handleResearchRoutes(req, url, pathname);
  if (researchResponse) return researchResponse;

  // chat routes (mobile chat with agentic tool calls against the vault)
  const chatResponse = await handleChatRoutes(req, url, pathname);
  if (chatResponse) return chatResponse;

  const externalSourcesResponse = await handleExternalSourcesRoutes(req, url, pathname);
  if (externalSourcesResponse) return externalSourcesResponse;

  // Brain — the user-owned markdown long-term memory the chat always sees.
  const brainResponse = await handleBrainRoutes(req, url, pathname);
  if (brainResponse) return brainResponse;

  const formsResponse = await handleFormsRoutes(req, url, pathname);
  if (formsResponse) return formsResponse;

  const deepResearchResponse = await handleDeepResearchRoutes(req, url, pathname);
  if (deepResearchResponse) return deepResearchResponse;

  // Daily News — scheduled newspaper editions + the email-test endpoint.
  const dailyNewsResponse = await handleDailyNewsRoutes(req, url, pathname);
  if (dailyNewsResponse) return dailyNewsResponse;

  const modelsResponse = await handleModelsRoutes(req, url, pathname);
  if (modelsResponse) return modelsResponse;

  const codexAuthResponse = await handleCodexAuthRoutes(req, url, pathname);
  if (codexAuthResponse) return codexAuthResponse;

  // voice transcription proxy (forwards audio to a configurable
  // OpenAI-compatible /audio/transcriptions service — whisper.cpp,
  // faster-whisper-server, parakeet-mlx, …)
  const transcribeResponse = await handleTranscribeRoutes(req, url, pathname);
  if (transcribeResponse) return transcribeResponse;

  // crypto yields overlay (APY per source/asset, merged into balances at render
  // time — see routes/crypto-yields.ts for why this is separate from the balance cache)
  const cryptoYieldsResponse = await handleCryptoYieldsRoutes(req, url, pathname);
  if (cryptoYieldsResponse) return cryptoYieldsResponse;

  // ========================================================================
  // Geocode API (Geoapify proxy)
  // ========================================================================

  // GET /api/geocode/enabled - Check if Geoapify API key is configured
  if (pathname === '/api/geocode/enabled' && req.method === 'GET') {
    const settings = await loadSettings();
    return jsonResponse({ enabled: !!settings.geoapifyApiKey });
  }

  // GET /api/weather/geocode?q=... - keyless place lookup (Open-Meteo) for the
  // Daily News weather location picker (no Geoapify key required).
  if (pathname === '/api/weather/geocode' && req.method === 'GET') {
    return jsonResponse({ results: await geocodePlace(url.searchParams.get('q') ?? '') });
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
      logGeo.error(`Autocomplete error: ${err}`);
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
      logGeo.error(`Routing error: ${err}`);
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
      quantRefreshEnabled: schedules.quantRefreshEnabled !== false,
      quantRefreshIntervalMinutes:
        schedules.quantRefreshIntervalMinutes || DEFAULT_QUANT_REFRESH_INTERVAL,
      politicsRefreshEnabled: schedules.politicsRefreshEnabled !== false,
      politicsRefreshIntervalMinutes:
        schedules.politicsRefreshIntervalMinutes || DEFAULT_POLITICS_REFRESH_INTERVAL,
      dailyNewsEnabled: schedules.dailyNewsEnabled === true,
      dailyNewsHour: schedules.dailyNewsHour ?? 7,
      dailyNewsWeeklyDay: schedules.dailyNewsWeeklyDay ?? 0,
      timezone: getConfiguredTimezone(settings),
      backupPasswordSet: !!schedules.backupPassword,
    });
  }

  // GET /api/schedule-status - Per-task last-ran timestamps + last error
  if (pathname === '/api/schedule-status' && req.method === 'GET') {
    const status = await loadScheduleStatus();
    return jsonResponse(status);
  }

  // GET /api/logs - Recent log entries
  //   ?dates=1                      — list available historical log dates (no entries)
  //   ?date=YYYY-MM-DD              — read that day's persisted log from disk
  //   (no date)                     — live ring buffer for this process
  //   ?level=info|warn|error|debug  — filter by level
  //   ?limit=N                      — cap result count
  if (pathname === '/api/logs' && req.method === 'GET') {
    if (url.searchParams.get('dates') === '1') {
      const dates = await listLogDates();
      return jsonResponse({ dates });
    }

    const level = url.searchParams.get('level') as 'info' | 'warn' | 'error' | 'debug' | null;
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 200, 1000) : 200;
    const date = url.searchParams.get('date');

    if (date) {
      const entries = await readLogsForDate(date, { level: level || undefined, limit });
      return jsonResponse({ entries, source: 'disk', date });
    }

    return jsonResponse({
      entries: getRecentLogs({ level: level || undefined, limit }),
      source: 'buffer',
    });
  }

  // GET /api/ai-usage - Per-call Claude API usage log + aggregate summary.
  //   ?limit=N — cap the number of recent entries returned (default 100, max 1000)
  //   ?summary=1 — include aggregate totals (cost, tokens, per-model, per-purpose)
  if (pathname === '/api/ai-usage' && req.method === 'GET') {
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 100, 1000) : 100;
    const wantSummary = url.searchParams.get('summary') === '1';
    const entries = await readRecentAiCalls(limit);
    const summary = wantSummary ? await summarizeUsage() : undefined;
    return jsonResponse({ entries, summary });
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
        quantRefreshEnabled: body.quantRefreshEnabled ?? true,
        quantRefreshIntervalMinutes:
          body.quantRefreshIntervalMinutes || DEFAULT_QUANT_REFRESH_INTERVAL,
        politicsRefreshEnabled: body.politicsRefreshEnabled ?? true,
        politicsRefreshIntervalMinutes:
          body.politicsRefreshIntervalMinutes || DEFAULT_POLITICS_REFRESH_INTERVAL,
        dailyNewsEnabled: body.dailyNewsEnabled === true,
        dailyNewsHour:
          typeof body.dailyNewsHour === 'number'
            ? Math.min(Math.max(Math.round(body.dailyNewsHour), 0), 23)
            : (settings.schedules?.dailyNewsHour ?? 7),
        dailyNewsWeeklyDay:
          typeof body.dailyNewsWeeklyDay === 'number'
            ? Math.min(Math.max(Math.round(body.dailyNewsWeeklyDay), 0), 6)
            : (settings.schedules?.dailyNewsWeeklyDay ?? 0),
        timezone: isValidTimeZone(body.timezone)
          ? body.timezone
          : (settings.schedules?.timezone ?? 'UTC'),
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

      logClaude.info(`Saved parsed data for ${fileKey}`);
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
  "expenseCategory": "meals|software|equipment|travel|office-supplies|professional-services|utilities|insurance|taxes-licenses|childcare|medical|education|feed|livestock|other" (only if receipt/expense),
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

      logClaude.info(`AI filename suggested for ${filename}: ${JSON.stringify(suggestion)}`);
      if (parsedData) {
        logClaude.debug(`Parsed data keys: ${Object.keys(parsedData).join(', ')}`);
      }

      return jsonResponse({ ok: true, suggestion, parsedData });
    } catch (err) {
      logClaude.error(`AI filename error: ${err}`);
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
import {
  startScheduler,
  takePortfolioSnapshot,
  runDropboxSync,
  loadScheduleStatus,
  DEFAULT_SNAPSHOT_INTERVAL,
  DEFAULT_DROPBOX_SYNC_INTERVAL,
  DEFAULT_QUANT_REFRESH_INTERVAL,
  DEFAULT_POLITICS_REFRESH_INTERVAL,
} from './scheduler.js';
import { getRecentLogs, listLogDates, readLogsForDate, SERVER_BOOT_ID } from './logger.js';
import { readRecentAiCalls, summarizeUsage } from './ai/usage-log.js';
import { startCustomJobScheduler } from './custom-job-runner.js';

// ============================================================================
// Start server using Bun's native server
// ============================================================================

const logServer = createLogger('Server');

if (import.meta.main) {
  // Distinct boot marker — anchors the bootId transition in the UI log view.
  // The UI divides on bootId changes between adjacent rows, but this line
  // also gives a readable "what just happened" message for the first entry
  // after the transition.
  logServer.info(`═══ Server boot · bootId=${SERVER_BOOT_ID.slice(0, 8)} ═══`);

  // Fail-closed: refuse to start if auth is not configured. Tests import
  // handleRequest without entering this block, but a real server process must
  // either have DOCVAULT_PASSWORD or an explicit local/demo opt-in.
  try {
    assertAuthConfiguredForStartup();
  } catch (err) {
    logServer.error(String(err instanceof Error ? err.message : err));
    logServer.error('Refusing to start without authentication or explicit unauthenticated opt-in.');
    process.exit(1);
  }

  // Fail-closed: refuse to start if the master key is missing or too weak.
  // We'd rather crash loudly at boot than silently fall back to plaintext.
  try {
    const { assertMasterKeyConfigured } = await import('./crypto-keys.js');
    assertMasterKeyConfigured();
  } catch (err) {
    logServer.error(String(err instanceof Error ? err.message : err));
    logServer.error('Refusing to start without a master key. See README for setup.');
    process.exit(1);
  }

  // Migrate any legacy plaintext sensitive fields to encrypted form. Idempotent.
  try {
    await migrateSettingsEncryption();
  } catch (err) {
    logServer.error(`Settings encryption migration failed: ${err}`);
    process.exit(1);
  }

  const server = Bun.serve({
    port: PORT,
    fetch: handleRequest,
    idleTimeout: 120, // 2 minutes for AI parsing
    maxRequestBodySize: 2 * 1024 * 1024 * 1024, // 2 GB — large PDFs/manuals + uploaded research video/audio
  });

  logServer.info(`DocVault API running on http://localhost:${server.port}`);
  logServer.info(`Data directory: ${DATA_DIR}`);
  try {
    await startCustomJobScheduler(DATA_DIR);
  } catch (err) {
    logServer.error(
      `Custom job scheduler startup failed: ${err instanceof Error ? err.message : err}`
    );
  }
  try {
    // Any research video/audio transcription left mid-flight by a restart is
    // flipped from pending/running → error so it isn't stuck forever (retry via
    // the Re-transcribe action; the media file is still on disk).
    await recoverStaleTranscriptions();
  } catch (err) {
    logServer.error(
      `Stale transcription recovery failed: ${err instanceof Error ? err.message : err}`
    );
  }
}
