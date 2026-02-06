import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parsePdf } from './parsers/pdf.js';
import { parseWithAI } from './parsers/ai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3005;

// Data directory - contains entity subdirectories
const DATA_DIR = process.env.TAXVAULT_DATA_DIR || path.join(__dirname, '..', 'data');
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

const PARSED_DATA_FILE = path.join(DATA_DIR, '.taxvault-parsed.json');

async function loadParsedData(): Promise<Record<string, ParsedData>> {
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

async function setParsedDataForFile(filePath: string, data: ParsedData): Promise<void> {
  const allData = await loadParsedData();
  allData[filePath] = data;
  await saveParsedData(allData);
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
        .filter((name) => /^\d{4}/.test(name))
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
        .filter((name) => /^\d{4}/.test(name))
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

      // Attach parsed data to files
      const parsedDataMap = await loadParsedData();
      const filesWithParsedData = files.map((f) => ({
        ...f,
        parsedData: parsedDataMap[`${entityId}/${f.path}`] || null,
      }));

      return jsonResponse({ files: filesWithParsedData });
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

  // POST /api/parse/:entity/:filePath - Parse a single file
  // Query params: ?useAI=true to use Claude Vision API
  if (pathname.startsWith('/api/parse/') && req.method === 'POST') {
    const pathParts = pathname.slice('/api/parse/'.length).split('/');
    const entityId = pathParts[0];
    const filePath = decodeURIComponent(pathParts.slice(1).join('/'));
    const useAI = url.searchParams.get('useAI') === 'true';

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
      const ext = filename.split('.').pop()?.toLowerCase();

      let parsedData: ParsedData = {
        parsed: true,
        parsedAt: new Date().toISOString(),
      };

      // Use AI parsing if requested
      if (useAI) {
        console.log(`[Parse] Using AI parser for ${filename}`);
        const aiData = await parseWithAI(fullPath, filename);
        if (aiData) {
          parsedData = {
            ...parsedData,
            ...aiData,
          };
        }
      } else if (ext === 'pdf') {
        // Use traditional PDF parsing
        console.log(`[Parse] Using regex parser for ${filename}`);
        const pdfData = await parsePdf(fullPath, filename);
        if (pdfData) {
          parsedData = {
            ...parsedData,
            ...pdfData,
          };
        }
      }

      // Save parsed data
      await setParsedDataForFile(`${entityId}/${filePath}`, parsedData);

      return jsonResponse({ ok: true, parsedData });
    } catch (err) {
      return jsonResponse({ error: 'Failed to parse file', details: String(err) }, 500);
    }
  }

  // POST /api/parse-all/:entity/:year - Parse all files in a year
  // Query params: ?useAI=true to use Claude Vision API
  if (pathname.startsWith('/api/parse-all/') && req.method === 'POST') {
    const pathParts = pathname.slice('/api/parse-all/'.length).split('/');
    const entityId = pathParts[0];
    const year = pathParts[1];
    const useAI = url.searchParams.get('useAI') === 'true';

    const entityPath = await getEntityPath(entityId);
    if (!entityPath) {
      return jsonResponse({ error: 'Entity not found' }, 404);
    }

    const yearPath = path.join(entityPath, year);

    try {
      await fs.access(yearPath);
      const files = await scanDirectory(yearPath, year);

      let parsed = 0;
      let failed = 0;

      for (const file of files) {
        try {
          const fullPath = path.join(entityPath, file.path);
          const ext = file.name.split('.').pop()?.toLowerCase();

          let parsedData: ParsedData = {
            parsed: true,
            parsedAt: new Date().toISOString(),
          };

          // Use AI parsing if requested
          if (useAI) {
            console.log(`[Parse All] Using AI parser for ${file.name}`);
            const aiData = await parseWithAI(fullPath, file.name);
            if (aiData) {
              parsedData = {
                ...parsedData,
                ...aiData,
              };
            }
          } else if (ext === 'pdf') {
            // Use traditional PDF parsing
            const pdfData = await parsePdf(fullPath, file.name);
            if (pdfData) {
              parsedData = {
                ...parsedData,
                ...pdfData,
              };
            }
          }

          await setParsedDataForFile(`${entityId}/${file.path}`, parsedData);
          parsed++;
        } catch (err) {
          console.error(`Failed to parse ${file.path}:`, err);
          failed++;
        }
      }

      return jsonResponse({ ok: true, parsed, failed, total: files.length });
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

      // Update parsed data key if it exists
      const parsedData = await loadParsedData();
      const oldKey = `${fromEntity}/${from}`;
      const newKey = `${toEntity}/${to}`;
      if (parsedData[oldKey]) {
        parsedData[newKey] = parsedData[oldKey];
        delete parsedData[oldKey];
        await saveParsedData(parsedData);
      }

      return jsonResponse({ ok: true });
    } catch (err) {
      return jsonResponse({ error: 'Failed to move file', details: String(err) }, 500);
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
});

console.log(`TaxVault API server running on http://localhost:${server.port}`);
console.log(`Data directory: ${DATA_DIR}`);
