import { promises as fs } from 'fs';
import path from 'path';
import { DATA_DIR } from '../../data.js';
import { loadHealthStore } from '../../health-store.js';
import { createLogger } from '../../logger.js';
import { getLatestHealthAnalysis } from '../../routes/health-analysis.js';
import { handleHealthRoutes } from '../../routes/health.js';
import { ReadCollector, windowTest, type DateTest } from '../request.js';
import type { ContextSource } from '../types.js';

const log = createLogger('Context');

const last = <T>(a: readonly T[] | undefined): T | undefined =>
  a && a.length ? a[a.length - 1] : undefined;

/** Mean of the last `n` numeric values of a daily series (skips null), so a
 *  weekly reports the week, not one possibly atypical day. */
function avgLastN<T>(
  arr: readonly T[] | undefined,
  pick: (x: T) => number | null | undefined,
  n = 7
): number | undefined {
  if (!arr?.length) return undefined;
  const vals = arr
    .slice(-n)
    .map(pick)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (!vals.length) return undefined;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

/** Most recent per-person record from a `${personId}/${file}`-keyed store map. */
function latestByPerson<T extends { generatedAt?: string }>(
  rec: Record<string, T> | undefined,
  personId: string
): T | undefined {
  if (!rec) return undefined;
  const prefix = `${personId}/`;
  const vals = Object.entries(rec)
    .filter(([k]) => k.startsWith(prefix))
    .map(([, v]) => v)
    .sort((a, b) => (a.generatedAt ?? '').localeCompare(b.generatedAt ?? ''));
  return last(vals);
}

// Minimal shapes for reading the nested Apple Health snapshot and clinical
// store defensively: their full types are large and versioned.
export interface SnapMetrics {
  activity?: {
    daily?: Array<{ date?: string; steps?: number | null; steps7dAvg?: number | null }>;
  };
  heart?: { daily?: Array<{ date?: string; restingHR?: number | null; hrv?: number | null }> };
  sleep?: {
    daily?: Array<{
      date?: string;
      asleepMinutes?: number | null;
      deepMinutes?: number | null;
      remMinutes?: number | null;
    }>;
  };
  body?: { headline?: { currentLb?: number | null } };
  workouts?: {
    headline?: {
      thisWeekCount?: number;
      thisWeekMinutes?: number;
      currentStreakDays?: number;
      favoriteType?: string | null;
    };
    recent?: Array<{
      type?: string;
      start?: string;
      durationMinutes?: number;
      avgHR?: number | null;
    }>;
  };
}

/**
 * Pull the metrics object out of a `GET /api/health/:id/snapshot/all` response
 * body. That endpoint nests the snapshot under `snapshot`; the single-segment
 * endpoint (`/snapshot/activity` etc.) uses `data`. Reading `data` against the
 * `all` shape once returned undefined every call, so the auto-heal recompute
 * never reached the digest and a person whose overnight sync hadn't been folded
 * into the raw store yet was silently dropped. This is the contract a test locks.
 */
export function snapshotFromAllResponseBody(body: unknown): SnapMetrics | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const snap = (body as { snapshot?: unknown }).snapshot;
  return (snap ?? undefined) as SnapMetrics | undefined;
}

interface ClinicalLabs {
  labsByTest?: Array<{
    latest?: {
      name?: string;
      value?: number | null;
      valueString?: string | null;
      unit?: string | null;
      date?: string | null;
      interpretation?: string | null;
    } | null;
  }>;
}

export function selectDailyNewsStepCount(
  dailyAct: NonNullable<SnapMetrics['activity']>['daily'] | undefined,
  opts: { useAverage: boolean; editionDate?: string }
): number | undefined {
  const lastAct = last(dailyAct);
  if (opts.useAverage) return lastAct?.steps7dAvg ?? avgLastN(dailyAct, (d) => d.steps);

  // Steps accumulate through the day, so the latest day is partial at a
  // morning edition. Use the last COMPLETE day, the most recent before the
  // edition's date.
  const cutoff =
    opts.editionDate && /^\d{4}-\d{2}-\d{2}$/.test(opts.editionDate) ? opts.editionDate : undefined;
  const lastCompleteAct = cutoff
    ? (last((dailyAct ?? []).filter((d) => d.date != null && d.date < cutoff)) ?? lastAct)
    : lastAct;
  return lastCompleteAct?.steps ?? undefined;
}

/**
 * Overnight metric bits (resting HR, HRV, sleep) for a person's line, with
 * PER-METRIC staleness. Keying staleness off the latest ACTIVITY day alone let
 * a lagging sleep series be narrated as "last night" with coaching attached
 * (the 2026-08-10 edition printed the 08-09 night unlabeled that way).
 *
 * Only a sleep day equal to `editionDate` (sleep is keyed to the wake day) is
 * "last night"; anything else is labeled `— from <date>, not last night`.
 * Heart metrics use the window and carry `(from <date>)` when they predate it.
 * Weekly averages (`useAvg`) label nothing: they are a 7-day figure.
 */
