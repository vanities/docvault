import { useEntityDocuments } from '../../hooks/useEntityDocuments';
import { documentMetadataPatch } from '../../utils/documentMetadataPatch';
import { FolderOpen, RefreshCw } from 'lucide-react';
import { TodoList } from '../Todos/TodoList';
import { EntityMetadataBanner } from '../EntityMetadata/EntityMetadataBanner';
import { useAppContext } from '../../contexts/AppContext';
import { useToast } from '../../hooks/useToast';
import { DocumentList } from '../Documents/DocumentList';
import { FileUploader } from '../common/FileUploader';
import type { TaxDocument, Entity, DocumentType, ExpenseCategory } from '../../types';
import { Button } from '@/components/ui/button';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';

export function AllFilesView() {
  const { confirm, confirmDialog } = useConfirmDialog();
  const {
    selectedEntity,
    scanAllFiles,
    importFile,
    deleteFile,
    parseFile,
    isProcessing,
    entities,
    availableYears,
    setIsParsing,
    relocateFile,
    updateDocMetadata,
    checkConnection,
  } = useAppContext();

  const { addToast } = useToast();

  const {
    documents: allFiles,
    setDocuments: setAllFiles,
    isLoading,
    error: loadError,
    reload: loadAllFiles,
  } = useEntityDocuments(selectedEntity, scanAllFiles);

  const handleUploadFile = async (
    file: File,
    docType: DocumentType,
    entity: Entity,
    taxYear: number,
    parsedData?: TaxDocument['parsedData'],
    customFilename?: string
  ): Promise<boolean> => {
    const expenseCategory =
      docType === 'receipt' && parsedData
        ? ((parsedData as { category?: string }).category as ExpenseCategory | undefined)
        : undefined;

    return importFile(
      file,
      docType,
      entity,
      taxYear,
      expenseCategory,
      customFilename,
      parsedData as Record<string, unknown> | undefined
    );
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
          ? 'File uploaded successfully'
          : `${succeeded} file${succeeded !== 1 ? 's' : ''} uploaded${failed > 0 ? `, ${failed} failed` : ''}`,
        failed > 0 ? 'info' : 'success'
      );
      await loadAllFiles();
    } else if (failed > 0) {
      addToast('Failed to upload file(s)', 'error');
    }
  };

  const handleUpdateDoc = async (id: string, updates: Partial<TaxDocument>) => {
    const doc = allFiles.find((document) => document.id === id);
    if (!doc) return false;
    const patch = documentMetadataPatch(updates);
    if (patch && doc.filePath && !(await updateDocMetadata(doc.entity, doc.filePath, patch))) {
      addToast('Document changes could not be saved. Please try again.', 'error');
      return false;
    }
    setAllFiles((previous) =>
      previous.map((document) => (document.id === id ? { ...document, ...updates } : document))
    );
    return true;
  };

  const handleDeleteDoc = async (id: string) => {
    const doc = allFiles.find((d) => d.id === id);
    if (!doc?.filePath) return;
    if (
      !(await confirm({
        description: `Delete "${doc.fileName}"?`,
        confirmLabel: 'Delete',
        destructive: true,
      }))
    )
      return;

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
        const updated = { ...doc, parsedData: parsedData as unknown as TaxDocument['parsedData'] };
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

  const handleRelocateDocument = async (
    fromEntity: Entity,
    fromPath: string,
    toEntity: Entity,
    toYear: number,
    newDocType: DocumentType,
    expenseCategory?: ExpenseCategory
  ): Promise<boolean> => {
    const success = await relocateFile(
      fromEntity,
      fromPath,
      toEntity,
      toYear,
      newDocType,
      expenseCategory
    );
    if (success) {
      addToast('File moved', 'success');
      await loadAllFiles();
    } else {
      addToast('Failed to move file', 'error');
    }
    return success;
  };

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-6 py-8">
      {/* Entity Metadata */}
      <EntityMetadataBanner
        entityConfig={entities.find((e) => e.id === selectedEntity)}
        onEntityUpdated={checkConnection}
      />

      {/* Todos */}
      <TodoList />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-surface-950">All Files</h2>
          <p className="text-[13px] text-surface-600 mt-1">
            Browse all documents and files in this entity.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={loadAllFiles}
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
            parseMode="optional"
            label="Upload Files"
            subtitle="Drop files here — toggle AI parsing if needed"
          />
        </div>
      )}

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
      ) : loadError ? (
        <div
          role="alert"
          className="rounded-xl border border-danger-500/30 p-5 text-sm text-surface-800"
        >
          <p className="mb-3">Documents could not be loaded. Your files have not been changed.</p>
          <Button variant="outline" onClick={() => void loadAllFiles()}>
            Try again
          </Button>
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
          onRelocate={handleRelocateDocument}
          entities={entities}
          availableYears={availableYears}
        />
      )}
      {confirmDialog}
    </div>
  );
}
