import { useState, useEffect, useRef } from 'react';
import {
  Plus,
  Calendar,
  FolderOpen,
  Settings,
  Files,
  Cloud,
  ChevronLeft,
  ChevronRight,
  Calculator,
  Bitcoin,
  Landmark,
  PieChart,
  Building2,
  ChevronDown as ChevronDownIcon,
  DollarSign,
  Car,
  Check,
  Coins,
} from 'lucide-react';
import { useAppContext, type NavView } from '../../contexts/AppContext';
import type { EntityConfig } from '../../hooks/useFileSystemServer';
import type { SyncStatus } from '../../types';
import { SIDEBAR_COLOR_MAP as COLOR_MAP, renderEntityIcon } from '../../utils/entityDisplay';

// ---------------------------------------------------------------------------
// Entity Dropdown Switcher
// ---------------------------------------------------------------------------
function EntitySwitcher({
  entities,
  selectedEntity,
  isProcessing,
  onSelect,
  onAddEntity,
}: {
  entities: EntityConfig[];
  selectedEntity: string;
  isProcessing: boolean;
  onSelect: (entity: EntityConfig) => void;
  onAddEntity?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // "All" pseudo-entity
  const allEntity: EntityConfig = { id: 'all', name: 'All Entities', color: 'gray', path: '' };
  const allEntities = [allEntity, ...entities];
  const current = allEntities.find((e) => e.id === selectedEntity) ?? allEntity;
  const colors = COLOR_MAP[current.color] || COLOR_MAP.gray;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Group entities
  const taxEntities = entities.filter((e) => e.type === 'tax' || !e.type);
  const docEntities = entities.filter((e) => e.type === 'docs');

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        disabled={isProcessing}
        className={`
          w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-all duration-150
          border border-border/60 hover:border-border
          ${colors.accent} disabled:opacity-40 disabled:cursor-not-allowed
        `}
      >
        {renderEntityIcon(current, `w-4 h-4 flex-shrink-0 ${colors.text}`)}
        <span className={`font-semibold text-[13px] truncate flex-1 text-left ${colors.text}`}>
          {current.name}
        </span>
        <ChevronDownIcon
          className={`w-3.5 h-3.5 ${colors.text} opacity-60 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1.5 bg-surface-50 border border-border rounded-xl shadow-xl z-50 py-1.5 max-h-64 overflow-y-auto">
          {/* All */}
          <DropdownItem
            entity={allEntity}
            isSelected={selectedEntity === 'all'}
            onClick={() => {
              onSelect(allEntity);
              setOpen(false);
            }}
          />

          {/* Tax entities */}
          {taxEntities.length > 0 && (
            <>
              <div className="px-3 pt-2.5 pb-1">
                <span className="text-[10px] font-semibold text-surface-500 uppercase tracking-[0.15em]">
                  Tax
                </span>
              </div>
              {taxEntities.map((e) => (
                <DropdownItem
                  key={e.id}
                  entity={e}
                  isSelected={selectedEntity === e.id}
                  onClick={() => {
                    onSelect(e);
                    setOpen(false);
                  }}
                />
              ))}
            </>
          )}

          {/* Doc entities */}
          {docEntities.length > 0 && (
            <>
              <div className="px-3 pt-2.5 pb-1">
                <span className="text-[10px] font-semibold text-surface-500 uppercase tracking-[0.15em]">
                  Documents
                </span>
              </div>
              {docEntities.map((e) => (
                <DropdownItem
                  key={e.id}
                  entity={e}
                  isSelected={selectedEntity === e.id}
                  onClick={() => {
                    onSelect(e);
                    setOpen(false);
                  }}
                />
              ))}
            </>
          )}

          {/* Add entity */}
          {onAddEntity && (
            <>
              <div className="border-t border-border/50 mt-1.5 pt-1.5">
                <button
                  onClick={() => {
                    onAddEntity();
                    setOpen(false);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-surface-600 hover:text-surface-800 hover:bg-surface-200/50 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span className="text-[12px] font-medium">Add Entity</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function DropdownItem({
  entity,
  isSelected,
  onClick,
}: {
  entity: EntityConfig;
  isSelected: boolean;
  onClick: () => void;
}) {
  const colors = COLOR_MAP[entity.color] || COLOR_MAP.gray;
  return (
    <button
      onClick={onClick}
      className={`
        w-full flex items-center gap-2.5 px-3 py-2 transition-colors text-left
        ${isSelected ? `${colors.accent} ${colors.text}` : 'text-surface-800 hover:bg-surface-200/50'}
      `}
    >
      {renderEntityIcon(
        entity,
        `w-3.5 h-3.5 flex-shrink-0 ${isSelected ? colors.text : 'text-surface-600'}`
      )}
      <span className="font-medium text-[12px] truncate flex-1">{entity.name}</span>
      {isSelected && <Check className="w-3 h-3 flex-shrink-0 opacity-60" />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Nav button helper
// ---------------------------------------------------------------------------
function NavButton({
  view,
  label,
  icon: Icon,
  activeColor,
  activeTextColor,
  activeView,
  isProcessing,
  onClick,
  glow,
}: {
  view: NavView;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  activeColor: string;
  activeTextColor: string;
  activeView: NavView;
  isProcessing: boolean;
  onClick: (view: NavView) => void;
  glow?: string;
}) {
  const isActive = activeView === view;
  return (
    <button
      onClick={() => onClick(view)}
      disabled={isProcessing}
      className={`
        w-full flex items-center gap-2.5 px-2.5 py-3 md:py-2 rounded-lg transition-all duration-150 text-left
        disabled:opacity-40 disabled:cursor-not-allowed
        ${isActive ? `${activeColor} ${activeTextColor} ${glow ?? ''}` : 'text-surface-800 hover:text-surface-950 hover:bg-surface-200/50'}
      `}
    >
      <Icon
        className={`w-4 h-4 flex-shrink-0 ${isActive ? activeTextColor : 'text-surface-600'}`}
      />
      <span className="font-medium text-[13px]">{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Year Picker (standalone row)
// ---------------------------------------------------------------------------
function YearPicker({
  selectedYear,
  availableYears,
  isProcessing,
  onYearChange,
}: {
  selectedYear: number;
  availableYears: number[];
  isProcessing: boolean;
  onYearChange: (year: number) => void;
}) {
  const idx = availableYears.indexOf(selectedYear);
  const canGoBack = idx < availableYears.length - 1;
  const canGoForward = idx > 0;

  return (
    <div className="flex items-center justify-center gap-1 px-2.5 py-1.5">
      <button
        onClick={() => canGoBack && onYearChange(availableYears[idx + 1])}
        disabled={isProcessing || !canGoBack}
        className="p-1.5 md:p-1 rounded hover:bg-surface-300/40 transition-all disabled:opacity-30 disabled:cursor-not-allowed text-surface-600"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
      </button>
      <span className="text-[13px] font-semibold tabular-nums min-w-[40px] text-center text-surface-900">
        {selectedYear}
      </span>
      <button
        onClick={() => canGoForward && onYearChange(availableYears[idx - 1])}
        disabled={isProcessing || !canGoForward}
        className="p-1.5 md:p-1 rounded hover:bg-surface-300/40 transition-all disabled:opacity-30 disabled:cursor-not-allowed text-surface-600"
      >
        <ChevronRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sync Indicator
// ---------------------------------------------------------------------------
function formatShortRelative(isoStr: string): string {
  const diffMin = Math.round((Date.now() - new Date(isoStr).getTime()) / 60000);
  if (diffMin < 0) return `in ${Math.abs(diffMin)}m`;
  if (diffMin < 1) return 'now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const hr = Math.round(diffMin / 60);
  if (hr < 24) return `${hr}h ago`;
  return new Date(isoStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function SyncIndicator() {
  const [sync, setSync] = useState<SyncStatus | null>(null);

  useEffect(() => {
    const load = () =>
      fetch('/api/sync-status')
        .then((r) => r.json())
        .then(setSync)
        .catch(() => setSync(null));
    void load();
    const id = setInterval(() => void load(), 30000);
    return () => clearInterval(id);
  }, []);

  if (!sync || sync.status === 'unknown') return null;

  const dotColor =
    sync.status === 'ok'
      ? 'bg-emerald-400'
      : sync.status === 'syncing'
        ? 'bg-blue-400 animate-pulse'
        : sync.status === 'error'
          ? 'bg-red-400'
          : 'bg-surface-500';

  return (
    <div
      className="flex items-center gap-2.5 px-2.5 py-1.5 text-surface-600"
      title={
        sync.lastSync ? `Last synced: ${new Date(sync.lastSync).toLocaleString()}` : 'Dropbox sync'
      }
    >
      <div className="relative">
        <Cloud className="w-4 h-4" />
        <div
          className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full ${dotColor} ring-1 ring-surface-50`}
        />
      </div>
      <span className="text-[11px]">
        {sync.status === 'syncing'
          ? 'Syncing...'
          : sync.lastSync
            ? formatShortRelative(sync.lastSync)
            : 'No sync yet'}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------
interface SidebarProps {
  onAddEntity?: () => void;
  onClose?: () => void;
}

export function Sidebar({ onAddEntity, onClose }: SidebarProps) {
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

  const entityConfig = entities.find((e) => e.id === selectedEntity);
  const isDocEntity = entityConfig?.type === 'docs';
  const isTaxEntity = !isDocEntity;
  const showTnTax =
    entityConfig?.type === 'tax' && selectedEntity !== 'all' && selectedEntity !== 'personal';

  const handleEntitySelect = (entity: EntityConfig) => {
    setSelectedEntity(entity.id);
    // Smart view defaulting
    if (activeView === 'sales' || activeView === 'mileage') {
      onClose?.();
      return;
    }
    if (activeView === 'settings') {
      setActiveView(entity.type === 'docs' ? 'all-files' : 'tax-year');
    } else if (entity.type === 'docs' && activeView !== 'all-files') {
      setActiveView('all-files');
    } else if (
      (entity.type === 'tax' || !entity.type) &&
      entity.id !== 'all' &&
      activeView === 'all-files'
    ) {
      setActiveView('tax-year');
    }
    onClose?.();
  };

  const handleViewClick = (view: NavView) => {
    setActiveView(view);
    onClose?.();
  };

  const handleYearChange = (year: number) => {
    setSelectedYear(year);
    if (activeView !== 'tax-year') setActiveView('tax-year');
  };

  return (
    <aside className="w-60 bg-surface-50 border-r border-border flex flex-col h-full">
      {/* Logo */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-accent-500/15 flex items-center justify-center">
            <span className="font-display text-accent-400 text-lg italic">D</span>
          </div>
          <span className="font-display text-xl text-surface-950 italic tracking-tight">
            DocVault
          </span>
        </div>
      </div>

      {/* Entity Switcher */}
      <div className="px-3 pb-4">
        <EntitySwitcher
          entities={entities}
          selectedEntity={selectedEntity}
          isProcessing={isProcessing}
          onSelect={handleEntitySelect}
          onAddEntity={onAddEntity}
        />
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {/* Tax section — hidden for docs-type entities */}
        {isTaxEntity && (
          <div className="mb-4">
            <h3 className="text-[10px] font-semibold text-surface-600 uppercase tracking-[0.15em] mb-2 px-2">
              Tax
            </h3>
            <div className="space-y-0.5">
              <NavButton
                view="tax-year"
                label="Tax Year"
                icon={Calendar}
                activeColor="bg-accent-500/10"
                activeTextColor="text-accent-400"
                glow="glow-emerald"
                activeView={activeView}
                isProcessing={isProcessing}
                onClick={handleViewClick}
              />

              {/* Year picker — separate row */}
              <YearPicker
                selectedYear={selectedYear}
                availableYears={availableYears}
                isProcessing={isProcessing}
                onYearChange={handleYearChange}
              />

              <NavButton
                view="sales"
                label="Sales"
                icon={DollarSign}
                activeColor="bg-emerald-500/10"
                activeTextColor="text-emerald-400"
                activeView={activeView}
                isProcessing={isProcessing}
                onClick={handleViewClick}
              />
              <NavButton
                view="mileage"
                label="Mileage"
                icon={Car}
                activeColor="bg-sky-500/10"
                activeTextColor="text-sky-400"
                activeView={activeView}
                isProcessing={isProcessing}
                onClick={handleViewClick}
              />

              {showTnTax && (
                <NavButton
                  view="tn-tax"
                  label="TN Tax"
                  icon={Calculator}
                  activeColor="bg-amber-500/10"
                  activeTextColor="text-amber-500"
                  activeView={activeView}
                  isProcessing={isProcessing}
                  onClick={handleViewClick}
                />
              )}
            </div>
          </div>
        )}

        {/* Files section */}
        <div className="mb-4">
          <h3 className="text-[10px] font-semibold text-surface-600 uppercase tracking-[0.15em] mb-2 px-2">
            Files
          </h3>
          <div className="space-y-0.5">
            {isTaxEntity && (
              <NavButton
                view="business-docs"
                label="Business Docs"
                icon={FolderOpen}
                activeColor="bg-accent-500/10"
                activeTextColor="text-accent-400"
                glow="glow-emerald"
                activeView={activeView}
                isProcessing={isProcessing}
                onClick={handleViewClick}
              />
            )}
            <NavButton
              view="all-files"
              label="All Files"
              icon={Files}
              activeColor="bg-accent-500/10"
              activeTextColor="text-accent-400"
              glow="glow-emerald"
              activeView={activeView}
              isProcessing={isProcessing}
              onClick={handleViewClick}
            />
          </div>
        </div>

        {/* Finance section */}
        <div className="mb-4">
          <h3 className="text-[10px] font-semibold text-surface-600 uppercase tracking-[0.15em] mb-2 px-2">
            Finance
          </h3>
          <div className="space-y-0.5">
            <NavButton
              view="portfolio"
              label="Portfolio"
              icon={PieChart}
              activeColor="bg-violet-500/10"
              activeTextColor="text-violet-500"
              activeView={activeView}
              isProcessing={isProcessing}
              onClick={handleViewClick}
            />
            <NavButton
              view="crypto"
              label="Crypto"
              icon={Bitcoin}
              activeColor="bg-amber-500/10"
              activeTextColor="text-amber-500"
              activeView={activeView}
              isProcessing={isProcessing}
              onClick={handleViewClick}
            />
            <NavButton
              view="brokers"
              label="Brokers"
              icon={Landmark}
              activeColor="bg-accent-500/10"
              activeTextColor="text-accent-400"
              activeView={activeView}
              isProcessing={isProcessing}
              onClick={handleViewClick}
            />
            <NavButton
              view="banks"
              label="Banks"
              icon={Building2}
              activeColor="bg-blue-500/10"
              activeTextColor="text-blue-500"
              activeView={activeView}
              isProcessing={isProcessing}
              onClick={handleViewClick}
            />
            <NavButton
              view="gold"
              label="Gold"
              icon={Coins}
              activeColor="bg-yellow-500/10"
              activeTextColor="text-yellow-500"
              activeView={activeView}
              isProcessing={isProcessing}
              onClick={handleViewClick}
            />
          </div>
        </div>
      </div>

      {/* Footer — Sync + Settings */}
      <div className="border-t border-border p-3 space-y-1">
        <SyncIndicator />
        <button
          onClick={() => handleViewClick('settings')}
          disabled={isProcessing}
          className={`
            w-full flex items-center gap-2.5 px-2.5 py-3 md:py-2 rounded-lg transition-all duration-150 text-left
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
