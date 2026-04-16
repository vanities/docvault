// Procedures tab — procedure history with CPT codes.

import { Scissors, CalendarDays, Activity } from 'lucide-react';
import { StatTile } from '../StatTile';
import { Section, TimelineItem, MetaChip, EmptyTabState, formatDate } from './shared';
import type { ClinicalSummary } from '../types';

export function ProceduresTab({ summary }: { summary: ClinicalSummary }) {
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
  const completedCount = summary.procedures.filter(
    (p) => p.status?.toLowerCase() === 'completed'
  ).length;

  return (
    <>
      <p className="text-[12px] text-surface-800 mb-6 leading-relaxed">
        Procedures performed or scheduled. CPT codes are the AMA&apos;s billing-level procedure
        identifiers — useful for tracking down statements later.
      </p>

      <Section title="At a glance">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          <StatTile
            icon={Scissors}
            label="Total procedures"
            value={summary.procedures.length.toString()}
            color="text-slate-400"
          />
          <StatTile
            icon={Activity}
            label="Completed"
            value={completedCount.toString()}
            color="text-emerald-400"
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
        title="Procedure history"
        subtitle={`${summary.procedures.length} entries, newest first`}
      >
        <div className="rounded-xl border border-border/30 bg-surface-50/40 px-5 py-5">
          {summary.procedures.map((p) => (
            <TimelineItem
              key={p.id}
              date={p.date}
              title={p.name}
              status={p.status}
              accent={p.status?.toLowerCase() === 'in-progress' ? 'amber' : 'slate'}
            >
              {p.cpt && <MetaChip label="CPT" value={p.cpt} mono />}
              {p.status && <MetaChip label="Status" value={p.status} />}
            </TimelineItem>
          ))}
        </div>
      </Section>
    </>
  );
}

ProceduresTab.isEmpty = (s: ClinicalSummary): boolean => s.procedures.length === 0;
