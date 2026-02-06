import { useState } from 'react';
import {
  X,
  Download,
  RefreshCw,
  Trash2,
  FileText,
  Image,
  File,
  ExternalLink,
  Calendar,
  HardDrive,
  FolderOpen,
  Tag,
  MoveRight,
} from 'lucide-react';
import type { TaxDocument, Entity } from '../../types';
import { DOCUMENT_TYPES, EXPENSE_CATEGORIES } from '../../config';
import type { EntityConfig } from '../../hooks/useFileSystemServer';

interface DocumentViewerProps {
  document: TaxDocument;
  onClose: () => void;
  onDelete?: (id: string) => void;
  onReparse?: () => Promise<void>;
  onMove?: (fromPath: string, toEntity: Entity, toYear: number) => Promise<boolean>;
  entities?: EntityConfig[];
  availableYears?: number[];
}

const API_BASE = 'http://localhost:3005/api';

function getFileUrl(entity: string, filePath: string): string {
  return `${API_BASE}/file/${entity}/${encodeURIComponent(filePath)}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function FileIcon({ fileType, className }: { fileType: string; className?: string }) {
  if (fileType.includes('pdf')) {
    return <FileText className={className} />;
  }
  if (fileType.includes('image')) {
    return <Image className={className} />;
  }
  return <File className={className} />;
}

export function DocumentViewer({
  document,
  onClose,
  onDelete,
  onReparse,
  onMove,
  entities,
  availableYears,
}: DocumentViewerProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [moveToEntity, setMoveToEntity] = useState<Entity>(document.entity);
  const [moveToYear, setMoveToYear] = useState<number>(document.taxYear);
  const [isMoving, setIsMoving] = useState(false);

  const fileUrl = getFileUrl(document.entity, document.filePath);
  const isImage = document.fileType.includes('image');
  const isPdf = document.fileType.includes('pdf');
  const canPreview = isImage || isPdf;

  const docTypeInfo = DOCUMENT_TYPES.find((t) => t.id === document.type);
  const expenseInfo =
    document.parsedData && 'category' in document.parsedData
      ? EXPENSE_CATEGORIES.find((c) => c.id === document.parsedData?.category)
      : null;

  const handleDownload = () => {
    const link = window.document.createElement('a');
    link.href = fileUrl;
    link.download = document.fileName;
    link.click();
  };

  const handleOpenExternal = () => {
    window.open(fileUrl, '_blank');
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    if (!confirm(`Delete "${document.fileName}"?`)) return;

    setIsDeleting(true);
    try {
      await onDelete(document.id);
      onClose();
    } finally {
      setIsDeleting(false);
    }
  };

  const handleReparse = async () => {
    if (!onReparse) return;
    setIsParsing(true);
    try {
      await onReparse();
    } finally {
      setIsParsing(false);
    }
  };

  const handleMove = async () => {
    if (!onMove || !document.filePath) return;
    if (moveToEntity === document.entity && moveToYear === document.taxYear) {
      setShowMoveModal(false);
      return;
    }

    setIsMoving(true);
    try {
      const success = await onMove(document.filePath, moveToEntity, moveToYear);
      if (success) {
        setShowMoveModal(false);
        onClose();
      }
    } finally {
      setIsMoving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Panel */}
      <div className="relative ml-auto w-full max-w-2xl bg-white shadow-xl flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-3 min-w-0">
            <FileIcon fileType={document.fileType} className="w-6 h-6 text-gray-500 shrink-0" />
            <div className="min-w-0">
              <h2 className="font-semibold text-gray-900 truncate">{document.fileName}</h2>
              <p className="text-sm text-gray-500">{docTypeInfo?.label || document.type}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Preview */}
        <div className="flex-1 overflow-hidden bg-gray-100">
          {canPreview ? (
            <div className="w-full h-full flex items-center justify-center p-4">
              {isImage ? (
                <img
                  src={fileUrl}
                  alt={document.fileName}
                  className="max-w-full max-h-full object-contain rounded-lg shadow-lg"
                />
              ) : isPdf ? (
                <iframe src={fileUrl} className="w-full h-full rounded-lg shadow-lg bg-white" />
              ) : null}
            </div>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-gray-400">
              <File className="w-16 h-16 mb-4" />
              <p>Preview not available</p>
              <button
                onClick={handleOpenExternal}
                className="mt-4 flex items-center gap-2 text-blue-600 hover:text-blue-700"
              >
                <ExternalLink className="w-4 h-4" />
                Open in new tab
              </button>
            </div>
          )}
        </div>

        {/* Details */}
        <div className="border-t border-gray-200 p-4 space-y-4 max-h-80 overflow-y-auto">
          {/* File Info */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="flex items-center gap-2 text-gray-600">
              <HardDrive className="w-4 h-4" />
              <span>{formatFileSize(document.fileSize)}</span>
            </div>
            <div className="flex items-center gap-2 text-gray-600">
              <Calendar className="w-4 h-4" />
              <span>{formatDate(document.createdAt)}</span>
            </div>
            <div className="flex items-center gap-2 text-gray-600 col-span-2">
              <FolderOpen className="w-4 h-4" />
              <span className="truncate">{document.filePath}</span>
            </div>
          </div>

          {/* Tags */}
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded text-sm">
              <Tag className="w-3 h-3" />
              {docTypeInfo?.label || document.type}
            </span>
            {expenseInfo && (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded text-sm">
                {expenseInfo.label}
              </span>
            )}
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-700 rounded text-sm">
              {document.taxYear}
            </span>
          </div>

          {/* Parsed Data */}
          {document.parsedData && (
            <div className="bg-gray-50 rounded-lg p-3">
              <h3 className="font-medium text-gray-900 mb-2">Parsed Data</h3>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                {Object.entries(document.parsedData)
                  .filter(
                    ([key]) => key !== 'parsed' && key !== 'parsedAt' && key !== 'documentType'
                  )
                  .map(([key, value]) => {
                    // Format the key nicely
                    const label = key
                      .replace(/([A-Z])/g, ' $1')
                      .replace(/_/g, ' ')
                      .trim();

                    // Format the value
                    let displayValue: string;
                    if (value === null || value === undefined || value === '') {
                      return null; // Skip empty values
                    } else if (typeof value === 'number') {
                      // Fields that should be displayed as plain numbers (no formatting)
                      const plainNumberFields = [
                        'year',
                        'quantity',
                        'zip',
                        'phone',
                        'ssn',
                        'tin',
                        'ein',
                      ];
                      const isPlainNumber = plainNumberFields.some((f) =>
                        key.toLowerCase().includes(f)
                      );

                      if (isPlainNumber) {
                        displayValue = String(value);
                      } else {
                        // Format as currency if it looks like a money field
                        const moneyFields = [
                          'wages',
                          'withheld',
                          'tax',
                          'compensation',
                          'amount',
                          'income',
                          'dividends',
                          'gains',
                          'interest',
                          'rents',
                          'royalties',
                          'proceeds',
                          'payments',
                          'premium',
                          'discount',
                          'expenses',
                          'penalty',
                          'distributions',
                          'subtotal',
                          'price',
                        ];
                        const isMoney = moneyFields.some((f) => key.toLowerCase().includes(f));

                        displayValue = isMoney
                          ? `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          : value.toLocaleString();
                      }
                    } else if (typeof value === 'boolean') {
                      displayValue = value ? 'Yes' : 'No';
                    } else if (Array.isArray(value)) {
                      // Handle arrays (like box12 or items)
                      displayValue = value
                        .map((item) =>
                          typeof item === 'object' ? JSON.stringify(item) : String(item)
                        )
                        .join(', ');
                    } else if (typeof value === 'object') {
                      displayValue = JSON.stringify(value);
                    } else {
                      displayValue = String(value);
                    }

                    return (
                      <div key={key}>
                        <dt className="text-gray-500 capitalize">{label}</dt>
                        <dd className="text-gray-900 font-medium">{displayValue}</dd>
                      </div>
                    );
                  })}
              </dl>
            </div>
          )}

          {!document.parsedData && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
              This document hasn't been parsed yet. Click "Parse Document" to extract data.
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="border-t border-gray-200 p-4 flex gap-2">
          <button
            onClick={handleDownload}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
          >
            <Download className="w-4 h-4" />
            Download
          </button>
          <button
            onClick={handleReparse}
            disabled={isParsing}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isParsing ? 'animate-spin' : ''}`} />
            {isParsing ? 'Parsing...' : 'Parse Document'}
          </button>
          {onMove && entities && availableYears && (
            <button
              onClick={() => setShowMoveModal(true)}
              className="flex items-center justify-center gap-2 px-4 py-2 text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
              title="Move to different entity/year"
            >
              <MoveRight className="w-4 h-4" />
            </button>
          )}
          {onDelete && (
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className="flex items-center justify-center gap-2 px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Move Modal */}
      {showMoveModal && entities && availableYears && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowMoveModal(false)} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Move Document</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Entity</label>
                <select
                  value={moveToEntity}
                  onChange={(e) => setMoveToEntity(e.target.value as Entity)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {entities.map((entity) => (
                    <option key={entity.id} value={entity.id}>
                      {entity.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Tax Year</label>
                <select
                  value={moveToYear}
                  onChange={(e) => setMoveToYear(parseInt(e.target.value, 10))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {availableYears.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowMoveModal(false)}
                className="flex-1 px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleMove}
                disabled={
                  isMoving || (moveToEntity === document.entity && moveToYear === document.taxYear)
                }
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50"
              >
                <MoveRight className="w-4 h-4" />
                {isMoving ? 'Moving...' : 'Move'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
