// "Show N more / Show less" toggle for capped lists. Pair with the useTopN hook
// (src/hooks/useTopN.ts), which does the slicing. Component-only so React Fast
// Refresh stays happy (only-export-components).

import { ChevronDown, ChevronUp } from 'lucide-react';

/** Renders nothing when nothing is hidden. */
export function ShowMore({
  expanded,
  hiddenCount,
  onToggle,
  className = '',
}: {
  expanded: boolean;
  hiddenCount: number;
  onToggle: () => void;
  className?: string;
}) {
  if (hiddenCount <= 0) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`w-full flex items-center justify-center gap-1 py-1.5 text-xs text-surface-600 hover:text-accent-300 hover:bg-surface-100/50 rounded transition-colors ${className}`}
    >
      {expanded ? (
        <>
          <ChevronUp className="w-3.5 h-3.5" /> Show less
        </>
      ) : (
        <>
          <ChevronDown className="w-3.5 h-3.5" /> Show {hiddenCount} more
        </>
      )}
    </button>
  );
}
