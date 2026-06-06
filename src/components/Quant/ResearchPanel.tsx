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
  Brain,
  X,
  Youtube,
} from 'lucide-react';
import { Line, LineChart, ResponsiveContainer } from 'recharts';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useTopN } from '@/hooks/useTopN';
import { ShowMore } from '@/components/ui/ShowMore';

type ResearchPanelDomain = 'finance' | 'politics';

interface ResearchEntry {
  id: string;
  domain: ResearchPanelDomain;
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
  tickers?: string[];
  intelligence?: ResearchIntelligence;
  lastUpdated: string;
}

interface ResearchTextProvenance {
  entryId: string;
  title?: string;
  sourceUrl?: string;
  publisher?: string;
  reportDate?: string;
  mediaType: ResearchEntry['mediaType'];
  lineStart: number;
  lineEnd: number;
  charStart: number;
  charEnd: number;
  quote: string;
}

interface ResearchSummaryBullet {
  text: string;
  provenance: ResearchTextProvenance;
}

interface ResearchClaim {
  id: string;
  text: string;
  tickers: string[];
  topics: string[];
  stance: 'bullish' | 'bearish' | 'risk' | 'neutral';
  provenance: ResearchTextProvenance;
}

interface ResearchIntelligence {
  version: number;
  summary: ResearchSummaryBullet[];
  claims: ResearchClaim[];
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
  tickers: string[] | null;
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
  return {
    text: '',
    title: '',
    author: '',
    publisher: '',
    sourceUrl: '',
    reportDate: '',
    tickers: [] as string[],
  };
}

function blankYoutubeDraft() {
  return { url: '', tickers: [] as string[] };
}

// ---------------------------------------------------------------------------
// Ticker types + components
// ---------------------------------------------------------------------------

/** Field shape returned by GET /api/quant/tickers/prices — must match
 *  server/ticker-prices.ts:TickerQuote. */
interface TickerQuote {
  symbol: string;
  price: number | null;
  currency: string | null;
  oneYearChangePct: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  sparklineCloses: number[] | null;
  name: string | null;
  fetchedAt: string;
  error: string | null;
}

/** Yahoo-style symbol charset — mirrors normalizeTicker() server-side. */
const TICKER_CHAR_RE = /^[A-Z0-9.\-=^]{1,16}$/;

/**
 * Chip-style multi-input for tickers. Comma / space / Enter / Tab commits the
 * current draft into a chip; Backspace on an empty draft removes the last
 * chip. The input itself uppercases as you type. Invalid symbols are silently
 * dropped at commit time rather than rejected with an error — paste-then-see
 * is friendlier than type-then-bonk.
 */
function TickerChipInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  className?: string;
}) {
  const [draftText, setDraftText] = useState('');

  const commitDraft = (raw: string) => {
    const next = new Set(value);
    let changed = false;
    for (const candidate of raw.split(/[,\s]+/)) {
      const sym = candidate.trim().toUpperCase();
      if (!sym || !TICKER_CHAR_RE.test(sym)) continue;
      if (!next.has(sym)) {
        next.add(sym);
        changed = true;
      }
    }
    if (changed) onChange([...next]);
    setDraftText('');
  };

  const removeTicker = (sym: string) => onChange(value.filter((t) => t !== sym));

  return (
    <div
      className={`flex flex-wrap items-center gap-1 px-2 py-1 rounded-md border border-surface-500 bg-transparent min-h-8 focus-within:border-accent-400 transition-colors ${className ?? ''}`}
    >
      {value.map((sym) => (
        <span
          key={sym}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-200/50 text-[11px] font-mono text-surface-950"
        >
          {sym}
          <button
            type="button"
            onClick={() => removeTicker(sym)}
            className="text-surface-600 hover:text-rose-400 transition-colors"
            aria-label={`Remove ${sym}`}
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
      <input
        type="text"
        value={draftText}
        onChange={(e) => setDraftText(e.target.value.toUpperCase())}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',' || e.key === ' ' || e.key === 'Tab') {
            if (draftText.trim()) {
              e.preventDefault();
              commitDraft(draftText);
            }
          } else if (e.key === 'Backspace' && draftText === '' && value.length > 0) {
            removeTicker(value[value.length - 1]);
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

/** A single ticker's price card — symbol, name, sparkline, price, 1y %. */
function TickerPriceCard({ quote }: { quote: TickerQuote }) {
  const isUp = quote.oneYearChangePct !== null && quote.oneYearChangePct >= 0;
  const sparklineData = (quote.sparklineCloses ?? []).map((c, i) => ({ i, c }));
  const sparklineColor = isUp ? '#10b981' : '#f43f5e';
  const showCurrency = quote.currency && quote.currency !== 'USD';

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-surface-100/30 border border-border/30 hover:border-border/60 transition-colors">
      <div className="flex flex-col min-w-0">
        <span className="text-[11px] font-mono font-semibold text-surface-950">{quote.symbol}</span>
        {quote.name && (
          <span className="text-[10px] text-surface-700 truncate max-w-[140px]" title={quote.name}>
            {quote.name}
          </span>
        )}
      </div>
      {sparklineData.length > 1 && (
        <div className="w-16 h-8 flex-shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sparklineData}>
              <Line
                type="monotone"
                dataKey="c"
                stroke={sparklineColor}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="flex flex-col items-end ml-auto">
        {quote.error ? (
          <span className="text-[10px] text-rose-400" title={quote.error}>
            error
          </span>
        ) : (
          <>
            <span className="text-[11px] font-mono text-surface-950">
              {quote.price !== null ? quote.price.toFixed(2) : '?'}
              {showCurrency && (
                <span className="text-[9px] text-surface-600 ml-1">{quote.currency}</span>
              )}
            </span>
            <span
              className={`text-[10px] font-mono ${isUp ? 'text-emerald-400' : 'text-rose-400'}`}
            >
              {quote.oneYearChangePct !== null
                ? (isUp ? '+' : '') + quote.oneYearChangePct.toFixed(0) + '%'
                : '?'}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Fetches /api/quant/tickers/prices for a set of tickers and renders one
 * card per ticker. Server-side cache (15 min) makes repeated mounts cheap.
 * Renders nothing when the input is empty.
 */
function TickerPriceStrip({ tickers }: { tickers: string[] }) {
  const [quotes, setQuotes] = useState<TickerQuote[]>([]);
  const [loading, setLoading] = useState(false);
  // Stable string-identity for the effect dep — avoids refetching on parent
  // renders that hand us a new-but-equivalent array reference.
  const symbols = tickers.join(',');

  useEffect(() => {
    if (!symbols) {
      setQuotes([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/quant/tickers/prices?symbols=${encodeURIComponent(symbols)}`)
      .then((r) => r.json() as Promise<{ quotes: TickerQuote[] }>)
      .then((d) => {
        if (!cancelled) setQuotes(d.quotes ?? []);
      })
      .catch(() => {
        /* per-quote .error carries per-symbol failures */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [symbols]);

  if (tickers.length === 0) return null;
  if (loading && quotes.length === 0) {
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-surface-600 py-2">
        <Loader2 className="w-3 h-3 animate-spin" />
        Loading prices…
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
      {quotes.map((q) => (
        <TickerPriceCard key={q.symbol} quote={q} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ResearchPanel — main view
// ---------------------------------------------------------------------------

export function ResearchPanel({
  domain = 'finance',
  title = 'Research',
  description = 'Upload PDFs, paste transcripts/articles, or fetch YouTube captions into the research store.',
  pdfHint = 'Research PDFs from Cowen, Lyn Alden, Fidelity, Raoul Pal, etc. Text is extracted automatically — no AI parsing.',
}: {
  domain?: ResearchPanelDomain;
  title?: string;
  description?: string;
  pdfHint?: string;
}) {
  const [entries, setEntries] = useState<ResearchEntry[]>([]);
  const list = useTopN(entries, 10);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Ingest mode: PDF drop, raw text paste, or fetch from a YouTube URL.
  const [mode, setMode] = useState<'pdf' | 'text' | 'youtube'>('pdf');
  const [textDraft, setTextDraft] = useState(blankTextDraft);
  const [savingText, setSavingText] = useState(false);
  const [textError, setTextError] = useState<string | null>(null);
  const [youtubeDraft, setYoutubeDraft] = useState(blankYoutubeDraft);
  const [savingYoutube, setSavingYoutube] = useState(false);
  const [youtubeError, setYoutubeError] = useState<string | null>(null);

  // Initial load — filter to this panel's domain so finance/politics entries
  // do not bleed into each other.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/research?domain=${domain}`);
      const data = (await res.json()) as { entries: ResearchEntry[] };
      setEntries(data.entries ?? []);
    } finally {
      setLoading(false);
    }
  }, [domain]);

  useEffect(() => {
    void load();
  }, [load]);

  // ---- Upload ----

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
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
            `/api/research/upload?filename=${encodeURIComponent(file.name)}&domain=${domain}`,
            { method: 'POST', body }
          );
          if (!res.ok) {
            const err = (await res.json().catch(() => ({}))) as { error?: string };
            setUploadError(err.error ?? `Upload failed (${res.status}) for ${file.name}`);
          }
        }
        await fetch(`/api/research?domain=${domain}`)
          .then((r) => r.json())
          .then((d: { entries: ResearchEntry[] }) => setEntries(d.entries ?? []));
      } finally {
        setUploading(false);
      }
    },
    [domain]
  );

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
          domain,
          text: textDraft.text,
          title: textDraft.title.trim() || undefined,
          author: textDraft.author.trim() || undefined,
          publisher: textDraft.publisher.trim() || undefined,
          sourceUrl: textDraft.sourceUrl.trim() || undefined,
          reportDate: textDraft.reportDate.trim() || undefined,
          tickers: textDraft.tickers.length > 0 ? textDraft.tickers : undefined,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setTextError(err.error ?? `Save failed (${res.status})`);
        return;
      }
      setTextDraft(blankTextDraft());
      // Refresh inline (no loading flash) — mirrors the PDF upload path.
      await fetch(`/api/research?domain=${domain}`)
        .then((r) => r.json())
        .then((d: { entries: ResearchEntry[] }) => setEntries(d.entries ?? []));
    } finally {
      setSavingText(false);
    }
  }, [domain, textDraft]);

  // Save by URL via the yt-dlp-backed /api/research/youtube endpoint.
  const submitYoutube = useCallback(async () => {
    if (!youtubeDraft.url.trim()) return;
    setYoutubeError(null);
    setSavingYoutube(true);
    try {
      const res = await fetch('/api/research/youtube', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain,
          url: youtubeDraft.url.trim(),
          tickers: youtubeDraft.tickers.length > 0 ? youtubeDraft.tickers : undefined,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setYoutubeError(err.error ?? `Fetch failed (${res.status})`);
        return;
      }
      setYoutubeDraft(blankYoutubeDraft());
      // Refresh inline (no loading flash) — mirrors the other ingest paths.
      await fetch(`/api/research?domain=${domain}`)
        .then((r) => r.json())
        .then((d: { entries: ResearchEntry[] }) => setEntries(d.entries ?? []));
    } finally {
      setSavingYoutube(false);
    }
  }, [domain, youtubeDraft]);

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

  const buildIntelligence = async (id: string) => {
    const res = await fetch(`/api/research/${id}/intelligence`, { method: 'POST' });
    if (res.ok) {
      const data = (await res.json()) as { entry: ResearchEntry };
      setEntries((prev) => prev.map((e) => (e.id === id ? data.entry : e)));
    }
  };

  // ---- Render ----

  return (
    <div>
      <div className="mb-4">
        <h2 className="font-display text-xl text-surface-950 italic">{title}</h2>
        <p className="text-sm text-surface-700 mt-1">{description}</p>
      </div>
      {/* Ingest card — toggle between uploading a PDF and pasting raw text. */}
      <Card variant="glass" className="mb-6">
        {/* Mode toggle */}
        <div className="flex gap-1 px-4 pt-4">
          {(['pdf', 'text', 'youtube'] as const).map((m) => {
            const active = mode === m;
            const Icon = m === 'pdf' ? Upload : m === 'text' ? AlignLeft : Youtube;
            const label = m === 'pdf' ? 'Upload PDF' : m === 'text' ? 'Paste text' : 'From YouTube';
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
                    <p className="text-[12px] text-surface-600">{pdfHint}</p>
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
            <TickerChipInput
              value={textDraft.tickers}
              onChange={(next) => setTextDraft({ ...textDraft, tickers: next })}
              placeholder="Tickers (e.g. NVDA, INTC, TSM, NK.PA)"
            />
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
        ) : (
          <div className="p-4 pt-3 space-y-3">
            <Input
              type="url"
              value={youtubeDraft.url}
              onChange={(e) => setYoutubeDraft({ ...youtubeDraft, url: e.target.value })}
              placeholder="YouTube URL (e.g. https://www.youtube.com/watch?v=…)"
              className="h-9 text-[12px]"
            />
            <TickerChipInput
              value={youtubeDraft.tickers}
              onChange={(next) => setYoutubeDraft({ ...youtubeDraft, tickers: next })}
              placeholder="Tickers to tag (optional)"
            />
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
          {list.visible.map((entry) => (
            <ResearchRow
              key={entry.id}
              entry={entry}
              expanded={expandedId === entry.id}
              onToggle={() => setExpandedId((prev) => (prev === entry.id ? null : entry.id))}
              onPatch={(body) => patchEntry(entry.id, body)}
              onDelete={() => deleteEntry(entry.id)}
              onReExtract={() => reExtract(entry.id)}
              onBuildIntelligence={() => buildIntelligence(entry.id)}
            />
          ))}
          <ShowMore
            expanded={list.expanded}
            hiddenCount={list.hiddenCount}
            onToggle={list.toggle}
            className="mt-1"
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row intelligence view — deterministic summary / claims with provenance
// ---------------------------------------------------------------------------

function formatProvenance(provenance: ResearchTextProvenance): string {
  const line =
    provenance.lineStart === provenance.lineEnd
      ? `line ${provenance.lineStart}`
      : `lines ${provenance.lineStart}-${provenance.lineEnd}`;
  return `${line}, chars ${provenance.charStart}-${provenance.charEnd}`;
}

function ResearchIntelligencePanel({ intelligence }: { intelligence?: ResearchIntelligence }) {
  if (!intelligence || (intelligence.summary.length === 0 && intelligence.claims.length === 0)) {
    return (
      <div className="p-3 rounded-lg border border-dashed border-border/50 bg-surface-100/20 text-[11px] text-surface-600">
        No extracted intelligence yet. Use “Extract intelligence” to create source-grounded summary
        bullets and claims from the stored text.
      </div>
    );
  }

  return (
    <div className="p-3 rounded-lg border border-border/40 bg-surface-100/25 space-y-3">
      <div className="flex items-center gap-2">
        <Brain className="w-3.5 h-3.5 text-accent-400" />
        <h4 className="text-[11px] uppercase tracking-wider text-surface-600 font-semibold">
          Extracted intelligence
        </h4>
        <span className="text-[10px] text-surface-500">v{intelligence.version}</span>
      </div>

      {intelligence.summary.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-surface-600 font-semibold mb-1">
            Summary
          </p>
          <ul className="space-y-1.5">
            {intelligence.summary.map((item, index) => (
              <li
                key={`${item.provenance.charStart}-${index}`}
                className="text-[12px] text-surface-800"
              >
                <span className="text-surface-500 mr-1">•</span>
                {item.text}
                <span className="ml-2 text-[10px] text-surface-500">
                  {formatProvenance(item.provenance)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {intelligence.claims.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-surface-600 font-semibold mb-1">
            Claims / signals
          </p>
          <div className="space-y-2">
            {intelligence.claims.map((claim) => (
              <div
                key={claim.id}
                className="rounded-md border border-border/30 bg-surface-200/20 p-2"
              >
                <div className="flex items-center gap-1.5 flex-wrap mb-1">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-200/50 text-surface-700 uppercase">
                    {claim.stance}
                  </span>
                  {claim.tickers.map((ticker) => (
                    <span key={ticker} className="text-[10px] font-mono text-accent-400">
                      {ticker}
                    </span>
                  ))}
                  {claim.topics.map((topic) => (
                    <span key={topic} className="text-[10px] text-surface-600">
                      #{topic}
                    </span>
                  ))}
                </div>
                <p className="text-[12px] text-surface-800 leading-relaxed">{claim.text}</p>
                <div className="mt-1 text-[10px] text-surface-500">
                  {formatProvenance(claim.provenance)} · quote: “{claim.provenance.quote}”
                  {claim.provenance.sourceUrl && (
                    <>
                      {' · '}
                      <a
                        href={claim.provenance.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent-400 hover:underline"
                      >
                        source
                      </a>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
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
  onBuildIntelligence,
}: {
  entry: ResearchEntry;
  expanded: boolean;
  onToggle: () => void;
  onPatch: (body: PatchBody) => Promise<void>;
  onDelete: () => void;
  onReExtract: () => Promise<void>;
  onBuildIntelligence: () => Promise<void>;
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
  // Tickers live separate from `draft` because they're string[]; the
  // flush-on-blur pattern (used for string fields) doesn't fit. We PATCH
  // immediately on every chip add/remove, debounced by an equality check.
  const [draftTickers, setDraftTickers] = useState<string[]>(entry.tickers ?? []);
  const [reExtracting, setReExtracting] = useState(false);
  const [buildingIntelligence, setBuildingIntelligence] = useState(false);

  useEffect(() => {
    setDraft({
      title: entry.title ?? '',
      author: entry.author ?? '',
      publisher: entry.publisher ?? '',
      reportDate: entry.reportDate ?? '',
      sourceUrl: entry.sourceUrl ?? '',
      notes: entry.notes ?? '',
    });
    setDraftTickers(entry.tickers ?? []);
  }, [
    entry.id,
    entry.lastUpdated,
    entry.title,
    entry.author,
    entry.publisher,
    entry.reportDate,
    entry.sourceUrl,
    entry.notes,
    entry.tickers?.join(',') ?? '',
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

  const handleBuildIntelligence = async () => {
    setBuildingIntelligence(true);
    try {
      await onBuildIntelligence();
    } finally {
      setBuildingIntelligence(false);
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
            <div className="sm:col-span-2">
              <label className="text-[10px] uppercase tracking-wider text-surface-600 font-semibold">
                Tickers
              </label>
              <TickerChipInput
                value={draftTickers}
                onChange={(next) => {
                  setDraftTickers(next);
                  // Sort-compare so re-ordering doesn't trigger a PATCH and
                  // the server only sees actual set-membership changes.
                  const before = [...(entry.tickers ?? [])].sort().join(',');
                  const after = [...next].sort().join(',');
                  if (before === after) return;
                  void onPatch({ tickers: next.length > 0 ? next : null });
                }}
                placeholder="NVDA, TSM, NK.PA…"
              />
            </div>
          </div>

          {/* Tagged ticker prices (renders nothing when no tickers) */}
          <TickerPriceStrip tickers={draftTickers} />

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

          {/* Deterministic source-grounded summary / claims */}
          <ResearchIntelligencePanel intelligence={entry.intelligence} />

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
              <div className="flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={handleBuildIntelligence}
                  disabled={buildingIntelligence || !entry.text}
                  title="Extract source-grounded summary and claims"
                >
                  <Brain className={`w-3 h-3 ${buildingIntelligence ? 'animate-pulse' : ''}`} />
                  {entry.intelligence ? 'Refresh intelligence' : 'Extract intelligence'}
                </Button>
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
