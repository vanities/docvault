import { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { useAppContext, type NavView } from '../../contexts/AppContext';
import type { EntityConfig } from '../../hooks/useFileSystemServer';
import type { SyncStatus } from '../../types';
import { SIDEBAR_COLOR_MAP as COLOR_MAP, renderEntityIcon } from '../../utils/entityDisplay';

function EntityButton({
  entity,
  isSelected,
  isProcessing,
  onClick,
}: {
  entity: EntityConfig;
  isSelected: boolean;
  isProcessing: boolean;
  onClick: () => void;
}) {
  const colors = COLOR_MAP[entity.color] || COLOR_MAP.gray;
  const iconClassName = `w-4 h-4 flex-shrink-0 ${isSelected ? colors.text : 'text-surface-600'}`;

  return (
    <button
      onClick={onClick}
      disabled={isProcessing}
      className={`
        w-full flex items-center gap-2.5 px-2.5 py-3 md:py-2 rounded-lg transition-all duration-150 text-left
        disabled:opacity-40 disabled:cursor-not-allowed
        ${
          isSelected
            ? `${colors.accent} ${colors.text} ${colors.glow}`
            : `text-surface-800 hover:text-surface-950 hover:bg-surface-200/50`
        }
      `}
    >
      {renderEntityIcon(entity, iconClassName)}
      <span className="font-medium text-[13px] truncate">{entity.name}</span>
    </button>
  );
}

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
    load();
    const id = setInterval(load, 30000);
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

  // Group entities by type
  const taxEntities = entities.filter((e) => e.type === 'tax' || !e.type);
  const docEntities = entities.filter((e) => e.type === 'docs');

  // "All" entity config for display
  const allEntity: EntityConfig = { id: 'all', name: 'All', color: 'gray', path: '' };

  const handleEntityClick = (entity: EntityConfig) => {
    setSelectedEntity(entity.id);
    // Smart view defaulting based on entity type
    if (activeView === 'settings') {
      // Always switch away from settings
      if (entity.type === 'docs') {
        setActiveView('all-files');
      } else {
        setActiveView('tax-year');
      }
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

  return (
    <aside className="w-60 bg-surface-50 border-r border-border flex flex-col h-full">
      {/* Logo Area */}
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

      {/* Entity Section */}
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {/* All */}
        <div className="mb-3">
          <div className="space-y-0.5">
            <EntityButton
              entity={allEntity}
              isSelected={selectedEntity === 'all'}
              isProcessing={isProcessing}
              onClick={() => handleEntityClick(allEntity)}
            />
          </div>
        </div>

        {/* Tax Entities */}
        {taxEntities.length > 0 && (
          <div className="mb-3">
            <h3 className="text-[10px] font-semibold text-surface-600 uppercase tracking-[0.15em] mb-2 px-2">
              Tax
            </h3>
            <div className="space-y-0.5">
              {taxEntities.map((entity) => (
                <EntityButton
                  key={entity.id}
                  entity={entity}
                  isSelected={selectedEntity === entity.id}
                  isProcessing={isProcessing}
                  onClick={() => handleEntityClick(entity)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Document Entities */}
        {docEntities.length > 0 && (
          <div className="mb-3">
            <h3 className="text-[10px] font-semibold text-surface-600 uppercase tracking-[0.15em] mb-2 px-2">
              Documents
            </h3>
            <div className="space-y-0.5">
              {docEntities.map((entity) => (
                <EntityButton
                  key={entity.id}
                  entity={entity}
                  isSelected={selectedEntity === entity.id}
                  isProcessing={isProcessing}
                  onClick={() => handleEntityClick(entity)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Add Entity Button */}
        {onAddEntity && (
          <div className="mb-5">
            <button
              onClick={onAddEntity}
              disabled={isProcessing}
              className="w-full flex items-center gap-2.5 px-2.5 py-3 md:py-2 rounded-lg text-surface-600 hover:text-surface-800 hover:bg-surface-200/50 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus className="w-4 h-4" />
              <span className="font-medium text-[13px]">Add Entity</span>
            </button>
          </div>
        )}

        {/* Views Section */}
        <div className="mb-5">
          <h3 className="text-[10px] font-semibold text-surface-600 uppercase tracking-[0.15em] mb-2 px-2">
            Views
          </h3>
          <div className="space-y-0.5">
            {/* Tax Year view button with year stepper */}
            <div
              className={`
                w-full flex items-center gap-2.5 px-2.5 py-3 md:py-2 rounded-lg transition-all duration-150
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
                    if (activeView !== 'tax-year') setActiveView('tax-year');
                  }}
                  disabled={
                    isProcessing ||
                    availableYears.indexOf(selectedYear) >= availableYears.length - 1
                  }
                  className="p-1.5 md:p-0.5 rounded hover:bg-surface-300/40 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
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
                    if (activeView !== 'tax-year') setActiveView('tax-year');
                  }}
                  disabled={isProcessing || availableYears.indexOf(selectedYear) <= 0}
                  className="p-1.5 md:p-0.5 rounded hover:bg-surface-300/40 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* TN Tax view — only for non-personal tax entities */}
            {entityConfig?.type === 'tax' &&
              selectedEntity !== 'all' &&
              selectedEntity !== 'personal' && (
                <button
                  onClick={() => handleViewClick('tn-tax')}
                  disabled={isProcessing}
                  className={`
                    w-full flex items-center gap-2.5 px-2.5 py-3 md:py-2 rounded-lg transition-all duration-150 text-left
                    disabled:opacity-40 disabled:cursor-not-allowed
                    ${
                      activeView === 'tn-tax'
                        ? 'bg-amber-500/10 text-amber-500'
                        : 'text-surface-800 hover:text-surface-950 hover:bg-surface-200/50'
                    }
                  `}
                >
                  <Calculator
                    className={`w-4 h-4 flex-shrink-0 ${activeView === 'tn-tax' ? 'text-amber-500' : 'text-surface-600'}`}
                  />
                  <span className="font-medium text-[13px]">TN Tax</span>
                </button>
              )}

            {/* Business Docs view button */}
            <button
              onClick={() => handleViewClick('business-docs')}
              disabled={isProcessing}
              className={`
                w-full flex items-center gap-2.5 px-2.5 py-3 md:py-2 rounded-lg transition-all duration-150 text-left
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

            {/* All Files view button */}
            <button
              onClick={() => handleViewClick('all-files')}
              disabled={isProcessing}
              className={`
                w-full flex items-center gap-2.5 px-2.5 py-3 md:py-2 rounded-lg transition-all duration-150 text-left
                disabled:opacity-40 disabled:cursor-not-allowed
                ${
                  activeView === 'all-files'
                    ? 'bg-accent-500/10 text-accent-400 glow-emerald'
                    : 'text-surface-800 hover:text-surface-950 hover:bg-surface-200/50'
                }
              `}
            >
              <Files
                className={`w-4 h-4 flex-shrink-0 ${activeView === 'all-files' ? 'text-accent-400' : 'text-surface-600'}`}
              />
              <span className="font-medium text-[13px]">All Files</span>
            </button>

            {/* Crypto view button */}
            <button
              onClick={() => handleViewClick('crypto')}
              disabled={isProcessing}
              className={`
                w-full flex items-center gap-2.5 px-2.5 py-3 md:py-2 rounded-lg transition-all duration-150 text-left
                disabled:opacity-40 disabled:cursor-not-allowed
                ${
                  activeView === 'crypto'
                    ? 'bg-amber-500/10 text-amber-500'
                    : 'text-surface-800 hover:text-surface-950 hover:bg-surface-200/50'
                }
              `}
            >
              <Bitcoin
                className={`w-4 h-4 flex-shrink-0 ${activeView === 'crypto' ? 'text-amber-500' : 'text-surface-600'}`}
              />
              <span className="font-medium text-[13px]">Crypto</span>
            </button>
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
