// PDF form filling — detect AcroForm fillable fields and fill them from a
// {fieldName: value} map. Built on pdf-lib (MIT), deliberately NOT PyMuPDF
// (AGPL-3.0) so the capability fits DocVault's GPLv3 + Bun/TS stack with no
// license friction.
//
// This is the mechanical layer only. The AI mapping (parsed DocVault data ->
// field names) layers on top later via a route / Chat tool — odysseus's version
// stops here (its "AI mapping" is actually deterministic), so this is parity;
// the AI step is where DocVault goes further.

import {
  PDFDocument,
  PDFTextField,
  PDFCheckBox,
  PDFDropdown,
  PDFRadioGroup,
  PDFOptionList,
  PDFButton,
  PDFSignature,
  PDFName,
  PDFRef,
  type PDFField,
} from 'pdf-lib';
import { createHash } from 'crypto';
import { createLogger } from './logger.js';

const log = createLogger('PdfForms');

export type FormFieldType =
  | 'text'
  | 'checkbox'
  | 'dropdown'
  | 'radio'
  | 'optionlist'
  | 'button'
  | 'signature'
  | 'unknown';

export interface FormField {
  name: string;
  type: FormFieldType;
  /** Current value: string (radio), boolean (checkbox), string[] (dropdown/optionlist/text→string). */
  value?: string | boolean | string[];
  /** Selectable options for dropdown / radio / optionlist. */
  options?: string[];
  readOnly: boolean;
  required: boolean;
}

export type FillValue = string | boolean | string[];

export interface FillResult {
  bytes: Uint8Array;
  filled: string[];
  skipped: Array<{ name: string; reason: string }>;
}

function fieldTypeOf(field: PDFField): FormFieldType {
  if (field instanceof PDFTextField) return 'text';
  if (field instanceof PDFCheckBox) return 'checkbox';
  if (field instanceof PDFDropdown) return 'dropdown';
  if (field instanceof PDFRadioGroup) return 'radio';
  if (field instanceof PDFOptionList) return 'optionlist';
  if (field instanceof PDFSignature) return 'signature';
  if (field instanceof PDFButton) return 'button';
  return 'unknown';
}

function coerceBool(v: FillValue): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    return ['true', 'yes', 'on', '1', 'x', 'checked'].includes(v.toLowerCase().trim());
  }
  return Array.isArray(v) ? v.length > 0 : false;
}

/** True if the PDF has at least one fillable (non-signature, non-button) field. */
export async function hasFormFields(pdfBytes: Uint8Array): Promise<boolean> {
  try {
    const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
    return doc
      .getForm()
      .getFields()
      .some((f) => {
        const t = fieldTypeOf(f);
        return t !== 'signature' && t !== 'button' && t !== 'unknown';
      });
  } catch {
    return false;
  }
}

/** Enumerate every AcroForm field with its type, current value, and options. */
export async function extractFormFields(pdfBytes: Uint8Array): Promise<FormField[]> {
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  const out: FormField[] = [];
  for (const field of doc.getForm().getFields()) {
    const name = field.getName();
    const entry: FormField = {
      name,
      type: fieldTypeOf(field),
      readOnly: field.isReadOnly(),
      required: field.isRequired(),
    };
    try {
      if (field instanceof PDFTextField) {
        entry.value = field.getText() ?? undefined;
      } else if (field instanceof PDFCheckBox) {
        entry.value = field.isChecked();
      } else if (field instanceof PDFDropdown) {
        entry.value = field.getSelected();
        entry.options = field.getOptions();
      } else if (field instanceof PDFRadioGroup) {
        entry.value = field.getSelected() ?? undefined;
        entry.options = field.getOptions();
      } else if (field instanceof PDFOptionList) {
        entry.value = field.getSelected();
        entry.options = field.getOptions();
      }
    } catch (err) {
      log.warn(`Could not read field "${name}": ${(err as Error).message}`);
    }
    out.push(entry);
  }
  return out;
}

/**
 * Fill form fields from a {fieldName: value} map. Unknown and read-only fields
 * are skipped (not errors); per-field failures (e.g. a dropdown value outside
 * its option list) are recorded in `skipped` rather than failing the whole
 * fill. Set `flatten` to bake the values in and drop interactivity.
 */
