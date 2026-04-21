// Ancestry route handlers — ethnicity/origin report upload, vision parse,
// and retrieval. Companion to routes/dna.ts (which handles the raw
// genotype .txt file). Lives on the same `/api/health/:personId/...`
// prefix but under the distinct `/ancestry/*` sub-path.
//
// Privacy model (matches routes/dna.ts exactly):
//   Both the uploaded source file (PNG/JPG/PDF screenshot of the provider's
//   ethnicity page) AND the parsed results JSON are encrypted at rest with
//   the server's master key (DOCVAULT_MASTER_KEY). No user password —
//   unlock is tied to the same env-var that protects settings.anthropicKey.
//   Ethnicity data is personally sensitive (subject name appears on the
//   page, implies family history) so we apply the same protection as
//   genotype data.
//
// Routes:
//   GET    /api/health/:personId/ancestry/status   — is there an upload?
//   POST   /api/health/:personId/ancestry/upload   — upload image/PDF, parse with vision
//   GET    /api/health/:personId/ancestry          — decrypt + return parsed results JSON
//   GET    /api/health/:personId/ancestry/image    — decrypt + stream source file back
//   DELETE /api/health/:personId/ancestry          — remove both encrypted files + metadata
//
// Storage layout:
//   data/health/<personId>/ancestry/
//     source.bin.enc      — AES-256-GCM ciphertext of the uploaded image/PDF
//     results.json.enc    — AES-256-GCM ciphertext of parseAncestryReport(...) output
//     metadata.json       — small non-sensitive metadata (uploadedAt, mimeType,
//                           filename, region/journey counts). No region names,
//                           no percentages — just counts + timestamps, so the
//                           frontend can render an "uploaded at X" card without
//                           decrypting. Subject name is NOT in metadata; it's
//                           only in the encrypted results blob.

import { promises as fs } from 'fs';
import path from 'path';
import { jsonResponse, DATA_DIR, ensureDir } from '../data.js';
import { encryptBytesWithMasterKey, decryptBytesWithMasterKey } from '../crypto-keys.js';
import { parseAncestryReport, type AncestryReport } from '../parsers/ancestry-report.js';
import { createLogger } from '../logger.js';

const log = createLogger('Ancestry');

const HEALTH_DATA_DIR = path.join(DATA_DIR, 'health');

function ancestryDir(personId: string): string {
  return path.join(HEALTH_DATA_DIR, personId, 'ancestry');
}
function sourceFile(personId: string): string {
  return path.join(ancestryDir(personId), 'source.bin.enc');
}
function resultsFile(personId: string): string {
  return path.join(ancestryDir(personId), 'results.json.enc');
}
function metadataFile(personId: string): string {
  return path.join(ancestryDir(personId), 'metadata.json');
}

interface AncestryMetadata {
  uploadedAt: string;
  filename: string | null;
  /** image/png, image/jpeg, application/pdf, etc. Stored so /image can serve
   *  the correct Content-Type on decrypt without re-sniffing bytes. */
  mimeType: string;
  /** Which provider the vision parser identified (or "unknown"). */
  source: AncestryReport['source'];
  regionCount: number;
  journeyCount: number;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function loadMetadata(personId: string): Promise<AncestryMetadata | null> {
  try {
    return JSON.parse(await fs.readFile(metadataFile(personId), 'utf-8')) as AncestryMetadata;
  } catch {
    return null;
  }
}

/**
 * Allowed upload mime types. PDF included because Claude's messages API
 * accepts PDFs natively — no pre-rasterization needed. GIF is accepted for
 * completeness (some older screenshot tools still produce GIFs).
 */
const ALLOWED_MIME_TYPES = new Set<string>([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'application/pdf',
]);

function mimeFromFilename(filename: string | null): string | null {
  if (!filename) return null;
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'pdf':
      return 'application/pdf';
    default:
      return null;
  }
}

