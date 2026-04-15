// Health sidebar section — appears when the Health entity is selected.
// Extracted from Sidebar.tsx for clarity; the Health feature owns its own
// sidebar block rather than shoehorning into the Tax/Files/Finance layout.
//
// For now this is intentionally minimal: a single "Health" nav button that
// jumps into the HealthView. Future additions (per-person quick links,
// favorite metric views, etc.) can grow here without touching Sidebar.tsx.

import { Heart } from 'lucide-react';
import type { NavView } from '../../contexts/AppContext';

interface HealthSidebarSectionProps {
  activeView: NavView;
  isProcessing: boolean;
  onClick: (view: NavView) => void;
}

export function HealthSidebarSection({
  activeView,
  isProcessing,
  onClick,
}: HealthSidebarSectionProps) {
  const isActive = activeView === 'health';
  return (
    <div className="mb-4">
      <h3 className="text-[10px] font-semibold text-surface-600 uppercase tracking-[0.15em] mb-2 px-2">
        Health
      </h3>
      <div className="space-y-0.5">
        <button
          onClick={() => onClick('health')}
          disabled={isProcessing}
          className={`
            w-full flex items-center gap-2.5 px-2.5 py-3 md:py-2 rounded-lg transition-all duration-150 text-left
            disabled:opacity-40 disabled:cursor-not-allowed
            ${
              isActive
                ? 'bg-rose-500/10 text-rose-400'
                : 'text-surface-800 hover:text-surface-950 hover:bg-surface-200/50'
            }
          `}
        >
          <Heart
            className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-rose-400' : 'text-surface-600'}`}
          />
          <span className="font-medium text-[13px]">Overview</span>
        </button>
      </div>
    </div>
  );
}
