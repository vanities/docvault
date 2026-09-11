// Chat history — the searchable archive behind the sidebar's "See more".
//
// The sidebar shows only the most recent handful of conversations; everything
// ever said lives here. Nothing is pruned, so this page never loads transcripts
// itself: it queries GET /api/chat/threads/search, which scans the per-thread
// files server-side and returns a summary plus a snippet per hit. Opening a row
// is what pulls that one transcript down.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, MessageSquare, Search, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { requestJson } from '../../api/client';
import { useAppContext } from '../../contexts/AppContext';

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

interface ThreadSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  preview: string;
}

interface SearchHit {
  thread: ThreadSummary;
  snippet: string;
  matchCount: number;
}

interface SearchResponse {
  hits: SearchHit[];
  total: number;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Wrap query matches in <mark> without touching innerHTML.
 *
 * Snippets are conversation text — the user's own words, which routinely
 * include angle brackets and code. Building highlight markup as a string and
 * injecting it would make every transcript an XSS vector against its own
 * author, so matches are split into React nodes instead.
 */
function highlight(text: string, query: string): React.ReactNode {
  const needle = query.trim();
  if (!needle) return text;
  const lower = text.toLowerCase();
  const target = needle.toLowerCase();
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  for (let at = lower.indexOf(target); at >= 0; at = lower.indexOf(target, cursor)) {
    if (at > cursor) nodes.push(text.slice(cursor, at));
    nodes.push(
      <mark
        key={`${at}-${nodes.length}`}
        className="bg-warning-200 text-surface-950 rounded px-0.5"
      >
        {text.slice(at, at + needle.length)}
      </mark>
    );
    cursor = at + needle.length;
  }
  nodes.push(text.slice(cursor));
  return nodes;
}

export function ChatHistoryView() {
  const { openChatThread, deleteChatThread, chatThreads } = useAppContext();

  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);

  // Guards against a slow early request overwriting a newer result — typing
  // fast enough fires several searches and they can land out of order.
  const requestSeq = useRef(0);

  const runSearch = useCallback(
    async (nextOffset: number, append: boolean) => {
      const seq = ++requestSeq.current;
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(nextOffset),
      });
      if (query.trim()) params.set('q', query.trim());
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      try {
        const result = await requestJson<SearchResponse>(
          `/api/chat/threads/search?${params.toString()}`
        );
        if (seq !== requestSeq.current) return;
        setHits((prev) => (append ? [...prev, ...result.hits] : result.hits));
        setTotal(result.total);
        setOffset(nextOffset);
      } catch {
        if (seq !== requestSeq.current) return;
        setError('Could not load chat history.');
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    },
    [query, from, to]
  );

  // Debounced: re-run whenever the query or either date bound changes.
  useEffect(() => {
    const timer = window.setTimeout(() => void runSearch(0, false), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [runSearch]);

  const handleDelete = (id: string) => {
    deleteChatThread(id);
    setHits((prev) => prev.filter((h) => h.thread.id !== id));
    setTotal((prev) => Math.max(0, prev - 1));
  };

  const hasFilters = Boolean(query.trim() || from || to);
  const shown = hits.length;
  const canLoadMore = shown < total;

  const totalArchived = useMemo(
    () => Object.keys(chatThreads.threads).length,
    [chatThreads.threads]
  );

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="mb-5">
        <h2 className="text-xl font-semibold text-surface-950 mb-1 flex items-center gap-2">
          <MessageSquare className="w-5 h-5" />
          Chat history
        </h2>
        <p className="text-[13px] text-surface-700">
          Every conversation is kept. Search the full text of {totalArchived || total} chat
          {(totalArchived || total) === 1 ? '' : 's'}.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-surface-500" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search messages…"
            aria-label="Search chat history"
            className="w-full pl-9 pr-3 py-2 rounded-md border border-surface-300 bg-surface-50 text-[14px] text-surface-950 placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-accent-400"
          />
        </div>
        <div className="flex gap-2">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="From date"
            className="px-2 py-2 rounded-md border border-surface-300 bg-surface-50 text-[13px] text-surface-950"
          />
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label="To date"
            className="px-2 py-2 rounded-md border border-surface-300 bg-surface-50 text-[13px] text-surface-950"
          />
          {hasFilters && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setQuery('');
                setFrom('');
                setTo('');
              }}
            >
              <X className="w-4 h-4" />
              Clear
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="text-[13px] text-danger-400 mb-3" role="alert">
          {error}
        </div>
      )}

      {loading && hits.length === 0 ? (
        <div className="flex items-center gap-2 text-[13px] text-surface-500 py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          Searching…
        </div>
      ) : hits.length === 0 ? (
        <div className="text-[13px] text-surface-500 italic py-8 text-center">
          {hasFilters ? 'No chats match those filters.' : 'No chats yet.'}
        </div>
      ) : (
        <ul className="space-y-1.5">
          {hits.map(({ thread, snippet, matchCount }) => (
            <li key={thread.id}>
              <div className="group flex items-start gap-3 p-3 rounded-md border border-surface-200 hover:border-surface-300 hover:bg-surface-100/60">
                <button
                  type="button"
                  onClick={() => openChatThread(thread.id)}
                  className="flex-1 text-left min-w-0"
                >
                  <div className="flex items-baseline gap-2 mb-0.5">
                    <span className="text-[14px] font-medium text-surface-950 truncate">
                      {thread.title}
                    </span>
                    <span className="text-[11px] text-surface-500 shrink-0">
                      {formatDate(thread.updatedAt)}
                    </span>
                  </div>
                  <p className="text-[12px] text-surface-700 line-clamp-2 leading-relaxed">
                    {highlight(snippet, query)}
                  </p>
                  <div className="text-[11px] text-surface-500 mt-1">
                    {thread.messageCount} message{thread.messageCount === 1 ? '' : 's'}
                    {matchCount > 0 && ` · ${matchCount} match${matchCount === 1 ? '' : 'es'}`}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(thread.id)}
                  aria-label={`Delete ${thread.title}`}
                  className="text-surface-500 hover:text-danger-400 opacity-0 group-hover:opacity-100 focus:opacity-100 shrink-0 mt-0.5"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {canLoadMore && (
        <div className="mt-4 flex justify-center">
          <Button
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => void runSearch(offset + PAGE_SIZE, true)}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Load more ({total - shown} more)
          </Button>
        </div>
      )}
    </div>
  );
}
