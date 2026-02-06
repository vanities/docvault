import { useState, useEffect, useCallback } from 'react';
import { Upload, FileText, X, FolderOpen, RefreshCw } from 'lucide-react';
import { useAppContext } from '../../contexts/AppContext';
import { useToast } from '../../hooks/useToast';
import { DOCUMENT_TYPES } from '../../config';
import type { TaxDocument, DocumentType } from '../../types';

// Business document types for filtering
const BUSINESS_DOC_TYPES = DOCUMENT_TYPES.filter((dt) => dt.category === 'business');

export function BusinessDocsView() {
  const { selectedEntity, scanBusinessDocs, importFile, openFile, deleteFile, isProcessing } =
    useAppContext();

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

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    loadBusinessDocs();
  }, [loadBusinessDocs]);
  /* eslint-enable react-hooks/set-state-in-effect */

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
      // Refresh the docs list
      await loadBusinessDocs();
    } else {
      addToast('Failed to upload document', 'error');
    }

    setPendingUpload(null);
  };

  const handleOpenDoc = (doc: TaxDocument) => {
    if (doc.filePath) {
      openFile(doc.entity, doc.filePath);
    }
  };

  const handleDeleteDoc = async (doc: TaxDocument) => {
    if (!doc.filePath) return;
    if (!confirm(`Delete "${doc.fileName}"?`)) return;

    const success = await deleteFile(doc.entity, doc.filePath);
    if (success) {
      setBusinessDocs((prev) => prev.filter((d) => d.id !== doc.id));
      addToast('Document deleted', 'success');
    } else {
      addToast('Failed to delete document', 'error');
    }
  };

  // Group documents by type
  const groupedDocs = BUSINESS_DOC_TYPES.reduce(
    (acc, docType) => {
      const docs = businessDocs.filter((d) => d.type === docType.id);
      if (docs.length > 0) {
        acc.push({ type: docType, docs });
      }
      return acc;
    },
    [] as { type: (typeof BUSINESS_DOC_TYPES)[0]; docs: TaxDocument[] }[]
  );

  // Ungrouped docs (other types)
  const otherDocs = businessDocs.filter((d) => !BUSINESS_DOC_TYPES.some((dt) => dt.id === d.type));

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
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
        <div className="space-y-8">
          {groupedDocs.map(({ type, docs }) => (
            <div key={type.id}>
              <h3 className="text-[11px] font-semibold text-surface-600 uppercase tracking-wider mb-3">
                {type.label} ({docs.length})
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {docs.map((doc) => (
                  <DocumentCard
                    key={doc.id}
                    doc={doc}
                    onOpen={() => handleOpenDoc(doc)}
                    onDelete={() => handleDeleteDoc(doc)}
                    showEntity={selectedEntity === 'all'}
                  />
                ))}
              </div>
            </div>
          ))}

          {otherDocs.length > 0 && (
            <div>
              <h3 className="text-[11px] font-semibold text-surface-600 uppercase tracking-wider mb-3">
                Other ({otherDocs.length})
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {otherDocs.map((doc) => (
                  <DocumentCard
                    key={doc.id}
                    doc={doc}
                    onOpen={() => handleOpenDoc(doc)}
                    onDelete={() => handleDeleteDoc(doc)}
                    showEntity={selectedEntity === 'all'}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
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

interface DocumentCardProps {
  doc: TaxDocument;
  onOpen: () => void;
  onDelete: () => void;
  showEntity?: boolean;
}

function DocumentCard({ doc, onOpen, onDelete, showEntity }: DocumentCardProps) {
  const docTypeInfo = DOCUMENT_TYPES.find((dt) => dt.id === doc.type);

  return (
    <div className="glass-card rounded-xl p-4 hover:border-border-strong transition-all duration-200 group">
      <div className="flex items-start gap-3">
        <div className="p-2 bg-surface-300/40 rounded-lg flex-shrink-0">
          <FileText className="w-5 h-5 text-surface-700" />
        </div>
        <div className="flex-1 min-w-0">
          <button
            onClick={onOpen}
            className="text-[13px] font-medium text-surface-950 hover:text-accent-400 truncate block w-full text-left"
            title={doc.fileName}
          >
            {doc.fileName}
          </button>
          <p className="text-[11px] text-surface-600 mt-1">{docTypeInfo?.label || doc.type}</p>
          {showEntity && <p className="text-[11px] text-surface-500 mt-1">Entity: {doc.entity}</p>}
        </div>
        <button
          onClick={onDelete}
          className="p-1 text-surface-600 hover:text-danger-400 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Delete"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
