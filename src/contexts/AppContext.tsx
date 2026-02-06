/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useCallback,
  type ReactNode,
} from 'react';
import { useFileSystemServer, type EntityConfig } from '../hooks/useFileSystemServer';
import type { Entity, TaxDocument, DocumentType, ExpenseCategory } from '../types';

// Navigation views
export type NavView = 'tax-year' | 'business-docs' | 'settings';

// Tab types for tax year view
export type TabType = 'documents' | 'income' | 'expenses';

interface AppContextValue {
  // Connection state
  isConnected: boolean;
  dataDir: string;
  checkConnection: () => Promise<void>;
  fsError: string | null;

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

  // File system hook functions
  scanTaxYear: (entity: Entity, year: number) => Promise<TaxDocument[]>;
  scanBusinessDocs: (entity: Entity) => Promise<TaxDocument[]>;
  importFile: (
    file: File,
    docType: DocumentType,
    entity: Entity,
    taxYear: number,
    expenseCategory?: ExpenseCategory,
    customFilename?: string
  ) => Promise<boolean>;
  openFile: (entity: Entity, filePath: string) => Promise<void>;
  deleteFile: (entity: Entity, filePath: string) => Promise<boolean>;
  parseFile: (entity: Entity, filePath: string) => Promise<Record<string, unknown> | null>;
  parseAllFiles: (
    entity: Entity,
    year: number
  ) => Promise<{ parsed: number; failed: number; total: number } | null>;
  addEntity: (id: string, name: string, color: string) => Promise<EntityConfig | null>;
  removeEntity: (id: string) => Promise<boolean>;
  updateEntity: (
    id: string,
    updates: { name?: string; color?: string; icon?: string }
  ) => Promise<EntityConfig | null>;
  moveFile: (
    fromEntity: Entity,
    fromPath: string,
    toEntity: Entity,
    toYear: number
  ) => Promise<boolean>;
  getYearsForEntity: (entity: Entity) => Promise<number[]>;
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

  // View state
  const [activeView, setActiveView] = useState<NavView>('tax-year');
  const [activeTab, setActiveTab] = useState<TabType>('documents');

  // Entity state with localStorage persistence
  const [selectedEntity, setSelectedEntityState] = useState<Entity>(() => {
    const saved = localStorage.getItem('taxvault-entity');
    return (saved as Entity) || 'personal';
  });

  // Year state with localStorage persistence
  const [selectedYear, setSelectedYearState] = useState(() => {
    const saved = localStorage.getItem('taxvault-year');
    return saved ? parseInt(saved, 10) : currentYear;
  });

  // Document state
  const [scannedDocuments, setScannedDocuments] = useState<TaxDocument[]>([]);
  const [entityYears, setEntityYears] = useState<number[]>([]);
  const [isParsing, setIsParsing] = useState(false);

  // File system hook
  const {
    isConnected,
    dataDir,
    isScanning,
    error: fsError,
    entities,
    checkConnection,
    getYearsForEntity,
    scanTaxYear,
    scanBusinessDocs,
    importFile,
    openFile,
    deleteFile,
    parseFile,
    parseAllFiles,
    addEntity,
    removeEntity,
    updateEntity,
    moveFile,
  } = useFileSystemServer();

  // Global processing state
  const isProcessing = isScanning || isParsing;

  // Persist entity selection
  const setSelectedEntity = useCallback((entity: Entity) => {
    setSelectedEntityState(entity);
    localStorage.setItem('taxvault-entity', entity);
  }, []);

  // Persist year selection
  const setSelectedYear = useCallback((year: number) => {
    setSelectedYearState(year);
    localStorage.setItem('taxvault-year', String(year));
  }, []);

  // Fetch available years when entity changes
  useEffect(() => {
    if (isConnected) {
      getYearsForEntity(selectedEntity).then(setEntityYears);
    }
  }, [isConnected, selectedEntity, getYearsForEntity]);

  // Scan files when entity or year changes (only for tax-year view)
  useEffect(() => {
    if (isConnected && activeView === 'tax-year') {
      scanTaxYear(selectedEntity, selectedYear).then(setScannedDocuments);
    }
  }, [isConnected, selectedEntity, selectedYear, scanTaxYear, activeView]);

  // Available years (from server or default)
  const availableYears = useMemo(() => {
    if (entityYears.length > 0) return entityYears;
    return Array.from({ length: 6 }, (_, i) => currentYear - i);
  }, [entityYears, currentYear]);

  const value: AppContextValue = {
    // Connection
    isConnected,
    dataDir,
    checkConnection,
    fsError,

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

    // File operations
    scanTaxYear,
    scanBusinessDocs,
    importFile,
    openFile,
    deleteFile,
    parseFile,
    parseAllFiles,
    addEntity,
    removeEntity,
    updateEntity,
    moveFile,
    getYearsForEntity,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
