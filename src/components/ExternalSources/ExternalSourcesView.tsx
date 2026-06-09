// External Sources viewer — browse + read the markdown in cloned source repos.
// Left: source picker + markdown file list. Right: rendered markdown, with
// [[wikilinks]] turned into in-app cross-links between files in the same source.

import { useEffect, useMemo, useState } from 'react';
import { FileText, GitBranch, Loader2 } from 'lucide-react';
import { useToast } from '../../hooks/useToast';
import { API_BASE } from '../../constants';
import { requestJson } from '../../api/client';
import { SafeMarkdown } from '../common/SafeMarkdown';

interface ExternalRepo {
  id: string;
  name: string;
  lastSyncedAt?: string;
  fileCount?: number;
}

/** Convert [[Target]] / [[Target|Alias]] into `wiki:` links handled in-app. */
function linkifyWikilinks(md: string): string {
  return md.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target: string, alias?: string) => {
    const label = (alias ?? target).trim();
    return `[${label}](wiki:${encodeURIComponent(target.trim())})`;
  });
}

/** Last path segment without the .md extension. */
function basename(p: string): string {
  return (p.split('/').pop() ?? p).replace(/\.md$/i, '');
}

export function ExternalSourcesView() {
  const { addToast } = useToast();
  const [sources, setSources] = useState<ExternalRepo[]>([]);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [loadingSources, setLoadingSources] = useState(true);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loadingContent, setLoadingContent] = useState(false);

  // Load the source list once.
  useEffect(() => {
    void (async () => {
      try {
        const data = await requestJson<{ repos?: ExternalRepo[] }>(`${API_BASE}/external-sources`);
        const repos = data.repos ?? [];
        setSources(repos);
        const firstSynced = repos.find((r) => r.lastSyncedAt) ?? repos[0];
        if (firstSynced) setSourceId(firstSynced.id);
      } catch {
        /* ignore */
      } finally {
        setLoadingSources(false);
      }
    })();
  }, []);

  // Load files whenever the selected source changes.
  useEffect(() => {
    if (!sourceId) {
      setFiles([]);
      return;
    }
    setLoadingFiles(true);
    setSelectedFile(null);
    setContent('');
    void (async () => {
      try {
        const data = await requestJson<{ files?: string[] }>(
          `${API_BASE}/external-sources/${sourceId}/files`
        );
        setFiles(data.files ?? []);
      } catch {
        setFiles([]);
      } finally {
        setLoadingFiles(false);
      }
    })();
  }, [sourceId]);

  // Map a wikilink target (page basename) to its file path within this source.
  const fileByBasename = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of files) {
      const key = basename(f).toLowerCase();
      if (!m.has(key)) m.set(key, f);
    }
    return m;
  }, [files]);

  const loadFile = async (path: string) => {
    if (!sourceId) return;
    setSelectedFile(path);
    setLoadingContent(true);
    try {
      const data = await requestJson<{ content?: string }>(
        `${API_BASE}/external-sources/${sourceId}/file?path=${encodeURIComponent(path)}`
      );
      setContent(data.content ?? '');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to load file', 'error');
      setContent('');
    } finally {
      setLoadingContent(false);
    }
  };

  const openWikilink = (target: string) => {
    const path = fileByBasename.get(target.toLowerCase());
    if (path) void loadFile(path);
    else addToast(`No page named "${target}"`, 'error');
  };

  const rendered = useMemo(() => linkifyWikilinks(content), [content]);

  if (loadingSources) {
    return (
      <div className="flex items-center justify-center h-full text-surface-600">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  if (sources.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center text-surface-600 gap-2 px-6">
        <GitBranch className="w-8 h-8 text-surface-500" />
        <p className="text-[14px] font-medium text-surface-800">No external sources yet</p>
        <p className="text-[13px] max-w-sm">
          Add a git repository of markdown in{' '}
          <span className="font-medium">Settings → Sources</span>, then it shows up here to browse
          and read.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row h-full min-h-0">
      {/* Left: source picker + file list — stacks on top on mobile */}
      <aside className="w-full md:w-72 flex-shrink-0 max-h-56 md:max-h-none border-b md:border-b-0 md:border-r border-border/40 flex flex-col min-h-0">
        <div className="p-3 border-b border-border/40">
          <label className="flex items-center gap-2 text-[11px] font-semibold text-surface-600 uppercase tracking-wider mb-2">
            <GitBranch className="w-3.5 h-3.5" />
            Source
          </label>
          <select
            value={sourceId ?? ''}
            onChange={(e) => setSourceId(e.target.value)}
            className="w-full text-[13px] bg-surface-100/60 border border-border/40 rounded-lg px-2 py-1.5"
          >
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.lastSyncedAt ? '' : ' (not synced)'}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {loadingFiles ? (
            <div className="flex justify-center py-6 text-surface-500">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
          ) : files.length === 0 ? (
            <p className="text-[12px] text-surface-500 px-2 py-4 text-center">No markdown files.</p>
          ) : (
            files.map((f) => (
              <button
                key={f}
                onClick={() => void loadFile(f)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-[12px] transition-colors ${
                  selectedFile === f
                    ? 'bg-accent-500/10 text-accent-300'
                    : 'text-surface-700 hover:bg-surface-200/40'
                }`}
                title={f}
              >
                <FileText className="w-3.5 h-3.5 flex-shrink-0 text-surface-500" />
                <span className="truncate">{f}</span>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* Right: rendered markdown */}
      <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden min-h-0">
        {!selectedFile ? (
          <div className="flex items-center justify-center h-full text-surface-500 text-[13px]">
            Select a file to read it.
          </div>
        ) : loadingContent ? (
          <div className="flex items-center justify-center h-full text-surface-500">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : (
          <article className="max-w-3xl mx-auto px-4 md:px-8 py-6 text-[14px] leading-relaxed text-surface-900">
            <div className="text-[11px] font-mono text-surface-500 mb-4">{selectedFile}</div>
            <SafeMarkdown
              allowedProtocols={['wiki:']}
              components={{
                h1: (props) => <h1 className="text-2xl font-bold mt-6 mb-3" {...props} />,
                h2: (props) => <h2 className="text-xl font-semibold mt-5 mb-2" {...props} />,
                h3: (props) => <h3 className="text-lg font-semibold mt-4 mb-2" {...props} />,
                table: (props) => (
                  <table className="my-3 text-[13px] border-collapse w-full" {...props} />
                ),
                th: (props) => (
                  <th
                    className="text-left border-b border-border/50 px-2 py-1 font-semibold"
                    {...props}
                  />
                ),
                td: (props) => <td className="border-b border-border/30 px-2 py-1" {...props} />,
                code: ({ className, children, ...props }) => {
                  const isBlock = /language-/.test(className ?? '');
                  return isBlock ? (
                    <code
                      className={`block bg-surface-0 border border-border/40 rounded p-2 my-2 text-[12px] overflow-x-auto ${className ?? ''}`}
                      {...props}
                    >
                      {children}
                    </code>
                  ) : (
                    <code
                      className="bg-surface-0 border border-border/40 rounded px-1 py-0.5 text-[12px]"
                      {...props}
                    >
                      {children}
                    </code>
                  );
                },
                a: ({ href, children, ...props }) => {
                  if (href?.startsWith('wiki:')) {
                    const target = decodeURIComponent(href.slice('wiki:'.length));
                    return (
                      <button
                        type="button"
                        onClick={() => openWikilink(target)}
                        className="text-accent-400 underline hover:text-accent-300"
                      >
                        {children}
                      </button>
                    );
                  }
                  return (
                    <a
                      href={href}
                      className="text-accent-400 underline"
                      target="_blank"
                      rel="noopener noreferrer"
                      {...props}
                    >
                      {children}
                    </a>
                  );
                },
                ul: (props) => <ul className="list-disc ml-5 my-2" {...props} />,
                ol: (props) => <ol className="list-decimal ml-5 my-2" {...props} />,
                p: (props) => <p className="my-2" {...props} />,
                blockquote: (props) => (
                  <blockquote
                    className="border-l-2 border-border/50 pl-3 my-2 text-surface-700"
                    {...props}
                  />
                ),
              }}
            >
              {rendered}
            </SafeMarkdown>
          </article>
        )}
      </main>
    </div>
  );
}
