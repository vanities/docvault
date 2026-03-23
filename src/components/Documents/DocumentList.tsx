import { useState, useMemo } from 'react';
import {
  Search,
  Filter,
  Grid,
  List as ListIcon,
  FileX,
  ChevronDown,
  ChevronRight,
  Layers,
  X,
  Sparkles,
  Loader2,
} from 'lucide-react';
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
  onRelocate?: (
    fromEntity: Entity,
    fromPath: string,
    toEntity: Entity,
    toYear: number,
    newDocType: DocumentType
  ) => Promise<boolean>;
  entities?: EntityConfig[];
  availableYears?: number[];
}

type ViewMode = 'grid' | 'list';
type SortField = 'createdAt' | 'fileName' | 'type';
type SortOrder = 'asc' | 'desc';
type GroupMode = 'none' | 'folder' | 'type' | 'client';

// Try to detect a smarter group from filename when the folder is generic ("other")
function detectGroupFromFilename(fileName: string): string | null {
  const lower = fileName.toLowerCase();

  // Invoices
  if (/invoice/i.test(lower)) return 'Invoices';
  // Timesheets
  if (/timesheet/i.test(lower)) return 'Timesheets';
  // Contracts, agreements, NDAs
  if (/contract|agreement|nda|mnda/i.test(lower)) return 'Contracts';
  // W-9 forms
  if (/w-?9/i.test(lower)) return 'Tax Forms';
  // W-4 forms
  if (/w-?4|withholding/i.test(lower)) return 'Tax Forms';
  // 1098-T tuition
  if (/1098/i.test(lower)) return 'Tax Forms';
  // 5498 / HSA forms
  if (/5498|hsa/i.test(lower)) return 'Tax Forms';
  // IRS forms (f8822b etc)
  if (/^f\d{4}|irs/i.test(lower)) return 'Tax Forms';
  // Pay stubs
  if (/paystub|pay.?stub/i.test(lower)) return 'Pay Stubs';
  // Wage & Income transcripts
  if (/wage.*income/i.test(lower)) return 'IRS Transcripts';
  // Quotes
  if (/quote/i.test(lower)) return 'Quotes';
  // Annual reports
  if (/annual.?report/i.test(lower)) return 'Reports';
  // Business plans
  if (/business.?plan/i.test(lower)) return 'Business Plans';
  // Expense policy
  if (/expense.?policy|policy/i.test(lower)) return 'Policies';

  return null;
}

