import { useState, useMemo } from 'react';
import { Search, Filter, Grid, List as ListIcon, FileX } from 'lucide-react';
import { DocumentCard } from './DocumentCard';
import { DocumentViewer } from './DocumentViewer';
import type { TaxDocument, DocumentType, Entity } from '../../types';
import type { EntityConfig } from '../../hooks/useFileSystemServer';
import { DOCUMENT_TYPES } from '../../config';

interface DocumentListProps {
  documents: TaxDocument[];
  onUpdate: (id: string, updates: Partial<TaxDocument>) => void;
  onDelete: (id: string) => void;
  onParse?: (doc: TaxDocument) => Promise<TaxDocument | null>;
  onMove?: (
    fromEntity: Entity,
    fromPath: string,
    toEntity: Entity,
    toYear: number
  ) => Promise<boolean>;
  entities?: EntityConfig[];
  availableYears?: number[];
}

type ViewMode = 'grid' | 'list';
type SortField = 'createdAt' | 'fileName' | 'type';
type SortOrder = 'asc' | 'desc';

export function DocumentList({
  documents,
  onUpdate,
  onDelete,
  onParse,
  onMove,
  entities,
  availableYears,
}: DocumentListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<DocumentType | 'all'>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [selectedDocument, setSelectedDocument] = useState<TaxDocument | null>(null);

  const filteredAndSortedDocuments = useMemo(() => {
    let result = [...documents];

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (doc) =>
          doc.fileName.toLowerCase().includes(query) ||
          doc.tags.some((tag) => tag.toLowerCase().includes(query)) ||
          doc.notes?.toLowerCase().includes(query)
      );
    }

    // Filter by type
    if (filterType !== 'all') {
      result = result.filter((doc) => doc.type === filterType);
    }

    // Sort
    result.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'createdAt':
          comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        case 'fileName':
          comparison = a.fileName.localeCompare(b.fileName);
          break;
        case 'type':
          comparison = a.type.localeCompare(b.type);
          break;
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [documents, searchQuery, filterType, sortField, sortOrder]);

  // Unused but kept for potential column header click sorting
  const _toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };
  void _toggleSort;

  if (documents.length === 0) {
    return (
      <div className="text-center py-16">
        <FileX className="w-12 h-12 text-surface-500 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-surface-900 mb-1">No documents yet</h3>
        <p className="text-sm text-surface-700">
          Upload your first document using the drop zone above.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-600" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search documents..."
            className="w-full pl-9 pr-4 py-2 bg-surface-200/40 border border-border rounded-lg text-[13px] text-surface-900 placeholder-surface-600"
          />
        </div>

        {/* Type filter */}
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-surface-600" />
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as DocumentType | 'all')}
            className="pl-9 pr-8 py-2 bg-surface-200/40 border border-border rounded-lg text-[13px] text-surface-900 appearance-none"
          >
            <option value="all">All Types</option>
            {DOCUMENT_TYPES.map((dt) => (
              <option key={dt.id} value={dt.id}>
                {dt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Sort */}
        <select
          value={`${sortField}-${sortOrder}`}
          onChange={(e) => {
            const [field, order] = e.target.value.split('-') as [SortField, SortOrder];
            setSortField(field);
            setSortOrder(order);
          }}
          className="px-3 py-2 bg-surface-200/40 border border-border rounded-lg text-[13px] text-surface-900 appearance-none"
        >
          <option value="createdAt-desc">Newest First</option>
          <option value="createdAt-asc">Oldest First</option>
          <option value="fileName-asc">Name A-Z</option>
          <option value="fileName-desc">Name Z-A</option>
          <option value="type-asc">Type A-Z</option>
        </select>

        {/* View toggle */}
        <div className="flex border border-border rounded-lg overflow-hidden">
          <button
            onClick={() => setViewMode('grid')}
            className={`p-2 transition-all duration-100 ${viewMode === 'grid' ? 'bg-surface-300/50 text-surface-900' : 'text-surface-600 hover:bg-surface-200/40'}`}
          >
            <Grid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-2 transition-all duration-100 ${viewMode === 'list' ? 'bg-surface-300/50 text-surface-900' : 'text-surface-600 hover:bg-surface-200/40'}`}
          >
            <ListIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Results count */}
      <p className="text-[11px] text-surface-600 mb-4">
        Showing {filteredAndSortedDocuments.length} of {documents.length} documents
      </p>

      {/* Document grid/list */}
      {filteredAndSortedDocuments.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-surface-700">No documents match your search.</p>
        </div>
      ) : (
        <div
          className={
            viewMode === 'grid'
              ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3'
              : 'space-y-2'
          }
        >
          {filteredAndSortedDocuments.map((doc) => (
            <DocumentCard
              key={doc.id}
              document={doc}
              onUpdate={onUpdate}
              onDelete={onDelete}
              onClick={() => setSelectedDocument(doc)}
            />
          ))}
        </div>
      )}

      {/* Document Viewer */}
      {selectedDocument && (
        <DocumentViewer
          document={selectedDocument}
          onClose={() => setSelectedDocument(null)}
          onDelete={(id) => {
            onDelete(id);
            setSelectedDocument(null);
          }}
          onReparse={
            onParse
              ? async () => {
                  const updated = await onParse(selectedDocument);
                  if (updated) {
                    setSelectedDocument(updated);
                  }
                }
              : undefined
          }
          onMove={onMove}
          entities={entities}
          availableYears={availableYears}
        />
      )}
    </div>
  );
}
