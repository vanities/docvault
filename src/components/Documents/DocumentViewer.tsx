import { useState, useCallback, useRef, useEffect } from 'react';
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
  Pencil,
  Check,
  Sparkles,
} from 'lucide-react';
import type { TaxDocument, Entity, ExpenseCategory } from '../../types';
import { DOCUMENT_TYPES, EXPENSE_CATEGORIES } from '../../config';
import type { EntityConfig } from '../../hooks/useFileSystemServer';
import { useToast } from '../../hooks/useToast';
import { useAppContext } from '../../contexts/AppContext';
import { generateStandardFilename, getExtension } from '../../utils/filenaming';

interface DocumentViewerProps {
  document: TaxDocument;
  onClose: () => void;
  onDelete?: (id: string) => void;
  onReparse?: () => Promise<void>;
  onMove?: (
    fromEntity: Entity,
    fromPath: string,
    toEntity: Entity,
    toYear: number
  ) => Promise<boolean>;
  entities?: EntityConfig[];
  availableYears?: number[];
}

const API_BASE = '/api';

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
  const [copied, setCopied] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [isRenameSaving, setIsRenameSaving] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const { addToast } = useToast();
  const { renameFile, setScannedDocuments, parseFile } = useAppContext();
  const [isAiRenaming, setIsAiRenaming] = useState(false);

  // Split filename into name and extension for the rename input
  const extMatch = document.fileName.match(/(\.[^.]+)$/);
  const fileExtension = extMatch ? extMatch[1] : '';
  const fileBaseName = fileExtension
    ? document.fileName.slice(0, -fileExtension.length)
    : document.fileName;

  const startRenaming = useCallback(() => {
    setRenameValue(fileBaseName);
    setIsRenaming(true);
  }, [fileBaseName]);

  // Auto-focus the input when rename mode activates
  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [isRenaming]);

  const cancelRename = useCallback(() => {
    setIsRenaming(false);
    setRenameValue('');
  }, []);

  const saveRename = useCallback(async () => {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === fileBaseName) {
      cancelRename();
      return;
    }

    const newFilename = trimmed + fileExtension;
    setIsRenameSaving(true);
    try {
      const newPath = await renameFile(document.entity, document.filePath, newFilename);
      if (newPath) {
        addToast(`Renamed to ${newFilename}`, 'success');
        // Update the document in the scanned list so UI reflects the change
        setScannedDocuments((prev) =>
          prev.map((d) =>
            d.id === document.id
              ? {
                  ...d,
                  fileName: newFilename,
                  filePath: newPath,
                  id: `${document.entity}/${newPath}-${d.fileSize}`,
                }
              : d
          )
        );
        setIsRenaming(false);
        onClose();
      } else {
        addToast('Rename failed — file may already exist', 'error');
      }
    } finally {
      setIsRenameSaving(false);
    }
  }, [
    renameValue,
    fileBaseName,
    fileExtension,
    renameFile,
    document,
    addToast,
    setScannedDocuments,
    cancelRename,
    onClose,
  ]);

  const handleAiRename = useCallback(async () => {
    if (!document.filePath) return;

    setIsAiRenaming(true);
    try {
      // Use existing parsed data, or parse first
      let parsed = document.parsedData as Record<string, unknown> | null | undefined;
      if (!parsed) {
        addToast('Parsing document first...', 'info');
        parsed = await parseFile(document.entity, document.filePath);
        if (!parsed) {
          addToast('Could not parse document — rename manually instead', 'error');
          return;
        }
      }

      // Extract source name from parsed data
      const source =
        (parsed.employerName as string) ||
        (parsed.employer as string) ||
        (parsed.payerName as string) ||
        (parsed.payer as string) ||
        (parsed.vendor as string) ||
        (parsed.source as string) ||
        '';

      if (!source) {
        addToast('Could not determine source name from parsed data', 'error');
        return;
      }

      // Extract date parts
      const dateStr = parsed.date as string | undefined;
      let month: number | undefined;
      let day: number | undefined;
      if (dateStr) {
        const parts = dateStr.split('-');
        if (parts.length >= 2) month = parseInt(parts[1], 10);
        if (parts.length >= 3) day = parseInt(parts[2], 10);
      }

      const ext = getExtension(document.fileName) || '.pdf';
      const suggested = generateStandardFilename({
        source,
        docType: document.type,
        year: document.taxYear || new Date().getFullYear(),
        month,
        day,
        expenseCategory: parsed.category as ExpenseCategory | undefined,
        description: parsed.description as string | undefined,
        extension: ext,
      });

      // Pre-fill the rename input with the AI suggestion
      const suggestedBase = ext ? suggested.slice(0, -ext.length) : suggested;
      setRenameValue(suggestedBase);
      setIsRenaming(true);
      addToast(`Suggested: ${suggested}`, 'success');
    } finally {
      setIsAiRenaming(false);
    }
  }, [document, parseFile, addToast]);

  const copyToClipboard = useCallback(
    async (text: string) => {
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
        } else {
          // Fallback for non-HTTPS (e.g. Unraid over HTTP)
          const textarea = window.document.createElement('textarea');
          textarea.value = text;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          window.document.body.appendChild(textarea);
          textarea.select();
          window.document.execCommand('copy');
          window.document.body.removeChild(textarea);
        }
        setCopied(true);
        addToast('Path copied to clipboard', 'success');
        setTimeout(() => setCopied(false), 2000);
      } catch {
        addToast('Failed to copy path', 'error');
      }
    },
    [addToast]
  );

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
      const success = await onMove(document.entity, document.filePath, moveToEntity, moveToYear);
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
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative ml-auto w-full md:max-w-2xl bg-surface-100 shadow-2xl flex flex-col h-full animate-slide-in border-l border-border">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-3 min-w-0">
            <FileIcon fileType={document.fileType} className="w-5 h-5 text-surface-700 shrink-0" />
            <div className="min-w-0">
              {isRenaming ? (
                <div className="flex items-center gap-1.5">
                  <input
                    ref={renameInputRef}
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveRename();
                      if (e.key === 'Escape') cancelRename();
                    }}
                    onBlur={cancelRename}
                    disabled={isRenameSaving}
                    className="bg-surface-200/50 border border-border rounded-md px-2 py-0.5 text-[14px] font-semibold text-surface-950 w-full min-w-0"
                  />
                  <span className="text-[14px] font-semibold text-surface-600 shrink-0">
                    {fileExtension}
                  </span>
                  <button
                    onMouseDown={(e) => {
                      e.preventDefault();
                      saveRename();
                    }}
                    disabled={isRenameSaving}
                    className="p-1 text-success-500 hover:bg-success-500/10 rounded transition-all shrink-0"
                    title="Save"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <h2 className="font-semibold text-surface-950 truncate text-[14px]">
                    {document.fileName}
                  </h2>
                  <button
                    onClick={startRenaming}
                    className="p-1 text-surface-500 hover:text-surface-800 hover:bg-surface-300/30 rounded transition-all shrink-0"
                    title="Rename file"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              <p className="text-[12px] text-surface-700">{docTypeInfo?.label || document.type}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-surface-600 hover:text-surface-900 hover:bg-surface-300/30 rounded-lg transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Preview */}
        <div className="flex-1 overflow-hidden bg-surface-200/30">
          {canPreview ? (
            <div className="w-full h-full flex items-center justify-center p-4">
              {isImage ? (
                <img
                  src={fileUrl}
                  alt={document.fileName}
                  className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
                />
              ) : isPdf ? (
                <iframe src={fileUrl} className="w-full h-full rounded-lg bg-white" />
              ) : null}
            </div>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-surface-600">
              <File className="w-16 h-16 mb-4" />
              <p>Preview not available</p>
              <button
                onClick={handleOpenExternal}
                className="mt-4 flex items-center gap-2 text-accent-400 hover:text-accent-500"
              >
                <ExternalLink className="w-4 h-4" />
                Open in new tab
              </button>
            </div>
          )}
        </div>

        {/* Details */}
        <div className="border-t border-border p-4 space-y-4 max-h-80 overflow-y-auto">
          {/* File Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[13px]">
            <div className="flex items-center gap-2 text-surface-700">
              <HardDrive className="w-4 h-4 text-surface-600" />
              <span>{formatFileSize(document.fileSize)}</span>
            </div>
            <div className="flex items-center gap-2 text-surface-700">
              <Calendar className="w-4 h-4 text-surface-600" />
              <span>{formatDate(document.createdAt)}</span>
            </div>
            <div className="flex items-center gap-2 text-surface-700 col-span-2">
              <FolderOpen className="w-4 h-4 text-surface-600" />
              <button
                onClick={() => {
                  const entityConfig = entities?.find((e) => e.id === document.entity);
                  const fullPath = entityConfig
                    ? `${entityConfig.path}/${document.filePath}`
                    : document.filePath;
                  copyToClipboard(fullPath);
                }}
                className="truncate hover:text-accent-400 cursor-pointer text-left font-mono text-[12px]"
                title="Click to copy full path"
              >
                {copied ? 'Copied!' : document.filePath}
              </button>
            </div>
          </div>

          {/* Tags */}
          <div className="flex flex-wrap gap-1.5">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-info-500/10 text-info-400 rounded-md text-[12px]">
              <Tag className="w-3 h-3" />
              {docTypeInfo?.label || document.type}
            </span>
            {expenseInfo && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-500/10 text-emerald-400 rounded-md text-[12px]">
                {expenseInfo.label}
              </span>
            )}
            {document.taxYear > 0 && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-surface-400/15 text-surface-800 rounded-md text-[12px]">
                {document.taxYear}
              </span>
            )}
          </div>

          {/* Parsed Data */}
          {document.parsedData && (
            <div className="bg-surface-200/40 rounded-xl p-4">
              <h3 className="font-medium text-surface-950 mb-3 text-[13px]">Parsed Data</h3>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[13px]">
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
                        <dt className="text-surface-600 capitalize text-[11px]">{label}</dt>
                        <dd className="text-surface-950 font-medium">{displayValue}</dd>
                      </div>
                    );
                  })}
              </dl>
            </div>
          )}

          {!document.parsedData && (
            <div className="bg-warn-500/10 border border-warn-500/20 rounded-xl p-3 text-[13px] text-warn-400">
              This document hasn't been parsed yet. Click "Parse Document" to extract data.
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="border-t border-border p-4 flex flex-col sm:flex-row gap-2">
          <button
            onClick={handleDownload}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-surface-300/30 text-surface-800 rounded-xl hover:bg-surface-300/50 transition-all text-[13px] font-medium"
          >
            <Download className="w-4 h-4" />
            Download
          </button>
          <button
            onClick={handleReparse}
            disabled={isParsing}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-accent-500 text-surface-0 rounded-xl hover:bg-accent-400 transition-all disabled:opacity-40 text-[13px] font-medium"
          >
            <RefreshCw className={`w-4 h-4 ${isParsing ? 'animate-spin' : ''}`} />
            {isParsing ? 'Parsing...' : 'Parse Document'}
          </button>
          <button
            onClick={handleAiRename}
            disabled={isAiRenaming}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-violet-500/15 text-violet-400 rounded-xl hover:bg-violet-500/25 transition-all disabled:opacity-40 text-[13px] font-medium"
            title="AI Renaming"
          >
            <Sparkles className={`w-4 h-4 ${isAiRenaming ? 'animate-pulse' : ''}`} />
            {isAiRenaming ? 'Renaming...' : 'Rename with AI'}
          </button>
          {onMove && entities && availableYears && (
            <button
              onClick={() => setShowMoveModal(true)}
              className="flex items-center justify-center gap-2 px-4 py-2 text-warn-400 hover:bg-warn-500/10 rounded-xl transition-all"
              title="Move to different entity/year"
            >
              <MoveRight className="w-4 h-4" />
            </button>
          )}
          {onDelete && (
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className="flex items-center justify-center gap-2 px-4 py-2 text-danger-400 hover:bg-danger-500/10 rounded-xl transition-all disabled:opacity-40"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Move Modal */}
      {showMoveModal && entities && availableYears && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowMoveModal(false)}
          />
          <div className="relative glass-strong rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 animate-scale-in">
            <h3 className="text-lg font-semibold text-surface-950 mb-4">Move Document</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-[13px] font-medium text-surface-800 mb-2">
                  Entity
                </label>
                <select
                  value={moveToEntity}
                  onChange={(e) => setMoveToEntity(e.target.value as Entity)}
                  className="w-full px-3 py-2.5 bg-surface-200/50 border border-border rounded-xl text-[13px] text-surface-900"
                >
                  {entities.map((entity) => (
                    <option key={entity.id} value={entity.id}>
                      {entity.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[13px] font-medium text-surface-800 mb-2">
                  Tax Year
                </label>
                <select
                  value={moveToYear}
                  onChange={(e) => setMoveToYear(parseInt(e.target.value, 10))}
                  className="w-full px-3 py-2.5 bg-surface-200/50 border border-border rounded-xl text-[13px] text-surface-900"
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
                className="flex-1 px-4 py-2.5 text-surface-800 hover:bg-surface-300/30 rounded-xl transition-all text-[13px]"
              >
                Cancel
              </button>
              <button
                onClick={handleMove}
                disabled={
                  isMoving || (moveToEntity === document.entity && moveToYear === document.taxYear)
                }
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-warn-500 text-surface-0 rounded-xl hover:bg-warn-400 transition-all disabled:opacity-40 text-[13px] font-medium"
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
