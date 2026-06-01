// PDF form routes — decode a fillable form to human field meanings (cached per
// form), optionally auto-fill a draft from an entity's data, and fill+download.
//
//   POST /api/forms/decode[?entity=ID]   body: raw PDF bytes
//        → { fingerprint, formName, cached, fields:[{name,type,label,key,options,value,suggested}] }
//        When entity is given, each field also carries a `suggested` value drafted
//        from that entity's data (best-effort — the decode still returns if it fails).
//
//   POST /api/forms/fill   body: { pdfBase64, values, flatten? }
//        → the filled PDF (application/pdf, attachment)

import { loadConfig, jsonResponse } from '../data.js';
import { decodeForm, suggestFormValues } from '../pdf-form-decode.js';
import { fillFormFields, type FillValue } from '../pdf-forms.js';
import { createLogger } from '../logger.js';

const log = createLogger('FormsRoutes');

export async function handleFormsRoutes(
  req: Request,
  url: URL,
  pathname: string
): Promise<Response | null> {
  if (!pathname.startsWith('/api/forms/')) return null;

  // POST /api/forms/decode[?entity=ID]
  if (pathname === '/api/forms/decode' && req.method === 'POST') {
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.length === 0) {
      return jsonResponse({ error: 'empty body — POST the PDF bytes' }, 400);
    }

    let decoded;
    try {
      decoded = await decodeForm(bytes);
    } catch (err) {
      return jsonResponse({ error: `decode failed: ${(err as Error).message}` }, 400);
    }

    const entityId = url.searchParams.get('entity') ?? undefined;
    let suggested: Record<string, FillValue> | undefined;
    if (entityId) {
      const entity = (await loadConfig()).entities.find((e) => e.id === entityId);
      if (!entity) return jsonResponse({ error: `unknown entity "${entityId}"` }, 404);
      const entityData = {
        name: entity.name,
        type: entity.type ?? 'tax',
        ...(entity.metadata ?? {}),
      };
      try {
        suggested = await suggestFormValues(decoded.fields, entityData, decoded.formName);
      } catch (err) {
        // Auto-fill is best-effort; still return the decode so the user can fill manually.
        log.warn(`Auto-fill failed for entity ${entityId}: ${(err as Error).message}`);
      }
    }

    return jsonResponse({
      fingerprint: decoded.fingerprint,
      formName: decoded.formName,
      cached: decoded.cached,
      entity: entityId ?? null,
      fields: decoded.fields.map((f) => ({
        name: f.name,
        type: f.type,
        label: f.label ?? null,
        key: f.key ?? null,
        options: f.options ?? null,
        page: f.page,
        value: f.value ?? null,
        suggested: suggested ? (suggested[f.name] ?? null) : null,
      })),
    });
  }

  // POST /api/forms/fill  { pdfBase64, values, flatten? }
  if (pathname === '/api/forms/fill' && req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    if (!body.pdfBase64 || typeof body.pdfBase64 !== 'string') {
      return jsonResponse({ error: 'pdfBase64 is required' }, 400);
    }
    const bytes = new Uint8Array(Buffer.from(body.pdfBase64, 'base64'));
    const values = (body.values ?? {}) as Record<string, FillValue>;
    const result = await fillFormFields(bytes, values, { flatten: !!body.flatten });
    return new Response(new Uint8Array(result.bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="filled.pdf"',
        'X-Filled-Count': String(result.filled.length),
        'X-Skipped-Count': String(result.skipped.length),
      },
    });
  }

  return null;
}
