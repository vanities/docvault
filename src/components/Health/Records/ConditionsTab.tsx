// Conditions tab — diagnoses / problem list with ICD-10 codes.

import { useMemo } from 'react';
import { AlertCircle, Activity, CheckCircle2 } from 'lucide-react';
import { StatTile } from '../StatTile';
import { Section, TimelineItem, MetaChip, EmptyTabState } from './shared';
import type { ClinicalCondition, ClinicalSummary } from '../types';

function statusLabel(status: string | null): string {
  if (!status) return 'Unknown';
  const s = status.toLowerCase();
  if (s === 'active') return 'Active';
  if (s === 'inactive' || s === 'resolved') return 'Resolved';
  return status;
}

export function ConditionsTab({ summary }: { summary: ClinicalSummary }) {
  const active = summary.conditions.filter((c) => c.clinicalStatus?.toLowerCase() === 'active');
  const resolved = summary.conditions.filter(
    (c) =>
      c.clinicalStatus?.toLowerCase() === 'resolved' ||
      c.clinicalStatus?.toLowerCase() === 'inactive'
  );

  // Group by name for the timeline (one line per distinct condition, latest first)
  const grouped = useMemo(() => {
    const map = new Map<string, ClinicalCondition[]>();
    for (const c of summary.conditions) {
      const key = c.icd10 ?? c.name;
      const arr = map.get(key);
      if (arr) arr.push(c);
      else map.set(key, [c]);
    }
    return Array.from(map.values())
      .map((arr) => {
        arr.sort((a, b) =>
          (b.onsetDate ?? b.recordedDate ?? '').localeCompare(a.onsetDate ?? a.recordedDate ?? '')
        );
        return arr;
      })
      .sort((a, b) => {
        // Active conditions first
        const aActive = a[0].clinicalStatus?.toLowerCase() === 'active' ? 0 : 1;
        const bActive = b[0].clinicalStatus?.toLowerCase() === 'active' ? 0 : 1;
        if (aActive !== bActive) return aActive - bActive;
        return (b[0].onsetDate ?? b[0].recordedDate ?? '').localeCompare(
          a[0].onsetDate ?? a[0].recordedDate ?? ''
        );
      });
  }, [summary.conditions]);

  if (summary.conditions.length === 0) {
    return (
      <EmptyTabState
        icon={AlertCircle}
        accent="rose"
        title="No conditions recorded"
        description="Your linked providers haven't sent any problem-list entries in this export."
      />
    );
  }

  return (
    <>
      <p className="text-[12px] text-surface-800 mb-6 leading-relaxed">
        Diagnoses, active problems, and resolved conditions from your linked providers. Grouped by
        diagnosis so multiple encounters for the same problem are consolidated.
      </p>

      <Section title="At a glance">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          <StatTile
            icon={AlertCircle}
            label="Active"
            value={active.length.toString()}
            color="text-rose-400"
          />
          <StatTile
            icon={CheckCircle2}
            label="Resolved"
            value={resolved.length.toString()}
            color="text-emerald-400"
          />
          <StatTile
            icon={Activity}
            label="Total entries"
            value={summary.conditions.length.toString()}
            color="text-sky-400"
          />
        </div>
      </Section>

      <Section
        title="Problem list"
        subtitle="Active conditions first, then resolved — grouped by diagnosis"
      >
        <div className="rounded-xl border border-border/30 bg-surface-50/40 px-5 py-5">
          {grouped.map((group) => {
            const c = group[0];
            const isActive = c.clinicalStatus?.toLowerCase() === 'active';
            return (
              <TimelineItem
                key={c.id || c.name}
                date={c.onsetDate ?? c.recordedDate}
                title={c.name}
                subtitle={
                  group.length > 1
                    ? `${group.length} encounter${group.length === 1 ? '' : 's'} referencing this diagnosis`
                    : undefined
                }
                status={c.clinicalStatus}
                accent={isActive ? 'rose' : 'slate'}
              >
                {c.icd10 && <MetaChip label="ICD-10" value={c.icd10} mono />}
                <MetaChip label="Status" value={statusLabel(c.clinicalStatus)} />
                {c.abatementDate && <MetaChip label="Resolved" value={c.abatementDate} mono />}
              </TimelineItem>
            );
          })}
        </div>
      </Section>
    </>
  );
}

ConditionsTab.isEmpty = (s: ClinicalSummary): boolean => s.conditions.length === 0;
