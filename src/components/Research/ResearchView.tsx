// Deep Research view — ask a question, DocVault runs a thorough web-research
// job (background), polls it to completion, and renders the cited report with
// a source list. Past runs live in the left rail to revisit. The run is async
// (1-4 min), so the view starts it, shows progress, and you can navigate away
// and come back — the job keeps going server-side.

import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Download, Loader2, Plus, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '../../hooks/useToast';
import { API_BASE } from '../../constants';

interface Source {
  url: string;
  title?: string;
}
interface RunSummary {
  id: string;
  question: string;
  status: 'running' | 'done' | 'error';
  sourceCount: number;
  searchCount?: number;
  usage?: { inputTokens: number; outputTokens: number };
  error?: string;
  createdAt: string;
  completedAt?: string;
}
interface Run extends RunSummary {
  report?: string;
  sources?: Source[];
}

const THOROUGH_SEARCHES = 18;

const MD_COMPONENTS = {
  h1: (p: object) => <h1 className="text-2xl font-bold mt-6 mb-3" {...p} />,
  h2: (p: object) => <h2 className="text-xl font-semibold mt-5 mb-2" {...p} />,
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

export function ResearchView() {
  const { addToast } = useToast();
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState<RunSummary[]>([]);
  const [active, setActive] = useState<Run | null>(null);
  const [starting, setStarting] = useState(false);
  const pollRef = useRef<number | null>(null);
  const viewingRef = useRef<string | null>(null); // which run the user is looking at

  const loadHistory = async () => {
    try {
      const res = await fetch(`${API_BASE}/deep-research`);
      const data = await res.json();
      setHistory(data.runs ?? []);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    void loadHistory();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
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
        const res = await fetch(`${API_BASE}/deep-research/${id}`);
        const run: Run = await res.json();
        if (run.status !== 'running') {
          stopPolling();
          void loadHistory();
          if (viewingRef.current === id) setActive(run); // don't clobber if user navigated away
          if (run.status === 'error') addToast(`Research failed: ${run.error ?? ''}`, 'error');
        }
      } catch {
        /* keep polling */
      }
    }, 5000);
  };

  const loadRun = async (id: string) => {
    viewingRef.current = id;
    try {
      const res = await fetch(`${API_BASE}/deep-research/${id}`);
      const run: Run = await res.json();
      setActive(run);
      if (run.status === 'running') poll(id);
    } catch {
      addToast('Failed to load run', 'error');
    }
  };

  const start = async () => {
    const q = question.trim();
    if (!q || starting) return;
    setStarting(true);
    try {
      const res = await fetch(`${API_BASE}/deep-research/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, maxSearches: THOROUGH_SEARCHES }),
      });
      const data = await res.json();
      if (!data.id) throw new Error('no id');
      viewingRef.current = data.id;
      setActive({
        id: data.id,
        question: q,
        status: 'running',
        sourceCount: 0,
        createdAt: new Date().toISOString(),
      });
      setQuestion('');
      void loadHistory();
      poll(data.id);
    } catch {
      addToast('Failed to start research', 'error');
    } finally {
      setStarting(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await fetch(`${API_BASE}/deep-research/${id}`, { method: 'DELETE' });
      if (active?.id === id) {
        setActive(null);
        viewingRef.current = null;
      }
      void loadHistory();
    } catch {
      addToast('Failed to delete', 'error');
    }
  };

  const downloadReport = (id: string) => {
    const a = document.createElement('a');
    a.href = `${API_BASE}/deep-research/${id}/report.html`;
    a.download = '';
    a.click();
  };

  const newResearch = () => {
    stopPolling();
    setActive(null);
    viewingRef.current = null;
    setQuestion('');
  };

  return (
    <div className="flex h-full min-h-0">
      {/* History rail */}
      <aside className="w-64 flex-shrink-0 border-r border-border/40 flex flex-col min-h-0">
        <div className="p-3 border-b border-border/40">
          <Button size="sm" onClick={newResearch} className="w-full">
            <Plus className="w-4 h-4" /> New research
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {history.length === 0 ? (
            <p className="text-[12px] text-surface-500 px-2 py-4 text-center">No research yet.</p>
          ) : (
            history.map((h) => (
              <button
                key={h.id}
                onClick={() => void loadRun(h.id)}
                className={`w-full text-left px-2 py-2 rounded-md transition-colors ${
                  active?.id === h.id
                    ? 'bg-accent-500/10 text-accent-300'
                    : 'text-surface-700 hover:bg-surface-200/40'
                }`}
              >
                <div className="flex items-center gap-1.5 text-[12px]">
                  {h.status === 'running' && (
                    <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />
                  )}
                  {h.status === 'error' && <span className="text-rose-400 flex-shrink-0">!</span>}
                  <span className="truncate flex-1">{h.question}</span>
                </div>
                <div className="text-[10px] text-surface-500 mt-0.5">
                  {h.sourceCount} sources · {new Date(h.createdAt).toLocaleDateString()}
                </div>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto min-h-0">
        {!active ? (
          <div className="max-w-2xl mx-auto px-8 py-10">
            <h2 className="text-xl font-semibold text-surface-950 mb-1 flex items-center gap-2">
              <Search className="w-5 h-5" />
              Deep Research
            </h2>
            <p className="text-[13px] text-surface-600 mb-4">
              Ask a question; DocVault searches the web across many sources and synthesizes a cited
              report. A thorough run takes a few minutes — you can leave and come back.
            </p>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={3}
              placeholder="e.g. What are the pros and cons of a Roth conversion in a low-income year?"
              className="w-full text-[14px] bg-surface-100/60 border border-border/40 rounded-xl px-3 py-2 mb-3 resize-none"
            />
            <Button onClick={start} disabled={!question.trim() || starting}>
              <Search className="w-4 h-4" />
              {starting ? 'Starting…' : 'Research'}
            </Button>
            <p className="text-[11px] text-surface-500 mt-2">
              Thorough run · live web search · roughly $0.30–1.00 per question
            </p>
          </div>
        ) : active.status === 'running' ? (
          <div className="flex flex-col items-center justify-center h-full text-surface-600 gap-3 px-6 text-center">
            <Loader2 className="w-7 h-7 animate-spin text-accent-400" />
            <p className="text-[14px] font-medium text-surface-800">Researching…</p>
            <p className="text-[13px] max-w-md">{active.question}</p>
            <p className="text-[12px] text-surface-500">
              Searching the web and synthesizing — this takes a few minutes. You can leave this view
              and come back; the run keeps going.
            </p>
          </div>
        ) : active.status === 'error' ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 px-6 text-center">
            <p className="text-[14px] text-rose-400">Research failed</p>
            <p className="text-[12px] text-surface-500 max-w-md">{active.error}</p>
          </div>
        ) : (
          <article className="max-w-3xl mx-auto px-8 py-6">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="text-[12px] text-surface-500">
                {active.searchCount ?? 0} searches · {active.sources?.length ?? 0} sources
                {active.usage
                  ? ` · ${Math.round((active.usage.inputTokens + active.usage.outputTokens) / 1000)}k tokens`
                  : ''}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <Button variant="ghost" size="xs" onClick={() => downloadReport(active.id)}>
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
            <div className="text-[14px] leading-relaxed text-surface-900">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
                {active.report ?? ''}
              </ReactMarkdown>
            </div>
            {active.sources && active.sources.length > 0 && (
              <div className="mt-8 pt-4 border-t border-border/40">
                <h3 className="text-[13px] font-semibold text-surface-800 mb-2">
                  Sources ({active.sources.length})
                </h3>
                <ol className="space-y-1 text-[12px]">
                  {active.sources.map((s, i) => (
                    <li key={s.url} className="flex gap-2">
                      <span className="text-surface-500 flex-shrink-0">{i + 1}.</span>
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent-400 hover:underline truncate"
                      >
                        {s.title || s.url}
                      </a>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </article>
        )}
      </main>
    </div>
  );
}
