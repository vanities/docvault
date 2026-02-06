import { useState } from 'react';
import { X } from 'lucide-react';
import { useAppContext } from '../../contexts/AppContext';
import { useToast } from '../../hooks/useToast';

const COLOR_MAP: Record<string, { bg: string; border: string; ring: string }> = {
  blue: { bg: 'bg-blue-500/15', border: 'border-blue-500/30', ring: 'ring-blue-500' },
  green: { bg: 'bg-emerald-500/15', border: 'border-emerald-500/30', ring: 'ring-emerald-500' },
  amber: { bg: 'bg-amber-500/15', border: 'border-amber-500/30', ring: 'ring-amber-500' },
  purple: { bg: 'bg-purple-500/15', border: 'border-purple-500/30', ring: 'ring-purple-500' },
  pink: { bg: 'bg-pink-500/15', border: 'border-pink-500/30', ring: 'ring-pink-500' },
  red: { bg: 'bg-red-500/15', border: 'border-red-500/30', ring: 'ring-red-500' },
};

const AVAILABLE_COLORS = ['blue', 'green', 'amber', 'purple', 'pink', 'red'];

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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative glass-strong rounded-2xl shadow-2xl p-6 w-full max-w-md animate-scale-in">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-surface-950">Add Business Entity</h2>
          <button
            onClick={onClose}
            className="p-1.5 text-surface-600 hover:text-surface-900 hover:bg-surface-300/30 rounded-lg transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

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
                const colors = COLOR_MAP[c];
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

          <div className="flex gap-3 pt-2">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2.5 text-surface-800 hover:bg-surface-300/30 rounded-xl transition-all text-[13px]"
            >
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={!name.trim() || isAdding}
              className="flex-1 px-4 py-2.5 bg-accent-500 text-surface-0 rounded-xl hover:bg-accent-400 disabled:opacity-40 transition-all text-[13px] font-medium"
            >
              {isAdding ? 'Adding...' : 'Add Entity'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
