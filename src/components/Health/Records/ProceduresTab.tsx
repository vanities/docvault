// Procedures tab — procedure history with CPT codes.
//
// VA FHIR exports tag every billable CPT as a Procedure, so the raw list
// mixes real interventions (surgery/injection/endoscopy) with labs,
// counseling sessions, and office-visit E/M codes. We bucket by CPT range
// and default to "real procedures" so the view isn't swamped by billing
// lines. "Show all" toggle exposes the billed services behind the scenes.

import { useMemo, useState } from 'react';
import { Scissors, CalendarDays, Activity } from 'lucide-react';
import { StatTile } from '../StatTile';
import { Section, TimelineItem, MetaChip, EmptyTabState, formatDate } from './shared';
import type { ClinicalSummary, ProcedureCategory } from '../types';

const CATEGORY_LABELS: Record<ProcedureCategory, string> = {
  procedure: 'Procedure',
  lab: 'Lab',
  counseling: 'Counseling',
  evaluation: 'Office visit',
  unknown: 'Other',
};

export function ProceduresTab({ summary }: { summary: ClinicalSummary }) {
  const [showAll, setShowAll] = useState(false);

  const byCategory = useMemo(() => {
    const counts: Record<ProcedureCategory, number> = {
      procedure: 0,
      lab: 0,
      counseling: 0,
      evaluation: 0,
      unknown: 0,
    };
    // v2-cached summaries don't have `category` populated — treat undefined
    // as "procedure" so the default view matches old behavior. Re-parse to
    // upgrade to v3 and get actual CPT-based categorization.
    for (const p of summary.procedures) counts[p.category ?? 'procedure'] += 1;
    return counts;
  }, [summary.procedures]);

  const visible = useMemo(() => {
    if (showAll) return summary.procedures;
    return summary.procedures.filter((p) => {
      const cc = p.category ?? 'procedure';
      return cc === 'procedure' || cc === 'unknown';
    });
  }, [summary.procedures, showAll]);

  if (summary.procedures.length === 0) {
    return (
      <EmptyTabState
        icon={Scissors}
        accent="slate"
        title="No procedures recorded"
        description="No Procedure resources in this export. Surgical and diagnostic procedures show up here when your providers share them."
      />
    );
  }

  const latestDate = summary.procedures[0]?.date ?? null;
  const billedCount = byCategory.lab + byCategory.counseling + byCategory.evaluation;
  const realProcedureCount = byCategory.procedure + byCategory.unknown;

  return (
    <>
      <p className="text-[12px] text-surface-800 mb-6 leading-relaxed">
        VA FHIR exports tag every billable CPT code as a procedure, so the raw list mixes real
        interventions with labs, therapy sessions, and office-visit billing. This view defaults to
        actual procedures — toggle below to see the full billed list.
      </p>

      <Section title="At a glance">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <StatTile
            icon={Scissors}
            label="Procedures"
            value={byCategory.procedure.toString()}
            color="text-slate-400"
          />
          <StatTile
            icon={Activity}
            label="Labs (billed)"
            value={byCategory.lab.toString()}
            color="text-emerald-400"
          />
          <StatTile
            icon={Activity}
            label="Office visits"
            value={byCategory.evaluation.toString()}
            color="text-sky-400"
          />
          <StatTile
            icon={CalendarDays}
            label="Most recent"
            value={formatDate(latestDate)}
            color="text-violet-400"
          />
        </div>
      </Section>

      <Section
        title={showAll ? 'All billed entries' : 'Procedure history'}
        subtitle={
          showAll
            ? `${summary.procedures.length} entries including labs, counseling, and E/M codes`
            : `${realProcedureCount} real procedures (hiding ${billedCount} billed services)`
        }
        action={
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="text-[11px] font-medium text-sky-400 hover:text-sky-300 transition-colors"
          >
            {showAll ? 'Hide billed services' : `Show all ${summary.procedures.length}`}
          </button>
        }
      >
        <div className="rounded-xl border border-border/30 bg-surface-50/40 px-5 py-5">
          {visible.map((p) => {
            const catLabel = p.category === 'procedure' ? null : CATEGORY_LABELS[p.category];
            return (
              <TimelineItem
                key={p.id}
                date={p.date}
                title={p.name}
                status={p.status}
                accent={p.status?.toLowerCase() === 'in-progress' ? 'amber' : 'slate'}
              >
                {p.cpt && <MetaChip label="CPT" value={p.cpt} mono />}
                {catLabel && <MetaChip label="Type" value={catLabel} />}
                {p.status && <MetaChip label="Status" value={p.status} />}
              </TimelineItem>
            );
          })}
        </div>
      </Section>
    </>
  );
}

ProceduresTab.isEmpty = (s: ClinicalSummary): boolean => s.procedures.length === 0;
