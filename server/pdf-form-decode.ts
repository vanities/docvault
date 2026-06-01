// PDF form decode-and-cache.
//
// Real-world fillable forms (especially IRS PDFs) have machine-generated field
// names like "topmostSubform[0].Page1[0].f1_01[0]" — useless for mapping data.
// This module hands the rendered form + its positioned field list to Claude,
// which reads the form and returns what each field MEANS, then caches that
// mapping keyed by a form fingerprint. The decode (a model call) therefore
// happens ONCE per distinct form; every later fill of the same form is instant
// and free.

import { promises as fs } from 'fs';
import path from 'path';
import type Anthropic from '@anthropic-ai/sdk';
import { DATA_DIR } from './data.js';
import { createLogger } from './logger.js';
import {
  callClaude,
  bufferToFileData,
  buildFileContent,
  extractToolResult,
} from './parsers/base.js';
import {
  extractFormLayout,
  formFingerprint,
  type FieldLayout,
  type FillValue,
} from './pdf-forms.js';

const log = createLogger('PdfFormDecode');

const TEMPLATES_PATH = path.join(DATA_DIR, '.docvault-form-templates.json');

/** A field's decoded meaning. `key` is a canonical snake_case handle for data mapping. */
export interface FieldMeaning {
  label: string;
  key?: string;
}

export interface FormTemplate {
  fingerprint: string;
  formName?: string;
  decodedAt: string;
  fieldCount: number;
  fields: Record<string, FieldMeaning>;
}

export interface DecodedField extends FieldLayout {
  label?: string;
  key?: string;
}

export interface DecodedForm {
  fingerprint: string;
  formName?: string;
  /** True when served from the template cache (no model call this time). */
  cached: boolean;
  fields: DecodedField[];
}

/** The decode step — injectable so tests can run the cache logic without Claude. */
export type DecodeFn = (
  pdfBytes: Uint8Array,
  layout: FieldLayout[]
) => Promise<{ formName?: string; fields: Array<{ name: string; label: string; key?: string }> }>;

async function loadTemplates(templatesPath: string): Promise<Record<string, FormTemplate>> {
  try {
    return JSON.parse(await fs.readFile(templatesPath, 'utf-8')) as Record<string, FormTemplate>;
  } catch {
    return {};
  }
}

async function saveTemplate(templatesPath: string, template: FormTemplate): Promise<void> {
  // Read-modify-write the whole map (never stream back into the same file).
  const all = await loadTemplates(templatesPath);
  all[template.fingerprint] = template;
  await fs.writeFile(templatesPath, JSON.stringify(all, null, 2));
}

const DECODE_SYSTEM = [
  'You decode fillable PDF forms. You are given the rendered form (as a document) and a list of its internal AcroForm field names with positions.',
  'Internal names are often machine-generated and meaningless (e.g. "f1_01[0]"). Your job is to determine what each field is FOR by matching its position to the visible labels, lines, and boxes on the rendered form.',
  'Positions are in PDF points with the origin at the bottom-left, so a HIGHER y is HIGHER on the page and x increases to the right. Use width to disambiguate (a narrow 2-digit box vs a wide name field).',
  'For EVERY field in the list, return: name (copied verbatim from the list), label (a concise human description tied to the form, e.g. "Line 1 — Name" or "SSN — middle 2 digits"), and key (a snake_case canonical handle for mapping to user data).',
  'Use a consistent key vocabulary for common fields: taxpayer_name, business_name, ssn, ein, address, city_state_zip, account_numbers, tax_classification, exempt_payee_code, fatca_code. Omit key only when a field has no sensible data mapping (e.g. a signature or one checkbox among a group). Also return formName (the form title/number, e.g. "IRS Form W-9"). Map ALL fields; never skip one.',
].join('\n');

const DECODE_TOOL: Anthropic.Messages.Tool = {
  name: 'report_fields',
  description: 'Report the human meaning of every fillable field on the form.',
  input_schema: {
    type: 'object',
    properties: {
      formName: { type: 'string', description: 'Form title/number, e.g. "IRS Form W-9".' },
      fields: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Exact internal field name, copied from the list.',
            },
            label: { type: 'string', description: 'Concise human meaning tied to the form.' },
            key: { type: 'string', description: 'snake_case canonical key for data mapping.' },
          },
          required: ['name', 'label'],
        },
      },
    },
    required: ['fields'],
  },
};

function describeLayout(layout: FieldLayout[]): string {
  const lines = layout.map((f) => {
    const pos = f.rect
      ? `page ${f.page} y=${Math.round(f.rect.y)} x=${Math.round(f.rect.x)} w=${Math.round(f.rect.width)}`
      : `page ${f.page}`;
    const opts = f.options?.length ? ` options=[${f.options.join(', ')}]` : '';
    return `- ${f.name} (${f.type}, ${pos})${opts}`;
  });
  return lines.join('\n');
}

const claudeDecode: DecodeFn = async (pdfBytes, layout) => {
  const fileData = await bufferToFileData(Buffer.from(pdfBytes), 'application/pdf');
  const response = await callClaude({
    system: DECODE_SYSTEM,
    userContent: [
      buildFileContent(fileData),
      {
        type: 'text',
        text: `Field list (positions in PDF points, origin bottom-left — higher y is higher on the page):\n${describeLayout(layout)}`,
      },
    ],
    maxTokens: 4096,
    tools: [DECODE_TOOL],
    toolChoice: { type: 'tool', name: 'report_fields' },
    purpose: 'pdf-form-decode',
  });
  const result = extractToolResult(response) as {
    formName?: string;
    fields?: Array<{ name: string; label: string; key?: string }>;
  } | null;
  if (!result?.fields?.length) throw new Error('Form decode returned no fields');
  return { formName: result.formName, fields: result.fields };
};

