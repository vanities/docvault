import { useState, useEffect, useMemo } from 'react';
import {
  Plus,
  Calendar,
  CalendarDays,
  FolderOpen,
  Settings,
  Files,
  Cloud,
  ChevronLeft,
  ChevronRight,
  Calculator,
  Clock,
  Bitcoin,
  Landmark,
  PieChart,
  Building2,
  ChevronDown as ChevronDownIcon,
  DollarSign,
  Car,
  Check,
  Coins,
  CreditCard,
  MapPin,
  Receipt,
  Scale,
  TrendingUp,
  LineChart,
  Brain,
  MessageCircle,
  Library,
  Newspaper,
  Telescope,
  Cpu,
  History,
  X,
} from 'lucide-react';
import { useAppContext, type NavView, type PersistedThread } from '../../contexts/AppContext';
import type { EntityConfig } from '../../hooks/useFileSystemServer';
import type { SyncStatus } from '../../types';
import { SIDEBAR_COLOR_MAP as COLOR_MAP, renderEntityIcon } from '../../utils/entityDisplay';
import { Button } from '@/components/ui/button';
import { HealthSidebarSection } from './HealthSidebarSection';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

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
  const allEntity: EntityConfig = { id: 'all', name: 'All Entities', color: 'gray', path: '' };
  const current =
    [allEntity, ...entities].find((entity) => entity.id === selectedEntity) ?? allEntity;
  const colors = COLOR_MAP[current.color] || COLOR_MAP.gray;

  // Group entities
  const taxEntities = entities.filter((e) => e.type === 'tax' || !e.type);
  const docEntities = entities.filter((e) => e.type === 'docs');

  const select = (entity: EntityConfig) => {
    onSelect(entity);
    setOpen(false);
  };
  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          disabled={isProcessing}
          aria-label={`Switch entity: ${current.name}`}
          className={`w-full min-h-11 flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-colors border border-border/60 hover:border-border ${colors.accent} disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          {renderEntityIcon(current, `w-4 h-4 shrink-0 ${colors.text}`)}
          <span className={`font-semibold text-[13px] truncate flex-1 text-left ${colors.text}`}>
            {current.name}
          </span>
          <ChevronDownIcon
            className={`w-3.5 h-3.5 ${colors.text} opacity-60 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-(--radix-dropdown-menu-trigger-width) max-h-80"
      >
        <EntityMenuItem
          entity={allEntity}
          isSelected={selectedEntity === 'all'}
          onSelect={() => select(allEntity)}
        />
        {taxEntities.length > 0 && (
          <>
            <DropdownMenuLabel className="text-[10px] text-surface-500 uppercase tracking-wider">
              Tax
            </DropdownMenuLabel>
            {taxEntities.map((entity) => (
              <EntityMenuItem
                key={entity.id}
                entity={entity}
                isSelected={selectedEntity === entity.id}
                onSelect={() => select(entity)}
              />
            ))}
          </>
        )}
        {docEntities.length > 0 && (
          <>
            <DropdownMenuLabel className="text-[10px] text-surface-500 uppercase tracking-wider">
              Documents
            </DropdownMenuLabel>
            {docEntities.map((entity) => (
              <EntityMenuItem
                key={entity.id}
                entity={entity}
                isSelected={selectedEntity === entity.id}
                onSelect={() => select(entity)}
              />
            ))}
          </>
        )}
        {onAddEntity && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onAddEntity} className="min-h-11 gap-2.5">
              <Plus className="size-4" />
              Add Entity
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function EntityMenuItem({
  entity,
  isSelected,
  onSelect,
}: {
  entity: EntityConfig;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const colors = COLOR_MAP[entity.color] || COLOR_MAP.gray;
  return (
    <DropdownMenuItem
      onSelect={onSelect}
      aria-current={isSelected ? 'true' : undefined}
      className={`min-h-11 gap-2.5 ${isSelected ? `${colors.accent} ${colors.text}` : 'text-surface-800'}`}
    >
      {renderEntityIcon(entity, `size-4 shrink-0 ${isSelected ? colors.text : 'text-surface-600'}`)}
      <span className="font-medium text-[13px] break-words flex-1">{entity.name}</span>
      {isSelected && <Check className="size-4 shrink-0 opacity-60" aria-hidden />}
    </DropdownMenuItem>
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
      aria-current={isActive ? 'page' : undefined}
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
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Previous tax year"
        onClick={() => canGoBack && onYearChange(availableYears[idx + 1])}
        disabled={isProcessing || !canGoBack}
        className="text-surface-600"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
      </Button>
      <span className="text-[13px] font-semibold tabular-nums min-w-[40px] text-center text-surface-900">
        {selectedYear}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Next tax year"
        onClick={() => canGoForward && onYearChange(availableYears[idx - 1])}
        disabled={isProcessing || !canGoForward}
        className="text-surface-600"
      >
        <ChevronRight className="w-3.5 h-3.5" />
      </Button>
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
// Chat thread list — nested under the Chat NavButton when chat is active.
// Mirrors t3code's pattern of threads-as-sidebar-rows: each thread is a
// clickable row with title + delete X on hover, and a "New chat" button at
// the top mints a fresh thread.
// ---------------------------------------------------------------------------

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

function ThreadRow({
  thread,
  isActive,
  onSwitch,
  onDelete,
}: {
  thread: PersistedThread;
  isActive: boolean;
  onSwitch: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSwitch(thread.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSwitch(thread.id);
        }
      }}
      className={`group relative flex items-center gap-1.5 px-2 py-1 rounded text-[12px] cursor-pointer ${
        isActive
          ? 'bg-fuchsia-500/10 text-fuchsia-400'
          : 'text-surface-700 hover:text-surface-950 hover:bg-surface-200/50'
      }`}
      title={`${thread.title} · ${relativeTime(thread.updatedAt)}`}
    >
      <span className="flex-1 truncate">{thread.title}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(thread.id);
        }}
        className="text-surface-500 hover:text-danger-400 opacity-0 group-hover:opacity-100 focus:opacity-100"
        aria-label={`Delete ${thread.title}`}
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

// Recent chats shown in the rail before falling through to the history page.
const SIDEBAR_THREAD_LIMIT = 15;

function ChatThreadList() {
  const { chatThreads, switchChatThread, deleteChatThread, newChatThread, setActiveView } =
    useAppContext();

  const sorted = useMemo(
    () => Object.values(chatThreads.threads).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [chatThreads.threads]
  );
  // History is kept in full, so the rail shows only the most recent chats and
  // hands the rest to the searchable history page. Without this cap the sidebar
  // would grow without bound as the archive does.
  const visible = sorted.slice(0, SIDEBAR_THREAD_LIMIT);
  const overflow = sorted.length - visible.length;

  const handleNew = () => {
    newChatThread();
    setActiveView('chat');
  };

  const handleSwitch = (id: string) => {
    switchChatThread(id);
    setActiveView('chat');
  };

  return (
    <div className="mt-1 ml-6 mr-1 space-y-0.5 max-h-72 overflow-y-auto">
      <button
        type="button"
        onClick={handleNew}
        className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-[12px] text-surface-700 hover:text-surface-950 hover:bg-surface-200/50"
      >
        <Plus className="w-3 h-3" />
        New chat
      </button>
      {sorted.length === 0 ? (
        <div className="px-2 py-1 text-[11px] text-surface-500 italic">No chats yet</div>
      ) : (
        visible.map((t) => (
          <ThreadRow
            key={t.id}
            thread={t}
            isActive={t.id === chatThreads.activeThreadId}
            onSwitch={handleSwitch}
            onDelete={deleteChatThread}
          />
        ))
      )}
      {overflow > 0 && (
        <button
          type="button"
          onClick={() => setActiveView('chat-history')}
          className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-[12px] text-surface-700 hover:text-surface-950 hover:bg-surface-200/50"
        >
          <History className="w-3 h-3" />
          See more ({overflow})
        </button>
      )}
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
    requestScopeChange,
    entities,
    activeView,
    isProcessing,
    selectedYear,
    availableYears,
  } = useAppContext();

  const entityConfig = entities.find((e) => e.id === selectedEntity);
  const isDocEntity = entityConfig?.type === 'docs';
  const isTaxEntity = !isDocEntity;
  const showTnTax =
    entityConfig?.type === 'tax' && selectedEntity !== 'all' && selectedEntity !== 'personal';
  const showSolo401k = selectedEntity === 'all';

  const handleEntitySelect = (entity: EntityConfig) => {
    let view = activeView;
    const globalViews: NavView[] = ['sales', 'mileage', 'timesheet', 'income', 'chat', 'calendar'];
    if (!globalViews.includes(activeView)) {
      if (
        (activeView === 'estimated-tax' && entity.id !== 'all') ||
        (activeView === 'tn-tax' && entity.id === 'personal')
      )
        view = 'tax-year';
      else if (activeView === 'settings' || activeView.startsWith('health'))
        view = entity.type === 'docs' ? 'all-files' : 'tax-year';
      else if (entity.type === 'docs' && activeView !== 'all-files') view = 'all-files';
      else if (
        (entity.type === 'tax' || !entity.type) &&
        entity.id !== 'all' &&
        activeView === 'all-files'
      )
        view = 'tax-year';
    }
    void requestScopeChange({ entity: entity.id, view }).then((accepted) => {
      if (accepted) onClose?.();
    });
  };

  const handleViewClick = (view: NavView) => {
    void requestScopeChange({ view }).then((accepted) => {
      if (accepted) onClose?.();
    });
  };

  const handleYearChange = (year: number) => {
    void requestScopeChange({ year, view: 'tax-year' }).then((accepted) => {
      if (accepted) onClose?.();
    });
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
        {/* Records: where documents live and get reviewed */}
        <div className="mb-4">
          <h3 className="text-[10px] font-semibold text-surface-600 uppercase tracking-[0.15em] mb-2 px-2">
            Records
          </h3>
          <div className="space-y-0.5">
            {isTaxEntity && (
              <>
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
              </>
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

        {/* Tax & business workflows: filing, calculations, operational ledgers */}
        {isTaxEntity && (
          <div className="mb-4">
            <h3 className="text-[10px] font-semibold text-surface-600 uppercase tracking-[0.15em] mb-2 px-2">
              Tax & Business
            </h3>
            <div className="space-y-0.5">
              <NavButton
                view="federal-tax"
                label="Federal Taxes"
                icon={Scale}
                activeColor="bg-violet-500/10"
                activeTextColor="text-violet-400"
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
              {selectedEntity === 'all' && (
                <NavButton
                  view="estimated-tax"
                  label="Est. Taxes"
                  icon={Receipt}
                  activeColor="bg-red-500/10"
                  activeTextColor="text-red-400"
                  activeView={activeView}
                  isProcessing={isProcessing}
                  onClick={handleViewClick}
                />
              )}
              {showSolo401k && (
                <NavButton
                  view="solo-401k"
                  label="Solo 401(k)"
                  icon={Landmark}
                  activeColor="bg-blue-500/10"
                  activeTextColor="text-blue-400"
                  activeView={activeView}
                  isProcessing={isProcessing}
                  onClick={handleViewClick}
                />
              )}
              <NavButton
                view="income"
                label="Additional Income"
                icon={Receipt}
                activeColor="bg-teal-500/10"
                activeTextColor="text-teal-400"
                activeView={activeView}
                isProcessing={isProcessing}
                onClick={handleViewClick}
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
              <NavButton
                view="timesheet"
                label="Timesheet"
                icon={Clock}
                activeColor="bg-lime-500/10"
                activeTextColor="text-lime-400"
                activeView={activeView}
                isProcessing={isProcessing}
                onClick={handleViewClick}
              />
            </div>
          </div>
        )}

        {/* Wealth: balance sheet and asset/debt ledgers */}
        <div className="mb-4">
          <h3 className="text-[10px] font-semibold text-surface-600 uppercase tracking-[0.15em] mb-2 px-2">
            Wealth
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
              view="strategy"
              label="Strategy"
              icon={Brain}
              activeColor="bg-purple-500/10"
              activeTextColor="text-purple-400"
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
              view="brokers"
              label="Brokerage"
              icon={Landmark}
              activeColor="bg-accent-500/10"
              activeTextColor="text-accent-400"
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
              view="gold"
              label="Metals"
              icon={Coins}
              activeColor="bg-yellow-500/10"
              activeTextColor="text-yellow-500"
              activeView={activeView}
              isProcessing={isProcessing}
              onClick={handleViewClick}
            />
            <NavButton
              view="property"
              label="Property"
              icon={MapPin}
              activeColor="bg-emerald-500/10"
              activeTextColor="text-emerald-500"
              activeView={activeView}
              isProcessing={isProcessing}
              onClick={handleViewClick}
            />
            <NavButton
              view="debts"
              label="Debts"
              icon={CreditCard}
              activeColor="bg-rose-500/10"
              activeTextColor="text-rose-400"
              activeView={activeView}
              isProcessing={isProcessing}
              onClick={handleViewClick}
            />
          </div>
        </div>

        {/* Intelligence: research, feeds, models, and decision-support views */}
        <div className="mb-4">
          <h3 className="text-[10px] font-semibold text-surface-600 uppercase tracking-[0.15em] mb-2 px-2">
            Intelligence
          </h3>
          <div className="space-y-0.5">
            <NavButton
              view="quant"
              label="Quant"
              icon={LineChart}
              activeColor="bg-cyan-500/10"
              activeTextColor="text-cyan-400"
              activeView={activeView}
              isProcessing={isProcessing}
              onClick={handleViewClick}
            />
            <NavButton
              view="politics"
              label="Politics"
              icon={Scale}
              activeColor="bg-red-500/10"
              activeTextColor="text-red-400"
              activeView={activeView}
              isProcessing={isProcessing}
              onClick={handleViewClick}
            />
            <NavButton
              view="predictions"
              label="Predictions"
              icon={TrendingUp}
              activeColor="bg-teal-500/10"
              activeTextColor="text-teal-400"
              activeView={activeView}
              isProcessing={isProcessing}
              onClick={handleViewClick}
            />
            <NavButton
              view="tech"
              label="Tech"
              icon={Cpu}
              activeColor="bg-indigo-500/10"
              activeTextColor="text-indigo-400"
              activeView={activeView}
              isProcessing={isProcessing}
              onClick={handleViewClick}
            />
            <NavButton
              view="local-news"
              label="Local"
              icon={MapPin}
              activeColor="bg-rose-500/10"
              activeTextColor="text-rose-400"
              activeView={activeView}
              isProcessing={isProcessing}
              onClick={handleViewClick}
            />
            <NavButton
              view="daily-news"
              label="Newsstand"
              icon={Newspaper}
              activeColor="bg-amber-500/10"
              activeTextColor="text-amber-400"
              activeView={activeView}
              isProcessing={isProcessing}
              onClick={handleViewClick}
            />
            <NavButton
              view="external-sources"
              label="Source Library"
              icon={Library}
              activeColor="bg-sky-500/10"
              activeTextColor="text-sky-400"
              activeView={activeView}
              isProcessing={isProcessing}
              onClick={handleViewClick}
            />
            <NavButton
              view="deep-research"
              label="Deep Research"
              icon={Telescope}
              activeColor="bg-violet-500/10"
              activeTextColor="text-violet-400"
              activeView={activeView}
              isProcessing={isProcessing}
              onClick={handleViewClick}
            />
            <NavButton
              view="chat"
              label="Chat"
              icon={MessageCircle}
              activeColor="bg-fuchsia-500/10"
              activeTextColor="text-fuchsia-400"
              activeView={activeView}
              isProcessing={isProcessing}
              onClick={handleViewClick}
            />
            {activeView === 'chat' && <ChatThreadList />}
          </div>
        </div>

        {/* Planning — always visible, independent of selected entity */}
        <div className="mb-4">
          <h3 className="text-[10px] font-semibold text-surface-600 uppercase tracking-[0.15em] mb-2 px-2">
            Planning
          </h3>
          <div className="space-y-0.5">
            <NavButton
              view="calendar"
              label="Calendar"
              icon={CalendarDays}
              activeColor="bg-orange-500/10"
              activeTextColor="text-orange-400"
              activeView={activeView}
              isProcessing={isProcessing}
              onClick={handleViewClick}
            />
          </div>
        </div>

        {/* Health section — always visible, independent of selected entity */}
        <HealthSidebarSection
          activeView={activeView}
          isProcessing={isProcessing}
          onClick={handleViewClick}
        />
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
