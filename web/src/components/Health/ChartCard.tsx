// Shared wrapper for chart sections — consistent header styling across segments.

import type { LucideIcon } from 'lucide-react';

interface ChartCardProps {
  icon: LucideIcon;
  title: string;
  color: string;
  children: React.ReactNode;
}

export function ChartCard({ icon: Icon, title, color, children }: ChartCardProps) {
  return (
    <div className="rounded-xl border border-border/30 bg-surface-50/30 overflow-hidden">
      <div className="flex items-center gap-2 px-5 pt-4 pb-2">
        <Icon className={`w-4 h-4 ${color} opacity-80`} />
        <h3 className="text-sm font-medium text-surface-950">{title}</h3>
      </div>
      <div className="px-5 pb-5">{children}</div>
    </div>
  );
}
