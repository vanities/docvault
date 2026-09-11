/* oxlint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { useFileSystemServer, type EntityConfig } from '../hooks/useFileSystemServer';
import { requestJson } from '../api/client';
import type { Entity, TaxDocument, DocumentType, ExpenseCategory, Todo } from '../types';
import { uuidV4 } from '../utils/uuid';
import {
  EMPTY_CHAT_STATS,
  isThreadUnloaded,
  mergeThreadsState,
  pruneThreadsState,
  type PersistedThread,
  type ThreadsState,
} from './chatPersistence';

export type { ChatStats, PersistedThread, ThreadsState } from './chatPersistence';

// ---------------------------------------------------------------------------
// Chat threads — single source of truth for the multi-thread chat UI.
// Lives in AppContext (not local to ChatView) because the main Sidebar
// renders the thread list under the "Chat" NavButton when active. Mirrors
// t3code's pattern where threads are first-class sidebar rows.
//
// The `messages` field is loose `unknown[]` here because Sidebar doesn't
// need to know about ChatMessage / AssistantBlock shapes — only ChatView
// reads/writes the conversation transcript and casts at the boundary.
// Persistence lives server-side in DATA_DIR (.docvault-chat-threads.json,
// via /api/chat/threads) and is deliberately bounded/pruned in
// chatPersistence.ts so private chat history cannot grow unbounded.
// localStorage remains only as a migration source + offline fallback.
// ---------------------------------------------------------------------------

/**
 * Shape of GET /api/chat/threads — the thread index, plus the active
 * transcript so the open chat paints without a second round trip. Every other
 * thread arrives as metadata only and is fetched when opened.
 */
interface ServerThreadsIndex {
  threads: Record<string, Omit<PersistedThread, 'messages'>>;
  activeThreadId: string | null;
  activeThread?: PersistedThread | null;
}

function serverIndexToThreadsState(index: ServerThreadsIndex): ThreadsState {
  const threads: Record<string, PersistedThread> = {};
  for (const [id, summary] of Object.entries(index.threads ?? {})) {
    threads[id] = { ...summary, messages: [] };
  }
  const active = index.activeThread;
  if (active && threads[active.id]) {
    threads[active.id] = { ...threads[active.id], messages: active.messages ?? [] };
  }
  return { threads, activeThreadId: index.activeThreadId ?? null };
}

const CHAT_THREADS_STORAGE_KEY = 'docvault-chat-threads-v1';
const LEGACY_CHAT_HISTORY_KEY = 'docvault-chat-history-v1';
const LEGACY_CHAT_META_KEY = 'docvault-chat-meta-v1';
// Boot hydration retry backoff: start fast so a blip costs almost nothing,
// cap so a long outage doesn't spin.
const CHAT_HYDRATE_RETRY_MS = 2000;
const CHAT_HYDRATE_MAX_RETRY_MS = 30_000;
const MIN_PERSISTED_YEAR = 1900;
const MAX_FUTURE_YEAR_OFFSET = 5;

function isValidPersistedYear(year: number, currentYear: number): boolean {
  return (
    Number.isFinite(year) &&
    Number.isInteger(year) &&
    year >= MIN_PERSISTED_YEAR &&
    year <= currentYear + MAX_FUTURE_YEAR_OFFSET
  );
}

function sanitizePersistedYear(value: string | null, currentYear: number): number {
  if (!value) return currentYear;
  const parsed = Number(value);
  return isValidPersistedYear(parsed, currentYear) ? parsed : currentYear;
}

// 'all' is a client-side pseudo-entity (the sidebar's "All Entities" option) —
// it never appears in the server's entity list, so the stale-entity fallback
// must treat it as always valid or selecting it instantly reverts.
export function isKnownEntitySelection(selectedEntity: Entity, entities: EntityConfig[]): boolean {
  return selectedEntity === 'all' || entities.some((entity) => entity.id === selectedEntity);
}

