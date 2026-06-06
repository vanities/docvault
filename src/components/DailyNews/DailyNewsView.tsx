// Daily News view — a synthesized newspaper built from everything that changed
// across DocVault. Editions are generated on a schedule (Settings → Jobs), but
// you can also generate one on demand here. Generation is async (1-4 min); the
// view starts it, polls to completion, and renders the edition — past editions
// live in the left rail. Mirrors the Deep Research view.

import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CalendarDays, Download, ExternalLink, Loader2, Newspaper, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '../../hooks/useToast';
import { API_BASE } from '../../constants';

type EditionType = 'daily' | 'weekly';

interface EditionSummary {
  id: string;
  editionType: EditionType;
  editionDate: string;
  status: 'running' | 'done' | 'error';
  title?: string;
  /** House style (themes id) — set on sampler editions and recent normal ones. */
  theme?: string;
  /** True for theme-sampler editions. */
  sample?: boolean;
  itemCount: number;
  error?: string;
  createdAt: string;
  completedAt?: string;
}
interface WeatherDay {
  date: string;
  hi: number;
  lo: number;
  emoji: string;
  label: string;
  precipPct: number;
}
interface WeatherForecast {
  label: string;
  units: 'F' | 'C';
  days: WeatherDay[];
}
interface Edition extends EditionSummary {
  body?: string;
  digestMeta?: { sources: string[]; sinceISO: string; itemCount: number };
  usage?: { inputTokens: number; outputTokens: number };
  imagePath?: string;
  weather?: WeatherForecast;
}

/** Compact week-ahead weather strip shown above the edition body. */
function WeatherStrip({ w }: { w: WeatherForecast }) {
  if (!w.days?.length) return null;
  return (
    <div className="mb-4 flex gap-2 overflow-x-auto border-y border-border/40 py-2.5">
      <span className="self-center text-[10px] font-semibold uppercase tracking-wider text-surface-500 whitespace-nowrap pr-1">
        {w.label} · °{w.units}
      </span>
      {w.days.map((d) => {
        const day = new Date(`${d.date}T12:00:00`).toLocaleDateString('en-US', {
          weekday: 'short',
        });
        return (
          <div key={d.date} className="flex-shrink-0 min-w-[58px] text-center">
            <div className="text-[10px] font-semibold uppercase text-surface-500">{day}</div>
            <div className="text-lg leading-tight">{d.emoji}</div>
            <div className="text-[12px] text-surface-800 whitespace-nowrap">
              {d.hi}°<span className="text-surface-500"> {d.lo}°</span>
            </div>
            {d.precipPct >= 20 && <div className="text-[10px] text-accent-400">{d.precipPct}%</div>}
          </div>
        );
      })}
    </div>
  );
}

const MD_COMPONENTS = {
  h1: (p: object) => <h1 className="text-2xl font-bold mt-6 mb-3" {...p} />,
  h2: (p: object) => (
    <h2 className="text-xl font-semibold mt-6 mb-2 pt-2 border-t border-border/40" {...p} />
  ),
  h3: (p: object) => <h3 className="text-lg font-semibold mt-4 mb-2" {...p} />,
  p: (p: object) => <p className="my-2" {...p} />,
  ul: (p: object) => <ul className="list-disc ml-5 my-2" {...p} />,
  ol: (p: object) => <ol className="list-decimal ml-5 my-2" {...p} />,
  a: (p: object) => (
    <a
      className="text-accent-400 hover:underline"
      target="_blank"
      rel="noopener noreferrer"
      {...p}
    />
  ),
  table: (p: object) => <table className="my-3 text-[13px] border-collapse w-full" {...p} />,
  th: (p: object) => (
    <th className="text-left border-b border-border/50 px-2 py-1 font-semibold" {...p} />
  ),
  td: (p: object) => <td className="border-b border-border/30 px-2 py-1" {...p} />,
  blockquote: (p: object) => (
    <blockquote className="border-l-2 border-border/50 pl-3 my-2 text-surface-700" {...p} />
  ),
};

/** Local-timezone date for the running placeholder (matches the server's key). */
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

function editionLabel(e: { title?: string; editionType: EditionType }): string {
  return e.title || (e.editionType === 'weekly' ? 'Weekly deep-dive' : 'Daily edition');
}