export function buildOvernightMetricBits(
  snap: Pick<SnapMetrics, 'heart' | 'sleep'>,
  opts: { useAvg: boolean; afterSince: DateTest; editionDate?: string }
): string[] {
  const bits: string[] = [];
  const { useAvg, afterSince, editionDate } = opts;

  const lastHeart = last(snap.heart?.daily);
  const heartSuffix =
    !useAvg && lastHeart?.date && !afterSince(lastHeart.date) ? ` (from ${lastHeart.date})` : '';
  const rhr = useAvg ? avgLastN(snap.heart?.daily, (d) => d.restingHR) : lastHeart?.restingHR;
  const hrv = useAvg ? avgLastN(snap.heart?.daily, (d) => d.hrv) : lastHeart?.hrv;
  if (typeof rhr === 'number') bits.push(`resting HR ${Math.round(rhr)}${heartSuffix}`);
  if (typeof hrv === 'number') bits.push(`HRV ${Math.round(hrv)}${heartSuffix}`);

  const lastSleep = last(snap.sleep?.daily);
  const sleepMin = useAvg
    ? avgLastN(snap.sleep?.daily, (d) => d.asleepMinutes)
    : lastSleep?.asleepMinutes;
  if (typeof sleepMin === 'number') {
    let sleepBit = `${(sleepMin / 60).toFixed(1)}h sleep${useAvg ? '/night' : ''}`;
    if (!useAvg) {
      const stages = [
        typeof lastSleep?.deepMinutes === 'number'
          ? `${(lastSleep.deepMinutes / 60).toFixed(1)}h deep`
          : null,
        typeof lastSleep?.remMinutes === 'number'
          ? `${(lastSleep.remMinutes / 60).toFixed(1)}h REM`
          : null,
      ].filter(Boolean);
      if (stages.length) sleepBit += ` (${stages.join(', ')})`;
      const sleepFresh = lastSleep?.date
        ? editionDate
          ? lastSleep.date === editionDate
          : afterSince(lastSleep.date)
        : true; // no date on the record: nothing to judge against
      if (!sleepFresh) sleepBit += ` — from ${lastSleep?.date}, not last night`;
    }
    bits.push(sleepBit);
  }
  return bits;
}

/**
 * A person's snapshot through the snapshot route's auto-heal path, which
 * recomputes when synced deltas are newer than the cached snapshot. Reading
 * the store raw missed an overnight backfill that landed 45 minutes before
 * the 2026-06-12 edition. Undefined on any failure (the caller keeps the raw read).
 */
async function freshPersonSnapshot(personId: string): Promise<SnapMetrics | undefined> {
  try {
    const url = new URL(`http://internal/api/health/${encodeURIComponent(personId)}/snapshot/all`);
    const res = await handleHealthRoutes(new Request(url.toString()), url, url.pathname);
    if (!res || res.status !== 200) return undefined;
    return snapshotFromAllResponseBody(await res.json());
  } catch (err) {
    log.warn(
      `[health] fresh snapshot read failed for ${personId}: ${err instanceof Error ? err.message : String(err)}`
    );
    return undefined;
  }
}

