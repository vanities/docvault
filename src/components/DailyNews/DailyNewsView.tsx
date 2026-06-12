// Daily News view — a synthesized newspaper built from everything that changed
// across DocVault. Editions are generated on a schedule (Settings → Jobs), but
// you can also generate one on demand here. Generation is async (1-4 min); the
// view starts it, polls to completion, and renders the edition — past editions
// live in the left rail. Mirrors the Deep Research view.

import { useEffect, useRef, useState } from 'react';
import {
  CalendarDays,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Mail,
  Newspaper,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '../../hooks/useToast';
import { API_BASE } from '../../constants';
import { requestJson } from '../../api/client';
import { SafeMarkdown } from '../common/SafeMarkdown';

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
interface SourceWarning {
  source: string;
  message: string;
}
interface Edition extends EditionSummary {
  body?: string;
  digestMeta?: {
    sources: string[];
    sinceISO: string;
    itemCount: number;
    pulled?: Array<{ source: string; title: string; url?: string }>;
    sourceWarnings?: SourceWarning[];
  };
  usage?: { inputTokens: number; outputTokens: number };
  imagePath?: string;
  audioPath?: string;
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

/** "2026-06-07" → "Sunday, Jun 7". The noon-local parse dodges the UTC
 *  off-by-one that makes `new Date('2026-06-07')` render as the previous day in
 *  US timezones. Mirrors the server's formatEditionDate (which the masthead uses). */
function formatEditionDay(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

// The rail label is the edition's TYPE, not its title — `title` holds the static
// masthead/paper name ("The DocVault Dispatch"), which is identical across every
// edition and so makes a useless list label. The date + item count sit on the
// row's second line.
function editionLabel(e: { editionType: EditionType }): string {
  return e.editionType === 'weekly' ? 'Weekly deep-dive' : 'Daily edition';
}

export function DailyNewsView() {
  const { addToast } = useToast();
  const [history, setHistory] = useState<EditionSummary[]>([]);
  const [active, setActive] = useState<Edition | null>(null);
  const [starting, setStarting] = useState(false);
  const [emailing, setEmailing] = useState(false);
  // Reader (in-app markdown) vs. Paper (the themed newspaper HTML in an iframe).
  const [paperMode, setPaperMode] = useState(false);
  const [themeLabels, setThemeLabels] = useState<Record<string, string>>({});
  const pollRef = useRef<number | null>(null);
  const viewingRef = useRef<string | null>(null); // which edition the user is looking at

  const loadHistory = async (): Promise<EditionSummary[]> => {
    try {
      const data = await requestJson<{ editions?: EditionSummary[] }>(`${API_BASE}/daily-news`);
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

  // Player default speed from Settings → Models → Newsstand → Narration.
  const [narrationSpeed, setNarrationSpeed] = useState(1);
  useEffect(() => {
    void (async () => {
      try {
        const d = await requestJson<{ dailyNews?: { narration?: { defaultSpeed?: number } } }>(
          `${API_BASE}/settings`
        );
        const s = d.dailyNews?.narration?.defaultSpeed;
        if (typeof s === 'number' && s > 0) setNarrationSpeed(s);
      } catch {
        /* default 1× */
      }
    })();
  }, []);

  // Theme id → label, to name an edition's house style in the rail + header.
  useEffect(() => {
    void (async () => {
      try {
        const data = await requestJson<{ themes?: Array<{ id: string; label: string }> }>(
          `${API_BASE}/daily-news/themes`
        );
        const map: Record<string, string> = {};
        for (const t of data.themes ?? []) map[t.id] = t.label;
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
        const edition = await requestJson<Edition>(`${API_BASE}/daily-news/${id}`);
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

  // Email a finished edition on demand. Generating an edition no longer
  // auto-sends it (only scheduled editions do) — this is the explicit send.
  const emailEdition = async (id: string) => {
    if (emailing) return;
    setEmailing(true);
    try {
      const res = await fetch(`${API_BASE}/daily-news/${id}/email`, { method: 'POST' });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) addToast('Edition emailed', 'success');
      else addToast(data.error || 'Failed to email edition', 'error');
    } catch {
      addToast('Failed to email edition', 'error');
    } finally {
      setEmailing(false);
    }
  };

  const openNewspaper = (id: string) => {
    // inline=1 → renders in the tab; without it the attachment header downloads.
    window.open(`${API_BASE}/daily-news/${id}/edition.html?inline=1`, '_blank', 'noopener');
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
                  ) : null}
                </div>
                <div className="text-[10px] text-surface-500 mt-0.5">
                  {formatEditionDay(h.editionDate)}
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
              Newsstand
            </h2>
            <p className="text-[13px] text-surface-600 mb-4">
              Your personal newspaper — daily editions and weekly deep-dives synthesized from
              everything that changed across DocVault: markets, politics, your finances, health, and
              recent documents. Scheduled editions (Settings → Jobs) are emailed to you
              automatically; editions you generate here aren't sent until you hit{' '}
              <span className="font-medium">Email</span> on them. Generate one now:
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
          <div className="flex flex-col h-full min-h-0">
            {/* Toolbar — always visible, above either the reader or the paper view.
                Stacks vertically on mobile so the metadata line gets full width
                instead of being squeezed into a narrow column by the buttons. */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4 px-4 md:px-8 py-3 border-b border-border/40 flex-shrink-0">
              <div className="text-[12px] text-surface-500 min-w-0">
                <span className="uppercase tracking-wide text-amber-400 font-semibold">
                  {active.editionType === 'weekly' ? 'Weekly deep-dive' : 'Daily edition'}
                </span>{' '}
                · {formatEditionDay(active.editionDate)}
                {active.theme ? ` · ${themeLabels[active.theme] ?? active.theme}` : ''}
                {active.sample ? ' · sample' : ''}
                {active.digestMeta ? ` · ${active.digestMeta.itemCount} items` : ''}
                {active.usage && active.usage.inputTokens + active.usage.outputTokens > 0
                  ? ` · ${active.usage.inputTokens.toLocaleString()} in / ${active.usage.outputTokens.toLocaleString()} out`
                  : ''}
              </div>
              <div className="flex items-center flex-wrap gap-1 flex-shrink-0">
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setPaperMode((m) => !m)}
                  title={
                    paperMode
                      ? 'Switch to the plain reader view'
                      : 'Switch to the themed newspaper layout'
                  }
                >
                  {paperMode ? (
                    <>
                      <FileText className="w-3.5 h-3.5" /> Reader
                    </>
                  ) : (
                    <>
                      <Newspaper className="w-3.5 h-3.5" /> Newspaper
                    </>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => openNewspaper(active.id)}
                  title="Open the newspaper in a new tab"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="xs" onClick={() => downloadEdition(active.id)}>
                  <Download className="w-3.5 h-3.5" /> HTML
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => void emailEdition(active.id)}
                  disabled={emailing}
                  title="Email this edition to the addresses in Settings → Email"
                >
                  <Mail className="w-3.5 h-3.5" /> {emailing ? 'Sending…' : 'Email'}
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

            {active.digestMeta?.sourceWarnings?.length ? (
              <div className="mx-4 md:mx-8 mt-3 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-900 dark:text-amber-100 flex-shrink-0">
                <div className="font-semibold uppercase tracking-wide text-[10px] text-amber-600 dark:text-amber-300 mb-1">
                  Source notes
                </div>
                <ul className="space-y-0.5">
                  {active.digestMeta.sourceWarnings.map((w) => (
                    <li key={`${w.source}-${w.message}`}>
                      <span className="font-medium">{w.source}</span>: {w.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {/* Body — the themed newspaper (iframe) or the in-app reader */}
            {paperMode ? (
              <iframe
                title="Newspaper edition"
                sandbox="allow-popups"
                src={`${API_BASE}/daily-news/${active.id}/edition.html?inline=1`}
                className="flex-1 w-full min-h-0 border-0 bg-white"
              />
            ) : (
              <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
                <article className="max-w-3xl mx-auto px-6 md:px-8 py-6">
                  {active.imagePath && (
                    <img
                      src={`${API_BASE}/daily-news/${active.id}/image.png`}
                      alt=""
                      className="w-full max-h-72 object-cover rounded-lg mb-4"
                    />
                  )}
                  {/* Narrated edition — native controls include playback speed;
                      the settings default is applied once metadata loads. */}
                  {active.audioPath && (
                    <audio
                      controls
                      preload="metadata"
                      src={`${API_BASE}/daily-news/${active.id}/audio`}
                      className="w-full mb-4"
                      onLoadedMetadata={(e) => {
                        e.currentTarget.playbackRate = narrationSpeed;
                      }}
                    />
                  )}
                  {active.weather && <WeatherStrip w={active.weather} />}
                  <SafeMarkdown
                    className="text-[14px] leading-relaxed text-surface-900"
                    components={MD_COMPONENTS}
                  >
                    {active.body ?? ''}
                  </SafeMarkdown>
                  {/* Source notes — same ledger the newspaper HTML + email render. */}
                  {(active.digestMeta?.pulled?.length ?? 0) > 0 && (
                    <details className="mt-6 border-t border-border/40 pt-4">
                      <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-surface-500 hover:text-surface-700">
                        Sources pulled into this edition ({active.digestMeta?.pulled?.length})
                      </summary>
                      {(active.digestMeta?.sourceWarnings?.length ?? 0) > 0 && (
                        <p className="mt-3 text-[12px] text-amber-500/90">
                          Some sources could not be read while this edition was composed:{' '}
                          {active.digestMeta?.sourceWarnings
                            ?.map((w) => `${w.source} (${w.message})`)
                            .join('; ')}
                        </p>
                      )}
                      <ul className="mt-3 space-y-1.5 text-[13px] text-surface-700">
                        {active.digestMeta?.pulled?.map((p, i) => (
                          <li key={`${p.source}-${i}`} className="leading-snug">
                            <span className="text-surface-500">{p.source}</span>
                            {' — '}
                            {p.url ? (
                              <a
                                href={p.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-accent-400 hover:underline"
                              >
                                {p.title}
                              </a>
                            ) : (
                              p.title
                            )}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </article>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
