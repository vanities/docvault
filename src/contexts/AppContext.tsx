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

// Navigation views
export type NavView =
  | 'tax-year'
  | 'business-docs'
  | 'all-files'
  | 'settings'
  | 'tn-tax'
  | 'crypto'
  | 'brokers'
  | 'banks'
  | 'portfolio'
  | 'sales'
  | 'mileage';

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

  // View state with localStorage persistence
  const [activeView, setActiveViewState] = useState<NavView>(() => {
    const saved = localStorage.getItem('docvault-view');
    return (saved as NavView) || 'tax-year';
  });
  const [activeTab, setActiveTab] = useState<TabType>('documents');

  // Mobile sidebar state (declared before callbacks that reference it)
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const setActiveView = useCallback((view: NavView) => {
    setActiveViewState(view);
    localStorage.setItem('docvault-view', view);
    setSidebarOpen(false);
  }, []);

  // Entity state with localStorage persistence
  const [selectedEntity, setSelectedEntityState] = useState<Entity>(() => {
    const saved = localStorage.getItem('docvault-entity');
    return (saved as Entity) || 'personal';
  });

  // Year state with localStorage persistence
  const [selectedYear, setSelectedYearState] = useState(() => {
    const saved = localStorage.getItem('docvault-year');
    return saved ? parseInt(saved, 10) : currentYear;
  });

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

    // Tab
    activeTab,
    setActiveTab,

    // Year
    selectedYear,
    setSelectedYear,
    availableYears,

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
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