export const healthSource: ContextSource = {
  id: 'health',
  label: 'Health',
  group: 'health',
  description:
    'Each active person: steps, resting heart rate, HRV, sleep (with stages), weight, workouts, ' +
    'new lab results and any open sickness; the active supplement regimen; DNA on file.',
  files: ['.docvault-health.json', 'health'],
  async read(req) {
    const r = new ReadCollector();
    const afterSince = windowTest(req);
    const editionDate = req.today;
    await r.part('health/store', async () => {
      const store = await loadHealthStore();
      const people = (store.people ?? []).filter((p) => !p.archivedAt).slice(0, 4);
      for (const person of people) {
        const parts: string[] = [];
        const snap =
          (await freshPersonSnapshot(person.id)) ??
          (latestByPerson(store.snapshots, person.id) as unknown as SnapMetrics | undefined);
        if (snap) {
          const bits: string[] = [];
          const dailyAct = snap.activity?.daily;
          const lastAct = last(dailyAct);
          const healthDate = lastAct?.date ?? undefined;
          // Stale = the latest day predates the window: flag it rather than
          // pass it off as current.
          const stale = healthDate ? !afterSince(healthDate) : false;
          // Weekly: 7-day averages. Daily: the latest day, labeled when stale.
          const useAvg = req.purpose === 'weekly' && !stale;
          const steps = selectDailyNewsStepCount(dailyAct, { useAverage: useAvg, editionDate });
          const lb = snap.body?.headline?.currentLb;
          if (typeof steps === 'number')
            bits.push(`${Math.round(steps).toLocaleString()} steps${useAvg ? '/day' : ''}`);
          bits.push(...buildOvernightMetricBits(snap, { useAvg, afterSince, editionDate }));
          if (typeof lb === 'number') bits.push(`${Math.round(lb)} lb`);
          if (req.purpose === 'weekly') {
            const w = snap.workouts?.headline;
            if (w && typeof w.thisWeekCount === 'number' && w.thisWeekCount > 0) {
              bits.push(
                `${w.thisWeekCount} workout${w.thisWeekCount === 1 ? '' : 's'} this week` +
                  `${typeof w.thisWeekMinutes === 'number' ? ` (${Math.round(w.thisWeekMinutes)} min)` : ''}` +
                  `${w.favoriteType ? `, mostly ${w.favoriteType}` : ''}`
              );
            }
          } else {
            // The actual sessions captured in the window, not week-to-date totals.
            const sessions = (snap.workouts?.recent ?? [])
              .filter((s) => s.start && afterSince(s.start))
              .slice(0, 4)
              .map((s) => {
                const mins =
                  typeof s.durationMinutes === 'number'
                    ? ` ${Math.round(s.durationMinutes)} min`
                    : '';
                const hr = typeof s.avgHR === 'number' ? ` (avg HR ${Math.round(s.avgHR)})` : '';
                return `${s.type ?? 'Workout'}${mins}${hr}`;
              });
            if (sessions.length) bits.push(`workouts logged: ${sessions.join(', ')}`);
          }
          if (bits.length) {
            const tag =
              stale && healthDate ? ` (as of ${healthDate})` : useAvg ? ' (7-day avgs)' : '';
            parts.push(bits.join(', ') + tag);
          }
        }

        const clinical = latestByPerson(
          store.clinical as unknown as Record<string, { generatedAt?: string }>,
          person.id
        ) as unknown as ClinicalLabs | undefined;
        const newLabs = (clinical?.labsByTest ?? [])
          .map((t) => t.latest)
          .filter((l) => l && afterSince(l.date))
          .slice(0, 4);
        for (const l of newLabs) {
          if (!l) continue;
          const v =
            l.value != null ? `${l.value}${l.unit ? ` ${l.unit}` : ''}` : (l.valueString ?? '');
          const flag = l.interpretation && l.interpretation !== 'N' ? ` (${l.interpretation})` : '';
          parts.push(`new lab ${l.name ?? ''} ${v}${flag}`.replace(/\s+/g, ' ').trim());
        }

        const sickness = Object.values(store.sicknessLogs ?? {})
          .filter((s) => s.personId === person.id && !s.endDate)
          .sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
        if (sickness) {
          parts.push(
            `under the weather — ${sickness.title} (${sickness.severity}, since ${sickness.startDate})`
          );
        }

        if (parts.length) r.lines.push(`${person.name}: ${parts.join('; ')}.`);
      }

      const activeSupps = Object.values(store.nutrition ?? {}).filter((n) => n.status === 'active');
      if (activeSupps.length)
        r.lines.push(`${activeSupps.length} active supplements in the regimen.`);
    });

    if (req.full) {
      await r.part('health/weekly-detail', async () => {
        const store = await loadHealthStore();
        const supps = Object.values(store.nutrition ?? {})
          .filter((n) => n.status === 'active')
          .map((n) => {
            const p = n.parsed as { productName?: string; brandName?: string } | null;
            return p?.productName ?? p?.brandName ?? 'supplement';
          })
          .slice(0, 30);
        if (supps.length) r.lines.push(`Active supplement regimen: ${supps.join(', ')}.`);

        for (const person of (store.people ?? []).filter((p) => !p.archivedAt).slice(0, 4)) {
          try {
            const metaRaw = await fs.readFile(
              path.join(DATA_DIR, 'health', person.id, 'dna', 'metadata.json'),
              'utf-8'
            );
            const meta = JSON.parse(metaRaw) as {
              snpsLoaded?: number;
              traitsFound?: number;
              apoeGenotyped?: boolean;
            };
            if (meta.snpsLoaded) {
              r.lines.push(
                `${person.name} DNA on file: ${meta.snpsLoaded.toLocaleString()} SNPs, ` +
                  `${meta.traitsFound ?? 0} traits${meta.apoeGenotyped ? ', APOE genotyped' : ''}.`
              );
            }
          } catch {
            /* no DNA for this person */
          }
        }
      });
    }
    return r.result();
  },
};

export const healthAnalysesSource: ContextSource = {
  id: 'health-analyses',
  label: 'Health analyses',
  group: 'health',
  description: 'The latest written health analysis, in full, when it was filed in the window.',
  files: ['.docvault-health-analysis-history.json'],
  async read(req) {
    const r = new ReadCollector();
    await r.part('health/analysis', async () => {
      const ha = await getLatestHealthAnalysis();
      if (ha && windowTest(req)(ha.createdAt)) {
        r.lines.push(`New health analysis: ${ha.title}.`);
        r.lines.push(ha.body);
      }
    });
    return r.result();
  },
};
