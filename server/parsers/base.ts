// Shared utilities for all document parsers.
// Extracted from the monolithic ai.ts to avoid duplication across type-specific parsers.

import { promises as fs } from 'fs';
import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';
import type { ParsedTaxDocument } from './pdf.js';
import type { ParserMetadata } from './schemas/index.js';
import { getAnthropicKey, getClaudeModel } from '../data.js';
import { withAILimit } from '../aiLimiter.js';
import { logAiCall } from '../ai/usage-log.js';
import type { UsageTokens } from '../ai/pricing.js';
import { createLogger } from '../logger.js';

const log = createLogger('ParserBase');

// --- Anthropic Client (lazy, shared) ---

let client: Anthropic | null = null;

export async function getClient(): Promise<Anthropic> {
  const apiKey = await getAnthropicKey();
  if (!apiKey) {
    throw new Error('Anthropic API key not configured. Please add it in Settings.');
  }
  client = new Anthropic({ apiKey, maxRetries: 0 });
  return client;
}

// --- File I/O ---

export type MediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | 'application/pdf';

export interface FileData {
  base64: string;
  mimeType: string;
  mediaType: MediaType;
}

export async function readFileAsBase64(filePath: string, filename: string): Promise<FileData> {
  const buffer = await fs.readFile(filePath);

  const ext = filename.split('.').pop()?.toLowerCase();
  let mimeType = 'application/pdf';
  if (ext === 'png') mimeType = 'image/png';
  else if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';
  else if (ext === 'gif') mimeType = 'image/gif';
  else if (ext === 'webp') mimeType = 'image/webp';

  return bufferToFileData(buffer, mimeType);
}

/**
 * Convert a raw buffer + known mime type into a FileData ready for Claude.
 * Used by parsers that already have the bytes in memory (e.g. the nutrition
 * parser receives uploads directly as ArrayBuffer) rather than a file path.
 * Runs the same Claude-Vision size normalization as readFileAsBase64().
 */
export async function bufferToFileData(buffer: Buffer, mimeType: string): Promise<FileData> {
  const mediaType = getMediaType(mimeType);
  const { buffer: normalized, mediaType: normalizedMediaType } = await normalizeImageForClaude(
    buffer,
    mediaType
  );
  return {
    base64: normalized.toString('base64'),
    mimeType: normalizedMediaType,
    mediaType: normalizedMediaType,
  };
}

// ---------------------------------------------------------------------------
// Image normalization for Claude Vision
// ---------------------------------------------------------------------------

/**
 * Claude Vision's image input limit is 5 MB after base64 encoding, which
 * translates to roughly 3.75 MB raw. We trigger resize at 2.5 MB raw to
 * leave headroom and ensure the JPEG re-encoding produces something
 * comfortably under the limit even for worst-case content.
 *
 * The 1600px long-edge cap is a quality/size trade-off: at that dimension
 * + 85% JPEG quality, Claude Vision consistently hits 95%+ confidence on
 * supplement/nutrition labels (verified empirically on 8 real labels).
 * Smaller sizes (1024px) start to hurt fine-text extraction; larger sizes
 * don't improve accuracy but do inflate upload time and token consumption.
 */
const CLAUDE_VISION_RESIZE_THRESHOLD_BYTES = 2.5 * 1024 * 1024;
const CLAUDE_VISION_MAX_EDGE_PX = 1600;
const CLAUDE_VISION_JPEG_QUALITY = 85;

/**
 * If `buffer` is an image that exceeds the Claude Vision size budget,
 * resize it down to a safe size and convert to JPEG. Returns the
 * normalized buffer + potentially updated media type. PDFs pass through
 * unchanged (Anthropic's PDF limit is 32 MB; we don't re-encode PDFs).
 *
 * This runs at the `base.ts` layer rather than inside individual parsers
 * so every current and future Claude-Vision caller gets auto-resize for
 * free — no parser needs its own image-size handling.
 */
