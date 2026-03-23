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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3005;

// Data directory - contains entity subdirectories
const DATA_DIR =
  process.env.DOCVAULT_DATA_DIR ||
  process.env.TAXVAULT_DATA_DIR ||
  path.join(__dirname, '..', 'data');
const CONFIG_PATH = path.join(DATA_DIR, '.docvault-config.json');
const SETTINGS_PATH = path.join(DATA_DIR, '.docvault-settings.json');

// ============================================================================
// Types
// ============================================================================

interface EntityConfig {
  id: string;
  name: string;
  color: string;
  path: string;
  description?: string;
  metadata?: Record<string, string | string[]>;
}

interface Config {
  entities: EntityConfig[];
}

interface CryptoExchangeConfig {
  id: 'coinbase' | 'gemini' | 'kraken';
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
  enabled: boolean;
}

interface CryptoWalletConfig {
  id: string;
  address: string;
  chain: 'btc' | 'eth';
  label: string;
}

const DEFAULT_MODEL = 'claude-sonnet-4-6';

interface Settings {
  anthropicKey?: string;
  claudeModel?: string;
  crypto?: {
    exchanges: CryptoExchangeConfig[];
    wallets: CryptoWalletConfig[];
    etherscanKey?: string;
  };
  brokers?: {
    accounts: BrokerAccount[];
  };
  snaptrade?: SnapTradeConfig;
  simplefin?: SimplefinConfig;
  geoapifyApiKey?: string;
  schedules?: {
    snapshotIntervalMinutes?: number; // default 1440 (24h)
    dropboxSyncIntervalMinutes?: number; // default 15
    dropboxSyncEnabled?: boolean;
    snapshotEnabled?: boolean;
    backupPassword?: string; // if set, encrypted config backup is pushed to Dropbox on sync
  };
}

interface FileInfo {
  name: string;
  path: string;
  size: number;
  lastModified: number;
  type: string;
  isDirectory: boolean;
}

interface ParsedData {
  [key: string]: string | number | boolean | null;
}

// ============================================================================
// Config Management
// ============================================================================

async function loadConfig(): Promise<Config> {
  let config: Config;
  try {
    const content = await fs.readFile(CONFIG_PATH, 'utf-8');
    config = JSON.parse(content);
  } catch {
    // Default config
    config = {
      entities: [{ id: 'personal', name: 'Personal', color: 'blue', path: 'personal' }],
    };
  }

  return config;
}

async function saveConfig(config: Config): Promise<void> {
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// ============================================================================
// Settings Management
// ============================================================================

async function loadSettings(): Promise<Settings> {
  try {
    const content = await fs.readFile(SETTINGS_PATH, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function saveSettings(settings: Settings): Promise<void> {
  await fs.writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

// Get the Claude model
export async function getClaudeModel(): Promise<string> {
  const settings = await loadSettings();
  return settings.claudeModel || DEFAULT_MODEL;
}

// Get the Anthropic API key (settings override environment)
export async function getAnthropicKey(): Promise<string | undefined> {
  // Settings file takes priority (allows override)
  const settings = await loadSettings();
  if (settings.anthropicKey) {
    return settings.anthropicKey;
  }
  // Fall back to environment variable
  return process.env.ANTHROPIC_API_KEY;
}

// ============================================================================
// Helpers
// ============================================================================

function getMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    csv: 'text/csv',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel',
    txf: 'text/plain',
    html: 'text/html',
    js: 'application/javascript',
    mjs: 'application/javascript',
    css: 'text/css',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    eot: 'application/vnd.ms-fontobject',
    map: 'application/json',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ods: 'application/vnd.oasis.opendocument.spreadsheet',
    numbers: 'application/x-iwork-numbers-sffnumbers',
    pages: 'application/x-iwork-pages-sffpages',
    txt: 'text/plain',
    json: 'application/json',
  };
  return mimeTypes[ext || ''] || 'application/octet-stream';
}

async function scanDirectory(dirPath: string, basePath: string = ''): Promise<FileInfo[]> {
  const files: FileInfo[] = [];

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      // Skip hidden files
      if (entry.name.startsWith('.')) continue;

      const fullPath = path.join(dirPath, entry.name);
      const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        // Recursively scan subdirectories
        const subFiles = await scanDirectory(fullPath, relativePath);
        files.push(...subFiles);
      } else {
        const stats = await fs.stat(fullPath);
        files.push({
          name: entry.name,
          path: relativePath,
          size: stats.size,
          lastModified: stats.mtimeMs,
          type: getMimeType(entry.name),
          isDirectory: false,
        });
      }
    }
  } catch (err) {
    console.error(`Error scanning directory ${dirPath}:`, err);
  }

  return files;
}

async function ensureDir(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch {
    // Directory might already exist
  }
}

