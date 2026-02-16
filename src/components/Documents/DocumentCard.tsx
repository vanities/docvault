import { useState } from 'react';
import {
  FileText,
  Image,
  File,
  MoreVertical,
  Trash2,
  Edit2,
  Tag,
  X,
  Check,
  Sparkles,
} from 'lucide-react';
import type { TaxDocument, DocumentType } from '../../types';
import { DOCUMENT_TYPES, EXPENSE_CATEGORIES } from '../../config';

interface DocumentCardProps {
  document: TaxDocument;
  onUpdate: (id: string, updates: Partial<TaxDocument>) => void;
  onDelete: (id: string) => void;
  onClick?: () => void;
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
      return 'bg-emerald-500/15 text-emerald-400';
    case 'expense':
      return 'bg-red-500/15 text-red-400';
    case 'crypto':
      return 'bg-purple-500/15 text-purple-400';
    default:
      return 'bg-surface-400/15 text-surface-800';
  }
}

export function DocumentCard({ document: doc, onUpdate, onDelete, onClick }: DocumentCardProps) {
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

  // Extract dollar amount from parsed data
  const dollarAmount = (() => {
    if (!doc.parsedData) return null;
    const data = doc.parsedData as Record<string, unknown>;
    // Expenses: amount or totalAmount
    if (typeof data.totalAmount === 'number') return data.totalAmount;
    if (typeof data.amount === 'number') return data.amount;
    // W-2: wages
    if (typeof data.wages === 'number') return data.wages;
    // 1099-NEC: nonemployeeCompensation
    if (typeof data.nonemployeeCompensation === 'number') return data.nonemployeeCompensation;
    // 1099-DIV: ordinaryDividends
    if (typeof data.ordinaryDividends === 'number') return data.ordinaryDividends;
    // 1099-INT: interestIncome
    if (typeof data.interestIncome === 'number') return data.interestIncome;
    // 1099-MISC: rents or otherIncome
    if (typeof data.rents === 'number') return data.rents;
    if (typeof data.otherIncome === 'number') return data.otherIncome;
    // 1099-B: proceeds
    if (typeof data.proceeds === 'number') return data.proceeds;
    // Contracts/financing: nested cashPrice or totalSalePrice
    const financing = data.financing as Record<string, unknown> | undefined;
    if (financing) {
      if (typeof financing.totalSalePrice === 'number') return financing.totalSalePrice;
      if (typeof financing.cashPrice === 'number') return financing.cashPrice;
      if (typeof financing.amountFinanced === 'number') return financing.amountFinanced;
    }
    // Generic: price, total, cost at top level
    if (typeof data.price === 'number') return data.price;
    if (typeof data.total === 'number') return data.total;
    if (typeof data.cost === 'number') return data.cost;
    if (typeof data.cashPrice === 'number') return data.cashPrice;
    if (typeof data.sellingPrice === 'number') return data.sellingPrice;
    return null;
  })();

  return (
    <div
      className="glass-card rounded-xl p-4 hover:border-border-strong transition-all duration-200 cursor-pointer group"
      onClick={(e) => {
        // Don't trigger onClick if clicking on interactive elements
        if ((e.target as HTMLElement).closest('button, input, select, textarea')) return;
        onClick?.();
      }}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className="relative w-10 h-10 bg-surface-300/40 rounded-lg flex items-center justify-center flex-shrink-0">
          <FileIcon fileType={doc.fileType} className="w-5 h-5 text-surface-700" />
          {doc.parsedData && (
            <div
              className="absolute -top-1 -right-1 w-4 h-4 bg-accent-500 rounded-full flex items-center justify-center"
              title="Parsed"
            >
              <Sparkles className="w-2.5 h-2.5 text-surface-0" />
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-surface-950 truncate">{doc.fileName}</p>
              <p className="text-[11px] text-surface-600 mt-0.5">
                {formatFileSize(doc.fileSize)} · {formatDate(doc.createdAt)}
                {dollarAmount !== null && (
                  <span className="ml-1.5 font-semibold text-surface-900">
                    · $
                    {dollarAmount.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                )}
              </p>
            </div>

            {/* Menu */}
            <div className="relative">
              <button
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                className="p-2 md:p-1 text-surface-600 hover:text-surface-900 rounded opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
              >
                <MoreVertical className="w-4 h-4" />
              </button>

              {isMenuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setIsMenuOpen(false)} />
                  <div className="absolute right-0 mt-1 glass-strong rounded-lg shadow-2xl z-20 py-1 min-w-[120px] animate-scale-in">
                    <button
                      onClick={() => {
                        setIsEditing(true);
                        setIsMenuOpen(false);
                      }}
                      className="w-full px-3 py-2 text-left text-[13px] text-surface-800 hover:bg-surface-300/30 flex items-center gap-2"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      Edit
                    </button>
                    <button
                      onClick={() => {
                        onDelete(doc.id);
                        setIsMenuOpen(false);
                      }}
                      className="w-full px-3 py-2 text-left text-[13px] text-danger-400 hover:bg-danger-500/10 flex items-center gap-2"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Type badge and tags */}
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            <span
              className={`inline-flex px-2 py-0.5 rounded-md text-[11px] font-medium ${getDocumentTypeColor(doc.type)}`}
            >
              {getDocumentTypeLabel(doc.type)}
            </span>

            {expenseCategory && (
              <span className="inline-flex px-2 py-0.5 rounded-md text-[11px] font-medium bg-amber-500/15 text-amber-400">
                {expenseCategory.label}
              </span>
            )}

            {doc.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] bg-info-500/15 text-info-400"
              >
                {tag}
                <button onClick={() => handleRemoveTag(tag)} className="hover:text-info-400/80">
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
                className="w-16 text-[11px] bg-transparent border border-transparent focus:border-surface-500 rounded px-1 py-0.5 text-surface-700 placeholder-surface-600"
              />
              {newTag && (
                <button onClick={handleAddTag} className="text-info-400">
                  <Tag className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Notes */}
          {doc.notes && !isEditing && (
            <p className="text-[11px] text-surface-600 mt-2 italic">{doc.notes}</p>
          )}

          {/* Edit mode */}
          {isEditing && (
            <div className="mt-3 space-y-2 border-t border-border pt-3">
              <div>
                <label className="block text-[11px] font-medium text-surface-700 mb-1">
                  Document Type
                </label>
                <select
                  value={editedType}
                  onChange={(e) => setEditedType(e.target.value as DocumentType)}
                  className="w-full text-[13px] bg-surface-200/50 border border-border text-surface-900 rounded-lg px-2 py-1.5"
                >
                  {DOCUMENT_TYPES.map((dt) => (
                    <option key={dt.id} value={dt.id}>
                      {dt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-surface-700 mb-1">Notes</label>
                <textarea
                  value={editedNotes}
                  onChange={(e) => setEditedNotes(e.target.value)}
                  rows={2}
                  className="w-full text-[13px] bg-surface-200/50 border border-border text-surface-900 rounded-lg px-2 py-1.5"
                  placeholder="Add notes..."
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  className="flex items-center gap-1 px-2.5 py-1 bg-accent-500 text-surface-0 text-[11px] font-medium rounded-lg hover:bg-accent-400"
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
                  className="px-2.5 py-1 text-surface-700 text-[11px] hover:bg-surface-300/30 rounded-lg"
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
