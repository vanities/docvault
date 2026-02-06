import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface CopyableFieldProps {
  label: string;
  value: string | number;
  format?: 'currency' | 'number' | 'text';
  sublabel?: string;
}

function formatValue(value: string | number, format: 'currency' | 'number' | 'text'): string {
  if (format === 'currency') {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(num);
  }
  if (format === 'number') {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    return new Intl.NumberFormat('en-US').format(num);
  }
  return String(value);
}

function getRawValue(value: string | number, format: 'currency' | 'number' | 'text'): string {
  if (format === 'currency' || format === 'number') {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    return num.toFixed(2);
  }
  return String(value);
}

export function CopyableField({ label, value, format = 'currency', sublabel }: CopyableFieldProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(getRawValue(value, format));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className="flex items-center justify-between py-3 px-4 bg-surface-200/30 rounded-lg group hover:bg-surface-200/50 transition-colors">
      <div>
        <p className="text-[13px] font-medium text-surface-800">{label}</p>
        {sublabel && <p className="text-[11px] text-surface-600">{sublabel}</p>}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-lg font-semibold text-surface-950 font-mono">
          {formatValue(value, format)}
        </span>
        <button
          onClick={handleCopy}
          className={`
            p-1.5 rounded transition-all
            ${
              copied
                ? 'bg-emerald-500/15 text-emerald-400'
                : 'opacity-0 group-hover:opacity-100 bg-surface-300/30 border border-border text-surface-600 hover:text-surface-800'
            }
          `}
          title="Copy to clipboard"
        >
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
