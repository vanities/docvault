// Compact score display (0-100) with color coding and visual progress bar.
// Used for Recovery Score and Sleep Quality Score.

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
  if (score >= 80) return 'bg-emerald-500';
  if (score >= 60) return 'bg-sky-500';
  if (score >= 40) return 'bg-amber-500';
  return 'bg-rose-500';
}

function scoreGlow(score: number): string {
  if (score >= 80) return 'shadow-[0_0_24px_rgba(16,185,129,0.15)]';
  if (score >= 60) return 'shadow-[0_0_24px_rgba(14,165,233,0.12)]';
  if (score >= 40) return 'shadow-[0_0_24px_rgba(245,158,11,0.12)]';
  return 'shadow-[0_0_24px_rgba(244,63,94,0.12)]';
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
    <div className={`rounded-xl border border-border/40 bg-surface-50/50 p-4 ${scoreGlow(score)}`}>
      <div className="flex items-start gap-4">
        {/* Score circle */}
        <div className="relative w-16 h-16 flex-shrink-0">
          {/* Background ring */}
          <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
            <circle
              cx="32"
              cy="32"
              r="28"
              fill="none"
              stroke="currentColor"
              strokeWidth="4"
              className="text-surface-200/40"
            />
            <circle
              cx="32"
              cy="32"
              r="28"
              fill="none"
              strokeWidth="4"
              strokeLinecap="round"
              className={scoreBg(score).replace('bg-', 'text-')}
              strokeDasharray={`${(score / 100) * 175.9} 175.9`}
              style={{ filter: 'drop-shadow(0 0 4px currentColor)' }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={`font-mono text-lg font-semibold tabular-nums ${scoreColor(score)}`}>
              {Math.round(score)}
            </span>
          </div>
        </div>

        {/* Labels and breakdown */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Icon className={`w-4 h-4 ${scoreColor(score)}`} />
            <span className="text-xs font-semibold text-surface-600 uppercase tracking-[0.08em]">
              {label}
            </span>
          </div>
          <div className={`text-sm font-medium ${scoreColor(score)} mb-2`}>{scoreLabel(score)}</div>

          {components && components.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {components.map((c) => (
                <div key={c.label} className="flex items-center gap-1.5">
                  <div className="w-5 h-1 rounded-full bg-surface-300/40 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${scoreBg(c.value)} opacity-70`}
                      style={{ width: `${c.value}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-surface-600">
                    <span className="text-surface-800 font-mono tabular-nums">{c.value}</span>{' '}
                    {c.label}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
