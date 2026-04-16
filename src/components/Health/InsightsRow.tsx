// Render a row of computed insights as a grid of stat tiles.
// Segments pass their `snapshot.insights` array straight through.

import { Sparkles } from 'lucide-react';
import { Card } from '@/components/ui/card';
import type { InsightItem } from './types';

interface InsightsRowProps {
  insights: InsightItem[];
  title?: string;
}

function toneClasses(tone: InsightItem['tone']): { border: string; bg: string; iconColor: string } {
  switch (tone) {
    case 'good':
      return { border: 'border-emerald-500/20', bg: '', iconColor: 'text-emerald-400' };
    case 'warn':
      return { border: 'border-amber-500/20', bg: '', iconColor: 'text-amber-400' };
    default:
      return { border: 'border-border', bg: '', iconColor: 'text-surface-500' };
  }
}

export function InsightsRow({ insights, title = 'Insights' }: InsightsRowProps) {
  if (insights.length === 0) return null;
  return (
    <div>
      <h3 className="text-xs font-semibold text-surface-600 uppercase tracking-[0.12em] mb-2 flex items-center gap-1.5">
        <Sparkles className="w-3 h-3" />
        {title}
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
        {insights.map((insight, i) => {
          const tone = toneClasses(insight.tone);
          return (
            <Card key={`${insight.label}-${i}`} className={`p-3 ${tone.border}`}>
              <div className="text-[10px] uppercase tracking-wide text-surface-600 mb-1">
                {insight.label}
              </div>
              <div className="font-mono text-base text-surface-950 tabular-nums leading-tight">
                {insight.value}
              </div>
              {insight.caption && (
                <div className={`text-[10px] mt-0.5 ${tone.iconColor}`}>{insight.caption}</div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