export async function handleAncestryRoutes(
  req: Request,
  url: URL,
  pathname: string
): Promise<Response | null> {
  // Match /api/health/:personId/ancestry[...]
  const match = pathname.match(/^\/api\/health\/([^/]+)\/ancestry(\/[^?]*)?$/);
  if (!match) return null;
  const personId = match[1];
  const sub = match[2] ?? '';

  // GET /api/health/:personId/ancestry/status — existence check, no decryption
  if (sub === '/status' && req.method === 'GET') {
    const meta = await loadMetadata(personId);
    const hasResults = await fileExists(resultsFile(personId));
    const hasSource = await fileExists(sourceFile(personId));
    return jsonResponse({
      exists: hasResults && hasSource,
      metadata: meta,
    });
  }

  // POST /api/health/:personId/ancestry/upload — body: image/PDF bytes
  // Query params:
  //   filename — original filename (used for extension-based mime fallback)
  if (sub === '/upload' && req.method === 'POST') {
    const filename = url.searchParams.get('filename');
    const buffer = Buffer.from(await req.arrayBuffer());
    if (buffer.length === 0) {
      return jsonResponse({ error: 'Empty upload' }, 400);
    }

    // Prefer Content-Type from the request, fall back to filename extension.
    // Without a mime type we can't tell Claude what kind of file this is.
    const headerType = req.headers.get('content-type')?.split(';')[0]?.trim();
    const detectedMime =
      headerType && ALLOWED_MIME_TYPES.has(headerType) ? headerType : mimeFromFilename(filename);

    if (!detectedMime || !ALLOWED_MIME_TYPES.has(detectedMime)) {
      return jsonResponse(
        {
          error: `Unsupported file type. Upload a PNG, JPEG, GIF, WEBP, or PDF screenshot of your ethnicity report.`,
        },
        400
      );
    }

    // Run the vision parse BEFORE writing anything to disk. If parsing fails
    // we'd rather reject the upload than leave an unparsable blob sitting
    // encrypted in the data dir forever.
    let parsed: AncestryReport | null;
    try {
      parsed = await parseAncestryReport(
        buffer,
        detectedMime as Parameters<typeof parseAncestryReport>[1]
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`Ancestry parse failed for ${personId}:`, msg);
      return jsonResponse({ error: `Vision parse failed: ${msg}` }, 500);
    }

    if (!parsed || parsed.regions.length === 0) {
      return jsonResponse(
        {
          error:
            "Couldn't find any ethnicity regions in that image. Make sure the full results page is visible and try again.",
        },
        400
      );
    }

    await ensureDir(ancestryDir(personId));

    // Encrypt both the original bytes and the parsed JSON with the master key.
    const sourceCipher = encryptBytesWithMasterKey(buffer);
    const resultsCipher = encryptBytesWithMasterKey(Buffer.from(JSON.stringify(parsed), 'utf-8'));

    await fs.writeFile(sourceFile(personId), sourceCipher);
    await fs.writeFile(resultsFile(personId), resultsCipher);

    const meta: AncestryMetadata = {
      uploadedAt: new Date().toISOString(),
      filename,
      mimeType: detectedMime,
      source: parsed.source,
      regionCount: parsed.regions.length,
      journeyCount: parsed.journeys.length,
    };
    await fs.writeFile(metadataFile(personId), JSON.stringify(meta, null, 2));

    log.info(
      `Ancestry upload for ${personId}: ${parsed.regions.length} regions, ${parsed.journeys.length} journeys (source=${parsed.source})`
    );

    return jsonResponse({ ok: true, metadata: meta });
  }

  // GET /api/health/:personId/ancestry — decrypt + return parsed results
  if (sub === '' && req.method === 'GET') {
    const cipher = await fs.readFile(resultsFile(personId)).catch(() => null);
    if (!cipher) {
      return jsonResponse({ error: 'No ancestry report uploaded for this person' }, 404);
    }
    let plaintext: Buffer;
    try {
      plaintext = decryptBytesWithMasterKey(cipher);
    } catch (err) {
      log.error(`Failed to decrypt ancestry results for ${personId}:`, String(err));
      return jsonResponse({ error: 'Decryption failed — master key mismatch?' }, 500);
    }
    const results = JSON.parse(plaintext.toString('utf-8')) as AncestryReport;
    const meta = await loadMetadata(personId);
    return jsonResponse({ results, metadata: meta });
  }

  // GET /api/health/:personId/ancestry/image — decrypt + stream the source back
  // Lets the frontend show the original screenshot alongside the parsed view.
  if (sub === '/image' && req.method === 'GET') {
    const cipher = await fs.readFile(sourceFile(personId)).catch(() => null);
    if (!cipher) return jsonResponse({ error: 'No ancestry source file' }, 404);

    let plaintext: Buffer;
    try {
      plaintext = decryptBytesWithMasterKey(cipher);
    } catch (err) {
      log.error(`Failed to decrypt ancestry source for ${personId}:`, String(err));
      return jsonResponse({ error: 'Decryption failed' }, 500);
    }
    const meta = await loadMetadata(personId);
    const contentType = meta?.mimeType ?? 'application/octet-stream';

    // Private cache — this is personal data. no-store prevents browser from
    // keeping a plaintext copy on disk after the tab closes.
    return new Response(new Uint8Array(plaintext), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, no-store',
      },
    });
  }

  // DELETE /api/health/:personId/ancestry — remove all three files + directory
  if (sub === '' && req.method === 'DELETE') {
    for (const p of [sourceFile(personId), resultsFile(personId), metadataFile(personId)]) {
      try {
        await fs.unlink(p);
      } catch {
        /* ignore ENOENT — partial state is fine to clean up */
      }
    }
    try {
      await fs.rmdir(ancestryDir(personId));
    } catch {
      /* not empty or not existing — fine */
    }
    log.info(`Ancestry data deleted for ${personId}`);
    return jsonResponse({ ok: true });
  }

  return null;
}
