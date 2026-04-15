// Health view — top-level orchestrator for Apple Health data.
//
// Layout:
//   - Empty state: show a step-by-step onboarding guide + "Add Person" CTA.
//   - If no person selected: show the people list.
//   - If a person is selected: show PersonDetail (uploads, summary dashboards).
//
// People and summaries are stored in .docvault-health.json on the server.
// Health is NOT an entity — it's a global sidebar section, always visible.

import { useState, useEffect, useCallback } from 'react';
import {
  Heart,
  Plus,
  ArrowLeft,
  AlertCircle,
  Smartphone,
  Share2,
  Upload,
  Sparkles,
} from 'lucide-react';
import type { HealthPerson } from '../../hooks/useFileSystemServer';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useHealthApi } from './useHealthApi';
import { PeopleList } from './PeopleList';
import { AddPersonModal } from './AddPersonModal';
import { PersonDetail } from './PersonDetail';

export function HealthView() {
  const api = useHealthApi();
  const [people, setPeople] = useState<HealthPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.listPeople();
      setPeople(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreate = useCallback(
    async (name: string, color: string, file: File | null) => {
      try {
        const person = await api.createPerson(name, color);
        if (file) {
          // Upload + unarchive + parse in one shot on the server
          await api.uploadAndParseExport(person.id, file);
        }
        setPeople((prev) => [...prev, person]);
        setShowAddModal(false);
        // If they uploaded a file, jump straight into that person's dashboard
        if (file) setSelectedPersonId(person.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [api]
  );

  const handleDelete = useCallback(
    async (id: string, mode: 'archive' | 'delete') => {
      try {
        await api.deletePerson(id, mode);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [api, refresh]
  );

  const selectedPerson = selectedPersonId
    ? (people.find((p) => p.id === selectedPersonId) ?? null)
    : null;

  // ---------------------------------------------------------------------
  // Person detail mode
  // ---------------------------------------------------------------------
  if (selectedPerson) {
    return (
      <div className="min-h-full bg-surface-0">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
          <div className="flex items-center gap-3 mb-6">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedPersonId(null)}
              className="gap-1.5"
            >
              <ArrowLeft className="w-4 h-4" />
              People
            </Button>
            <h1 className="font-display text-2xl italic text-surface-950">{selectedPerson.name}</h1>
          </div>
          <PersonDetail person={selectedPerson} />
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // People list mode (with rich empty state)
  // ---------------------------------------------------------------------
  return (
    <div className="min-h-full bg-surface-0">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-rose-500/10 flex items-center justify-center">
              <Heart className="w-5 h-5 text-rose-400" />
            </div>
            <div>
              <h1 className="font-display text-2xl italic text-surface-950">Health</h1>
              <p className="text-sm text-surface-700">Apple Health exports, organized by person</p>
            </div>
          </div>
          <Button onClick={() => setShowAddModal(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            Add Person
          </Button>
        </div>

        {error && (
          <Card className="p-4 mb-4 border-danger-500/30 bg-danger-500/5">
            <div className="flex items-start gap-2.5 text-danger-400 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          </Card>
        )}

        {loading ? (
          <Card className="p-10 text-center text-surface-600">Loading…</Card>
        ) : people.length === 0 ? (
          <EmptyStateOnboarding onAddPerson={() => setShowAddModal(true)} />
        ) : (
          <PeopleList
            people={people}
            onSelect={(p) => setSelectedPersonId(p.id)}
            onDelete={handleDelete}
          />
        )}
      </div>

      <AddPersonModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onCreate={handleCreate}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty-state onboarding — shown when there are no people yet.
// ---------------------------------------------------------------------------
function EmptyStateOnboarding({ onAddPerson }: { onAddPerson: () => void }) {
  return (
    <Card className="p-6 sm:p-8">
      <div className="flex items-center gap-3 mb-4">
        <Heart className="w-6 h-6 text-rose-400" />
        <h2 className="font-display text-xl italic text-surface-950">
          Let&apos;s get your Apple Health data in
        </h2>
      </div>
      <p className="text-sm text-surface-700 mb-6 leading-relaxed">
        DocVault ingests your Apple Health export, unarchives the ~1 GB XML file, aggregates every
        metric (steps, heart rate, workouts, sleep — all 40+ HealthKit types) into daily summaries,
        and stores the results alongside your other DocVault data. Add a person to start — you can
        optionally upload their export in the same step for a fully automated flow.
      </p>

      <div className="space-y-3">
        <Step
          icon={Smartphone}
          number={1}
          title="Open the Health app on your iPhone"
          detail="Tap your profile picture in the top right to open your account page."
        />
        <Step
          icon={Share2}
          number={2}
          title="Export All Health Data"
          detail={
            <>
              Scroll to the bottom of the profile page and tap{' '}
              <strong>Export All Health Data</strong>. The phone takes 2–15 minutes to build the zip
              depending on how much history you have. When it&apos;s ready, share the{' '}
              <code className="font-mono text-[11px]">export.zip</code> to this machine (AirDrop,
              iCloud Drive, email — whatever is easiest).
            </>
          }
        />
        <Step
          icon={Upload}
          number={3}
          title="Add a person and attach the zip"
          detail={
            <>
              Click <strong>Add Person</strong> below, give them a display name and color, then pick
              the <code className="font-mono text-[11px]">export.zip</code> from disk. We upload,
              unarchive, and parse automatically in about 30–60 seconds.
            </>
          }
        />
        <Step
          icon={Sparkles}
          number={4}
          title="Browse the dashboard"
          detail="Every metric from the export becomes a column in a sortable daily summary. Workouts show up in their own list. Re-uploading a newer export later just overwrites and re-parses — no extra clicks."
        />
      </div>

      <div className="mt-6 flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <Button onClick={onAddPerson} className="gap-2" size="lg">
          <Plus className="w-4 h-4" />
          Add Person
        </Button>
        <p className="text-xs text-surface-600">
          Already have the zip? You can upload it during this step.
        </p>
      </div>
    </Card>
  );
}

function Step({
  icon: Icon,
  number,
  title,
  detail,
}: {
  icon: React.ComponentType<{ className?: string }>;
  number: number;
  title: string;
  detail: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-rose-500/10 flex items-center justify-center">
        <Icon className="w-4 h-4 text-rose-400" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm text-surface-950">
          <span className="text-rose-400 mr-2">{number}.</span>
          {title}
        </div>
        <div className="text-xs text-surface-700 mt-0.5 leading-relaxed">{detail}</div>
      </div>
    </div>
  );
}
