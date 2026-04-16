// Compact score display (0-100) with color coding.
// Used for Recovery Score and Sleep Quality Score.

import { Card } from '@/components/ui/card';

interface ScoreGaugeProps {
  label: string;
  score: number | null;
  icon: React.ComponentType<{ className?: string }>;
  /** Components breakdown — shown as small sub-labels. */
  components?: { label: string; value: number }[];
}

function scoreColor(score: number): string {
  if (score >= 80) return 'text-emerald-400';
  if (score >= 60) return 'text-sky-400';
  if (score >= 40) return 'text-amber-400';
  return 'text-rose-400';
}

function scoreBg(score: number): string {
  if (score >= 80) return 'bg-emerald-500/10 border-emerald-500/20';
  if (score >= 60) return 'bg-sky-500/10 border-sky-500/20';
  if (score >= 40) return 'bg-amber-500/10 border-amber-500/20';
  return 'bg-rose-500/10 border-rose-500/20';
}

function scoreLabel(score: number): string {
  if (score >= 80) return 'Excellent';
  if (score >= 60) return 'Good';
  if (score >= 40) return 'Fair';
  return 'Low';
}

export function ScoreGauge({ label, score, icon: Icon, components }: ScoreGaugeProps) {
  if (score === null) return null;

  return (
    <Card className={`p-4 ${scoreBg(score)}`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-4 h-4 ${scoreColor(score)}`} />
        <div className="text-[10px] uppercase tracking-wide text-surface-600">{label}</div>
      </div>
      <div className="flex items-baseline gap-2">
        <span className={`font-mono text-2xl tabular-nums ${scoreColor(score)}`}>
          {Math.round(score)}
        </span>
        <span className="text-xs text-surface-500">/ 100</span>
        <span className={`text-xs font-medium ${scoreColor(score)}`}>{scoreLabel(score)}</span>
      </div>
      {components && components.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {components.map((c) => (
            <div key={c.label} className="text-[10px] text-surface-500">
              <span className="text-surface-700 font-medium">{c.value}</span> {c.label}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
