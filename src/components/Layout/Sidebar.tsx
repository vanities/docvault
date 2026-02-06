import {
  Building2,
  User,
  Tractor,
  Plus,
  LayoutGrid,
  Calendar,
  FolderOpen,
  Settings,
  Briefcase,
  Home,
  Store,
  Factory,
  Landmark,
  ShoppingBag,
  Truck,
  Wrench,
  Coffee,
  Leaf,
  Heart,
  Star,
  Zap,
  Globe,
  type LucideIcon,
} from 'lucide-react';
import { useAppContext, type NavView } from '../../contexts/AppContext';
import type { Entity } from '../../types';
import type { EntityConfig } from '../../hooks/useFileSystemServer';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// Icon mapping
const ICON_MAP: Record<string, LucideIcon> = {
  user: User,
  building: Building2,
  briefcase: Briefcase,
  home: Home,
  store: Store,
  factory: Factory,
  landmark: Landmark,
  shopping: ShoppingBag,
  truck: Truck,
  tractor: Tractor,
  wrench: Wrench,
  coffee: Coffee,
  leaf: Leaf,
  heart: Heart,
  star: Star,
  zap: Zap,
  globe: Globe,
};

// Default icons for known entities
const DEFAULT_ENTITY_ICONS: Record<string, string> = {
  all: 'grid',
  personal: 'user',
  'am2-llc': 'building',
  'manna-llc': 'tractor',
};

// Color mapping for dark theme
const COLOR_MAP: Record<string, { accent: string; glow: string; bg: string; text: string }> = {
  blue: {
    accent: 'bg-blue-500/15',
    glow: 'glow-blue',
    bg: 'bg-blue-500/10',
    text: 'text-blue-400',
  },
  green: {
    accent: 'bg-emerald-500/15',
    glow: 'glow-emerald',
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-400',
  },
  amber: {
    accent: 'bg-amber-500/15',
    glow: 'glow-amber',
    bg: 'bg-amber-500/10',
    text: 'text-amber-400',
  },
  purple: {
    accent: 'bg-purple-500/15',
    glow: 'glow-purple',
    bg: 'bg-purple-500/10',
    text: 'text-purple-400',
  },
  pink: {
    accent: 'bg-pink-500/15',
    glow: 'glow-purple',
    bg: 'bg-pink-500/10',
    text: 'text-pink-400',
  },
  red: { accent: 'bg-red-500/15', glow: 'glow-red', bg: 'bg-red-500/10', text: 'text-red-400' },
  gray: {
    accent: 'bg-surface-400/20',
    glow: '',
    bg: 'bg-surface-400/10',
    text: 'text-surface-800',
  },
};

function getEntityIcon(entity: EntityConfig): LucideIcon {
  if (entity.icon && ICON_MAP[entity.icon]) {
    return ICON_MAP[entity.icon];
  }
  const defaultIcon = DEFAULT_ENTITY_ICONS[entity.id];
  if (defaultIcon && ICON_MAP[defaultIcon]) {
    return ICON_MAP[defaultIcon];
  }
  return Building2;
}

interface SidebarProps {
  onAddEntity?: () => void;
}

