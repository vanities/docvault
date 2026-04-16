// DNA route handlers — AncestryDNA / 23andMe raw data upload, parse, and retrieval.
//
// Privacy model:
//   Both the raw .txt genotype file AND the parsed results JSON are encrypted
//   at rest with the server's master key (DOCVAULT_MASTER_KEY). No user
//   password — DNA unlock is tied to the same env-var key that protects
//   settings.anthropicKey / exchange secrets / etc. Threat coverage matches
//   settings-at-rest: data-dir exfil can't read DNA without the master key;
//   anyone with NAS root can read it. Chose this over per-session passwords
//   because the user prioritized not having to re-enter a password every time.
//
// Routes:
//   GET    /api/health/:personId/dna/status      — is there a DNA upload for this person?
//   POST   /api/health/:personId/dna/upload      — upload raw .txt (body = tab-delimited)
//   GET    /api/health/:personId/dna             — decrypt + return parsed results JSON
//   DELETE /api/health/:personId/dna             — remove both encrypted files
//
// Storage layout:
//   data/health/<personId>/dna/
//     raw.txt.enc         — AES-256-GCM ciphertext of the uploaded raw file
//     results.json.enc    — AES-256-GCM ciphertext of the parseDNA(...) output
//     metadata.json       — small non-sensitive metadata (uploadedAt, snpsLoaded, filename)
//
// The metadata file is plaintext JSON because it contains no personally
// identifiable genetic information — just counts and timestamps so the
// frontend can render an "uploaded at X on DATE" card without decrypting.

import { promises as fs } from 'fs';
import path from 'path';
import { jsonResponse, DATA_DIR, ensureDir } from '../data.js';
import { encryptBytesWithMasterKey, decryptBytesWithMasterKey } from '../crypto-keys.js';
import { parseDNA, type DNAParseResult } from '../parsers/dna-traits.js';
import { createLogger } from '../logger.js';

const log = createLogger('DNA');

const HEALTH_DATA_DIR = path.join(DATA_DIR, 'health');

function dnaDir(personId: string): string {
  return path.join(HEALTH_DATA_DIR, personId, 'dna');
}
function rawFile(personId: string): string {
  return path.join(dnaDir(personId), 'raw.txt.enc');
}
function resultsFile(personId: string): string {
  return path.join(dnaDir(personId), 'results.json.enc');
}
function metadataFile(personId: string): string {
  return path.join(dnaDir(personId), 'metadata.json');
}

interface DNAMetadata {
  uploadedAt: string;
  filename: string | null;
  snpsLoaded: number;
  traitsFound: number;
  healthFound: number;
  experimentalFound: number;
  apoeGenotyped: boolean;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function loadMetadata(personId: string): Promise<DNAMetadata | null> {
  try {
    return JSON.parse(await fs.readFile(metadataFile(personId), 'utf-8')) as DNAMetadata;
  } catch {
    return null;
  }
}

export async function handleDNARoutes(
  req: Request,
  url: URL,
  pathname: string
): Promise<Response | null> {
  // Match /api/health/:personId/dna[...]
  const match = pathname.match(/^\/api\/health\/([^/]+)\/dna(\/[^?]*)?$/);
  if (!match) return null;
  const personId = match[1];
  const sub = match[2] ?? '';

  // GET /api/health/:personId/dna/status — existence check, no decryption
  if (sub === '/status' && req.method === 'GET') {
    const meta = await loadMetadata(personId);
    const hasResults = await fileExists(resultsFile(personId));
    const hasRaw = await fileExists(rawFile(personId));
    return jsonResponse({
      exists: hasResults && hasRaw,
      metadata: meta,
    });
  }

  // POST /api/health/:personId/dna/upload — body: raw tab-delimited .txt
  if (sub === '/upload' && req.method === 'POST') {
    const filename = url.searchParams.get('filename') ?? null;
    const raw = Buffer.from(await req.arrayBuffer());
    if (raw.length === 0) {
      return jsonResponse({ error: 'Empty upload' }, 400);
    }
    const content = raw.toString('utf-8');

    let parsed: DNAParseResult;
    try {
      parsed = parseDNA(content);
    } catch (err) {
      return jsonResponse(
        { error: `Parse failed: ${err instanceof Error ? err.message : String(err)}` },
        400
      );
    }
    if (parsed.snpsLoaded === 0) {
      return jsonResponse(
        { error: 'No SNPs parsed from upload — is this a valid AncestryDNA/23andMe raw file?' },
        400
      );
    }

    await ensureDir(dnaDir(personId));

    // Encrypt both raw + results with the master key
    const rawCipher = encryptBytesWithMasterKey(raw);
    const resultsCipher = encryptBytesWithMasterKey(Buffer.from(JSON.stringify(parsed), 'utf-8'));

    await fs.writeFile(rawFile(personId), rawCipher);
    await fs.writeFile(resultsFile(personId), resultsCipher);

    const meta: DNAMetadata = {
      uploadedAt: new Date().toISOString(),
      filename,
      snpsLoaded: parsed.snpsLoaded,
      traitsFound: parsed.traits.length,
      healthFound: parsed.health.length,
      experimentalFound: parsed.experimental.length,
      apoeGenotyped: parsed.apoe !== null,
    };
    await fs.writeFile(metadataFile(personId), JSON.stringify(meta, null, 2));

    log.info(
      `DNA upload for ${personId}: ${parsed.snpsLoaded} SNPs, ${parsed.traits.length} traits + ${parsed.health.length} health + ${parsed.experimental.length} experimental readings`
    );

    return jsonResponse({ ok: true, metadata: meta });
  }

  // GET /api/health/:personId/dna — decrypt + return parsed results
  if (sub === '' && req.method === 'GET') {
    const cipher = await fs.readFile(resultsFile(personId)).catch(() => null);
    if (!cipher) {
      return jsonResponse({ error: 'No DNA upload for this person' }, 404);
    }
    let plaintext: Buffer;
    try {
      plaintext = decryptBytesWithMasterKey(cipher);
    } catch (err) {
      log.error(`Failed to decrypt DNA results for ${personId}:`, String(err));
      return jsonResponse({ error: 'Decryption failed — master key mismatch?' }, 500);
    }
    const results = JSON.parse(plaintext.toString('utf-8')) as DNAParseResult;
    const meta = await loadMetadata(personId);
    return jsonResponse({ results, metadata: meta });
  }

  // DELETE /api/health/:personId/dna — remove both encrypted files + metadata
  if (sub === '' && req.method === 'DELETE') {
    for (const p of [rawFile(personId), resultsFile(personId), metadataFile(personId)]) {
      try {
        await fs.unlink(p);
      } catch {
        /* ignore ENOENT — partial state is fine to clean up */
      }
    }
    // Also remove the dna/ directory if empty
    try {
      await fs.rmdir(dnaDir(personId));
    } catch {
      /* not empty or not existing — fine */
    }
    log.info(`DNA data deleted for ${personId}`);
    return jsonResponse({ ok: true });
  }

  return null;
}
