import { useState } from 'react';
import { FileText, Image, File, MoreVertical, Trash2, Edit2, Tag, X, Check } from 'lucide-react';
import type { TaxDocument, DocumentType } from '../../types';
import { DOCUMENT_TYPES, EXPENSE_CATEGORIES } from '../../config';

interface DocumentCardProps {
  document: TaxDocument;
  onUpdate: (id: string, updates: Partial<TaxDocument>) => void;
  onDelete: (id: string) => void;
}

function FileIcon({ fileType, className }: { fileType: string; className?: string }) {
  if (fileType.startsWith('image/')) return <Image className={className} />;
  if (fileType === 'application/pdf') return <FileText className={className} />;
  return <File className={className} />;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getDocumentTypeLabel(type: DocumentType): string {
  return DOCUMENT_TYPES.find((dt) => dt.id === type)?.label || type;
}

function getDocumentTypeColor(type: DocumentType): string {
  const docType = DOCUMENT_TYPES.find((dt) => dt.id === type);
  switch (docType?.category) {
    case 'income':
      return 'bg-green-100 text-green-700';
    case 'expense':
      return 'bg-red-100 text-red-700';
    case 'crypto':
      return 'bg-purple-100 text-purple-700';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

export function DocumentCard({ document: doc, onUpdate, onDelete }: DocumentCardProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedType, setEditedType] = useState(doc.type);
  const [editedNotes, setEditedNotes] = useState(doc.notes || '');
  const [newTag, setNewTag] = useState('');

  const handleSave = () => {
    onUpdate(doc.id, {
      type: editedType,
      notes: editedNotes,
    });
    setIsEditing(false);
  };

  const handleAddTag = () => {
    if (newTag.trim() && !doc.tags.includes(newTag.trim())) {
      onUpdate(doc.id, { tags: [...doc.tags, newTag.trim()] });
      setNewTag('');
    }
  };

  const handleRemoveTag = (tag: string) => {
    onUpdate(doc.id, { tags: doc.tags.filter((t) => t !== tag) });
  };

  // Get expense category if this is a receipt
  const expenseCategory =
    doc.type === 'receipt' && doc.parsedData
      ? EXPENSE_CATEGORIES.find((c) => c.id === (doc.parsedData as { category?: string })?.category)
      : null;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
          <FileIcon fileType={doc.fileType} className="w-5 h-5 text-gray-500" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{doc.fileName}</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {formatFileSize(doc.fileSize)} · {formatDate(doc.createdAt)}
              </p>
            </div>

            {/* Menu */}
            <div className="relative">
              <button
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded"
              >
                <MoreVertical className="w-4 h-4" />
              </button>

              {isMenuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setIsMenuOpen(false)} />
                  <div className="absolute right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1 min-w-[120px]">
                    <button
                      onClick={() => {
                        setIsEditing(true);
                        setIsMenuOpen(false);
                      }}
                      className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                    >
                      <Edit2 className="w-4 h-4" />
                      Edit
                    </button>
                    <button
                      onClick={() => {
                        onDelete(doc.id);
                        setIsMenuOpen(false);
                      }}
                      className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Type badge and tags */}
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <span
              className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${getDocumentTypeColor(doc.type)}`}
            >
              {getDocumentTypeLabel(doc.type)}
            </span>

            {expenseCategory && (
              <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-700">
                {expenseCategory.label}
              </span>
            )}

            {doc.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-700"
              >
                {tag}
                <button onClick={() => handleRemoveTag(tag)} className="hover:text-blue-900">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}

            {/* Add tag button */}
            <div className="inline-flex items-center gap-1">
              <input
                type="text"
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
                placeholder="Add tag..."
                className="w-20 text-xs border border-transparent focus:border-gray-300 rounded px-1 py-0.5 focus:outline-none"
              />
              {newTag && (
                <button onClick={handleAddTag} className="text-blue-600">
                  <Tag className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Notes */}
          {doc.notes && !isEditing && (
            <p className="text-xs text-gray-500 mt-2 italic">{doc.notes}</p>
          )}

          {/* Edit mode */}
          {isEditing && (
            <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Document Type
                </label>
                <select
                  value={editedType}
                  onChange={(e) => setEditedType(e.target.value as DocumentType)}
                  className="w-full text-sm border border-gray-300 rounded px-2 py-1"
                >
                  {DOCUMENT_TYPES.map((dt) => (
                    <option key={dt.id} value={dt.id}>
                      {dt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  value={editedNotes}
                  onChange={(e) => setEditedNotes(e.target.value)}
                  rows={2}
                  className="w-full text-sm border border-gray-300 rounded px-2 py-1"
                  placeholder="Add notes..."
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  className="flex items-center gap-1 px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700"
                >
                  <Check className="w-3 h-3" />
                  Save
                </button>
                <button
                  onClick={() => {
                    setIsEditing(false);
                    setEditedType(doc.type);
                    setEditedNotes(doc.notes || '');
                  }}
                  className="px-2 py-1 text-gray-600 text-xs hover:bg-gray-100 rounded"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
