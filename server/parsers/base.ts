// Shared utilities for all document parsers.
// Extracted from the monolithic ai.ts to avoid duplication across type-specific parsers.

import { promises as fs } from 'fs';
import Anthropic from '@anthropic-ai/sdk';
import type { ParsedTaxDocument } from './pdf.js';
import type { ParserMetadata } from './schemas/index.js';
import { getAnthropicKey, getClaudeModel } from '../data.js';
import { withAILimit } from '../aiLimiter.js';

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
  const base64 = buffer.toString('base64');

  const ext = filename.split('.').pop()?.toLowerCase();
  let mimeType = 'application/pdf';
  if (ext === 'png') mimeType = 'image/png';
  else if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';
  else if (ext === 'gif') mimeType = 'image/gif';
  else if (ext === 'webp') mimeType = 'image/webp';

  return { base64, mimeType, mediaType: getMediaType(mimeType) };
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
  let jsonStr = text;
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1];
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
}

export async function callClaude(opts: CallClaudeOptions): Promise<Anthropic.Messages.Message> {
  const anthropic = await getClient();
  const model = await getClaudeModel();

  return withAILimit(() =>
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