// Capitalize a folder name nicely
function formatFolderName(f: string): string {
  const map: Record<string, string> = {
    income: 'Income',
    expenses: 'Expenses',
    w2: 'W-2',
    '1099': '1099',
    other: 'Other',
    business: 'Business',
    childcare: 'Childcare',
    medical: 'Medical',
    equipment: 'Equipment',
    crypto: 'Crypto',
    returns: 'Returns',
    turbotax: 'TurboTax',
    ein: 'EIN',
    formation: 'Formation',
    licenses: 'Licenses',
    contracts: 'Contracts',
    candidates: 'Candidates',
    quotes: 'Quotes',
  };
  if (map[f.toLowerCase()]) return map[f.toLowerCase()];
  return f
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// Derive a human-readable group label from a file's path
function getGroupFromPath(filePath: string): string {
  // filePath looks like "2024/income/w2/file.pdf" or "business-docs/ein/file.pdf"
  const parts = filePath.split('/');
  const fileName = parts[parts.length - 1];

  // Remove the filename (last part)
  const folders = parts.slice(0, -1);

  // Skip the year prefix for tax year docs (e.g. "2024/income/w2" → "income/w2")
  let start = 0;
  if (folders.length > 0 && /^\d{4}$/.test(folders[0])) {
    start = 1;
  }
  // Skip "business-docs" prefix
  if (folders.length > 0 && folders[0] === 'business-docs') {
    start = 1;
  }

  const meaningful = folders.slice(start);

  if (meaningful.length === 0) return detectGroupFromFilename(fileName) || 'Other';

  // If we're in an "other" folder, try to detect a smarter group from the filename
  const lastFolder = meaningful[meaningful.length - 1].toLowerCase();
  if (lastFolder === 'other') {
    const detected = detectGroupFromFilename(fileName);
    if (detected) {
      // If there's a client subfolder before "other", prefix it
      // e.g. business-docs/other/acme/W9.pdf → "Acme / Tax Forms"
      // But income/other/file.pdf → just "Tax Forms"
      const parentFolders = meaningful.slice(0, -1);
      if (parentFolders.length > 0 && parentFolders[0].toLowerCase() !== 'income') {
        return parentFolders.map(formatFolderName).join(' / ') + ' / ' + detected;
      }
      return detected;
    }

    // Check if there's a client subfolder under other (e.g. other/acme/)
    // In that case, show the client name as the group
    if (meaningful.length >= 2 && meaningful[meaningful.length - 2].toLowerCase() === 'other') {
      const clientName = formatFolderName(meaningful[meaningful.length - 1]);
      return clientName;
    }
  }

  // For client subfolders under business-docs/other/{client}/
  // Show as the client name (e.g. "Acme", "Blueprint")
  if (meaningful.length >= 2 && meaningful[0].toLowerCase() === 'other') {
    const clientPath = meaningful.slice(1).map(formatFolderName);
    const detected = detectGroupFromFilename(fileName);
    if (detected) {
      return clientPath.join(' / ') + ' / ' + detected;
    }
    return clientPath.join(' / ');
  }

  // Build nice labels from folder path
  const labels = meaningful.map(formatFolderName);
  return labels.join(' / ');
}

function getGroupFromType(type: DocumentType): string {
  if (type === 'invoice') return 'Invoices';
  const docType = DOCUMENT_TYPES.find((dt) => dt.id === type);
  if (!docType) return 'Other';
  switch (docType.category) {
    case 'income':
      return `Income / ${docType.label}`;
    case 'expense':
      return 'Expenses';
    case 'crypto':
      return 'Crypto';
    case 'business':
      return docType.label;
    default:
      return docType.label;
  }
}

// Structural folders that should stay as their own category (not grouped by client)
const STRUCTURAL_FOLDERS = new Set([
  'ein',
  'formation',
  'licenses',
  'contracts',
  'candidates',
  'quotes',
  'w2',
  '1099',
  'crypto',
  'returns',
  'turbotax',
]);

// Extract a client/vendor name from a document's filename and path.
// Docs in structural folders (EIN, Formation, etc.) keep those category names.
// Everything else gets grouped by the vendor/client name.
function getGroupFromClient(filePath: string, docType?: DocumentType): string {
  // Invoice type or filename → always "Invoices"
  if (docType === 'invoice') return 'Invoices';

  const parts = filePath.split('/');
  const fileName = parts[parts.length - 1];

  if (/invoice/i.test(fileName)) return 'Invoices';

  const folders = parts.slice(0, -1);

  // Strip year prefix and business-docs prefix to get meaningful folders
  let start = 0;
  if (folders.length > 0 && /^\d{4}$/.test(folders[0])) start = 1;
  if (folders.length > 0 && folders[0] === 'business-docs') start = 1;
  const meaningful = folders.slice(start);

  // If the doc is in a structural folder, use that as the group
  // e.g. business-docs/ein/EIN_Letter.pdf → "EIN"
  // e.g. 2024/income/w2/Google_W2_2024.pdf → "Income / W-2"
  if (meaningful.length > 0) {
    const firstFolder = meaningful[0].toLowerCase();

    // Income and expenses get their structural folder name
    if (firstFolder === 'income' || firstFolder === 'expenses') {
      const labels = meaningful.map(formatFolderName);
      return labels.join(' / ');
    }

    // Direct structural folders (ein, formation, licenses, etc.)
    if (STRUCTURAL_FOLDERS.has(firstFolder)) {
      return formatFolderName(meaningful[0]);
    }

    // Crypto, returns, turbotax
    if (['crypto', 'returns', 'turbotax'].includes(firstFolder)) {
      return formatFolderName(meaningful[0]);
    }
  }

  // Check for client subfolder under other/{client}/ or business/{client}/
  for (let i = 0; i < meaningful.length; i++) {
    const lower = meaningful[i].toLowerCase();
    if (
      (lower === 'other' || lower === 'business') &&
      i + 1 < meaningful.length &&
      !/^\d{4}$/.test(meaningful[i + 1])
    ) {
      return formatFolderName(meaningful[i + 1]);
    }
  }

  // Extract vendor from filename pattern: {Vendor}_{Type}_{Date}.ext
  // e.g. "Acme_Corp_Invoice_2025-01.pdf" → "Acme Corp"
  // e.g. "Client_Co_1099-nec_2025.pdf" → "Client Co"
  const nameWithoutExt = fileName.replace(/\.[^.]+$/, '');
  const segments = nameWithoutExt.split('_');

  if (segments.length >= 2) {
    const typeKeywords = [
      'w2',
      'w-2',
      '1099',
      '1098',
      '5498',
      'w9',
      'w-9',
      'w4',
      'w-4',
      'invoice',
      'receipt',
      'contract',
      'agreement',
      'nda',
      'mnda',
      'timesheet',
      'paystub',
      'quote',
      'annual',
      'report',
      'policy',
      'formation',
      'ein',
      'license',
      'software',
      'equipment',
      'meals',
      'childcare',
      'medical',
      'travel',
      'office',
      'k1',
      'k-1',
      'return',
      'turbotax',
      'koinly',
      'coinbase',
    ];

    let vendorEndIndex = segments.length - 1;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i].toLowerCase();
      if (
        typeKeywords.some((kw) => seg === kw || seg.startsWith(kw + '-')) ||
        /^(19|20)\d{2}/.test(seg)
      ) {
        vendorEndIndex = i;
        break;
      }
    }

    if (vendorEndIndex > 0) {
      const vendor = segments
        .slice(0, vendorEndIndex)
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(' ');
      return vendor;
    }
  }

  return 'Other';
}

