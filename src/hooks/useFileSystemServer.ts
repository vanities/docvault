import { useState, useCallback, useEffect } from 'react';
import type { TaxDocument, DocumentType, Entity, ExpenseCategory, Reminder, Todo } from '../types';
import { isBusinessDocumentType, getBusinessSubfolder, EXPENSE_FOLDER_MAP } from '../config';
import { API_BASE } from '../constants';
import { mapFileToDocument } from '../utils/mapFileToDocument';

// Entity config from server
export interface EntityConfig {
  id: string;
  name: string;
  color: string;
  path: string;
  icon?: string;
  type?: 'tax' | 'docs';
  description?: string;
}

// File info from the server
export interface FileInfo {
  name: string;
  path: string;
  size: number;
  lastModified: number;
  type: string;
  isDirectory: boolean;
  tags?: string[];
  notes?: string;
}

export function useFileSystemServer() {
  const [isConnected, setIsConnected] = useState(false);
  const [dataDir, setDataDir] = useState<string>('');
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entities, setEntities] = useState<EntityConfig[]>([]);

  const checkConnection = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/status`);
      const data = await response.json();
      setIsConnected(data.ok);
      setDataDir(data.dataDir || '');
      setEntities(data.entities || []);
      if (!data.ok) {
        setError(data.error || 'Server not available');
      } else {
        setError(null);
      }
    } catch {
      setIsConnected(false);
      setError('Cannot connect to server. Make sure the API server is running.');
    }
  }, []);

  // Check server connection on mount
  useEffect(() => {
    (async () => {
      try {
        const response = await fetch(`${API_BASE}/status`);
        const data = await response.json();
        setIsConnected(data.ok);
        setDataDir(data.dataDir || '');
        setEntities(data.entities || []);
        if (!data.ok) {
          setError(data.error || 'Server not available');
        } else {
          setError(null);
        }
      } catch {
        setIsConnected(false);
        setError('Cannot connect to server. Make sure the API server is running.');
      }
    })();
  }, []);

  // Get available years for an entity (or all entities combined)
  const getYearsForEntity = useCallback(
    async (entity: Entity): Promise<number[]> => {
      if (!isConnected) return [];

      try {
        if (entity === 'all') {
          // Get years from all entities and combine unique values
          const allYears = new Set<number>();
          for (const e of entities) {
            const response = await fetch(`${API_BASE}/years/${e.id}`);
            const data = await response.json();
            const years =
              data.years?.map((y: string) => parseInt(y.match(/\d{4}/)?.[0] || '0', 10)) || [];
            years.forEach((y: number) => allYears.add(y));
          }
          return Array.from(allYears).sort((a, b) => b - a);
        }

        const response = await fetch(`${API_BASE}/years/${entity}`);
        const data = await response.json();
        return data.years?.map((y: string) => parseInt(y.match(/\d{4}/)?.[0] || '0', 10)) || [];
      } catch {
        return [];
      }
    },
    [isConnected, entities]
  );

  // Scan a single entity for files in a tax year
  const scanSingleEntity = useCallback(
    async (entity: Entity, taxYear: number): Promise<TaxDocument[]> => {
      try {
        // First get available years to find the right folder name
        const yearsResponse = await fetch(`${API_BASE}/years/${entity}`);
        const yearsData = await yearsResponse.json();

        // Find the folder that matches this year (could be "2024" or "2024 taxes" etc)
        const yearFolder =
          yearsData.years?.find((y: string) => y.startsWith(String(taxYear))) || String(taxYear);

        // Use entity-based API endpoint
        const response = await fetch(
          `${API_BASE}/files/${entity}/${encodeURIComponent(yearFolder)}`
        );
        const data = await response.json();

        if (!data.files) {
          return [];
        }

        // Convert to TaxDocuments
        const documents: TaxDocument[] = data.files
          .filter((f: FileInfo) => !f.name.startsWith('.'))
          .map((file: FileInfo & { parsedData?: Record<string, unknown> }) =>
            mapFileToDocument(file, entity, taxYear)
          );

        return documents;
      } catch (err) {
        console.error(`Scan error for ${entity}:`, err);
        return [];
      }
    },
    []
  );

  // Scan for files in a specific tax year for an entity (or all entities)
  const scanTaxYear = useCallback(
    async (entity: Entity, taxYear: number): Promise<TaxDocument[]> => {
      if (!isConnected) {
        setError('Server not connected');
        return [];
      }

      setIsScanning(true);
      setError(null);

      try {
        let documents: TaxDocument[] = [];

        if (entity === 'all') {
          // Scan all entities in parallel
          const results = await Promise.all(entities.map((e) => scanSingleEntity(e.id, taxYear)));
          documents = results.flat();
        } else {
          documents = await scanSingleEntity(entity, taxYear);
        }

        setIsScanning(false);
        return documents;
      } catch (err) {
        setError('Failed to scan directory');
        console.error('Scan error:', err);
        setIsScanning(false);
        return [];
      }
    },
    [isConnected, entities, scanSingleEntity]
  );

  // Scan business documents for an entity (not tied to tax year)
  const scanBusinessDocs = useCallback(
    async (entity: Entity): Promise<TaxDocument[]> => {
      if (!isConnected) {
        return [];
      }

      try {
        if (entity === 'all') {
          // Scan all entities in parallel
          const results = await Promise.all(
            entities.map(async (ent) => {
              const response = await fetch(`${API_BASE}/business-docs/${ent.id}`);
              const data = await response.json();
              if (!data.files) return [];

              return data.files
                .filter((f: FileInfo) => !f.name.startsWith('.'))
                .map((file: FileInfo & { parsedData?: Record<string, unknown> }) =>
                  mapFileToDocument(file, ent.id, 0)
                );
            })
          );
          return results.flat();
        }

        const response = await fetch(`${API_BASE}/business-docs/${entity}`);
        const data = await response.json();

        if (!data.files) {
          return [];
        }

        const documents: TaxDocument[] = data.files
          .filter((f: FileInfo) => !f.name.startsWith('.'))
          .map((file: FileInfo & { parsedData?: Record<string, unknown> }) =>
            mapFileToDocument(file, entity, 0)
          );

        return documents;
      } catch (err) {
        console.error(`Business docs scan error for ${entity}:`, err);
        return [];
      }
    },
    [isConnected, entities]
  );

  // Scan all files recursively for an entity (for non-tax entities)
  const scanAllFiles = useCallback(
    async (entity: Entity): Promise<TaxDocument[]> => {
      if (!isConnected) {
        return [];
      }

      try {
        if (entity === 'all') {
          // Scan all entities in parallel
          const results = await Promise.all(
            entities.map(async (ent) => {
              const response = await fetch(`${API_BASE}/files-all/${ent.id}`);
              const data = await response.json();
              if (!data.files) return [];

              return data.files
                .filter((f: FileInfo) => !f.name.startsWith('.'))
                .map((file: FileInfo & { parsedData?: Record<string, unknown> }) =>
                  mapFileToDocument(file, ent.id, 0)
                );
            })
          );
          return results.flat();
        }

        const response = await fetch(`${API_BASE}/files-all/${entity}`);
        const data = await response.json();

        if (!data.files) {
          return [];
        }

        const documents: TaxDocument[] = data.files
          .filter((f: FileInfo) => !f.name.startsWith('.'))
          .map((file: FileInfo & { parsedData?: Record<string, unknown> }) =>
            mapFileToDocument(file, entity, 0)
          );

        return documents;
      } catch (err) {
        console.error(`All files scan error for ${entity}:`, err);
        return [];
      }
    },
    [isConnected, entities]
  );

  // Import a file to the correct folder
  const importFile = useCallback(
    async (
      file: File,
      docType: DocumentType,
      entity: Entity,
      taxYear: number,
      expenseCategory?: ExpenseCategory,
      customFilename?: string,
      parsedData?: Record<string, unknown>
    ): Promise<boolean> => {
      if (!isConnected) return false;

      try {
        // Determine destination path based on document type
        let destPath: string;

        // Check if this is a business document (not tied to tax year)
        if (isBusinessDocumentType(docType)) {
          const subfolder = getBusinessSubfolder(docType);
          destPath = `business-docs/${subfolder}`;
        } else {
          // Regular tax year document
          destPath = `${taxYear}`;

          if (docType === 'w2') {
            destPath += '/income/w2';
          } else if (docType.startsWith('1099')) {
            destPath += '/income/1099';
          } else if (docType === 'receipt' && expenseCategory) {
            destPath += '/' + EXPENSE_FOLDER_MAP[expenseCategory];
          } else if (docType === 'crypto') {
            destPath += '/crypto';
          } else if (docType === 'return') {
            if (file.name.includes('.tax')) {
              destPath += '/turbotax';
            } else {
              destPath += '/returns';
            }
          } else {
            destPath += '/income/other';
          }
        }

        // Use custom filename if provided, otherwise use original filename
        const filename = customFilename || file.name;

        // Upload file with entity
        const arrayBuffer = await file.arrayBuffer();
        const response = await fetch(
          `${API_BASE}/upload?entity=${encodeURIComponent(entity)}&path=${encodeURIComponent(destPath)}&filename=${encodeURIComponent(filename)}`,
          {
            method: 'POST',
            body: arrayBuffer,
            headers: {
              'Content-Type': file.type || 'application/octet-stream',
            },
          }
        );

        const data = await response.json();
        if (!data.ok) return false;

        // Save parsed data separately if provided
        if (parsedData) {
          try {
            await fetch(`${API_BASE}/save-parsed`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                entity,
                filePath: `${destPath}/${filename}`,
                parsedData,
              }),
            });
          } catch (err) {
            console.error('Save parsed data error:', err);
          }
        }

        return true;
      } catch (err) {
        console.error('Import file error:', err);
        return false;
      }
    },
    [isConnected]
  );

  // Compute destination path for a document type (same logic as importFile routing)
  const getDestPath = (
    docType: DocumentType,
    taxYear: number,
    fileName: string,
    expenseCategory?: ExpenseCategory
  ): string => {
    if (isBusinessDocumentType(docType)) {
      const subfolder = getBusinessSubfolder(docType);
      return `business-docs/${subfolder}/${fileName}`;
    }

    let destPath = `${taxYear}`;

    if (docType === 'w2') {
      destPath += '/income/w2';
    } else if (docType.startsWith('1099')) {
      destPath += '/income/1099';
    } else if (docType === 'receipt' && expenseCategory) {
      destPath += '/' + EXPENSE_FOLDER_MAP[expenseCategory];
    } else if (docType === 'crypto') {
      destPath += '/crypto';
    } else if (docType === 'return') {
      destPath += '/returns';
    } else if (docType === 'medical-record') {
      destPath += '/expenses/medical';
    } else {
      destPath += '/income/other';
    }

    return `${destPath}/${fileName}`;
  };

  // Relocate a file when type, entity, or year changes
  const relocateFile = useCallback(
    async (
      fromEntity: Entity,
      fromPath: string,
      toEntity: Entity,
      toYear: number,
      newDocType: DocumentType,
      expenseCategory?: ExpenseCategory
    ): Promise<boolean> => {
      if (!isConnected) return false;

      try {
        const fileName = fromPath.split('/').pop() || '';
        const toPath = getDestPath(newDocType, toYear, fileName, expenseCategory);

        // Skip if source and destination are the same
        if (fromEntity === toEntity && fromPath === toPath) return true;

        const response = await fetch(`${API_BASE}/move-between`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fromEntity,
            fromPath,
            toEntity,
            toPath,
          }),
        });
        const data = await response.json();
        return data.ok === true;
      } catch (err) {
        console.error('Relocate file error:', err);
        return false;
      }
    },
    [isConnected]
  );

  // Open a file for viewing
  const openFile = useCallback(
    async (entity: Entity, filePath: string): Promise<void> => {
      if (!isConnected) return;

      try {
        const url = `${API_BASE}/file/${entity}/${encodeURIComponent(filePath)}`;
        window.open(url, '_blank');
      } catch (err) {
        console.error('Open file error:', err);
      }
    },
    [isConnected]
  );

  // Delete a file
  const deleteFile = useCallback(
    async (entity: Entity, filePath: string): Promise<boolean> => {
      if (!isConnected) return false;

      try {
        const response = await fetch(`${API_BASE}/file/${entity}/${encodeURIComponent(filePath)}`, {
          method: 'DELETE',
        });
        const data = await response.json();
        return data.ok === true;
      } catch (err) {
        console.error('Delete file error:', err);
        return false;
      }
    },
    [isConnected]
  );

  // Create year folder structure
  const createYearStructure = useCallback(
    async (entity: Entity, year: number): Promise<boolean> => {
      if (!isConnected) return false;

      const folders = [
        `${year}/income/w2`,
        `${year}/income/1099`,
        `${year}/income/other`,
        `${year}/expenses/business`,
        `${year}/expenses/childcare`,
        `${year}/expenses/medical`,
        `${year}/crypto`,
        `${year}/returns`,
        `${year}/turbotax`,
      ];

      try {
        for (const folder of folders) {
          await fetch(`${API_BASE}/mkdir`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entity, path: folder }),
          });
        }
        return true;
      } catch (err) {
        console.error('Create year structure error:', err);
        return false;
      }
    },
    [isConnected]
  );

  // Parse a single file using Claude Vision AI
  const parseFile = useCallback(
    async (entity: Entity, filePath: string): Promise<Record<string, unknown> | null> => {
      if (!isConnected) return null;

      try {
        const url = `${API_BASE}/parse/${entity}/${encodeURIComponent(filePath)}`;
        const response = await fetch(url, {
          method: 'POST',
        });
        const data = await response.json();
        return data.parsedData || null;
      } catch (err) {
        console.error('Parse file error:', err);
        return null;
      }
    },
    [isConnected]
  );

  // Parse all files in a year using Claude Vision AI
  const parseAllFiles = useCallback(
    async (
      entity: Entity,
      year: number,
      options?: {
        filter?: string[];
        unparsedOnly?: boolean;
        onProgress?: (progress: { current: number; total: number; fileName: string }) => void;
      }
    ): Promise<{ parsed: number; failed: number; total: number } | null> => {
      if (!isConnected) return null;

      try {
        const params = new URLSearchParams();
        if (options?.filter?.length) params.set('filter', options.filter.join(','));
        if (options?.unparsedOnly) params.set('unparsed', 'true');
        const qs = params.toString();
        const url = `${API_BASE}/parse-all/${entity}/${year}${qs ? `?${qs}` : ''}`;
        const response = await fetch(url, { method: 'POST' });

        if (!response.body) {
          const data = await response.json();
          return { parsed: data.parsed, failed: data.failed, total: data.total };
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let result: { parsed: number; failed: number; total: number } | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop()!;

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const data = JSON.parse(line);
              if (data.type === 'progress' && options?.onProgress) {
                options.onProgress({
                  current: data.current,
                  total: data.total,
                  fileName: data.fileName,
                });
              } else if (data.type === 'done') {
                result = { parsed: data.parsed, failed: data.failed, total: data.total };
              }
            } catch {
              // skip malformed lines
            }
          }
        }

        return result;
      } catch (err) {
        console.error('Parse all files error:', err);
        return null;
      }
    },
    [isConnected]
  );

  // Add a new entity
  const addEntity = useCallback(
    async (id: string, name: string, color: string): Promise<EntityConfig | null> => {
      if (!isConnected) return null;

      try {
        const response = await fetch(`${API_BASE}/entities`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, name, color }),
        });
        const data = await response.json();
        if (data.ok && data.entity) {
          setEntities((prev) => [...prev, data.entity]);
          return data.entity;
        }
        return null;
      } catch (err) {
        console.error('Add entity error:', err);
        return null;
      }
    },
    [isConnected]
  );

  // Remove an entity
  const removeEntity = useCallback(
    async (id: string): Promise<boolean> => {
      if (!isConnected) return false;

      try {
        const response = await fetch(`${API_BASE}/entities/${id}`, {
          method: 'DELETE',
        });
        const data = await response.json();
        if (data.ok) {
          setEntities((prev) => prev.filter((e) => e.id !== id));
          return true;
        }
        return false;
      } catch (err) {
        console.error('Remove entity error:', err);
        return false;
      }
    },
    [isConnected]
  );

  // Update an entity
  const updateEntity = useCallback(
    async (
      id: string,
      updates: { name?: string; color?: string; icon?: string; description?: string }
    ): Promise<EntityConfig | null> => {
      if (!isConnected) return null;

      try {
        const response = await fetch(`${API_BASE}/entities/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        });
        const data = await response.json();
        if (data.ok && data.entity) {
          setEntities((prev) => prev.map((e) => (e.id === id ? data.entity : e)));
          return data.entity;
        }
        return null;
      } catch (err) {
        console.error('Update entity error:', err);
        return null;
      }
    },
    [isConnected]
  );

  // Move a file to a different entity/year
  const moveFile = useCallback(
    async (
      fromEntity: Entity,
      fromPath: string,
      toEntity: Entity,
      toYear: number
    ): Promise<boolean> => {
      if (!isConnected) return false;

      try {
        // Build destination path with same document type folder structure
        const pathParts = fromPath.split('/');
        // Keep subdirectory structure after year (e.g., income/w2)
        const subPath = pathParts.slice(1).join('/'); // Remove year, keep rest
        const toPath = `${toYear}/${subPath}`;

        const response = await fetch(`${API_BASE}/move-between`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fromEntity,
            fromPath,
            toEntity,
            toPath,
          }),
        });
        const data = await response.json();
        return data.ok === true;
      } catch (err) {
        console.error('Move file error:', err);
        return false;
      }
    },
    [isConnected]
  );

  // Reminder operations
  const [reminders, setReminders] = useState<Reminder[]>([]);

  // Fetch reminders on connect
  useEffect(() => {
    if (!isConnected) return;
    fetch(`${API_BASE}/reminders`)
      .then((r) => r.json())
      .then((data) => setReminders(data.reminders || []))
      .catch(() => {});
  }, [isConnected]);

  const addReminder = useCallback(
    async (
      reminder: Omit<Reminder, 'id' | 'createdAt' | 'updatedAt' | 'status'>
    ): Promise<Reminder | null> => {
      if (!isConnected) return null;
      try {
        const response = await fetch(`${API_BASE}/reminders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reminder),
        });
        const data = await response.json();
        if (data.ok && data.reminder) {
          setReminders((prev) => [...prev, data.reminder]);
          return data.reminder;
        }
        return null;
      } catch {
        return null;
      }
    },
    [isConnected]
  );

  const updateReminder = useCallback(
    async (id: string, updates: Partial<Reminder>): Promise<Reminder | null> => {
      if (!isConnected) return null;
      try {
        const response = await fetch(`${API_BASE}/reminders/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        });
        const data = await response.json();
        if (data.ok) {
          // Refetch all reminders to pick up any new recurring ones
          const refetch = await fetch(`${API_BASE}/reminders`);
          const refetchData = await refetch.json();
          setReminders(refetchData.reminders || []);
          return data.reminder;
        }
        return null;
      } catch {
        return null;
      }
    },
    [isConnected]
  );

  const deleteReminder = useCallback(
    async (id: string): Promise<boolean> => {
      if (!isConnected) return false;
      try {
        const response = await fetch(`${API_BASE}/reminders/${id}`, { method: 'DELETE' });
        const data = await response.json();
        if (data.ok) {
          setReminders((prev) => prev.filter((r) => r.id !== id));
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [isConnected]
  );

  // Todo operations
  const [todos, setTodos] = useState<Todo[]>([]);

  // Fetch todos on connect
  useEffect(() => {
    if (!isConnected) return;
    fetch(`${API_BASE}/todos`)
      .then((r) => r.json())
      .then((data) => setTodos(data.todos || []))
      .catch(() => {});
  }, [isConnected]);

  const addTodo = useCallback(
    async (title: string): Promise<Todo | null> => {
      if (!isConnected) return null;
      try {
        const response = await fetch(`${API_BASE}/todos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title }),
        });
        const data = await response.json();
        if (data.ok && data.todo) {
          setTodos((prev) => [...prev, data.todo]);
          return data.todo;
        }
        return null;
      } catch {
        return null;
      }
    },
    [isConnected]
  );

  const updateTodo = useCallback(
    async (id: string, updates: Partial<Todo>): Promise<Todo | null> => {
      if (!isConnected) return null;
      try {
        const response = await fetch(`${API_BASE}/todos/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        });
        const data = await response.json();
        if (data.ok && data.todo) {
          setTodos((prev) => prev.map((t) => (t.id === id ? data.todo : t)));
          return data.todo;
        }
        return null;
      } catch {
        return null;
      }
    },
    [isConnected]
  );

  const deleteTodo = useCallback(
    async (id: string): Promise<boolean> => {
      if (!isConnected) return false;
      try {
        const response = await fetch(`${API_BASE}/todos/${id}`, { method: 'DELETE' });
        const data = await response.json();
        if (data.ok) {
          setTodos((prev) => prev.filter((t) => t.id !== id));
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [isConnected]
  );

  // Rename a file in place (same directory, new filename)
  const renameFile = useCallback(
    async (entity: Entity, filePath: string, newFilename: string): Promise<string | null> => {
      if (!isConnected) return null;

      try {
        const response = await fetch(`${API_BASE}/rename`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entity, filePath, newFilename }),
        });
        const data = await response.json();
        if (data.ok) return data.newPath;
        console.error('Rename error:', data.error);
        return null;
      } catch (err) {
        console.error('Rename file error:', err);
        return null;
      }
    },
    [isConnected]
  );

  // Update document metadata (tags, notes) - persists to server
  const updateDocMetadata = useCallback(
    async (
      entity: string,
      filePath: string,
      updates: { tags?: string[]; notes?: string }
    ): Promise<boolean> => {
      if (!isConnected) return false;
      try {
        const response = await fetch(`${API_BASE}/metadata`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entity, filePath, ...updates }),
        });
        const data = await response.json();
        return data.ok === true;
      } catch {
        return false;
      }
    },
    [isConnected]
  );

  return {
    isConnected,
    dataDir,
    isScanning,
    error,
    entities,
    reminders,
    checkConnection,
    getYearsForEntity,
    scanTaxYear,
    scanBusinessDocs,
    scanAllFiles,
    importFile,
    openFile,
    deleteFile,
    createYearStructure,
    parseFile,
    parseAllFiles,
    addEntity,
    removeEntity,
    updateEntity,
    moveFile,
    relocateFile,
    renameFile,
    addReminder,
    updateReminder,
    deleteReminder,
    todos,
    addTodo,
    updateTodo,
    deleteTodo,
    updateDocMetadata,
  };
}
