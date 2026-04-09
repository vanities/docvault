import { useState, useCallback } from 'react';
import {
  Building2,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Edit3,
  Plus,
  Trash2,
  X,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useToast } from '../../hooks/useToast';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import type { EntityConfig } from '../../hooks/useFileSystemServer';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { copyToClipboard } from '../../lib/utils';
import { API_BASE } from '../../constants';

const LABEL_MAP: Record<string, string> = {
  ein: 'EIN',
  ssn: 'SSN',
  sosControlNumber: 'SOS Control #',
  dateFormed: 'Date Formed',
  address: 'Address',
  county: 'County',
  naicsCodes: 'NAICS Codes',
  fiscalYearEnd: 'Fiscal Year End',
  managedBy: 'Managed By',
  accountingMethod: 'Accounting Method',
  stateOfFormation: 'State of Formation',
  filingStatus: 'Filing Status',
  dob: 'Date of Birth',
  phone: 'Phone',
  email: 'Email',
};

// Fields that should be masked in display
const SENSITIVE_FIELDS = new Set(['ssn', 'ein', 'bankAccount', 'routingNumber']);

function getLabel(key: string): string {
  return LABEL_MAP[key] || key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
}

function formatValue(value: string | string[]): string {
  return Array.isArray(value) ? value.join(', ') : value;
}

function maskValue(value: string): string {
  if (value.length <= 4) return value;
  return '\u2022'.repeat(value.length - 4) + value.slice(-4);
}

function MetadataField({ fieldKey, value }: { fieldKey: string; value: string | string[] }) {
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const { addToast } = useToast();
  const isSensitive = SENSITIVE_FIELDS.has(fieldKey);

  const handleCopy = useCallback(async () => {
    const text = formatValue(value);
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      addToast(`Copied ${getLabel(fieldKey)}`, 'success', 2000);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [value, fieldKey, addToast]);

  const displayValue = formatValue(value);
  const shownValue = isSensitive && !revealed ? maskValue(displayValue) : displayValue;

  return (
    <div
      onClick={handleCopy}
      className="flex items-center justify-between py-2.5 px-3 bg-surface-200/30 rounded-lg group hover:bg-surface-200/50 transition-colors cursor-pointer"
    >
      <div className="min-w-0 flex-1 mr-2">
        <p className="text-[11px] font-medium text-surface-600 uppercase tracking-wide">
          {getLabel(fieldKey)}
        </p>
        <p className="text-[13px] font-medium text-surface-950 truncate font-mono">{shownValue}</p>
      </div>
      <div className="flex items-center gap-1">
        {isSensitive && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setRevealed(!revealed);
            }}
            className="p-1 rounded text-surface-400 hover:text-surface-600 transition-colors"
            title={revealed ? 'Hide' : 'Reveal'}
          >
            {revealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        )}
        <div
          className={`
            p-1 rounded transition-all flex-shrink-0
            ${
              copied
                ? 'bg-emerald-500/15 text-emerald-400'
                : 'opacity-0 group-hover:opacity-100 text-surface-500'
            }
          `}
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        </div>
      </div>
    </div>
  );
}

interface EntityMetadataBannerProps {
  entityConfig: EntityConfig | undefined;
  onEntityUpdated?: () => void;
}