function jsonResponse(data: object, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

// Get entity path, resolving symlinks
async function getEntityPath(entityId: string): Promise<string | null> {
  const config = await loadConfig();
  const entity = config.entities.find((e) => e.id === entityId);
  if (!entity) return null;

  const entityPath = path.join(DATA_DIR, entity.path);

  // Check if path exists
  try {
    await fs.access(entityPath);
    return entityPath;
  } catch {
    // Try to create it
    await ensureDir(entityPath);
    return entityPath;
  }
}

// ============================================================================
// Parsed Data Storage
// ============================================================================

const PARSED_DATA_FILE = path.join(DATA_DIR, '.docvault-parsed.json');
const LEGACY_PARSED_DATA_FILE = path.join(DATA_DIR, '.taxvault-parsed.json');
const REMINDERS_FILE = path.join(DATA_DIR, '.docvault-reminders.json');

// Migrate legacy parsed data file on first load
let parsedDataMigrated = false;
async function migrateParsedData(): Promise<void> {
  if (parsedDataMigrated) return;
  parsedDataMigrated = true;
  try {
    await fs.access(PARSED_DATA_FILE);
    // New file exists, no migration needed
  } catch {
    try {
      await fs.access(LEGACY_PARSED_DATA_FILE);
      await fs.rename(LEGACY_PARSED_DATA_FILE, PARSED_DATA_FILE);
      console.log('[Migration] Renamed .taxvault-parsed.json -> .docvault-parsed.json');
    } catch {
      // Neither file exists, that's fine
    }
  }
}

async function loadParsedData(): Promise<Record<string, ParsedData>> {
  await migrateParsedData();
  try {
    const content = await fs.readFile(PARSED_DATA_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function saveParsedData(data: Record<string, ParsedData>): Promise<void> {
  await fs.writeFile(PARSED_DATA_FILE, JSON.stringify(data, null, 2));
}

async function _getParsedDataForFile(filePath: string): Promise<ParsedData | null> {
  const allData = await loadParsedData();
  return allData[filePath] || null;
}
void _getParsedDataForFile;

// ============================================================================
// Document Metadata Storage (tags, notes)
// ============================================================================

const METADATA_FILE = path.join(DATA_DIR, '.docvault-metadata.json');

interface DocMetadata {
  tags?: string[];
  notes?: string;
  tracked?: boolean;
}

async function loadMetadata(): Promise<Record<string, DocMetadata>> {
  try {
    const content = await fs.readFile(METADATA_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function saveMetadata(data: Record<string, DocMetadata>): Promise<void> {
  await fs.writeFile(METADATA_FILE, JSON.stringify(data, null, 2));
}

// ============================================================================
// Reminders Storage
// ============================================================================

interface Reminder {
  id: string;
  entityId: string;
  title: string;
  dueDate: string; // ISO date (YYYY-MM-DD)
  recurrence?: 'yearly' | 'monthly' | 'quarterly' | null;
  status: 'pending' | 'completed' | 'dismissed';
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

async function loadReminders(): Promise<Reminder[]> {
  try {
    const content = await fs.readFile(REMINDERS_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return [];
  }
}

async function saveReminders(reminders: Reminder[]): Promise<void> {
  await fs.writeFile(REMINDERS_FILE, JSON.stringify(reminders, null, 2));
}

// ============================================================================
// Business Assets Storage
// ============================================================================

const ASSETS_FILE = path.join(DATA_DIR, '.docvault-assets.json');

interface BusinessAsset {
  id: string;
  name: string;
  value: number;
}

type AssetsData = Record<string, BusinessAsset[]>; // keyed by entity

async function loadAssets(): Promise<AssetsData> {
  try {
    const content = await fs.readFile(ASSETS_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function saveAssets(assets: AssetsData): Promise<void> {
  await fs.writeFile(ASSETS_FILE, JSON.stringify(assets, null, 2));
}

// ============================================================================
// 401k Contributions Storage
// ============================================================================

const CONTRIBUTIONS_FILE = path.join(DATA_DIR, '.docvault-contributions.json');

interface Contribution401k {
  id: string;
  date: string;
  amount: number;
  type: 'employee' | 'employer';
}

// Keyed by "entity/year" e.g. "my-llc/2025"
type ContributionsData = Record<string, Contribution401k[]>;

async function loadContributions(): Promise<ContributionsData> {
  try {
    const content = await fs.readFile(CONTRIBUTIONS_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function saveContributions(data: ContributionsData): Promise<void> {
  await fs.writeFile(CONTRIBUTIONS_FILE, JSON.stringify(data, null, 2));
}

// ============================================================================
// Todos Storage
// ============================================================================

const TODOS_FILE = path.join(DATA_DIR, '.docvault-todos.json');
const SALES_FILE = path.join(DATA_DIR, '.docvault-sales.json');
const MILEAGE_FILE = path.join(DATA_DIR, '.docvault-mileage.json');
const CRYPTO_CACHE_FILE = path.join(DATA_DIR, '.docvault-crypto-cache.json');
const BROKER_CACHE_FILE = path.join(DATA_DIR, '.docvault-broker-cache.json');
const SIMPLEFIN_CACHE_FILE = path.join(DATA_DIR, '.docvault-simplefin-cache.json');

interface PortfolioSnapshot {
  date: string;
  totalValue: number;
  cryptoValue: number;
  brokerValue: number;
  bankValue?: number;
  shortTermGains: number;
  longTermGains: number;
}

function snapshotFileForYear(year: number): string {
  return path.join(DATA_DIR, `.docvault-portfolio-snapshots-${year}.json`);
}

async function loadSnapshotsForYear(year: number): Promise<PortfolioSnapshot[]> {
  try {
    const data = await fs.readFile(snapshotFileForYear(year), 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function loadSnapshots(years?: number[]): Promise<PortfolioSnapshot[]> {
  // If specific years requested, load those; otherwise load current + previous year
  const targetYears = years || [new Date().getFullYear(), new Date().getFullYear() - 1];

  // Also check for legacy single-file format and migrate
  const legacyFile = path.join(DATA_DIR, '.docvault-portfolio-snapshots.json');
  try {
    const legacyData = await fs.readFile(legacyFile, 'utf-8');
    const legacySnapshots: PortfolioSnapshot[] = JSON.parse(legacyData);
    if (legacySnapshots.length > 0) {
      // Migrate: group by year and write to year-based files
      const byYear = new Map<number, PortfolioSnapshot[]>();
      for (const snap of legacySnapshots) {
        const y = parseInt(snap.date.split('-')[0]);
        if (!byYear.has(y)) byYear.set(y, []);
        byYear.get(y)!.push(snap);
      }
      for (const [y, snaps] of byYear) {
        await fs.writeFile(snapshotFileForYear(y), JSON.stringify(snaps, null, 2));
      }
      // Remove legacy file after successful migration
      await fs.unlink(legacyFile);
      console.log(`[snapshots] Migrated ${legacySnapshots.length} snapshots from legacy file`);
    }
  } catch {
    // No legacy file — normal case
  }

  const all: PortfolioSnapshot[] = [];
  for (const year of targetYears) {
    const yearSnapshots = await loadSnapshotsForYear(year);
    all.push(...yearSnapshots);
  }
  return all.sort((a, b) => a.date.localeCompare(b.date));
}

async function saveSnapshot(snapshot: PortfolioSnapshot): Promise<void> {
  const year = parseInt(snapshot.date.split('-')[0]);
  const snapshots = await loadSnapshotsForYear(year);
  // Replace today's snapshot if it exists, otherwise append
  const idx = snapshots.findIndex((s) => s.date === snapshot.date);
  if (idx >= 0) {
    snapshots[idx] = snapshot;
  } else {
    snapshots.push(snapshot);
  }
  await fs.writeFile(snapshotFileForYear(year), JSON.stringify(snapshots, null, 2));
}

interface Todo {
  id: string;
  title: string;
  status: 'pending' | 'completed';
  createdAt: string;
  updatedAt: string;
}

async function loadTodos(): Promise<Todo[]> {
  try {
    const content = await fs.readFile(TODOS_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return [];
  }
}

async function saveTodos(todos: Todo[]): Promise<void> {
  await fs.writeFile(TODOS_FILE, JSON.stringify(todos, null, 2));
}

// ============================================================================
// Sales Storage
// ============================================================================

interface SaleProduct {
  id: string;
  name: string;
  price: number;
}

interface Sale {
  id: string;
  person: string;
  productId: string;
  quantity: number;
  total: number;
  date: string;
  entity?: string;
  createdAt: string;
}

interface SalesData {
  products: SaleProduct[];
  sales: Sale[];
}

async function loadSalesData(): Promise<SalesData> {
  try {
    const content = await fs.readFile(SALES_FILE, 'utf-8');
    const data = JSON.parse(content);
    return {
      products: data.products || [],
      sales: data.sales || [],
    };
  } catch {
    return { products: [], sales: [] };
  }
}

async function saveSalesData(data: SalesData): Promise<void> {
  await fs.writeFile(SALES_FILE, JSON.stringify(data, null, 2));
}

// ============================================================================
// Mileage Storage
// ============================================================================

interface Vehicle {
  id: string;
  name: string;
  year?: number;
  make?: string;
  model?: string;
}

interface MileageEntry {
  id: string;
  date: string;
  vehicleId: string;
  odometerStart?: number;
  odometerEnd?: number;
  tripMiles?: number;
  gallons?: number;
  totalCost?: number;
  purpose?: string;
  entity?: string;
  createdAt: string;
}

interface SavedAddress {
  id: string;
  label: string; // e.g., "Home", "Office"
  formatted: string;
  lat: number;
  lon: number;
}

interface MileageData {
  vehicles: Vehicle[];
  entries: MileageEntry[];
  irsRate: number;
  savedAddresses?: SavedAddress[];
}

async function loadMileageData(): Promise<MileageData> {
  try {
    const content = await fs.readFile(MILEAGE_FILE, 'utf-8');
    const data = JSON.parse(content);
    return {
      vehicles: data.vehicles || [],
      entries: data.entries || [],
      irsRate: data.irsRate ?? 0.70,
      savedAddresses: data.savedAddresses || [],
    };
  } catch {
    return { vehicles: [], entries: [], irsRate: 0.70, savedAddresses: [] };
  }
}

async function saveMileageData(data: MileageData): Promise<void> {
  await fs.writeFile(MILEAGE_FILE, JSON.stringify(data, null, 2));
}

// Queue to serialize writes to parsed data file
let parsedDataWriteQueue: Promise<void> = Promise.resolve();

async function setParsedDataForFile(filePath: string, data: ParsedData): Promise<void> {
  parsedDataWriteQueue = parsedDataWriteQueue.then(async () => {
    const allData = await loadParsedData();
    allData[filePath] = data;
    await saveParsedData(allData);
  });
  await parsedDataWriteQueue;
}

// ============================================================================
// Authentication
// ============================================================================

const AUTH_USERNAME = process.env.DOCVAULT_USERNAME;
const AUTH_PASSWORD = process.env.DOCVAULT_PASSWORD;
const AUTH_ENABLED = !!(AUTH_USERNAME && AUTH_PASSWORD);

// In-memory session store: token -> expiry timestamp
const sessions = new Map<string, number>();
const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 days in seconds
const SESSION_COOKIE = 'docvault_session';

function createSession(): string {
  const token = crypto.randomUUID();
  sessions.set(token, Date.now() + SESSION_MAX_AGE * 1000);
  return token;
}

function isValidSession(token: string): boolean {
  const expiry = sessions.get(token);
  if (!expiry) return false;
  if (Date.now() > expiry) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function getSessionToken(req: Request): string | null {
  const cookie = req.headers.get('cookie');
  if (!cookie) return null;
  const match = cookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  return match ? match[1] : null;
}

function sessionCookie(token: string, maxAge = SESSION_MAX_AGE): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

function isAuthenticated(req: Request): boolean {
  if (!AUTH_ENABLED) return true;
  const token = getSessionToken(req);
  return token !== null && isValidSession(token);
}

// Routes that don't require auth (status must be open so frontend can check auth state)
const PUBLIC_ROUTES = new Set(['/api/login', '/api/status']);

if (AUTH_ENABLED) {
  console.log(`[auth] Authentication enabled for user "${AUTH_USERNAME}"`);
} else {
  console.log('[auth] Authentication disabled (DOCVAULT_USERNAME/DOCVAULT_PASSWORD not set)');
}

// ============================================================================
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
      return jsonResponse({ error: 'No auto-backup found. Set a backup password in Schedules and wait for the next sync cycle.' }, 404);
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

  // GET /api/crypto/settings — get configured exchanges and wallets (keys masked)
  if (pathname === '/api/crypto/settings' && req.method === 'GET') {
    const settings = await loadSettings();
    const cryptoConfig = settings.crypto || { exchanges: [], wallets: [] };
    return jsonResponse({
      exchanges: cryptoConfig.exchanges.map((e) => ({
        id: e.id,
        enabled: e.enabled,
        hasKey: !!e.apiKey,
        keyHint: e.apiKey ? e.apiKey.slice(-4) : undefined,
      })),
      wallets: cryptoConfig.wallets.map((w) => ({
        id: w.id,
        address: w.address,
        chain: w.chain,
        label: w.label,
      })),
      hasEtherscanKey: !!cryptoConfig.etherscanKey,
      etherscanKeyHint: cryptoConfig.etherscanKey ? cryptoConfig.etherscanKey.slice(-4) : undefined,
    });
  }

  // POST /api/crypto/settings — save exchange keys and wallet addresses
  if (pathname === '/api/crypto/settings' && req.method === 'POST') {
    const body = await req.json();
    const settings = await loadSettings();

    if (!settings.crypto) {
      settings.crypto = { exchanges: [], wallets: [] };
    }

    // Handle exchange operations
    if (body.addExchange) {
      const { id, apiKey, apiSecret, passphrase } = body.addExchange;
      if (!id || !apiKey || !apiSecret) {
        return jsonResponse({ error: 'Missing exchange id, apiKey, or apiSecret' }, 400);
      }
      // Remove existing if updating
      settings.crypto.exchanges = settings.crypto.exchanges.filter((e) => e.id !== id);
      settings.crypto.exchanges.push({ id, apiKey, apiSecret, passphrase, enabled: true });
    }

    if (body.removeExchange) {
      settings.crypto.exchanges = settings.crypto.exchanges.filter(
        (e) => e.id !== body.removeExchange
      );
    }

    if (body.toggleExchange) {
      const exchange = settings.crypto.exchanges.find((e) => e.id === body.toggleExchange);
      if (exchange) exchange.enabled = !exchange.enabled;
    }

    // Handle wallet operations
    if (body.addWallet) {
      const { address, chain, label } = body.addWallet;
      if (!address || !chain) {
        return jsonResponse({ error: 'Missing wallet address or chain' }, 400);
      }
      const id = `${chain}-${Date.now()}`;
      settings.crypto.wallets.push({
        id,
        address,
        chain,
        label: label || `${chain.toUpperCase()} Wallet`,
      });
    }

    if (body.removeWallet) {
      settings.crypto.wallets = settings.crypto.wallets.filter((w) => w.id !== body.removeWallet);
    }

    // Handle Etherscan key
    if (body.etherscanKey !== undefined) {
      settings.crypto.etherscanKey = body.etherscanKey || undefined;
    }

    await saveSettings(settings);
    return jsonResponse({ ok: true });
  }

  // GET /api/crypto/balances — fetch live balances from all configured sources
  if (pathname === '/api/crypto/balances' && req.method === 'GET') {
    const settings = await loadSettings();
    const cryptoConfig = settings.crypto || { exchanges: [], wallets: [] };

    if (cryptoConfig.exchanges.length === 0 && cryptoConfig.wallets.length === 0) {
      return jsonResponse({
        sources: [],
        totalUsdValue: 0,
        byAsset: [],
        lastUpdated: new Date().toISOString(),
        message: 'No exchanges or wallets configured. Add them in Settings.',
      });
    }

    // Return cached data without refetching (for page loads)
    const cached = url.searchParams.get('cached') === '1';
    if (cached) {
      try {
        const content = await fs.readFile(CRYPTO_CACHE_FILE, 'utf-8');
        return jsonResponse(JSON.parse(content));
      } catch {
        return jsonResponse({ sources: [], totalUsdValue: 0, byAsset: [], lastUpdated: '' }, 200);
      }
    }

    // Helper to save results to cache file
    const saveCryptoCache = async (portfolio: object) => {
      try {
        await fs.writeFile(CRYPTO_CACHE_FILE, JSON.stringify(portfolio, null, 2));
      } catch {
        // Non-critical — cache write failure doesn't block response
      }
    };

    // Check if client wants streaming progress
    const stream = url.searchParams.get('stream') === '1';

    if (stream) {
      // Stream NDJSON progress lines, then final result
      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        async start(controller) {
          const portfolio = await fetchAllBalances(
            cryptoConfig.exchanges,
            cryptoConfig.wallets,
            cryptoConfig.etherscanKey,
            (current, total, label) => {
              controller.enqueue(
                encoder.encode(JSON.stringify({ type: 'progress', current, total, label }) + '\n')
              );
            }
          );
          await saveCryptoCache(portfolio);
          controller.enqueue(
            encoder.encode(JSON.stringify({ type: 'result', ...portfolio }) + '\n')
          );
          controller.close();
        },
      });

      return new Response(readable, {
        headers: {
          'Content-Type': 'application/x-ndjson',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Cache-Control': 'no-cache',
        },
      });
    }

    // Non-streaming (backwards compatible)
    const portfolio = await fetchAllBalances(
      cryptoConfig.exchanges,
      cryptoConfig.wallets,
      cryptoConfig.etherscanKey
    );
    await saveCryptoCache(portfolio);
    return jsonResponse(portfolio);
  }

  // GET /api/crypto/balances/:sourceId — refresh a single source
  if (pathname.startsWith('/api/crypto/balances/') && req.method === 'GET') {
    const sourceId = decodeURIComponent(pathname.split('/api/crypto/balances/')[1]);
    const settings = await loadSettings();
    const cryptoConfig = settings.crypto || { exchanges: [], wallets: [] };

    try {
      const source = await fetchSourceBalance(
        sourceId,
        cryptoConfig.exchanges,
        cryptoConfig.wallets,
        cryptoConfig.etherscanKey
      );
      // Update the source in the cache file
      try {
        const cacheRaw = await fs.readFile(CRYPTO_CACHE_FILE, 'utf-8');
        const cache = JSON.parse(cacheRaw);
        cache.sources = (cache.sources || []).map((s: { sourceId: string }) =>
          s.sourceId === sourceId ? source : s
        );
        cache.totalUsdValue = cache.sources.reduce(
          (sum: number, s: { totalUsdValue: number }) => sum + s.totalUsdValue,
          0
        );
        cache.lastUpdated = new Date().toISOString();
        await fs.writeFile(CRYPTO_CACHE_FILE, JSON.stringify(cache, null, 2));
      } catch {
        // Cache update is non-critical
      }
      return jsonResponse(source);
    } catch (err) {
      return jsonResponse({ error: err instanceof Error ? err.message : 'Unknown error' }, 404);
    }
  }

  // =========================================================================
  // Broker Portfolio Endpoints
  // =========================================================================

  // GET /api/crypto/gains — compute cost basis and gains from trade history
  if (pathname === '/api/crypto/gains' && req.method === 'GET') {
    const settings = await loadSettings();
    const exchanges = settings.crypto?.exchanges || [];
    const enabledExchanges = exchanges.filter((e) => e.enabled);

    if (enabledExchanges.length === 0) {
      return jsonResponse({ error: 'No exchanges configured' }, 400);
    }

    const cached = searchParams.get('cached');
    const GAINS_CACHE_FILE = path.join(DATA_DIR, '.docvault-crypto-gains.json');

    // Return cached if available and requested
    if (cached === '1') {
      try {
        const data = await fs.readFile(GAINS_CACHE_FILE, 'utf-8');
        return jsonResponse(JSON.parse(data));
      } catch {
        // No cache, fall through to compute
      }
    }

    // Stream progress or compute directly
    const stream = searchParams.get('stream') === '1';
    if (stream) {
      return new Response(
        new ReadableStream({
          async start(controller) {
            const encoder = new TextEncoder();
            const send = (data: unknown) => {
              controller.enqueue(encoder.encode(JSON.stringify(data) + '\n'));
            };

            try {
              const gains = await fetchCryptoGains(exchanges, (current, total, label) => {
                send({ type: 'progress', current, total, label });
              });
              await fs.writeFile(GAINS_CACHE_FILE, JSON.stringify(gains, null, 2));
              send({ type: 'result', data: gains });
            } catch (err) {
              send({ type: 'error', message: err instanceof Error ? err.message : 'Failed' });
            }
            controller.close();
          },
        }),
        { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' } }
      );
    }

    // Non-streaming
    try {
      const gains = await fetchCryptoGains(exchanges);
      await fs.writeFile(GAINS_CACHE_FILE, JSON.stringify(gains, null, 2));
      return jsonResponse(gains);
    } catch (err) {
      return jsonResponse(
        { error: err instanceof Error ? err.message : 'Failed to fetch gains' },
        500
      );
    }
  }

  // GET /api/brokers/accounts — list all broker accounts (no secrets to mask)
  if (pathname === '/api/brokers/accounts' && req.method === 'GET') {
    const settings = await loadSettings();
    return jsonResponse({ accounts: settings.brokers?.accounts || [] });
  }

  // POST /api/brokers/accounts — add a new broker account
  if (pathname === '/api/brokers/accounts' && req.method === 'POST') {
    const body = await req.json();
    const { broker, name } = body;
    if (!broker || !name) {
      return jsonResponse({ error: 'Missing broker or name' }, 400);
    }
    const settings = await loadSettings();
    if (!settings.brokers) settings.brokers = { accounts: [] };
    const id = `${broker}-${Date.now()}`;
    const account: BrokerAccount = { id, broker, name, holdings: [] };
    settings.brokers.accounts.push(account);
    await saveSettings(settings);
    return jsonResponse({ ok: true, account });
  }

  // PUT /api/brokers/accounts/:id — update account (name, holdings)
  if (pathname.startsWith('/api/brokers/accounts/') && req.method === 'PUT') {
    const accountId = decodeURIComponent(pathname.split('/api/brokers/accounts/')[1]);
    const body = await req.json();
    const settings = await loadSettings();
    if (!settings.brokers) return jsonResponse({ error: 'No accounts' }, 404);
    const account = settings.brokers.accounts.find((a) => a.id === accountId);
    if (!account) return jsonResponse({ error: 'Account not found' }, 404);
    if (body.name !== undefined) account.name = body.name;
    if (body.holdings !== undefined) account.holdings = body.holdings;
    await saveSettings(settings);
    return jsonResponse({ ok: true, account });
  }

  // DELETE /api/brokers/accounts/:id — remove an account
  if (pathname.startsWith('/api/brokers/accounts/') && req.method === 'DELETE') {
    const accountId = decodeURIComponent(pathname.split('/api/brokers/accounts/')[1]);
    const settings = await loadSettings();
    if (!settings.brokers) return jsonResponse({ error: 'No accounts' }, 404);
    settings.brokers.accounts = settings.brokers.accounts.filter((a) => a.id !== accountId);
    await saveSettings(settings);
    return jsonResponse({ ok: true });
  }

  // GET /api/brokers/portfolio — get all accounts with live prices
  if (pathname === '/api/brokers/portfolio' && req.method === 'GET') {
    const settings = await loadSettings();
    const accounts = settings.brokers?.accounts || [];
    if (accounts.length === 0) {
      return jsonResponse({
        accounts: [],
        totalValue: 0,
        totalCostBasis: 0,
        totalGainLoss: 0,
        lastUpdated: new Date().toISOString(),
      });
    }

    // Return cached data without refetching (for page loads)
    const cached = url.searchParams.get('cached') === '1';
    if (cached) {
      try {
        const content = await fs.readFile(BROKER_CACHE_FILE, 'utf-8');
        return jsonResponse(JSON.parse(content));
      } catch {
        return jsonResponse(
          { accounts: [], totalValue: 0, totalCostBasis: 0, totalGainLoss: 0, lastUpdated: '' },
          200
        );
      }
    }

    const saveBrokerCache = async (portfolio: object) => {
      try {
        await fs.writeFile(BROKER_CACHE_FILE, JSON.stringify(portfolio, null, 2));
      } catch {
        // Non-critical
      }
    };

    // Check if client wants streaming progress
    const stream = url.searchParams.get('stream') === '1';

    if (stream) {
      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        async start(controller) {
          const portfolio = await buildPortfolio(accounts, (current, total, label) => {
            controller.enqueue(
              encoder.encode(JSON.stringify({ type: 'progress', current, total, label }) + '\n')
            );
          });
          await saveBrokerCache(portfolio);
          controller.enqueue(
            encoder.encode(JSON.stringify({ type: 'result', ...portfolio }) + '\n')
          );
          controller.close();
        },
      });

      return new Response(readable, {
        headers: {
          'Content-Type': 'application/x-ndjson',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Cache-Control': 'no-cache',
        },
      });
    }

    // Non-streaming
    const portfolio = await buildPortfolio(accounts);
    await saveBrokerCache(portfolio);
    return jsonResponse(portfolio);
  }

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
      const taxEntities = config.entities.filter(
        (e) => (e as Record<string, unknown>).type === 'tax'
      );

      const metadataMap = await loadMetadata();

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

        const entitySummary = {
          entity,
          documents: [] as {
            name: string;
            path: string;
            type: string;
            parsedData: ParsedData | null;
          }[],
          income: [] as { source: string; amount: number; type: string }[],
          expenses: [] as { vendor: string; amount: number; category: string }[],
        };

        for (const file of files) {
          const parsedKey = `${entity.id}/${file.path}`;
          const parsed = parsedDataMap[parsedKey] || null;

          // Skip untracked files from summaries
          const meta = metadataMap[parsedKey];
          if (meta?.tracked === false) continue;

          entitySummary.documents.push({
            name: file.name,
            path: file.path,
            type: file.type,
            parsedData: parsed,
          });

          if (parsed) {
            // Extract income
            if (
              parsed.wages ||
              parsed.nonemployeeCompensation ||
              parsed.ordinaryDividends ||
              parsed.interestIncome
            ) {
              entitySummary.income.push({
                source: (parsed.employerName || parsed.payerName || file.name) as string,
                amount:
                  ((parsed.wages ||
                    parsed.nonemployeeCompensation ||
                    parsed.ordinaryDividends ||
                    parsed.interestIncome) as number) || 0,
                type: file.path.includes('w2')
                  ? 'W-2'
                  : file.path.includes('1099')
                    ? '1099'
                    : 'other',
              });
            }

            // Extract K-1 income
            if (
              parsed.documentType === 'k-1' ||
              parsed.ordinaryIncome ||
              parsed.guaranteedPayments
            ) {
              const k1Amount =
                ((parsed.ordinaryIncome as number) || 0) +
                ((parsed.guaranteedPayments as number) || 0);
              if (k1Amount > 0) {
                entitySummary.income.push({
                  source: (parsed.entityName || file.name) as string,
                  amount: k1Amount,
                  type: 'K-1',
                });
              }
            }

            // Extract expenses
            if (parsed.amount && (parsed.vendor || parsed.category)) {
              entitySummary.expenses.push({
                vendor: (parsed.vendor || 'Unknown') as string,
                amount: (parsed.totalAmount || parsed.amount) as number,
                category: (parsed.category || 'other') as string,
              });
            }
          }
        }

        summary[entity.id] = entitySummary;
      }

      return jsonResponse({ year, summary });
    } catch (err) {
      return jsonResponse({ error: 'Failed to generate tax summary', details: String(err) }, 500);
    }
  }

  // ========================================================================
  // Reminders API
  // ========================================================================

  // GET /api/reminders - Get all reminders (optionally filter by entity)
  if (pathname === '/api/reminders' && req.method === 'GET') {
    const entityFilter = url.searchParams.get('entity');
    let reminders = await loadReminders();
    if (entityFilter) {
      reminders = reminders.filter((r) => r.entityId === entityFilter);
    }
    return jsonResponse({ reminders });
  }

  // POST /api/reminders - Create a reminder
  if (pathname === '/api/reminders' && req.method === 'POST') {
    const body = await req.json();
    const { entityId, title, dueDate, recurrence, notes } = body;

    if (!entityId || !title || !dueDate) {
      return jsonResponse({ error: 'Missing entityId, title, or dueDate' }, 400);
    }

    const now = new Date().toISOString();
    const reminder: Reminder = {
      id: crypto.randomUUID(),
      entityId,
      title,
      dueDate,
      recurrence: recurrence || null,
      status: 'pending',
      notes: notes || undefined,
      createdAt: now,
      updatedAt: now,
    };

    const reminders = await loadReminders();
    reminders.push(reminder);
    await saveReminders(reminders);

    return jsonResponse({ ok: true, reminder });
  }

  // PUT /api/reminders/:id - Update a reminder
  const reminderUpdateMatch = pathname.match(/^\/api\/reminders\/([^/]+)$/);
  if (reminderUpdateMatch && req.method === 'PUT') {
    const reminderId = reminderUpdateMatch[1];
    const body = await req.json();

    const reminders = await loadReminders();
    const idx = reminders.findIndex((r) => r.id === reminderId);
    if (idx === -1) {
      return jsonResponse({ error: 'Reminder not found' }, 404);
    }

    const { title, dueDate, recurrence, status, notes } = body;
    if (title !== undefined) reminders[idx].title = title;
    if (dueDate !== undefined) reminders[idx].dueDate = dueDate;
    if (recurrence !== undefined) reminders[idx].recurrence = recurrence;
    if (status !== undefined) reminders[idx].status = status;
    if (notes !== undefined) reminders[idx].notes = notes;
    reminders[idx].updatedAt = new Date().toISOString();

    // If completing a recurring reminder, create the next one
    if (status === 'completed' && reminders[idx].recurrence) {
      const current = new Date(reminders[idx].dueDate);
      let nextDate: Date;
      switch (reminders[idx].recurrence) {
        case 'yearly':
          nextDate = new Date(current);
          nextDate.setFullYear(nextDate.getFullYear() + 1);
          break;
        case 'quarterly':
          nextDate = new Date(current);
          nextDate.setMonth(nextDate.getMonth() + 3);
          break;
        case 'monthly':
          nextDate = new Date(current);
          nextDate.setMonth(nextDate.getMonth() + 1);
          break;
        default:
          nextDate = current;
      }

      const now = new Date().toISOString();
      reminders.push({
        id: crypto.randomUUID(),
        entityId: reminders[idx].entityId,
        title: reminders[idx].title,
        dueDate: nextDate.toISOString().split('T')[0],
        recurrence: reminders[idx].recurrence,
        status: 'pending',
        notes: reminders[idx].notes,
        createdAt: now,
        updatedAt: now,
      });
    }

    await saveReminders(reminders);
    return jsonResponse({ ok: true, reminder: reminders[idx] });
  }

  // DELETE /api/reminders/:id
  const reminderDeleteMatch = pathname.match(/^\/api\/reminders\/([^/]+)$/);
  if (reminderDeleteMatch && req.method === 'DELETE') {
    const reminderId = reminderDeleteMatch[1];
    const reminders = await loadReminders();
    const filtered = reminders.filter((r) => r.id !== reminderId);
    if (filtered.length === reminders.length) {
      return jsonResponse({ error: 'Reminder not found' }, 404);
    }
    await saveReminders(filtered);
    return jsonResponse({ ok: true });
  }

  // ========================================================================
  // Business Assets API
  // ========================================================================

  // GET /api/assets/:entity - Get assets for an entity
  const assetsGetMatch = pathname.match(/^\/api\/assets\/([^/]+)$/);
  if (assetsGetMatch && req.method === 'GET') {
    const entity = assetsGetMatch[1];
    const allAssets = await loadAssets();
    return jsonResponse({ assets: allAssets[entity] || [] });
  }

  // PUT /api/assets/:entity - Replace assets for an entity
  const assetsPutMatch = pathname.match(/^\/api\/assets\/([^/]+)$/);
  if (assetsPutMatch && req.method === 'PUT') {
    const entity = assetsPutMatch[1];
    const body = await req.json();
    const { assets } = body;
    if (!Array.isArray(assets)) {
      return jsonResponse({ error: 'assets must be an array' }, 400);
    }
    const allAssets = await loadAssets();
    allAssets[entity] = assets;
    await saveAssets(allAssets);
    return jsonResponse({ ok: true, assets });
  }

  // POST /api/assets/:entity/copy/:fromEntity - Copy assets from another entity
  const assetsCopyMatch = pathname.match(/^\/api\/assets\/([^/]+)\/copy\/([^/]+)$/);
  if (assetsCopyMatch && req.method === 'POST') {
    const toEntity = assetsCopyMatch[1];
    const fromEntity = assetsCopyMatch[2];
    const allAssets = await loadAssets();
    const source = allAssets[fromEntity] || [];
    const copied = source.map((a) => ({
      ...a,
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    }));
    allAssets[toEntity] = copied;
    await saveAssets(allAssets);
    return jsonResponse({ ok: true, assets: copied });
  }

  // ========================================================================
  // 401k Contributions API
  // ========================================================================

  // GET /api/contributions/:entity/:year
  const contribGetMatch = pathname.match(/^\/api\/contributions\/([^/]+)\/(\d{4})$/);
  if (contribGetMatch && req.method === 'GET') {
    const key = `${contribGetMatch[1]}/${contribGetMatch[2]}`;
    const allData = await loadContributions();
    return jsonResponse({ contributions: allData[key] || [] });
  }

  // PUT /api/contributions/:entity/:year
  const contribPutMatch = pathname.match(/^\/api\/contributions\/([^/]+)\/(\d{4})$/);
  if (contribPutMatch && req.method === 'PUT') {
    const key = `${contribPutMatch[1]}/${contribPutMatch[2]}`;
    const body = await req.json();
    const { contributions } = body;
    if (!Array.isArray(contributions)) {
      return jsonResponse({ error: 'contributions must be an array' }, 400);
    }
    const allData = await loadContributions();
    allData[key] = contributions;
    await saveContributions(allData);
    return jsonResponse({ ok: true, contributions });
  }

  // ========================================================================
  // Todos API
  // ========================================================================

  // GET /api/todos - Get all todos
  if (pathname === '/api/todos' && req.method === 'GET') {
    const todos = await loadTodos();
    return jsonResponse({ todos });
  }

  // POST /api/todos - Create a todo
  if (pathname === '/api/todos' && req.method === 'POST') {
    const body = await req.json();
    const { title } = body;

    if (!title) {
      return jsonResponse({ error: 'Missing title' }, 400);
    }

    const now = new Date().toISOString();
    const todo: Todo = {
      id: crypto.randomUUID(),
      title,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };

    const todos = await loadTodos();
    todos.push(todo);
    await saveTodos(todos);

    return jsonResponse({ ok: true, todo });
  }

  // PUT /api/todos/:id - Update a todo
  const todoUpdateMatch = pathname.match(/^\/api\/todos\/([^/]+)$/);
  if (todoUpdateMatch && req.method === 'PUT') {
    const todoId = todoUpdateMatch[1];
    const body = await req.json();

    const todos = await loadTodos();
    const idx = todos.findIndex((t) => t.id === todoId);
    if (idx === -1) {
      return jsonResponse({ error: 'Todo not found' }, 404);
    }

    const { title, status } = body;
    if (title !== undefined) todos[idx].title = title;
    if (status !== undefined) todos[idx].status = status;
    todos[idx].updatedAt = new Date().toISOString();

    await saveTodos(todos);
    return jsonResponse({ ok: true, todo: todos[idx] });
  }

  // DELETE /api/todos/:id
  const todoDeleteMatch = pathname.match(/^\/api\/todos\/([^/]+)$/);
  if (todoDeleteMatch && req.method === 'DELETE') {
    const todoId = todoDeleteMatch[1];
    const todos = await loadTodos();
    const filtered = todos.filter((t) => t.id !== todoId);
    if (filtered.length === todos.length) {
      return jsonResponse({ error: 'Todo not found' }, 404);
    }
    await saveTodos(filtered);
    return jsonResponse({ ok: true });
  }

  // ========================================================================
  // Sales API
  // ========================================================================

  // GET /api/sales - Get all sales data (products + sales)
  if (pathname === '/api/sales' && req.method === 'GET') {
    const data = await loadSalesData();
    return jsonResponse(data);
  }

  // POST /api/sales - Create a new sale
  if (pathname === '/api/sales' && req.method === 'POST') {
    const body = await req.json();
    const { person, productId, quantity, date, entity } = body;

    if (!person || !productId) {
      return jsonResponse({ error: 'Missing person or productId' }, 400);
    }

    const data = await loadSalesData();
    const product = data.products.find((p: SaleProduct) => p.id === productId);
    if (!product) {
      return jsonResponse({ error: 'Product not found' }, 404);
    }

    const qty = quantity || 1;
    const sale: Sale = {
      id: crypto.randomUUID(),
      person: person.trim(),
      productId,
      quantity: qty,
      total: product.price * qty,
      date: date || new Date().toISOString().split('T')[0],
      entity: entity || undefined,
      createdAt: new Date().toISOString(),
    };

    data.sales.push(sale);
    await saveSalesData(data);
    return jsonResponse({ ok: true, sale });
  }

  // DELETE /api/sales/:id - Delete a sale
  const saleDeleteMatch = pathname.match(/^\/api\/sales\/([^/]+)$/);
  if (saleDeleteMatch && req.method === 'DELETE') {
    const saleId = saleDeleteMatch[1];
    const data = await loadSalesData();
    const filtered = data.sales.filter((s: Sale) => s.id !== saleId);
    if (filtered.length === data.sales.length) {
      return jsonResponse({ error: 'Sale not found' }, 404);
    }
    data.sales = filtered;
    await saveSalesData(data);
    return jsonResponse({ ok: true });
  }

  // POST /api/sales/products - Add a new product
  if (pathname === '/api/sales/products' && req.method === 'POST') {
    const body = await req.json();
    const { name, price } = body;

    if (!name || price === undefined) {
      return jsonResponse({ error: 'Missing name or price' }, 400);
    }

    const data = await loadSalesData();
    const product: SaleProduct = {
      id: crypto.randomUUID(),
      name: name.trim(),
      price: Number(price),
    };

    data.products.push(product);
    await saveSalesData(data);
    return jsonResponse({ ok: true, product });
  }

  // DELETE /api/sales/products/:id - Delete a product
  const productDeleteMatch = pathname.match(/^\/api\/sales\/products\/([^/]+)$/);
  if (productDeleteMatch && req.method === 'DELETE') {
    const productId = productDeleteMatch[1];
    const data = await loadSalesData();
    const filtered = data.products.filter((p: SaleProduct) => p.id !== productId);
    if (filtered.length === data.products.length) {
      return jsonResponse({ error: 'Product not found' }, 404);
    }
    data.products = filtered;
    await saveSalesData(data);
    return jsonResponse({ ok: true });
  }

  // ========================================================================
  // Mileage API
  // ========================================================================

  // GET /api/mileage - Get all mileage data (vehicles + entries + irsRate)
  if (pathname === '/api/mileage' && req.method === 'GET') {
    const data = await loadMileageData();
    return jsonResponse(data);
  }

  // POST /api/mileage - Create a new mileage entry
  if (pathname === '/api/mileage' && req.method === 'POST') {
    const body = await req.json();
    const { date, vehicleId, odometerStart, odometerEnd, tripMiles, gallons, totalCost, purpose, entity } = body;

    if (!vehicleId) {
      return jsonResponse({ error: 'Missing vehicleId' }, 400);
    }

    const data = await loadMileageData();
    const vehicle = data.vehicles.find((v: Vehicle) => v.id === vehicleId);
    if (!vehicle) {
      return jsonResponse({ error: 'Vehicle not found' }, 404);
    }

    // Auto-calculate tripMiles from odometer if both provided and tripMiles not given
    let computedTripMiles = tripMiles;
    if (computedTripMiles === undefined && odometerStart !== undefined && odometerEnd !== undefined) {
      computedTripMiles = odometerEnd - odometerStart;
    }

    const entry: MileageEntry = {
      id: crypto.randomUUID(),
      date: date || new Date().toISOString().split('T')[0],
      vehicleId,
      odometerStart: odometerStart !== undefined ? Number(odometerStart) : undefined,
      odometerEnd: odometerEnd !== undefined ? Number(odometerEnd) : undefined,
      tripMiles: computedTripMiles !== undefined ? Number(computedTripMiles) : undefined,
      gallons: gallons !== undefined ? Number(gallons) : undefined,
      totalCost: totalCost !== undefined ? Number(totalCost) : undefined,
      purpose: purpose?.trim() || undefined,
      entity: entity || undefined,
      createdAt: new Date().toISOString(),
    };

    data.entries.push(entry);
    await saveMileageData(data);
    return jsonResponse({ ok: true, entry });
  }

  // DELETE /api/mileage/:id - Delete a mileage entry
  const mileageDeleteMatch = pathname.match(/^\/api\/mileage\/([^/]+)$/);
  if (mileageDeleteMatch && req.method === 'DELETE') {
    const entryId = mileageDeleteMatch[1];
    const data = await loadMileageData();
    const filtered = data.entries.filter((e: MileageEntry) => e.id !== entryId);
    if (filtered.length === data.entries.length) {
      return jsonResponse({ error: 'Entry not found' }, 404);
    }
    data.entries = filtered;
    await saveMileageData(data);
    return jsonResponse({ ok: true });
  }

  // POST /api/mileage/vehicles - Add a new vehicle
  if (pathname === '/api/mileage/vehicles' && req.method === 'POST') {
    const body = await req.json();
    const { name, year, make, model } = body;

    if (!name) {
      return jsonResponse({ error: 'Missing vehicle name' }, 400);
    }

    const data = await loadMileageData();
    const vehicle: Vehicle = {
      id: crypto.randomUUID(),
      name: name.trim(),
      year: year !== undefined ? Number(year) : undefined,
      make: make?.trim() || undefined,
      model: model?.trim() || undefined,
    };

    data.vehicles.push(vehicle);
    await saveMileageData(data);
    return jsonResponse({ ok: true, vehicle });
  }

  // DELETE /api/mileage/vehicles/:id - Delete a vehicle
  const vehicleDeleteMatch = pathname.match(/^\/api\/mileage\/vehicles\/([^/]+)$/);
  if (vehicleDeleteMatch && req.method === 'DELETE') {
    const vehicleId = vehicleDeleteMatch[1];
    const data = await loadMileageData();
    const filtered = data.vehicles.filter((v: Vehicle) => v.id !== vehicleId);
    if (filtered.length === data.vehicles.length) {
      return jsonResponse({ error: 'Vehicle not found' }, 404);
    }
    data.vehicles = filtered;
    await saveMileageData(data);
    return jsonResponse({ ok: true });
  }

  // PUT /api/mileage/settings - Update IRS rate
  if (pathname === '/api/mileage/settings' && req.method === 'PUT') {
    const body = await req.json();
    const data = await loadMileageData();
    if (body.irsRate !== undefined) {
      data.irsRate = Number(body.irsRate);
    }
    await saveMileageData(data);
    return jsonResponse({ ok: true });
  }

  // POST /api/mileage/addresses - Add a saved address
  if (pathname === '/api/mileage/addresses' && req.method === 'POST') {
    const body = await req.json();
    const { label, formatted, lat, lon } = body;
    if (!label || !formatted || lat == null || lon == null) {
      return jsonResponse({ error: 'Missing label, formatted, lat, or lon' }, 400);
    }
    const data = await loadMileageData();
    if (!data.savedAddresses) data.savedAddresses = [];
    const addr: SavedAddress = {
      id: crypto.randomUUID(),
      label: label.trim(),
      formatted: formatted.trim(),
      lat: Number(lat),
      lon: Number(lon),
    };
    data.savedAddresses.push(addr);
    await saveMileageData(data);
    return jsonResponse({ ok: true, address: addr });
  }

  // DELETE /api/mileage/addresses/:id - Delete a saved address
  const addrDeleteMatch = pathname.match(/^\/api\/mileage\/addresses\/([^/]+)$/);
  if (addrDeleteMatch && req.method === 'DELETE') {
    const addrId = addrDeleteMatch[1];
    const data = await loadMileageData();
    if (!data.savedAddresses) data.savedAddresses = [];
    const filtered = data.savedAddresses.filter((a) => a.id !== addrId);
    if (filtered.length === (data.savedAddresses?.length || 0)) {
      return jsonResponse({ error: 'Address not found' }, 404);
    }
    data.savedAddresses = filtered;
    await saveMileageData(data);
    return jsonResponse({ ok: true });
  }

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
      const data = await res.json() as { features?: { properties?: { distance?: number } }[] };
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
    const configExists = await fs.access(RCLONE_CONFIG_PATH).then(() => true).catch(() => false);
    const rcloneInstalled = await Bun.spawn(['which', 'rclone'], { stdout: 'pipe', stderr: 'pipe' }).exited.then((code) => code === 0);
    const syncScriptExists = await fs.access(SYNC_SCRIPT_DATA_PATH).then(() => true).catch(() => false)
      || await fs.access(SYNC_SCRIPT_PATH).then(() => true).catch(() => false);

    if (!rcloneInstalled) {
      return jsonResponse({ configured: false, rcloneInstalled: false, message: 'rclone not installed in container' });
    }
    if (!configExists) {
      return jsonResponse({ configured: false, rcloneInstalled: true, syncScript: syncScriptExists, message: 'No rclone config found. Set up Dropbox token in Settings.' });
    }

    // Test the connection
    const proc = Bun.spawn(['rclone', 'about', 'dropbox:', '--json'], {
      stdout: 'pipe', stderr: 'pipe',
      env: { ...process.env, RCLONE_CONFIG: RCLONE_CONFIG_PATH },
    });
    await proc.exited;
    if (proc.exitCode === 0) {
      const about = JSON.parse(await new Response(proc.stdout).text());
      return jsonResponse({ configured: true, rcloneInstalled: true, syncScript: syncScriptExists, connected: true, usage: about });
    }
    const stderr = await new Response(proc.stderr).text();
    return jsonResponse({ configured: true, rcloneInstalled: true, syncScript: syncScriptExists, connected: false, error: stderr.trim() });
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

  // POST /api/download/zip - Download filtered files as a zip archive
  if (pathname === '/api/download/zip' && req.method === 'POST') {
    try {
      const body = await req.json();
      const {
        entity: entityId,
        year,
        filter,
      } = body as {
        entity: string;
        year: string;
        filter: 'income' | 'expenses' | 'invoices' | 'all';
      };

      if (!entityId || !year) {
        return jsonResponse({ error: 'Missing entity or year' }, 400);
      }

      const entityPath = await getEntityPath(entityId);
      if (!entityPath) {
        return jsonResponse({ error: 'Entity not found' }, 404);
      }

      const yearPath = path.join(entityPath, year);
      let files: FileInfo[] = [];
      try {
        await fs.access(yearPath);
        files = await scanDirectory(yearPath, year);
      } catch {
        return jsonResponse({ error: 'Year directory not found' }, 404);
      }

      // Filter out untracked files
      const metadataMap = await loadMetadata();
      files = files.filter((file) => {
        const metaKey = `${entityId}/${file.path}`;
        const meta = metadataMap[metaKey];
        return meta?.tracked !== false;
      });

      // Filter files based on the requested category
      if (filter && filter !== 'all') {
        files = files.filter((file) => {
          const fileLower = file.path.toLowerCase();
          switch (filter) {
            case 'income':
              return fileLower.includes('/income/w2/') || fileLower.includes('/income/1099/');
            case 'expenses':
              return fileLower.includes('/expenses/');
            case 'invoices':
              return fileLower.includes('/income/other/');
            default:
              return true;
          }
        });
      }

      if (files.length === 0) {
        return jsonResponse({ error: 'No files match the filter' }, 404);
      }

      // Read all files and build zip data
      const zipData: Record<string, Uint8Array> = {};
      for (const file of files) {
        const fullPath = path.join(entityPath, file.path);
        try {
          const content = await fs.readFile(fullPath);
          // Use the relative path within the year as the zip entry name
          zipData[file.path] = new Uint8Array(content);
        } catch {
          console.error(`[Zip] Failed to read ${file.path}`);
        }
      }

      const zipped = zipSync(zipData);
      const filterLabel = filter || 'all';
      const filename = `${entityId}_${year}_${filterLabel}.zip`;

      return new Response(zipped, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': String(zipped.length),
          ...corsHeaders(),
        },
      });
    } catch (err) {
      return jsonResponse({ error: 'Failed to create zip', details: String(err) }, 500);
    }
  }

  // POST /api/download/cpa-package - Download CPA-ready zip with TAX_SUMMARY.txt manifest
  if (pathname === '/api/download/cpa-package' && req.method === 'POST') {
    try {
      const body = await req.json();
      const { entity: entityId, year } = body as { entity: string; year: number };

      if (!entityId || !year) {
        return jsonResponse({ error: 'Missing entity or year' }, 400);
      }

      const entityPath = await getEntityPath(entityId);
      if (!entityPath) {
        return jsonResponse({ error: 'Entity not found' }, 404);
      }

      const yearStr = String(year);
      const yearPath = path.join(entityPath, yearStr);
      let files: FileInfo[] = [];
      try {
        await fs.access(yearPath);
        files = await scanDirectory(yearPath, yearStr);
      } catch {
        return jsonResponse({ error: 'Year directory not found' }, 404);
      }

      // Filter out untracked files
      const metadataMap = await loadMetadata();
      files = files.filter((file) => {
        const metaKey = `${entityId}/${file.path}`;
        const meta = metadataMap[metaKey];
        return meta?.tracked !== false;
      });

      if (files.length === 0) {
        return jsonResponse({ error: 'No tracked files found' }, 404);
      }

      // Load parsed data for manifest generation
      const parsedDataMap = await loadParsedData();

      // Build TAX_SUMMARY.txt manifest
      const lines: string[] = [];
      lines.push('='.repeat(60));
      lines.push(`TAX SUMMARY — ${entityId.toUpperCase()} — ${year}`);
      lines.push(`Generated: ${new Date().toISOString().split('T')[0]}`);
      lines.push('='.repeat(60));
      lines.push('');

      // --- Income Section ---
      const w2Files = files.filter((f) => f.path.toLowerCase().includes('/income/w2/'));
      const f1099Files = files.filter((f) => f.path.toLowerCase().includes('/income/1099/'));
      lines.push('INCOME');
      lines.push('-'.repeat(40));

      let totalW2 = 0;
      if (w2Files.length > 0) {
        lines.push('  W-2 Wages:');
        for (const f of w2Files) {
          const key = `${entityId}/${f.path}`;
          const pd = parsedDataMap[key] as Record<string, unknown> | undefined;
          const employer = (pd?.employerName || pd?.employer || f.name.split('_')[0]) as string;
          const wages = Number(pd?.wages || 0);
          totalW2 += wages;
          lines.push(
            `    ${employer}: $${wages.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
          );
        }
      }

      let total1099 = 0;
      let totalCapitalGains = 0;
      const capitalGainsEntries: {
        payer: string;
        total: number;
        shortTerm: number;
        longTerm: number;
      }[] = [];

      if (f1099Files.length > 0) {
        lines.push('  1099 Income:');
        for (const f of f1099Files) {
          const key = `${entityId}/${f.path}`;
          const pd = parsedDataMap[key] as Record<string, unknown> | undefined;
          const payer = (pd?.payerName || pd?.payer || f.name.split('_')[0]) as string;
          const docType = (pd?.documentType || '') as string;

          if (docType === '1099-composite') {
            // Composite: extract dividend/interest income (not capital gains)
            const div = pd?.div as Record<string, number> | undefined;
            const int = pd?.int as Record<string, number> | undefined;
            const b = pd?.b as Record<string, number> | undefined;
            const misc = pd?.misc as Record<string, number> | undefined;
            const divIncome = Number(div?.ordinaryDividends || pd?.totalDividendIncome || 0);
            const intIncome = Number(int?.interestIncome || pd?.totalInterestIncome || 0);
            const miscIncome =
              Number(misc?.rents || 0) +
              Number(misc?.royalties || 0) +
              Number(misc?.otherIncome || 0);
            if (divIncome > 0) {
              total1099 += divIncome;
              lines.push(
                `    ${payer} (1099-DIV): $${divIncome.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
              );
            }
            if (intIncome > 0) {
              total1099 += intIncome;
              lines.push(
                `    ${payer} (1099-INT): $${intIncome.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
              );
            }
            if (miscIncome > 0) {
              total1099 += miscIncome;
              lines.push(
                `    ${payer} (1099-MISC): $${miscIncome.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
              );
            }
            // Track capital gains separately
            if (b) {
              const st = Number(b.shortTermGainLoss || 0);
              const lt = Number(b.longTermGainLoss || 0);
              const total = Number(b.totalGainLoss || pd?.totalCapitalGains || st + lt);
              totalCapitalGains += total;
              capitalGainsEntries.push({ payer, total, shortTerm: st, longTerm: lt });
            }
          } else if (docType === '1099-b') {
            // Standalone 1099-B: capital gains only, NOT income
            const st = Number(pd?.shortTermGainLoss || 0);
            const lt = Number(pd?.longTermGainLoss || 0);
            const total = Number(pd?.totalGainLoss || st + lt);
            totalCapitalGains += total;
            capitalGainsEntries.push({ payer, total, shortTerm: st, longTerm: lt });
          } else {
            // Regular 1099s (NEC, MISC, DIV, INT, R)
            const amount = Number(
              pd?.nonemployeeCompensation ||
                pd?.amount ||
                pd?.ordinaryDividends ||
                pd?.interestIncome ||
                0
            );
            total1099 += amount;
            lines.push(
              `    ${payer}: $${amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
            );
          }
        }
      }

      const totalIncome = totalW2 + total1099;
      lines.push(
        `  TOTAL INCOME: $${totalIncome.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
      );
      lines.push('');

      // --- Capital Gains (Schedule D) Section ---
      if (capitalGainsEntries.length > 0) {
        lines.push('CAPITAL GAINS (Schedule D)');
        lines.push('-'.repeat(40));
        for (const entry of capitalGainsEntries) {
          lines.push(
            `  ${entry.payer}: $${entry.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
          );
          if (entry.shortTerm !== 0) {
            lines.push(
              `    Short-term: $${entry.shortTerm.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
            );
          }
          if (entry.longTerm !== 0) {
            lines.push(
              `    Long-term: $${entry.longTerm.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
            );
          }
        }
        lines.push(
          `  TOTAL NET CAPITAL GAINS: $${totalCapitalGains.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
        );
        lines.push('');
      }

      // --- Mortgage Interest (1098) Section ---
      const f1098Files = files.filter(
        (f) =>
          f.path.toLowerCase().includes('/expenses/1098/') ||
          f.path.toLowerCase().includes('/income/1098/')
      );
      if (f1098Files.length > 0) {
        lines.push('MORTGAGE INTEREST (1098)');
        lines.push('-'.repeat(40));
        let totalMortgageInterest = 0;
        for (const f of f1098Files) {
          const key = `${entityId}/${f.path}`;
          const pd = parsedDataMap[key] as Record<string, unknown> | undefined;
          const lender = (pd?.lender || pd?.institution || f.name.split('_')[0]) as string;
          const interest = Number(pd?.mortgageInterest || 0);
          totalMortgageInterest += interest;
          lines.push(
            `  ${lender}: $${interest.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
          );
        }
        if (totalMortgageInterest > 0) {
          lines.push(
            `  TOTAL MORTGAGE INTEREST PAID: $${totalMortgageInterest.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
          );
        }
        lines.push('');
      }

      // --- Retirement Contributions Section ---
      const retirementFiles = files.filter((f) => f.path.toLowerCase().includes('/retirement/'));
      if (retirementFiles.length > 0) {
        lines.push('RETIREMENT CONTRIBUTIONS');
        lines.push('-'.repeat(40));
        let totalRetirement = 0;
        for (const f of retirementFiles) {
          const key = `${entityId}/${f.path}`;
          const pd = parsedDataMap[key] as Record<string, unknown> | undefined;
          const institution = (pd?.institution || f.name.split('_')[0]) as string;
          const accountType = (pd?.accountType || 'Retirement Account') as string;
          const employer = Number(pd?.employerContributions || 0);
          const employee = Number(pd?.employeeContributions || 0);
          const total = Number(pd?.totalContributions || employer + employee);
          totalRetirement += total;
          lines.push(`  ${institution} (${accountType}):`);
          if (employer > 0)
            lines.push(
              `    Employer: $${employer.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
            );
          if (employee > 0)
            lines.push(
              `    Employee: $${employee.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
            );
          lines.push(`    Total: $${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
        }
        if (totalRetirement > 0) {
          lines.push(
            `  TOTAL RETIREMENT CONTRIBUTIONS: $${totalRetirement.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
          );
        }
        lines.push('');
      }

      // --- Invoices Section ---
      const invoiceFiles = files.filter((f) => {
        const key = `${entityId}/${f.path}`;
        const pd = parsedDataMap[key] as Record<string, unknown> | undefined;
        return pd?.documentType === 'invoice' || f.name.toLowerCase().includes('invoice');
      });

      if (invoiceFiles.length > 0) {
        lines.push('INVOICED REVENUE');
        lines.push('-'.repeat(40));
        const customerTotals = new Map<string, number>();
        for (const f of invoiceFiles) {
          const key = `${entityId}/${f.path}`;
          const pd = parsedDataMap[key] as Record<string, unknown> | undefined;
          const customer = (pd?.billTo ||
            pd?.customerName ||
            pd?.vendor ||
            f.name.split('_')[0]) as string;
          const amount = Number(pd?.totalAmount || pd?.amount || pd?.total || pd?.subtotal || 0);
          customerTotals.set(customer, (customerTotals.get(customer) || 0) + amount);
        }
        let invoiceTotal = 0;
        for (const [customer, total] of customerTotals) {
          invoiceTotal += total;
          lines.push(
            `  ${customer}: $${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
          );
        }
        lines.push(
          `  TOTAL INVOICED: $${invoiceTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
        );
        lines.push('');
      }

      // --- Expenses Section ---
      const expenseFiles = files.filter((f) => f.path.toLowerCase().includes('/expenses/'));
      if (expenseFiles.length > 0) {
        lines.push('EXPENSES');
        lines.push('-'.repeat(40));
        const categoryTotals = new Map<string, number>();
        for (const f of expenseFiles) {
          const key = `${entityId}/${f.path}`;
          const pd = parsedDataMap[key] as Record<string, unknown> | undefined;
          const category = (pd?.category || 'other') as string;
          const amount = Number(pd?.totalAmount || pd?.amount || pd?.total || 0);
          categoryTotals.set(category, (categoryTotals.get(category) || 0) + amount);
        }
        let expenseTotal = 0;
        for (const [category, total] of categoryTotals) {
          expenseTotal += total;
          lines.push(
            `  ${category}: $${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
          );
        }
        lines.push(
          `  TOTAL EXPENSES: $${expenseTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
        );
        lines.push('');
      }

      // --- Statements Section ---
      const statementFiles = files.filter((f) => f.path.toLowerCase().includes('/statements/'));
      if (statementFiles.length > 0) {
        lines.push('STATEMENTS');
        lines.push('-'.repeat(40));
        for (const f of statementFiles) {
          lines.push(`  ${f.name}`);
        }
        lines.push('');
      }

      // --- Document Inventory ---
      lines.push('DOCUMENT INVENTORY');
      lines.push('-'.repeat(40));
      for (const f of files) {
        lines.push(`  ${f.path}`);
      }
      lines.push('');
      lines.push(`Total files: ${files.length}`);

      const manifest = lines.join('\n');

      // Build zip with all tracked files + manifest
      const zipData: Record<string, Uint8Array> = {};
      zipData['TAX_SUMMARY.txt'] = new TextEncoder().encode(manifest);

      for (const file of files) {
        const fullPath = path.join(entityPath, file.path);
        try {
          const content = await fs.readFile(fullPath);
          zipData[file.path] = new Uint8Array(content);
        } catch {
          console.error(`[CPA Package] Failed to read ${file.path}`);
        }
      }

      const zipped = zipSync(zipData);
      const filename = `${entityId}_${year}_CPA_Package.zip`;

      return new Response(zipped, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': String(zipped.length),
          ...corsHeaders(),
        },
      });
    } catch (err) {
      return jsonResponse({ error: 'Failed to create CPA package', details: String(err) }, 500);
    }
  }

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
// Scheduler — built-in cron-like recurring tasks
// ============================================================================

const DEFAULT_SNAPSHOT_INTERVAL = 1440; // 24 hours in minutes
const DEFAULT_DROPBOX_SYNC_INTERVAL = 15; // 15 minutes
const SYNC_SCRIPT_PATH = path.join(__dirname, '..', 'scripts', 'sync-to-dropbox.sh');
const SYNC_SCRIPT_DATA_PATH = path.join(DATA_DIR, 'sync-to-dropbox.sh');
const RCLONE_CONFIG_PATH = path.join(DATA_DIR, '.rclone.conf');

let snapshotTimer: ReturnType<typeof setInterval> | null = null;
let dropboxSyncTimer: ReturnType<typeof setInterval> | null = null;

async function takePortfolioSnapshot(): Promise<void> {
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
        console.log(`[scheduler] SnapTrade holdings refreshed (${snapAccounts.length} accounts)`);
      } catch (err) {
        console.warn('[scheduler] SnapTrade refresh failed, using existing holdings:', err);
      }
    }

    // Fetch live broker prices (Yahoo Finance) and update cache
    const accounts: BrokerAccount[] = settings.brokers?.accounts || [];
    const brokerPortfolio = accounts.length > 0 ? await buildPortfolio(accounts) : null;
    if (brokerPortfolio) {
      try {
        await fs.writeFile(BROKER_CACHE_FILE, JSON.stringify(brokerPortfolio, null, 2));
        console.log('[scheduler] Broker cache updated');
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
        console.log('[scheduler] Crypto cache updated');
      } catch (err) {
        console.warn('[scheduler] Crypto fetch failed, using cached data:', err);
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
        console.log('[scheduler] SimpleFIN bank cache updated');
      } catch (err) {
        console.warn('[scheduler] SimpleFIN fetch failed, using cached data:', err);
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

    const brokerValue = brokerPortfolio?.totalValue || 0;
    const today = new Date().toISOString().split('T')[0];

    await saveSnapshot({
      date: today,
      totalValue: cryptoValue + brokerValue + bankValue,
      cryptoValue,
      brokerValue,
      bankValue,
      shortTermGains: brokerPortfolio?.shortTermGains || 0,
      longTermGains: brokerPortfolio?.longTermGains || 0,
    });
    console.log(`[scheduler] Portfolio snapshot saved for ${today}`);
  } catch (err) {
    console.error('[scheduler] Snapshot failed:', err);
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
        } catch { /* skip unreadable */ }
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
    console.log(`[scheduler] Encrypted config backup written (${Object.keys(filesToBackup).length} files, ${packed.length} bytes)`);
    return backupPath;
  } catch (err) {
    console.error('[scheduler] Encrypted config backup failed:', err);
    return null;
  }
}

async function runDropboxSync(): Promise<void> {
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
      const exists = await fs.access(candidate).then(() => true).catch(() => false);
      if (exists) { syncScript = candidate; break; }
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
        console.error(`[scheduler] Dropbox sync failed (exit: ${proc.exitCode}):`, stderr);
      } else {
        console.log(`[scheduler] Dropbox sync completed`);
      }
    } else {
      console.log('[scheduler] Dropbox sync skipped — no sync script found');
    }
  } catch (err) {
    console.error('[scheduler] Dropbox sync failed:', err);
  }
}

function startScheduler(schedules: Settings['schedules'] = {}): void {
  // Clear existing timers
  if (snapshotTimer) clearInterval(snapshotTimer);
  if (dropboxSyncTimer) clearInterval(dropboxSyncTimer);
  snapshotTimer = null;
  dropboxSyncTimer = null;

  const snapshotEnabled = schedules?.snapshotEnabled !== false; // default on
  const snapshotMinutes = schedules?.snapshotIntervalMinutes || DEFAULT_SNAPSHOT_INTERVAL;

  const dropboxEnabled = schedules?.dropboxSyncEnabled !== false; // default on
  const dropboxMinutes = schedules?.dropboxSyncIntervalMinutes || DEFAULT_DROPBOX_SYNC_INTERVAL;

  if (snapshotEnabled) {
    snapshotTimer = setInterval(takePortfolioSnapshot, snapshotMinutes * 60 * 1000);
    console.log(`[scheduler] Portfolio snapshot: every ${snapshotMinutes}m`);
  } else {
    console.log('[scheduler] Portfolio snapshot: disabled');
  }

  if (dropboxEnabled) {
    dropboxSyncTimer = setInterval(runDropboxSync, dropboxMinutes * 60 * 1000);
    console.log(`[scheduler] Dropbox sync: every ${dropboxMinutes}m`);
  } else {
    console.log('[scheduler] Dropbox sync: disabled');
  }
}

// Initialize scheduler on startup — take an immediate snapshot then start intervals
loadSettings()
  .then(async (settings) => {
    startScheduler(settings.schedules);
    // Run first snapshot immediately so we don't wait 24h after container start
    console.log('[scheduler] Taking initial snapshot on startup...');
    await takePortfolioSnapshot();
  })
  .catch(() => {
    startScheduler();
  });

// ============================================================================
// Start server using Bun's native server
// ============================================================================

const server = Bun.serve({
  port: PORT,
  fetch: handleRequest,
  idleTimeout: 120, // 2 minutes for AI parsing
});

console.log(`DocVault API server running on http://localhost:${server.port}`);
console.log(`Data directory: ${DATA_DIR}`);