// Sort group names in a sensible order
const GROUP_ORDER: Record<string, number> = {
  // Tax year groups
  Income: 1,
  'Tax Forms': 2,
  'Pay Stubs': 3,
  'IRS Transcripts': 4,
  Expenses: 5,
  Crypto: 6,
  Returns: 7,
  TurboTax: 8,
  Timesheets: 9,
  // Business doc groups
  EIN: 1,
  Formation: 2,
  Licenses: 3,
  Contracts: 4,
  Quotes: 5,
  Reports: 6,
  Policies: 7,
  'Business Plans': 8,
  Candidates: 9,
  // Always last
  Other: 98,
  Invoices: 99,
};

function getGroupSortKey(groupName: string): number {
  // Check for exact match first
  if (GROUP_ORDER[groupName] !== undefined) return GROUP_ORDER[groupName];
  // Check prefix match (e.g. "Income / W-2" starts with "Income")
  for (const [prefix, order] of Object.entries(GROUP_ORDER)) {
    if (groupName.startsWith(prefix)) return order;
  }
  return 50; // "Other" groups go towards the end
}

export function DocumentList({
  documents,
  onUpdate,
  onDelete,
  onParse,
  onMove,
  onRelocate,
  entities,
  availableYears,
}: DocumentListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<DocumentType | 'all'>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [groupMode, setGroupMode] = useState<GroupMode>('client');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [selectedDocument, setSelectedDocument] = useState<TaxDocument | null>(null);

  // Multi-select state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [parseProgress, setParseProgress] = useState<{ current: number; total: number } | null>(
    null
  );

  const filteredAndSortedDocuments = useMemo(() => {
    let result = [...documents];

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (doc) =>
          doc.fileName.toLowerCase().includes(query) ||
          (doc.filePath ?? '').toLowerCase().includes(query) ||
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

  // Group documents
  const groupedDocuments = useMemo(() => {
    if (groupMode === 'none') {
      return [{ label: '', docs: filteredAndSortedDocuments }];
    }

    const groups = new Map<string, TaxDocument[]>();

    for (const doc of filteredAndSortedDocuments) {
      let label: string;
      if (groupMode === 'folder') {
        label = getGroupFromPath(doc.filePath ?? '');
      } else if (groupMode === 'type') {
        label = getGroupFromType(doc.type);
      } else {
        label = getGroupFromClient(doc.filePath ?? '', doc.type);
      }

      if (!groups.has(label)) {
        groups.set(label, []);
      }
      groups.get(label)!.push(doc);
    }

    // Sort groups
    return Array.from(groups.entries())
      .sort(([a], [b]) => {
        const orderA = getGroupSortKey(a);
        const orderB = getGroupSortKey(b);
        if (orderA !== orderB) return orderA - orderB;
        return a.localeCompare(b);
      })
      .map(([label, docs]) => ({ label, docs }));
  }, [filteredAndSortedDocuments, groupMode]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectUnparsed = () => {
    const unparsedIds = new Set(
      filteredAndSortedDocuments.filter((d) => !d.parsedData).map((d) => d.id)
    );
    setSelectedIds(unparsedIds);
  };

  const handleParseSelected = async () => {
    if (!onParse || selectedIds.size === 0) return;
    const docs = filteredAndSortedDocuments.filter((d) => selectedIds.has(d.id));
    setParseProgress({ current: 0, total: docs.length });
    for (let i = 0; i < docs.length; i++) {
      setParseProgress({ current: i + 1, total: docs.length });
      await onParse(docs[i]);
    }
    setParseProgress(null);
    setSelectedIds(new Set());
  };

  const selectGroup = (docs: TaxDocument[]) => {
    const groupIds = new Set(docs.map((d) => d.id));
    const allSelected = docs.every((d) => selectedIds.has(d.id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        groupIds.forEach((id) => next.delete(id));
      } else {
        groupIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const toggleGroup = (label: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      return next;
    });
  };

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
        <div className="relative w-full md:flex-1 md:min-w-[200px]">
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

        {/* Group by */}
        <div className="relative">
          <Layers className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-surface-600" />
          <select
            value={groupMode}
            onChange={(e) => setGroupMode(e.target.value as GroupMode)}
            className="pl-9 pr-8 py-2 bg-surface-200/40 border border-border rounded-lg text-[13px] text-surface-900 appearance-none"
          >
            <option value="client">Group by Client</option>
            <option value="folder">Group by Folder</option>
            <option value="type">Group by Type</option>
            <option value="none">No Grouping</option>
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

      {/* Results count + action bar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <p className="text-[11px] text-surface-600 mr-1">
          Showing {filteredAndSortedDocuments.length} of {documents.length} documents
          {groupMode !== 'none' && ` in ${groupedDocuments.length} groups`}
          {selectedIds.size > 0 && (
            <span className="ml-2 text-accent-400 font-medium">· {selectedIds.size} selected</span>
          )}
        </p>

        {onParse && (
          <>
            <button
              onClick={selectUnparsed}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-surface-700 hover:text-surface-900 bg-surface-200/50 hover:bg-surface-200 border border-border rounded-lg transition-colors"
            >
              <Sparkles className="w-3 h-3" />
              Unparsed ({filteredAndSortedDocuments.filter((d) => !d.parsedData).length})
            </button>
            <button
              onClick={() => setSelectedIds(new Set(filteredAndSortedDocuments.map((d) => d.id)))}
              className="px-2.5 py-1 text-[11px] font-medium text-surface-700 hover:text-surface-900 bg-surface-200/50 hover:bg-surface-200 border border-border rounded-lg transition-colors"
            >
              All ({filteredAndSortedDocuments.length})
            </button>
            {selectedIds.size > 0 && (
              <button
                onClick={() => setSelectedIds(new Set())}
                className="flex items-center gap-1 px-2.5 py-1 text-[11px] text-surface-600 hover:text-surface-900 border border-border rounded-lg transition-colors"
              >
                <X className="w-3 h-3" />
                Clear
              </button>
            )}
            {selectedIds.size > 0 && (
              <button
                onClick={handleParseSelected}
                disabled={!!parseProgress}
                className="flex items-center gap-1.5 px-3 py-1 text-[12px] font-medium text-white bg-accent-500 hover:bg-accent-600 disabled:opacity-60 rounded-lg transition-colors"
              >
                {parseProgress ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Parsing {parseProgress.current} of {parseProgress.total}...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3 h-3" />
                    Parse {selectedIds.size}
                  </>
                )}
              </button>
            )}
          </>
        )}
      </div>

      {/* Document groups */}
      {filteredAndSortedDocuments.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-surface-700">No documents match your search.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {groupedDocuments.map(({ label, docs }) => {
            const isCollapsed = collapsedGroups.has(label);
            const showHeader = groupMode !== 'none' && label !== '';

            return (
              <div key={label || '__ungrouped'}>
                {showHeader && (
                  <div className="flex items-center gap-2 mb-3">
                    <button
                      onClick={() => toggleGroup(label)}
                      className="flex items-center gap-2 group/header text-left"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="w-4 h-4 text-surface-600" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-surface-600" />
                      )}
                      <h3 className="text-[12px] font-semibold text-surface-700 uppercase tracking-wider group-hover/header:text-surface-900 transition-colors">
                        {label}
                      </h3>
                      <span className="text-[11px] text-surface-500 font-normal">
                        {docs.length}
                      </span>
                    </button>
                    {onParse && (
                      <button
                        onClick={() => selectGroup(docs)}
                        className="text-[10px] text-surface-500 hover:text-accent-400 transition-colors px-1.5 py-0.5 rounded border border-transparent hover:border-accent-400/30"
                      >
                        {docs.every((d) => selectedIds.has(d.id)) ? 'deselect all' : 'select all'}
                      </button>
                    )}
                  </div>
                )}

                {!isCollapsed && (
                  <div
                    className={
                      viewMode === 'grid'
                        ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3'
                        : 'space-y-2'
                    }
                  >
                    {docs.map((doc) => (
                      <DocumentCard
                        key={doc.id}
                        document={doc}
                        onUpdate={onUpdate}
                        onDelete={onDelete}
                        onRelocate={onRelocate}
                        entities={entities}
                        availableYears={availableYears}
                        onClick={() => setSelectedDocument(doc)}
                        isSelected={onParse ? selectedIds.has(doc.id) : undefined}
                        onToggleSelect={onParse ? toggleSelect : undefined}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
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
