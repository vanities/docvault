// Analytics tab — how the consulting practice is going, computed client-side
// from the full store (a few thousand entries is trivial).
//
// Layout: a KPI row of stat tiles leads (the headline numbers), then charts
// ordered by how often they answer a question: monthly revenue by client,
// cumulative year pace vs last year, weekly hours, client share, and the
// work-rhythm punchcard. Every dollar renders blur-aware.

import { useMemo } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { useAppContext } from '../../contexts/AppContext';
import { Money } from '../common/Money';
import {
  CLIENT_PALETTE,
  formatUsd,
  formatHours,
  todayYMD,
  weekStart,
  type TimesheetStore,
} from './types';
import {
  MonthlyRevenueChart,
  WeeklyHoursChart,
  CumulativeCompareChart,
  Punchcard,
  type MonthlyRow,
} from './AnalyticsChart';

function monthKey(date: string): string {
  return date.slice(0, 7);
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${String(y).slice(2)}`;
}

/** Last `n` month keys ending at the current month, oldest first. */
function lastMonthKeys(n: number): string[] {
  const keys: string[] = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < n; i++) {
    keys.unshift(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() - 1);
  }
  return keys;
}

function StatTile({
  label,
  value,
  sub,
  delta,
  blurValue,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  delta?: number | null; // percent vs previous period
  blurValue?: boolean;
}) {
  return (
    <div>
      <p className="text-[11px] text-surface-500 uppercase tracking-wider mb-1">{label}</p>
      <p className="text-xl sm:text-2xl font-semibold text-surface-950">
        {blurValue ? <Money>{value}</Money> : value}
      </p>
      <div className="flex items-center gap-1.5 text-[12px] text-surface-600 min-h-[1.1rem]">
        {delta !== undefined && delta !== null && Number.isFinite(delta) && (
          <span
            className={`inline-flex items-center gap-0.5 ${delta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}
          >
            {delta >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {Math.abs(delta).toFixed(0)}%
          </span>
        )}
        {sub}
      </div>
    </div>
  );
}

