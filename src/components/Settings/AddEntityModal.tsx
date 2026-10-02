import { useState } from 'react';
import { useAppContext } from '../../contexts/AppContext';
import { useToast } from '../../hooks/useToast';
import { SETTINGS_COLOR_MAP, AVAILABLE_COLORS } from '../../utils/entityDisplay';
import {
  DialogBody,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface AddEntityModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AddEntityModal({ isOpen, onClose }: AddEntityModalProps) {
  const { addEntity } = useAppContext();
  const { addToast } = useToast();

  const [name, setName] = useState('');
  const [color, setColor] = useState('purple');
  const [isAdding, setIsAdding] = useState(false);

  const handleAdd = async () => {
    if (!name.trim()) return;

    setIsAdding(true);
    // Generate ID from name
    const id = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    const result = await addEntity(id, name.trim(), color);
    setIsAdding(false);

    if (result) {
      addToast(`Added ${name}`, 'success');
      setName('');
      setColor('purple');
      onClose();
    } else {
      addToast('Failed to add entity', 'error');
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !isAdding) onClose();
      }}
    >
      <DialogContent closeDisabled={isAdding}>
        <DialogHeader>
          <DialogTitle>Add Business Entity</DialogTitle>
          <DialogDescription>Create a new entity to organize your documents.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-5">
            <div>
              <label
                htmlFor="addentitymodal-field-1"
                className="block text-[13px] font-medium text-surface-800 mb-2"
              >
                Entity Name
              </label>
              <input
                id="addentitymodal-field-1"
                type="text"
                value={name}
                disabled={isAdding}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., My New LLC"
                className="w-full px-3 py-2.5 bg-surface-200/50 border border-border text-surface-900 rounded-xl text-[13px] placeholder-surface-600"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-[13px] font-medium text-surface-800 mb-2">Color</label>
              <div className="flex flex-wrap gap-2.5" role="group" aria-label="Entity color">
                {AVAILABLE_COLORS.map((c) => {
                  const colors = SETTINGS_COLOR_MAP[c];
                  return (
                    <button
                      key={c}
                      type="button"
                      aria-label={c}
                      aria-pressed={color === c}
                      disabled={isAdding}
                      onClick={() => setColor(c)}
                      className={`w-11 h-11 rounded-full ${colors.bg} ${colors.border} border-2 transition-all duration-150 ${
                        color === c
                          ? 'ring-2 ring-offset-2 ring-offset-surface-100 ' + colors.ring
                          : ''
                      }`}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isAdding}>
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={!name.trim() || isAdding}>
            {isAdding ? 'Adding...' : 'Add Entity'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
