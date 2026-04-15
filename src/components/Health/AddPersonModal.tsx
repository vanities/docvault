// Add Person dialog for the Health view.
// Creates a new HealthPerson via POST /api/health/people.

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

interface AddPersonModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, color: string) => Promise<void>;
}

const COLOR_OPTIONS = ['rose', 'blue', 'emerald', 'amber', 'violet', 'cyan'] as const;

const COLOR_CLASSES: Record<(typeof COLOR_OPTIONS)[number], string> = {
  rose: 'bg-rose-500',
  blue: 'bg-blue-500',
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-500',
  violet: 'bg-violet-500',
  cyan: 'bg-cyan-500',
};

export function AddPersonModal({ isOpen, onClose, onCreate }: AddPersonModalProps) {
  const [name, setName] = useState('');
  const [color, setColor] = useState<(typeof COLOR_OPTIONS)[number]>('rose');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setName('');
      setColor('rose');
      setSubmitting(false);
    }
  }, [isOpen]);

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await onCreate(trimmed, color);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Person</DialogTitle>
          <DialogDescription>
            Each person has their own upload area and parsed summaries.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label
              htmlFor="health-person-name"
              className="text-xs font-medium text-surface-700 uppercase tracking-wide"
            >
              Display Name
            </label>
            <Input
              id="health-person-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Alex"
              autoFocus
              className="mt-1.5"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && name.trim() && !submitting) {
                  void handleSubmit();
                }
              }}
            />
          </div>
          <div>
            <div className="text-xs font-medium text-surface-700 uppercase tracking-wide mb-2">
              Color
            </div>
            <div className="flex gap-2">
              {COLOR_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setColor(opt)}
                  aria-label={opt}
                  className={`
                    w-8 h-8 rounded-full transition-all
                    ${COLOR_CLASSES[opt]}
                    ${color === opt ? 'ring-2 ring-offset-2 ring-offset-surface-0 ring-accent-400' : 'opacity-60 hover:opacity-100'}
                  `}
                />
              ))}
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!name.trim() || submitting}>
            {submitting ? 'Creating…' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
