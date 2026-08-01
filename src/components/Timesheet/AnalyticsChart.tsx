// Timesheet analytics charts — recharts pieces styled for the dark surface.
//
// Color method (dataviz skill): categorical hues are assigned to CLIENTS in a
// fixed stable order and follow the client everywhere (never reassigned by
// rank or filter). The palette is the validated dark-mode categorical set —
// adjacent-pair CVD-safe in this order. Sequential (the punchcard) is one blue
// ramp, near-zero receding toward the surface. "This year vs last year" uses
// emphasis: accent hue for the subject, gray for context. One axis everywhere.

import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

import { CHART_ACCENT as ACCENT, CHART_CONTEXT_GRAY as CONTEXT_GRAY, compactUsd } from './types';

const SURFACE = '#16181e'; // card surface — used as the 2px spacer between fills
const GRID = 'rgba(148, 163, 184, 0.08)';
const AXIS_INK = '#898781';

const TOOLTIP_STYLE = {
  background: '#1e242e',
  border: '1px solid rgba(148,163,184,0.12)',
  borderRadius: 10,
  fontSize: 12,
  color: '#f8fafc',
  boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
} as const;

const AXIS_TICK = { fill: AXIS_INK, fontSize: 11 } as const;

function fullUsd(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  });
}

function hoursLabel(minutes: number): string {
  return `${(minutes / 60).toFixed(1)}h`;
}

// ---------------------------------------------------------------------------
// Monthly revenue, stacked by client
// ---------------------------------------------------------------------------

export interface MonthlyRow {
  label: string; // "Jan 26"
  [clientId: string]: string | number;
}

export function MonthlyRevenueChart({
  data,
  clients,
  blur,
}: {
  data: MonthlyRow[];
  clients: { id: string; name: string; color: string }[];
  blur: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} interval={2} />
        <YAxis
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={44}
          tickFormatter={blur ? () => '$•••' : compactUsd}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          cursor={{ fill: 'rgba(148,163,184,0.06)' }}
          formatter={(value, name) => [
            blur ? '$•••' : fullUsd(Number(value)),
            clients.find((c) => c.id === name)?.name ?? String(name),
          ]}
        />
        <Legend
          iconType="circle"
          iconSize={8}
          formatter={(id: string) => (
            <span style={{ color: AXIS_INK, fontSize: 11 }}>
              {clients.find((c) => c.id === id)?.name ?? id}
            </span>
          )}
        />
        {clients.map((c) => (
          // stroke in the surface color = the 2px spacer between stacked fills
          <Bar
            key={c.id}
            dataKey={c.id}
            stackId="revenue"
            fill={c.color}
            stroke={SURFACE}
            strokeWidth={1}
            maxBarSize={26}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Weekly hours — single series, one hue
// ---------------------------------------------------------------------------

export function WeeklyHoursChart({ data }: { data: { label: string; minutes: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} interval={3} />
        <YAxis
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={36}
          tickFormatter={(m: number) => `${Math.round(m / 60)}h`}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          cursor={{ fill: 'rgba(148,163,184,0.06)' }}
          formatter={(value) => [hoursLabel(Number(value)), 'Logged']}
        />
        <Bar dataKey="minutes" fill={ACCENT} radius={[4, 4, 0, 0]} maxBarSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Cumulative revenue — this year (accent) vs last year (context gray)
// ---------------------------------------------------------------------------

export function CumulativeCompareChart({
  data,
  thisYear,
  lastYear,
  blur,
}: {
  data: { label: string; current: number | null; previous: number | null }[];
  thisYear: number;
  lastYear: number;
  blur: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 4, right: 12, bottom: 0, left: 4 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} interval={30} />
        <YAxis
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={44}
          tickFormatter={blur ? () => '$•••' : compactUsd}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={(value, name) => [
            blur ? '$•••' : fullUsd(Number(value)),
            name === 'current' ? String(thisYear) : String(lastYear),
          ]}
        />
        <Legend
          iconType="plainline"
          iconSize={12}
          formatter={(key: string) => (
            <span style={{ color: AXIS_INK, fontSize: 11 }}>
              {key === 'current' ? thisYear : lastYear}
            </span>
          )}
        />
        <Line
          type="monotone"
          dataKey="previous"
          stroke={CONTEXT_GRAY}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
          connectNulls
        />
        <Line
          type="monotone"
          dataKey="current"
          stroke={ACCENT}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Work-rhythm punchcard — weekday × hour heatmap (sequential blue on dark:
// near-zero recedes toward the surface, high values step lighter)
// ---------------------------------------------------------------------------

const HEAT_STEPS = ['#0d366b', '#184f95', '#256abf', '#3987e5', '#6da7ec'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function Punchcard({ grid }: { grid: number[][] }) {
  // grid[weekday][hour] = total minutes logged in that cell, Mon-first.
  const max = Math.max(1, ...grid.flat());
  const color = (minutes: number) => {
    if (minutes === 0) return 'transparent';
    const t = minutes / max;
    return HEAT_STEPS[Math.min(HEAT_STEPS.length - 1, Math.floor(t * HEAT_STEPS.length))];
  };
  const hourLabel = (h: number) =>
    h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`;

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[560px]">
        <div className="grid gap-[2px]" style={{ gridTemplateColumns: '2.5rem repeat(24, 1fr)' }}>
          {WEEKDAYS.map((day, d) => (
            <div key={day} className="contents">
              <div className="text-[10px] text-surface-500 pr-1 flex items-center justify-end">
                {day}
              </div>
              {grid[d].map((minutes, h) => (
                <div
                  key={h}
                  title={`${day} ${hourLabel(h)} — ${(minutes / 60).toFixed(1)}h logged`}
                  className="aspect-square rounded-[3px] border border-border/30"
                  style={{ backgroundColor: color(minutes) }}
                />
              ))}
            </div>
          ))}
          {/* hour axis */}
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="text-[9px] text-surface-500 text-center pt-0.5">
              {h % 4 === 0 ? hourLabel(h) : ''}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