/**
 * Decode a form's fields to their human meaning, caching the result by
 * fingerprint. On a cache hit, returns instantly with no model call.
 *
 * `opts.decodeFn` and `opts.templatesPath` are injection points for tests.
 */
export async function decodeForm(
  pdfBytes: Uint8Array,
  opts: { templatesPath?: string; decodeFn?: DecodeFn } = {}
): Promise<DecodedForm> {
  const templatesPath = opts.templatesPath ?? TEMPLATES_PATH;
  const decodeFn = opts.decodeFn ?? claudeDecode;

  const layout = await extractFormLayout(pdfBytes);
  const fingerprint = formFingerprint(layout);

  const cachedTemplate = (await loadTemplates(templatesPath))[fingerprint];
  if (cachedTemplate) {
    log.info(`Form ${fingerprint} served from cache (${cachedTemplate.formName ?? 'unnamed'})`);
    return applyTemplate(fingerprint, cachedTemplate, layout, true);
  }

  log.info(`Form ${fingerprint} not cached — decoding ${layout.length} fields with Claude`);
  const decoded = await decodeFn(pdfBytes, layout);
  const template: FormTemplate = {
    fingerprint,
    formName: decoded.formName,
    decodedAt: new Date().toISOString(),
    fieldCount: layout.length,
    fields: Object.fromEntries(decoded.fields.map((d) => [d.name, { label: d.label, key: d.key }])),
  };
  await saveTemplate(templatesPath, template);
  return applyTemplate(fingerprint, template, layout, false);
}

function applyTemplate(
  fingerprint: string,
  template: FormTemplate,
  layout: FieldLayout[],
  cached: boolean
): DecodedForm {
  return {
    fingerprint,
    formName: template.formName,
    cached,
    fields: layout.map((f) => ({
      ...f,
      label: template.fields[f.name]?.label,
      key: template.fields[f.name]?.key,
    })),
  };
}

// ---------------------------------------------------------------------------
// Auto-fill: map a user's entity data onto the decoded fields (a draft to review)
// ---------------------------------------------------------------------------

/** The suggest step — injectable so tests run the route logic without Claude. */
export type SuggestFn = (
  fields: DecodedField[],
  entityData: Record<string, unknown>,
  formName: string | undefined
) => Promise<Record<string, FillValue>>;

const SUGGEST_SYSTEM = [
  'You are drafting a fillable form for a user from data they already have on file. You are given the form fields (with human labels + canonical keys) and the user data for one "entity" (a person or business).',
  'For each fillable field, provide the value to put in it using ONLY the supplied user data. Text → a string. Checkbox → true to check, omit otherwise (e.g. check the single tax-classification box matching the entity type). Choice/dropdown → one of the given options verbatim.',
  'Be conservative: OMIT any field you cannot determine confidently from the data — a human reviews this draft. NEVER invent identifiers (SSN/EIN), names, or addresses that are not present in the supplied data.',
].join('\n');

const SUGGEST_TOOL: Anthropic.Messages.Tool = {
  name: 'fill_values',
  description:
    'Provide a value for each field you can determine from the user data. Omit the rest.',
  input_schema: {
    type: 'object',
    properties: {
      values: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Exact internal field name.' },
            value: { description: 'String for text/choice fields; boolean for checkboxes.' },
          },
          required: ['name', 'value'],
        },
      },
    },
    required: ['values'],
  },
};

function describeFields(fields: DecodedField[]): string {
  return fields
    .map((f) => {
      const opts = f.options?.length ? ` options=[${f.options.join(', ')}]` : '';
      return `- ${f.name} | ${f.type} | ${f.label ?? '?'}${f.key ? ` | key=${f.key}` : ''}${opts}`;
    })
    .join('\n');
}

const claudeSuggest: SuggestFn = async (fields, entityData, formName) => {
  const response = await callClaude({
    system: SUGGEST_SYSTEM,
    userContent: [
      {
        type: 'text',
        text: `Form: ${formName ?? 'unknown'}\n\nFields:\n${describeFields(fields)}\n\nUser data for this entity (JSON):\n${JSON.stringify(entityData, null, 2)}`,
      },
    ],
    maxTokens: 2048,
    tools: [SUGGEST_TOOL],
    toolChoice: { type: 'tool', name: 'fill_values' },
    purpose: 'pdf-form-autofill',
  });
  const result = extractToolResult(response) as {
    values?: Array<{ name: string; value: unknown }>;
  } | null;
  const out: Record<string, FillValue> = {};
  for (const v of result?.values ?? []) {
    if (typeof v.value === 'string' || typeof v.value === 'boolean') out[v.name] = v.value;
    else if (Array.isArray(v.value)) out[v.name] = v.value.map(String);
  }
  return out;
};

/** Suggest fill values for a decoded form from an entity's data. Best-effort, conservative. */
export async function suggestFormValues(
  fields: DecodedField[],
  entityData: Record<string, unknown>,
  formName: string | undefined,
  opts: { suggestFn?: SuggestFn } = {}
): Promise<Record<string, FillValue>> {
  return (opts.suggestFn ?? claudeSuggest)(fields, entityData, formName);
}
