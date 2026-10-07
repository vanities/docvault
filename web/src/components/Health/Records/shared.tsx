// Shared primitives for the clinical Records tabs. Visual language matches
// the Quant view: restrained, bold, section-label driven. Each tab renders:
//
//   TabsContent
//     └── intro paragraph
//     └── Section header (uppercase, tracked)
//         └── Timeline / RecordCard / data
//     └── more Sections…
//
// Section is the clinical analog to Quant's ChartGroup — same
// `text-[11px] font-semibold uppercase tracking-[0.15em]` header, same
// optional subtitle callout inline.

/* oxlint-disable react-refresh/only-export-components */
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatRelativeYears(iso: string | null, now: Date = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diffMs = now.getTime() - d.getTime();
  const years = diffMs / (365.25 * 24 * 3600 * 1000);
  if (years < 0) return 'upcoming';
  if (years < 0.08) return 'this month';
  if (years < 1) return `${Math.round(years * 12)}mo ago`;
  if (years < 2) return '1y ago';
  return `${Math.floor(years)}y ago`;
}

// ---------------------------------------------------------------------------
// Section — mirrors Quant's ChartGroup; uppercase-tracked header with
// optional subtitle callout inline.
// ---------------------------------------------------------------------------

export function Section({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mb-8">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h3 className="text-[11px] font-semibold text-surface-700 uppercase tracking-[0.15em]">
            {title}
          </h3>
          {subtitle && <span className="text-[11px] text-surface-700/70">{subtitle}</span>}
        </div>
        {action}
      </div>
      <div>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatusDot — a colored pulse marker for clinical status.
// ---------------------------------------------------------------------------

export function StatusDot({ status }: { status: string | null }) {
  const s = status?.toLowerCase() ?? '';
  const color =
    s === 'active' || s === 'in-progress'
      ? 'bg-rose-400'
      : s === 'inactive' || s === 'resolved' || s === 'completed'
        ? 'bg-surface-400'
        : s === 'stopped' || s === 'cancelled'
          ? 'bg-surface-300'
          : 'bg-sky-400';
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${color} flex-shrink-0`} />;
}

// ---------------------------------------------------------------------------
// MetaChip — small uppercase-label / value pairing, used throughout.
// ---------------------------------------------------------------------------

export function MetaChip({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[10.5px] leading-none">
      <span className="uppercase tracking-[0.12em] font-semibold text-surface-500/80">{label}</span>
      <span className={`text-surface-800 ${mono ? 'font-mono tabular-nums' : ''}`}>{value}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// TimelineItem — dated entry in a vertical spine.
// ---------------------------------------------------------------------------

export function TimelineItem({
  date,
  title,
  subtitle,
  status,
  accent = 'cyan',
  children,
}: {
  date: string | null;
  title: string;
  subtitle?: string;
  status?: string | null;
  /** Tailwind color name (not full class) — e.g. "emerald", "rose". */
  accent?: string;
  children?: ReactNode;
}) {
  return (
    <div className="group relative flex gap-4">
      <div className="flex flex-col items-center pt-1">
        <div
          className={`w-2 h-2 rounded-full bg-${accent}-400 ring-4 ring-${accent}-500/10 flex-shrink-0`}
        />
        <div className="flex-1 w-px bg-gradient-to-b from-border/40 via-border/20 to-transparent mt-1.5 group-last:hidden" />
      </div>
      <div className="flex-1 min-w-0 pb-5 group-last:pb-0">
        <div className="flex items-baseline justify-between gap-4 mb-1">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-sm font-medium text-surface-950 truncate">{title}</h3>
            {status && <StatusDot status={status} />}
          </div>
          <div className="text-[11px] text-surface-500 font-mono tabular-nums flex-shrink-0 whitespace-nowrap">
            {formatDate(date)}
          </div>
        </div>
        {subtitle && (
          <div className="text-xs text-surface-600 leading-relaxed mb-1.5">{subtitle}</div>
        )}
        {children && <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">{children}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RecordCard — rounded card for flat lists (e.g. Allergies).
// Left accent strip matches the section's tone.
// ---------------------------------------------------------------------------

export function RecordCard({
  accent = 'cyan',
  title,
  headline,
  children,
}: {
  accent?: string;
  title: string;
  headline?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={`relative rounded-xl border border-${accent}-500/20 bg-gradient-to-br from-${accent}-500/[0.04] via-surface-50/30 to-surface-50/0 p-4 overflow-hidden`}
    >
      <div
        className={`absolute top-0 left-0 h-full w-0.5 bg-${accent}-400/70`}
        aria-hidden="true"
      />
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <h3 className="font-medium text-sm text-surface-950 leading-tight">{title}</h3>
        {headline && (
          <span
            className={`text-[10px] font-semibold uppercase tracking-[0.12em] text-${accent}-400/90 flex-shrink-0`}
          >
            {headline}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EmptyTabState — consistent zero-data display.
// ---------------------------------------------------------------------------

export function EmptyTabState({
  icon: Icon,
  accent = 'surface',
  title,
  description,
}: {
  icon: LucideIcon;
  accent?: string;
  title: string;
  description: string;
}) {
  return (
    <div className="text-center py-14 rounded-xl border border-border/40 bg-surface-100/20">
      <div
        className={`w-12 h-12 rounded-2xl bg-${accent}-500/10 mx-auto mb-4 flex items-center justify-center`}
      >
        <Icon className={`w-5 h-5 text-${accent}-400 opacity-80`} />
      </div>
      <h3 className="text-sm font-semibold text-surface-950 mb-1">{title}</h3>
      <p className="text-xs text-surface-600 max-w-sm mx-auto leading-relaxed">{description}</p>
    </div>
  );
}