export function EntityMetadataBanner({ entityConfig, onEntityUpdated }: EntityMetadataBannerProps) {
  const storageKey = entityConfig ? `docvault-metadata-expanded-${entityConfig.id}` : '';
  const { addToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const [isExpanded, setIsExpanded] = useState(() => {
    if (!storageKey) return false;
    return localStorage.getItem(storageKey) === 'true';
  });
  const [isEditing, setIsEditing] = useState(false);
  const [editFields, setEditFields] = useState<Record<string, string>>({});
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [saving, setSaving] = useState(false);

  if (!entityConfig) return null;

  const metadata = entityConfig.metadata || {};

  // Display-friendly entries: strings and string arrays only
  const displayEntries = Object.entries(metadata).filter(
    ([, value]) =>
      typeof value === 'string' ||
      (Array.isArray(value) && value.every((v) => typeof v === 'string'))
  );

  // Show banner if there are display entries OR if in edit mode (to allow adding)
  const hasDisplayEntries = displayEntries.length > 0;

  const toggleExpanded = () => {
    const next = !isExpanded;
    setIsExpanded(next);
    localStorage.setItem(storageKey, String(next));
  };

  const startEditing = () => {
    const fields: Record<string, string> = {};
    for (const [key, value] of displayEntries) {
      fields[key] = formatValue(value);
    }
    setEditFields(fields);
    setIsEditing(true);
    if (!isExpanded) {
      setIsExpanded(true);
      localStorage.setItem(storageKey, 'true');
    }
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setEditFields({});
    setNewKey('');
    setNewValue('');
  };

  const addField = () => {
    const key = newKey.trim();
    if (!key) return;
    // Convert to camelCase if user typed spaces
    const camelKey = key
      .split(/\s+/)
      .map((word, i) =>
        i === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      )
      .join('');
    setEditFields((prev) => ({ ...prev, [camelKey]: newValue.trim() }));
    setNewKey('');
    setNewValue('');
  };

  const removeField = async (key: string) => {
    if (
      !(await confirm({
        description: `Remove "${getLabel(key)}" from ${entityConfig.name}?`,
        confirmLabel: 'Remove',
        destructive: true,
      }))
    )
      return;
    setEditFields((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const saveMetadata = async () => {
    setSaving(true);
    try {
      // Build metadata update: keep internal (non-string) fields, update display fields
      const updatedMetadata: Record<string, string | string[] | null> = {};

      // Mark removed display fields as null (to delete them from the merge)
      for (const [key] of displayEntries) {
        if (!(key in editFields)) {
          updatedMetadata[key] = null;
        }
      }

      // Set new/updated values
      for (const [key, value] of Object.entries(editFields)) {
        updatedMetadata[key] = value;
      }

      const res = await fetch(`${API_BASE}/entities/${entityConfig.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metadata: updatedMetadata }),
      });

      if (!res.ok) throw new Error('Failed to save');

      addToast('Metadata saved', 'success', 2000);
      setIsEditing(false);
      onEntityUpdated?.();
    } catch {
      addToast('Failed to save metadata', 'error', 3000);
    } finally {
      setSaving(false);
    }
  };

  // If no display entries and not editing, show a minimal "add info" button
  if (!hasDisplayEntries && !isEditing) {
    return (
      <>
        <Card variant="glass" className="mb-6 overflow-hidden">
          <Button
            variant="ghost"
            onClick={startEditing}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 h-auto rounded-none"
          >
            <Plus className="w-3.5 h-3.5 text-surface-500" />
            <span className="text-[13px] text-surface-600">
              Add {entityConfig.name} info (SSN, address, etc.)
            </span>
          </Button>
        </Card>
        <ConfirmDialog />
      </>
    );
  }

  return (
    <>
      <Card variant="glass" className="mb-6 overflow-hidden">
        <div className="flex items-center">
          <Button
            variant="ghost"
            onClick={toggleExpanded}
            className="flex-1 flex items-center justify-between px-4 py-3 h-auto rounded-none"
          >
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-surface-600" />
              <span className="text-[13px] font-semibold text-surface-800">
                {entityConfig.name} Info
              </span>
              <span className="text-[11px] text-surface-500">
                {isEditing ? Object.keys(editFields).length : displayEntries.length} fields
              </span>
            </div>
            {isExpanded ? (
              <ChevronUp className="w-4 h-4 text-surface-500" />
            ) : (
              <ChevronDown className="w-4 h-4 text-surface-500" />
            )}
          </Button>
          {isExpanded && !isEditing && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={startEditing}
              className="mr-3"
              title="Edit metadata"
            >
              <Edit3 className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>

        {isExpanded && !isEditing && (
          <div className="px-4 pb-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {displayEntries.map(([key, value]) => (
                <MetadataField key={key} fieldKey={key} value={value} />
              ))}
            </div>
          </div>
        )}

        {isExpanded && isEditing && (
          <div className="px-4 pb-4">
            {/* Existing fields */}
            <div className="space-y-2 mb-4">
              {Object.entries(editFields).map(([key, value]) => (
                <div key={key} className="flex items-center gap-2">
                  <div className="w-32 shrink-0">
                    <p className="text-[11px] font-medium text-surface-600 uppercase tracking-wide">
                      {getLabel(key)}
                    </p>
                  </div>
                  <Input
                    value={value}
                    onChange={(e) => setEditFields((prev) => ({ ...prev, [key]: e.target.value }))}
                    className="h-8 rounded-lg text-sm flex-1"
                  />
                  <Button
                    variant="ghost-danger"
                    size="icon-sm"
                    onClick={() => void removeField(key)}
                    title="Remove field"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </div>

            {/* Add new field */}
            <div className="flex items-center gap-2 mb-4 p-3 bg-surface-200/30 rounded-lg">
              <Input
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="Field name (e.g., SSN)"
                className="h-8 rounded-lg text-sm w-40"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addField();
                }}
              />
              <Input
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder="Value"
                className="h-8 rounded-lg text-sm flex-1"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addField();
                }}
              />
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={addField}
                disabled={!newKey.trim()}
                title="Add field"
              >
                <Plus className="w-3.5 h-3.5" />
              </Button>
            </div>

            {/* Save/Cancel */}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={cancelEditing}>
                <X className="w-3.5 h-3.5" />
                Cancel
              </Button>
              <Button size="sm" onClick={() => void saveMetadata()} disabled={saving}>
                <Check className="w-3.5 h-3.5" />
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        )}
      </Card>
      <ConfirmDialog />
    </>
  );
}