// Browser-side history reader. Since chat history moved server-side
// (/api/chat/threads), this is only a migration source for pre-server
// localStorage history and an offline fallback when the server is down.
function loadLocalThreadsState(): ThreadsState {
  try {
    const raw = localStorage.getItem(CHAT_THREADS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ThreadsState;
      if (parsed && parsed.threads && typeof parsed.threads === 'object') {
        return pruneThreadsState(parsed);
      }
    }
  } catch {
    /* fall through to migration */
  }
  return pruneThreadsState(migrateLegacyChat());
}

function migrateLegacyChat(): ThreadsState {
  try {
    const rawMessages = localStorage.getItem(LEGACY_CHAT_HISTORY_KEY);
    const rawMeta = localStorage.getItem(LEGACY_CHAT_META_KEY);
    if (!rawMessages && !rawMeta) return { threads: {}, activeThreadId: null };
    const messages = rawMessages ? (JSON.parse(rawMessages) as unknown[]) : [];
    const meta = rawMeta
      ? (JSON.parse(rawMeta) as { chatId: string | null; resumeSessionId: string | null })
      : { chatId: null, resumeSessionId: null };
    if (!Array.isArray(messages) || (messages.length === 0 && !meta.chatId)) {
      return { threads: {}, activeThreadId: null };
    }
    const id = typeof meta.chatId === 'string' && meta.chatId.length > 0 ? meta.chatId : uuidV4();
    const now = new Date().toISOString();
    const thread: PersistedThread = {
      id,
      title: 'Recovered chat',
      resumeSessionId: meta.resumeSessionId ?? null,
      messages,
      stats: EMPTY_CHAT_STATS,
      createdAt: now,
      updatedAt: now,
    };
    localStorage.removeItem(LEGACY_CHAT_HISTORY_KEY);
    localStorage.removeItem(LEGACY_CHAT_META_KEY);
    return { threads: { [id]: thread }, activeThreadId: id };
  } catch {
    return { threads: {}, activeThreadId: null };
  }
}

// Emergency persistence when the server PUT fails — keeps history across a
// reload even while the backend is unreachable.
function saveThreadsToLocalFallback(state: ThreadsState): void {
  const pruned = pruneThreadsState(state);
  try {
    localStorage.setItem(CHAT_THREADS_STORAGE_KEY, JSON.stringify(pruned));
  } catch {
    // Quota exceeded or storage disabled. Retry with metadata-only threads so
    // the app remains usable without persisting large/private transcripts.
    try {
      const metadataOnly = pruneThreadsState(
        {
          activeThreadId: pruned.activeThreadId,
          threads: Object.fromEntries(
            Object.values(pruned.threads).map((thread) => [thread.id, { ...thread, messages: [] }])
          ),
        },
        { maxThreads: 5, maxMessagesPerThread: 0, maxSerializedChars: 50_000 }
      );
      localStorage.setItem(CHAT_THREADS_STORAGE_KEY, JSON.stringify(metadataOnly));
    } catch {
      /* quota exceeded or storage unavailable */
    }
  }
}

// Navigation views
export type NavView =
  | 'tax-year'
  | 'business-docs'
  | 'all-files'
  | 'chat'
  | 'chat-history'
  | 'external-sources'
  | 'deep-research'
  | 'daily-news'
  | 'settings'
  | 'tn-tax'
  | 'solo-401k'
  | 'estimated-tax'
  | 'federal-tax'
  | 'crypto'
  | 'brokers'
  | 'banks'
  | 'portfolio'
  | 'sales'
  | 'mileage'
  | 'timesheet'
  | 'gold'
  | 'property'
  | 'income'
  | 'debts'
  | 'quant'
  | 'strategy'
  | 'politics'
  | 'predictions'
  | 'tech'
  | 'local-news'
  | 'calendar'
  | 'health'
  | 'health-activity'
  | 'health-heart'
  | 'health-sleep'
  | 'health-workouts'
  | 'health-body'
  | 'health-records'
  | 'health-dna'
  | 'health-nutrition'
  | 'health-sickness'
  | 'health-analysis'
  | 'health-research';

// Tab types for tax year view
export type TabType = 'documents' | 'income' | 'expenses' | 'invoices' | 'statements';

