import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseWithAI } from './parsers/ai.js';
import { zipSync } from 'fflate';
import { withAILimit } from './aiLimiter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3005;

// Data directory - contains entity subdirectories
const DATA_DIR =
  process.env.DOCVAULT_DATA_DIR ||
  process.env.TAXVAULT_DATA_DIR ||
  path.join(__dirname, '..', 'data');
const CONFIG_PATH = path.join(__dirname, 'config.json');
const SETTINGS_PATH = path.join(__dirname, 'settings.json');

// ============================================================================
// Types
// ============================================================================

interface EntityConfig {
  id: string;
  name: string;
  color: string;
  path: string;
  description?: string;
}

interface Config {
  entities: EntityConfig[];
}

interface Settings {
  anthropicKey?: string;
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
  try {
    const content = await fs.readFile(CONFIG_PATH, 'utf-8');
    return JSON.parse(content);
  } catch {
    // Default config
    return {
      entities: [{ id: 'personal', name: 'Personal', color: 'blue', path: 'personal' }],
    };
  }
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
// Todos Storage
// ============================================================================

const TODOS_FILE = path.join(DATA_DIR, '.docvault-todos.json');

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
// Request Handler
// ============================================================================

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pathname = url.pathname;

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
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

    await saveSettings(settings);
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
      });
    } catch {
      return jsonResponse({
        ok: false,
        dataDir: DATA_DIR,
        error: 'Data directory not accessible',
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

      const response = await withAILimit(() =>
        anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          system: `You analyze tax documents, suggest standardized filenames, and extract all parsed data.

Naming convention: {Source}_{Type}_{Date}.{ext}
- Source: Company/vendor/employer name in Title_Case (e.g., "Google", "Art_City", "OpenAI")
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
  "documentType": "w2|1099-nec|1099-misc|1099-div|1099-int|1099-b|1099-r|1098|retirement-statement|receipt|invoice|crypto|return|contract|formation|ein-letter|license|business-agreement|operating-agreement|insurance-policy|bank-statement|credit-card-statement|statement|letter|certificate|medical-record|appraisal|other",
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
      if (f1099Files.length > 0) {
        lines.push('  1099 Income:');
        for (const f of f1099Files) {
          const key = `${entityId}/${f.path}`;
          const pd = parsedDataMap[key] as Record<string, unknown> | undefined;
          const payer = (pd?.payerName || pd?.payer || f.name.split('_')[0]) as string;
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

      const totalIncome = totalW2 + total1099;
      lines.push(
        `  TOTAL INCOME: $${totalIncome.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
      );
      lines.push('');

      // --- Mortgage Interest (1098) Section ---
      const f1098Files = files.filter((f) => f.path.toLowerCase().includes('/income/1098/'));
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
// Start server using Bun's native server
// ============================================================================

const server = Bun.serve({
  port: PORT,
  fetch: handleRequest,
  idleTimeout: 120, // 2 minutes for AI parsing
});

console.log(`DocVault API server running on http://localhost:${server.port}`);
console.log(`Data directory: ${DATA_DIR}`);
