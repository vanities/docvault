import { useState, useCallback, useEffect } from 'react';
import type { TaxDocument, DocumentType, Entity, ExpenseCategory } from '../types';

const API_BASE = 'http://localhost:3005/api';

// Entity config from server
export interface EntityConfig {
  id: string;
  name: string;
  color: string;
  path: string;
}

// File info from the server
export interface FileInfo {
  name: string;
  path: string;
  size: number;
  lastModified: number;
  type: string;
  isDirectory: boolean;
}

// Detect document type from filename
function detectDocumentType(filename: string): DocumentType {
  const lower = filename.toLowerCase();

  if (/w-?2/i.test(lower)) return 'w2';
  if (/1099-?nec/i.test(lower)) return '1099-nec';
  if (/1099-?misc/i.test(lower)) return '1099-misc';
  if (/1099-?r/i.test(lower)) return '1099-r';
  if (/1099-?div/i.test(lower)) return '1099-div';
  if (/1099-?int/i.test(lower)) return '1099-int';
  if (/1099-?b/i.test(lower)) return '1099-b';
  if (/1099/i.test(lower)) return '1099-nec';
  if (/receipt|expense|purchase/i.test(lower)) return 'receipt';
  if (/invoice/i.test(lower)) return 'invoice';
  if (/koinly|coinbase|kraken|crypto|8949/i.test(lower)) return 'crypto';
  if (/\.tax\d{4}$|return|final/i.test(lower)) return 'return';
  if (/contract|agreement|w-?9|nda/i.test(lower)) return 'contract';

  return 'other';
}

// Detect expense category from path/filename
function detectExpenseCategory(path: string): ExpenseCategory | undefined {
  const lower = path.toLowerCase();

  if (lower.includes('childcare')) return 'childcare';
  if (lower.includes('medical')) return 'medical';
  if (lower.includes('meal') || lower.includes('food') || lower.includes('restaurant'))
    return 'meals';
  if (lower.includes('software') || lower.includes('subscription')) return 'software';
  if (lower.includes('equipment') || lower.includes('hardware')) return 'equipment';
  if (lower.includes('travel') || lower.includes('flight') || lower.includes('hotel'))
    return 'travel';

  return undefined;
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
    const connect = async () => {
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
    };
    connect();
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
          .map((file: FileInfo & { parsedData?: Record<string, unknown> }) => {
            const docType = detectDocumentType(file.name);
            const expenseCategory = detectExpenseCategory(file.path);

            const doc: TaxDocument = {
              id: `${entity}/${file.path}-${file.lastModified}`,
              fileName: file.name,
              fileType: file.type,
              fileSize: file.size,
              filePath: file.path,
              type: docType,
              entity,
              taxYear,
              tags: [],
              createdAt: new Date(file.lastModified).toISOString(),
              updatedAt: new Date(file.lastModified).toISOString(),
              parsedData: file.parsedData as TaxDocument['parsedData'],
            };

            // Add parsed data for receipts with detected category if not already parsed
            if (!doc.parsedData && docType === 'receipt' && expenseCategory) {
              doc.parsedData = {
                vendor: '',
                amount: 0,
                date: new Date(file.lastModified).toISOString().split('T')[0],
                category: expenseCategory,
              };
            }

            return doc;
          });

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
          const entitiesToScan = entities.map((e) => e.id as Entity);
          const results = await Promise.all(
            entitiesToScan.map((e) => scanSingleEntity(e, taxYear))
          );
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

  // Import a file to the correct folder
  const importFile = useCallback(
    async (
      file: File,
      docType: DocumentType,
      entity: Entity,
      taxYear: number,
      expenseCategory?: ExpenseCategory
    ): Promise<boolean> => {
      if (!isConnected) return false;

      try {
        // Determine destination path based on document type
        let destPath = `${taxYear}`;

        if (docType === 'w2') {
          destPath += '/income/w2';
        } else if (docType.startsWith('1099')) {
          destPath += '/income/1099';
        } else if (docType === 'receipt' && expenseCategory) {
          const folderMap: Record<ExpenseCategory, string> = {
            childcare: 'expenses/childcare',
            medical: 'expenses/medical',
            meals: 'expenses/business',
            software: 'expenses/business',
            equipment: 'expenses/business',
            'office-supplies': 'expenses/business',
            'professional-services': 'expenses/business',
            travel: 'expenses/business',
            utilities: 'expenses/business',
            insurance: 'expenses/business',
            education: 'expenses/business',
            other: 'expenses/business',
          };
          destPath += '/' + folderMap[expenseCategory];
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

        // Upload file with entity
        const arrayBuffer = await file.arrayBuffer();
        const response = await fetch(
          `${API_BASE}/upload?entity=${encodeURIComponent(entity)}&path=${encodeURIComponent(destPath)}&filename=${encodeURIComponent(file.name)}`,
          {
            method: 'POST',
            body: arrayBuffer,
            headers: {
              'Content-Type': file.type || 'application/octet-stream',
            },
          }
        );

        const data = await response.json();
        return data.ok === true;
      } catch (err) {
        console.error('Import file error:', err);
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
      year: number
    ): Promise<{ parsed: number; failed: number; total: number } | null> => {
      if (!isConnected) return null;

      try {
        const url = `${API_BASE}/parse-all/${entity}/${year}`;
        const response = await fetch(url, {
          method: 'POST',
        });
        const data = await response.json();
        return { parsed: data.parsed, failed: data.failed, total: data.total };
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

  return {
    isConnected,
    dataDir,
    isScanning,
    error,
    entities,
    checkConnection,
    getYearsForEntity,
    scanTaxYear,
    importFile,
    openFile,
    deleteFile,
    createYearStructure,
    parseFile,
    parseAllFiles,
    addEntity,
    removeEntity,
    moveFile,
  };
}
