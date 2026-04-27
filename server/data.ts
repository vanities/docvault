// Shared data layer — types, constants, data loaders, and utilities.
// Extracted from server/index.ts to enable route module imports.

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { BrokerAccount, SnapTradeConfig } from './brokers.js';
import type { SimplefinConfig } from './simplefin.js';
import { createLogger } from './logger.js';
import { decryptField, encryptField, walkSensitiveFields } from './crypto-keys.js';

const logFiles = createLogger('Files');
const logMigration = createLogger('Migration');
const logSnapshots = createLogger('Snapshots');
const logGold = createLogger('Gold');
const logAuth = createLogger('Auth');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Data directory - contains entity subdirectories
export const DATA_DIR =
  process.env.DOCVAULT_DATA_DIR ||
  process.env.TAXVAULT_DATA_DIR ||
  path.join(__dirname, '..', 'data');
export const CONFIG_PATH = path.join(DATA_DIR, '.docvault-config.json');
export const SETTINGS_PATH = path.join(DATA_DIR, '.docvault-settings.json');
export const RCLONE_CONFIG_PATH = path.join(DATA_DIR, '.rclone.conf');
export const SYNC_SCRIPT_PATH = path.join(__dirname, '..', 'scripts', 'sync-to-dropbox.sh');
export const SYNC_SCRIPT_DATA_PATH = path.join(DATA_DIR, 'sync-to-dropbox.sh');
export const SCHEDULE_STATUS_FILE = path.join(DATA_DIR, '.docvault-schedule-status.json');
export const PORT = Number(process.env.DOCVAULT_PORT) || 3005;

// ============================================================================
// Types
// ============================================================================

// Health "person" — a labeled data bucket for Apple Health exports.
// Stored in .docvault-health.json, NOT in the entity config. Health is a
// global sidebar section, not an entity.
export interface HealthPerson {
  id: string;
  name: string;
  color?: string;
  icon?: string;
  createdAt: string;
  archivedAt?: string | null;
}

export interface EntityConfig {
  id: string;
  name: string;
  color: string;
  path: string;
  icon?: string;
  type?: 'tax' | 'docs';
  description?: string;
  metadata?: Record<string, string | string[]>;
}

export interface Config {
  entities: EntityConfig[];
}

export interface CryptoExchangeConfig {
  id: 'coinbase' | 'gemini' | 'kraken';
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
  enabled: boolean;
}

export interface CryptoWalletConfig {
  id: string;
  address: string;
  chain: 'btc' | 'eth';
  label: string;
}

export const DEFAULT_MODEL = 'claude-sonnet-4-6';

export interface Settings {
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
  /** FRED (Federal Reserve Economic Data) API key — used by the Quant section
   *  for long-history SP500, treasury yields, macro series. Free at
   *  https://fred.stlouisfed.org/docs/api/api_key.html */
  fredApiKey?: string;
  schedules?: {
    snapshotIntervalMinutes?: number; // default 1440 (24h)
    dropboxSyncIntervalMinutes?: number; // default 15
    dropboxSyncEnabled?: boolean;
    snapshotEnabled?: boolean;
    quantRefreshIntervalMinutes?: number; // default 1440 (24h)
    quantRefreshEnabled?: boolean;
    backupPassword?: string; // if set, encrypted config backup is pushed to Dropbox on sync
  };
  /**
   * Shared secret used by iOS Shortcuts (or any other client) to POST daily
   * Health data to `/api/health/:personId/ingest`. Generated on first use
   * via `getOrCreateHealthIngestToken`. Rotate by clearing this field and
   * calling the getter again.
   */
  healthIngestToken?: string;
}

export interface FileInfo {
  name: string;
  path: string;
  size: number;
  lastModified: number;
  type: string;
  isDirectory: boolean;
}

export interface ParsedData {
  [key: string]: string | number | boolean | null;
}

// ============================================================================
// Config Management
// ============================================================================

