// Labs tab — blood panels and lab trends. The priority clinical view.
//
// Uses LOINC-keyed grouping so trends are stable across providers.
// Layout: stat-row → out-of-range attention card → panels → trend table.

import { useMemo, useState } from 'react';
import {
  Beaker,
  AlertTriangle,
  FileText,
  Search,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Minus,
} from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, ReferenceArea, Tooltip } from 'recharts';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { StatTile } from '../StatTile';
import { Section, formatDate } from './shared';
import type { ClinicalSummary, LabPanel, LabResult, LabTrend } from '../types';

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatValue(r: LabResult | null): string {
  if (!r) return '—';
  if (r.value !== null) {
    const fixed = Number.isInteger(r.value) ? r.value.toString() : r.value.toFixed(2);
    return r.unit ? `${fixed} ${r.unit}` : fixed;
  }
  return r.valueString ?? '—';
}

function formatRefRange(
  refLow: number | null,
  refHigh: number | null,
  unit: string | null
): string {
  if (refLow !== null && refHigh !== null) return `${refLow}–${refHigh}${unit ? ` ${unit}` : ''}`;
  if (refLow !== null) return `> ${refLow}${unit ? ` ${unit}` : ''}`;
  if (refHigh !== null) return `< ${refHigh}${unit ? ` ${unit}` : ''}`;
  return 'n/a';
}

function flagBadge(flag: 'low' | 'high' | 'normal' | null): {
  text: string;
  bg: string;
  fg: string;
} | null {
  if (!flag) return null;
  if (flag === 'high') return { text: 'HIGH', bg: 'bg-rose-500/10', fg: 'text-rose-400' };
  if (flag === 'low') return { text: 'LOW', bg: 'bg-amber-500/10', fg: 'text-amber-500' };
  return { text: 'NORMAL', bg: 'bg-emerald-500/10', fg: 'text-emerald-500' };
}

function trendDirection(points: LabResult[]): 'up' | 'down' | 'flat' | 'unknown' {
  const numericPoints = points.filter((p) => p.value !== null);
  if (numericPoints.length < 3) return 'unknown';
  const recent = numericPoints.slice(-3).map((p) => p.value as number);
  const oldAvg = (recent[0] + recent[1]) / 2;
  const newVal = recent[2];
  const pctChange = oldAvg === 0 ? 0 : ((newVal - oldAvg) / Math.abs(oldAvg)) * 100;
  if (pctChange > 3) return 'up';
  if (pctChange < -3) return 'down';
  return 'flat';
}

// ---------------------------------------------------------------------------
// Sparkline
// ---------------------------------------------------------------------------

function LabSparkline({ trend }: { trend: LabTrend }) {
  const data = trend.points
    .filter((p) => p.value !== null)
    .map((p) => ({ date: p.date ?? '', value: p.value as number }));

  if (data.length < 2) {
    return (
      <div className="h-12 flex items-center justify-center text-[11px] text-surface-500">
        {data.length === 1 ? 'Single reading' : '—'}
      </div>
    );
  }

  const lineColor =
    trend.latestFlag === 'high'
      ? '#f43f5e'
      : trend.latestFlag === 'low'
        ? '#f59e0b'
        : trend.latestFlag === 'normal'
          ? '#10b981'
          : '#6366f1';

  return (
    <div className="h-12 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          {trend.refLow !== null && trend.refHigh !== null && (
            <ReferenceArea
              y1={trend.refLow}
              y2={trend.refHigh}
              fill="#10b981"
              fillOpacity={0.07}
              stroke="none"
            />
          )}
          <Tooltip
            cursor={{ stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '3 3' }}
            contentStyle={{
              background: 'rgba(15,23,42,0.9)',
              border: '1px solid rgba(148,163,184,0.2)',
              borderRadius: 8,
              fontSize: 11,
              color: '#e2e8f0',
            }}
            labelFormatter={(label) => formatDate(String(label))}
            formatter={(value) => [
              `${String(value)}${trend.unit ? ` ${trend.unit}` : ''}`,
              trend.name,
            ]}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={lineColor}
            strokeWidth={2}
            dot={{ r: 1.5, fill: lineColor }}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Individual lab row
// ---------------------------------------------------------------------------

