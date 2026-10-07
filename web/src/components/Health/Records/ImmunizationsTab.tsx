// Immunizations tab — vaccination history with CVX codes.

import { Syringe, CalendarDays, ShieldCheck } from 'lucide-react';
import { StatTile } from '../StatTile';
import { Section, TimelineItem, MetaChip, EmptyTabState, formatDate } from './shared';
import type { ClinicalSummary } from '../types';

export function ImmunizationsTab({ summary }: { summary: ClinicalSummary }) {
  if (summary.immunizations.length === 0) {
    return (
      <EmptyTabState
        icon={Syringe}
        accent="emerald"
        title="No immunizations recorded"
        description="No vaccine records in this export. Providers vary in what they share — check with your primary care portal."
      />
    );
  }

  // Sort by date ascending for timeline, but display newest first.
  const chronological = [...summary.immunizations].sort((a, b) =>
    (b.date ?? '').localeCompare(a.date ?? '')
  );
  const completed = chronological.filter((i) => i.status === 'completed').length;
  const firstDate = summary.immunizations.reduce<string | null>((min, i) => {
    if (!i.date) return min;
    return min === null || i.date < min ? i.date : min;
  }, null);
  const latestDate = summary.immunizations.reduce<string | null>((max, i) => {
    if (!i.date) return max;
    return max === null || i.date > max ? i.date : max;
  }, null);

  return (
    <>
      <p className="text-[12px] text-surface-800 mb-6 leading-relaxed">
        Vaccination history — every FHIR Immunization resource from your linked providers. CVX codes
        link back to the CDC&apos;s canonical vaccine catalog.
      </p>

      <Section title="At a glance">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <StatTile
            icon={Syringe}
            label="Total shots"
            value={summary.immunizations.length.toString()}
            color="text-emerald-400"
          />
          <StatTile
            icon={ShieldCheck}
            label="Completed"
            value={completed.toString()}
            color="text-emerald-400"
          />
          <StatTile
            icon={CalendarDays}
            label="Earliest record"
            value={formatDate(firstDate)}
            color="text-surface-700"
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
        title="Vaccination timeline"
        subtitle="Newest first — CVX codes are the CDC's standardized vaccine identifiers"
      >
        <div className="rounded-xl border border-border/30 bg-surface-50/40 px-5 py-5">
          {chronological.map((i) => (
            <TimelineItem
              key={i.id}
              date={i.date}
              title={i.name}
              status={i.status}
              accent="emerald"
            >
              {i.cvx && <MetaChip label="CVX" value={i.cvx} mono />}
              {i.status && <MetaChip label="Status" value={i.status} />}
              {i.primarySource !== null && (
                <MetaChip
                  label="Source"
                  value={i.primarySource ? 'Administered here' : 'Reported'}
                />
              )}
            </TimelineItem>
          ))}
        </div>
      </Section>
    </>
  );
}

ImmunizationsTab.isEmpty = (s: ClinicalSummary): boolean => s.immunizations.length === 0;