export async function normalizeImageForClaude(
  buffer: Buffer,
  mediaType: MediaType
): Promise<{ buffer: Buffer; mediaType: MediaType }> {
  // PDFs have their own 32 MB limit; leave them alone.
  if (mediaType === 'application/pdf') return { buffer, mediaType };
  if (buffer.length <= CLAUDE_VISION_RESIZE_THRESHOLD_BYTES) return { buffer, mediaType };

  try {
    const resized = await sharp(buffer)
      .rotate() // honour EXIF orientation so phone photos land right-side-up
      .resize({
        width: CLAUDE_VISION_MAX_EDGE_PX,
        height: CLAUDE_VISION_MAX_EDGE_PX,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: CLAUDE_VISION_JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
    log.info(
      `Auto-resized image for Claude Vision: ${(buffer.length / 1024 / 1024).toFixed(2)}MB ${mediaType} → ${(resized.length / 1024 / 1024).toFixed(2)}MB image/jpeg`
    );
    return { buffer: resized, mediaType: 'image/jpeg' };
  } catch (err) {
    // If Sharp can't decode (corrupt / unusual format), fall through with
    // the original bytes. Claude may still reject oversize, but at least
    // we'll surface the real API error rather than a pre-flight crash.
    log.warn(`Sharp resize failed, passing original image through:`, String(err));
    return { buffer, mediaType };
  }
}

function getMediaType(mimeType: string): MediaType {
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'image/jpeg';
  if (mimeType.includes('png')) return 'image/png';
  if (mimeType.includes('gif')) return 'image/gif';
  if (mimeType.includes('webp')) return 'image/webp';
  if (mimeType.includes('pdf')) return 'application/pdf';
  return 'image/jpeg';
}

// --- Content Block Builder ---

export type FileContentBlock =
  | {
      type: 'document';
      source: { type: 'base64'; media_type: 'application/pdf'; data: string };
    }
  | {
      type: 'image';
      source: { type: 'base64'; media_type: Exclude<MediaType, 'application/pdf'>; data: string };
    };

export function buildFileContent(fileData: FileData): FileContentBlock {
  if (fileData.mimeType === 'application/pdf') {
    return {
      type: 'document' as const,
      source: {
        type: 'base64' as const,
        media_type: 'application/pdf' as const,
        data: fileData.base64,
      },
    };
  }
  return {
    type: 'image' as const,
    source: {
      type: 'base64' as const,
      media_type: fileData.mediaType as Exclude<MediaType, 'application/pdf'>,
      data: fileData.base64,
    },
  };
}

// --- JSON Response Parsing ---

export function parseJsonResponse(text: string): unknown {
  let jsonStr = text.trim();

  // Strip triple-backtick code fences (```json ... ``` or ``` ... ```)
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  } else {
    // Find first JSON object or array boundary, stripping any leading text/backticks
    const start = jsonStr.search(/[{[]/);
    if (start > 0) {
      jsonStr = jsonStr.slice(start);
    }
    const lastClose = Math.max(jsonStr.lastIndexOf('}'), jsonStr.lastIndexOf(']'));
    if (lastClose !== -1 && lastClose < jsonStr.length - 1) {
      jsonStr = jsonStr.slice(0, lastClose + 1);
    }
  }

  return JSON.parse(jsonStr);
}

// --- Claude API Wrapper ---

export interface CallClaudeOptions {
  system: string;
  userContent: Array<FileContentBlock | { type: 'text'; text: string }>;
  maxTokens: number;
  tools?: Anthropic.Messages.Tool[];
  toolChoice?: Anthropic.Messages.ToolChoice;
  /**
   * Logical label written to `.docvault-ai-usage.ndjson` so each call can
   * be attributed (e.g. "parse-w2", "detect-type"). Defaults to "unknown".
   */
  purpose?: string;
}

// Pull usage fields off the SDK response, handling both the old bundled
// `cache_creation_input_tokens` shape and the newer split 5m/1h fields.
function extractUsageTokens(response: Anthropic.Messages.Message): UsageTokens {
  const u = response.usage as unknown as {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
    cache_creation?: {
      ephemeral_5m_input_tokens?: number | null;
      ephemeral_1h_input_tokens?: number | null;
    } | null;
  };
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheCreationInputTokens: u.cache_creation_input_tokens ?? undefined,
    cacheCreationEphemeral5mInputTokens: u.cache_creation?.ephemeral_5m_input_tokens ?? undefined,
    cacheCreationEphemeral1hInputTokens: u.cache_creation?.ephemeral_1h_input_tokens ?? undefined,
    cacheReadInputTokens: u.cache_read_input_tokens ?? undefined,
  };
}

export async function callClaude(opts: CallClaudeOptions): Promise<Anthropic.Messages.Message> {
  const anthropic = await getClient();
  const model = await getClaudeModel();
  const purpose = opts.purpose ?? 'unknown';
  const startedAt = Date.now();

  try {
    const response = await withAILimit(() =>
      anthropic.messages.create({
        model,
        max_tokens: opts.maxTokens,
        system: opts.system,
        messages: [
          {
            role: 'user',
            content: opts.userContent,
          },
        ],
        ...(opts.tools ? { tools: opts.tools } : {}),
        ...(opts.toolChoice ? { tool_choice: opts.toolChoice } : {}),
      })
    );
    // Fire-and-forget — we never want logging to delay or fail a real parse.
    void logAiCall({
      model,
      purpose,
      latencyMs: Date.now() - startedAt,
      usage: extractUsageTokens(response),
      ok: true,
      requestId: response.id ?? null,
      stopReason: response.stop_reason ?? null,
    });
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void logAiCall({
      model,
      purpose,
      latencyMs: Date.now() - startedAt,
      usage: { inputTokens: 0, outputTokens: 0 },
      ok: false,
      error: message,
    });
    throw err;
  }
}

// Extract tool use result from a Claude response (for structured output parsers)
export function extractToolResult(response: Anthropic.Messages.Message): unknown | null {
  const toolUse = response.content.find((c) => c.type === 'tool_use');
  if (toolUse && toolUse.type === 'tool_use') {
    return toolUse.input;
  }
  return null;
}

// Extract text response from a Claude response (for free-form parsers like generic)
export function extractTextResponse(response: Anthropic.Messages.Message): string | null {
  const textContent = response.content.find((c) => c.type === 'text');
  if (textContent && textContent.type === 'text') {
    return textContent.text;
  }
  return null;
}

// --- Parser Interface ---

export interface ValidationResult {
  valid: boolean;
  warnings: string[];
}

export interface DocumentParser<T = unknown> {
  type: string;
  version: number;
  parse(filePath: string, filename: string): Promise<T | null>;
  validate?(result: T): ValidationResult;
}

// --- Legacy Compat ---

// Flatten a typed parser result back to the loose ParsedData format
// that financial-snapshot and tax-summary consumers expect.
// This ensures backward compatibility during the incremental rollout.
export function toLegacyParsedData(
  result: Record<string, unknown>,
  documentType: string
): ParsedTaxDocument {
  // Strip parser metadata fields — consumers don't expect them
  const { _documentType, _parserVersion, _parsedWith, _detectedType, ...data } = result;

  // For bank statements: ensure both array and numeric total exist
  if (documentType === 'bank-statement') {
    const deposits = data.deposits as Array<{ amount: number }> | undefined;
    if (Array.isArray(deposits) && data.totalDeposits === undefined) {
      (data as Record<string, unknown>).totalDeposits = deposits.reduce(
        (s, d) => s + (d.amount || 0),
        0
      );
    }
    // Map bankName -> institution for frontend compat
    if (data.bankName && !data.institution) {
      (data as Record<string, unknown>).institution = data.bankName;
    }
  }

  // For composites: ensure flat shortTermGainLoss/longTermGainLoss exist alongside nested b.{}
  if (documentType === '1099-composite') {
    const b = data.b as Record<string, number> | undefined;
    if (b) {
      if (b.shortTermGainLoss !== undefined && data.shortTermGainLoss === undefined) {
        (data as Record<string, unknown>).shortTermGainLoss = b.shortTermGainLoss;
      }
      if (b.longTermGainLoss !== undefined && data.longTermGainLoss === undefined) {
        (data as Record<string, unknown>).longTermGainLoss = b.longTermGainLoss;
      }
    }
  }

  // For W-2s: ensure both employerName and employer alias exist
  if (documentType === 'w2') {
    if (data.employerName && !data.employer) {
      (data as Record<string, unknown>).employer = data.employerName;
    }
  }

  // For 1099-NEC: ensure both payerName and payer alias exist
  if (documentType === '1099-nec' || documentType === '1099-misc' || documentType === '1099-div') {
    if (data.payerName && !data.payer) {
      (data as Record<string, unknown>).payer = data.payerName;
    }
  }

  return {
    ...data,
    documentType,
  } as ParsedTaxDocument;
}
