// Health sidebar section — always visible, contains Overview + per-segment
// nav buttons. Segment buttons are disabled if no person is selected; when
// one is, clicking a segment routes straight into the Activity/Heart/etc.
// view for that person.

import {
  Heart,
  Activity as ActivityIcon,
  HeartPulse,
  Moon,
  Dumbbell,
  Scale,
  ClipboardList,
} from 'lucide-react';
import type { NavView } from '../../contexts/AppContext';
import { useAppContext } from '../../contexts/AppContext';

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
  const { selectedHealthPersonId } = useAppContext();
  const hasPerson = selectedHealthPersonId !== null;

  return (
    <div className="mb-4">
      <h3 className="text-[10px] font-semibold text-surface-600 uppercase tracking-[0.15em] mb-2 px-2">
        Health
      </h3>
      <div className="space-y-0.5">
        <HealthNavButton
          view="health"
          label="Overview"
          icon={Heart}
          activeView={activeView}
          isProcessing={isProcessing}
          onClick={onClick}
        />
        <HealthNavButton
          view="health-activity"
          label="Activity"
          icon={ActivityIcon}
          activeView={activeView}
          isProcessing={isProcessing}
          disabled={!hasPerson}
          onClick={onClick}
        />
        <HealthNavButton
          view="health-heart"
          label="Heart"
          icon={HeartPulse}
          activeView={activeView}
          isProcessing={isProcessing}
          disabled={!hasPerson}
          onClick={onClick}
        />
        <HealthNavButton
          view="health-sleep"
          label="Sleep"
          icon={Moon}
          activeView={activeView}
          isProcessing={isProcessing}
          disabled={!hasPerson}
          onClick={onClick}
        />
        <HealthNavButton
          view="health-workouts"
          label="Workouts"
          icon={Dumbbell}
          activeView={activeView}
          isProcessing={isProcessing}
          disabled={!hasPerson}
          onClick={onClick}
        />
        <HealthNavButton
          view="health-body"
          label="Body"
          icon={Scale}
          activeView={activeView}
          isProcessing={isProcessing}
          disabled={!hasPerson}
          onClick={onClick}
        />
        <HealthNavButton
          view="health-records"
          label="Records"
          icon={ClipboardList}
          activeView={activeView}
          isProcessing={isProcessing}
          disabled={!hasPerson}
          onClick={onClick}
        />
      </div>
    </div>
  );
}

function HealthNavButton({
  view,
  label,
  icon: Icon,
  activeView,
  isProcessing,
  disabled,
  onClick,
}: {
  view: NavView;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  activeView: NavView;
  isProcessing: boolean;
  disabled?: boolean;
  onClick: (view: NavView) => void;
}) {
  const isActive = activeView === view;
  const isDisabled = isProcessing || disabled;
  const title = disabled ? 'Pick a person from Overview first' : undefined;
  return (
    <button
      onClick={() => !isDisabled && onClick(view)}
      disabled={isDisabled}
      title={title}
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
      <Icon
        className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-rose-400' : 'text-surface-600'}`}
      />
      <span className="font-medium text-[13px]">{label}</span>
    </button>
  );
}