export async function loadConfig(): Promise<Config> {
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

export async function saveConfig(config: Config): Promise<void> {
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// ============================================================================
// Settings Management
// ============================================================================

export async function loadSettings(): Promise<Settings> {
  try {
    const content = await fs.readFile(SETTINGS_PATH, 'utf-8');
    const raw = JSON.parse(content) as Settings;
    return walkSensitiveFields(raw, decryptField);
  } catch {
    return {};
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  const toPersist = walkSensitiveFields(settings, encryptField);
  await fs.writeFile(SETTINGS_PATH, JSON.stringify(toPersist, null, 2));
}

// One-shot migration: read the settings file, re-save it. Because saveSettings
// now encrypts sensitive fields and encryptField is idempotent (values already
// tagged "enc:v1:" pass through), running this after an upgrade converts any
// legacy plaintext values in place. Safe to call on every boot.
export async function migrateSettingsEncryption(): Promise<{
  encrypted: number;
  skipped: number;
}> {
  const logMig = createLogger('CryptoMigration');
  let rawContent: string;
  try {
    rawContent = await fs.readFile(SETTINGS_PATH, 'utf-8');
  } catch {
    return { encrypted: 0, skipped: 0 };
  }
  const raw = JSON.parse(rawContent) as Settings;

  // Count plaintext sensitive fields before migration
  let plaintextCount = 0;
  let encryptedCount = 0;
  walkSensitiveFields(raw, (v) => {
    if (typeof v === 'string' && v.length > 0) {
      if (v.startsWith('enc:v1:')) encryptedCount++;
      else plaintextCount++;
    }
    return v;
  });

  if (plaintextCount === 0) {
    return { encrypted: 0, skipped: encryptedCount };
  }

  const encrypted = walkSensitiveFields(raw, encryptField);
  await fs.writeFile(SETTINGS_PATH, JSON.stringify(encrypted, null, 2));
  logMig.info(
    `Migrated ${plaintextCount} sensitive field(s) to encrypted form (${encryptedCount} were already encrypted)`
  );
  return { encrypted: plaintextCount, skipped: encryptedCount };
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

/**
 * Get the Health ingest token, generating a fresh 32-char random token on
 * first call and persisting it to .docvault-settings.json. Used to auth
 * Shortcut → DocVault POSTs on `/api/health/:personId/ingest`.
 */
export async function getOrCreateHealthIngestToken(): Promise<string> {
  const settings = await loadSettings();
  if (settings.healthIngestToken && settings.healthIngestToken.length >= 16) {
    return settings.healthIngestToken;
  }
  // Generate: 32 url-safe chars. Use crypto.getRandomValues for quality.
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const token = Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  settings.healthIngestToken = token;
  await saveSettings(settings);
  return token;
}

// ============================================================================
// Helpers
// ============================================================================

export function getMimeType(filename: string): string {
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

export async function scanDirectory(dirPath: string, basePath: string = ''): Promise<FileInfo[]> {
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
    logFiles.error(`Error scanning ${dirPath}: ${err}`);
  }

  return files;
}

export async function ensureDir(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch {
    // Directory might already exist
  }
}

export function jsonResponse(data: object, status = 200): Response {
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

export function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

// Get entity path, resolving symlinks
export async function getEntityPath(entityId: string): Promise<string | null> {
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

export const PARSED_DATA_FILE = path.join(DATA_DIR, '.docvault-parsed.json');
export const LEGACY_PARSED_DATA_FILE = path.join(DATA_DIR, '.taxvault-parsed.json');
export const REMINDERS_FILE = path.join(DATA_DIR, '.docvault-reminders.json');

// Migrate legacy parsed data file on first load
export let parsedDataMigrated = false;
export async function migrateParsedData(): Promise<void> {
  if (parsedDataMigrated) return;
  parsedDataMigrated = true;
  try {
    await fs.access(PARSED_DATA_FILE);
    // New file exists, no migration needed
  } catch {
    try {
      await fs.access(LEGACY_PARSED_DATA_FILE);
      await fs.rename(LEGACY_PARSED_DATA_FILE, PARSED_DATA_FILE);
      logMigration.info('Renamed .taxvault-parsed.json -> .docvault-parsed.json');
    } catch {
      // Neither file exists, that's fine
    }
  }
}

export async function loadParsedData(): Promise<Record<string, ParsedData>> {
  await migrateParsedData();
  try {
    const content = await fs.readFile(PARSED_DATA_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

export async function saveParsedData(data: Record<string, ParsedData>): Promise<void> {
  await fs.writeFile(PARSED_DATA_FILE, JSON.stringify(data, null, 2));
}

// ============================================================================
// Document Metadata Storage (tags, notes)
// ============================================================================

export const METADATA_FILE = path.join(DATA_DIR, '.docvault-metadata.json');

export interface DocMetadata {
  tags?: string[];
  notes?: string;
  tracked?: boolean;
}

export async function loadMetadata(): Promise<Record<string, DocMetadata>> {
  try {
    const content = await fs.readFile(METADATA_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

export async function saveMetadata(data: Record<string, DocMetadata>): Promise<void> {
  await fs.writeFile(METADATA_FILE, JSON.stringify(data, null, 2));
}

// ============================================================================
// Reminders Storage
// ============================================================================

export interface Reminder {
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

export async function loadReminders(): Promise<Reminder[]> {
  try {
    const content = await fs.readFile(REMINDERS_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return [];
  }
}

export async function saveReminders(reminders: Reminder[]): Promise<void> {
  await fs.writeFile(REMINDERS_FILE, JSON.stringify(reminders, null, 2));
}

// ============================================================================
// Business Assets Storage
// ============================================================================

export const ASSETS_FILE = path.join(DATA_DIR, '.docvault-assets.json');

export interface BusinessAsset {
  id: string;
  name: string;
  value: number;
}

export type AssetsData = Record<string, BusinessAsset[]>; // keyed by entity

export async function loadAssets(): Promise<AssetsData> {
  try {
    const content = await fs.readFile(ASSETS_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

export async function saveAssets(assets: AssetsData): Promise<void> {
  await fs.writeFile(ASSETS_FILE, JSON.stringify(assets, null, 2));
}

// ============================================================================
// 401k Contributions Storage
// ============================================================================

export const CONTRIBUTIONS_FILE = path.join(DATA_DIR, '.docvault-contributions.json');

export interface Contribution401k {
  id: string;
  date: string;
  amount: number;
  type: 'employee' | 'employer';
}

// Keyed by "entity/year" e.g. "my-llc/2025"
export type ContributionsData = Record<string, Contribution401k[]>;

export async function loadContributions(): Promise<ContributionsData> {
  try {
    const content = await fs.readFile(CONTRIBUTIONS_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

export async function saveContributions(data: ContributionsData): Promise<void> {
  await fs.writeFile(CONTRIBUTIONS_FILE, JSON.stringify(data, null, 2));
}

// ============================================================================
// Estimated Tax Payments Storage
// ============================================================================

export const ESTIMATED_TAX_FILE = path.join(DATA_DIR, '.docvault-estimated-taxes.json');

export interface EstimatedTaxPayment {
  id: string;
  date: string; // YYYY-MM-DD (date payment was made)
  quarter: 1 | 2 | 3 | 4;
  amount: number;
}

export interface EstimatedTaxConfig {
  annualTarget: number; // total estimated tax for the year (e.g., safe harbor amount)
}

// Keyed by "entity/year" e.g. "consulting-llc/2026"
export type EstimatedTaxData = Record<
  string,
  {
    payments: EstimatedTaxPayment[];
    config: EstimatedTaxConfig;
  }
>;

export async function loadEstimatedTaxes(): Promise<EstimatedTaxData> {
  try {
    const content = await fs.readFile(ESTIMATED_TAX_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

export async function saveEstimatedTaxes(data: EstimatedTaxData): Promise<void> {
  await fs.writeFile(ESTIMATED_TAX_FILE, JSON.stringify(data, null, 2));
}

// ============================================================================
// Federal Tax Storage (filed 1040 data by year)
// ============================================================================

export const FEDERAL_TAX_FILE = path.join(DATA_DIR, '.docvault-federal.json');

export interface FederalTaxIncome {
  wages: number;
  interestIncome: number;
  dividendIncome: number;
  businessIncome: number;
  rentalK1Income: number;
  capitalGains: number;
  taxableIRA: number;
  taxablePension: number;
  taxableSS: number;
  unemployment: number;
  otherIncome: number;
  totalIncome: number;
}

export interface FederalTaxAdjustments {
  iraDeduction: number;
  educatorExpenses: number;
  hsaDeduction: number;
  studentLoanInterest: number;
  seTaxDeduction: number;
  sepDeduction: number;
  otherAdjustments: number;
  totalAdjustments: number;
}

export interface FederalTaxDeductions {
  standardOrItemized: number;
  qbiDeduction: number;
  totalDeductions: number;
}

export interface FederalTaxTax {
  incomeTax: number;
  amt: number;
  seTax: number;
  additionalTaxQualifiedPlans: number;
  niit: number;
  totalTax: number;
}

export interface FederalTaxCredits {
  foreignTaxCredit: number;
  childCareCredit: number;
  elderlyCredit: number;
  educationCredit: number;
  retirementSavingsCredit: number;
  childTaxCredit: number;
  totalCredits: number;
}

export interface FederalTaxPayments {
  incomeTaxWithheld: number;
  eic: number;
  additionalChildTaxCredit: number;
  excessSocialSecurity: number;
  estimatedPayments: number;
  totalPayments: number;
}

export interface FederalTaxBalance {
  amountOwed: number;
  underpaymentPenalty: number;
  totalOwed: number;
}

export interface FederalTaxFiled {
  filed: boolean;
  filedDate?: string;
  income: FederalTaxIncome;
  adjustments: FederalTaxAdjustments;
  agi: number;
  deductions: FederalTaxDeductions;
  taxableIncome: number;
  tax: FederalTaxTax;
  credits: FederalTaxCredits;
  payments: FederalTaxPayments;
  balance: FederalTaxBalance;
}

// Keyed by year string e.g. "2025"
export type FederalTaxData = Record<string, FederalTaxFiled>;

export async function loadFederalTax(): Promise<FederalTaxData> {
  try {
    const content = await fs.readFile(FEDERAL_TAX_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

export async function saveFederalTax(data: FederalTaxData): Promise<void> {
  await fs.writeFile(FEDERAL_TAX_FILE, JSON.stringify(data, null, 2));
}

// ============================================================================
// Todos Storage
// ============================================================================

export const TODOS_FILE = path.join(DATA_DIR, '.docvault-todos.json');
export const SALES_FILE = path.join(DATA_DIR, '.docvault-sales.json');
export const MILEAGE_FILE = path.join(DATA_DIR, '.docvault-mileage.json');
export const GOLD_FILE = path.join(DATA_DIR, '.docvault-gold.json');
export const PROPERTY_FILE = path.join(DATA_DIR, '.docvault-property.json');
export const CRYPTO_CACHE_FILE = path.join(DATA_DIR, '.docvault-crypto-cache.json');
export const QUANT_SNAPSHOTS_FILE = path.join(DATA_DIR, '.docvault-quant-snapshots.json');
export const STRATEGY_HISTORY_FILE = path.join(DATA_DIR, '.docvault-strategy-history.json');
export const HEALTH_ANALYSIS_HISTORY_FILE = path.join(
  DATA_DIR,
  '.docvault-health-analysis-history.json'
);
export const BROKER_CACHE_FILE = path.join(DATA_DIR, '.docvault-broker-cache.json');
export const BROKER_ACTIVITIES_FILE = path.join(DATA_DIR, '.docvault-broker-activities.json');
export const SIMPLEFIN_CACHE_FILE = path.join(DATA_DIR, '.docvault-simplefin-cache.json');
export const INCOME_FILE = path.join(DATA_DIR, '.docvault-income.json');
export const LIABILITIES_FILE = path.join(DATA_DIR, '.docvault-liabilities.json');
export const ACCOUNT_ANNOTATIONS_FILE = path.join(DATA_DIR, '.docvault-account-annotations.json');

export interface PortfolioSnapshot {
  date: string;
  totalValue: number;
  cryptoValue: number;
  brokerValue: number;
  bankValue?: number;
  goldValue?: number;
  propertyValue?: number;
  shortTermGains: number;
  longTermGains: number;
}

export function snapshotFileForYear(year: number): string {
  return path.join(DATA_DIR, `.docvault-portfolio-snapshots-${year}.json`);
}

export async function loadSnapshotsForYear(year: number): Promise<PortfolioSnapshot[]> {
  try {
    const data = await fs.readFile(snapshotFileForYear(year), 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export async function loadSnapshots(years?: number[]): Promise<PortfolioSnapshot[]> {
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
      logSnapshots.info(`Migrated ${legacySnapshots.length} snapshots from legacy file`);
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

export async function saveSnapshot(snapshot: PortfolioSnapshot): Promise<void> {
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

export interface Todo {
  id: string;
  title: string;
  status: 'pending' | 'completed';
  createdAt: string;
  updatedAt: string;
}

export async function loadTodos(): Promise<Todo[]> {
  try {
    const content = await fs.readFile(TODOS_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return [];
  }
}

export async function saveTodos(todos: Todo[]): Promise<void> {
  await fs.writeFile(TODOS_FILE, JSON.stringify(todos, null, 2));
}

// ============================================================================
// Sales Storage
// ============================================================================

export interface SaleProduct {
  id: string;
  name: string;
  price: number;
}

export interface Sale {
  id: string;
  person: string;
  productId: string;
  quantity: number;
  total: number;
  date: string;
  entity?: string;
  createdAt: string;
}

export interface SalesData {
  products: SaleProduct[];
  sales: Sale[];
}

export async function loadSalesData(): Promise<SalesData> {
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

export async function saveSalesData(data: SalesData): Promise<void> {
  await fs.writeFile(SALES_FILE, JSON.stringify(data, null, 2));
}

// ============================================================================
// Mileage Storage
// ============================================================================

export interface Vehicle {
  id: string;
  name: string;
  year?: number;
  make?: string;
  model?: string;
}

export interface MileageEntry {
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

export interface SavedAddress {
  id: string;
  label: string; // e.g., "Home", "Office"
  formatted: string;
  lat: number;
  lon: number;
}

export interface MileageData {
  vehicles: Vehicle[];
  entries: MileageEntry[];
  irsRate: number;
  savedAddresses?: SavedAddress[];
}

export async function loadMileageData(): Promise<MileageData> {
  try {
    const content = await fs.readFile(MILEAGE_FILE, 'utf-8');
    const data = JSON.parse(content);
    return {
      vehicles: data.vehicles || [],
      entries: data.entries || [],
      irsRate: data.irsRate ?? 0.7,
      savedAddresses: data.savedAddresses || [],
    };
  } catch {
    return { vehicles: [], entries: [], irsRate: 0.7, savedAddresses: [] };
  }
}

export async function saveMileageData(data: MileageData): Promise<void> {
  await fs.writeFile(MILEAGE_FILE, JSON.stringify(data, null, 2));
}

// ============================================================================
// Gold / Precious Metals Storage
// ============================================================================

export interface GoldEntry {
  id: string;
  metal: 'gold' | 'silver' | 'platinum' | 'palladium';
  productId: string;
  customDescription?: string;
  coinYear?: number;
  size: string;
  weightOz: number;
  purity: number;
  purchasePrice: number;
  purchaseDate: string;
  dealer?: string;
  quantity: number;
  notes?: string;
  receiptPath?: string;
  createdAt: string;
}

export const GOLD_RECEIPTS_DIR = path.join(DATA_DIR, 'gold-receipts');

export interface GoldData {
  entries: GoldEntry[];
}

export async function loadGoldData(): Promise<GoldData> {
  try {
    const content = await fs.readFile(GOLD_FILE, 'utf-8');
    const data = JSON.parse(content);
    return { entries: data.entries || [] };
  } catch {
    return { entries: [] };
  }
}

export async function saveGoldData(data: GoldData): Promise<void> {
  await fs.writeFile(GOLD_FILE, JSON.stringify(data, null, 2));
}

// Spot price cache (Yahoo Finance futures: GC=F, SI=F, PL=F, PA=F)
export let metalPriceCache: Record<string, number> = {};
export let metalPriceCacheTime = 0;
export const METAL_PRICE_CACHE_TTL = 300_000; // 5 minutes

export const METAL_FUTURES: Record<string, string> = {
  gold: 'GC=F',
  silver: 'SI=F',
  platinum: 'PL=F',
  palladium: 'PA=F',
};

export async function fetchMetalSpotPrices(): Promise<Record<string, number>> {
  const now = Date.now();
  if (
    Object.keys(metalPriceCache).length > 0 &&
    now - metalPriceCacheTime < METAL_PRICE_CACHE_TTL
  ) {
    return metalPriceCache;
  }

  const symbols = Object.values(METAL_FUTURES).join(',');
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${symbols}&range=1d&interval=1d`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error(`Yahoo Finance returned ${res.status}`);

    const data = await res.json();
    const prices: Record<string, number> = {};

    for (const [metal, ticker] of Object.entries(METAL_FUTURES)) {
      const flat = data[ticker];
      if (flat?.close?.length) {
        prices[metal] = flat.close[flat.close.length - 1];
        continue;
      }
      const spark = data.spark?.result?.find((r: { symbol: string }) => r.symbol === ticker);
      const close = spark?.response?.[0]?.meta?.regularMarketPrice;
      if (close) prices[metal] = close;
    }

    metalPriceCache = prices;
    metalPriceCacheTime = now;
    return prices;
  } catch (err) {
    logGold.warn(`Spot price fetch failed: ${err}`);
    return metalPriceCache; // return stale cache if available
  }
}

// ============================================================================
// Property / Real Estate Storage
// ============================================================================

export interface PropertyAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
}

export interface PropertyMortgage {
  lender: string;
  balance: number;
  rate: number;
  monthlyPayment: number;
}

export interface PropertyEntry {
  id: string;
  name: string;
  type: string;
  address: PropertyAddress;
  acreage?: number;
  squareFeet?: number;
  purchaseDate: string;
  purchasePrice: number;
  currentValue: number;
  currentValueDate?: string;
  annualPropertyTax?: number;
  mortgage?: PropertyMortgage;
  lastAmortizationDate?: string; // YYYY-MM — last month amortization was applied
  notes?: string;
  createdAt: string;
}

export interface PropertyData {
  entries: PropertyEntry[];
}

// Count months between two YYYY-MM strings
export function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

export async function loadPropertyData(): Promise<PropertyData> {
  try {
    const content = await fs.readFile(PROPERTY_FILE, 'utf-8');
    const data = JSON.parse(content);
    return { entries: data.entries || [] };
  } catch {
    return { entries: [] };
  }
}

export async function savePropertyData(data: PropertyData): Promise<void> {
  await fs.writeFile(PROPERTY_FILE, JSON.stringify(data, null, 2));
}

// Queue to serialize writes to parsed data file
export let parsedDataWriteQueue: Promise<void> = Promise.resolve();

export async function setParsedDataForFile(filePath: string, data: ParsedData): Promise<void> {
  parsedDataWriteQueue = parsedDataWriteQueue.then(async () => {
    const allData = await loadParsedData();
    allData[filePath] = data;
    await saveParsedData(allData);
  });
  await parsedDataWriteQueue;
}

// ============================================================================
// Additional Income Sources
// ============================================================================

export interface IncomeSource {
  id: string;
  name: string;
  amount: number;
  frequency: 'monthly' | 'biweekly' | 'weekly' | 'quarterly' | 'annually';
  taxable: boolean;
  entity?: string;
  notes?: string;
  createdAt: string;
}

export interface IncomeData {
  sources: IncomeSource[];
}

export async function loadIncomeData(): Promise<IncomeData> {
  try {
    const content = await fs.readFile(INCOME_FILE, 'utf-8');
    const data = JSON.parse(content);
    return { sources: data.sources || [] };
  } catch {
    return { sources: [] };
  }
}

export async function saveIncomeData(data: IncomeData): Promise<void> {
  await fs.writeFile(INCOME_FILE, JSON.stringify(data, null, 2));
}

// ============================================================================
// Manual Liabilities (non-SimpleFIN debts — equipment loans, private notes, etc.)
// ============================================================================

export type LiabilityType =
  | 'equipment-loan'
  | 'auto-loan'
  | 'personal-loan'
  | 'student-loan'
  | 'mortgage'
  | 'construction-loan'
  | 'credit-line'
  | 'other';

export interface LiabilityEntry {
  id: string;
  name: string;
  lender?: string;
  type: LiabilityType;
  originalBalance?: number;
  balance: number;
  rate: number;
  monthlyPayment: number;
  termMonths?: number;
  startDate?: string;
  payoffDate?: string;
  entity?: string;
  notes?: string;
  createdAt: string;
}

export interface LiabilitiesData {
  entries: LiabilityEntry[];
}

export async function loadLiabilities(): Promise<LiabilitiesData> {
  try {
    const content = await fs.readFile(LIABILITIES_FILE, 'utf-8');
    const data = JSON.parse(content);
    return { entries: data.entries || [] };
  } catch {
    return { entries: [] };
  }
}

export async function saveLiabilities(data: LiabilitiesData): Promise<void> {
  await fs.writeFile(LIABILITIES_FILE, JSON.stringify(data, null, 2));
}

// ============================================================================
// Account Annotations (rates, types for SimpleFIN accounts)
// ============================================================================

export interface AccountAnnotation {
  rate?: number; // interest rate as decimal (e.g., 0.02 for 2%)
  type?: 'auto-loan' | 'personal-loan' | 'student-loan' | 'credit-card' | 'mortgage' | 'other';
  originalBalance?: number;
  term?: number; // months
  startDate?: string; // YYYY-MM-DD
  monthlyPayment?: number;
  notes?: string;
}

// Keyed by SimpleFIN account ID
export type AccountAnnotationsData = Record<string, AccountAnnotation>;

export async function loadAccountAnnotations(): Promise<AccountAnnotationsData> {
  try {
    const content = await fs.readFile(ACCOUNT_ANNOTATIONS_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

export async function saveAccountAnnotations(data: AccountAnnotationsData): Promise<void> {
  await fs.writeFile(ACCOUNT_ANNOTATIONS_FILE, JSON.stringify(data, null, 2));
}

// ============================================================================
// Authentication
// ============================================================================

export const AUTH_USERNAME = process.env.DOCVAULT_USERNAME;
export const AUTH_PASSWORD = process.env.DOCVAULT_PASSWORD;
export const AUTH_ENABLED = !!(AUTH_USERNAME && AUTH_PASSWORD);

// In-memory session store: token -> expiry timestamp
export const sessions = new Map<string, number>();
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 days in seconds
export const SESSION_COOKIE = 'docvault_session';

export function createSession(): string {
  const token = crypto.randomUUID();
  sessions.set(token, Date.now() + SESSION_MAX_AGE * 1000);
  return token;
}

export function isValidSession(token: string): boolean {
  const expiry = sessions.get(token);
  if (!expiry) return false;
  if (Date.now() > expiry) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export function getSessionToken(req: Request): string | null {
  const cookie = req.headers.get('cookie');
  if (!cookie) return null;
  const match = cookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  return match ? match[1] : null;
}

export function sessionCookie(token: string, maxAge = SESSION_MAX_AGE): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export function isAuthenticated(req: Request): boolean {
  if (!AUTH_ENABLED) return true;
  const token = getSessionToken(req);
  return token !== null && isValidSession(token);
}

// Routes that don't require auth (status must be open so frontend can check auth state)
export const PUBLIC_ROUTES = new Set(['/api/login', '/api/status']);

if (AUTH_ENABLED) {
  logAuth.info(`Authentication enabled for user "${AUTH_USERNAME}"`);
} else {
  logAuth.info('Authentication disabled (DOCVAULT_USERNAME/DOCVAULT_PASSWORD not set)');
}
