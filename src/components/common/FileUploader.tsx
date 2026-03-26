import { useState, useCallback, useEffect, useRef } from 'react';
import { Upload, X, Wand2, Sparkles, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import type { Entity, DocumentType, TaxDocument, ExpenseCategory } from '../../types';
import { DOCUMENT_TYPES, EXPENSE_CATEGORIES } from '../../config';
import {
  generateStandardFilename,
  getExtension,
  extractSourceFromFilename,
} from '../../utils/filenaming';
import { detectDocumentType } from '../../utils/documentDetection';
import { FileIcon } from './FileIcon';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Controls whether AI parsing runs on uploaded files */
export type ParseMode = 'always' | 'optional' | 'never';

export interface FileUploaderProps {
  /** Current entity for the upload */
  entity: Entity;
  /** Tax year (0 for non-year-based uploads like business docs) */
  taxYear: number;
  /** Available years for year switcher (omit to hide) */
  availableYears?: number[];
  /** Called for each file to actually upload it */
  onUpload: (
    file: File,
    type: DocumentType,
    entity: Entity,
    taxYear: number,
    parsedData?: TaxDocument['parsedData'],
    customFilename?: string
  ) => Promise<boolean | void>;
  /** Disable all interactions */
  disabled?: boolean;

  // --- Configuration ---

  /** Which document types to show in the type picker. Defaults to all. */
  allowedDocTypes?: DocumentType[];
  /** Default document type for new files. Defaults to 'other'. */
  defaultDocType?: DocumentType;
  /** File accept string for the input. Defaults to common doc types. */
  accept?: string;
  /** Whether / how AI parsing should work: 'always' | 'optional' | 'never' */
  parseMode?: ParseMode;
  /** Label for the upload zone. */
  label?: string;
  /** Subtitle text for the upload zone. */
  subtitle?: string;
  /** Compact mode for embedding in modals / tight spaces */
  compact?: boolean;
  /** Called after all files finish uploading (success or fail) */
  onComplete?: (results: { succeeded: number; failed: number }) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MONTHS = [
  { value: 1, label: 'January' },
  { value: 2, label: 'February' },
  { value: 3, label: 'March' },
  { value: 4, label: 'April' },
  { value: 5, label: 'May' },
  { value: 6, label: 'June' },
  { value: 7, label: 'July' },
  { value: 8, label: 'August' },
  { value: 9, label: 'September' },
  { value: 10, label: 'October' },
  { value: 11, label: 'November' },
  { value: 12, label: 'December' },
];

const DEFAULT_ACCEPT = '.pdf,.png,.jpg,.jpeg,.csv,.xlsx,.tax,.txf,.doc,.docx';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface FileMetadata {
  source: string;
  description: string;
  year: number;
  month: number;
  day: number;
  customFilename: string;
}

type UploadStatus = 'pending' | 'uploading' | 'success' | 'failed';

interface PendingFile {
  file: File;
  detectedType: DocumentType;
  preview?: string;
  uploadStatus: UploadStatus;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FileUploader({
  entity,
  taxYear,
  availableYears,
  onUpload,
  disabled = false,
  allowedDocTypes,
  defaultDocType = 'other',
  accept = DEFAULT_ACCEPT,
  parseMode = 'never',
  label,
  subtitle,
  compact = false,
  onComplete,
}: FileUploaderProps) {
  // --- State ---
  const [isDragging, setIsDragging] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<Map<string, DocumentType>>(new Map());
  const [selectedCategory, setSelectedCategory] = useState<Map<string, string>>(new Map());
  const [fileMetadata, setFileMetadata] = useState<Map<string, FileMetadata>>(new Map());
  const [aiLoading, setAiLoading] = useState<Set<string>>(new Set());
  const [aiParsedData, setAiParsedData] = useState<Map<string, Record<string, unknown>>>(new Map());
  const [aiError, setAiError] = useState<Map<string, string>>(new Map());
  const [userEditedFields, setUserEditedFields] = useState<Map<string, Set<string>>>(new Map());
  const [isUploading, setIsUploading] = useState(false);
  const [parseEnabled, setParseEnabled] = useState(parseMode === 'always');

  // Refs for async-safe access
  const userEditedFieldsRef = useRef(userEditedFields);
  userEditedFieldsRef.current = userEditedFields;
  const fileMetadataRef = useRef(fileMetadata);
  fileMetadataRef.current = fileMetadata;

  // Derived
  const shouldParse = parseMode === 'always' || (parseMode === 'optional' && parseEnabled);
  const docTypes = allowedDocTypes
    ? DOCUMENT_TYPES.filter((dt) => allowedDocTypes.includes(dt.id))
    : DOCUMENT_TYPES;

  // --- AI filename suggestion ---
  const suggestFilename = useCallback(
    async (file: File) => {
      setAiLoading((prev) => new Set(prev).add(file.name));

      try {
        const arrayBuffer = await file.arrayBuffer();
        const response = await fetch(
          `/api/suggest-filename?filename=${encodeURIComponent(file.name)}&year=${taxYear}`,
          {
            method: 'POST',
            body: arrayBuffer,
            headers: { 'Content-Type': file.type || 'application/octet-stream' },
          }
        );
        if (!response.ok) {
          setAiError((prev) =>
            new Map(prev).set(file.name, `AI analysis failed (${response.status})`)
          );
          return;
        }
        const data = await response.json();

        if (data.ok && data.suggestion) {
          const s = data.suggestion;
          const edited = userEditedFieldsRef.current.get(file.name) || new Set();

          if (s.documentType && !edited.has('type')) {
            setSelectedTypes((prev) =>
              new Map(prev).set(file.name, s.documentType as DocumentType)
            );
          }
          if (s.expenseCategory && s.expenseCategory !== 'other' && !edited.has('category')) {
            setSelectedCategory((prev) => new Map(prev).set(file.name, s.expenseCategory));
          }

          setFileMetadata((prev) => {
            const next = new Map(prev);
            const existing = next.get(file.name) || {
              source: '',
              description: '',
              year: 0,
              month: 0,
              day: 0,
              customFilename: '',
            };
            next.set(file.name, {
              ...existing,
              source: !edited.has('source') ? s.source || existing.source : existing.source,
              description: !edited.has('description')
                ? s.description || existing.description
                : existing.description,
              year: !edited.has('year') ? s.year || existing.year : existing.year,
              month: !edited.has('month') ? s.month || existing.month : existing.month,
              day: !edited.has('day') ? s.day || existing.day : existing.day,
            });
            return next;
          });

          if (data.parsedData) {
            setAiParsedData((prev) => new Map(prev).set(file.name, data.parsedData));
          }
          setAiError((prev) => {
            const next = new Map(prev);
            next.delete(file.name);
            return next;
          });
        } else {
          setAiError((prev) =>
            new Map(prev).set(file.name, data.error || 'AI analysis returned no data')
          );
        }
      } catch {
        setAiError((prev) =>
          new Map(prev).set(file.name, 'AI analysis failed — check API key in Settings')
        );
      } finally {
        setAiLoading((prev) => {
          const next = new Set(prev);
          next.delete(file.name);
          return next;
        });
      }
    },
    [taxYear]
  );

  // --- Filename generation ---
  const updateGeneratedFilename = useCallback(
    (fileName: string) => {
      const docType = selectedTypes.get(fileName) || defaultDocType;
      const category = selectedCategory.get(fileName) as ExpenseCategory | undefined;
      const metadata = fileMetadataRef.current.get(fileName);
      const pendingFile = pendingFiles.find((p) => p.file.name === fileName);

      if (!pendingFile || !metadata?.source) return;

      const extension = getExtension(pendingFile.file.name);
      const effectiveYear = metadata.year || taxYear;
      const generatedName = generateStandardFilename({
        source: metadata.source,
        docType,
        year: effectiveYear,
        month: metadata.month || undefined,
        day: metadata.day || undefined,
        expenseCategory: category,
        description: metadata.description || undefined,
        extension,
      });

      setFileMetadata((prev) => {
        const existing = prev.get(fileName);
        if (existing && existing.customFilename === generatedName) return prev;
        const next = new Map(prev);
        const base = existing || {
          source: '',
          description: '',
          year: 0,
          month: 0,
          day: 0,
          customFilename: '',
        };
        next.set(fileName, { ...base, customFilename: generatedName });
        return next;
      });
    },
    [selectedTypes, selectedCategory, pendingFiles, taxYear, defaultDocType]
  );

  useEffect(() => {
    if (shouldParse) {
      pendingFiles.forEach(({ file }) => {
        updateGeneratedFilename(file.name);
      });
    }
  }, [
    selectedTypes,
    selectedCategory,
    fileMetadata,
    pendingFiles,
    updateGeneratedFilename,
    shouldParse,
  ]);

  // --- Drag & Drop ---
  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragIn = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragOut = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  // --- Process incoming files ---
  const processFiles = useCallback(
    (files: FileList) => {
      const newPending: PendingFile[] = [];
      const newFileTypes: [string, DocumentType][] = [];
      const newFileMeta: [string, FileMetadata][] = [];
      const filesToSuggest: File[] = [];

      Array.from(files).forEach((file) => {
        const detectedType = detectDocumentType(file.name);
        // If we have an allowed list, constrain the detected type
        const resolvedType =
          allowedDocTypes && !allowedDocTypes.includes(detectedType)
            ? defaultDocType
            : detectedType;

        newFileTypes.push([file.name, resolvedType]);

        const extractedSource = extractSourceFromFilename(file.name);
        newFileMeta.push([
          file.name,
          {
            source: extractedSource,
            description: '',
            year: 0,
            month: new Date().getMonth() + 1,
            day: 0,
            customFilename: '',
          },
        ]);

        const pending: PendingFile = { file, detectedType: resolvedType, uploadStatus: 'pending' };
        if (file.type.startsWith('image/')) {
          pending.preview = URL.createObjectURL(file);
        }

        newPending.push(pending);
        if (shouldParse) filesToSuggest.push(file);
      });

      setPendingFiles((prev) => [...prev, ...newPending]);
      setSelectedTypes((prev) => {
        const next = new Map(prev);
        newFileTypes.forEach(([name, type]) => next.set(name, type));
        return next;
      });
      setFileMetadata((prev) => {
        const next = new Map(prev);
        newFileMeta.forEach(([name, meta]) => next.set(name, meta));
        return next;
      });

      filesToSuggest.forEach((file) => suggestFilename(file));
    },
    [suggestFilename, shouldParse, allowedDocTypes, defaultDocType]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      if (e.dataTransfer.files?.length) {
        processFiles(e.dataTransfer.files);
      }
    },
    [processFiles]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.length) {
        processFiles(e.target.files);
      }
      e.target.value = '';
    },
    [processFiles]
  );

  // --- User edits ---
  const markUserEdited = (fileName: string, field: string) => {
    setUserEditedFields((prev) => {
      const next = new Map(prev);
      const fields = new Set(next.get(fileName) || []);
      fields.add(field);
      next.set(fileName, fields);
      userEditedFieldsRef.current = next;
      return next;
    });
  };

  const handleTypeChange = (fileName: string, type: DocumentType) => {
    markUserEdited(fileName, 'type');
    setSelectedTypes((prev) => new Map(prev).set(fileName, type));
  };

  const handleCategoryChange = (fileName: string, category: string) => {
    markUserEdited(fileName, 'category');
    setSelectedCategory((prev) => new Map(prev).set(fileName, category));
  };

  const handleMetadataChange = (
    fileName: string,
    field: keyof FileMetadata,
    value: string | number
  ) => {
    markUserEdited(fileName, field);
    setFileMetadata((prev) => {
      const next = new Map(prev);
      const existing = next.get(fileName) || {
        source: '',
        description: '',
        year: 0,
        month: 0,
        day: 0,
        customFilename: '',
      };
      next.set(fileName, { ...existing, [field]: value } as FileMetadata);
      return next;
    });
  };

  const handleRemove = (fileName: string) => {
    setPendingFiles((prev) => {
      const file = prev.find((p) => p.file.name === fileName);
      if (file?.preview) URL.revokeObjectURL(file.preview);
      return prev.filter((p) => p.file.name !== fileName);
    });
    setSelectedTypes((prev) => {
      const next = new Map(prev);
      next.delete(fileName);
      return next;
    });
    setFileMetadata((prev) => {
      const next = new Map(prev);
      next.delete(fileName);
      return next;
    });
    setUserEditedFields((prev) => {
      const next = new Map(prev);
      next.delete(fileName);
      return next;
    });
    setAiError((prev) => {
      const next = new Map(prev);
      next.delete(fileName);
      return next;
    });
    setAiParsedData((prev) => {
      const next = new Map(prev);
      next.delete(fileName);
      return next;
    });
  };

  // --- Upload all ---
  const handleUploadAll = async () => {
    setIsUploading(true);
    let succeeded = 0;
    let failed = 0;

    for (const { file } of pendingFiles) {
      const type = selectedTypes.get(file.name) || defaultDocType;
      const category = selectedCategory.get(file.name);
      const metadata = fileMetadata.get(file.name);

      // Mark this file as uploading
      setPendingFiles((prev) =>
        prev.map((p) =>
          p.file.name === file.name ? { ...p, uploadStatus: 'uploading' as UploadStatus } : p
        )
      );

      let parsedData: TaxDocument['parsedData'] = aiParsedData.get(
        file.name
      ) as TaxDocument['parsedData'];

      if (!parsedData && type === 'receipt' && category) {
        parsedData = {
          vendor: metadata?.source || '',
          amount: 0,
          date: new Date().toISOString().split('T')[0],
          category: category as (typeof EXPENSE_CATEGORIES)[number]['id'],
        };
      }

      if (parsedData && type === 'receipt' && category) {
        (parsedData as unknown as Record<string, unknown>).category = category;
      }

      const customFilename = shouldParse ? metadata?.customFilename || undefined : undefined;
      const effectiveYear = metadata?.year || taxYear;

      try {
        const result = await onUpload(
          file,
          type,
          entity,
          effectiveYear,
          shouldParse ? parsedData : undefined,
          customFilename
        );

        const status: UploadStatus = result === false ? 'failed' : 'success';
        setPendingFiles((prev) =>
          prev.map((p) => (p.file.name === file.name ? { ...p, uploadStatus: status } : p))
        );
        if (status === 'success') succeeded++;
        else failed++;
      } catch {
        setPendingFiles((prev) =>
          prev.map((p) =>
            p.file.name === file.name ? { ...p, uploadStatus: 'failed' as UploadStatus } : p
          )
        );
        failed++;
      }
    }

    setIsUploading(false);
    onComplete?.({ succeeded, failed });

    // Auto-clear successful files after a short delay; keep failures visible
    setTimeout(() => {
      setPendingFiles((prev) => {
        prev.forEach((p) => {
          if (p.preview && p.uploadStatus === 'success') URL.revokeObjectURL(p.preview);
        });
        const remaining = prev.filter((p) => p.uploadStatus === 'failed');
        if (remaining.length === 0) {
          // Full reset
          setSelectedTypes(new Map());
          setSelectedCategory(new Map());
          setFileMetadata(new Map());
          setAiParsedData(new Map());
          setUserEditedFields(new Map());
          setAiError(new Map());
        }
        return remaining;
      });
    }, 1500);
  };

  // --- Helpers ---
  const needsMonth = (docType: DocumentType) => docType === 'invoice';
  const needsDay = (docType: DocumentType) => docType === 'receipt';
  const needsDescription = (docType: DocumentType) => docType === 'receipt';

  const uploadablePending = pendingFiles.filter(
    (p) => p.uploadStatus === 'pending' || p.uploadStatus === 'failed'
  );
  const aiStillLoading = aiLoading.size > 0;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Card variant="glass" className="overflow-hidden">
      {/* Drop Zone */}
      <div
        onDragEnter={disabled ? undefined : handleDragIn}
        onDragLeave={disabled ? undefined : handleDragOut}
        onDragOver={disabled ? undefined : handleDrag}
        onDrop={disabled ? undefined : handleDrop}
        className={`
          ${compact ? 'p-4' : 'p-8'} border-2 border-dashed rounded-lg m-4 transition-all duration-200
          ${disabled || isUploading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          ${isDragging && !disabled ? 'border-accent-400 bg-accent-500/5' : 'border-surface-500 hover:border-surface-400'}
        `}
      >
        <label
          className={`flex flex-col items-center ${disabled || isUploading ? 'cursor-not-allowed' : 'cursor-pointer'}`}
        >
          <Upload
            className={`${compact ? 'w-6 h-6 mb-1' : 'w-10 h-10 mb-3'} ${isDragging && !disabled ? 'text-accent-400' : 'text-surface-600'}`}
          />
          <p className="text-[13px] text-surface-700 mb-1">
            <span className="font-medium text-accent-400">{label || 'Click to upload'}</span>
            {!compact && ' or drag and drop'}
          </p>
          {subtitle && <p className="text-[12px] text-surface-600">{subtitle}</p>}
          <input
            type="file"
            multiple
            onChange={handleFileInput}
            className="hidden"
            accept={accept}
            disabled={disabled || isUploading}
          />
        </label>
      </div>

      {/* Optional parse toggle (only when parseMode is 'optional') */}
      {parseMode === 'optional' && pendingFiles.length > 0 && (
        <div className="px-4 pb-2">
          <label className="flex items-center gap-2 text-[12px] text-surface-600 cursor-pointer">
            <input
              type="checkbox"
              checked={parseEnabled}
              onChange={(e) => {
                setParseEnabled(e.target.checked);
                // If turning on parsing, trigger AI for any files that haven't been analyzed
                if (e.target.checked) {
                  pendingFiles.forEach(({ file }) => {
                    if (!aiParsedData.has(file.name) && !aiLoading.has(file.name)) {
                      suggestFilename(file);
                    }
                  });
                }
              }}
              className="rounded border-border text-accent-500 focus:ring-accent-500"
            />
            <Sparkles className="w-3 h-3 text-purple-400" />
            AI parse &amp; auto-name files
          </label>
        </div>
      )}

      {/* Pending Files */}
      {pendingFiles.length > 0 && (
        <div className="border-t border-border">
          <div className="p-4">
            <h3 className="text-[13px] font-medium text-surface-800 mb-3">
              {pendingFiles.length} file{pendingFiles.length > 1 ? 's' : ''} ready to upload
            </h3>
            <div className="space-y-4">
              {pendingFiles.map(({ file, preview, uploadStatus }) => {
                const currentType = selectedTypes.get(file.name) || defaultDocType;
                const metadata = fileMetadata.get(file.name) || {
                  source: '',
                  description: '',
                  year: 0,
                  month: 0,
                  day: 0,
                  customFilename: '',
                };

                const isFileUploading = uploadStatus === 'uploading';
                const isFileSuccess = uploadStatus === 'success';
                const isFileFailed = uploadStatus === 'failed';

                return (
                  <div
                    key={file.name}
                    className={`p-3 rounded-lg transition-colors ${
                      isFileSuccess
                        ? 'bg-emerald-500/10 border border-emerald-500/20'
                        : isFileFailed
                          ? 'bg-red-500/10 border border-red-500/20'
                          : 'bg-surface-200/30'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Thumbnail / icon */}
                      {preview ? (
                        <img
                          src={preview}
                          alt={file.name}
                          className="w-12 h-12 object-cover rounded"
                        />
                      ) : (
                        <div className="w-12 h-12 bg-surface-300/40 rounded flex items-center justify-center">
                          <FileIcon fileType={file.type} className="w-6 h-6 text-surface-600" />
                        </div>
                      )}

                      <div className="flex-1 min-w-0">
                        {/* Filename + size */}
                        <div className="flex items-center gap-2">
                          <p className="text-[13px] font-medium text-surface-950 truncate">
                            {file.name}
                          </p>
                          {isFileUploading && (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-accent-400 flex-shrink-0" />
                          )}
                          {isFileSuccess && (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                          )}
                          {isFileFailed && (
                            <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                          )}
                        </div>
                        <p className="text-[12px] text-surface-600">
                          {(file.size / 1024).toFixed(1)} KB
                          {isFileUploading && ' — uploading...'}
                          {isFileSuccess && ' — uploaded'}
                          {isFileFailed && ' — failed'}
                        </p>

                        {/* Type / category selectors — hide once uploading */}
                        {!isFileUploading && !isFileSuccess && (
                          <>
                            <div className="mt-2 flex gap-2 flex-wrap">
                              <Select
                                value={currentType}
                                onValueChange={(val) =>
                                  handleTypeChange(file.name, val as DocumentType)
                                }
                              >
                                <SelectTrigger className="h-7 text-[12px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {docTypes.map((dt) => (
                                    <SelectItem key={dt.id} value={dt.id}>
                                      {dt.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>

                              {currentType === 'receipt' && (
                                <Select
                                  value={selectedCategory.get(file.name) || undefined}
                                  onValueChange={(val) => handleCategoryChange(file.name, val)}
                                >
                                  <SelectTrigger className="h-7 text-[12px]">
                                    <SelectValue placeholder="Select category..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {EXPENSE_CATEGORIES.map((cat) => (
                                      <SelectItem key={cat.id} value={cat.id}>
                                        {cat.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}

                              {availableYears && availableYears.length > 0 && (
                                <Select
                                  value={String(metadata.year || taxYear)}
                                  onValueChange={(val) =>
                                    handleMetadataChange(file.name, 'year', parseInt(val, 10))
                                  }
                                >
                                  <SelectTrigger className="h-7 text-[12px]">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {availableYears.map((yr) => (
                                      <SelectItem key={yr} value={String(yr)}>
                                        {yr}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                            </div>

                            {/* Auto-naming panel (only when parsing is active) */}
                            {shouldParse && (
                              <div className="mt-3 p-2 bg-surface-200/30 rounded-lg border border-border">
                                <div className="flex items-center gap-1 mb-2 text-[12px] text-surface-600">
                                  {aiLoading.has(file.name) ? (
                                    <>
                                      <Loader2 className="w-3 h-3 animate-spin text-purple-400" />
                                      <span className="text-purple-400">
                                        AI analyzing &amp; parsing...
                                      </span>
                                    </>
                                  ) : aiError.has(file.name) ? (
                                    <>
                                      <X className="w-3 h-3 text-red-400" />
                                      <span className="text-red-400 truncate flex-1">
                                        {aiError.get(file.name)}
                                      </span>
                                      <Button
                                        variant="ghost"
                                        size="xs"
                                        onClick={() => suggestFilename(file)}
                                        className="ml-auto text-purple-400 hover:bg-purple-500/10"
                                        title="Retry AI analysis"
                                      >
                                        <Sparkles className="w-3 h-3" />
                                        Retry
                                      </Button>
                                    </>
                                  ) : (
                                    <>
                                      <Wand2 className="w-3 h-3" />
                                      <span>Auto-naming</span>
                                      <Button
                                        variant="ghost"
                                        size="xs"
                                        onClick={() => suggestFilename(file)}
                                        className="ml-auto text-purple-400 hover:bg-purple-500/10"
                                        title="Re-analyze with AI"
                                      >
                                        <Sparkles className="w-3 h-3" />
                                        AI
                                      </Button>
                                    </>
                                  )}
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  {/* Source/Vendor */}
                                  <div className="col-span-2">
                                    <Input
                                      type="text"
                                      placeholder="Company/Vendor name"
                                      value={metadata.source}
                                      onChange={(e) =>
                                        handleMetadataChange(file.name, 'source', e.target.value)
                                      }
                                      className="h-7 text-[12px] rounded px-2"
                                    />
                                  </div>

                                  {needsMonth(currentType) && (
                                    <Select
                                      value={metadata.month ? String(metadata.month) : undefined}
                                      onValueChange={(val) =>
                                        handleMetadataChange(file.name, 'month', parseInt(val))
                                      }
                                    >
                                      <SelectTrigger className="h-7 text-[12px]">
                                        <SelectValue placeholder="Month..." />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {MONTHS.map((m) => (
                                          <SelectItem key={m.value} value={String(m.value)}>
                                            {m.label}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  )}

                                  {needsDay(currentType) && (
                                    <>
                                      <Select
                                        value={metadata.month ? String(metadata.month) : undefined}
                                        onValueChange={(val) =>
                                          handleMetadataChange(file.name, 'month', parseInt(val))
                                        }
                                      >
                                        <SelectTrigger className="h-7 text-[12px]">
                                          <SelectValue placeholder="Month..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {MONTHS.map((m) => (
                                            <SelectItem key={m.value} value={String(m.value)}>
                                              {m.label}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                      <Input
                                        type="number"
                                        min={1}
                                        max={31}
                                        placeholder="Day"
                                        value={metadata.day || ''}
                                        onChange={(e) =>
                                          handleMetadataChange(
                                            file.name,
                                            'day',
                                            parseInt(e.target.value)
                                          )
                                        }
                                        className="h-7 text-[12px] rounded px-2"
                                      />
                                    </>
                                  )}

                                  {needsDescription(currentType) && (
                                    <div className="col-span-2">
                                      <Input
                                        type="text"
                                        placeholder="Description (optional)"
                                        value={metadata.description}
                                        onChange={(e) =>
                                          handleMetadataChange(
                                            file.name,
                                            'description',
                                            e.target.value
                                          )
                                        }
                                        className="h-7 text-[12px] rounded px-2"
                                      />
                                    </div>
                                  )}
                                </div>

                                {/* Generated filename preview */}
                                {metadata.source && metadata.customFilename && (
                                  <div className="mt-2 text-[12px]">
                                    <span className="text-surface-600">Will save as: </span>
                                    <span className="font-mono text-accent-400">
                                      {metadata.customFilename}
                                    </span>
                                    {metadata.year > 0 && metadata.year !== taxYear && (
                                      <span className="ml-2 text-amber-400">
                                        → {metadata.year} folder
                                      </span>
                                    )}
                                  </div>
                                )}

                                {/* Parsed data summary */}
                                {(() => {
                                  const pd = aiParsedData.get(file.name);
                                  if (!pd) return null;

                                  const amount =
                                    (pd.totalAmount as number) ||
                                    (pd.amount as number) ||
                                    (pd.wages as number) ||
                                    (pd.nonemployeeCompensation as number) ||
                                    (pd.ordinaryDividends as number) ||
                                    (pd.interestIncome as number) ||
                                    null;
                                  const vendor =
                                    (pd.vendor as string) ||
                                    (pd.employerName as string) ||
                                    (pd.payerName as string);
                                  const date = pd.date as string;
                                  const items = pd.items as
                                    | { description: string; price: number }[]
                                    | undefined;

                                  if (!amount && !vendor) return null;

                                  return (
                                    <div className="mt-2 p-1.5 bg-emerald-500/5 border border-emerald-500/15 rounded text-[11px] space-y-0.5">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        {amount != null && (
                                          <span className="font-semibold text-emerald-400">
                                            $
                                            {amount.toLocaleString('en-US', {
                                              minimumFractionDigits: 2,
                                              maximumFractionDigits: 2,
                                            })}
                                          </span>
                                        )}
                                        {vendor && (
                                          <span className="text-surface-700">{vendor}</span>
                                        )}
                                        {date && <span className="text-surface-600">{date}</span>}
                                      </div>
                                      {items && items.length > 0 && (
                                        <div className="text-surface-600">
                                          {items.slice(0, 3).map((item, i) => (
                                            <span key={i}>
                                              {i > 0 && ' · '}
                                              {item.description}
                                              {item.price != null && (
                                                <span className="text-surface-700">
                                                  {' '}
                                                  ${item.price.toFixed(2)}
                                                </span>
                                              )}
                                            </span>
                                          ))}
                                          {items.length > 3 && (
                                            <span className="text-surface-500">
                                              {' '}
                                              +{items.length - 3} more
                                            </span>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()}
                              </div>
                            )}
                          </>
                        )}
                      </div>

                      {/* Remove button — not when uploading/success */}
                      {!isFileUploading && !isFileSuccess && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => handleRemove(file.name)}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Upload button + progress summary */}
            {uploadablePending.length > 0 && (
              <Button
                onClick={handleUploadAll}
                disabled={isUploading || (shouldParse && aiStillLoading)}
                className="mt-4 w-full"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Uploading...
                  </>
                ) : shouldParse && aiStillLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Parsing {aiLoading.size} file{aiLoading.size > 1 ? 's' : ''}...
                  </>
                ) : (
                  <>
                    Upload {uploadablePending.length} file
                    {uploadablePending.length > 1 ? 's' : ''}
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
