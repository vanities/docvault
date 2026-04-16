// People list — the main Overview view. Each person gets a rich dashboard
// card with headline tiles pulled from all 5 segment snapshots plus the
// existing Edit / Remove actions. Clicking the card (or any tile) drills
// into the person detail + sets selectedHealthPersonId so the segment
// views in the sidebar can load them directly.

import { useState, useEffect, useRef } from 'react';
import {
  User,
  Archive,
  Trash2,
  ChevronRight,
  Edit3,
  Footprints,
  HeartPulse,
  Moon,
  Dumbbell,
  Scale,
  Loader2,
} from 'lucide-react';
import type { HealthPerson } from '../../hooks/useFileSystemServer';
import type { NavView } from '../../contexts/AppContext';
import { useAppContext } from '../../contexts/AppContext';
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
import { useHealthApi } from './useHealthApi';
import type { PersonSnapshots } from './types';
import { formatInt, formatBpm, formatHours, formatDecimal1 } from './healthFormatters';

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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {people.map((person) => (
          <PersonOverviewCard
            key={person.id}
            person={person}
            onSelect={() => onSelect(person)}
            onEdit={() => onEdit(person)}
            onRemove={() => setConfirmDelete(person)}
          />
        ))}
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

// ---------------------------------------------------------------------------
// One person's Overview card — header + actions + segment preview tiles
// ---------------------------------------------------------------------------

function PersonOverviewCard({
  person,
  onSelect,
  onEdit,
  onRemove,
}: {
  person: HealthPerson;
  onSelect: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const api = useHealthApi();
  const { setSelectedHealthPersonId, setActiveView } = useAppContext();
  const colors = colorFor(person.color);
  const [snapshot, setSnapshot] = useState<PersonSnapshots | null>(null);
  const [snapshotState, setSnapshotState] = useState<'loading' | 'loaded' | 'empty' | 'error'>(
    'loading'
  );
  // Use a ref so we don't re-fetch on every render; only when the person id changes
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    if (loadedFor.current === person.id) return;
    loadedFor.current = person.id;
    setSnapshotState('loading');
    void api
      .getSnapshot(person.id, 'all')
      .then((res) => {
        setSnapshot(res.data);
        setSnapshotState('loaded');
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('No parsed summary')) {
          setSnapshotState('empty');
        } else {
          setSnapshotState('error');
        }
      });
  }, [api, person.id]);

  // Click handlers for per-segment tiles
  const gotoSegment = (view: NavView) => {
    setSelectedHealthPersonId(person.id);
    setActiveView(view);
  };

  return (
    <Card className="p-5 transition-colors">
      {/* Header row */}
      <div className="flex items-start gap-3 mb-4">
        <div
          className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${colors.bg}`}
        >
          <User className={`w-5 h-5 ${colors.text}`} />
        </div>
        <button
          type="button"
          onClick={onSelect}
          className="flex-1 min-w-0 text-left hover:underline"
        >
          <div className="font-medium text-surface-950 truncate">{person.name}</div>
          <div className="text-xs text-surface-600 truncate font-mono">{person.id}</div>
        </button>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="text-surface-600 hover:text-surface-950 h-7 px-2 gap-1"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
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
              onRemove();
            }}
          >
            <Archive className="w-3.5 h-3.5" />
            Remove
          </Button>
          <ChevronRight className="w-4 h-4 text-surface-500 flex-shrink-0 ml-1" />
        </div>
      </div>

      {/* Snapshot preview state */}
      {snapshotState === 'loading' && (
        <div className="flex items-center gap-2 text-sm text-surface-600 py-3">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Loading snapshot…
        </div>
      )}

      {snapshotState === 'empty' && (
        <div className="text-sm text-surface-600 py-3 border-t border-border/40">
          No parsed data yet. Click{' '}
          <button type="button" className="text-accent-400 hover:underline" onClick={onSelect}>
            into this person
          </button>{' '}
          to upload an <code className="font-mono text-[11px]">export.zip</code>.
        </div>
      )}

      {snapshotState === 'error' && (
        <div className="text-sm text-danger-400 py-3 border-t border-border/40">
          Couldn&apos;t load snapshot — try refreshing.
        </div>
      )}

      {snapshotState === 'loaded' && snapshot && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 border-t border-border/40 pt-3">
          <PreviewTile
            icon={Footprints}
            label="Avg daily steps"
            value={formatInt(snapshot.activity.headline.avgDailySteps90d)}
            caption="last 90 days"
            color="text-emerald-400"
            onClick={() => gotoSegment('health-activity')}
          />
          <PreviewTile
            icon={HeartPulse}
            label="Resting HR"
            value={
              snapshot.heart.headline.latestRestingHR !== null
                ? formatBpm(snapshot.heart.headline.latestRestingHR)
                : '—'
            }
            caption={
              snapshot.heart.headline.avgRestingHR90d !== null
                ? `90d avg ${formatBpm(snapshot.heart.headline.avgRestingHR90d)}`
                : undefined
            }
            color="text-rose-400"
            onClick={() => gotoSegment('health-heart')}
          />
          <PreviewTile
            icon={Moon}
            label="Avg sleep"
            value={formatHours(snapshot.sleep.headline.avgSleepHours90d)}
            caption={`${snapshot.sleep.headline.nightsWith7Plus.toLocaleString()} night${
              snapshot.sleep.headline.nightsWith7Plus === 1 ? '' : 's'
            } 7+ hrs`}
            color="text-violet-400"
            onClick={() => gotoSegment('health-sleep')}
          />
          <PreviewTile
            icon={Dumbbell}
            label="Workouts"
            value={formatInt(snapshot.workouts.headline.totalWorkouts)}
            caption={
              snapshot.workouts.headline.favoriteType
                ? `fav: ${snapshot.workouts.headline.favoriteType}`
                : 'all-time'
            }
            color="text-amber-400"
            onClick={() => gotoSegment('health-workouts')}
          />
          <PreviewTile
            icon={Scale}
            label="Current weight"
            value={
              snapshot.body.headline.currentLb !== null
                ? `${formatDecimal1(snapshot.body.headline.currentLb)} lb`
                : '—'
            }
            caption={
              snapshot.body.weightHistory.length > 0
                ? `${snapshot.body.weightHistory.length.toLocaleString()} measurement${
                    snapshot.body.weightHistory.length === 1 ? '' : 's'
                  }`
                : 'no data'
            }
            color="text-sky-400"
            onClick={() => gotoSegment('health-body')}
          />
          <PreviewTile
            icon={Footprints}
            label="10k-step days"
            value={formatInt(snapshot.activity.daily.filter((d) => d.steps >= 10_000).length)}
            caption={`of ${formatInt(snapshot.activity.daily.length)} total`}
            color="text-emerald-400"
            onClick={() => gotoSegment('health-activity')}
          />
        </div>
      )}
    </Card>
  );
}

function PreviewTile({
  icon: Icon,
  label,
  value,
  caption,
  color,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  caption?: string;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="p-2.5 rounded-lg border border-border hover:border-accent-500/40 text-left transition-colors"
    >
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={`w-3 h-3 ${color}`} />
        <div className="text-[10px] uppercase tracking-wide text-surface-600">{label}</div>
      </div>
      <div className="font-mono text-base text-surface-950 tabular-nums leading-tight">{value}</div>
      {caption && <div className="text-[10px] mt-0.5 text-surface-600">{caption}</div>}
    </button>
  );
}