export async function fillFormFields(
  pdfBytes: Uint8Array,
  values: Record<string, FillValue>,
  opts: { flatten?: boolean } = {}
): Promise<FillResult> {
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  const form = doc.getForm();
  const filled: string[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];

  for (const [name, value] of Object.entries(values)) {
    let field: PDFField | null = null;
    try {
      field = form.getField(name);
    } catch {
      skipped.push({ name, reason: 'no such field' });
      continue;
    }
    if (field.isReadOnly()) {
      skipped.push({ name, reason: 'read-only' });
      continue;
    }
    try {
      if (field instanceof PDFTextField) {
        field.setText(value == null ? '' : String(value));
      } else if (field instanceof PDFCheckBox) {
        if (coerceBool(value)) field.check();
        else field.uncheck();
      } else if (field instanceof PDFDropdown) {
        field.select(Array.isArray(value) ? value.map(String) : String(value));
      } else if (field instanceof PDFRadioGroup) {
        field.select(String(value));
      } else if (field instanceof PDFOptionList) {
        field.select(Array.isArray(value) ? value.map(String) : String(value));
      } else {
        skipped.push({ name, reason: `unsupported field type (${fieldTypeOf(field)})` });
        continue;
      }
      filled.push(name);
    } catch (err) {
      skipped.push({ name, reason: (err as Error).message });
    }
  }

  if (opts.flatten) form.flatten();
  const bytes = await doc.save();
  log.info(`Filled ${filled.length} field(s), skipped ${skipped.length}`);
  return { bytes, filled, skipped };
}

// ---------------------------------------------------------------------------
// Layout + fingerprint (feed the AI decode; cache decodes per form)
// ---------------------------------------------------------------------------

export interface FieldLayout extends FormField {
  /** 1-based page the field's first widget sits on (best-effort; defaults to 1). */
  page: number;
  /** Widget rectangle in PDF points (origin bottom-left). Higher y = higher on page. */
  rect?: { x: number; y: number; width: number; height: number };
}

/**
 * Extract fields WITH their page + widget rectangle, sorted in reading order
 * (page, then top-to-bottom, then left-to-right). The positions are what let an
 * LLM correlate machine-generated field names (e.g. "f1_01[0]") to the visible
 * labels on the rendered form.
 */
export async function extractFormLayout(pdfBytes: Uint8Array): Promise<FieldLayout[]> {
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  const form = doc.getForm();

  const pageByRef = new Map<string, number>();
  doc.getPages().forEach((p, i) => {
    try {
      pageByRef.set(p.ref.toString(), i + 1);
    } catch {
      /* ignore */
    }
  });

  const base = new Map((await extractFormFields(pdfBytes)).map((f) => [f.name, f]));

  const out: FieldLayout[] = [];
  for (const field of form.getFields()) {
    const meta = base.get(field.getName());
    if (!meta) continue;
    let page = 1;
    let rect: FieldLayout['rect'];
    try {
      const widget = field.acroField.getWidgets()[0];
      if (widget) {
        const r = widget.getRectangle();
        rect = { x: r.x, y: r.y, width: r.width, height: r.height };
        const pRef = widget.dict.get(PDFName.of('P'));
        if (pRef instanceof PDFRef) page = pageByRef.get(pRef.toString()) ?? 1;
      }
    } catch {
      /* best-effort — keep page 1, no rect */
    }
    out.push({ ...meta, page, rect });
  }

  out.sort(
    (a, b) =>
      a.page - b.page || (b.rect?.y ?? 0) - (a.rect?.y ?? 0) || (a.rect?.x ?? 0) - (b.rect?.x ?? 0)
  );
  return out;
}

/**
 * Stable fingerprint for a blank form: the sorted set of `name:type` pairs,
 * hashed. Two copies of the same blank form share a fingerprint; a different
 * form (or revision with different fields) gets a different one. Used as the
 * cache key so each form's AI decode happens once.
 */
export function formFingerprint(fields: Array<Pick<FormField, 'name' | 'type'>>): string {
  const sig = fields
    .map((f) => `${f.name}:${f.type}`)
    .sort()
    .join('\n');
  return createHash('sha256').update(sig).digest('hex').slice(0, 16);
}
