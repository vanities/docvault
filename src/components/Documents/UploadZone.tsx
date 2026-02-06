import { useState, useCallback, useEffect } from 'react';
import { Upload, FileText, Image, File, X, Wand2 } from 'lucide-react';
import type { Entity, DocumentType, TaxDocument, ExpenseCategory } from '../../types';
import { DOCUMENT_TYPES, EXPENSE_CATEGORIES } from '../../config';
import {
  generateStandardFilename,
  getExtension,
  extractSourceFromFilename,
} from '../../utils/filenaming';

interface UploadZoneProps {
  entity: Entity;
  taxYear: number;
  onUpload: (
    file: File,
    type: DocumentType,
    entity: Entity,
    taxYear: number,
    parsedData?: TaxDocument['parsedData'],
    customFilename?: string
  ) => void;
  disabled?: boolean;
}

interface PendingFile {
  file: File;
  detectedType: DocumentType;
  preview?: string;
}

interface FileMetadata {
  source: string;
  description: string;
  month: number;
  day: number;
  customFilename: string;
}

// Detect document type from filename
function detectDocumentType(filename: string): DocumentType {
  const lower = filename.toLowerCase();

  // Business document detection
  if (/formation|articles.*incorporation|operating.*agreement|certificate.*formation/i.test(lower))
    return 'formation';
  if (/ein|employer.*identification/i.test(lower)) return 'ein-letter';
  if (/license|permit|registration/i.test(lower)) return 'license';

  // Tax document detection
  if (/w-?2/i.test(lower)) return 'w2';
  if (/1099-?nec/i.test(lower)) return '1099-nec';
  if (/1099-?misc/i.test(lower)) return '1099-misc';
  if (/1099-?r/i.test(lower)) return '1099-r';
  if (/1099-?div/i.test(lower)) return '1099-div';
  if (/1099-?int/i.test(lower)) return '1099-int';
  if (/1099-?b/i.test(lower)) return '1099-b';
  if (/1099/i.test(lower)) return '1099-nec'; // Default 1099 type
  if (/receipt|expense|purchase/i.test(lower)) return 'receipt';
  if (/invoice/i.test(lower)) return 'invoice';
  if (/koinly|coinbase|kraken|crypto/i.test(lower)) return 'crypto';
  if (/return|\.tax\d{4}$/i.test(lower)) return 'return';
  // Check for business agreement (contracts not in tax year context)
  if (/contract|agreement|nda/i.test(lower)) return 'business-agreement';
  if (/w-?9/i.test(lower)) return 'contract'; // W-9 stays as tax contract

  return 'other';
}

function FileIcon({ fileType, className }: { fileType: string; className?: string }) {
  if (fileType.startsWith('image/')) return <Image className={className} />;
  if (fileType === 'application/pdf') return <FileText className={className} />;
  return <File className={className} />;
}

// Month names for dropdown
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

