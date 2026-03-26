import { useState } from 'react';
import { useAppContext } from '../../contexts/AppContext';
import { useToast } from '../../hooks/useToast';
import { SETTINGS_COLOR_MAP, AVAILABLE_COLORS } from '../../utils/entityDisplay';
import {
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
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Business Entity</DialogTitle>
          <DialogDescription>Create a new entity to organize your documents.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div>
            <label className="block text-[13px] font-medium text-surface-800 mb-2">
              Entity Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., My New LLC"
              className="w-full px-3 py-2.5 bg-surface-200/50 border border-border text-surface-900 rounded-xl text-[13px] placeholder-surface-600"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-[13px] font-medium text-surface-800 mb-2">Color</label>
            <div className="flex gap-2.5">
              {AVAILABLE_COLORS.map((c) => {
                const colors = SETTINGS_COLOR_MAP[c];
                return (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className={`w-8 h-8 rounded-full ${colors.bg} ${colors.border} border-2 transition-all duration-150 ${
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

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
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
