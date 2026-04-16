// Generic collapsible table — shows `defaultRows` rows with a toggle to expand.
// Renders a full <table> inside a Card, with the expand/collapse button below.

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Card } from '@/components/ui/card';

interface CollapsibleTableProps {
  /** Card header title (e.g. "Last 14 days"). Count is appended automatically. */
  title: string;
  /** Total row count — shown in the header as "(N)". */
  totalRows: number;
  /** How many rows to show when collapsed. Defaults to 7. */
  defaultRows?: number;
  /** The <thead> content — a single <tr> with <th> cells. */
  head: React.ReactNode;
  /** The <tbody> rows as an array of ReactNode (each a <tr>). */
  rows: React.ReactNode[];
  /** Optional extra className on the outer Card. */
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
    <Card className={`p-5 ${className}`}>
      <h3 className="font-medium text-surface-950 mb-3">
        {title}
        {totalRows > 0 && (
          <span className="text-surface-500 font-normal ml-1">({totalRows.toLocaleString()})</span>
        )}
      </h3>
      {totalRows === 0 ? (
        <div className="text-sm text-surface-600 py-4">No data yet.</div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>{head}</thead>
              <tbody>{visibleRows}</tbody>
            </table>
          </div>
          {canExpand && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="mt-3 w-full flex items-center justify-center gap-1.5 text-xs text-surface-500 hover:text-surface-700 transition-colors py-1.5 rounded-md hover:bg-surface-100/50"
            >
              {expanded ? (
                <>
                  <ChevronUp className="w-3.5 h-3.5" />
                  Show less
                </>
              ) : (
                <>
                  <ChevronDown className="w-3.5 h-3.5" />
                  Show all {totalRows.toLocaleString()} rows
                </>
              )}
            </button>
          )}
        </>
      )}
    </Card>
  );
}
