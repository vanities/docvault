import { useState } from 'react';
import { Building2, User, Tractor, Plus, X, Settings, LayoutGrid } from 'lucide-react';
import type { Entity } from '../../types';
import type { EntityConfig } from '../../hooks/useFileSystemServer';

interface EntitySwitcherProps {
  selectedEntity: Entity;
  entities: EntityConfig[];
  onEntityChange: (entity: Entity) => void;
  onAddEntity?: (id: string, name: string, color: string) => Promise<EntityConfig | null>;
  onRemoveEntity?: (id: string) => Promise<boolean>;
  disabled?: boolean;
}

// Icon mapping - extend as needed
const ENTITY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  all: LayoutGrid,
  personal: User,
  'am2-llc': Building2,
  'manna-llc': Tractor,
};

// Color mapping for Tailwind classes
const COLOR_MAP: Record<string, { bg: string; border: string; text: string; ring: string }> = {
  blue: {
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    text: 'text-blue-700',
    ring: 'ring-blue-500',
  },
  green: {
    bg: 'bg-green-50',
    border: 'border-green-200',
    text: 'text-green-700',
    ring: 'ring-green-500',
  },
  amber: {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-700',
    ring: 'ring-amber-500',
  },
  purple: {
    bg: 'bg-purple-50',
    border: 'border-purple-200',
    text: 'text-purple-700',
    ring: 'ring-purple-500',
  },
  pink: {
    bg: 'bg-pink-50',
    border: 'border-pink-200',
    text: 'text-pink-700',
    ring: 'ring-pink-500',
  },
  red: {
    bg: 'bg-red-50',
    border: 'border-red-200',
    text: 'text-red-700',
    ring: 'ring-red-500',
  },
  gray: {
    bg: 'bg-gray-50',
    border: 'border-gray-200',
    text: 'text-gray-700',
    ring: 'ring-gray-500',
  },
};

const AVAILABLE_COLORS = ['blue', 'green', 'amber', 'purple', 'pink', 'red'];

export function EntitySwitcher({
  selectedEntity,
  entities,
  onEntityChange,
  onAddEntity,
  onRemoveEntity,
  disabled = false,
}: EntitySwitcherProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [showManageModal, setShowManageModal] = useState(false);
  const [newEntityName, setNewEntityName] = useState('');
  const [newEntityColor, setNewEntityColor] = useState('purple');
  const [isAdding, setIsAdding] = useState(false);

  const handleAddEntity = async () => {
    if (!newEntityName.trim() || !onAddEntity) return;

    setIsAdding(true);
    // Generate ID from name
    const id = newEntityName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    const result = await onAddEntity(id, newEntityName.trim(), newEntityColor);
    setIsAdding(false);

    if (result) {
      setNewEntityName('');
      setNewEntityColor('purple');
      setShowAddModal(false);
    }
  };

  const handleRemoveEntity = async (id: string) => {
    if (!onRemoveEntity) return;
    if (!confirm(`Remove "${entities.find((e) => e.id === id)?.name}"? This won't delete files.`)) {
      return;
    }

    await onRemoveEntity(id);

    // If removed entity was selected, switch to personal
    if (selectedEntity === id) {
      onEntityChange('personal');
    }
  };

  // "All" entity config for display
  const allEntity: EntityConfig = { id: 'all', name: 'All', color: 'gray', path: '' };
  const displayEntities = [allEntity, ...entities];

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {displayEntities.map((entity) => {
        const Icon = ENTITY_ICONS[entity.id] || Building2;
        const colors = COLOR_MAP[entity.color] || COLOR_MAP.gray;
        const isSelected = selectedEntity === entity.id;

        return (
          <button
            key={entity.id}
            onClick={() => onEntityChange(entity.id as Entity)}
            disabled={disabled}
            className={`
              flex items-center gap-2 px-4 py-2 rounded-lg border-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed
              ${
                isSelected
                  ? `${colors.bg} ${colors.border} ${colors.text} ring-2 ${colors.ring} ring-offset-1`
                  : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
              }
            `}
          >
            <Icon className="w-4 h-4" />
            <span className="font-medium text-sm">{entity.name}</span>
          </button>
        );
      })}

      {/* Add Entity Button */}
      {onAddEntity && (
        <button
          onClick={() => setShowAddModal(true)}
          disabled={disabled}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-dashed border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus className="w-4 h-4" />
          <span className="font-medium text-sm">Add</span>
        </button>
      )}

      {/* Manage Button */}
      {onRemoveEntity && entities.length > 1 && (
        <button
          onClick={() => setShowManageModal(true)}
          disabled={disabled}
          className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          title="Manage entities"
        >
          <Settings className="w-4 h-4" />
        </button>
      )}

      {/* Add Entity Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowAddModal(false)} />
          <div className="relative bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Add Business Entity</h2>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Entity Name</label>
                <input
                  type="text"
                  value={newEntityName}
                  onChange={(e) => setNewEntityName(e.target.value)}
                  placeholder="e.g., My New LLC"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Color</label>
                <div className="flex gap-2">
                  {AVAILABLE_COLORS.map((color) => {
                    const colors = COLOR_MAP[color];
                    return (
                      <button
                        key={color}
                        onClick={() => setNewEntityColor(color)}
                        className={`w-8 h-8 rounded-full ${colors.bg} ${colors.border} border-2 ${
                          newEntityColor === color ? 'ring-2 ring-offset-2 ' + colors.ring : ''
                        }`}
                      />
                    );
                  })}
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddEntity}
                  disabled={!newEntityName.trim() || isAdding}
                  className="flex-1 px-4 py-2 text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {isAdding ? 'Adding...' : 'Add Entity'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Manage Entities Modal */}
      {showManageModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowManageModal(false)} />
          <div className="relative bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Manage Entities</h2>
              <button
                onClick={() => setShowManageModal(false)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2">
              {entities.map((entity) => {
                const Icon = ENTITY_ICONS[entity.id] || Building2;
                const colors = COLOR_MAP[entity.color] || COLOR_MAP.gray;
                const isPersonal = entity.id === 'personal';

                return (
                  <div
                    key={entity.id}
                    className={`flex items-center justify-between p-3 rounded-lg ${colors.bg} ${colors.border} border`}
                  >
                    <div className="flex items-center gap-3">
                      <Icon className={`w-5 h-5 ${colors.text}`} />
                      <span className={`font-medium ${colors.text}`}>{entity.name}</span>
                    </div>
                    {!isPersonal && onRemoveEntity && (
                      <button
                        onClick={() => handleRemoveEntity(entity.id)}
                        className="p-1 text-red-500 hover:text-red-700 hover:bg-red-100 rounded transition-colors"
                        title="Remove entity"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                    {isPersonal && <span className="text-xs text-gray-400 italic">Default</span>}
                  </div>
                );
              })}
            </div>

            <div className="mt-4 pt-4 border-t border-gray-200">
              <button
                onClick={() => {
                  setShowManageModal(false);
                  setShowAddModal(true);
                }}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add New Entity
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
