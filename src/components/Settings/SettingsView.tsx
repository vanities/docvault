import { useState, useEffect } from 'react';
import {
  Key,
  Save,
  Eye,
  EyeOff,
  CheckCircle,
  AlertCircle,
  Building2,
  User,
  Tractor,
  Pencil,
  Trash2,
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
import { useAppContext } from '../../contexts/AppContext';
import { useToast } from '../../hooks/useToast';
import type { EntityConfig } from '../../hooks/useFileSystemServer';

const API_BASE = 'http://localhost:3005/api';

// Available icons for entities
const AVAILABLE_ICONS: { id: string; icon: LucideIcon; label: string }[] = [
  { id: 'user', icon: User, label: 'Person' },
  { id: 'building', icon: Building2, label: 'Building' },
  { id: 'briefcase', icon: Briefcase, label: 'Briefcase' },
  { id: 'home', icon: Home, label: 'Home' },
  { id: 'store', icon: Store, label: 'Store' },
  { id: 'factory', icon: Factory, label: 'Factory' },
  { id: 'landmark', icon: Landmark, label: 'Bank' },
  { id: 'shopping', icon: ShoppingBag, label: 'Shopping' },
  { id: 'truck', icon: Truck, label: 'Truck' },
  { id: 'tractor', icon: Tractor, label: 'Farm' },
  { id: 'wrench', icon: Wrench, label: 'Tools' },
  { id: 'coffee', icon: Coffee, label: 'Cafe' },
  { id: 'leaf', icon: Leaf, label: 'Nature' },
  { id: 'heart', icon: Heart, label: 'Health' },
  { id: 'star', icon: Star, label: 'Star' },
  { id: 'zap', icon: Zap, label: 'Energy' },
  { id: 'globe', icon: Globe, label: 'Global' },
];

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

const DEFAULT_ENTITY_ICONS: Record<string, string> = {
  personal: 'user',
  'am2-llc': 'building',
  'manna-llc': 'tractor',
};

const COLOR_MAP: Record<string, { bg: string; border: string; text: string; ring: string }> = {
  blue: {
    bg: 'bg-blue-500/15',
    border: 'border-blue-500/30',
    text: 'text-blue-400',
    ring: 'ring-blue-500',
  },
  green: {
    bg: 'bg-emerald-500/15',
    border: 'border-emerald-500/30',
    text: 'text-emerald-400',
    ring: 'ring-emerald-500',
  },
  amber: {
    bg: 'bg-amber-500/15',
    border: 'border-amber-500/30',
    text: 'text-amber-400',
    ring: 'ring-amber-500',
  },
  purple: {
    bg: 'bg-purple-500/15',
    border: 'border-purple-500/30',
    text: 'text-purple-400',
    ring: 'ring-purple-500',
  },
  pink: {
    bg: 'bg-pink-500/15',
    border: 'border-pink-500/30',
    text: 'text-pink-400',
    ring: 'ring-pink-500',
  },
  red: {
    bg: 'bg-red-500/15',
    border: 'border-red-500/30',
    text: 'text-red-400',
    ring: 'ring-red-500',
  },
};

const AVAILABLE_COLORS = ['blue', 'green', 'amber', 'purple', 'pink', 'red'];

interface SettingsData {
  hasAnthropicKey: boolean;
  keySource?: 'settings' | 'env';
  keyHint?: string;
}

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

export function SettingsView() {
  const { entities, updateEntity, removeEntity, selectedEntity, setSelectedEntity } =
    useAppContext();
  const { addToast } = useToast();

  // API Key state
  const [anthropicKey, setAnthropicKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [hasKey, setHasKey] = useState(false);
  const [keySource, setKeySource] = useState<'settings' | 'env' | undefined>();
  const [keyHint, setKeyHint] = useState<string | undefined>();

  // Entity editing state
  const [editingEntity, setEditingEntity] = useState<EntityConfig | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');
  const [editIcon, setEditIcon] = useState('');
  const [isEntitySaving, setIsEntitySaving] = useState(false);

  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE}/settings`);
      const data: SettingsData = await response.json();
      setHasKey(data.hasAnthropicKey || false);
      setKeySource(data.keySource);
      setKeyHint(data.keyHint);
      setAnthropicKey('');
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveKey = async () => {
    setIsSaving(true);
    setSaveStatus('idle');

    try {
      const response = await fetch(`${API_BASE}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anthropicKey: anthropicKey || undefined }),
      });

      const data = await response.json();
      if (data.ok) {
        setSaveStatus('success');
        setHasKey(true);
        setAnthropicKey('');
        addToast('API key saved successfully', 'success');
        setTimeout(() => setSaveStatus('idle'), 3000);
      } else {
        setSaveStatus('error');
      }
    } catch (err) {
      console.error('Failed to save settings:', err);
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearKey = async () => {
    setIsSaving(true);
    try {
      const response = await fetch(`${API_BASE}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearAnthropicKey: true }),
      });

      const data = await response.json();
      if (data.ok) {
        setHasKey(false);
        addToast('API key removed', 'success');
      }
    } catch (err) {
      console.error('Failed to clear key:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditEntity = (entity: EntityConfig) => {
    setEditingEntity(entity);
    setEditName(entity.name);
    setEditColor(entity.color);
    setEditIcon(entity.icon || DEFAULT_ENTITY_ICONS[entity.id] || 'building');
  };

  const handleCancelEdit = () => {
    setEditingEntity(null);
    setEditName('');
    setEditColor('');
    setEditIcon('');
  };

  const handleSaveEntity = async () => {
    if (!editingEntity) return;

    setIsEntitySaving(true);
    const result = await updateEntity(editingEntity.id, {
      name: editName,
      color: editColor,
      icon: editIcon,
    });
    setIsEntitySaving(false);

    if (result) {
      addToast('Entity updated successfully', 'success');
      setEditingEntity(null);
    } else {
      addToast('Failed to update entity', 'error');
    }
  };

  const handleRemoveEntity = async (entity: EntityConfig) => {
    if (!confirm(`Remove "${entity.name}"? This won't delete files.`)) {
      return;
    }

    const success = await removeEntity(entity.id);
    if (success) {
      addToast(`Removed ${entity.name}`, 'success');
      if (selectedEntity === entity.id) {
        setSelectedEntity('personal');
      }
    } else {
      addToast('Failed to remove entity', 'error');
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <h2 className="text-2xl font-bold text-surface-950 mb-8">Settings</h2>

      {/* API Key Section */}
      <section className="glass-card rounded-xl p-6 mb-8">
        <h3 className="text-lg font-semibold text-surface-950 mb-4 flex items-center gap-2">
          <Key className="w-5 h-5" />
          API Configuration
        </h3>

        {isLoading ? (
          <div className="text-center py-4 text-surface-600">Loading...</div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-[13px] font-medium text-surface-800 mb-2">
                Anthropic API Key
              </label>

              {hasKey && keySource === 'settings' ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                    <CheckCircle className="w-5 h-5 text-emerald-400" />
                    <div className="flex-1">
                      <span className="text-[13px] text-emerald-400 font-medium">
                        Custom API key
                      </span>
                      {keyHint && (
                        <span className="text-[13px] text-emerald-400/70 ml-2 font-mono">
                          --------{keyHint}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={handleClearKey}
                      disabled={isSaving}
                      className="text-[13px] text-danger-400 hover:text-danger-300"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ) : hasKey && keySource === 'env' ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 p-3 bg-info-500/10 border border-info-500/20 rounded-xl">
                    <CheckCircle className="w-5 h-5 text-info-400" />
                    <div className="flex-1">
                      <span className="text-[13px] text-info-400 font-medium">
                        Environment variable
                      </span>
                      {keyHint && (
                        <span className="text-[13px] text-info-400/70 ml-2 font-mono">
                          --------{keyHint}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="relative">
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={anthropicKey}
                      onChange={(e) => setAnthropicKey(e.target.value)}
                      placeholder="Enter key to override..."
                      className="w-full px-3 py-2.5 pr-10 bg-surface-200/50 border border-border rounded-xl text-[13px] text-surface-900 font-mono placeholder:text-surface-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-surface-600 hover:text-surface-800"
                    >
                      {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="relative">
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={anthropicKey}
                      onChange={(e) => setAnthropicKey(e.target.value)}
                      placeholder="sk-ant-..."
                      className="w-full px-3 py-2.5 pr-10 bg-surface-200/50 border border-border rounded-xl text-[13px] text-surface-900 font-mono placeholder:text-surface-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-surface-600 hover:text-surface-800"
                    >
                      {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-[11px] text-surface-600">
                    Get your API key at{' '}
                    <a
                      href="https://console.anthropic.com/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent-400 hover:underline"
                    >
                      console.anthropic.com
                    </a>
                  </p>
                </div>
              )}
            </div>

            {/* Save button */}
            {anthropicKey && (
              <button
                onClick={handleSaveKey}
                disabled={isSaving}
                className="flex items-center gap-2 px-4 py-2.5 bg-accent-500 text-surface-0 rounded-xl hover:bg-accent-400 transition-colors disabled:opacity-50 text-[13px] font-medium"
              >
                <Save className="w-4 h-4" />
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            )}

            {/* Status messages */}
            {saveStatus === 'success' && (
              <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                <CheckCircle className="w-5 h-5 text-emerald-400" />
                <span className="text-[13px] text-emerald-400">Settings saved successfully</span>
              </div>
            )}
            {saveStatus === 'error' && (
              <div className="flex items-center gap-2 p-3 bg-danger-500/10 border border-danger-500/20 rounded-xl">
                <AlertCircle className="w-5 h-5 text-danger-400" />
                <span className="text-[13px] text-danger-400">Failed to save settings</span>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Entity Management Section */}
      <section className="glass-card rounded-xl p-6">
        <h3 className="text-lg font-semibold text-surface-950 mb-4 flex items-center gap-2">
          <Building2 className="w-5 h-5" />
          Entity Management
        </h3>
        <p className="text-[13px] text-surface-600 mb-4">
          Manage your tax entities (personal, LLCs, etc.)
        </p>

        <div className="space-y-3">
          {entities.map((entity) => {
            const Icon = getEntityIcon(entity);
            const colors = COLOR_MAP[entity.color] || COLOR_MAP.blue;
            const isEditing = editingEntity?.id === entity.id;
            const isPersonal = entity.id === 'personal';

            return (
              <div
                key={entity.id}
                className={`p-4 rounded-xl border ${isEditing ? 'border-accent-400/30 bg-accent-500/5' : `${colors.border} ${colors.bg}`}`}
              >
                {isEditing ? (
                  <div className="space-y-4">
                    {/* Edit Name */}
                    <div>
                      <label className="block text-[11px] font-medium text-surface-600 mb-1">
                        Name
                      </label>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full px-3 py-2.5 bg-surface-200/50 border border-border rounded-xl text-[13px] text-surface-900"
                      />
                    </div>

                    {/* Edit Icon */}
                    <div>
                      <label className="block text-[11px] font-medium text-surface-600 mb-2">
                        Icon
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {AVAILABLE_ICONS.map(({ id, icon: IconComp, label }) => {
                          const iconColors = COLOR_MAP[editColor] || COLOR_MAP.blue;
                          return (
                            <button
                              key={id}
                              onClick={() => setEditIcon(id)}
                              title={label}
                              className={`p-2 rounded-lg border-2 transition-all ${
                                editIcon === id
                                  ? `${iconColors.bg} ${iconColors.border} ${iconColors.text}`
                                  : 'bg-surface-200/30 border-border text-surface-600 hover:border-surface-500'
                              }`}
                            >
                              <IconComp className="w-4 h-4" />
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Edit Color */}
                    <div>
                      <label className="block text-[11px] font-medium text-surface-600 mb-2">
                        Color
                      </label>
                      <div className="flex gap-2.5">
                        {AVAILABLE_COLORS.map((color) => {
                          const colorStyles = COLOR_MAP[color];
                          return (
                            <button
                              key={color}
                              onClick={() => setEditColor(color)}
                              className={`w-8 h-8 rounded-full ${colorStyles.bg} ${colorStyles.border} border-2 transition-all duration-150 ${
                                editColor === color
                                  ? 'ring-2 ring-offset-2 ring-offset-surface-100 ' +
                                    colorStyles.ring
                                  : ''
                              }`}
                            />
                          );
                        })}
                      </div>
                    </div>

                    {/* Edit Actions */}
                    <div className="flex gap-2 pt-2">
                      <button
                        onClick={handleCancelEdit}
                        className="px-3 py-2 text-[13px] text-surface-700 hover:bg-surface-300/30 rounded-xl transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveEntity}
                        disabled={isEntitySaving}
                        className="px-3 py-2 text-[13px] text-surface-0 bg-accent-500 hover:bg-accent-400 rounded-xl transition-colors disabled:opacity-50 font-medium"
                      >
                        {isEntitySaving ? 'Saving...' : 'Save Changes'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${colors.bg}`}>
                        <Icon className={`w-5 h-5 ${colors.text}`} />
                      </div>
                      <div>
                        <p className={`font-medium ${colors.text}`}>{entity.name}</p>
                        <p className="text-[11px] text-surface-600">{entity.id}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {isPersonal && (
                        <span className="text-[11px] text-surface-500 italic mr-2">Default</span>
                      )}
                      <button
                        onClick={() => handleEditEntity(entity)}
                        className="p-2 text-surface-600 hover:text-surface-800 hover:bg-surface-300/30 rounded-lg transition-colors"
                        title="Edit entity"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      {!isPersonal && (
                        <button
                          onClick={() => handleRemoveEntity(entity)}
                          className="p-2 text-surface-600 hover:text-danger-400 hover:bg-danger-500/10 rounded-lg transition-colors"
                          title="Remove entity"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