export function AnalyticsTab({ store }: { store: TimesheetStore }) {
  const { blurNumbers } = useAppContext();

  const projectById = useMemo(
    () => new Map(store.projects.map((p) => [p.id, p] as const)),
    [store]
  );

  // Stable client → color assignment: store order (migration order), color
  // follows the client regardless of filters or which charts it appears in.
  const clientColors = useMemo(
    () =>
      store.clients.map((c, i) => ({
        id: c.id,
        name: c.name,
        color: CLIENT_PALETTE[i % CLIENT_PALETTE.length],
      })),
    [store.clients]
  );

  const a = useMemo(() => {
    const today = todayYMD();
    const thisMonth = monthKey(today);
    const year = Number(today.slice(0, 4));
    const prev = new Date();
    prev.setDate(1);
    prev.setMonth(prev.getMonth() - 1);
    const lastMonth = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;

    // Single pass over entries feeds every aggregate.
    const monthAgg = new Map<string, { minutes: number; amount: number }>();
    const monthClientAmount = new Map<string, Map<string, number>>();
    const weekAgg = new Map<string, number>();
    const clientYear = new Map<string, { minutes: number; amount: number }>();
    const punch: number[][] = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
    const cumulative = new Map<number, Map<string, number>>(); // year -> MM-DD -> amount
    let outstandingAmount = 0;
    let outstandingCount = 0;
    let yearMinutes = 0;
    let yearAmount = 0;

    for (const e of store.entries) {
      const mk = monthKey(e.date);
      const m = monthAgg.get(mk) ?? { minutes: 0, amount: 0 };
      m.minutes += e.durationMinutes;
      m.amount += e.amount;
      monthAgg.set(mk, m);

      const clientId = projectById.get(e.projectId)?.clientId ?? 'unknown';
      let mc = monthClientAmount.get(mk);
      if (!mc) monthClientAmount.set(mk, (mc = new Map()));
      mc.set(clientId, (mc.get(clientId) ?? 0) + e.amount);

      const wk = weekStart(e.date);
      weekAgg.set(wk, (weekAgg.get(wk) ?? 0) + e.durationMinutes);

      const eYear = Number(e.date.slice(0, 4));
      if (eYear === year || eYear === year - 1) {
        let cy = cumulative.get(eYear);
        if (!cy) cumulative.set(eYear, (cy = new Map()));
        const md = e.date.slice(5);
        cy.set(md, (cy.get(md) ?? 0) + e.amount);
      }
      if (eYear === year) {
        yearMinutes += e.durationMinutes;
        yearAmount += e.amount;
        const c = clientYear.get(clientId) ?? { minutes: 0, amount: 0 };
        c.minutes += e.durationMinutes;
        c.amount += e.amount;
        clientYear.set(clientId, c);
      }

      if (!e.invoiced && e.billable) {
        outstandingAmount += e.amount;
        outstandingCount += 1;
      }

      // Punchcard: distribute the entry's minutes across the hour cells it
      // spans (wrapping midnight), anchored to the entry date's weekday.
      const dow = (new Date(`${e.date}T00:00:00`).getDay() + 6) % 7; // Mon=0
      const [sh, sm] = e.start.split(':').map(Number);
      let cursor = sh * 60 + sm;
      let remaining = e.durationMinutes;
      while (remaining > 0) {
        const hour = Math.floor(cursor / 60) % 24;
        const inThisHour = Math.min(remaining, 60 - (cursor % 60));
        punch[dow][hour] += inThisHour;
        cursor += inThisHour;
        remaining -= inThisHour;
      }
    }

    // Monthly stacked rows, last 18 months.
    const monthKeys = lastMonthKeys(18);
    const activeClientIds = new Set<string>();
    const monthlyRows: MonthlyRow[] = monthKeys.map((mk) => {
      const row: MonthlyRow = { label: monthLabel(mk) };
      const mc = monthClientAmount.get(mk);
      if (mc) {
        for (const [cid, amount] of mc) {
          if (amount > 0) {
            row[cid] = Math.round(amount * 100) / 100;
            activeClientIds.add(cid);
          }
        }
      }
      return row;
    });
    const monthlyClients = clientColors.filter((c) => activeClientIds.has(c.id));

    // Weekly hours, last 26 weeks.
    const weeks: { label: string; minutes: number }[] = [];
    {
      const cursor = new Date(`${weekStart(today)}T00:00:00`);
      for (let i = 0; i < 26; i++) {
        const ymd = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
        weeks.unshift({
          label: `${cursor.getMonth() + 1}/${cursor.getDate()}`,
          minutes: weekAgg.get(ymd) ?? 0,
        });
        cursor.setDate(cursor.getDate() - 7);
      }
    }

    // Cumulative revenue by day-of-year: this year up to today, last year full.
    const todayMD = today.slice(5);
    const buildCumulative = (y: number, cutoff?: string) => {
      const days = [...(cumulative.get(y) ?? new Map<string, number>()).entries()].sort((x, z) =>
        x[0].localeCompare(z[0])
      );
      const out = new Map<string, number>();
      let run = 0;
      for (const [md, amount] of days) {
        if (cutoff && md > cutoff) break;
        run += amount;
        out.set(md, run);
      }
      return out;
    };
    const curCum = buildCumulative(year, todayMD);
    const prevCum = buildCumulative(year - 1);
    const mdKeys = [...new Set([...curCum.keys(), ...prevCum.keys()])].sort();
    let lastCur: number | null = null;
    let lastPrev: number | null = null;
    const cumulativeRows = mdKeys.map((md) => {
      if (curCum.has(md)) lastCur = curCum.get(md)!;
      if (prevCum.has(md)) lastPrev = prevCum.get(md)!;
      return {
        label: `${Number(md.slice(0, 2))}/${Number(md.slice(3))}`,
        current: md <= todayMD ? lastCur : null,
        previous: lastPrev,
      };
    });

    // Client share, this year.
    const share = [...clientYear.entries()]
      .map(([cid, agg]) => ({
        id: cid,
        name: clientColors.find((c) => c.id === cid)?.name ?? cid,
        color: clientColors.find((c) => c.id === cid)?.color ?? '#5b6070',
        ...agg,
      }))
      .filter((s) => s.minutes > 0)
      .sort((x, z) => z.amount - x.amount);

    const cur = monthAgg.get(thisMonth) ?? { minutes: 0, amount: 0 };
    const last = monthAgg.get(lastMonth) ?? { minutes: 0, amount: 0 };
    const pct = (now: number, then: number) => (then > 0 ? ((now - then) / then) * 100 : null);

    return {
      year,
      cur,
      last,
      hoursDelta: pct(cur.minutes, last.minutes),
      revenueDelta: pct(cur.amount, last.amount),
      outstandingAmount,
      outstandingCount,
      effectiveRate: yearMinutes > 0 ? yearAmount / (yearMinutes / 60) : 0,
      yearAmount,
      monthlyRows,
      monthlyClients,
      weeks,
      cumulativeRows,
      share,
      punch,
    };
  }, [store, projectById, clientColors]);

  const maxShare = Math.max(1, ...a.share.map((s) => s.amount));

  return (
    <div className="space-y-5">
      {/* KPI row */}
      <Card variant="glass" className="p-5">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
          <StatTile
            label="Hours this month"
            value={formatHours(a.cur.minutes)}
            delta={a.hoursDelta}
            sub={<span>vs {formatHours(a.last.minutes)} last month</span>}
          />
          <StatTile
            label="Revenue this month"
            value={formatUsd(a.cur.amount)}
            blurValue
            delta={a.revenueDelta}
            sub={
              <span>
                vs <Money>{formatUsd(a.last.amount)}</Money> last month
              </span>
            }
          />
          <StatTile
            label="Outstanding"
            value={formatUsd(a.outstandingAmount)}
            blurValue
            sub={<span>{a.outstandingCount} open entries</span>}
          />
          <StatTile
            label={`Effective rate ${a.year}`}
            value={`${formatUsd(a.effectiveRate)}/h`}
            blurValue
            sub={
              <span>
                <Money>{formatUsd(a.yearAmount)}</Money> YTD
              </span>
            }
          />
        </div>
      </Card>

      {/* Monthly revenue stacked by client */}
      <Card variant="glass" className="p-5">
        <h3 className="text-[14px] font-semibold text-surface-950 mb-1">Monthly Revenue</h3>
        <p className="text-[12px] text-surface-500 mb-3">Last 18 months, stacked by customer</p>
        <MonthlyRevenueChart data={a.monthlyRows} clients={a.monthlyClients} blur={blurNumbers} />
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Cumulative pace */}
        <Card variant="glass" className="p-5">
          <h3 className="text-[14px] font-semibold text-surface-950 mb-1">Year Pace</h3>
          <p className="text-[12px] text-surface-500 mb-3">
            Cumulative revenue, {a.year} vs {a.year - 1}
          </p>
          <CumulativeCompareChart
            data={a.cumulativeRows}
            thisYear={a.year}
            lastYear={a.year - 1}
            blur={blurNumbers}
          />
        </Card>

        {/* Weekly hours */}
        <Card variant="glass" className="p-5">
          <h3 className="text-[14px] font-semibold text-surface-950 mb-1">Weekly Hours</h3>
          <p className="text-[12px] text-surface-500 mb-3">Last 26 weeks</p>
          <WeeklyHoursChart data={a.weeks} />
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Client share */}
        <Card variant="glass" className="p-5">
          <h3 className="text-[14px] font-semibold text-surface-950 mb-1">Customer Mix</h3>
          <p className="text-[12px] text-surface-500 mb-3">Revenue share, {a.year}</p>
          {a.share.length === 0 ? (
            <p className="text-[13px] text-surface-500">No entries this year yet.</p>
          ) : (
            <div className="space-y-3">
              {a.share.map((s) => (
                <div key={s.id}>
                  <div className="flex items-center justify-between text-[12px] mb-1">
                    <span className="flex items-center gap-1.5 text-surface-800">
                      <span
                        className="w-2 h-2 rounded-full inline-block"
                        style={{ backgroundColor: s.color }}
                      />
                      {s.name}
                    </span>
                    <span className="text-surface-600 tabular-nums">
                      {formatHours(s.minutes)} · <Money>{formatUsd(s.amount)}</Money>
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-surface-200/40 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(2, (s.amount / maxShare) * 100)}%`,
                        backgroundColor: s.color,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Punchcard */}
        <Card variant="glass" className="p-5">
          <h3 className="text-[14px] font-semibold text-surface-950 mb-1">Work Rhythm</h3>
          <p className="text-[12px] text-surface-500 mb-3">
            When you work — all time, by weekday and hour
          </p>
          <Punchcard grid={a.punch} />
        </Card>
      </div>
    </div>
  );
}
