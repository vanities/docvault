// Health Research view — paste, upload, or fetch health/longevity research
// (sleep studies, supplement labels, podcast transcripts, etc). Mirrors the
// Quant Research tab but uses the existing `tags` field for free-form topics
// and a per-entry `linkedPersonIds` list so research about a specific family
// member can be surfaced on that person's dashboard later.
//
// Storage lives in the same `.docvault-research.json` as Quant Research —
// entries are partitioned by `domain: 'finance' | 'health'`. See
// server/routes/research.ts.

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
  X,
  Youtube,
  Video,
  Heart,
  Users,
  Tag as TagIcon,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { HealthPerson } from '../../hooks/useFileSystemServer';
import { useHealthApi } from './useHealthApi';

// ---------------------------------------------------------------------------
// Types — mirror server/routes/research.ts:ResearchEntry. We only surface
// the fields this view actually reads/writes.
// ---------------------------------------------------------------------------

interface ResearchEntry {
  id: string;
  domain: 'finance' | 'health';
  filename: string | null;
  filePath: string;
  mediaType:
    | 'application/pdf'
    | 'text/plain'
    | 'video/mp4'
    | 'video/quicktime'
    | 'video/x-matroska'
    | 'video/webm'
    | 'audio/mpeg'
    | 'audio/mp4'
    | 'audio/wav'
    | 'audio/webm';
  uploadedAt: string;
  text: string | null;
  pageCount: number | null;
  extractedAt: string | null;
  extractorVersion: string | null;
  extractError: string | null;
  // Background transcription lifecycle — present on uploaded video/audio only.
  transcribeStatus?: 'pending' | 'running' | 'done' | 'error';
  transcribeError?: string;
  durationSec?: number;
  title?: string;
  author?: string;
  publisher?: string;
  reportDate?: string;
  sourceUrl?: string;
  notes?: string;
  tags?: string[];
  linkedPersonIds?: string[];
  lastUpdated: string;
}

type PatchBody = Partial<{
  title: string | null;
  author: string | null;
  publisher: string | null;
  reportDate: string | null;
  sourceUrl: string | null;
  notes: string | null;
  tags: string[] | null;
  linkedPersonIds: string[] | null;
}>;

