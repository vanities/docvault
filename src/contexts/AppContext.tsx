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
import type { Entity, TaxDocument, DocumentType, ExpenseCategory, Reminder, Todo } from '../types';
import { uuidV4 } from '../utils/uuid';

// ---------------------------------------------------------------------------
// Chat threads — single source of truth for the multi-thread chat UI.
// Lives in AppContext (not local to ChatView) because the main Sidebar
// renders the thread list under the "Chat" NavButton when active. Mirrors
// t3code's pattern where threads are first-class sidebar rows.
//
// The `messages` field is loose `unknown[]` here because Sidebar doesn't
// need to know about ChatMessage / AssistantBlock shapes — only ChatView
// reads/writes the conversation transcript and casts at the boundary.
// ---------------------------------------------------------------------------

export interface ChatStats {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface PersistedThread {
  id: string; // UUID, also serves as chatId for attachment scoping
  title: string;
  resumeSessionId: string | null;
  messages: unknown[];
  stats: ChatStats;
  createdAt: string;
  updatedAt: string;
}

export interface ThreadsState {
  threads: Record<string, PersistedThread>;
  activeThreadId: string | null;
}

const CHAT_THREADS_STORAGE_KEY = 'docvault-chat-threads-v1';
const LEGACY_CHAT_HISTORY_KEY = 'docvault-chat-history-v1';
const LEGACY_CHAT_META_KEY = 'docvault-chat-meta-v1';
const EMPTY_CHAT_STATS: ChatStats = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

function loadThreadsState(): ThreadsState {
  try {
    const raw = localStorage.getItem(CHAT_THREADS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ThreadsState;
      if (parsed && parsed.threads && typeof parsed.threads === 'object') return parsed;
    }
  } catch {
    /* fall through to migration */
  }
  return migrateLegacyChat();
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

function saveThreadsState(state: ThreadsState): void {
  try {
    localStorage.setItem(CHAT_THREADS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota exceeded */
  }
}

// Navigation views
export type NavView =
  | 'tax-year'
  | 'business-docs'
  | 'all-files'
  | 'chat'
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
  | 'gold'
  | 'property'
  | 'income'
  | 'debts'
  | 'quant'
  | 'strategy'
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
  | 'health-analysis';

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

  // Reminders
  reminders: Reminder[];
  addReminder: (
    reminder: Omit<Reminder, 'id' | 'createdAt' | 'updatedAt' | 'status'>
  ) => Promise<Reminder | null>;
  updateReminder: (id: string, updates: Partial<Reminder>) => Promise<Reminder | null>;
  deleteReminder: (id: string) => Promise<boolean>;

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
  /** Switch the active thread. */
  switchChatThread: (id: string) => void;
  /** Delete a thread; if it was active, falls back to the next-most-recent. */
  deleteChatThread: (id: string) => void;
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
  const validViews = new Set<string>([
    'tax-year',
    'business-docs',
    'all-files',
    'chat',
    'settings',
    'tn-tax',
    'crypto',
    'brokers',
    'banks',
    'portfolio',
    'sales',
    'mileage',
    'gold',
    'solo-401k',
    'estimated-tax',
    'federal-tax',
    'property',
    'income',
    'debts',
    'quant',
    'strategy',
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
  ]);

  const viewFromHash = (): NavView | null => {
    const hash = window.location.hash.replace('#', '');
    return validViews.has(hash) ? (hash as NavView) : null;
  };

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
  const [chatThreads, setChatThreads] = useState<ThreadsState>(() => loadThreadsState());
  useEffect(() => {
    saveThreadsState(chatThreads);
  }, [chatThreads]);

  const updateActiveChatThread = useCallback(
    (updater: (t: PersistedThread) => Partial<PersistedThread>) => {
      setChatThreads((prev) => {
        if (!prev.activeThreadId) return prev;
        const current = prev.threads[prev.activeThreadId];
        if (!current) return prev;
        return {
          ...prev,
          threads: {
            ...prev.threads,
            [prev.activeThreadId]: {
              ...current,
              ...updater(current),
              updatedAt: new Date().toISOString(),
            },
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
        },
      },
    }));
    return id;
  }, []);

  const switchChatThread = useCallback((id: string) => {
    setChatThreads((prev) => (prev.threads[id] ? { ...prev, activeThreadId: id } : prev));
  }, []);

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
  }, []);

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
  }, []);

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
    const saved = localStorage.getItem('docvault-year');
    return saved ? parseInt(saved, 10) : currentYear;
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

  const setSearchQuery = useCallback((query: string) => {
    setSearchQueryState(query);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setSearchResults(data.files || []);
      } catch {
        setSearchResults([]);
      }
      setIsSearching(false);
    }, 250);
  }, []);

  const clearSearch = useCallback(() => {
    setSearchQueryState('');
    setSearchResults([]);
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
    reminders,
    addReminder,
    updateReminder,
    deleteReminder,
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

  // Persist year selection
  const setSelectedYear = useCallback((year: number) => {
    setSelectedYearState(year);
    localStorage.setItem('docvault-year', String(year));
  }, []);

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

    // Reminders
    reminders,
    addReminder,
    updateReminder,
    deleteReminder,

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
