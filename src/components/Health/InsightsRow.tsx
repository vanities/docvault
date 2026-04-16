// Render a row of computed insights as a grid of stat tiles.
// Segments pass their `snapshot.insights` array straight through.

import { Sparkles } from 'lucide-react';
import type { InsightItem } from './types';

interface InsightsRowProps {
  insights: InsightItem[];
  title?: string;
}

function toneClasses(tone: InsightItem['tone']): { border: string; accent: string } {
  switch (tone) {
    case 'good':
      return { border: 'border-emerald-500/15', accent: 'text-emerald-400' };
    case 'warn':
      return { border: 'border-amber-500/15', accent: 'text-amber-400' };
    default:
      return { border: 'border-border/30', accent: 'text-surface-500' };
  }
}

export function InsightsRow({ insights, title = 'Insights' }: InsightsRowProps) {
  if (insights.length === 0) return null;
  return (
    <div>
      <h3 className="text-[11px] font-semibold text-surface-600 uppercase tracking-[0.12em] mb-2.5 flex items-center gap-1.5">
        <Sparkles className="w-3 h-3 text-amber-400" />
        {title}
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {insights.map((insight, i) => {
          const tone = toneClasses(insight.tone);
          return (
            <div
              key={`${insight.label}-${i}`}
              className={`rounded-lg bg-surface-50/50 border ${tone.border} p-3 transition-colors hover:bg-surface-100/40`}
            >
              <div className="text-[10px] uppercase tracking-[0.08em] text-surface-600 font-medium mb-1.5">
                {insight.label}
              </div>
              <div className="font-mono text-base text-surface-950 tabular-nums leading-none">
                {insight.value}
              </div>
              {insight.caption && (
                <div className={`text-[10px] mt-1.5 font-medium ${tone.accent}`}>
                  {insight.caption}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
