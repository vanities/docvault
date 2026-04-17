// Conditions tab — diagnoses / problem list with ICD-10 codes.

import { useMemo, useState } from 'react';
import { AlertCircle, Activity, CheckCircle2 } from 'lucide-react';
import { StatTile } from '../StatTile';
import { Section, TimelineItem, MetaChip, EmptyTabState } from './shared';
import type { ClinicalCondition, ClinicalSummary, ConditionCategory } from '../types';

function statusLabel(status: string | null): string {
  if (!status) return 'Unknown';
  const s = status.toLowerCase();
  if (s === 'active') return 'Active';
  if (s === 'inactive' || s === 'resolved') return 'Resolved';
  return status;
}

/**
 * Inferred category of each condition based on ICD-10 prefix:
 *   - Chronic: actual diseases (F/E/D/G/H/M/N/I/K/L/…)
 *   - Encounter: visit/billing Z-codes ("encounter for general exam")
 *   - Symptom: one-off R-codes ("palpitations", "diarrhea")
 * The default view shows Chronic only, since that's what's clinically
 * meaningful. Encounter + Symptom codes are inherited from VA billing
 * feeds and clutter the problem list; they're available via toggle.
 */
const CATEGORY_LABELS: Record<ConditionCategory, string> = {
  chronic: 'Chronic',
  symptom: 'Symptom',
  encounter: 'Encounter',
  unknown: 'Other',
};

export function ConditionsTab({ summary }: { summary: ClinicalSummary }) {
  const [showAll, setShowAll] = useState(false);
  const active = summary.conditions.filter((c) => c.clinicalStatus?.toLowerCase() === 'active');
  // v2-cached summaries don't have `category` populated yet — treat undefined
  // as "chronic" so the default view shows everything until the user re-runs
  // /parse-export to upgrade to v3. After re-parse, real categorization kicks in.
  const cat = (c: ClinicalCondition) => c.category ?? 'chronic';
  const chronicCount = summary.conditions.filter((c) => cat(c) === 'chronic').length;
  const encounterCount = summary.conditions.filter((c) => cat(c) === 'encounter').length;
  const symptomCount = summary.conditions.filter((c) => cat(c) === 'symptom').length;

  // Group by name for the timeline (one line per distinct condition, latest first)
  const grouped = useMemo(() => {
    const map = new Map<string, ClinicalCondition[]>();
    const filtered = showAll
      ? summary.conditions
      : summary.conditions.filter((c) => {
          const cc = c.category ?? 'chronic';
          return cc === 'chronic' || cc === 'unknown';
        });
    for (const c of filtered) {
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
  }, [summary.conditions, showAll]);

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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <StatTile
            icon={AlertCircle}
            label="Chronic"
            value={chronicCount.toString()}
            color="text-rose-400"
          />
          <StatTile
            icon={Activity}
            label="Symptoms"
            value={symptomCount.toString()}
            color="text-amber-400"
          />
          <StatTile
            icon={CheckCircle2}
            label="Encounters"
            value={encounterCount.toString()}
            color="text-sky-400"
          />
          <StatTile
            icon={Activity}
            label={showAll ? 'Active / total' : 'Total entries'}
            value={`${active.length} / ${summary.conditions.length}`}
            color="text-surface-500"
          />
        </div>
      </Section>

      <Section
        title="Problem list"
        subtitle={
          showAll
            ? 'All FHIR conditions (chronic + symptom + encounter) — grouped by diagnosis'
            : 'Chronic conditions only — toggle below to include one-off symptoms and visit codes'
        }
        action={
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="text-[11px] font-medium text-sky-400 hover:text-sky-300 transition-colors"
          >
            {showAll
              ? `Hide ${symptomCount + encounterCount} non-chronic`
              : `Show all ${summary.conditions.length}`}
          </button>
        }
      >
        <div className="rounded-xl border border-border/30 bg-surface-50/40 px-5 py-5">
          {grouped.map((group) => {
            const c = group[0];
            const isActive = c.clinicalStatus?.toLowerCase() === 'active';
            const categoryLabel =
              c.category && c.category !== 'chronic' ? CATEGORY_LABELS[c.category] : null;
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
                {categoryLabel && <MetaChip label="Type" value={categoryLabel} />}
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
