// Edit Person dialog — rename + recolor an existing HealthPerson.
// Calls PATCH /api/health/people/:id via useHealthApi.updatePerson.

import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import type { HealthPerson } from '../../hooks/useFileSystemServer';
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

interface EditPersonModalProps {
  isOpen: boolean;
  person: HealthPerson | null;
  onClose: () => void;
  onSave: (id: string, updates: { name: string; color: string }) => Promise<void>;
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

type ColorKey = (typeof COLOR_OPTIONS)[number];

function isColorKey(value: string | undefined): value is ColorKey {
  return typeof value === 'string' && (COLOR_OPTIONS as readonly string[]).includes(value);
}

export function EditPersonModal({ isOpen, person, onClose, onSave }: EditPersonModalProps) {
  const [name, setName] = useState('');
  const [color, setColor] = useState<ColorKey>('rose');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen && person) {
      setName(person.name);
      setColor(isColorKey(person.color) ? person.color : 'rose');
      setSubmitting(false);
    }
  }, [isOpen, person]);

  const trimmed = name.trim();
  const unchanged = !!person && trimmed === person.name && color === (person.color ?? 'rose');

  const handleSubmit = async () => {
    if (!person || !trimmed) return;
    setSubmitting(true);
    try {
      await onSave(person.id, { name: trimmed, color });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !submitting && onClose()}>
      <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Person</DialogTitle>
          <DialogDescription>
            Rename this person or change their color. Their uploaded exports and parsed summaries
            are not affected.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label
              htmlFor="health-edit-person-name"
              className="text-xs font-medium text-surface-700 uppercase tracking-wide"
            >
              Display Name
            </label>
            <Input
              id="health-edit-person-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className="mt-1.5"
              disabled={submitting}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && trimmed && !submitting && !unchanged) {
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
                  disabled={submitting}
                  onClick={() => setColor(opt)}
                  aria-label={opt}
                  className={`
                    w-8 h-8 rounded-full transition-all disabled:cursor-not-allowed
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
          <Button onClick={handleSubmit} disabled={!trimmed || submitting || unchanged}>
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                Saving…
              </>
            ) : (
              'Save'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
