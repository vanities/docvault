// Shared scaffolding for per-segment Health views (Activity, Heart, Sleep,
// Workouts, Body). Each segment view wraps itself in this shell and passes
// a render function that receives the fetched snapshot. The shell handles:
//   - Loading the globally-selected person from AppContext
//   - Showing a person-picker if none is selected
//   - Fetching the segment snapshot from the API
//   - Loading / error / empty states
//   - The common page chrome (header with back link, person name, etc.)
//
// This keeps each segment file focused on its segment-specific rendering.

import { useEffect, useState, useCallback } from 'react';
import { ArrowLeft, AlertCircle, Loader2, User, Heart, RefreshCw, Info } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { HealthPerson } from '../../hooks/useFileSystemServer';
import { useAppContext } from '../../contexts/AppContext';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useHealthApi } from './useHealthApi';
import type { HealthSegment, PersonSnapshots } from './types';

type SegmentData<S extends HealthSegment> = PersonSnapshots[S];

interface StaleInfo {
  cachedParserVersion: string;
  currentParserVersion: string;
}

interface SegmentViewShellProps<S extends HealthSegment> {
  segment: S;
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  accent: string; // tailwind color name (e.g. 'rose', 'blue')
  children: (data: SegmentData<S>, person: HealthPerson) => React.ReactNode;
}