function LabTrendRow({ trend }: { trend: LabTrend }) {
  const badge = flagBadge(trend.latestFlag);
  const direction = trendDirection(trend.points);
  const TrendIcon = direction === 'up' ? TrendingUp : direction === 'down' ? TrendingDown : Minus;
  const directionTitle =
    direction === 'up'
      ? 'Trending higher over last 3 readings'
      : direction === 'down'
        ? 'Trending lower over last 3 readings'
        : direction === 'flat'
          ? 'Steady over last 3 readings'
          : 'Not enough data to trend';

  return (
    <div className="grid grid-cols-[1fr_110px_110px] gap-4 items-center py-2.5 px-4 border-b border-border/20 hover:bg-surface-100/30 transition-colors">
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-medium text-[13px] text-surface-950 truncate">{trend.name}</span>
          {badge && (
            <span
              className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${badge.bg} ${badge.fg} flex-shrink-0 tracking-wider`}
            >
              {badge.text}
            </span>
          )}
          <TrendIcon
            className="w-3 h-3 text-surface-500 flex-shrink-0"
            aria-label={directionTitle}
          />
        </div>
        <div className="text-[10.5px] text-surface-600 flex items-center gap-2.5 flex-wrap leading-none">
          <span className="font-mono tabular-nums text-surface-800">
            {formatValue(trend.latest)}
          </span>
          <span className="opacity-40">·</span>
          <span>ref {formatRefRange(trend.refLow, trend.refHigh, trend.unit)}</span>
          <span className="opacity-40">·</span>
          <span>
            {trend.points.length} reading{trend.points.length === 1 ? '' : 's'}
          </span>
          {trend.loinc && (
            <>
              <span className="opacity-40">·</span>
              <span className="font-mono text-[10px] opacity-60">LOINC {trend.loinc}</span>
            </>
          )}
        </div>
      </div>
      <div>
        <LabSparkline trend={trend} />
      </div>
      <div className="text-right">
        <div className="text-[11px] text-surface-600 font-mono tabular-nums">
          {formatDate(trend.latest?.effectiveAt ?? null)}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel (DiagnosticReport) expandable card
// ---------------------------------------------------------------------------

function PanelCard({
  panel,
  observations,
}: {
  panel: LabPanel;
  observations: Map<string, LabResult>;
}) {
  const [open, setOpen] = useState(false);
  const results = panel.resultIds
    .map((rid) => observations.get(rid))
    .filter((r): r is LabResult => r !== undefined);
  const outOfRange = results.filter((r) => r.derivedFlag && r.derivedFlag !== 'normal').length;

  return (
    <div className="rounded-lg border border-border/30 bg-surface-50/40 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-surface-100/30 transition-colors text-left"
      >
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-surface-600 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-surface-600 flex-shrink-0" />
        )}
        <FileText className="w-3.5 h-3.5 text-sky-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-[13px] text-surface-950 truncate">{panel.name}</div>
          <div className="text-[10.5px] text-surface-600 flex items-center gap-2 mt-0.5">
            <span className="font-mono tabular-nums">
              {formatDate(panel.effectiveAt ?? panel.issuedAt)}
            </span>
            <span className="opacity-40">·</span>
            <span>
              {results.length} test{results.length === 1 ? '' : 's'}
            </span>
            {outOfRange > 0 && (
              <>
                <span className="opacity-40">·</span>
                <span className="text-rose-400 font-semibold">{outOfRange} out of range</span>
              </>
            )}
          </div>
        </div>
      </button>

      {open && (
        <div className="border-t border-border/30 bg-surface-0/40">
          {results.length === 0 ? (
            <div className="p-4 text-xs text-surface-600 text-center">
              No observation data linked to this panel.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[9.5px] uppercase text-surface-600 tracking-[0.12em] border-b border-border/20">
                  <th className="py-2 px-4 font-semibold">Test</th>
                  <th className="py-2 px-3 text-right font-semibold">Value</th>
                  <th className="py-2 px-3 text-right font-semibold">Reference</th>
                  <th className="py-2 px-3 text-center w-16 font-semibold">Flag</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => {
                  const badge = flagBadge(r.derivedFlag);
                  return (
                    <tr
                      key={r.id}
                      className="border-b border-border/10 last:border-0 hover:bg-surface-100/20"
                    >
                      <td className="py-2 px-4 text-[12.5px] text-surface-800">{r.name}</td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-[12.5px] text-surface-950">
                        {formatValue(r)}
                      </td>
                      <td className="py-2 px-3 text-right text-[10.5px] text-surface-600 font-mono">
                        {formatRefRange(r.refLow, r.refHigh, r.unit)}
                      </td>
                      <td className="py-2 px-3 text-center">
                        {badge && (
                          <span
                            className={`text-[9px] font-semibold px-1.5 py-0.5 rounded tracking-wider ${badge.bg} ${badge.fg}`}
                          >
                            {badge.text}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {panel.conclusion && (
            <div className="px-4 py-3 text-[11.5px] text-surface-700 border-t border-border/20 bg-surface-0/40 leading-relaxed">
              <span className="font-semibold uppercase tracking-[0.12em] text-[10px] text-surface-600 mr-2">
                Conclusion
              </span>
              {panel.conclusion}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LabsTab — main export
// ---------------------------------------------------------------------------

export function LabsTab({ summary }: { summary: ClinicalSummary }) {
  const [query, setQuery] = useState('');

  const observations = useMemo(() => {
    const m = new Map<string, LabResult>();
    for (const trend of summary.labsByTest) {
      for (const p of trend.points) m.set(p.id, p);
    }
    return m;
  }, [summary]);

  const outOfRangeTests = summary.labsByTest.filter(
    (t) => t.latestFlag && t.latestFlag !== 'normal'
  );

  const filteredTests = useMemo(() => {
    if (!query.trim()) return summary.labsByTest;
    const q = query.toLowerCase();
    return summary.labsByTest.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.loinc?.toLowerCase().includes(q) ||
        t.unit?.toLowerCase().includes(q)
    );
  }, [summary.labsByTest, query]);

  const latestPanelDate =
    summary.labPanels[0]?.effectiveAt ?? summary.labPanels[0]?.issuedAt ?? null;

  return (
    <>
      <p className="text-[12px] text-surface-800 mb-6 leading-relaxed">
        Every blood panel and lab result from your linked providers, grouped by LOINC code for
        stable trending across labs. Reference ranges travel with each reading — ranges can
        legitimately change between draws, so we don&apos;t assume a global normal.
      </p>

      <Section title="At a glance">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <StatTile
            icon={Beaker}
            label="Distinct tests"
            value={summary.labsByTest.length.toString()}
            color="text-amber-400"
          />
          <StatTile
            icon={AlertTriangle}
            label="Out of range"
            value={outOfRangeTests.length.toString()}
            color={outOfRangeTests.length > 0 ? 'text-rose-400' : 'text-emerald-400'}
            caption={outOfRangeTests.length > 0 ? 'Latest readings' : 'All in range'}
          />
          <StatTile
            icon={FileText}
            label="Reports"
            value={summary.labPanels.length.toString()}
            color="text-sky-400"
          />
          <StatTile
            icon={CalendarDays}
            label="Latest draw"
            value={formatDate(latestPanelDate)}
            color="text-violet-400"
          />
        </div>
      </Section>

      {outOfRangeTests.length > 0 && (
        <Section
          title="Attention"
          subtitle={`${outOfRangeTests.length} test${outOfRangeTests.length === 1 ? '' : 's'} outside reference range on latest draw`}
        >
          <Card className="border-rose-500/30 bg-rose-500/5 p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {outOfRangeTests.map((t) => {
                const badge = flagBadge(t.latestFlag);
                return (
                  <div
                    key={(t.loinc ?? t.name) + (t.latest?.id ?? '')}
                    className="flex items-center justify-between gap-3 rounded-lg bg-surface-50/60 border border-border/30 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-surface-950 truncate">
                        {t.name}
                      </div>
                      <div className="text-[10.5px] text-surface-600 font-mono leading-none mt-0.5">
                        {formatValue(t.latest)} · ref {formatRefRange(t.refLow, t.refHigh, t.unit)}
                      </div>
                    </div>
                    {badge && (
                      <span
                        className={`text-[9px] font-semibold px-1.5 py-0.5 rounded tracking-wider flex-shrink-0 ${badge.bg} ${badge.fg}`}
                      >
                        {badge.text}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="text-[10.5px] text-surface-600 mt-3 italic leading-relaxed">
              Ranges vary by lab and demographic — values outside reference are informational, not
              diagnostic.
            </div>
          </Card>
        </Section>
      )}

      {summary.labPanels.length > 0 && (
        <Section
          title="Panels"
          subtitle={`${summary.labPanels.length} diagnostic report${summary.labPanels.length === 1 ? '' : 's'}, newest first`}
        >
          <div className="space-y-1.5">
            {summary.labPanels.slice(0, 12).map((panel) => (
              <PanelCard key={panel.id} panel={panel} observations={observations} />
            ))}
          </div>
          {summary.labPanels.length > 12 && (
            <div className="text-[10.5px] text-surface-600 text-center mt-3">
              Showing 12 of {summary.labPanels.length}. Older panels remain in per-test trends
              below.
            </div>
          )}
        </Section>
      )}

      <Section
        title="All tests"
        subtitle={`${summary.labsByTest.length} distinct test${summary.labsByTest.length === 1 ? '' : 's'} · sorted by severity then recency`}
      >
        <div className="mb-3 relative">
          <Search className="w-3.5 h-3.5 text-surface-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <Input
            type="search"
            placeholder="Search by name, LOINC code, or unit…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>

        <div className="rounded-lg border border-border/30 overflow-hidden bg-surface-50/20">
          <div className="grid grid-cols-[1fr_110px_110px] gap-4 text-[9.5px] uppercase tracking-[0.15em] text-surface-600 font-semibold px-4 py-2 bg-surface-100/40 border-b border-border/30">
            <span>Test</span>
            <span>Trend</span>
            <span className="text-right">Latest</span>
          </div>
          {filteredTests.length === 0 ? (
            <div className="p-5 text-center text-[12px] text-surface-600">
              No tests match &ldquo;{query}&rdquo;.
            </div>
          ) : (
            filteredTests.map((t) => (
              <LabTrendRow key={(t.loinc ?? t.name) + (t.latest?.id ?? '')} trend={t} />
            ))
          )}
        </div>
      </Section>
    </>
  );
}

LabsTab.isEmpty = (s: ClinicalSummary): boolean => s.labsByTest.length === 0;
