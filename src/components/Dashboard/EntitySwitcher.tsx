import { useState, useEffect } from 'react';
import { Plus, X, Settings, LayoutGrid, Pencil, FileText, Upload, Building2 } from 'lucide-react';
import type { Entity, TaxDocument, DocumentType } from '../../types';
import type { EntityConfig } from '../../hooks/useFileSystemServer';
import { DOCUMENT_TYPES } from '../../config';
import {
  AVAILABLE_ICONS,
  ICON_MAP,
  DEFAULT_ENTITY_ICONS,
  getEntityIcon,
  ENTITY_COLOR_MAP as COLOR_MAP,
  AVAILABLE_COLORS,
} from '../../utils/entityDisplay';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

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
      void onScanBusinessDocs(showEntityDetailModal.id as Entity).then((docs) => {
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
                  : 'bg-transparent border-border/50 text-surface-600 hover:border-border hover:bg-surface-200/50'
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
          className="flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-dashed border-border/50 text-surface-500 hover:border-border hover:text-surface-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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
          className="p-2 rounded-lg text-surface-400 hover:text-surface-600 hover:bg-surface-200/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          title="Manage entities"
        >
          <Settings className="w-4 h-4" />
        </button>
      )}

      {/* Add Entity Modal */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Business Entity</DialogTitle>
            <DialogDescription>Create a new entity to organize your documents.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">
                Entity Name
              </label>
              <input
                type="text"
                value={newEntityName}
                onChange={(e) => setNewEntityName(e.target.value)}
                placeholder="e.g., My New LLC"
                className="w-full px-3 py-2 border border-border/50 rounded-lg bg-transparent text-surface-950 focus:outline-none focus:ring-2 focus:ring-ring"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-surface-700 mb-2">Color</label>
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

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAddModal(false)}>
                Cancel
              </Button>
              <Button onClick={handleAddEntity} disabled={!newEntityName.trim() || isAdding}>
                {isAdding ? 'Adding...' : 'Add Entity'}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Manage Entities Modal */}
      <Dialog open={showManageModal} onOpenChange={setShowManageModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manage Entities</DialogTitle>
            <DialogDescription>
              Click an entity to view details and business documents.
            </DialogDescription>
          </DialogHeader>

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
                    {isPersonal && (
                      <span className="text-xs text-surface-500 italic">Default</span>
                    )}
                    <Pencil className="w-4 h-4 text-surface-400" />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="pt-4 border-t border-border/50">
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setShowManageModal(false);
                setShowAddModal(true);
              }}
            >
              <Plus className="w-4 h-4" />
              Add New Entity
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Entity Detail Modal */}
      <Dialog
        open={!!showEntityDetailModal}
        onOpenChange={(open) => {
          if (!open) setShowEntityDetailModal(null);
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          {/* Header */}
          <DialogHeader className="flex-row items-center gap-3">
            {showEntityDetailModal &&
              (() => {
                const iconId = isEditing
                  ? editIcon
                  : showEntityDetailModal.icon ||
                    DEFAULT_ENTITY_ICONS[showEntityDetailModal.id] ||
                    'building';
                const Icon = ICON_MAP[iconId] || Building2;
                const colors =
                  COLOR_MAP[isEditing ? editColor : showEntityDetailModal.color] || COLOR_MAP.gray;
                return (
                  <div className={`p-2 rounded-lg ${colors.bg}`}>
                    <Icon className={`w-6 h-6 ${colors.text}`} />
                  </div>
                );
              })()}
            {showEntityDetailModal &&
              (isEditing ? (
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="text-lg font-semibold text-surface-950 border border-border/50 rounded px-2 py-1 bg-transparent"
                  autoFocus
                />
              ) : (
                <DialogTitle>{showEntityDetailModal.name}</DialogTitle>
              ))}
            {/* Visually hidden title when editing so Dialog always has one */}
            {isEditing && <DialogTitle className="sr-only">Edit Entity</DialogTitle>}
            <DialogDescription className="sr-only">
              View and manage entity settings and business documents.
            </DialogDescription>
          </DialogHeader>

          {/* Content */}
          {showEntityDetailModal && (
            <div className="flex-1 overflow-y-auto space-y-6">
              {/* Entity Settings */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-surface-700">Entity Settings</h3>
                  {!isEditing ? (
                    <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
                      <Pencil className="w-3 h-3" />
                      Edit
                    </Button>
                  ) : (
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
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
                      >
                        Cancel
                      </Button>
                      <Button size="sm" onClick={handleSaveEntity} disabled={isSaving}>
                        {isSaving ? 'Saving...' : 'Save'}
                      </Button>
                    </div>
                  )}
                </div>

                {isEditing && (
                  <div className="space-y-4 p-3 bg-surface-100/50 rounded-lg">
                    <div>
                      <label className="block text-xs font-medium text-surface-500 mb-2">
                        Icon
                      </label>
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
                                  : 'bg-transparent border-border/50 text-surface-500 hover:border-border'
                              }`}
                            >
                              <IconComp className="w-4 h-4" />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-surface-500 mb-2">
                        Color
                      </label>
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
                  <div className="text-sm text-surface-500">
                    <p>
                      ID:{' '}
                      <code className="bg-surface-100/50 px-1 rounded">
                        {showEntityDetailModal.id}
                      </code>
                    </p>
                    <p>
                      Path:{' '}
                      <code className="bg-surface-100/50 px-1 rounded">
                        {showEntityDetailModal.path}
                      </code>
                    </p>
                  </div>
                )}
              </div>

              {/* Business Documents */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-surface-700">Business Documents</h3>
                  <label className="text-sm text-accent-400 hover:text-accent-300 flex items-center gap-1 cursor-pointer">
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

                <p className="text-xs text-surface-500 mb-3">
                  Formation docs, EIN letters, contracts, licenses, and other documents not tied to
                  a specific tax year.
                </p>

                {isLoadingDocs ? (
                  <div className="text-sm text-surface-500 py-4 text-center">Loading...</div>
                ) : entityBusinessDocs.length === 0 ? (
                  <div className="text-sm text-surface-400 py-8 text-center border-2 border-dashed border-border/50 rounded-lg">
                    No business documents yet
                  </div>
                ) : (
                  <div className="space-y-2">
                    {entityBusinessDocs.map((doc) => {
                      const docTypeInfo = DOCUMENT_TYPES.find((dt) => dt.id === doc.type);
                      return (
                        <div
                          key={doc.id}
                          className="flex items-center justify-between p-3 bg-surface-100/50 rounded-lg group"
                        >
                          <div
                            className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
                            onClick={() =>
                              onOpenFile?.(showEntityDetailModal.id as Entity, doc.filePath || '')
                            }
                          >
                            <FileText className="w-4 h-4 text-surface-400 flex-shrink-0" />
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-surface-950 truncate">
                                {doc.fileName}
                              </p>
                              <p className="text-xs text-surface-500">
                                {docTypeInfo?.label || doc.type}
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={() => handleDeleteDoc(doc)}
                            className="p-1 text-surface-400 hover:text-danger-500 opacity-0 group-hover:opacity-100 transition-opacity"
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
                <div className="pt-4 border-t border-border/50">
                  <h3 className="text-sm font-medium text-danger-500 mb-2">Danger Zone</h3>
                  <Button
                    variant="ghost-danger"
                    size="sm"
                    onClick={() => {
                      void handleRemoveEntity(showEntityDetailModal.id);
                      setShowEntityDetailModal(null);
                    }}
                  >
                    Remove this entity
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Upload Confirmation Modal */}
      <Dialog
        open={!!pendingUpload}
        onOpenChange={(open) => {
          if (!open) setPendingUpload(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Upload Document</DialogTitle>
            <DialogDescription>Choose a document type for the uploaded file.</DialogDescription>
          </DialogHeader>

          {pendingUpload && (
            <div className="space-y-4">
              <div>
                <p className="text-sm text-surface-600 mb-1">File:</p>
                <p className="text-sm font-medium text-surface-950 truncate">
                  {pendingUpload.file.name}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">
                  Document Type
                </label>
                <select
                  value={pendingUpload.type}
                  onChange={(e) =>
                    setPendingUpload({ ...pendingUpload, type: e.target.value as DocumentType })
                  }
                  className="w-full px-3 py-2 border border-border/50 rounded-lg bg-transparent text-surface-950 focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {BUSINESS_DOC_TYPES.map((dt) => (
                    <option key={dt.id} value={dt.id}>
                      {dt.label}
                    </option>
                  ))}
                </select>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setPendingUpload(null)}>
                  Cancel
                </Button>
                <Button onClick={handleConfirmUpload}>Upload</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