export function UploadZone({ entity, taxYear, onUpload, disabled = false }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<Map<string, DocumentType>>(new Map());
  const [selectedCategory, setSelectedCategory] = useState<Map<string, string>>(new Map());
  const [fileMetadata, setFileMetadata] = useState<Map<string, FileMetadata>>(new Map());

  // Generate standard filename when metadata changes
  const updateGeneratedFilename = useCallback(
    (fileName: string) => {
      const docType = selectedTypes.get(fileName) || 'other';
      const category = selectedCategory.get(fileName) as ExpenseCategory | undefined;
      const metadata = fileMetadata.get(fileName);
      const pendingFile = pendingFiles.find((p) => p.file.name === fileName);

      if (!pendingFile || !metadata?.source) return;

      const extension = getExtension(pendingFile.file.name);
      const generatedName = generateStandardFilename({
        source: metadata.source,
        docType,
        year: taxYear,
        month: metadata.month || undefined,
        day: metadata.day || undefined,
        expenseCategory: category,
        description: metadata.description || undefined,
        extension,
      });

      setFileMetadata((prev) => {
        const next = new Map(prev);
        const existing = next.get(fileName) || {
          source: '',
          description: '',
          month: 0,
          day: 0,
          customFilename: '',
        };
        next.set(fileName, { ...existing, customFilename: generatedName });
        return next;
      });
    },
    [selectedTypes, selectedCategory, pendingFiles, taxYear, fileMetadata]
  );

  // Update filename when relevant fields change
  useEffect(() => {
    pendingFiles.forEach(({ file }) => {
      updateGeneratedFilename(file.name);
    });
  }, [selectedTypes, selectedCategory, fileMetadata, pendingFiles, updateGeneratedFilename]);

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

  const processFiles = useCallback(
    (files: FileList) => {
      const newPending: PendingFile[] = [];
      const newTypes = new Map(selectedTypes);
      const newMetadata = new Map(fileMetadata);

      Array.from(files).forEach((file) => {
        const detectedType = detectDocumentType(file.name);
        newTypes.set(file.name, detectedType);

        // Try to extract source from filename
        const extractedSource = extractSourceFromFilename(file.name);

        // Initialize metadata with extracted source
        newMetadata.set(file.name, {
          source: extractedSource,
          description: '',
          month: new Date().getMonth() + 1, // Current month as default
          day: 0,
          customFilename: '',
        });

        const pending: PendingFile = { file, detectedType };

        // Create preview for images
        if (file.type.startsWith('image/')) {
          pending.preview = URL.createObjectURL(file);
        }

        newPending.push(pending);
      });

      setPendingFiles((prev) => [...prev, ...newPending]);
      setSelectedTypes(newTypes);
      setFileMetadata(newMetadata);
    },
    [selectedTypes, fileMetadata]
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
      e.target.value = ''; // Reset input
    },
    [processFiles]
  );

  const handleTypeChange = (fileName: string, type: DocumentType) => {
    setSelectedTypes((prev) => new Map(prev).set(fileName, type));
  };

  const handleCategoryChange = (fileName: string, category: string) => {
    setSelectedCategory((prev) => new Map(prev).set(fileName, category));
  };

  const handleMetadataChange = (
    fileName: string,
    field: keyof FileMetadata,
    value: string | number
  ) => {
    setFileMetadata((prev) => {
      const next = new Map(prev);
      const existing = next.get(fileName) || {
        source: '',
        description: '',
        month: 0,
        day: 0,
        customFilename: '',
      };
      next.set(fileName, { ...existing, [field]: value });
      return next;
    });
  };

  const handleRemove = (fileName: string) => {
    setPendingFiles((prev) => {
      const file = prev.find((p) => p.file.name === fileName);
      if (file?.preview) {
        URL.revokeObjectURL(file.preview);
      }
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
  };

  const handleUploadAll = () => {
    pendingFiles.forEach(({ file }) => {
      const type = selectedTypes.get(file.name) || 'other';
      const category = selectedCategory.get(file.name);
      const metadata = fileMetadata.get(file.name);

      let parsedData: TaxDocument['parsedData'] = undefined;

      // For receipts, include the category in parsed data
      if (type === 'receipt' && category) {
        parsedData = {
          vendor: metadata?.source || '',
          amount: 0,
          date: new Date().toISOString().split('T')[0],
          category: category as (typeof EXPENSE_CATEGORIES)[number]['id'],
        };
      }

      // Use the custom filename if source was provided
      const customFilename = metadata?.customFilename || undefined;

      onUpload(file, type, entity, taxYear, parsedData, customFilename);
    });

    // Clean up previews
    pendingFiles.forEach((p) => {
      if (p.preview) URL.revokeObjectURL(p.preview);
    });

    setPendingFiles([]);
    setSelectedTypes(new Map());
    setSelectedCategory(new Map());
    setFileMetadata(new Map());
  };

  // Check if document type needs month input
  const needsMonth = (docType: DocumentType) => docType === 'invoice';

  // Check if document type needs day input
  const needsDay = (docType: DocumentType) => docType === 'receipt';

  // Check if document type needs description
  const needsDescription = (docType: DocumentType) => docType === 'receipt';

  return (
    <div className="glass-card rounded-xl overflow-hidden">
      {/* Drop Zone */}
      <div
        onDragEnter={disabled ? undefined : handleDragIn}
        onDragLeave={disabled ? undefined : handleDragOut}
        onDragOver={disabled ? undefined : handleDrag}
        onDrop={disabled ? undefined : handleDrop}
        className={`
          p-8 border-2 border-dashed rounded-lg m-4 transition-all duration-200
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          ${isDragging && !disabled ? 'border-accent-400 bg-accent-500/5' : 'border-surface-500 hover:border-surface-400'}
        `}
      >
        <label
          className={`flex flex-col items-center ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
        >
          <Upload
            className={`w-10 h-10 mb-3 ${isDragging && !disabled ? 'text-accent-400' : 'text-surface-600'}`}
          />
          <p className="text-[13px] text-surface-700 mb-1">
            <span className="font-medium text-accent-400">Click to upload</span> or drag and drop
          </p>
          <p className="text-[12px] text-surface-600">PDF, PNG, JPG, CSV files supported</p>
          <input
            type="file"
            multiple
            onChange={handleFileInput}
            className="hidden"
            accept=".pdf,.png,.jpg,.jpeg,.csv,.xlsx,.tax,.txf"
            disabled={disabled}
          />
        </label>
      </div>

      {/* Pending Files */}
      {pendingFiles.length > 0 && (
        <div className="border-t border-border">
          <div className="p-4">
            <h3 className="text-[13px] font-medium text-surface-800 mb-3">
              {pendingFiles.length} file{pendingFiles.length > 1 ? 's' : ''} ready to upload
            </h3>
            <div className="space-y-4">
              {pendingFiles.map(({ file, preview }) => {
                const currentType = selectedTypes.get(file.name) || 'other';
                const metadata = fileMetadata.get(file.name) || {
                  source: '',
                  description: '',
                  month: 0,
                  day: 0,
                  customFilename: '',
                };

                return (
                  <div key={file.name} className="p-3 bg-surface-200/30 rounded-lg">
                    <div className="flex items-start gap-3">
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
                        <p className="text-[13px] font-medium text-surface-950 truncate">
                          {file.name}
                        </p>
                        <p className="text-[12px] text-surface-600">
                          {(file.size / 1024).toFixed(1)} KB
                        </p>

                        {/* Document type and category */}
                        <div className="mt-2 flex gap-2">
                          <select
                            value={currentType}
                            onChange={(e) =>
                              handleTypeChange(file.name, e.target.value as DocumentType)
                            }
                            className="text-[12px] bg-surface-200/50 border border-border text-surface-900 rounded px-2 py-1"
                          >
                            {DOCUMENT_TYPES.map((dt) => (
                              <option key={dt.id} value={dt.id}>
                                {dt.label}
                              </option>
                            ))}
                          </select>

                          {currentType === 'receipt' && (
                            <select
                              value={selectedCategory.get(file.name) || ''}
                              onChange={(e) => handleCategoryChange(file.name, e.target.value)}
                              className="text-[12px] bg-surface-200/50 border border-border text-surface-900 rounded px-2 py-1"
                            >
                              <option value="">Select category...</option>
                              {EXPENSE_CATEGORIES.map((cat) => (
                                <option key={cat.id} value={cat.id}>
                                  {cat.label}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>

                        {/* Auto-naming fields */}
                        <div className="mt-3 p-2 bg-surface-200/30 rounded-lg border border-border">
                          <div className="flex items-center gap-1 mb-2 text-[12px] text-surface-600">
                            <Wand2 className="w-3 h-3" />
                            <span>Auto-naming</span>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            {/* Source/Vendor name */}
                            <div className="col-span-2">
                              <input
                                type="text"
                                placeholder="Company/Vendor name"
                                value={metadata.source}
                                onChange={(e) =>
                                  handleMetadataChange(file.name, 'source', e.target.value)
                                }
                                className="w-full text-[12px] bg-surface-200/50 border border-border text-surface-900 rounded px-2 py-1 placeholder:text-surface-500"
                              />
                            </div>

                            {/* Month selector for invoices */}
                            {needsMonth(currentType) && (
                              <select
                                value={metadata.month || ''}
                                onChange={(e) =>
                                  handleMetadataChange(file.name, 'month', parseInt(e.target.value))
                                }
                                className="text-[12px] bg-surface-200/50 border border-border text-surface-900 rounded px-2 py-1"
                              >
                                <option value="">Month...</option>
                                {MONTHS.map((m) => (
                                  <option key={m.value} value={m.value}>
                                    {m.label}
                                  </option>
                                ))}
                              </select>
                            )}

                            {/* Date fields for receipts */}
                            {needsDay(currentType) && (
                              <>
                                <select
                                  value={metadata.month || ''}
                                  onChange={(e) =>
                                    handleMetadataChange(
                                      file.name,
                                      'month',
                                      parseInt(e.target.value)
                                    )
                                  }
                                  className="text-[12px] bg-surface-200/50 border border-border text-surface-900 rounded px-2 py-1"
                                >
                                  <option value="">Month...</option>
                                  {MONTHS.map((m) => (
                                    <option key={m.value} value={m.value}>
                                      {m.label}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  type="number"
                                  min="1"
                                  max="31"
                                  placeholder="Day"
                                  value={metadata.day || ''}
                                  onChange={(e) =>
                                    handleMetadataChange(file.name, 'day', parseInt(e.target.value))
                                  }
                                  className="text-[12px] bg-surface-200/50 border border-border text-surface-900 rounded px-2 py-1 placeholder:text-surface-500"
                                />
                              </>
                            )}

                            {/* Description for receipts */}
                            {needsDescription(currentType) && (
                              <div className="col-span-2">
                                <input
                                  type="text"
                                  placeholder="Description (optional)"
                                  value={metadata.description}
                                  onChange={(e) =>
                                    handleMetadataChange(file.name, 'description', e.target.value)
                                  }
                                  className="w-full text-[12px] bg-surface-200/50 border border-border text-surface-900 rounded px-2 py-1 placeholder:text-surface-500"
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
                            </div>
                          )}
                        </div>
                      </div>

                      <button
                        onClick={() => handleRemove(file.name)}
                        className="p-1 text-surface-600 hover:text-surface-800 transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              onClick={handleUploadAll}
              className="mt-4 w-full bg-accent-500 text-surface-0 py-2.5 px-4 rounded-xl font-medium hover:bg-accent-400 transition-colors text-[13px]"
            >
              Upload {pendingFiles.length} file{pendingFiles.length > 1 ? 's' : ''}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
