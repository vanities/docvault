import { useState, useEffect, useCallback } from 'react';
import { Upload, FolderOpen, RefreshCw } from 'lucide-react';
import { useAppContext } from '../../contexts/AppContext';
import { useToast } from '../../hooks/useToast';
import { DOCUMENT_TYPES } from '../../config';
import { DocumentList } from '../Documents/DocumentList';
import { ReminderBanner } from '../Reminders/ReminderBanner';
import { TodoList } from '../Todos/TodoList';
import type { TaxDocument, DocumentType, Entity } from '../../types';

// Business document types for the upload modal
const BUSINESS_DOC_TYPES = DOCUMENT_TYPES.filter((dt) => dt.category === 'business');

export function BusinessDocsView() {
  const {
    selectedEntity,
    scanBusinessDocs,
    importFile,
    deleteFile,
    parseFile,
    isProcessing,
    entities,
    setIsParsing,
    relocateFile,
  } = useAppContext();

  const { addToast } = useToast();

  const [businessDocs, setBusinessDocs] = useState<TaxDocument[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingUpload, setPendingUpload] = useState<{ file: File; type: DocumentType } | null>(
    null
  );

  // Load business docs when entity changes
  const loadBusinessDocs = useCallback(async () => {
    setIsLoading(true);
    const docs = await scanBusinessDocs(selectedEntity);
    setBusinessDocs(docs);
    setIsLoading(false);
  }, [selectedEntity, scanBusinessDocs]);

  useEffect(() => {
    loadBusinessDocs();
  }, [loadBusinessDocs]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Default to 'formation' type, user can change
    setPendingUpload({ file, type: 'formation' });
    e.target.value = '';
  };

  const handleConfirmUpload = async () => {
    if (!pendingUpload || selectedEntity === 'all') return;

    const success = await importFile(
      pendingUpload.file,
      pendingUpload.type,
      selectedEntity,
      0 // 0 indicates business doc (no year)
    );

    if (success) {
      addToast('Document uploaded successfully', 'success');
      await loadBusinessDocs();
    } else {
      addToast('Failed to upload document', 'error');
    }

    setPendingUpload(null);
  };

  const handleUpdateDoc = (id: string, updates: Partial<TaxDocument>) => {
    setBusinessDocs((prev) => prev.map((doc) => (doc.id === id ? { ...doc, ...updates } : doc)));
  };

  const handleDeleteDoc = async (id: string) => {
    const doc = businessDocs.find((d) => d.id === id);
    if (!doc?.filePath) return;
    if (!confirm(`Delete "${doc.fileName}"?`)) return;

    const success = await deleteFile(doc.entity, doc.filePath);
    if (success) {
      setBusinessDocs((prev) => prev.filter((d) => d.id !== id));
      addToast('Document deleted', 'success');
    } else {
      addToast('Failed to delete document', 'error');
    }
  };

  const handleParseDoc = async (doc: TaxDocument): Promise<TaxDocument | null> => {
    if (!doc.filePath) return null;

    setIsParsing(true);
    try {
      const parsedData = await parseFile(doc.entity, doc.filePath);
      if (parsedData) {
        const updated = { ...doc, parsedData: parsedData as TaxDocument['parsedData'] };
        setBusinessDocs((prev) => prev.map((d) => (d.id === doc.id ? updated : d)));
        addToast('Document parsed successfully', 'success');
        return updated;
      }
      addToast('Failed to parse document', 'error');
      return null;
    } finally {
      setIsParsing(false);
    }
  };

  const handleRelocateDocument = async (
    fromEntity: Entity,
    fromPath: string,
    toEntity: Entity,
    toYear: number,
    newDocType: DocumentType
  ): Promise<boolean> => {
    const success = await relocateFile(fromEntity, fromPath, toEntity, toYear, newDocType);
    if (success) {
      addToast('Document moved', 'success');
      await loadBusinessDocs();
    } else {
      addToast('Failed to move document', 'error');
    }
    return success;
  };

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-6 py-8">
      {/* Reminders */}
      <ReminderBanner />

      {/* Todos */}
      <TodoList />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-surface-950">Business Documents</h2>
          <p className="text-[13px] text-surface-600 mt-1">
            Formation docs, EIN letters, contracts, licenses, and other documents not tied to a
            specific tax year.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={loadBusinessDocs}
            disabled={isLoading || isProcessing}
            className="p-2 text-surface-600 hover:text-surface-800 hover:bg-surface-300/30 rounded-lg transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>

          {selectedEntity !== 'all' && (
            <label className="flex items-center gap-2 px-4 py-2 text-[13px] font-medium text-accent-400 bg-accent-500/10 hover:bg-accent-500/15 rounded-xl cursor-pointer transition-colors">
              <Upload className="w-4 h-4" />
              Upload Document
              <input
                type="file"
                className="hidden"
                accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
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
            Select a specific entity from the sidebar to upload business documents.
          </p>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-12 text-surface-600">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2 text-accent-400" />
          Loading documents...
        </div>
      ) : businessDocs.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-surface-500 rounded-xl">
          <FolderOpen className="w-12 h-12 text-surface-500 mx-auto mb-4" />
          <p className="text-surface-700">No business documents yet</p>
          {selectedEntity !== 'all' && (
            <p className="text-[13px] text-surface-600 mt-2">
              Upload formation docs, EIN letters, contracts, and more
            </p>
          )}
        </div>
      ) : (
        <DocumentList
          documents={businessDocs}
          onUpdate={handleUpdateDoc}
          onDelete={handleDeleteDoc}
          onParse={handleParseDoc}
          onRelocate={handleRelocateDocument}
          entities={entities}
        />
      )}

      {/* Upload Confirmation Modal */}
      {pendingUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setPendingUpload(null)}
          />
          <div className="relative glass-strong rounded-2xl shadow-2xl p-6 w-full max-w-sm animate-scale-in">
            <h3 className="text-lg font-semibold text-surface-950 mb-4">Upload Document</h3>

            <div className="space-y-4">
              <div>
                <p className="text-[13px] text-surface-600 mb-1">File:</p>
                <p className="text-[13px] font-medium text-surface-950 truncate">
                  {pendingUpload.file.name}
                </p>
              </div>

              <div>
                <label className="block text-[13px] font-medium text-surface-800 mb-2">
                  Document Type
                </label>
                <select
                  value={pendingUpload.type}
                  onChange={(e) =>
                    setPendingUpload({ ...pendingUpload, type: e.target.value as DocumentType })
                  }
                  className="w-full px-3 py-2.5 bg-surface-200/50 border border-border rounded-xl text-[13px] text-surface-900"
                >
                  {BUSINESS_DOC_TYPES.map((dt) => (
                    <option key={dt.id} value={dt.id}>
                      {dt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setPendingUpload(null)}
                  className="flex-1 px-4 py-2.5 text-surface-800 hover:bg-surface-300/30 rounded-xl transition-all text-[13px]"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmUpload}
                  className="flex-1 px-4 py-2.5 bg-accent-500 text-surface-0 rounded-xl hover:bg-accent-400 transition-all text-[13px] font-medium"
                >
                  Upload
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
