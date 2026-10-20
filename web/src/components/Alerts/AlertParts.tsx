import type { AlertCheck } from '../../../server/alerts-types';
import { sparkGeometry } from './alerts';

export function SectionTitle({
  children,
  aside,
}: {
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 mb-2">
      <h2 className="text-[11px] font-semibold text-surface-700 uppercase tracking-[0.15em]">
        {children}
      </h2>
      {aside && <span className="text-[11px] text-surface-600">{aside}</span>}
    </div>
  );
}

export function CheckChip({ check }: { check: Pick<AlertCheck, 'active' | 'severity'> }) {
  if (!check.active) {
    return (
      <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-surface-200/60 text-surface-700">
        OK
      </span>
    );
  }
  const critical = check.severity === 'critical';
  return (
    <span
      className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${critical ? 'bg-danger-500/15 text-danger-400' : 'bg-warn-500/15 text-warn-400'}`}
    >
      {critical ? 'Tripped' : 'Warning'}
    </span>
  );
}

export function Sparkline({
  label,
  values,
  current,
  refValue,
  refLabel = 'trip',
  format,
}: {
  label: string;
  values: Array<number | null>;
  current: string;
  refValue: number | null;
  refLabel?: string;
  format: (n: number) => string;
}) {
  const width = 240;
  const height = 56;
  const g = sparkGeometry(values, width, height, refValue);
  const present = values.filter((v): v is number => v != null && Number.isFinite(v));
  const range =
    present.length > 0 ? `${format(Math.min(...present))} to ${format(Math.max(...present))}` : '';
  return (
    <div className="glass-card rounded-xl p-3 flex flex-col gap-2 min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] text-surface-700 truncate">{label}</span>
        <span className="font-mono text-sm font-semibold text-surface-950">{current}</span>
      </div>
      {g.line ? (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto text-accent-400"
          role="img"
          aria-label={`${label}: ${present.length} reports, ${range}`}
        >
          <line
            x1="0"
            x2={width}
            y1={height - 3}
            y2={height - 3}
            className="stroke-surface-300"
            strokeWidth="1"
          />
          <path d={g.area} fill="currentColor" fillOpacity="0.1" />
          <path d={g.line} fill="none" stroke="currentColor" strokeWidth="1.5" />
          {g.refY !== null && (
            <line
              x1="0"
              x2={width}
              y1={g.refY}
              y2={g.refY}
              className="stroke-danger-400"
              strokeWidth="1"
              strokeDasharray="4 3"
            />
          )}
          {g.end && <circle cx={g.end.x} cy={g.end.y} r="2.5" fill="currentColor" />}
        </svg>
      ) : (
        <div className="h-14 flex items-center text-[11px] text-surface-600">No history yet</div>
      )}
      <div className="flex justify-between gap-2 text-[10px] text-surface-600 font-mono">
        <span>{range}</span>
        {refValue !== null && (
          <span className="text-danger-400">
            {refLabel} {format(refValue)}
          </span>
        )}
      </div>
    </div>
  );
}
