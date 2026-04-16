// Generic collapsible table — shows `defaultRows` rows with a toggle to expand.

import { useState } from 'react';
import { ChevronDown, ChevronUp, Table2 } from 'lucide-react';

interface CollapsibleTableProps {
  /** Card header title (e.g. "Daily activity"). */
  title: string;
  /** Total row count — shown in the header. */
  totalRows: number;
  /** How many rows to show when collapsed. Defaults to 7. */
  defaultRows?: number;
  /** The <thead> content — a single <tr> with <th> cells. */
  head: React.ReactNode;
  /** The <tbody> rows as an array of ReactNode (each a <tr>). */
  rows: React.ReactNode[];
  /** Optional extra className on the outer container. */
  className?: string;
}

export function CollapsibleTable({
  title,
  totalRows,
  defaultRows = 7,
  head,
  rows,
  className = '',
}: CollapsibleTableProps) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = totalRows > defaultRows;
  const visibleRows = canExpand && !expanded ? rows.slice(0, defaultRows) : rows;

  return (
    <div
      className={`rounded-xl border border-border/40 bg-surface-50/30 overflow-hidden ${className}`}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
        <h3 className="text-[11px] font-semibold text-surface-600 uppercase tracking-[0.12em] flex items-center gap-1.5">
          <Table2 className="w-3 h-3 text-surface-500" />
          {title}
          {totalRows > 0 && (
            <span className="text-surface-500 font-mono tabular-nums">
              ({totalRows.toLocaleString()})
            </span>
          )}
        </h3>
        {canExpand && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-[11px] text-surface-500 hover:text-accent-400 transition-colors font-medium"
          >
            {expanded ? (
              <>
                Collapse
                <ChevronUp className="w-3 h-3" />
              </>
            ) : (
              <>
                Show all
                <ChevronDown className="w-3 h-3" />
              </>
            )}
          </button>
        )}
      </div>
      {totalRows === 0 ? (
        <div className="text-sm text-surface-600 py-8 text-center">No data yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>{head}</thead>
            <tbody>{visibleRows}</tbody>
          </table>
        </div>
      )}
      {canExpand && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="w-full py-2 text-[11px] text-surface-500 hover:text-accent-400 bg-surface-100/30 border-t border-border/20 transition-colors font-medium"
        >
          Show all {totalRows.toLocaleString()} rows
        </button>
      )}
    </div>
  );
}
