// Allergies tab — allergies and intolerances. Typically a short list but
// high-stakes content, so we render as prominent cards with reactions
// listed as pills.

import { ShieldAlert, Zap } from 'lucide-react';
import { StatTile } from '../StatTile';
import { Section, RecordCard, MetaChip, EmptyTabState, formatDate } from './shared';
import type { ClinicalSummary } from '../types';

export function AllergiesTab({ summary }: { summary: ClinicalSummary }) {
  if (summary.allergies.length === 0) {
    return (
      <EmptyTabState
        icon={ShieldAlert}
        accent="orange"
        title="No allergies recorded"
        description="No AllergyIntolerance resources in this export. If that's wrong, your provider may not have shared them — worth confirming."
      />
    );
  }

  const active = summary.allergies.filter(
    (a) => a.clinicalStatus?.toLowerCase() === 'active'
  ).length;

  return (
    <>
      <p className="text-[12px] text-surface-800 mb-6 leading-relaxed">
        Allergies and intolerances recorded by your providers. Reactions come straight from the FHIR
        manifestation list — sorted by how recently the record was created.
      </p>

      <Section title="At a glance">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          <StatTile
            icon={ShieldAlert}
            label="Active allergies"
            value={active.toString()}
            color={active > 0 ? 'text-orange-400' : 'text-emerald-400'}
          />
          <StatTile
            icon={Zap}
            label="Total reactions"
            value={summary.allergies.reduce((n, a) => n + a.reactions.length, 0).toString()}
            color="text-rose-400"
          />
          <StatTile
            icon={ShieldAlert}
            label="Total records"
            value={summary.allergies.length.toString()}
            color="text-sky-400"
          />
        </div>
      </Section>

      <Section
        title="Known allergies"
        subtitle={`${summary.allergies.length} record${summary.allergies.length === 1 ? '' : 's'}`}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {summary.allergies.map((a) => (
            <RecordCard
              key={a.id}
              accent="orange"
              title={a.name}
              headline={a.clinicalStatus?.toUpperCase() ?? undefined}
            >
              {a.reactions.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2 mt-1.5">
                  {a.reactions.map((r, i) => (
                    <span
                      key={i}
                      className="text-[10.5px] font-medium px-2 py-0.5 rounded bg-rose-500/10 text-rose-400 tracking-wide"
                    >
                      {r}
                    </span>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                {a.recordedDate && <MetaChip label="Recorded" value={formatDate(a.recordedDate)} />}
              </div>
            </RecordCard>
          ))}
        </div>
      </Section>
    </>
  );
}

AllergiesTab.isEmpty = (s: ClinicalSummary): boolean => s.allergies.length === 0;
