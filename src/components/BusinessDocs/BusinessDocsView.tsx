import { useState, useEffect, useCallback } from 'react';
import { FolderOpen, RefreshCw } from 'lucide-react';
import { useAppContext } from '../../contexts/AppContext';
import { useToast } from '../../hooks/useToast';
import { DOCUMENT_TYPES } from '../../config';
import { DocumentList } from '../Documents/DocumentList';
import { ReminderBanner } from '../Reminders/ReminderBanner';
import { TodoList } from '../Todos/TodoList';
import { EntityMetadataBanner } from '../EntityMetadata/EntityMetadataBanner';
import { FileUploader } from '../common/FileUploader';
import type { TaxDocument, DocumentType, Entity } from '../../types';
import { Button } from '@/components/ui/button';

const BUSINESS_DOC_TYPE_IDS = DOCUMENT_TYPES.filter((dt) => dt.category === 'business').map(
  (dt) => dt.id
);

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
    updateDocMetadata,
  } = useAppContext();

  const { addToast } = useToast();

  const [businessDocs, setBusinessDocs] = useState<TaxDocument[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Load business docs when entity changes
  const loadBusinessDocs = useCallback(async () => {
    setIsLoading(true);
    const docs = await scanBusinessDocs(selectedEntity);
    setBusinessDocs(docs);
    setIsLoading(false);
  }, [selectedEntity, scanBusinessDocs]);

  useEffect(() => {
    void loadBusinessDocs();
  }, [loadBusinessDocs]);

  const handleUploadFile = async (
    file: File,
    docType: DocumentType,
    _entity: Entity,
    _taxYear: number
  ): Promise<boolean> => {
    if (selectedEntity === 'all') return false;
    return importFile(file, docType, selectedEntity, 0);
  };

  const handleUploadComplete = async ({
    succeeded,
    failed,
  }: {
    succeeded: number;
    failed: number;
  }) => {
    if (succeeded > 0) {
      addToast(
        succeeded === 1 && failed === 0
          ? 'Document uploaded successfully'
          : `${succeeded} document${succeeded !== 1 ? 's' : ''} uploaded${failed > 0 ? `, ${failed} failed` : ''}`,
        failed > 0 ? 'info' : 'success'
      );
      await loadBusinessDocs();
    } else if (failed > 0) {
      addToast('Failed to upload document(s)', 'error');
    }
  };

  const handleUpdateDoc = (id: string, updates: Partial<TaxDocument>) => {
    setBusinessDocs((prev) => prev.map((doc) => (doc.id === id ? { ...doc, ...updates } : doc)));
    if ('tags' in updates || 'notes' in updates) {
      const doc = businessDocs.find((d) => d.id === id);
      if (doc?.filePath) {
        const merged = { ...doc, ...updates };
        void updateDocMetadata(doc.entity, doc.filePath, {
          tags: merged.tags,
          notes: merged.notes || '',
        });
      }
    }
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
        const updated = { ...doc, parsedData: parsedData as unknown as TaxDocument['parsedData'] };
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

      {/* Entity Metadata */}
      <EntityMetadataBanner entityConfig={entities.find((e) => e.id === selectedEntity)} />

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
          <Button
            variant="ghost"
            size="icon"
            onClick={loadBusinessDocs}
            disabled={isLoading || isProcessing}
            title="Refresh"
          >
            <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Upload Zone */}
      {selectedEntity !== 'all' && (
        <div className="mb-6">
          <FileUploader
            entity={selectedEntity}
            taxYear={0}
            onUpload={handleUploadFile}
            onComplete={handleUploadComplete}
            disabled={isProcessing}
            parseMode="never"
            allowedDocTypes={BUSINESS_DOC_TYPE_IDS}
            defaultDocType="formation"
            accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
            label="Upload Documents"
            subtitle="Formation docs, EIN letters, contracts, licenses"
          />
        </div>
      )}

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
    </div>
  );
}