export function Sidebar({ onAddEntity }: SidebarProps) {
  const {
    selectedEntity,
    setSelectedEntity,
    entities,
    activeView,
    setActiveView,
    isProcessing,
    selectedYear,
    setSelectedYear,
    availableYears,
  } = useAppContext();

  // "All" entity config for display
  const allEntity: EntityConfig = { id: 'all', name: 'All', color: 'gray', path: '' };
  const displayEntities = [allEntity, ...entities];

  const handleEntityClick = (entityId: string) => {
    setSelectedEntity(entityId as Entity);
    // When selecting an entity, switch to tax-year view if in settings
    if (activeView === 'settings') {
      setActiveView('tax-year');
    }
  };

  const handleViewClick = (view: NavView) => {
    setActiveView(view);
  };

  return (
    <aside className="w-60 bg-surface-50 border-r border-border flex flex-col h-full">
      {/* Logo Area */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-accent-500/15 flex items-center justify-center">
            <span className="font-display text-accent-400 text-lg italic">V</span>
          </div>
          <span className="font-display text-xl text-surface-950 italic tracking-tight">
            TaxVault
          </span>
        </div>
      </div>

      {/* Entity Section */}
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        <div className="mb-5">
          <h3 className="text-[10px] font-semibold text-surface-600 uppercase tracking-[0.15em] mb-2 px-2">
            Entities
          </h3>
          <div className="space-y-0.5">
            {displayEntities.map((entity) => {
              const Icon = entity.id === 'all' ? LayoutGrid : getEntityIcon(entity);
              const colors = COLOR_MAP[entity.color] || COLOR_MAP.gray;
              const isSelected = selectedEntity === entity.id;

              return (
                <button
                  key={entity.id}
                  onClick={() => handleEntityClick(entity.id)}
                  disabled={isProcessing}
                  className={`
                    w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-all duration-150 text-left
                    disabled:opacity-40 disabled:cursor-not-allowed
                    ${
                      isSelected
                        ? `${colors.accent} ${colors.text} ${colors.glow}`
                        : `text-surface-800 hover:text-surface-950 hover:bg-surface-200/50`
                    }
                  `}
                >
                  <Icon
                    className={`w-4 h-4 flex-shrink-0 ${isSelected ? colors.text : 'text-surface-600'}`}
                  />
                  <span className="font-medium text-[13px] truncate">{entity.name}</span>
                </button>
              );
            })}

            {/* Add Entity Button */}
            {onAddEntity && (
              <button
                onClick={onAddEntity}
                disabled={isProcessing}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-surface-600 hover:text-surface-800 hover:bg-surface-200/50 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Plus className="w-4 h-4" />
                <span className="font-medium text-[13px]">Add Entity</span>
              </button>
            )}
          </div>
        </div>

        {/* Views Section */}
        <div className="mb-5">
          <h3 className="text-[10px] font-semibold text-surface-600 uppercase tracking-[0.15em] mb-2 px-2">
            Views
          </h3>
          <div className="space-y-0.5">
            {/* Tax Year view button with year stepper */}
            <div
              className={`
                w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-all duration-150
                ${
                  activeView === 'tax-year'
                    ? 'bg-accent-500/10 text-accent-400 glow-emerald'
                    : 'text-surface-800 hover:text-surface-950 hover:bg-surface-200/50'
                }
              `}
            >
              <button
                onClick={() => handleViewClick('tax-year')}
                disabled={isProcessing}
                className="flex items-center gap-2.5 flex-1 min-w-0 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Calendar
                  className={`w-4 h-4 flex-shrink-0 ${activeView === 'tax-year' ? 'text-accent-400' : 'text-surface-600'}`}
                />
                <span className="font-medium text-[13px]">Tax Year</span>
              </button>
              <div className="flex items-center gap-0.5 ml-auto">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const idx = availableYears.indexOf(selectedYear);
                    if (idx < availableYears.length - 1) setSelectedYear(availableYears[idx + 1]);
                  }}
                  disabled={
                    isProcessing ||
                    availableYears.indexOf(selectedYear) >= availableYears.length - 1
                  }
                  className="p-0.5 rounded hover:bg-surface-300/40 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-3 h-3" />
                </button>
                <span className="text-[12px] font-semibold tabular-nums min-w-[32px] text-center">
                  {selectedYear}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const idx = availableYears.indexOf(selectedYear);
                    if (idx > 0) setSelectedYear(availableYears[idx - 1]);
                  }}
                  disabled={isProcessing || availableYears.indexOf(selectedYear) <= 0}
                  className="p-0.5 rounded hover:bg-surface-300/40 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* Business Docs view button */}
            <button
              onClick={() => handleViewClick('business-docs')}
              disabled={isProcessing}
              className={`
                w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-all duration-150 text-left
                disabled:opacity-40 disabled:cursor-not-allowed
                ${
                  activeView === 'business-docs'
                    ? 'bg-accent-500/10 text-accent-400 glow-emerald'
                    : 'text-surface-800 hover:text-surface-950 hover:bg-surface-200/50'
                }
              `}
            >
              <FolderOpen
                className={`w-4 h-4 flex-shrink-0 ${activeView === 'business-docs' ? 'text-accent-400' : 'text-surface-600'}`}
              />
              <span className="font-medium text-[13px]">Business Docs</span>
            </button>
          </div>
        </div>
      </div>

      {/* Settings Section - Fixed at bottom */}
      <div className="border-t border-border p-3">
        <button
          onClick={() => handleViewClick('settings')}
          disabled={isProcessing}
          className={`
            w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-all duration-150 text-left
            disabled:opacity-40 disabled:cursor-not-allowed
            ${
              activeView === 'settings'
                ? 'bg-surface-300/50 text-surface-950'
                : 'text-surface-700 hover:text-surface-900 hover:bg-surface-200/50'
            }
          `}
        >
          <Settings
            className={`w-4 h-4 flex-shrink-0 ${activeView === 'settings' ? 'text-surface-800' : 'text-surface-600'}`}
          />
          <span className="font-medium text-[13px]">Settings</span>
        </button>
      </div>
    </aside>
  );
}
