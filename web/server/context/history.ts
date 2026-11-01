// Daily history of each context source's metrics().
//
// Most DocVault stores keep only the current value: editing a loan balance
// overwrites the old one, so nothing could later say "this loan fell by
// $5,000 on the 12th". Recording every source's numbers once a day gives any
// source a past to compare against, without each store growing its own
// history format. Files: context-history/<source id>/<year>.json.

import { promises as fs } from 'fs';
import path from 'path';
import { DATA_DIR } from '../data.js';
import { createWriteLock, writeJsonAtomic } from '../write-lock.js';
import type { ContextMetric, ContextWindow } from './types.js';

export const CONTEXT_HISTORY_DIRNAME = 'context-history';

interface HistoryYear {
  version: 1;
  days: Record<string, Record<string, ContextMetric>>;
}

export interface HistoryDay {
  date: string;
  metrics: Record<string, ContextMetric>;
}

const SOURCE_ID = /^[a-z0-9-]+$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function createContextHistory(dataDir: string) {
  const root = path.join(dataDir, CONTEXT_HISTORY_DIRNAME);
  const withLock = createWriteLock();
  const fileFor = (sourceId: string, year: string) => path.join(root, sourceId, `${year}.json`);

  function check(sourceId: string, ...dates: string[]): void {
    if (!SOURCE_ID.test(sourceId)) throw new Error(`Invalid context source id: ${sourceId}`);
    for (const d of dates) if (!YMD.test(d)) throw new Error(`Invalid date: ${d}`);
  }

  async function readYear(sourceId: string, year: string): Promise<HistoryYear> {
    try {
      const parsed = JSON.parse(await fs.readFile(fileFor(sourceId, year), 'utf8')) as HistoryYear;
      return { version: 1, days: parsed.days ?? {} };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, days: {} };
      throw error;
    }
  }

  /** Save one day's metrics, replacing any earlier record for that day. */
  function record(
    sourceId: string,
    date: string,
    metrics: Record<string, ContextMetric>
  ): Promise<void> {
    check(sourceId, date);
    return withLock(async () => {
      const year = date.slice(0, 4);
      const file = await readYear(sourceId, year);
      file.days[date] = metrics;
      await fs.mkdir(path.join(root, sourceId), { recursive: true });
      await writeJsonAtomic(fileFor(sourceId, year), file);
    });
  }

  /** Recorded days between two dates, inclusive, oldest first. */
  async function load(sourceId: string, from: string, to: string): Promise<HistoryDay[]> {
    check(sourceId, from, to);
    const days: HistoryDay[] = [];
    for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)); year++) {
      const file = await readYear(sourceId, String(year));
      for (const [date, metrics] of Object.entries(file.days)) {
        if (date >= from && date <= to) days.push({ date, metrics });
      }
    }
    return days.sort((a, b) => a.date.localeCompare(b.date));
  }

  return { root, record, load };
}

export type ContextHistory = ReturnType<typeof createContextHistory>;

export const contextHistory = createContextHistory(DATA_DIR);

export interface MetricChange {
  /** The day the new value was recorded. */
  date: string;
  /** The recorded day it is compared with; more than a day back when days are missing. */
  previousDate: string;
  key: string;
  label: string;
  /** Absent when the metric first appears on `date`. */
  before?: number;
  /** Absent when the metric is gone on `date`. */
  after?: number;
}

/**
 * Changes between consecutive recorded days, reported for days inside the
 * window. The comparison day may fall before the window, so a change on the
 * window's first day is still caught. Pure.
 */
export function diffHistory(
  days: HistoryDay[],
  window: ContextWindow,
  minDelta = 0.005
): MetricChange[] {
  const changes: MetricChange[] = [];
  let prev: HistoryDay | undefined;
  for (const day of days) {
    if (day.date > window.to) break;
    if (prev && day.date >= window.from) {
      const keys = new Set([...Object.keys(prev.metrics), ...Object.keys(day.metrics)]);
      for (const key of keys) {
        const a = prev.metrics[key];
        const b = day.metrics[key];
        if (a && b && Math.abs(b.value - a.value) < minDelta) continue;
        changes.push({
          date: day.date,
          previousDate: prev.date,
          key,
          label: (b ?? a).label,
          ...(a ? { before: a.value } : {}),
          ...(b ? { after: b.value } : {}),
        });
      }
    }
    prev = day;
  }
  return changes;
}