export function SegmentViewShell<S extends HealthSegment>({
  segment,
  title,
  subtitle,
  icon: Icon,
  accent,
  children,
}: SegmentViewShellProps<S>) {
  const { selectedHealthPersonId, setSelectedHealthPersonId, setActiveView } = useAppContext();
  const api = useHealthApi();
  const [person, setPerson] = useState<HealthPerson | null>(null);
  const [data, setData] = useState<SegmentData<S> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [people, setPeople] = useState<HealthPerson[]>([]);
  const [staleInfo, setStaleInfo] = useState<StaleInfo | null>(null);
  const [reparsing, setReparsing] = useState(false);

  // Load the people list (for picker + identifying the currently-selected person)
  useEffect(() => {
    void api
      .listPeople()
      .then(setPeople)
      .catch(() => {
        /* handled below via fetch errors */
      });
  }, [api]);

  // Identify the selected person
  useEffect(() => {
    if (!selectedHealthPersonId) {
      setPerson(null);
      setData(null);
      return;
    }
    const found = people.find((p) => p.id === selectedHealthPersonId);
    setPerson(found ?? null);
  }, [selectedHealthPersonId, people]);

  // Fetch the segment snapshot when the person changes
  const fetchSnapshot = useCallback(async () => {
    if (!selectedHealthPersonId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.getSnapshot(selectedHealthPersonId, segment);
      // api.getSnapshot returns { data, stale, cachedParserVersion, currentParserVersion }
      // — the generic can't track the concrete SegmentData<S> shape through the
      // envelope, so we cast here.
      setData(res.data as SegmentData<S>);
      setStaleInfo(
        res.stale
          ? {
              cachedParserVersion: res.cachedParserVersion,
              currentParserVersion: res.currentParserVersion,
            }
          : null
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setData(null);
      setStaleInfo(null);
    } finally {
      setLoading(false);
    }
  }, [api, selectedHealthPersonId, segment]);

  // Re-parse this person's most recent export, then refetch the snapshot.
  const handleReparse = useCallback(async () => {
    if (!selectedHealthPersonId) return;
    setReparsing(true);
    setError(null);
    try {
      // Find their most recent upload
      const exports = await api.listExports(selectedHealthPersonId);
      const parsed = exports
        .filter((e) => e.parsed)
        .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
      const target = parsed[0] ?? exports[0];
      if (!target) throw new Error('No exports to re-parse');
      await api.parseExport(selectedHealthPersonId, target.filename);
      await fetchSnapshot();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReparsing(false);
    }
  }, [api, selectedHealthPersonId, fetchSnapshot]);

  useEffect(() => {
    void fetchSnapshot();
  }, [fetchSnapshot]);

  const bgClass = `bg-${accent}-500/10`;
  const textClass = `text-${accent}-400`;

  // --------------------------------------------------------------------
  // Header (common to all states)
  // --------------------------------------------------------------------
  const header = (
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setActiveView('health')}
          className="gap-1.5"
        >
          <ArrowLeft className="w-4 h-4" />
          Health
        </Button>
        <div className={`w-10 h-10 rounded-lg ${bgClass} flex items-center justify-center`}>
          <Icon className={`w-5 h-5 ${textClass}`} />
        </div>
        <div>
          <h1 className="font-display text-2xl italic text-surface-950">{title}</h1>
          {subtitle && <p className="text-xs text-surface-600">{subtitle}</p>}
        </div>
      </div>
      {person && (
        <div className="flex items-center gap-2 text-sm text-surface-700">
          <User className="w-4 h-4 text-surface-500" />
          <span className="font-medium">{person.name}</span>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-full bg-surface-0">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {header}

        {/* No person picked → show picker */}
        {!selectedHealthPersonId && (
          <Card className="p-10 text-center">
            <Heart className="w-10 h-10 text-surface-400 mx-auto mb-3" />
            <h2 className="font-medium text-surface-950 mb-1">Pick a person first</h2>
            <p className="text-sm text-surface-600 mb-4">
              Segment views show data for one person at a time. Select whose data you want to see.
            </p>
            {people.length === 0 ? (
              <Button onClick={() => setActiveView('health')}>Add a person</Button>
            ) : (
              <div className="flex flex-wrap justify-center gap-2">
                {people.map((p) => (
                  <Button
                    key={p.id}
                    variant="outline"
                    onClick={() => setSelectedHealthPersonId(p.id)}
                    className="gap-1.5"
                  >
                    <User className="w-3.5 h-3.5" />
                    {p.name}
                  </Button>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* Person picked but we couldn't find them in the people list */}
        {selectedHealthPersonId && people.length > 0 && !person && (
          <Card className="p-6 border-danger-500/30 bg-danger-500/5">
            <div className="flex items-start gap-2.5 text-danger-400 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-medium">Person not found</div>
                <div className="text-xs mt-0.5">
                  The person you had selected ({selectedHealthPersonId}) no longer exists. Pick
                  someone else.
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => setSelectedHealthPersonId(null)}
                >
                  Clear selection
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* Loading spinner */}
        {person && loading && (
          <Card className="p-10 text-center">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-accent-400" />
            <div className="text-sm text-surface-700">Loading {segment} snapshot…</div>
          </Card>
        )}

        {/* Error */}
        {person && !loading && error && (
          <Card className="p-5 border-danger-500/30 bg-danger-500/5">
            <div className="flex items-start gap-2.5 text-danger-400 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-medium">Couldn&apos;t load {segment} data</div>
                <div className="text-xs mt-0.5 break-words">{error}</div>
                {error.includes('No parsed summary') && (
                  <div className="text-xs text-surface-700 mt-2">
                    Head back to Health → Overview, open this person, and click Re-parse on their
                    uploaded export.
                  </div>
                )}
                <Button variant="outline" size="sm" className="mt-3" onClick={fetchSnapshot}>
                  Try again
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* Staleness banner — shown above the data when the cached snapshot
            was produced by an older parser version. Explicit re-parse button
            so the user stays in control (parses can take 30+ seconds). */}
        {person && !loading && !error && data && staleInfo && (
          <Card className="p-4 mb-4 border-amber-500/30 bg-amber-500/5">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="font-medium text-surface-950">
                  Cached data is from an older parser
                </div>
                <div className="text-xs text-surface-700 mt-1 leading-relaxed">
                  This snapshot was produced by parser{' '}
                  <code className="font-mono">v{staleInfo.cachedParserVersion}</code>. The current
                  parser is <code className="font-mono">v{staleInfo.currentParserVersion}</code> and
                  may capture metrics the old one missed (e.g. sleep stage durations were added in
                  1.1.0). Re-parse to refresh — it takes ~5-10 seconds since the decompressed XML is
                  already on disk.
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 gap-1.5"
                  onClick={() => void handleReparse()}
                  disabled={reparsing}
                >
                  {reparsing ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Re-parsing…
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-3.5 h-3.5" />
                      Re-parse with v{staleInfo.currentParserVersion}
                    </>
                  )}
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* Data */}
        {person && !loading && !error && data && children(data, person)}
      </div>
    </div>
  );
}