// Search result from server
export interface SearchResult {
  entity: string;
  entityName: string;
  name: string;
  path: string;
  size: number;
  lastModified: number;
  type: string;
  parsedData: Record<string, unknown> | null;
}

interface AppContextValue {
  // Connection state
  isConnected: boolean;
  dataDir: string;
  checkConnection: () => Promise<void>;
  fsError: string | null;

  // Auth state
  authRequired: boolean;
  authenticated: boolean;

  // Entity state
  selectedEntity: Entity;
  setSelectedEntity: (entity: Entity) => void;
  entities: EntityConfig[];

  // View state
  activeView: NavView;
  setActiveView: (view: NavView) => void;

  // Health: currently-selected person for segment views (Activity, Heart,
  // Sleep, Workouts, Body). Null means "no person chosen yet" — segment
  // views show a person picker in that case. Persisted in localStorage so
  // it survives page reloads.
  selectedHealthPersonId: string | null;
  setSelectedHealthPersonId: (id: string | null) => void;

  // Tab state (for tax-year view)
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;

  // Year state
  selectedYear: number;
  setSelectedYear: (year: number) => void;
  availableYears: number[];

  // Document state
  scannedDocuments: TaxDocument[];
  setScannedDocuments: React.Dispatch<React.SetStateAction<TaxDocument[]>>;

  // Processing state
  isScanning: boolean;
  isParsing: boolean;
  setIsParsing: (isParsing: boolean) => void;
  isProcessing: boolean;

  // Search state
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  searchResults: SearchResult[];
  isSearching: boolean;
  searchActive: boolean;
  clearSearch: () => void;

  // File system hook functions
  scanTaxYear: (entity: Entity, year: number) => Promise<TaxDocument[]>;
  scanBusinessDocs: (entity: Entity) => Promise<TaxDocument[]>;
  scanAllFiles: (entity: Entity) => Promise<TaxDocument[]>;
  importFile: (
    file: File,
    docType: DocumentType,
    entity: Entity,
    taxYear: number,
    expenseCategory?: ExpenseCategory,
    customFilename?: string,
    parsedData?: Record<string, unknown>
  ) => Promise<boolean>;
  openFile: (entity: Entity, filePath: string) => Promise<void>;
  deleteFile: (entity: Entity, filePath: string) => Promise<boolean>;
  parseFile: (entity: Entity, filePath: string) => Promise<Record<string, unknown> | null>;
  parseAllFiles: (
    entity: Entity,
    year: number,
    options?: {
      filter?: string[];
      unparsedOnly?: boolean;
      onProgress?: (progress: { current: number; total: number; fileName: string }) => void;
    }
  ) => Promise<{ parsed: number; failed: number; total: number } | null>;
  addEntity: (id: string, name: string, color: string) => Promise<EntityConfig | null>;
  removeEntity: (id: string) => Promise<boolean>;
  updateEntity: (
    id: string,
    updates: { name?: string; color?: string; icon?: string; description?: string }
  ) => Promise<EntityConfig | null>;
  moveFile: (
    fromEntity: Entity,
    fromPath: string,
    toEntity: Entity,
    toYear: number
  ) => Promise<boolean>;
  relocateFile: (
    fromEntity: Entity,
    fromPath: string,
    toEntity: Entity,
    toYear: number,
    newDocType: DocumentType,
    expenseCategory?: ExpenseCategory
  ) => Promise<boolean>;
  renameFile: (entity: Entity, filePath: string, newFilename: string) => Promise<string | null>;
  getYearsForEntity: (entity: Entity) => Promise<number[]>;

  // Mobile sidebar
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;

  // Reminders live in the calendar store now — see Calendar/useCalendarApi.

  // Todos
  todos: Todo[];
  addTodo: (title: string) => Promise<Todo | null>;
  updateTodo: (id: string, updates: Partial<Todo>) => Promise<Todo | null>;
  deleteTodo: (id: string) => Promise<boolean>;

  // Document metadata
  updateDocMetadata: (
    entity: string,
    filePath: string,
    updates: { tags?: string[]; notes?: string; tracked?: boolean }
  ) => Promise<boolean>;

