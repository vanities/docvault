// Fill a Form — a self-contained modal: drop a fillable PDF, DocVault decodes
// its fields (cryptic AcroForm names → human labels via AI, cached per form),
// optionally auto-fills a draft from an entity's data, you review/edit, then
// download the filled PDF. Deliberately unobtrusive — most PDFs are records,
// not forms, so this lives behind one Header icon, not in the file views.

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Download, FileText, Loader2, Sparkles, Upload } from 'lucide-react';
import { useToast } from '../../hooks/useToast';
import { API_BASE } from '../../constants';
import type { EntityConfig } from '../../hooks/useFileSystemServer';

interface DecodedField {
  name: string;
  type: string;
  label: string | null;
  key: string | null;
  options: string[] | null;
  page: number;
  value: string | boolean | string[] | null;
  suggested: string | boolean | string[] | null;
}

interface DecodeResponse {
  fillable?: boolean;
  formName: string | null;
  fields: DecodedField[];
}

const EDITABLE_TYPES = new Set(['text', 'checkbox', 'dropdown', 'radio', 'optionlist']);

function asString(v: unknown): string {
  if (Array.isArray(v)) return v[0] != null ? asString(v[0]) : '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}
function asBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string')
    return ['true', 'yes', 'on', '1', 'x', 'checked'].includes(v.toLowerCase());
  return false;
}

