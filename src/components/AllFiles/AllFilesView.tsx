import { useState, useEffect, useCallback } from 'react';
import { Upload, FolderOpen, RefreshCw } from 'lucide-react';
import { useAppContext } from '../../contexts/AppContext';
import { useToast } from '../../hooks/useToast';
import { DocumentList } from '../Documents/DocumentList';
import type { TaxDocument } from '../../types';

export function AllFilesView() {
  const {
    selectedEntity,
    scanAllFiles,
    importFile,
    deleteFile,
    parseFile,
    isProcessing,
    entities,
    setIsParsing,
  } = useAppContext();

  const { addToast } = useToast();

  const [allFiles, setAllFiles] = useState<TaxDocument[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Load all files when entity changes
  const loadAllFiles = useCallback(async () => {
    setIsLoading(true);
    const docs = await scanAllFiles(selectedEntity);
    setAllFiles(docs);
    setIsLoading(false);
  }, [selectedEntity, scanAllFiles]);

  useEffect(() => {
    loadAllFiles();
  }, [loadAllFiles]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || selectedEntity === 'all') return;

    const success = await importFile(file, 'other', selectedEntity, 0);

    if (success) {
      addToast('File uploaded successfully', 'success');
      await loadAllFiles();
    } else {
      addToast('Failed to upload file', 'error');
    }

    e.target.value = '';
  };

  const handleUpdateDoc = (id: string, updates: Partial<TaxDocument>) => {
    setAllFiles((prev) => prev.map((doc) => (doc.id === id ? { ...doc, ...updates } : doc)));
  };

  const handleDeleteDoc = async (id: string) => {
    const doc = allFiles.find((d) => d.id === id);
    if (!doc?.filePath) return;
    if (!confirm(`Delete "${doc.fileName}"?`)) return;

    const success = await deleteFile(doc.entity, doc.filePath);
    if (success) {
      setAllFiles((prev) => prev.filter((d) => d.id !== id));
      addToast('File deleted', 'success');
    } else {
      addToast('Failed to delete file', 'error');
    }
  };

  const handleParseDoc = async (doc: TaxDocument): Promise<TaxDocument | null> => {
    if (!doc.filePath) return null;

    setIsParsing(true);
    try {
      const parsedData = await parseFile(doc.entity, doc.filePath);
      if (parsedData) {
        const updated = { ...doc, parsedData: parsedData as TaxDocument['parsedData'] };
        setAllFiles((prev) => prev.map((d) => (d.id === doc.id ? updated : d)));
        addToast('File parsed successfully', 'success');
        return updated;
      }
      addToast('Failed to parse file', 'error');
      return null;
    } finally {
      setIsParsing(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-surface-950">All Files</h2>
          <p className="text-[13px] text-surface-600 mt-1">
            Browse all documents and files in this entity.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={loadAllFiles}
            disabled={isLoading || isProcessing}
            className="p-2 text-surface-600 hover:text-surface-800 hover:bg-surface-300/30 rounded-lg transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>

          {selectedEntity !== 'all' && (
            <label className="flex items-center gap-2 px-4 py-2 text-[13px] font-medium text-accent-400 bg-accent-500/10 hover:bg-accent-500/15 rounded-xl cursor-pointer transition-colors">
              <Upload className="w-4 h-4" />
              Upload File
              <input
                type="file"
                className="hidden"
                onChange={handleFileUpload}
                disabled={isProcessing}
              />
            </label>
          )}
        </div>
      </div>

      {selectedEntity === 'all' && (
        <div className="bg-warn-500/10 border border-warn-500/20 rounded-xl p-4 mb-6">
          <p className="text-[13px] text-warn-400">
            Select a specific entity from the sidebar to upload files.
          </p>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-12 text-surface-600">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2 text-accent-400" />
          Loading files...
        </div>
      ) : allFiles.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-surface-500 rounded-xl">
          <FolderOpen className="w-12 h-12 text-surface-500 mx-auto mb-4" />
          <p className="text-surface-700">No files found</p>
          {selectedEntity !== 'all' && (
            <p className="text-[13px] text-surface-600 mt-2">
              Upload files or check that the entity folder has content
            </p>
          )}
        </div>
      ) : (
        <DocumentList
          documents={allFiles}
          onUpdate={handleUpdateDoc}
          onDelete={handleDeleteDoc}
          onParse={handleParseDoc}
          entities={entities}
        />
      )}
    </div>
  );
}
