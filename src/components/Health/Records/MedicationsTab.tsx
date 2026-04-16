// Medications tab — prescriptions and dosing from clinical records.
// VA exports often stash the med name in dosageInstruction rather than
// medicationCodeableConcept; the parser handles that cascade so this view
// can just render Medication.name directly.

import { Pill, Activity, CheckCircle2 } from 'lucide-react';
import { StatTile } from '../StatTile';
import { Section, TimelineItem, MetaChip, EmptyTabState } from './shared';
import type { ClinicalSummary } from '../types';

export function MedicationsTab({ summary }: { summary: ClinicalSummary }) {
  if (summary.medications.length === 0) {
    return (
      <EmptyTabState
        icon={Pill}
        accent="violet"
        title="No medications recorded"
        description="No MedicationRequest resources in this export. If you've filled prescriptions since the last upload, re-export from the Health app and re-upload."
      />
    );
  }

  const active = summary.medications.filter((m) => m.status?.toLowerCase() === 'active').length;
  const completed = summary.medications.filter(
    (m) => m.status?.toLowerCase() === 'completed' || m.status?.toLowerCase() === 'stopped'
  ).length;

  return (
    <>
      <p className="text-[12px] text-surface-800 mb-6 leading-relaxed">
        Prescriptions your providers have authored. Dosing strings come straight from the FHIR
        resource — the exact phrasing your pharmacist sees.
      </p>

      <Section title="At a glance">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          <StatTile
            icon={Pill}
            label="Active scripts"
            value={active.toString()}
            color="text-violet-400"
          />
          <StatTile
            icon={CheckCircle2}
            label="Completed / stopped"
            value={completed.toString()}
            color="text-surface-600"
          />
          <StatTile
            icon={Activity}
            label="Total on file"
            value={summary.medications.length.toString()}
            color="text-sky-400"
          />
        </div>
      </Section>

      <Section
        title="Prescription history"
        subtitle="Newest first — from the FHIR MedicationRequest resource"
      >
        <div className="rounded-xl border border-border/30 bg-surface-50/40 px-5 py-5">
          {summary.medications.map((m) => {
            const isActive = m.status?.toLowerCase() === 'active';
            return (
              <TimelineItem
                key={m.id}
                date={m.startDate ?? m.authoredOn}
                title={m.name}
                subtitle={m.dosageText ?? undefined}
                status={m.status}
                accent={isActive ? 'violet' : 'slate'}
              >
                {m.route && <MetaChip label="Route" value={m.route} />}
                {m.status && <MetaChip label="Status" value={m.status} />}
                {m.endDate && <MetaChip label="End" value={m.endDate} mono />}
              </TimelineItem>
            );
          })}
        </div>
      </Section>
    </>
  );
}

MedicationsTab.isEmpty = (s: ClinicalSummary): boolean => s.medications.length === 0;
