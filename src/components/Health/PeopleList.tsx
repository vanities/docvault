// People list — shown when no person is selected in the Health view.
// Click a card to drill into that person. Each card has an archive button.

import { useState } from 'react';
import { User, Archive, Trash2, ChevronRight, Edit3 } from 'lucide-react';
import type { HealthPerson } from '../../hooks/useFileSystemServer';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

interface PeopleListProps {
  people: HealthPerson[];
  onSelect: (person: HealthPerson) => void;
  onEdit: (person: HealthPerson) => void;
  onDelete: (id: string, mode: 'archive' | 'delete') => Promise<void>;
}

const COLOR_MAP: Record<string, { bg: string; text: string }> = {
  rose: { bg: 'bg-rose-500/10', text: 'text-rose-400' },
  blue: { bg: 'bg-blue-500/10', text: 'text-blue-400' },
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
  amber: { bg: 'bg-amber-500/10', text: 'text-amber-400' },
  violet: { bg: 'bg-violet-500/10', text: 'text-violet-400' },
  cyan: { bg: 'bg-cyan-500/10', text: 'text-cyan-400' },
  gray: { bg: 'bg-surface-200/60', text: 'text-surface-700' },
};

function colorFor(color?: string): { bg: string; text: string } {
  return COLOR_MAP[color ?? 'rose'] ?? COLOR_MAP.gray;
}

export function PeopleList({ people, onSelect, onEdit, onDelete }: PeopleListProps) {
  const [confirmDelete, setConfirmDelete] = useState<HealthPerson | null>(null);
  const [deleting, setDeleting] = useState(false);

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {people.map((person) => {
          const colors = colorFor(person.color);
          return (
            <Card
              key={person.id}
              className="p-4 cursor-pointer hover:border-accent-500/40 transition-colors"
              onClick={() => onSelect(person)}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${colors.bg}`}
                >
                  <User className={`w-5 h-5 ${colors.text}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-surface-950 truncate">{person.name}</div>
                  <div className="text-xs text-surface-600 truncate font-mono">{person.id}</div>
                </div>
                <ChevronRight className="w-4 h-4 text-surface-500 flex-shrink-0" />
              </div>
              <div className="flex justify-end gap-1 mt-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-surface-600 hover:text-surface-950 h-7 px-2 gap-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(person);
                  }}
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-surface-600 hover:text-danger-400 h-7 px-2 gap-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmDelete(person);
                  }}
                >
                  <Archive className="w-3.5 h-3.5" />
                  Remove
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      <Dialog
        open={Boolean(confirmDelete)}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
      >
        <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove {confirmDelete?.name}?</DialogTitle>
            <DialogDescription>
              Choose how to handle their data.
              <br />
              <strong>Archive</strong> hides them from the list but preserves all exports and parsed
              data — reversible.
              <br />
              <strong>Delete</strong> permanently removes all files and parsed summaries for this
              person. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2 flex-col sm:flex-row">
            <Button variant="ghost" onClick={() => setConfirmDelete(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                if (!confirmDelete) return;
                setDeleting(true);
                await onDelete(confirmDelete.id, 'archive');
                setDeleting(false);
                setConfirmDelete(null);
              }}
              disabled={deleting}
            >
              <Archive className="w-4 h-4 mr-1.5" />
              Archive
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!confirmDelete) return;
                setDeleting(true);
                await onDelete(confirmDelete.id, 'delete');
                setDeleting(false);
                setConfirmDelete(null);
              }}
              disabled={deleting}
            >
              <Trash2 className="w-4 h-4 mr-1.5" />
              Delete All Data
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
