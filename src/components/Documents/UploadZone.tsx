import { useState, useCallback } from 'react';
import { Upload, FileText, Image, File, X } from 'lucide-react';
import type { Entity, DocumentType, TaxDocument } from '../../types';
import { DOCUMENT_TYPES, EXPENSE_CATEGORIES } from '../../config';

interface UploadZoneProps {
  entity: Entity;
  taxYear: number;
  onUpload: (
    file: File,
    type: DocumentType,
    entity: Entity,
    taxYear: number,
    parsedData?: TaxDocument['parsedData']
  ) => void;
  disabled?: boolean;
}

interface PendingFile {
  file: File;
  detectedType: DocumentType;
  preview?: string;
}

// Detect document type from filename
function detectDocumentType(filename: string): DocumentType {
  const lower = filename.toLowerCase();

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
  if (/contract|agreement|w-?9|nda/i.test(lower)) return 'contract';

  return 'other';
}

function FileIcon({ fileType, className }: { fileType: string; className?: string }) {
  if (fileType.startsWith('image/')) return <Image className={className} />;
  if (fileType === 'application/pdf') return <FileText className={className} />;
  return <File className={className} />;
}

export function UploadZone({ entity, taxYear, onUpload, disabled = false }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<Map<string, DocumentType>>(new Map());
  const [selectedCategory, setSelectedCategory] = useState<Map<string, string>>(new Map());

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

      Array.from(files).forEach((file) => {
        const detectedType = detectDocumentType(file.name);
        newTypes.set(file.name, detectedType);

        const pending: PendingFile = { file, detectedType };

        // Create preview for images
        if (file.type.startsWith('image/')) {
          pending.preview = URL.createObjectURL(file);
        }

        newPending.push(pending);
      });

      setPendingFiles((prev) => [...prev, ...newPending]);
      setSelectedTypes(newTypes);
    },
    [selectedTypes]
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
  };

  const handleUploadAll = () => {
    pendingFiles.forEach(({ file }) => {
      const type = selectedTypes.get(file.name) || 'other';
      const category = selectedCategory.get(file.name);

      let parsedData: TaxDocument['parsedData'] = undefined;

      // For receipts, include the category in parsed data
      if (type === 'receipt' && category) {
        parsedData = {
          vendor: '',
          amount: 0,
          date: new Date().toISOString().split('T')[0],
          category: category as (typeof EXPENSE_CATEGORIES)[number]['id'],
        };
      }

      onUpload(file, type, entity, taxYear, parsedData);
    });

    // Clean up previews
    pendingFiles.forEach((p) => {
      if (p.preview) URL.revokeObjectURL(p.preview);
    });

    setPendingFiles([]);
    setSelectedTypes(new Map());
    setSelectedCategory(new Map());
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Drop Zone */}
      <div
        onDragEnter={disabled ? undefined : handleDragIn}
        onDragLeave={disabled ? undefined : handleDragOut}
        onDragOver={disabled ? undefined : handleDrag}
        onDrop={disabled ? undefined : handleDrop}
        className={`
          p-8 border-2 border-dashed rounded-lg m-4 transition-colors
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          ${isDragging && !disabled ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}
        `}
      >
        <label
          className={`flex flex-col items-center ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
        >
          <Upload
            className={`w-10 h-10 mb-3 ${isDragging && !disabled ? 'text-blue-500' : 'text-gray-400'}`}
          />
          <p className="text-sm text-gray-600 mb-1">
            <span className="font-medium text-blue-600">Click to upload</span> or drag and drop
          </p>
          <p className="text-xs text-gray-400">PDF, PNG, JPG, CSV files supported</p>
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
        <div className="border-t border-gray-200">
          <div className="p-4">
            <h3 className="text-sm font-medium text-gray-700 mb-3">
              {pendingFiles.length} file{pendingFiles.length > 1 ? 's' : ''} ready to upload
            </h3>
            <div className="space-y-3">
              {pendingFiles.map(({ file, preview }) => {
                const currentType = selectedTypes.get(file.name) || 'other';

                return (
                  <div key={file.name} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                    {preview ? (
                      <img
                        src={preview}
                        alt={file.name}
                        className="w-12 h-12 object-cover rounded"
                      />
                    ) : (
                      <div className="w-12 h-12 bg-gray-200 rounded flex items-center justify-center">
                        <FileIcon fileType={file.type} className="w-6 h-6 text-gray-500" />
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
                      <p className="text-xs text-gray-500">{(file.size / 1024).toFixed(1)} KB</p>

                      <div className="mt-2 flex gap-2">
                        <select
                          value={currentType}
                          onChange={(e) =>
                            handleTypeChange(file.name, e.target.value as DocumentType)
                          }
                          className="text-xs border border-gray-300 rounded px-2 py-1 bg-white"
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
                            className="text-xs border border-gray-300 rounded px-2 py-1 bg-white"
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
                    </div>

                    <button
                      onClick={() => handleRemove(file.name)}
                      className="p-1 text-gray-400 hover:text-gray-600"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>

            <button
              onClick={handleUploadAll}
              className="mt-4 w-full bg-blue-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-blue-700 transition-colors"
            >
              Upload {pendingFiles.length} file{pendingFiles.length > 1 ? 's' : ''}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
