import { useState, useCallback } from 'react';
import { Building2, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { useToast } from '../../hooks/useToast';
import type { EntityConfig } from '../../hooks/useFileSystemServer';

const LABEL_MAP: Record<string, string> = {
  ein: 'EIN',
  sosControlNumber: 'SOS Control #',
  dateFormed: 'Date Formed',
  address: 'Address',
  county: 'County',
  naicsCodes: 'NAICS Codes',
  fiscalYearEnd: 'Fiscal Year End',
  managedBy: 'Managed By',
  accountingMethod: 'Accounting Method',
  stateOfFormation: 'State of Formation',
};

function getLabel(key: string): string {
  return LABEL_MAP[key] || key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
}

function formatValue(value: string | string[]): string {
  return Array.isArray(value) ? value.join(', ') : value;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for HTTP (Unraid)
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  }
}

function MetadataField({ fieldKey, value }: { fieldKey: string; value: string | string[] }) {
  const [copied, setCopied] = useState(false);
  const { addToast } = useToast();

  const handleCopy = useCallback(async () => {
    const text = formatValue(value);
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      addToast(`Copied ${getLabel(fieldKey)}`, 'success', 2000);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [value, fieldKey, addToast]);

  return (
    <div
      onClick={handleCopy}
      className="flex items-center justify-between py-2.5 px-3 bg-surface-200/30 rounded-lg group hover:bg-surface-200/50 transition-colors cursor-pointer"
    >
      <div className="min-w-0 flex-1 mr-2">
        <p className="text-[11px] font-medium text-surface-600 uppercase tracking-wide">
          {getLabel(fieldKey)}
        </p>
        <p className="text-[13px] font-medium text-surface-950 truncate">{formatValue(value)}</p>
      </div>
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
  );
}

interface EntityMetadataBannerProps {
  entityConfig: EntityConfig | undefined;
}

export function EntityMetadataBanner({ entityConfig }: EntityMetadataBannerProps) {
  const storageKey = entityConfig ? `docvault-metadata-expanded-${entityConfig.id}` : '';
  const [isExpanded, setIsExpanded] = useState(() => {
    if (!storageKey) return false;
    return localStorage.getItem(storageKey) === 'true';
  });

  if (!entityConfig?.metadata || Object.keys(entityConfig.metadata).length === 0) {
    return null;
  }

  const entries = Object.entries(entityConfig.metadata);

  const toggleExpanded = () => {
    const next = !isExpanded;
    setIsExpanded(next);
    localStorage.setItem(storageKey, String(next));
  };

  return (
    <div className="glass-card rounded-xl mb-6 overflow-hidden">
      <button
        onClick={toggleExpanded}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-200/20 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Building2 className="w-4 h-4 text-surface-600" />
          <span className="text-[13px] font-semibold text-surface-800">
            {entityConfig.name} Info
          </span>
          <span className="text-[11px] text-surface-500">{entries.length} fields</span>
        </div>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-surface-500" />
        ) : (
          <ChevronDown className="w-4 h-4 text-surface-500" />
        )}
      </button>

      {isExpanded && (
        <div className="px-4 pb-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {entries.map(([key, value]) => (
              <MetadataField key={key} fieldKey={key} value={value} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
