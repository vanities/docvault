// Health view — top-level orchestrator for Apple Health data.
//
// Layout:
//   - If no person selected: show the people list (with an "Add Person" button).
//   - If a person is selected: show their PersonDetail view (uploads, parse, summary).
//
// People are stored in the Health entity's `people` array on the server; see
// server/routes/health.ts for the CRUD API.

import { useState, useEffect, useCallback } from 'react';
import { Heart, Plus, ArrowLeft, AlertCircle } from 'lucide-react';
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
    async (name: string, color: string) => {
      try {
        const person = await api.createPerson(name, color);
        setPeople((prev) => [...prev, person]);
        setShowAddModal(false);
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
  // People list mode
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
          <Card className="p-10 text-center">
            <Heart className="w-10 h-10 text-surface-400 mx-auto mb-3" />
            <p className="text-surface-800 font-medium mb-1">No people yet</p>
            <p className="text-surface-600 text-sm mb-4">
              Add a person to start tracking their Apple Health exports.
            </p>
            <Button onClick={() => setShowAddModal(true)} className="gap-2">
              <Plus className="w-4 h-4" />
              Add Person
            </Button>
          </Card>
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
