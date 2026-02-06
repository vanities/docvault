import { useState, useEffect } from 'react';
import {
  Building2,
  User,
  Tractor,
  Plus,
  X,
  Settings,
  LayoutGrid,
  Pencil,
  FileText,
  Upload,
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
import type { Entity, TaxDocument, DocumentType } from '../../types';
import type { EntityConfig } from '../../hooks/useFileSystemServer';
import { DOCUMENT_TYPES } from '../../config';

interface EntitySwitcherProps {
  selectedEntity: Entity;
  entities: EntityConfig[];
  onEntityChange: (entity: Entity) => void;
  onAddEntity?: (id: string, name: string, color: string) => Promise<EntityConfig | null>;
  onRemoveEntity?: (id: string) => Promise<boolean>;
  onUpdateEntity?: (
    id: string,
    updates: { name?: string; color?: string; icon?: string }
  ) => Promise<EntityConfig | null>;
  businessDocuments?: TaxDocument[];
  onScanBusinessDocs?: (entity: Entity) => Promise<TaxDocument[]>;
  onUploadBusinessDoc?: (file: File, docType: DocumentType, entity: Entity) => Promise<boolean>;
  onOpenFile?: (entity: Entity, filePath: string) => void;
  onDeleteFile?: (entity: Entity, filePath: string) => Promise<boolean>;
  disabled?: boolean;
}

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

// Icon mapping - extend as needed
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

// Default icons for known entities (used if no icon is set)
const DEFAULT_ENTITY_ICONS: Record<string, string> = {
  all: 'grid',
  personal: 'user',
  'am2-llc': 'building',
  'manna-llc': 'tractor',
};

// Get the icon component for an entity
function getEntityIcon(entity: EntityConfig): LucideIcon {
  // Use stored icon if available
  if (entity.icon && ICON_MAP[entity.icon]) {
    return ICON_MAP[entity.icon];
  }
  // Fall back to default based on ID
  const defaultIcon = DEFAULT_ENTITY_ICONS[entity.id];
  if (defaultIcon && ICON_MAP[defaultIcon]) {
    return ICON_MAP[defaultIcon];
  }
  // Default to Building2
  return Building2;
}

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

// Business document types for filtering
const BUSINESS_DOC_TYPES = DOCUMENT_TYPES.filter((dt) => dt.category === 'business');

export function EntitySwitcher({
  selectedEntity,
  entities,
  onEntityChange,
  onAddEntity,
  onRemoveEntity,
  onUpdateEntity,
  onScanBusinessDocs,
  onUploadBusinessDoc,
  onOpenFile,
  onDeleteFile,
  disabled = false,
}: EntitySwitcherProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [showManageModal, setShowManageModal] = useState(false);
  const [showEntityDetailModal, setShowEntityDetailModal] = useState<EntityConfig | null>(null);
  const [newEntityName, setNewEntityName] = useState('');
  const [newEntityColor, setNewEntityColor] = useState('purple');
  const [isAdding, setIsAdding] = useState(false);

  // Edit state
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');
  const [editIcon, setEditIcon] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Business docs state
  const [entityBusinessDocs, setEntityBusinessDocs] = useState<TaxDocument[]>([]);
  const [isLoadingDocs, setIsLoadingDocs] = useState(false);
  const [pendingUpload, setPendingUpload] = useState<{ file: File; type: DocumentType } | null>(
    null
  );

  // Load business docs when entity detail modal opens
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (showEntityDetailModal && onScanBusinessDocs) {
      setIsLoadingDocs(true);
      onScanBusinessDocs(showEntityDetailModal.id as Entity).then((docs) => {
        setEntityBusinessDocs(docs);
        setIsLoadingDocs(false);
      });
    }
  }, [showEntityDetailModal, onScanBusinessDocs]);
  /* eslint-enable react-hooks/set-state-in-effect */

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

  const handleOpenEntityDetail = (entity: EntityConfig) => {
    setShowManageModal(false);
    setShowEntityDetailModal(entity);
    setEditName(entity.name);
    setEditColor(entity.color);
    setEditIcon(entity.icon || DEFAULT_ENTITY_ICONS[entity.id] || 'building');
    setIsEditing(false);
  };

  const handleSaveEntity = async () => {
    if (!showEntityDetailModal || !onUpdateEntity) return;

    setIsSaving(true);
    const result = await onUpdateEntity(showEntityDetailModal.id, {
      name: editName,
      color: editColor,
      icon: editIcon,
    });
    setIsSaving(false);

    if (result) {
      setShowEntityDetailModal(result);
      setIsEditing(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Default to 'formation' type, user can change
    setPendingUpload({ file, type: 'formation' });
    e.target.value = '';
  };

  const handleConfirmUpload = async () => {
    if (!pendingUpload || !showEntityDetailModal || !onUploadBusinessDoc) return;

    const success = await onUploadBusinessDoc(
      pendingUpload.file,
      pendingUpload.type,
      showEntityDetailModal.id as Entity
    );

    if (success && onScanBusinessDocs) {
      // Refresh the docs list
      const docs = await onScanBusinessDocs(showEntityDetailModal.id as Entity);
      setEntityBusinessDocs(docs);
    }

    setPendingUpload(null);
  };

  const handleDeleteDoc = async (doc: TaxDocument) => {
    if (!showEntityDetailModal || !onDeleteFile || !doc.filePath) return;
    if (!confirm(`Delete "${doc.fileName}"?`)) return;

    const success = await onDeleteFile(showEntityDetailModal.id as Entity, doc.filePath);
    if (success) {
      setEntityBusinessDocs((prev) => prev.filter((d) => d.id !== doc.id));
    }
  };

  // "All" entity config for display
  const allEntity: EntityConfig = { id: 'all', name: 'All', color: 'gray', path: '' };
  const displayEntities = [allEntity, ...entities];

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {displayEntities.map((entity) => {
        const Icon = entity.id === 'all' ? LayoutGrid : getEntityIcon(entity);
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
      {onRemoveEntity && entities.length > 0 && (
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

            <p className="text-sm text-gray-500 mb-4">
              Click an entity to view details and business documents.
            </p>

            <div className="space-y-2">
              {entities.map((entity) => {
                const Icon = getEntityIcon(entity);
                const colors = COLOR_MAP[entity.color] || COLOR_MAP.gray;
                const isPersonal = entity.id === 'personal';

                return (
                  <div
                    key={entity.id}
                    className={`flex items-center justify-between p-3 rounded-lg ${colors.bg} ${colors.border} border cursor-pointer hover:opacity-80 transition-opacity`}
                    onClick={() => handleOpenEntityDetail(entity)}
                  >
                    <div className="flex items-center gap-3">
                      <Icon className={`w-5 h-5 ${colors.text}`} />
                      <span className={`font-medium ${colors.text}`}>{entity.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {isPersonal && <span className="text-xs text-gray-400 italic">Default</span>}
                      <Pencil className="w-4 h-4 text-gray-400" />
                    </div>
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

      {/* Entity Detail Modal */}
      {showEntityDetailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowEntityDetailModal(null)}
          />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div className="flex items-center gap-3">
                {(() => {
                  const iconId = isEditing
                    ? editIcon
                    : showEntityDetailModal.icon ||
                      DEFAULT_ENTITY_ICONS[showEntityDetailModal.id] ||
                      'building';
                  const Icon = ICON_MAP[iconId] || Building2;
                  const colors =
                    COLOR_MAP[isEditing ? editColor : showEntityDetailModal.color] ||
                    COLOR_MAP.gray;
                  return (
                    <div className={`p-2 rounded-lg ${colors.bg}`}>
                      <Icon className={`w-6 h-6 ${colors.text}`} />
                    </div>
                  );
                })()}
                {isEditing ? (
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="text-lg font-semibold text-gray-900 border border-gray-300 rounded px-2 py-1"
                    autoFocus
                  />
                ) : (
                  <h2 className="text-lg font-semibold text-gray-900">
                    {showEntityDetailModal.name}
                  </h2>
                )}
              </div>
              <button
                onClick={() => setShowEntityDetailModal(null)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Entity Settings */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-gray-700">Entity Settings</h3>
                  {!isEditing ? (
                    <button
                      onClick={() => setIsEditing(true)}
                      className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
                    >
                      <Pencil className="w-3 h-3" />
                      Edit
                    </button>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setIsEditing(false);
                          setEditName(showEntityDetailModal.name);
                          setEditColor(showEntityDetailModal.color);
                          setEditIcon(
                            showEntityDetailModal.icon ||
                              DEFAULT_ENTITY_ICONS[showEntityDetailModal.id] ||
                              'building'
                          );
                        }}
                        className="text-sm text-gray-500 hover:text-gray-700"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveEntity}
                        disabled={isSaving}
                        className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                      >
                        {isSaving ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  )}
                </div>

                {isEditing && (
                  <div className="space-y-4 p-3 bg-gray-50 rounded-lg">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-2">Icon</label>
                      <div className="flex flex-wrap gap-2">
                        {AVAILABLE_ICONS.map(({ id, icon: IconComp, label }) => {
                          const colors = COLOR_MAP[editColor] || COLOR_MAP.gray;
                          return (
                            <button
                              key={id}
                              onClick={() => setEditIcon(id)}
                              title={label}
                              className={`p-2 rounded-lg border-2 transition-all ${
                                editIcon === id
                                  ? `${colors.bg} ${colors.border} ${colors.text}`
                                  : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                              }`}
                            >
                              <IconComp className="w-4 h-4" />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-2">Color</label>
                      <div className="flex gap-2">
                        {AVAILABLE_COLORS.map((color) => {
                          const colors = COLOR_MAP[color];
                          return (
                            <button
                              key={color}
                              onClick={() => setEditColor(color)}
                              className={`w-6 h-6 rounded-full ${colors.bg} ${colors.border} border-2 ${
                                editColor === color ? 'ring-2 ring-offset-1 ' + colors.ring : ''
                              }`}
                            />
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {!isEditing && (
                  <div className="text-sm text-gray-500">
                    <p>
                      ID:{' '}
                      <code className="bg-gray-100 px-1 rounded">{showEntityDetailModal.id}</code>
                    </p>
                    <p>
                      Path:{' '}
                      <code className="bg-gray-100 px-1 rounded">{showEntityDetailModal.path}</code>
                    </p>
                  </div>
                )}
              </div>

              {/* Business Documents */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-gray-700">Business Documents</h3>
                  <label className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1 cursor-pointer">
                    <Upload className="w-3 h-3" />
                    Upload
                    <input
                      type="file"
                      className="hidden"
                      accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                      onChange={handleFileUpload}
                    />
                  </label>
                </div>

                <p className="text-xs text-gray-500 mb-3">
                  Formation docs, EIN letters, contracts, licenses, and other documents not tied to
                  a specific tax year.
                </p>

                {isLoadingDocs ? (
                  <div className="text-sm text-gray-500 py-4 text-center">Loading...</div>
                ) : entityBusinessDocs.length === 0 ? (
                  <div className="text-sm text-gray-400 py-8 text-center border-2 border-dashed border-gray-200 rounded-lg">
                    No business documents yet
                  </div>
                ) : (
                  <div className="space-y-2">
                    {entityBusinessDocs.map((doc) => {
                      const docTypeInfo = DOCUMENT_TYPES.find((dt) => dt.id === doc.type);
                      return (
                        <div
                          key={doc.id}
                          className="flex items-center justify-between p-3 bg-gray-50 rounded-lg group"
                        >
                          <div
                            className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
                            onClick={() =>
                              onOpenFile?.(showEntityDetailModal.id as Entity, doc.filePath || '')
                            }
                          >
                            <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">
                                {doc.fileName}
                              </p>
                              <p className="text-xs text-gray-500">
                                {docTypeInfo?.label || doc.type}
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={() => handleDeleteDoc(doc)}
                            className="p-1 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Delete"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Danger Zone */}
              {showEntityDetailModal.id !== 'personal' && onRemoveEntity && (
                <div className="pt-4 border-t border-gray-200">
                  <h3 className="text-sm font-medium text-red-600 mb-2">Danger Zone</h3>
                  <button
                    onClick={() => {
                      handleRemoveEntity(showEntityDetailModal.id);
                      setShowEntityDetailModal(null);
                    }}
                    className="text-sm text-red-600 hover:text-red-700 hover:bg-red-50 px-3 py-2 rounded-lg transition-colors"
                  >
                    Remove this entity
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Upload Confirmation Modal */}
      {pendingUpload && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setPendingUpload(null)} />
          <div className="relative bg-white rounded-xl shadow-xl p-6 w-full max-w-sm">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Upload Document</h3>

            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-600 mb-1">File:</p>
                <p className="text-sm font-medium text-gray-900 truncate">
                  {pendingUpload.file.name}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Document Type
                </label>
                <select
                  value={pendingUpload.type}
                  onChange={(e) =>
                    setPendingUpload({ ...pendingUpload, type: e.target.value as DocumentType })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {BUSINESS_DOC_TYPES.map((dt) => (
                    <option key={dt.id} value={dt.id}>
                      {dt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setPendingUpload(null)}
                  className="flex-1 px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmUpload}
                  className="flex-1 px-4 py-2 text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Upload
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