/** Chunked base64 — spreading a 140KB Uint8Array into String.fromCharCode overflows. */
function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function FillFormModal({
  isOpen,
  onClose,
  entities,
}: {
  isOpen: boolean;
  onClose: () => void;
  entities: EntityConfig[];
}) {
  const { addToast } = useToast();
  const [pdf, setPdf] = useState<ArrayBuffer | null>(null);
  const [fileName, setFileName] = useState('');
  const [decoded, setDecoded] = useState<DecodeResponse | null>(null);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [entityId, setEntityId] = useState('');
  const [decoding, setDecoding] = useState(false);
  const [autofilling, setAutofilling] = useState(false);
  const [filling, setFilling] = useState(false);

  const reset = () => {
    setPdf(null);
    setFileName('');
    setDecoded(null);
    setValues({});
    setEntityId('');
  };
  const close = () => {
    reset();
    onClose();
  };

  const initValues = (fields: DecodedField[], useSuggested: boolean) => {
    const next: Record<string, string | boolean> = {};
    for (const f of fields) {
      const src = useSuggested ? (f.suggested ?? f.value) : f.value;
      next[f.name] = f.type === 'checkbox' ? asBool(src) : asString(src);
    }
    setValues(next);
  };

  const onFile = async (file: File) => {
    const buf = await file.arrayBuffer();
    setPdf(buf);
    setFileName(file.name);
    setDecoded(null);
    setValues({});
    setEntityId('');
    setDecoding(true);
    try {
      const res = await fetch(`${API_BASE}/forms/decode`, { method: 'POST', body: buf });
      const data: DecodeResponse = await res.json();
      setDecoded(data);
      if (data.fields?.length) initValues(data.fields, false);
    } catch {
      addToast('Failed to read the form', 'error');
    } finally {
      setDecoding(false);
    }
  };

  const autofill = async () => {
    if (!pdf || !entityId) return;
    setAutofilling(true);
    try {
      const res = await fetch(`${API_BASE}/forms/decode?entity=${encodeURIComponent(entityId)}`, {
        method: 'POST',
        body: pdf,
      });
      const data: DecodeResponse = await res.json();
      setDecoded(data);
      initValues(data.fields, true);
      const n = data.fields.filter((f) => f.suggested != null).length;
      addToast(
        n > 0
          ? `Auto-filled ${n} field${n === 1 ? '' : 's'} — review before downloading`
          : 'No fields could be filled from that entity',
        n > 0 ? 'success' : 'info'
      );
    } catch {
      addToast('Auto-fill failed', 'error');
    } finally {
      setAutofilling(false);
    }
  };

  const download = async () => {
    if (!pdf) return;
    setFilling(true);
    try {
      const res = await fetch(`${API_BASE}/forms/fill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdfBase64: toBase64(new Uint8Array(pdf)), values }),
      });
      if (!res.ok) throw new Error('fill failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileName.replace(/\.pdf$/i, '') || 'form'}_filled.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      addToast('Downloaded filled PDF', 'success');
    } catch {
      addToast('Failed to fill the form', 'error');
    } finally {
      setFilling(false);
    }
  };

  const fields = (decoded?.fields ?? []).filter((f) => EDITABLE_TYPES.has(f.type));
  const fillable = !!decoded && decoded.fillable !== false && fields.length > 0;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(o) => {
        if (!o) close();
      }}
    >
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Fill a Form
          </DialogTitle>
          <DialogDescription>
            Drop a fillable PDF (e.g. a W-9). DocVault reads its fields and can auto-fill a draft
            from an entity's data — you review, then download.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 space-y-4 px-0.5">
          {!pdf ? (
            <label className="flex flex-col items-center justify-center gap-2 p-8 border-2 border-dashed border-border/50 rounded-xl cursor-pointer hover:bg-surface-100/40 text-surface-600">
              <Upload className="w-6 h-6" />
              <span className="text-[13px]">Choose a fillable PDF</span>
              <input
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onFile(f);
                }}
              />
            </label>
          ) : (
            <div className="flex items-center gap-2 text-[12px] text-surface-600">
              <FileText className="w-4 h-4 flex-shrink-0" />
              <span className="truncate">{fileName}</span>
              <Button variant="ghost" size="xs" onClick={reset} className="ml-auto">
                Change
              </Button>
            </div>
          )}

          {decoding && (
            <div className="flex items-center justify-center gap-2 py-6 text-surface-500 text-[13px]">
              <Loader2 className="w-4 h-4 animate-spin" /> Reading the form…
            </div>
          )}

          {decoded && !fillable && !decoding && (
            <p className="text-[13px] text-surface-600 p-4 text-center bg-surface-50/40 rounded-xl">
              This PDF has no fillable form fields — nothing to fill.
            </p>
          )}

          {fillable && (
            <>
              {decoded.formName && (
                <div className="text-[13px] font-medium text-surface-900">{decoded.formName}</div>
              )}

              <div className="flex items-end gap-2 p-3 bg-accent-500/5 border border-accent-500/15 rounded-xl">
                <div className="flex-1">
                  <label className="block text-[11px] font-medium text-surface-700 mb-1">
                    Auto-fill from entity
                  </label>
                  <select
                    value={entityId}
                    onChange={(e) => setEntityId(e.target.value)}
                    className="w-full text-[13px] bg-surface-100/60 border border-border/40 rounded-lg px-2 py-1.5"
                  >
                    <option value="">— choose —</option>
                    {entities.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </div>
                <Button size="sm" onClick={autofill} disabled={!entityId || autofilling}>
                  <Sparkles className={`w-4 h-4 ${autofilling ? 'animate-pulse' : ''}`} />
                  {autofilling ? 'Filling…' : 'Auto-fill'}
                </Button>
              </div>

              <div className="space-y-2">
                {fields.map((f) => (
                  <FieldRow
                    key={f.name}
                    field={f}
                    value={values[f.name]}
                    onChange={(v) => setValues((prev) => ({ ...prev, [f.name]: v }))}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button onClick={download} disabled={!fillable || filling}>
            {filling ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            {filling ? 'Preparing…' : 'Download filled PDF'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FieldRow({
  field,
  value,
  onChange,
}: {
  field: DecodedField;
  value: string | boolean | undefined;
  onChange: (v: string | boolean) => void;
}) {
  const label = field.label ?? field.name;

  if (field.type === 'checkbox') {
    return (
      <label className="flex items-center gap-2 text-[13px] text-surface-800">
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
          className="rounded"
        />
        {label}
      </label>
    );
  }

  if ((field.type === 'dropdown' || field.type === 'radio') && field.options?.length) {
    return (
      <div>
        <label className="block text-[12px] text-surface-700 mb-1">{label}</label>
        <select
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-full text-[13px] bg-surface-100/60 border border-border/40 rounded-lg px-2 py-1.5"
        >
          <option value="">—</option>
          {field.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div>
      <label className="block text-[12px] text-surface-700 mb-1">{label}</label>
      <Input
        type="text"
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        className="text-[13px]"
      />
    </div>
  );
}