export function DailyNewsView() {
  const { addToast } = useToast();
  const [history, setHistory] = useState<EditionSummary[]>([]);
  const [active, setActive] = useState<Edition | null>(null);
  const [starting, setStarting] = useState(false);
  const [themeLabels, setThemeLabels] = useState<Record<string, string>>({});
  const pollRef = useRef<number | null>(null);
  const viewingRef = useRef<string | null>(null); // which edition the user is looking at

  const loadHistory = async (): Promise<EditionSummary[]> => {
    try {
      const res = await fetch(`${API_BASE}/daily-news`);
      const data = await res.json();
      const eds: EditionSummary[] = data.editions ?? [];
      setHistory(eds);
      return eds;
    } catch {
      return [];
    }
  };

  useEffect(() => {
    // Open straight to the most recent edition (newest done, else newest).
    void (async () => {
      const eds = await loadHistory();
      const recent = eds.find((e) => e.status === 'done') ?? eds[0];
      if (recent) void loadEdition(recent.id);
    })();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme id → label, to name an edition's house style in the rail + header.
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/daily-news/themes`);
        const data = await res.json();
        const map: Record<string, string> = {};
        for (const t of (data.themes ?? []) as Array<{ id: string; label: string }>)
          map[t.id] = t.label;
        setThemeLabels(map);
      } catch {
        /* labels are cosmetic — ignore */
      }
    })();
  }, []);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const poll = (id: string) => {
    stopPolling();
    pollRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/daily-news/${id}`);
        const edition: Edition = await res.json();
        if (edition.status !== 'running') {
          stopPolling();
          void loadHistory();
          if (viewingRef.current === id) setActive(edition);
          if (edition.status === 'error')
            addToast(`Edition failed: ${edition.error ?? ''}`, 'error');
        }
      } catch {
        /* keep polling */
      }
    }, 5000);
  };

  const loadEdition = async (id: string) => {
    viewingRef.current = id;
    try {
      const res = await fetch(`${API_BASE}/daily-news/${id}`);
      const edition: Edition = await res.json();
      setActive(edition);
      if (edition.status === 'running') poll(id);
    } catch {
      addToast('Failed to load edition', 'error');
    }
  };

  const start = async (editionType: EditionType) => {
    if (starting) return;
    setStarting(true);
    try {
      const res = await fetch(`${API_BASE}/daily-news/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ editionType }),
      });
      const data = await res.json();
      if (!data.id) throw new Error('no id');
      viewingRef.current = data.id;
      setActive({
        id: data.id,
        editionType,
        editionDate: localToday(),
        status: 'running',
        itemCount: 0,
        createdAt: new Date().toISOString(),
      });
      void loadHistory();
      poll(data.id);
    } catch {
      addToast('Failed to start edition', 'error');
    } finally {
      setStarting(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await fetch(`${API_BASE}/daily-news/${id}`, { method: 'DELETE' });
      if (active?.id === id) {
        setActive(null);
        viewingRef.current = null;
      }
      void loadHistory();
    } catch {
      addToast('Failed to delete', 'error');
    }
  };

  const downloadEdition = (id: string) => {
    const a = document.createElement('a');
    a.href = `${API_BASE}/daily-news/${id}/edition.html`;
    a.download = '';
    a.click();
  };

  const openNewspaper = (id: string) => {
    window.open(`${API_BASE}/daily-news/${id}/edition.html`, '_blank', 'noopener');
  };

  const newEdition = () => {
    stopPolling();
    setActive(null);
    viewingRef.current = null;
  };

  return (
    <div className="flex flex-col md:flex-row h-full min-h-0">
      {/* History rail — full-width scrollable strip on mobile, side rail on desktop */}
      <aside className="w-full md:w-64 flex-shrink-0 max-h-44 md:max-h-none border-b md:border-b-0 md:border-r border-border/40 flex flex-col min-h-0">
        <div className="p-3 border-b border-border/40">
          <Button size="sm" onClick={newEdition} className="w-full">
            <Newspaper className="w-4 h-4" /> New edition
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {history.length === 0 ? (
            <p className="text-[12px] text-surface-500 px-2 py-4 text-center">No editions yet.</p>
          ) : (
            history.map((h) => (
              <button
                key={h.id}
                onClick={() => void loadEdition(h.id)}
                className={`w-full text-left px-2 py-2 rounded-md transition-colors ${
                  active?.id === h.id
                    ? 'bg-amber-500/10 text-amber-300'
                    : 'text-surface-700 hover:bg-surface-200/40'
                }`}
              >
                <div className="flex items-center gap-1.5 text-[12px]">
                  {h.status === 'running' && (
                    <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />
                  )}
                  {h.status === 'error' && <span className="text-rose-400 flex-shrink-0">!</span>}
                  <span className="truncate flex-1">
                    {h.sample
                      ? (themeLabels[h.theme ?? ''] ?? h.theme ?? 'Sample')
                      : editionLabel(h)}
                  </span>
                  {h.sample ? (
                    <span className="text-[9px] uppercase tracking-wide text-violet-400 flex-shrink-0">
                      sample
                    </span>
                  ) : h.editionType === 'weekly' ? (
                    <span className="text-[9px] uppercase tracking-wide text-amber-400 flex-shrink-0">
                      wk
                    </span>
                  ) : null}
                </div>
                <div className="text-[10px] text-surface-500 mt-0.5">
                  {h.editionDate}
                  {h.status === 'done' ? ` · ${h.itemCount} items` : ''}
                </div>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden min-h-0">
        {!active ? (
          <div className="max-w-2xl mx-auto px-8 py-10">
            <h2 className="text-xl font-semibold text-surface-950 mb-1 flex items-center gap-2">
              <Newspaper className="w-5 h-5" />
              Daily News
            </h2>
            <p className="text-[13px] text-surface-600 mb-4">
              A personal newspaper synthesized from everything that changed across DocVault —
              markets, politics, your finances, health, and recent documents. Editions publish
              automatically on a schedule (configure it in Settings → Jobs) and can be emailed to
              you. Generate one now:
            </p>
            <div className="flex items-center gap-2">
              <Button onClick={() => void start('daily')} disabled={starting}>
                <Newspaper className="w-4 h-4" />
                {starting ? 'Starting…' : "Generate today's edition"}
              </Button>
              <Button variant="ghost" onClick={() => void start('weekly')} disabled={starting}>
                <CalendarDays className="w-4 h-4" /> Weekly deep-dive
              </Button>
            </div>
            <p className="text-[11px] text-surface-500 mt-2">
              Synthesizes your data through the configured model · takes a minute or two · no web
              search
            </p>
          </div>
        ) : active.status === 'running' ? (
          <div className="flex flex-col items-center justify-center h-full text-surface-600 gap-3 px-6 text-center">
            <Loader2 className="w-7 h-7 animate-spin text-amber-400" />
            <p className="text-[14px] font-medium text-surface-800">Composing the edition…</p>
            <p className="text-[12px] text-surface-500 max-w-md">
              Gathering what changed and writing it up — this takes a minute or two. You can leave
              this view and come back; it keeps going.
            </p>
          </div>
        ) : active.status === 'error' ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 px-6 text-center">
            <p className="text-[14px] text-rose-400">Edition failed</p>
            <p className="text-[12px] text-surface-500 max-w-md">{active.error}</p>
          </div>
        ) : (
          <article className="max-w-3xl mx-auto px-8 py-6">
            {active.imagePath && (
              <img
                src={`${API_BASE}/daily-news/${active.id}/image.png`}
                alt=""
                className="w-full max-h-72 object-cover rounded-lg mb-4"
              />
            )}
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="text-[12px] text-surface-500">
                <span className="uppercase tracking-wide text-amber-400 font-semibold">
                  {active.editionType === 'weekly' ? 'Weekly deep-dive' : 'Daily edition'}
                </span>{' '}
                · {active.editionDate}
                {active.theme ? ` · ${themeLabels[active.theme] ?? active.theme}` : ''}
                {active.sample ? ' · sample' : ''}
                {active.digestMeta ? ` · ${active.digestMeta.itemCount} items` : ''}
                {active.usage && active.usage.inputTokens + active.usage.outputTokens > 0
                  ? ` · ${active.usage.inputTokens.toLocaleString()} in / ${active.usage.outputTokens.toLocaleString()} out`
                  : ''}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <Button variant="ghost" size="xs" onClick={() => openNewspaper(active.id)}>
                  <ExternalLink className="w-3.5 h-3.5" /> Newspaper
                </Button>
                <Button variant="ghost" size="xs" onClick={() => downloadEdition(active.id)}>
                  <Download className="w-3.5 h-3.5" /> HTML
                </Button>
                <Button
                  variant="ghost-danger"
                  size="icon-xs"
                  onClick={() => void remove(active.id)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
            {active.weather && <WeatherStrip w={active.weather} />}
            <div className="text-[14px] leading-relaxed text-surface-900">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
                {active.body ?? ''}
              </ReactMarkdown>
            </div>
          </article>
        )}
      </main>
    </div>
  );
}
