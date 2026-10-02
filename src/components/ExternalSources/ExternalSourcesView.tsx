import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronRight,
  FileText,
  Folder,
  GitBranch,
  Loader2,
  RefreshCw,
  Search,
  Settings,
  X,
} from 'lucide-react';
import { useToast } from '../../hooks/useToast';
import { useAppContext } from '../../contexts/AppContext';
import { API_BASE } from '../../constants';
import { requestJson } from '../../api/client';
import { SafeMarkdown } from '../common/SafeMarkdown';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { browseFiles } from './fileBrowser';

interface ExternalRepo {
  id: string;
  name: string;
  lastSyncedAt?: string;
  fileCount?: number;
}
function linkifyWikilinks(md: string): string {
  return md.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target: string, alias?: string) => {
    return `[${(alias ?? target).trim()}](wiki:${encodeURIComponent(target.trim())})`;
  });
}
function basename(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.md$/i, '');
}

export function ExternalSourcesView() {
  const { addToast } = useToast();
  const { setActiveView } = useAppContext();
  const [sources, setSources] = useState<ExternalRepo[]>([]);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [folder, setFolder] = useState('');
  const [query, setQuery] = useState('');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [loadingSources, setLoadingSources] = useState(true);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loadingContent, setLoadingContent] = useState(false);
  const [sourceError, setSourceError] = useState(false);
  const [filesError, setFilesError] = useState(false);
  const [contentError, setContentError] = useState(false);
  const [sourceRetry, setSourceRetry] = useState(0);
  const [filesRetry, setFilesRetry] = useState(0);
  const [contentRetry, setContentRetry] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let active = true;
    setLoadingSources(true);
    setSourceError(false);
    void requestJson<{ repos?: ExternalRepo[] }>(`${API_BASE}/external-sources`)
      .then((data) => {
        if (!active) return;
        const repos = data.repos ?? [];
        setSources(repos);
        setSourceId((repos.find((repo) => repo.lastSyncedAt) ?? repos[0])?.id ?? null);
      })
      .catch(() => {
        if (active) setSourceError(true);
      })
      .finally(() => {
        if (active) setLoadingSources(false);
      });
    return () => {
      active = false;
    };
  }, [sourceRetry]);

  useEffect(() => {
    if (!sourceId) return;
    let active = true;
    setLoadingFiles(true);
    setFilesError(false);
    setFiles([]);
    void requestJson<{ files?: string[] }>(
      `${API_BASE}/external-sources/${encodeURIComponent(sourceId)}/files`
    )
      .then((data) => {
        if (active) setFiles(data.files ?? []);
      })
      .catch(() => {
        if (active) setFilesError(true);
      })
      .finally(() => {
        if (active) setLoadingFiles(false);
      });
    return () => {
      active = false;
    };
  }, [sourceId, filesRetry]);

  useEffect(() => {
    if (!sourceId || !selectedFile) return;
    let active = true;
    setLoadingContent(true);
    setContentError(false);
    setContent('');
    void requestJson<{ content?: string }>(
      `${API_BASE}/external-sources/${encodeURIComponent(sourceId)}/file?path=${encodeURIComponent(selectedFile)}`
    )
      .then((data) => {
        if (active) setContent(data.content ?? '');
      })
      .catch(() => {
        if (active) setContentError(true);
      })
      .finally(() => {
        if (active) setLoadingContent(false);
      });
    heading.current?.focus();
    return () => {
      active = false;
    };
  }, [sourceId, selectedFile, contentRetry]);

  const fileByBasename = useMemo(() => {
    const map = new Map<string, string>();
    for (const file of files) {
      const key = basename(file).toLowerCase();
      if (!map.has(key)) map.set(key, file);
    }
    return map;
  }, [files]);
  const loadFile = (path: string) => {
    setSelectedFile(path);
    setContent('');
    setLoadingContent(true);
    setContentError(false);
    setFolder(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
    if (selectedFile === path) setContentRetry((value) => value + 1);
  };
  const openWikilink = (target: string) => {
    const path = fileByBasename.get(target.toLowerCase());
    if (path) loadFile(path);
    else addToast(`No page named "${target}"`, 'error');
  };
  const rendered = useMemo(() => linkifyWikilinks(content), [content]);
  const visible = browseFiles(files, folder, query);
  const source = sources.find((item) => item.id === sourceId);
  const manageSources = () => {
    localStorage.setItem('docvault.settings.activeTab', 'sources');
    setActiveView('settings');
  };

  if (loadingSources)
    return (
      <div
        role="status"
        className="flex h-full items-center justify-center gap-2 text-sm text-surface-800"
      >
        <Loader2 className="size-5 animate-spin" />
        Loading sources…
      </div>
    );
  if (sourceError || sources.length === 0)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-surface-800">
        <GitBranch className="size-8" />
        <h2 className="text-lg font-semibold text-surface-900">
          {sourceError ? 'Sources could not be loaded' : 'Your source library'}
        </h2>
        <p className="max-w-sm text-sm">
          {sourceError
            ? 'Try again to connect to your source library.'
            : 'Connect a repository to browse its folders and read your Markdown files here.'}
        </p>
        <Button onClick={sourceError ? () => setSourceRetry((value) => value + 1) : manageSources}>
          {sourceError ? 'Try again' : 'Add a source'}
        </Button>
      </div>
    );

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <aside
        aria-label="Source files"
        className={`${selectedFile ? 'hidden md:flex' : 'flex'} w-full min-h-0 flex-col border-border/40 md:w-80 md:shrink-0 md:border-r`}
      >
        <div className="space-y-3 border-b border-border/40 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-surface-950">Source library</h2>
            <Button
              variant="ghost"
              className="size-11 p-0"
              aria-label="Manage sources"
              onClick={manageSources}
            >
              <Settings className="size-4" />
            </Button>
          </div>
          <label className="block text-xs font-medium text-surface-800">
            Repository
            <select
              aria-label="Repository"
              value={sourceId ?? ''}
              onChange={(event) => {
                setSourceId(event.target.value);
                setSelectedFile(null);
                setFolder('');
                setQuery('');
                setContent('');
              }}
              className="mt-1.5 h-11 w-full rounded-lg border border-border/50 bg-surface-50 px-3 text-sm text-surface-900"
            >
              {sources.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.lastSyncedAt ? '' : ' (not synced)'}
                </option>
              ))}
            </select>
          </label>
          <div className="relative">
            <Search className="absolute left-3 top-3.5 size-4 text-surface-800" />
            <Input
              aria-label="Search source files"
              placeholder="Search all files…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-11 text-base sm:text-sm placeholder:text-surface-800 pl-9 pr-10"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear file search"
                onClick={() => setQuery('')}
                className="absolute right-0 top-0 flex size-11 items-center justify-center text-surface-800"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
          <div className="flex items-center justify-between gap-2 text-xs text-surface-800">
            <span>{files.length} files · Read only</span>
            <Button
              variant="ghost"
              className="size-11 p-0"
              aria-label="Refresh file list"
              disabled={loadingFiles}
              onClick={() => setFilesRetry((value) => value + 1)}
            >
              <RefreshCw className={`size-4 ${loadingFiles ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {!query.trim() && (
            <nav
              aria-label="Folder path"
              className="mb-3 flex flex-wrap items-center text-xs text-surface-800"
            >
              <button
                type="button"
                onClick={() => setFolder('')}
                className="min-h-11 rounded-md px-2 hover:bg-surface-200/50"
              >
                All files
              </button>
              {folder
                .split('/')
                .filter(Boolean)
                .map((part, index, parts) => (
                  <span
                    key={parts.slice(0, index + 1).join('/')}
                    className="flex min-w-0 items-center"
                  >
                    <ChevronRight className="size-3 shrink-0" />
                    <button
                      type="button"
                      className="min-h-11 rounded-md px-2 text-left [overflow-wrap:anywhere] hover:bg-surface-200/50"
                      onClick={() => setFolder(parts.slice(0, index + 1).join('/'))}
                    >
                      {part}
                    </button>
                  </span>
                ))}
            </nav>
          )}
          {query.trim() && (
            <p role="status" className="mb-3 px-2 text-xs text-surface-800">
              {visible.files.length} results in {source?.name}
            </p>
          )}
          {loadingFiles ? (
            <p role="status" className="p-4 text-sm text-surface-800">
              Loading files…
            </p>
          ) : filesError ? (
            <div role="alert" className="p-3 text-sm text-surface-800">
              <p className="mb-3">Files could not be loaded.</p>
              <Button variant="outline" onClick={() => setFilesRetry((value) => value + 1)}>
                Try again
              </Button>
            </div>
          ) : (
            <div className="space-y-1">
              {visible.folders.map((item) => (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => setFolder(item.path)}
                  className="flex min-h-14 w-full items-center gap-3 rounded-lg p-3 text-left text-surface-800 hover:bg-surface-200/50"
                >
                  <Folder className="size-5 shrink-0 text-accent-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium [overflow-wrap:anywhere]">
                      {item.name}
                    </span>
                    <span className="text-xs text-surface-800">
                      {item.count} {item.count === 1 ? 'file' : 'files'}
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0" />
                </button>
              ))}
              {visible.files.map((file) => (
                <button
                  key={file}
                  type="button"
                  onClick={() => loadFile(file)}
                  aria-current={selectedFile === file ? 'true' : undefined}
                  className={`flex min-h-14 w-full items-start gap-3 rounded-lg p-3 text-left ${selectedFile === file ? 'bg-accent-500/10 text-accent-400' : 'text-surface-800 hover:bg-surface-200/50'}`}
                >
                  <FileText className="mt-0.5 size-4 shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-sm [overflow-wrap:anywhere]">
                      {file.split('/').pop()}
                    </span>
                    {query.trim() && file.includes('/') && (
                      <span className="mt-1 block text-xs text-surface-800 [overflow-wrap:anywhere]">
                        {file.slice(0, file.lastIndexOf('/'))}
                      </span>
                    )}
                  </span>
                </button>
              ))}
              {visible.files.length === 0 && visible.folders.length === 0 && (
                <div role="status" className="p-5 text-center text-sm text-surface-800">
                  <Folder className="mx-auto mb-3 size-7" />
                  <p>
                    {query.trim()
                      ? 'No files match your search.'
                      : !source?.lastSyncedAt
                        ? 'Sync this source in Settings to start browsing.'
                        : 'No Markdown files in this folder.'}
                  </p>
                  {query.trim() && (
                    <Button variant="link" onClick={() => setQuery('')}>
                      Clear search
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </aside>
      <section
        aria-label="File reader"
        className={`${selectedFile ? 'flex' : 'hidden md:flex'} min-h-0 min-w-0 flex-1 flex-col`}
      >
        {!selectedFile ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-surface-800">
            <FileText className="size-10 text-surface-800" />
            <h3 className="text-lg font-medium text-surface-900">
              A place for your reference files
            </h3>
            <p className="max-w-sm text-sm">
              Open a folder or search the library, then select a file to read it.
            </p>
          </div>
        ) : (
          <>
            <div className="border-b border-border/40 p-4">
              <Button
                variant="ghost"
                className="mb-2 h-11 px-0 text-surface-800 md:hidden"
                onClick={() => setSelectedFile(null)}
              >
                <ArrowLeft className="size-4" />
                Back to files
              </Button>
              <p className="mb-1 text-xs text-surface-800 [overflow-wrap:anywhere]">
                {source?.name} / {selectedFile}
              </p>
              <h2
                ref={heading}
                tabIndex={-1}
                className="text-lg font-semibold text-surface-950 outline-none [overflow-wrap:anywhere]"
              >
                {basename(selectedFile)}
              </h2>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
              {loadingContent ? (
                <p
                  role="status"
                  className="flex items-center justify-center gap-2 p-8 text-sm text-surface-800"
                >
                  <Loader2 className="size-5 animate-spin" />
                  Loading file…
                </p>
              ) : contentError ? (
                <div role="alert" className="p-6 text-sm text-surface-800">
                  <p className="mb-3">This file could not be loaded.</p>
                  <Button variant="outline" onClick={() => setContentRetry((value) => value + 1)}>
                    Try again
                  </Button>
                </div>
              ) : (
                <article className="mx-auto max-w-3xl px-4 py-5 text-sm leading-relaxed text-surface-900 [overflow-wrap:anywhere] md:px-8">
                  {!content.trim() && <p className="text-surface-800">This file is empty.</p>}
                  <SafeMarkdown
                    allowedProtocols={['wiki:']}
                    components={{
                      h1: (props) => <h1 className="text-2xl font-bold mt-6 mb-3" {...props} />,
                      h2: (props) => <h2 className="text-xl font-semibold mt-5 mb-2" {...props} />,
                      h3: (props) => <h3 className="text-lg font-semibold mt-4 mb-2" {...props} />,
                      table: (props) => (
                        <div className="overflow-x-auto">
                          <table className="my-3 text-[13px] border-collapse w-full" {...props} />
                        </div>
                      ),
                      th: (props) => (
                        <th
                          className="text-left border-b border-border/50 px-2 py-1 font-semibold"
                          {...props}
                        />
                      ),
                      td: (props) => (
                        <td className="border-b border-border/30 px-2 py-1" {...props} />
                      ),
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
                          className="border-l-2 border-border/50 pl-3 my-2 text-surface-800"
                          {...props}
                        />
                      ),
                    }}
                  >
                    {rendered}
                  </SafeMarkdown>
                </article>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
