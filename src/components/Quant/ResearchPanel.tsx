import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Upload,
  AlignLeft,
  FileText,
  ExternalLink,
  Trash2,
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

interface ResearchEntry {
  id: string;
  filename: string | null;
  filePath: string;
  mediaType: 'application/pdf' | 'text/plain';
  uploadedAt: string;
  text: string | null;
  pageCount: number | null;
  extractedAt: string | null;
  extractorVersion: string | null;
  extractError: string | null;
  title?: string;
  author?: string;
  publisher?: string;
  reportDate?: string;
  sourceUrl?: string;
  notes?: string;
  tags?: string[];
  lastUpdated: string;
}

// Fields the PATCH endpoint accepts. Nullable so the client can clear a value
// by sending null — matches the route handler's behavior.
type PatchBody = Partial<{
  title: string | null;
  author: string | null;
  publisher: string | null;
  reportDate: string | null;
  sourceUrl: string | null;
  notes: string | null;
  tags: string[] | null;
}>;

function formatDate(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// The "Paste text" form draft. A factory (not a const) so each reset hands
// back a fresh object rather than sharing one reference across renders.
function blankTextDraft() {
  return { text: '', title: '', author: '', publisher: '', sourceUrl: '', reportDate: '' };
}

export function ResearchPanel() {
  const [entries, setEntries] = useState<ResearchEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // "Paste text" mode — a second ingest path alongside the PDF drop zone.
  const [mode, setMode] = useState<'pdf' | 'text'>('pdf');
  const [textDraft, setTextDraft] = useState(blankTextDraft);
  const [savingText, setSavingText] = useState(false);
  const [textError, setTextError] = useState<string | null>(null);

  // Initial load
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/research');
      const data = (await res.json()) as { entries: ResearchEntry[] };
      setEntries(data.entries ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // ---- Upload ----

  const uploadFiles = useCallback(async (files: FileList | File[]) => {
    setUploadError(null);
    setUploading(true);
    try {
      const arr = Array.from(files);
      for (const file of arr) {
        if (!file.name.toLowerCase().endsWith('.pdf')) {
          setUploadError(`Skipped ${file.name}: only PDFs are supported.`);
          continue;
        }
        const body = await file.arrayBuffer();
        const res = await fetch(`/api/research/upload?filename=${encodeURIComponent(file.name)}`, {
          method: 'POST',
          body,
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          setUploadError(err.error ?? `Upload failed (${res.status}) for ${file.name}`);
        }
      }
      await fetch('/api/research')
        .then((r) => r.json())
        .then((d: { entries: ResearchEntry[] }) => setEntries(d.entries ?? []));
    } finally {
      setUploading(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      if (e.dataTransfer.files?.length) void uploadFiles(e.dataTransfer.files);
    },
    [uploadFiles]
  );

  // Save a pasted transcript / article / note straight to the research store.
  // No file involved — the text itself is the body of a POST /api/research/text.
  const submitText = useCallback(async () => {
    if (!textDraft.text.trim()) return;
    setTextError(null);
    setSavingText(true);
    try {
      const res = await fetch('/api/research/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: textDraft.text,
          title: textDraft.title.trim() || undefined,
          author: textDraft.author.trim() || undefined,
          publisher: textDraft.publisher.trim() || undefined,
          sourceUrl: textDraft.sourceUrl.trim() || undefined,
          reportDate: textDraft.reportDate.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setTextError(err.error ?? `Save failed (${res.status})`);
        return;
      }
      setTextDraft(blankTextDraft());
      // Refresh inline (no loading flash) — mirrors the PDF upload path.
      await fetch('/api/research')
        .then((r) => r.json())
        .then((d: { entries: ResearchEntry[] }) => setEntries(d.entries ?? []));
    } finally {
      setSavingText(false);
    }
  }, [textDraft]);

  // ---- Mutations ----

  const patchEntry = async (id: string, body: PatchBody) => {
    const res = await fetch(`/api/research/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = (await res.json()) as { entry: ResearchEntry };
      setEntries((prev) => prev.map((e) => (e.id === id ? data.entry : e)));
    }
  };

  const deleteEntry = async (id: string) => {
    if (!window.confirm('Delete this entry? The file and all notes will be removed.')) return;
    const res = await fetch(`/api/research/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setEntries((prev) => prev.filter((e) => e.id !== id));
      if (expandedId === id) setExpandedId(null);
    }
  };

  const reExtract = async (id: string) => {
    const res = await fetch(`/api/research/${id}/re-extract`, { method: 'POST' });
    if (res.ok) {
      const data = (await res.json()) as { entry: ResearchEntry };
      setEntries((prev) => prev.map((e) => (e.id === id ? data.entry : e)));
    }
  };

  // ---- Render ----

  return (
    <div>
      {/* Ingest card — toggle between uploading a PDF and pasting raw text. */}
      <Card variant="glass" className="mb-6">
        {/* Mode toggle */}
        <div className="flex gap-1 px-4 pt-4">
          {(['pdf', 'text'] as const).map((m) => {
            const active = mode === m;
            const Icon = m === 'pdf' ? Upload : AlignLeft;
            return (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                  active
                    ? 'bg-surface-200/50 text-surface-950'
                    : 'text-surface-600 hover:text-surface-800'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {m === 'pdf' ? 'Upload PDF' : 'Paste text'}
              </button>
            );
          })}
        </div>

        {mode === 'pdf' ? (
          <>
            <div
              onDragEnter={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setIsDragging(false);
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              className={`p-6 mx-4 mb-4 mt-3 border-2 border-dashed rounded-lg transition-all cursor-pointer ${
                isDragging
                  ? 'border-accent-400 bg-accent-500/5'
                  : 'border-surface-500 hover:border-surface-400'
              }`}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="flex flex-col items-center text-center">
                {uploading ? (
                  <>
                    <Loader2 className="w-8 h-8 mb-2 text-accent-400 animate-spin" />
                    <p className="text-[13px] text-surface-700">Uploading and extracting text…</p>
                  </>
                ) : (
                  <>
                    <Upload className="w-8 h-8 mb-2 text-surface-600" />
                    <p className="text-[13px] text-surface-700 mb-1">
                      <span className="font-medium text-accent-400">Click to upload</span> or drag &
                      drop
                    </p>
                    <p className="text-[12px] text-surface-600">
                      Research PDFs from Cowen, Lyn Alden, Fidelity, Raoul Pal, etc. Text is
                      extracted automatically — no AI parsing.
                    </p>
                  </>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.length) void uploadFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
              </div>
            </div>
            {uploadError && (
              <div className="px-4 pb-4 flex items-center gap-2 text-[12px] text-red-400">
                <AlertCircle className="w-3.5 h-3.5" />
                {uploadError}
              </div>
            )}
          </>
        ) : (
          <div className="p-4 pt-3 space-y-3">
            <Textarea
              value={textDraft.text}
              onChange={(e) => setTextDraft({ ...textDraft, text: e.target.value })}
              placeholder="Paste a transcript, article, or notes here…"
              className="text-[12px] min-h-44 leading-relaxed"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Input
                value={textDraft.title}
                onChange={(e) => setTextDraft({ ...textDraft, title: e.target.value })}
                className="h-8 text-[12px]"
                placeholder="Title (inferred from first line if blank)"
              />
              <Input
                value={textDraft.sourceUrl}
                onChange={(e) => setTextDraft({ ...textDraft, sourceUrl: e.target.value })}
                className="h-8 text-[12px]"
                placeholder="Source URL (e.g. YouTube link)"
              />
              <Input
                value={textDraft.author}
                onChange={(e) => setTextDraft({ ...textDraft, author: e.target.value })}
                className="h-8 text-[12px]"
                placeholder="Author (e.g. Benjamin Cowen)"
              />
              <Input
                value={textDraft.publisher}
                onChange={(e) => setTextDraft({ ...textDraft, publisher: e.target.value })}
                className="h-8 text-[12px]"
                placeholder="Publisher (e.g. Into The Cryptoverse)"
              />
              <Input
                type="date"
                value={textDraft.reportDate}
                onChange={(e) => setTextDraft({ ...textDraft, reportDate: e.target.value })}
                className="h-8 text-[12px]"
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] text-surface-600">
                Stored verbatim in the Research tab — no AI parsing.
              </p>
              <Button
                size="sm"
                onClick={() => void submitText()}
                disabled={savingText || !textDraft.text.trim()}
              >
                {savingText ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Saving…
                  </>
                ) : (
                  'Save to Research'
                )}
              </Button>
            </div>
            {textError && (
              <div className="flex items-center gap-2 text-[12px] text-red-400">
                <AlertCircle className="w-3.5 h-3.5" />
                {textError}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Entries list */}
      {loading ? (
        <div className="text-center py-8 text-surface-700 text-[13px]">
          <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
          Loading reports…
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-8 text-surface-700 text-[13px]">
          No research entries yet — upload a PDF or paste a transcript above.
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <ResearchRow
              key={entry.id}
              entry={entry}
              expanded={expandedId === entry.id}
              onToggle={() => setExpandedId((prev) => (prev === entry.id ? null : entry.id))}
              onPatch={(body) => patchEntry(entry.id, body)}
              onDelete={() => deleteEntry(entry.id)}
              onReExtract={() => reExtract(entry.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row component — header + expandable detail
// ---------------------------------------------------------------------------

function ResearchRow({
  entry,
  expanded,
  onToggle,
  onPatch,
  onDelete,
  onReExtract,
}: {
  entry: ResearchEntry;
  expanded: boolean;
  onToggle: () => void;
  onPatch: (body: PatchBody) => Promise<void>;
  onDelete: () => void;
  onReExtract: () => Promise<void>;
}) {
  // Local edit buffers — flushed to the server on blur so every keystroke
  // doesn't fire a PATCH. Kept in refs-ish state so parent re-renders don't
  // wipe user input mid-edit.
  const [draft, setDraft] = useState({
    title: entry.title ?? '',
    author: entry.author ?? '',
    publisher: entry.publisher ?? '',
    reportDate: entry.reportDate ?? '',
    sourceUrl: entry.sourceUrl ?? '',
    notes: entry.notes ?? '',
  });
  const [reExtracting, setReExtracting] = useState(false);

  useEffect(() => {
    setDraft({
      title: entry.title ?? '',
      author: entry.author ?? '',
      publisher: entry.publisher ?? '',
      reportDate: entry.reportDate ?? '',
      sourceUrl: entry.sourceUrl ?? '',
      notes: entry.notes ?? '',
    });
  }, [
    entry.id,
    entry.lastUpdated,
    entry.title,
    entry.author,
    entry.publisher,
    entry.reportDate,
    entry.sourceUrl,
    entry.notes,
  ]);

  const flush = (field: keyof typeof draft) => {
    const value = draft[field].trim();
    const current = (entry[field] ?? '').trim();
    if (value === current) return;
    void onPatch({ [field]: value === '' ? null : value });
  };

  const handleReExtract = async () => {
    setReExtracting(true);
    try {
      await onReExtract();
    } finally {
      setReExtracting(false);
    }
  };

  return (
    <Card variant="glass" className="overflow-hidden">
      {/* Header row */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-3 text-left hover:bg-surface-200/30 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-surface-600 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-surface-600 flex-shrink-0" />
        )}
        {entry.mediaType === 'application/pdf' ? (
          <FileText className="w-4 h-4 text-amber-400 flex-shrink-0" />
        ) : (
          <AlignLeft className="w-4 h-4 text-purple-400 flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[13px] font-medium text-surface-950 truncate">
              {entry.title || entry.filename || entry.id}
            </span>
            {entry.author && <span className="text-[11px] text-surface-700">· {entry.author}</span>}
            {entry.publisher && entry.publisher !== entry.author && (
              <span className="text-[11px] text-surface-600">· {entry.publisher}</span>
            )}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-surface-600 mt-0.5">
            <span>{formatDate(entry.reportDate ?? entry.uploadedAt)}</span>
            {entry.pageCount !== null && <span>· {entry.pageCount}p</span>}
            {entry.extractError && (
              <span className="text-red-400 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                extract failed
              </span>
            )}
          </div>
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-border/40 p-4 space-y-4">
          {/* Metadata editor */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-surface-600 font-semibold">
                Title
              </label>
              <Input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                onBlur={() => flush('title')}
                className="h-8 text-[12px]"
                placeholder="Report title"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-surface-600 font-semibold">
                Report date
              </label>
              <Input
                type="date"
                value={draft.reportDate}
                onChange={(e) => setDraft({ ...draft, reportDate: e.target.value })}
                onBlur={() => flush('reportDate')}
                className="h-8 text-[12px]"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-surface-600 font-semibold">
                Author
              </label>
              <Input
                value={draft.author}
                onChange={(e) => setDraft({ ...draft, author: e.target.value })}
                onBlur={() => flush('author')}
                className="h-8 text-[12px]"
                placeholder="e.g. Benjamin Cowen"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-surface-600 font-semibold">
                Publisher
              </label>
              <Input
                value={draft.publisher}
                onChange={(e) => setDraft({ ...draft, publisher: e.target.value })}
                onBlur={() => flush('publisher')}
                className="h-8 text-[12px]"
                placeholder="e.g. Into The Cryptoverse"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-[10px] uppercase tracking-wider text-surface-600 font-semibold">
                Source URL
              </label>
              <Input
                value={draft.sourceUrl}
                onChange={(e) => setDraft({ ...draft, sourceUrl: e.target.value })}
                onBlur={() => flush('sourceUrl')}
                className="h-8 text-[12px]"
                placeholder="https://…"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-surface-600 font-semibold">
              Your notes
            </label>
            <Textarea
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              onBlur={() => flush('notes')}
              className="text-[12px] min-h-20"
              placeholder="Takeaways, action items, quotes to revisit..."
            />
          </div>

          {/* Extracted text */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] uppercase tracking-wider text-surface-600 font-semibold">
                {entry.mediaType === 'application/pdf' ? 'Extracted text' : 'Content'}
                {entry.pageCount !== null && (
                  <span className="ml-2 font-normal text-surface-500 normal-case tracking-normal">
                    {entry.pageCount} page{entry.pageCount === 1 ? '' : 's'}
                  </span>
                )}
              </label>
              {entry.mediaType === 'application/pdf' && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={handleReExtract}
                  disabled={reExtracting}
                  title="Re-run text extraction"
                >
                  <RefreshCw className={`w-3 h-3 ${reExtracting ? 'animate-spin' : ''}`} />
                  Re-extract
                </Button>
              )}
            </div>
            {entry.extractError ? (
              <div className="p-2 rounded bg-red-500/10 border border-red-500/20 text-[11px] text-red-400">
                {entry.extractError}
              </div>
            ) : entry.text ? (
              <pre className="p-2 rounded bg-surface-200/30 border border-border/40 text-[11px] text-surface-800 whitespace-pre-wrap max-h-80 overflow-y-auto font-mono leading-relaxed">
                {entry.text}
              </pre>
            ) : (
              <div className="text-[11px] text-surface-600 italic">No text extracted yet.</div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" asChild>
                <a
                  href={`/api/research/${entry.id}/file`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  {entry.mediaType === 'application/pdf' ? 'Open PDF' : 'Open raw text'}
                </a>
              </Button>
              {entry.sourceUrl && (
                <Button variant="ghost" size="sm" asChild>
                  <a href={entry.sourceUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="w-3.5 h-3.5" />
                    Open source
                  </a>
                </Button>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              className="text-red-400 hover:bg-red-500/10"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