  // Zip download
  downloadZip: (
    entity: string,
    year: number,
    filter: 'income' | 'expenses' | 'invoices' | 'all'
  ) => Promise<void>;

  // CPA Package download
  downloadCpaPackage: (entity: string, year: number) => Promise<void>;

  // Display preferences
  blurNumbers: boolean;
  setBlurNumbers: (v: boolean) => void;

  // Chat threads — multi-thread chat state shared between ChatView (which
  // owns the conversation surface) and Sidebar (which renders the thread
  // picker as nested rows under the Chat NavButton).
  chatThreads: ThreadsState;
  /** Mutate the active thread by passing a partial update. No-op if no
   *  active thread exists. updatedAt is stamped automatically. */
  updateActiveChatThread: (updater: (t: PersistedThread) => Partial<PersistedThread>) => void;
  /** Mint a fresh thread, switch to it, and return its id. */
  newChatThread: () => string;
  /** Switch the active thread, fetching its transcript if not yet loaded. */
  switchChatThread: (id: string) => void;
  /** Delete a thread; if it was active, falls back to the next-most-recent. */
  deleteChatThread: (id: string) => void;
  /** Fetch one thread's transcript on demand. Threads list without one. */
  loadChatThreadMessages: (id: string) => Promise<void>;
  /** Open a thread in the chat view — used by the history page. */
  openChatThread: (id: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}

interface AppProviderProps {
  children: ReactNode;
}

export function AppProvider({ children }: AppProviderProps) {
  const currentYear = new Date().getFullYear();

  // Valid views for hash routing. Must stay in sync with the `NavView` union
  // above — a missing entry here silently falls back to 'tax-year' on both
  // page load and any hashchange, which looks like "clicking the sidebar
  // button sometimes snaps back to Tax Year."
  const validViews = useMemo(
    () =>
      new Set<string>([
        'tax-year',
        'business-docs',
        'all-files',
        'chat-history',
        'chat',
        'external-sources',
        'deep-research',
        'daily-news',
        'settings',
        'tn-tax',
        'crypto',
        'brokers',
        'banks',
        'portfolio',
        'sales',
        'mileage',
        'timesheet',
        'gold',
        'solo-401k',
        'estimated-tax',
        'federal-tax',
        'property',
        'income',
        'debts',
        'quant',
        'strategy',
        'politics',
        'predictions',
        'tech',
        'local-news',
        'calendar',
        'health',
        'health-activity',
        'health-heart',
        'health-sleep',
        'health-workouts',
        'health-body',
        'health-records',
        'health-dna',
        'health-nutrition',
        'health-sickness',
        'health-analysis',
        'health-research',
      ]),
    []
  );

  const viewFromHash = useCallback((): NavView | null => {
    const hash = window.location.hash.replace('#', '');
    return validViews.has(hash) ? (hash as NavView) : null;
  }, [validViews]);

  // View state: hash > localStorage > default (validate stored value against known views)
  const [activeView, setActiveViewState] = useState<NavView>(() => {
    const fromHash = viewFromHash();
    if (fromHash) return fromHash;
    const stored = localStorage.getItem('docvault-view');
    if (stored && validViews.has(stored)) return stored as NavView;
    return 'tax-year';
  });
  const [activeTab, setActiveTab] = useState<TabType>('documents');

  // Mobile sidebar state (declared before callbacks that reference it)
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Chat threads — see header docblock at top of file for the design.
  // History persists server-side (DATA_DIR/.docvault-chat-threads.json via
  // /api/chat/threads); localStorage is only a one-time migration source and
  // an emergency fallback while the server is unreachable.
  const [chatThreads, setChatThreads] = useState<ThreadsState>(() => ({
    threads: {},
    activeThreadId: null,
  }));
  // Hydration is tracked in state, not just a ref, so the persistence effect
  // below re-runs (and flushes) the moment a retried hydration succeeds.
  const [chatHydrated, setChatHydrated] = useState(false);
  const chatHydratedRef = useRef(false);
  const chatThreadsRef = useRef(chatThreads);
  // Threads whose transcript is already being fetched, so a double-click on a
  // history row doesn't fire two requests for the same conversation.
  const loadingThreadsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    chatHydratedRef.current = chatHydrated;
  }, [chatHydrated]);

  useEffect(() => {
    chatThreadsRef.current = chatThreads;
  }, [chatThreads]);

  // Hydrate on boot: show this browser's fallback immediately, then reconcile
  // with the server's copy (newest write per thread wins).
  //
  // The server answers with the thread INDEX plus the active transcript only.
  // History is kept in full, so pulling every transcript on boot would mean
  // downloading the entire archive before the first message paints; the rest
  // load when a thread is actually opened.
  //
  // Hydration counts as complete ONLY once the server has actually answered.
  // A failed GET used to flip the flag anyway, so a flaky boot — routine over
  // the LAN/VPN — would hydrate from an empty browser fallback and then write
  // that emptiness straight over real server-side history. Until the server
  // answers we keep retrying and write nothing but the local fallback.
  useEffect(() => {
    let cancelled = false;
    let retryTimer = 0;

    const local = loadLocalThreadsState();
    if (Object.keys(local.threads).length > 0) {
      setChatThreads((prev) => mergeThreadsState(local, prev));
    }

    const attempt = async (delayMs: number): Promise<void> => {
      let server: ServerThreadsIndex | null = null;
      try {
        server = await requestJson<ServerThreadsIndex>('/api/chat/threads');
      } catch {
        // Server unreachable — keep showing the local copy and try again.
      }
      if (cancelled) return;
      if (!server) {
        retryTimer = window.setTimeout(
          () => void attempt(Math.min(delayMs * 2, CHAT_HYDRATE_MAX_RETRY_MS)),
          delayMs
        );
        return;
      }
      const fromServer = serverIndexToThreadsState(server);
      setChatThreads((prev) => mergeThreadsState(fromServer, prev));
      setChatHydrated(true);
    };

    void attempt(CHAT_HYDRATE_RETRY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
    };
  }, []);

  // The only thread whose content can change is the active one (every mutation
  // path goes through updateActiveChatThread), so that is the only thread worth
  // writing. This is what keeps save cost flat as history grows: it's one
  // transcript per save, not the whole archive.
  const activeChatThread = chatThreads.activeThreadId
    ? (chatThreads.threads[chatThreads.activeThreadId] ?? null)
    : null;

  useEffect(() => {
    if (!chatHydrated) {
      // We haven't seen the server's copy yet — writing now could clobber it.
      // Park anything the user has typed in the browser fallback instead; the
      // save below runs as soon as hydration lands.
      if (Object.keys(chatThreadsRef.current.threads).length > 0) {
        saveThreadsToLocalFallback(chatThreadsRef.current);
      }
      return;
    }
    if (!activeChatThread) return;
    const timer = window.setTimeout(() => {
      requestJson<{ ok: boolean }>(`/api/chat/threads/${activeChatThread.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(activeChatThread),
      })
        .then(() => {
          // Saved server-side; the browser copy is now redundant. Holding on to
          // it would leave transcripts sitting in cleartext localStorage.
          try {
            localStorage.removeItem(CHAT_THREADS_STORAGE_KEY);
          } catch {
            /* storage unavailable */
          }
        })
        .catch(() => saveThreadsToLocalFallback(chatThreadsRef.current));
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [activeChatThread, chatHydrated]);

  // Which thread is open is index-level state, so it rides separately from the
  // transcript write above — switching chats shouldn't re-upload a transcript.
  useEffect(() => {
    if (!chatHydrated) return;
    void requestJson<{ ok: boolean }>('/api/chat/threads/active', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeThreadId: chatThreads.activeThreadId }),
    }).catch(() => {
      /* pointer is cosmetic; the next successful save re-syncs it */
    });
  }, [chatThreads.activeThreadId, chatHydrated]);

  // Flush the open transcript before the tab goes away (debounce may not fire).
  useEffect(() => {
    const flush = () => {
      if (!chatHydratedRef.current) return;
      const state = chatThreadsRef.current;
      const thread = state.activeThreadId ? state.threads[state.activeThreadId] : null;
      if (!thread) return;
      try {
        void fetch(`/api/chat/threads/${thread.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(thread),
          keepalive: true,
        });
      } catch {
        /* page is going away — best effort */
      }
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  /**
   * Pull a thread's transcript on demand.
   *
   * Threads arrive from the index with `messages: []`; this fills one in the
   * first time it's opened. No-ops when the transcript is already present or
   * a fetch for it is already in flight.
   */
  const loadChatThreadMessages = useCallback(async (id: string): Promise<void> => {
    const existing = chatThreadsRef.current.threads[id];
    if (!existing || !isThreadUnloaded(existing) || loadingThreadsRef.current.has(id)) return;
    loadingThreadsRef.current.add(id);
    try {
      const full = await requestJson<PersistedThread>(`/api/chat/threads/${id}`);
      setChatThreads((prev) => {
        const current = prev.threads[id];
        if (!current) return prev;
        return {
          ...prev,
          threads: {
            ...prev.threads,
            [id]: { ...current, messages: full.messages ?? [], messageCount: full.messageCount },
          },
        };
      });
    } catch {
      /* leave it unloaded; opening it again retries */
    } finally {
      loadingThreadsRef.current.delete(id);
    }
  }, []);
  // NOTE: none of these prune. History is kept in full server-side; the only
  // bounded copy is the localStorage fallback (see chatPersistence.ts).
  const updateActiveChatThread = useCallback(
    (updater: (t: PersistedThread) => Partial<PersistedThread>) => {
      setChatThreads((prev) => {
        if (!prev.activeThreadId) return prev;
        const current = prev.threads[prev.activeThreadId];
        if (!current) return prev;
        const next = { ...current, ...updater(current), updatedAt: new Date().toISOString() };
        return {
          ...prev,
          threads: {
            ...prev.threads,
            // messageCount tracks what this client now holds, so the thread
            // doesn't look "unloaded" to isThreadUnloaded after an edit.
            [prev.activeThreadId]: { ...next, messageCount: next.messages.length },
          },
        };
      });
    },
    []
  );

  const newChatThread = useCallback((): string => {
    const id = uuidV4();
    const now = new Date().toISOString();
    setChatThreads((prev) => ({
      activeThreadId: id,
      threads: {
        ...prev.threads,
        [id]: {
          id,
          title: 'New chat',
          resumeSessionId: null,
          messages: [],
          stats: EMPTY_CHAT_STATS,
          createdAt: now,
          updatedAt: now,
          messageCount: 0,
          preview: '',
        },
      },
    }));
    return id;
  }, []);

  const switchChatThread = useCallback(
    (id: string) => {
      setChatThreads((prev) => (prev.threads[id] ? { ...prev, activeThreadId: id } : prev));
      // Opening a thread from the index is the moment its transcript is needed.
      void loadChatThreadMessages(id);
    },
    [loadChatThreadMessages]
  );

  const deleteChatThread = useCallback((id: string) => {
    setChatThreads((prev) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [id]: _gone, ...rest } = prev.threads;
      const newActive =
        prev.activeThreadId === id
          ? (Object.keys(rest).sort((a, b) =>
              rest[b].updatedAt.localeCompare(rest[a].updatedAt)
            )[0] ?? null)
          : prev.activeThreadId;
      return { threads: rest, activeThreadId: newActive };
    });
    // Deletion has to reach the server: with full retention there is no pruning
    // pass that would eventually drop the file on its own.
    void requestJson<{ ok: boolean }>(`/api/chat/threads/${id}`, { method: 'DELETE' }).catch(() => {
      /* the row is gone locally; a failed delete resurfaces on next hydrate */
    });
  }, []);

  const openChatThread = useCallback(
    (id: string) => {
      switchChatThread(id);
      setActiveViewState('chat');
      localStorage.setItem('docvault-view', 'chat');
      window.location.hash = 'chat';
    },
    [switchChatThread]
  );

  const setActiveView = useCallback((view: NavView) => {
    setActiveViewState(view);
    localStorage.setItem('docvault-view', view);
    window.location.hash = view === 'tax-year' ? '' : view;
    setSidebarOpen(false);
  }, []);

  // Listen for browser back/forward navigation
  useEffect(() => {
    const onHashChange = () => {
      const view = viewFromHash();
      if (view) {
        setActiveViewState(view);
        localStorage.setItem('docvault-view', view);
      } else {
        setActiveViewState('tax-year');
        localStorage.setItem('docvault-view', 'tax-year');
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [viewFromHash]);

  // Listen for cross-component navigation requests
  useEffect(() => {
    const onNavigate = () => setActiveView('settings');
    window.addEventListener('navigate-to-settings', onNavigate);
    return () => window.removeEventListener('navigate-to-settings', onNavigate);
  }, [setActiveView]);

  // Entity state with localStorage persistence
  const [selectedEntity, setSelectedEntityState] = useState<Entity>(() => {
    const saved = localStorage.getItem('docvault-entity');
    return (saved as Entity) || 'personal';
  });

  // Health "which person am I looking at" state, persisted in localStorage.
  // Null means "no selection" — segment views render a picker in that case.
  // Cleared when the user archives/deletes the selected person.
  const [selectedHealthPersonId, setSelectedHealthPersonIdState] = useState<string | null>(() => {
    return localStorage.getItem('docvault-health-person') || null;
  });

  const setSelectedHealthPersonId = useCallback((id: string | null) => {
    setSelectedHealthPersonIdState(id);
    if (id) {
      localStorage.setItem('docvault-health-person', id);
    } else {
      localStorage.removeItem('docvault-health-person');
    }
  }, []);

  // Year state with localStorage persistence
  const [selectedYear, setSelectedYearState] = useState(() => {
    return sanitizePersistedYear(localStorage.getItem('docvault-year'), currentYear);
  });

  // Display preferences with localStorage persistence
  const [blurNumbers, setBlurNumbersState] = useState(() => {
    return localStorage.getItem('docvault-blur-numbers') === 'true';
  });

  const setBlurNumbers = useCallback((v: boolean) => {
    setBlurNumbersState(v);
    localStorage.setItem('docvault-blur-numbers', String(v));
  }, []);

  // Document state
  const [scannedDocuments, setScannedDocuments] = useState<TaxDocument[]>([]);
  const [entityYears, setEntityYears] = useState<number[]>([]);
  const [isParsing, setIsParsing] = useState(false);

  // Search state
  const [searchQuery, setSearchQueryState] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchActive = searchQuery.length >= 2;
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchSequenceRef = useRef(0);

  const setSearchQuery = useCallback((query: string) => {
    setSearchQueryState(query);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    searchAbortRef.current?.abort();
    const sequence = ++searchSequenceRef.current;

    if (query.length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      searchAbortRef.current = controller;
      setIsSearching(true);
      try {
        const data = await requestJson<{ files?: SearchResult[] }>(
          `/api/search?q=${encodeURIComponent(query)}`,
          { signal: controller.signal }
        );
        if (searchSequenceRef.current === sequence) setSearchResults(data.files ?? []);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (searchSequenceRef.current === sequence) setSearchResults([]);
      } finally {
        if (searchSequenceRef.current === sequence) setIsSearching(false);
        if (searchAbortRef.current === controller) searchAbortRef.current = null;
      }
    }, 250);
  }, []);

  const clearSearch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    searchAbortRef.current?.abort();
    searchSequenceRef.current++;
    setSearchQueryState('');
    setSearchResults([]);
    setIsSearching(false);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      searchAbortRef.current?.abort();
    };
  }, []);

  // File system hook
  const {
    isConnected,
    dataDir,
    isScanning,
    error: fsError,
    entities,
    authRequired,
    authenticated,
    checkConnection,
    getYearsForEntity,
    scanTaxYear,
    scanBusinessDocs,
    scanAllFiles,
    importFile,
    openFile,
    deleteFile,
    parseFile,
    parseAllFiles,
    addEntity,
    removeEntity,
    updateEntity,
    moveFile,
    relocateFile,
    renameFile,
    todos,
    addTodo,
    updateTodo,
    deleteTodo,
    updateDocMetadata,
    downloadZip,
    downloadCpaPackage,
  } = useFileSystemServer();

  // Global processing state
  const isProcessing = isScanning || isParsing;

  // Persist entity selection
  const setSelectedEntity = useCallback((entity: Entity) => {
    setSelectedEntityState(entity);
    localStorage.setItem('docvault-entity', entity);
    setSidebarOpen(false);
  }, []);

  // Stored entity ids can go stale if an entity is removed/renamed server-side.
  // Once the server's entity list is known, fall back to the first valid entity.
  useEffect(() => {
    if (entities.length === 0) return;
    if (isKnownEntitySelection(selectedEntity, entities)) return;
    const fallback = entities[0].id;
    setSelectedEntityState(fallback);
    localStorage.setItem('docvault-entity', fallback);
  }, [entities, selectedEntity]);

  // Persist year selection
  const setSelectedYear = useCallback(
    (year: number) => {
      const safeYear = isValidPersistedYear(year, currentYear) ? year : currentYear;
      setSelectedYearState(safeYear);
      localStorage.setItem('docvault-year', String(safeYear));
    },
    [currentYear]
  );

  // Fetch available years when entity changes
  useEffect(() => {
    if (isConnected) {
      void getYearsForEntity(selectedEntity).then(setEntityYears);
    }
  }, [isConnected, selectedEntity, getYearsForEntity]);

  // Scan files when entity or year changes (only for tax-year view)
  useEffect(() => {
    if (isConnected && (activeView === 'tax-year' || activeView === 'tn-tax')) {
      void scanTaxYear(selectedEntity, selectedYear).then(setScannedDocuments);
    }
  }, [isConnected, selectedEntity, selectedYear, scanTaxYear, activeView]);

  // Available years (from server or default, always include current year)
  const availableYears = useMemo(() => {
    if (entityYears.length > 0) {
      const years = new Set(entityYears);
      years.add(currentYear);
      return Array.from(years).sort((a, b) => b - a);
    }
    return Array.from({ length: 6 }, (_, i) => currentYear - i);
  }, [entityYears, currentYear]);

  const value: AppContextValue = {
    // Connection
    isConnected,
    dataDir,
    checkConnection,
    fsError,

    // Auth
    authRequired,
    authenticated,

    // Entity
    selectedEntity,
    setSelectedEntity,
    entities,

    // View
    activeView,
    setActiveView,

    // Health person selection
    selectedHealthPersonId,
    setSelectedHealthPersonId,

    // Tab
    activeTab,
    setActiveTab,

    // Year
    selectedYear,
    setSelectedYear,
    availableYears,

    // Chat threads
    chatThreads,
    updateActiveChatThread,
    newChatThread,
    switchChatThread,
    deleteChatThread,
    loadChatThreadMessages,
    openChatThread,

    // Documents
    scannedDocuments,
    setScannedDocuments,

    // Processing
    isScanning,
    isParsing,
    setIsParsing,
    isProcessing,

    // Search
    searchQuery,
    setSearchQuery,
    searchResults,
    isSearching,
    searchActive,
    clearSearch,

    // File operations
    scanTaxYear,
    scanBusinessDocs,
    scanAllFiles,
    importFile,
    openFile,
    deleteFile,
    parseFile,
    parseAllFiles,
    addEntity,
    removeEntity,
    updateEntity,
    moveFile,
    relocateFile,
    renameFile,
    getYearsForEntity,

    // Mobile sidebar
    sidebarOpen,
    setSidebarOpen,

    // Todos
    todos,
    addTodo,
    updateTodo,
    deleteTodo,

    // Document metadata
    updateDocMetadata,

    // Zip download
    downloadZip,

    // CPA Package
    downloadCpaPackage,

    // Display preferences
    blurNumbers,
    setBlurNumbers,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
