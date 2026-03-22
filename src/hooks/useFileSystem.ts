import { useState, useCallback } from 'react';
import type { TaxDocument, DocumentType, Entity, ExpenseCategory } from '../types';

// File info from the file system
export interface FileInfo {
  name: string;
  path: string;
  size: number;
  lastModified: number;
  type: string; // MIME type
  handle?: FileSystemFileHandle;
}

// Directory handle storage
interface DirectoryState {
  handle: FileSystemDirectoryHandle | null;
  path: string;
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

// Get MIME type from file extension
function getMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    csv: 'text/csv',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    txf: 'text/plain',
    tax2024: 'application/octet-stream',
    tax2025: 'application/octet-stream',
  };
  return mimeTypes[ext || ''] || 'application/octet-stream';
}

export function useFileSystem() {
  const [rootDirectory, setRootDirectory] = useState<DirectoryState>({
    handle: null,
    path: '',
  });
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if File System Access API is available
  const isFileSystemSupported = useCallback(() => {
    return 'showDirectoryPicker' in window;
  }, []);

  // Request access to a directory
  const requestDirectoryAccess = useCallback(async (): Promise<boolean> => {
    if (!isFileSystemSupported()) {
      setError('File System Access API not supported. Please use Chrome, Edge, or Brave browser.');
      return false;
    }

    try {
      // @ts-expect-error - showDirectoryPicker is not in all TS libs yet
      const handle = await window.showDirectoryPicker({
        id: 'docvault-root',
        mode: 'readwrite',
        startIn: 'documents',
      });
      setRootDirectory({ handle, path: handle.name });
      setError(null);
      return true;
    } catch (err) {
      const error = err as Error;
      if (error.name === 'AbortError') {
        // User cancelled - not an error
        return false;
      } else if (error.name === 'SecurityError') {
        setError(
          'Security error: Make sure you are running on localhost or HTTPS, and try a different browser.'
        );
      } else if (error.name === 'NotAllowedError') {
        setError(
          'Permission denied. Please allow folder access when prompted, or check browser settings.'
        );
      } else {
        setError(`Failed to access directory: ${error.message}`);
      }
      console.error('Directory access error:', err);
      return false;
    }
  }, [isFileSystemSupported]);

  // Recursively scan a directory for files
  const scanDirectory = useCallback(
    async (dirHandle: FileSystemDirectoryHandle, basePath: string = ''): Promise<FileInfo[]> => {
      const files: FileInfo[] = [];

      for await (const entry of dirHandle.values()) {
        const entryPath = basePath ? `${basePath}/${entry.name}` : entry.name;

        if (entry.kind === 'file') {
          const fileHandle = entry as FileSystemFileHandle;
          try {
            const file = await fileHandle.getFile();
            files.push({
              name: file.name,
              path: entryPath,
              size: file.size,
              lastModified: file.lastModified,
              type: file.type || getMimeType(file.name),
              handle: fileHandle,
            });
          } catch (err) {
            console.warn(`Could not read file ${entryPath}:`, err);
          }
        } else if (entry.kind === 'directory') {
          // Skip hidden directories and system folders
          if (entry.name.startsWith('.')) continue;

          const subDirHandle = entry as FileSystemDirectoryHandle;
          const subFiles = await scanDirectory(subDirHandle, entryPath);
          files.push(...subFiles);
        }
      }

      return files;
    },
    []
  );

  // Scan for files in a specific tax year
  const scanTaxYear = useCallback(
    async (entity: Entity, taxYear: number): Promise<TaxDocument[]> => {
      if (!rootDirectory.handle) {
        setError('No directory access. Please select a folder first.');
        return [];
      }

      setIsScanning(true);
      setError(null);

      try {
        // Navigate to the year folder
        const yearFolder = `${taxYear}`;
        let yearHandle: FileSystemDirectoryHandle;

        try {
          yearHandle = await rootDirectory.handle.getDirectoryHandle(yearFolder);
        } catch {
          // Year folder doesn't exist yet
          console.log(`No folder for ${taxYear}`);
          setIsScanning(false);
          return [];
        }

        const files = await scanDirectory(yearHandle, yearFolder);

        // Convert to TaxDocuments
        const documents: TaxDocument[] = files
          .filter((f) => !f.name.startsWith('.')) // Skip hidden files
          .map((file) => {
            const docType = detectDocumentType(file.name);
            const expenseCategory = detectExpenseCategory(file.path);

            const doc: TaxDocument = {
              id: `${file.path}-${file.lastModified}`,
              fileName: file.name,
              fileType: file.type,
              fileSize: file.size,
              filePath: file.path,
              type: docType,
              entity,
              taxYear,
              tags: [],
              tracked: true,
              createdAt: new Date(file.lastModified).toISOString(),
              updatedAt: new Date(file.lastModified).toISOString(),
            };

            // Add parsed data for receipts with detected category
            if (docType === 'receipt' && expenseCategory) {
              doc.parsedData = {
                vendor: '',
                amount: 0,
                date: new Date(file.lastModified).toISOString().split('T')[0],
                category: expenseCategory,
              };
            }

            return doc;
          });

        setIsScanning(false);
        return documents;
      } catch (err) {
        setError('Failed to scan directory');
        console.error('Scan error:', err);
        setIsScanning(false);
        return [];
      }
    },
    [rootDirectory.handle, scanDirectory]
  );

  // Move a file to a specific folder
  const moveFile = useCallback(
    async (sourceHandle: FileSystemFileHandle, destinationPath: string): Promise<boolean> => {
      if (!rootDirectory.handle) return false;

      try {
        // Get source file content
        const file = await sourceHandle.getFile();
        const content = await file.arrayBuffer();

        // Navigate/create destination path
        const pathParts = destinationPath.split('/').filter(Boolean);
        const fileName = pathParts.pop()!;
        let currentDir = rootDirectory.handle;

        for (const part of pathParts) {
          currentDir = await currentDir.getDirectoryHandle(part, { create: true });
        }

        // Create new file in destination
        const newFileHandle = await currentDir.getFileHandle(fileName, { create: true });
        const writable = await newFileHandle.createWritable();
        await writable.write(content);
        await writable.close();

        // Remove original (if we have permission)
        try {
          // @ts-expect-error - remove is not in all TS libs
          await sourceHandle.remove();
        } catch {
          console.log('Could not remove original file (may need manual cleanup)');
        }

        return true;
      } catch (err) {
        console.error('Move file error:', err);
        return false;
      }
    },
    [rootDirectory.handle]
  );

  // Copy a dropped file to the correct folder
  const importFile = useCallback(
    async (
      file: File,
      docType: DocumentType,
      taxYear: number,
      expenseCategory?: ExpenseCategory
    ): Promise<boolean> => {
      if (!rootDirectory.handle) return false;

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
            'taxes-licenses': 'expenses/business',
            education: 'expenses/business',
            'home-improvement': 'expenses/business',
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

        // Navigate/create destination path
        const pathParts = destPath.split('/').filter(Boolean);
        let currentDir = rootDirectory.handle;

        for (const part of pathParts) {
          currentDir = await currentDir.getDirectoryHandle(part, { create: true });
        }

        // Create file in destination
        const newFileHandle = await currentDir.getFileHandle(file.name, { create: true });
        const writable = await newFileHandle.createWritable();
        await writable.write(await file.arrayBuffer());
        await writable.close();

        return true;
      } catch (err) {
        console.error('Import file error:', err);
        return false;
      }
    },
    [rootDirectory.handle]
  );

  // Open a file for viewing
  const openFile = useCallback(async (fileHandle: FileSystemFileHandle): Promise<void> => {
    try {
      const file = await fileHandle.getFile();
      const url = URL.createObjectURL(file);
      window.open(url, '_blank');
      // Clean up after a delay
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      console.error('Open file error:', err);
    }
  }, []);

  return {
    hasAccess: !!rootDirectory.handle,
    rootPath: rootDirectory.path,
    isScanning,
    error,
    requestDirectoryAccess,
    scanTaxYear,
    moveFile,
    importFile,
    openFile,
  };
}