function formatDate(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Uploaded video/audio entries (vs PDF / pasted text) — these carry a stored
 *  media file plus a background transcript. */
function isMediaEntry(mediaType: ResearchEntry['mediaType']): boolean {
  return mediaType.startsWith('video/') || mediaType.startsWith('audio/');
}

/** Seconds → "M:SS" (or "H:MM:SS" past an hour), for media duration display. */
function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

function blankTextDraft() {
  return {
    text: '',
    title: '',
    author: '',
    publisher: '',
    sourceUrl: '',
    reportDate: '',
    tags: [] as string[],
    linkedPersonIds: [] as string[],
  };
}

function blankYoutubeDraft() {
  return {
    url: '',
    tags: [] as string[],
    linkedPersonIds: [] as string[],
  };
}

// ---------------------------------------------------------------------------
// TagChipInput — comma/space/Enter commits a chip. Like the Quant ticker
// chip input but without uppercase coercion and with a permissive charset
// (topics are free-form: "sleep", "apo-b", "9p21.3"). Empty / whitespace-only
// drafts are silently dropped.
// ---------------------------------------------------------------------------

const TAG_BAD_CHAR_RE = /[,\s]/;

function TagChipInput({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draftText, setDraftText] = useState('');

  const commitDraft = (raw: string) => {
    const next = new Set(value);
    let changed = false;
    for (const candidate of raw.split(/[,\s]+/)) {
      const tag = candidate.trim();
      if (!tag || TAG_BAD_CHAR_RE.test(tag)) continue;
      if (!next.has(tag)) {
        next.add(tag);
        changed = true;
      }
    }
    if (changed) onChange([...next]);
    setDraftText('');
  };

  const removeTag = (tag: string) => onChange(value.filter((t) => t !== tag));

  return (
    <div className="flex flex-wrap items-center gap-1 px-2 py-1 rounded-md border border-surface-500 bg-transparent min-h-8 focus-within:border-rose-400 transition-colors">
      {value.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-500/10 text-[11px] text-rose-300"
        >
          {tag}
          <button
            type="button"
            onClick={() => removeTag(tag)}
            className="text-rose-400/60 hover:text-rose-400 transition-colors"
            aria-label={`Remove ${tag}`}
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
      <input
        type="text"
        value={draftText}
        onChange={(e) => setDraftText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',' || e.key === ' ' || e.key === 'Tab') {
            if (draftText.trim()) {
              e.preventDefault();
              commitDraft(draftText);
            }
          } else if (e.key === 'Backspace' && draftText === '' && value.length > 0) {
            removeTag(value[value.length - 1]);
          }
        }}
        onBlur={() => {
          if (draftText.trim()) commitDraft(draftText);
        }}
        placeholder={value.length === 0 ? placeholder : ''}
        className="flex-1 min-w-20 bg-transparent text-[12px] outline-none placeholder:text-surface-600 text-surface-950"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// PeoplePicker — click-to-toggle list of available HealthPersons. Sized for
// the typical case of a small household; if the list ever gets long we can
// swap in a search box.
// ---------------------------------------------------------------------------

function PeoplePicker({
  people,
  value,
  onChange,
}: {
  people: HealthPerson[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  if (people.length === 0) {
    return (
      <div className="text-[11px] text-surface-600 italic px-2 py-1">
        No people yet — add one from Health → Overview first.
      </div>
    );
  }
  const selected = new Set(value);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {people.map((p) => {
        const on = selected.has(p.id);
        return (
          <button
            type="button"
            key={p.id}
            onClick={() => {
              const next = new Set(selected);
              if (on) next.delete(p.id);
              else next.add(p.id);
              onChange([...next]);
            }}
            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium border transition-colors ${
              on
                ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                : 'border-border/40 bg-transparent text-surface-700 hover:text-surface-950 hover:border-border/80'
            }`}
          >
            <span
              className="w-2 h-2 rounded-full inline-block"
              style={{ background: p.color ?? '#9ca3af' }}
            />
            {p.name}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// HealthResearchView — page header + ingest card + entry list.
// ---------------------------------------------------------------------------

export function HealthResearchView() {
  const api = useHealthApi();
  const [entries, setEntries] = useState<ResearchEntry[]>([]);
  const [people, setPeople] = useState<HealthPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);

  const [mode, setMode] = useState<'pdf' | 'text' | 'youtube' | 'video'>('text');
  const [textDraft, setTextDraft] = useState(blankTextDraft);
  const [savingText, setSavingText] = useState(false);
  const [textError, setTextError] = useState<string | null>(null);
  const [youtubeDraft, setYoutubeDraft] = useState(blankYoutubeDraft);
  const [savingYoutube, setSavingYoutube] = useState(false);
  const [youtubeError, setYoutubeError] = useState<string | null>(null);

  // ---- Load entries + the people list (used by the picker) ----
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/research?domain=health');
      const data = (await res.json()) as { entries: ResearchEntry[] };
      setEntries(data.entries ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void api
      .listPeople()
      .then(setPeople)
      .catch(() => setPeople([]));
  }, [api, load]);

  // ---- PDF upload ----
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
        const res = await fetch(
          `/api/research/upload?filename=${encodeURIComponent(file.name)}&domain=health`,
          { method: 'POST', body }
        );
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          setUploadError(err.error ?? `Upload failed (${res.status}) for ${file.name}`);
        }
      }
      await fetch('/api/research?domain=health')
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

  // ---- Video/audio upload (kept as media + transcribed in the background) ----
  const uploadMedia = useCallback(async (files: FileList | File[]) => {
    const file = Array.from(files)[0];
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    try {
      const body = await file.arrayBuffer();
      const res = await fetch(
        `/api/research/video?filename=${encodeURIComponent(file.name)}&domain=health`,
        { method: 'POST', body }
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setUploadError(err.error ?? `Upload failed (${res.status}) for ${file.name}`);
        return;
      }
      await fetch('/api/research?domain=health')
        .then((r) => r.json())
        .then((d: { entries: ResearchEntry[] }) => setEntries(d.entries ?? []));
    } finally {
      setUploading(false);
    }
  }, []);

  const handleMediaDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      if (e.dataTransfer.files?.length) void uploadMedia(e.dataTransfer.files);
    },
    [uploadMedia]
  );

  // Poll while any entry is mid-transcription so rows update without a refresh.
  const anyTranscribing = entries.some(
    (e) => e.transcribeStatus === 'pending' || e.transcribeStatus === 'running'
  );
  useEffect(() => {
    if (!anyTranscribing) return;
    const interval = setInterval(() => {
      void fetch('/api/research?domain=health')
        .then((r) => r.json())
        .then((d: { entries: ResearchEntry[] }) => setEntries(d.entries ?? []))
        .catch(() => {});
    }, 3000);
    return () => clearInterval(interval);
  }, [anyTranscribing]);

  // ---- Pasted text ----
  const submitText = useCallback(async () => {
    if (!textDraft.text.trim()) return;
    setTextError(null);
    setSavingText(true);
    try {
      const res = await fetch('/api/research/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'health',
          text: textDraft.text,
          title: textDraft.title.trim() || undefined,
          author: textDraft.author.trim() || undefined,
          publisher: textDraft.publisher.trim() || undefined,
          sourceUrl: textDraft.sourceUrl.trim() || undefined,
          reportDate: textDraft.reportDate.trim() || undefined,
          tags: textDraft.tags.length > 0 ? textDraft.tags : undefined,
          linkedPersonIds:
            textDraft.linkedPersonIds.length > 0 ? textDraft.linkedPersonIds : undefined,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setTextError(err.error ?? `Save failed (${res.status})`);
        return;
      }
      setTextDraft(blankTextDraft());
      await fetch('/api/research?domain=health')
        .then((r) => r.json())
        .then((d: { entries: ResearchEntry[] }) => setEntries(d.entries ?? []));
    } finally {
      setSavingText(false);
    }
  }, [textDraft]);

  // ---- YouTube ----
  const submitYoutube = useCallback(async () => {
    if (!youtubeDraft.url.trim()) return;
    setYoutubeError(null);
    setSavingYoutube(true);
    try {
      const res = await fetch('/api/research/youtube', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'health',
          url: youtubeDraft.url.trim(),
          tags: youtubeDraft.tags.length > 0 ? youtubeDraft.tags : undefined,
          linkedPersonIds:
            youtubeDraft.linkedPersonIds.length > 0 ? youtubeDraft.linkedPersonIds : undefined,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setYoutubeError(err.error ?? `Fetch failed (${res.status})`);
        return;
      }
      setYoutubeDraft(blankYoutubeDraft());
      await fetch('/api/research?domain=health')
        .then((r) => r.json())
        .then((d: { entries: ResearchEntry[] }) => setEntries(d.entries ?? []));
    } finally {
      setSavingYoutube(false);
    }
  }, [youtubeDraft]);

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

  const reTranscribe = async (id: string) => {
    const res = await fetch(`/api/research/${id}/re-transcribe`, { method: 'POST' });
    if (res.ok) {
      const data = (await res.json()) as { entry: ResearchEntry };
      setEntries((prev) => prev.map((e) => (e.id === id ? data.entry : e)));
    }
  };

  return (
    <div className="min-h-full bg-surface-0">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {/* Page header — mirrors HealthView so navigation feels consistent */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-rose-500/10 flex items-center justify-center">
            <FileText className="w-5 h-5 text-rose-400" />
          </div>
          <div>
            <h1 className="font-display text-2xl italic text-surface-950">Health Research</h1>
            <p className="text-sm text-surface-700">
              Studies, articles, and podcasts on sleep, nutrition, longevity — text is extracted or
              stored verbatim. Add your own topics and tag who it applies to.
            </p>
          </div>
        </div>

        {/* Ingest card — same 3-mode toggle as Quant Research */}
        <Card variant="glass" className="mb-6">
          <div className="flex gap-1 px-4 pt-4">
            {(['text', 'pdf', 'youtube', 'video'] as const).map((m) => {
              const active = mode === m;
              const Icon =
                m === 'pdf' ? Upload : m === 'text' ? AlignLeft : m === 'youtube' ? Youtube : Video;
              const label =
                m === 'pdf'
                  ? 'Upload PDF'
                  : m === 'text'
                    ? 'Paste text'
                    : m === 'youtube'
                      ? 'From YouTube'
                      : 'Upload video/audio';
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
                  {label}
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
                    ? 'border-rose-400 bg-rose-500/5'
                    : 'border-surface-500 hover:border-surface-400'
                }`}
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="flex flex-col items-center text-center">
                  {uploading ? (
                    <>
                      <Loader2 className="w-8 h-8 mb-2 text-rose-400 animate-spin" />
                      <p className="text-[13px] text-surface-700">Uploading and extracting text…</p>
                    </>
                  ) : (
                    <>
                      <Upload className="w-8 h-8 mb-2 text-surface-600" />
                      <p className="text-[13px] text-surface-700 mb-1">
                        <span className="font-medium text-rose-400">Click to upload</span> or drag &
                        drop
                      </p>
                      <p className="text-[12px] text-surface-600">
                        Study PDFs, supplement labels, lab guidance documents. Text is extracted
                        automatically — no AI parsing.
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
          ) : mode === 'text' ? (
            <div className="p-4 pt-3 space-y-3">
              <Textarea
                value={textDraft.text}
                onChange={(e) => setTextDraft({ ...textDraft, text: e.target.value })}
                placeholder="Paste a study abstract, article, podcast transcript, or notes…"
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
                  placeholder="Source URL"
                />
                <Input
                  value={textDraft.author}
                  onChange={(e) => setTextDraft({ ...textDraft, author: e.target.value })}
                  className="h-8 text-[12px]"
                  placeholder="Author (e.g. Bryan Johnson)"
                />
                <Input
                  value={textDraft.publisher}
                  onChange={(e) => setTextDraft({ ...textDraft, publisher: e.target.value })}
                  className="h-8 text-[12px]"
                  placeholder="Publisher (e.g. Blueprint, JAMA)"
                />
                <Input
                  type="date"
                  value={textDraft.reportDate}
                  onChange={(e) => setTextDraft({ ...textDraft, reportDate: e.target.value })}
                  className="h-8 text-[12px]"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-surface-600 font-semibold flex items-center gap-1 mb-1">
                  <TagIcon className="w-3 h-3" /> Topics
                </label>
                <TagChipInput
                  value={textDraft.tags}
                  onChange={(next) => setTextDraft({ ...textDraft, tags: next })}
                  placeholder="sleep, longevity, apob, cardio…"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-surface-600 font-semibold flex items-center gap-1 mb-1">
                  <Users className="w-3 h-3" /> Applies to (optional)
                </label>
                <PeoplePicker
                  people={people}
                  value={textDraft.linkedPersonIds}
                  onChange={(next) => setTextDraft({ ...textDraft, linkedPersonIds: next })}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] text-surface-600">Stored verbatim — no AI parsing.</p>
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
          ) : mode === 'youtube' ? (
            <div className="p-4 pt-3 space-y-3">
              <Input
                type="url"
                value={youtubeDraft.url}
                onChange={(e) => setYoutubeDraft({ ...youtubeDraft, url: e.target.value })}
                placeholder="YouTube URL (e.g. https://www.youtube.com/watch?v=…)"
                className="h-9 text-[12px]"
              />
              <div>
                <label className="text-[10px] uppercase tracking-wider text-surface-600 font-semibold flex items-center gap-1 mb-1">
                  <TagIcon className="w-3 h-3" /> Topics
                </label>
                <TagChipInput
                  value={youtubeDraft.tags}
                  onChange={(next) => setYoutubeDraft({ ...youtubeDraft, tags: next })}
                  placeholder="sleep, longevity, apob…"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-surface-600 font-semibold flex items-center gap-1 mb-1">
                  <Users className="w-3 h-3" /> Applies to (optional)
                </label>
                <PeoplePicker
                  people={people}
                  value={youtubeDraft.linkedPersonIds}
                  onChange={(next) => setYoutubeDraft({ ...youtubeDraft, linkedPersonIds: next })}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] text-surface-600">
                  Captions + metadata (title, channel, upload date) auto-fetched via yt-dlp.
                </p>
                <Button
                  size="sm"
                  onClick={() => void submitYoutube()}
                  disabled={savingYoutube || !youtubeDraft.url.trim()}
                >
                  {savingYoutube ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Fetching…
                    </>
                  ) : (
                    'Fetch & Save'
                  )}
                </Button>
              </div>
              {youtubeError && (
                <div className="flex items-center gap-2 text-[12px] text-red-400">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {youtubeError}
                </div>
              )}
            </div>
          ) : (
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
                onDrop={handleMediaDrop}
                className={`p-6 mx-4 mb-4 mt-3 border-2 border-dashed rounded-lg transition-all cursor-pointer ${
                  isDragging
                    ? 'border-rose-400 bg-rose-500/5'
                    : 'border-surface-500 hover:border-surface-400'
                }`}
                onClick={() => videoInputRef.current?.click()}
              >
                <div className="flex flex-col items-center text-center">
                  {uploading ? (
                    <>
                      <Loader2 className="w-8 h-8 mb-2 text-rose-400 animate-spin" />
                      <p className="text-[13px] text-surface-700">Uploading…</p>
                    </>
                  ) : (
                    <>
                      <Video className="w-8 h-8 mb-2 text-surface-600" />
                      <p className="text-[13px] text-surface-700 mb-1">
                        <span className="font-medium text-rose-400">Click to upload</span> or drag &
                        drop
                      </p>
                      <p className="text-[12px] text-surface-600">
                        Video or audio (mp4, mov, mkv, webm, mp3, m4a, wav) — e.g. a health podcast
                        or talk. Kept here and transcribed automatically via Parakeet.
                      </p>
                    </>
                  )}
                  <input
                    ref={videoInputRef}
                    type="file"
                    accept="video/*,audio/*"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files?.length) void uploadMedia(e.target.files);
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
          )}
        </Card>

        {/* Entries list */}
        {loading ? (
          <div className="text-center py-8 text-surface-700 text-[13px]">
            <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
            Loading entries…
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-8 text-surface-700 text-[13px]">
            No health research yet — paste a study abstract or article above to get started.
          </div>
        ) : (
          <div className="space-y-2">
            {entries.map((entry) => (
              <HealthResearchRow
                key={entry.id}
                entry={entry}
                people={people}
                expanded={expandedId === entry.id}
                onToggle={() => setExpandedId((prev) => (prev === entry.id ? null : entry.id))}
                onPatch={(body) => patchEntry(entry.id, body)}
                onDelete={() => deleteEntry(entry.id)}
                onReExtract={() => reExtract(entry.id)}
                onReTranscribe={() => reTranscribe(entry.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row component — header + expandable detail
// ---------------------------------------------------------------------------

function HealthResearchRow({
  entry,
  people,
  expanded,
  onToggle,
  onPatch,
  onDelete,
  onReExtract,
  onReTranscribe,
}: {
  entry: ResearchEntry;
  people: HealthPerson[];
  expanded: boolean;
  onToggle: () => void;
  onPatch: (body: PatchBody) => Promise<void>;
  onDelete: () => void;
  onReExtract: () => Promise<void>;
  onReTranscribe: () => Promise<void>;
}) {
  const media = isMediaEntry(entry.mediaType);
  const transcribing = entry.transcribeStatus === 'pending' || entry.transcribeStatus === 'running';
  const [draft, setDraft] = useState({
    title: entry.title ?? '',
    author: entry.author ?? '',
    publisher: entry.publisher ?? '',
    reportDate: entry.reportDate ?? '',
    sourceUrl: entry.sourceUrl ?? '',
    notes: entry.notes ?? '',
  });
  const [draftTags, setDraftTags] = useState<string[]>(entry.tags ?? []);
  const [draftPersonIds, setDraftPersonIds] = useState<string[]>(entry.linkedPersonIds ?? []);
  const [reExtracting, setReExtracting] = useState(false);
  const [reTranscribing, setReTranscribing] = useState(false);

  useEffect(() => {
    setDraft({
      title: entry.title ?? '',
      author: entry.author ?? '',
      publisher: entry.publisher ?? '',
      reportDate: entry.reportDate ?? '',
      sourceUrl: entry.sourceUrl ?? '',
      notes: entry.notes ?? '',
    });
    setDraftTags(entry.tags ?? []);
    setDraftPersonIds(entry.linkedPersonIds ?? []);
  }, [
    entry.id,
    entry.lastUpdated,
    entry.title,
    entry.author,
    entry.publisher,
    entry.reportDate,
    entry.sourceUrl,
    entry.notes,
    entry.tags?.join(',') ?? '',
    entry.linkedPersonIds?.join(',') ?? '',
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

  const handleReTranscribe = async () => {
    setReTranscribing(true);
    try {
      await onReTranscribe();
    } finally {
      setReTranscribing(false);
    }
  };

  const linkedNames = (entry.linkedPersonIds ?? [])
    .map((id) => people.find((p) => p.id === id)?.name)
    .filter((n): n is string => Boolean(n));

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
        ) : media ? (
          <Video className="w-4 h-4 text-sky-400 flex-shrink-0" />
        ) : (
          <AlignLeft className="w-4 h-4 text-rose-400 flex-shrink-0" />
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
          <div className="flex items-center gap-2 text-[11px] text-surface-600 mt-0.5 flex-wrap">
            <span>{formatDate(entry.reportDate ?? entry.uploadedAt)}</span>
            {entry.pageCount !== null && <span>· {entry.pageCount}p</span>}
            {entry.durationSec != null && entry.durationSec > 0 && (
              <span>· {formatDuration(entry.durationSec)}</span>
            )}
            {transcribing && (
              <span className="text-sky-400 flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                Transcribing…
              </span>
            )}
            {linkedNames.length > 0 && (
              <span className="inline-flex items-center gap-1 text-rose-300">
                <Heart className="w-3 h-3" /> {linkedNames.join(', ')}
              </span>
            )}
            {entry.tags && entry.tags.length > 0 && (
              <span className="inline-flex items-center gap-1 text-surface-700">
                <TagIcon className="w-3 h-3" /> {entry.tags.join(', ')}
              </span>
            )}
            {!transcribing && entry.extractError && (
              <span className="text-red-400 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {media ? 'transcription failed' : 'extract failed'}
              </span>
            )}
          </div>
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-border/40 p-4 space-y-4">
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
                placeholder="Title"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-surface-600 font-semibold">
                Date
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
                placeholder="e.g. Bryan Johnson"
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
                placeholder="e.g. Blueprint, JAMA"
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
            <div className="sm:col-span-2">
              <label className="text-[10px] uppercase tracking-wider text-surface-600 font-semibold flex items-center gap-1">
                <TagIcon className="w-3 h-3" /> Topics
              </label>
              <TagChipInput
                value={draftTags}
                onChange={(next) => {
                  setDraftTags(next);
                  const before = [...(entry.tags ?? [])].sort().join(',');
                  const after = [...next].sort().join(',');
                  if (before === after) return;
                  void onPatch({ tags: next.length > 0 ? next : null });
                }}
                placeholder="sleep, apob, longevity…"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-[10px] uppercase tracking-wider text-surface-600 font-semibold flex items-center gap-1 mb-1">
                <Users className="w-3 h-3" /> Applies to
              </label>
              <PeoplePicker
                people={people}
                value={draftPersonIds}
                onChange={(next) => {
                  setDraftPersonIds(next);
                  const before = [...(entry.linkedPersonIds ?? [])].sort().join(',');
                  const after = [...next].sort().join(',');
                  if (before === after) return;
                  void onPatch({ linkedPersonIds: next.length > 0 ? next : null });
                }}
              />
            </div>
          </div>

          {/* Media player — uploaded video/audio streams + scrubs inline. */}
          {media && (
            <div>
              {entry.mediaType.startsWith('video/') ? (
                <video
                  controls
                  preload="metadata"
                  src={`/api/research/${entry.id}/file`}
                  className="w-full max-h-80 rounded-lg border border-border/40 bg-black"
                />
              ) : (
                <audio
                  controls
                  preload="metadata"
                  src={`/api/research/${entry.id}/file`}
                  className="w-full"
                />
              )}
            </div>
          )}

          <div>
            <label className="text-[10px] uppercase tracking-wider text-surface-600 font-semibold">
              Your notes
            </label>
            <Textarea
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              onBlur={() => flush('notes')}
              className="text-[12px] min-h-20"
              placeholder="Takeaways, action items, quotes to revisit…"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] uppercase tracking-wider text-surface-600 font-semibold">
                {entry.mediaType === 'application/pdf'
                  ? 'Extracted text'
                  : media
                    ? 'Transcript'
                    : 'Content'}
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
              {media && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={handleReTranscribe}
                  disabled={reTranscribing || transcribing}
                  title="Re-run transcription"
                >
                  <RefreshCw
                    className={`w-3 h-3 ${reTranscribing || transcribing ? 'animate-spin' : ''}`}
                  />
                  Re-transcribe
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
            ) : transcribing ? (
              <div className="text-[11px] text-surface-600 italic flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" />
                Transcribing… long videos can take a few minutes.
              </div>
            ) : (
              <div className="text-[11px] text-surface-600 italic">
                {media ? 'No transcript yet.' : 'No text extracted yet.'}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" asChild>
                <a
                  href={`/api/research/${entry.id}/file`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  {entry.mediaType === 'application/pdf'
                    ? 'Open PDF'
                    : media
                      ? 'Open media'
                      : 'Open raw text'}
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
