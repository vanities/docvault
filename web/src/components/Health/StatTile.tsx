// Shared stat tile for headline numbers across all health segment views.

import type { LucideIcon } from 'lucide-react';

interface StatTileProps {
  icon: LucideIcon;
  label: string;
  value: string;
  color: string;
  caption?: string;
}

export function StatTile({ icon: Icon, label, value, color, caption }: StatTileProps) {
  return (
    <div className="rounded-xl border border-border/30 bg-surface-50/40 p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-4 h-4 ${color} opacity-80`} />
        <div className="text-[10px] uppercase tracking-[0.08em] text-surface-600 font-medium">
          {label}
        </div>
      </div>
      <div className="font-mono text-xl text-surface-950 tabular-nums leading-tight break-words">
        {value}
      </div>
      {caption && (
        <div className={`text-[10px] mt-1 font-medium ${color} opacity-80`}>{caption}</div>
      )}
    </div>
  );
}
