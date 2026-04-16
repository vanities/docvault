// Clinical Records view — one sidebar entry, 7 tabs inside. Unifies the
// FHIR clinical data (labs, vitals, conditions, medications, immunizations,
// allergies, procedures) that Apple Health ships in the `clinical-records/`
// subtree of an export.zip.
//
// Design lineage: mirrors the Quant view's pattern — shadcn Tabs, uppercase-
// tracked section headers, description paragraph under each tab. Labs opens
// by default (status-quo bias: the 90% use case = zero clicks).
//
// One `/api/health/:personId/clinical` fetch feeds all 7 tabs — switching is
// instant and doesn't re-hit the network.

import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  AlertCircle,
  Loader2,
  User,
  Heart,
  FileWarning,
  Beaker,
  Stethoscope,
  Pill,
  Syringe,
  ShieldAlert,
  Scissors,
  ClipboardList,
  RefreshCw,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import type { HealthPerson } from '../../hooks/useFileSystemServer';
import { useAppContext } from '../../contexts/AppContext';
import { useHealthApi } from './useHealthApi';
import type { ClinicalSummary, ExportInfo } from './types';
import { LabsTab } from './Records/LabsTab';
import { VitalsTab } from './Records/VitalsTab';
import { ConditionsTab } from './Records/ConditionsTab';
import { MedicationsTab } from './Records/MedicationsTab';
import { ImmunizationsTab } from './Records/ImmunizationsTab';
import { AllergiesTab } from './Records/AllergiesTab';
import { ProceduresTab } from './Records/ProceduresTab';

type RecordsTab =
  | 'labs'
  | 'vitals'
  | 'conditions'
  | 'medications'
  | 'immunizations'
  | 'allergies'
  | 'procedures';

const STORAGE_KEY = 'docvault.health.records.tab';

interface TabMeta {
  id: RecordsTab;
  label: string;
  icon: LucideIcon;
  accent: string;
  count: (summary: ClinicalSummary) => number;
}

const TAB_META: TabMeta[] = [
  {
    id: 'labs',
    label: 'Labs',
    icon: Beaker,
    accent: 'text-amber-400',
    count: (s) => s.labsByTest.length,
  },
  {
    id: 'vitals',
    label: 'Vitals',
    icon: Stethoscope,
    accent: 'text-sky-400',
    count: (s) => s.vitals.length,
  },
  {
    id: 'conditions',
    label: 'Conditions',
    icon: AlertCircle,
    accent: 'text-rose-400',
    count: (s) => s.conditions.length,
  },
  {
    id: 'medications',
    label: 'Medications',
    icon: Pill,
    accent: 'text-violet-400',
    count: (s) => s.medications.length,
  },
  {
    id: 'immunizations',
    label: 'Immunizations',
    icon: Syringe,
    accent: 'text-emerald-400',
    count: (s) => s.immunizations.length,
  },
  {
    id: 'allergies',
    label: 'Allergies',
    icon: ShieldAlert,
    accent: 'text-orange-400',
    count: (s) => s.allergies.length,
  },
  {
    id: 'procedures',
    label: 'Procedures',
    icon: Scissors,
    accent: 'text-slate-400',
    count: (s) => s.procedures.length,
  },
];

function readStoredTab(): RecordsTab {
  if (typeof window === 'undefined') return 'labs';
  const raw = localStorage.getItem(STORAGE_KEY);
  const valid: RecordsTab[] = [
    'labs',
    'vitals',
    'conditions',
    'medications',
    'immunizations',
    'allergies',
    'procedures',
  ];
  return valid.includes(raw as RecordsTab) ? (raw as RecordsTab) : 'labs';
}

export function HealthRecordsView() {
  const { selectedHealthPersonId, setSelectedHealthPersonId } = useAppContext();
  const api = useHealthApi();
  const [person, setPerson] = useState<HealthPerson | null>(null);
  const [summary, setSummary] = useState<ClinicalSummary | null>(null);
  const [sourceFilename, setSourceFilename] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noClinicalData, setNoClinicalData] = useState(false);
  const [people, setPeople] = useState<HealthPerson[]>([]);
  const [exports, setExports] = useState<ExportInfo[]>([]);
  const [reparsing, setReparsing] = useState(false);
  const [tab, setTabState] = useState<RecordsTab>(() => readStoredTab());

  const setTab = useCallback((next: RecordsTab) => {
    setTabState(next);
    if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY, next);
  }, []);

  useEffect(() => {
    void api
      .listPeople()
      .then(setPeople)
      .catch(() => {
        /* handled by fetch errors */
      });
  }, [api]);

  useEffect(() => {
    if (!selectedHealthPersonId) {
      setPerson(null);
      setSummary(null);
      return;
    }
    const found = people.find((p) => p.id === selectedHealthPersonId);
    setPerson(found ?? null);
  }, [selectedHealthPersonId, people]);

  const fetchClinical = useCallback(async () => {
    if (!selectedHealthPersonId) return;
    setLoading(true);
    setError(null);
    setNoClinicalData(false);
    try {
      const res = await api.getClinical(selectedHealthPersonId);
      if (!res) {
        setNoClinicalData(true);
        setSummary(null);
      } else {
        setSummary(res.clinical);
        setSourceFilename(res.sourceFilename);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [api, selectedHealthPersonId]);

  useEffect(() => {
    void fetchClinical();
  }, [fetchClinical]);

  // Load exports so the "no clinical data" state can offer a one-click
  // re-parse when the person already has a parsed HealthKit summary — that
  // means the zip on disk has clinical-records the old parse pipeline
  // ignored, and one re-parse under the new pipeline will backfill them.
  useEffect(() => {
    if (!selectedHealthPersonId) {
      setExports([]);
      return;
    }
    void api
      .listExports(selectedHealthPersonId)
      .then(setExports)
      .catch(() => setExports([]));
  }, [api, selectedHealthPersonId]);

  const handleReparse = useCallback(async () => {
    if (!selectedHealthPersonId) return;
    const parsedZips = exports
      .filter((e) => e.parsed)
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
    const target = parsedZips[0] ?? exports[0];
    if (!target) return;
    setReparsing(true);
    setError(null);
    try {
      await api.parseExport(selectedHealthPersonId, target.filename);
      await fetchClinical();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReparsing(false);
    }
  }, [api, selectedHealthPersonId, exports, fetchClinical]);

  // ─── Guard rails ────────────────────────────────────────────────

  if (!selectedHealthPersonId) {
    return <PersonGate people={people} onPick={setSelectedHealthPersonId} />;
  }

  if (selectedHealthPersonId && people.length > 0 && !person) {
    return <PersonNotFoundCard onClear={() => setSelectedHealthPersonId(null)} />;
  }

  if (loading) {
    return (
      <Shell>
        <RecordsHeader person={person} />
        <Card className="p-10 text-center">
          <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-accent-400" />
          <div className="text-sm text-surface-700">Loading clinical records…</div>
        </Card>
      </Shell>
    );
  }

  if (error) {
    return (
      <Shell>
        <RecordsHeader person={person} />
        <Card className="p-5 border-danger-500/30 bg-danger-500/5">
          <div className="flex items-start gap-2.5 text-danger-400 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-medium">Couldn&apos;t load clinical records</div>
              <div className="text-xs mt-0.5 break-words">{error}</div>
              <Button variant="outline" size="sm" className="mt-3" onClick={fetchClinical}>
                Try again
              </Button>
            </div>
          </div>
        </Card>
      </Shell>
    );
  }

  if (noClinicalData || !summary) {
    const parsedExport = exports.find((e) => e.parsed);
    const hasReparsableZip = parsedExport !== undefined;
    return (
      <Shell>
        <RecordsHeader person={person} />
        <Card className="p-10 text-center">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 mx-auto mb-4 flex items-center justify-center">
            <FileWarning className="w-5 h-5 text-amber-400" />
          </div>
          <h2 className="font-display italic text-lg text-surface-950 mb-1">
            {hasReparsableZip
              ? 'Clinical records not yet parsed from this export'
              : 'No clinical records in this export'}
          </h2>
          <p className="text-sm text-surface-600 max-w-md mx-auto leading-relaxed">
            {hasReparsableZip ? (
              <>
                Your <code className="font-mono text-[11.5px]">{parsedExport.filename}</code> was
                parsed before clinical-records support was added. Re-parse the zip already on disk
                to backfill labs, panels, conditions, medications, immunizations, allergies, and
                procedures — no re-upload needed.
              </>
            ) : (
              <>
                Clinical records come from providers you&apos;ve linked in iOS Settings → Health →
                Health Records. If you&apos;ve added providers since this zip was exported, do a new{' '}
                <strong>Export All Health Data</strong> and re-upload — clinical records will be
                parsed automatically.
              </>
            )}
          </p>
          {hasReparsableZip && (
            <div className="mt-5">
              <Button onClick={() => void handleReparse()} disabled={reparsing} className="gap-1.5">
                {reparsing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Re-parsing… (30–60s)
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-3.5 h-3.5" />
                    Re-parse {parsedExport.filename}
                  </>
                )}
              </Button>
            </div>
          )}
          <div className="text-[10.5px] text-surface-500 mt-5 italic leading-relaxed max-w-md mx-auto">
            Note: clinical records (labs, conditions, etc.) can&apos;t be streamed via iOS Shortcuts
            — Apple locks them behind a native API. The bulk export zip is the only pipe.
          </div>
        </Card>
      </Shell>
    );
  }

  // ─── Main render ─────────────────────────────────────────────────

  return (
    <Shell>
      <RecordsHeader person={person} summary={summary} sourceFilename={sourceFilename} />

      <Tabs value={tab} onValueChange={(v) => setTab(v as RecordsTab)} className="gap-6">
        <TabsList>
          {TAB_META.map((meta) => {
            const Icon = meta.icon;
            const isActive = tab === meta.id;
            const count = meta.count(summary);
            return (
              <TabsTrigger key={meta.id} value={meta.id} className="gap-1.5">
                <Icon className={`w-3.5 h-3.5 ${isActive ? meta.accent : ''}`} />
                <span>{meta.label}</span>
                <span
                  className={`text-[9.5px] font-mono tabular-nums px-1 rounded ${
                    isActive
                      ? 'text-surface-700 bg-surface-200/60'
                      : 'text-surface-500/80 bg-surface-200/40'
                  }`}
                >
                  {count}
                </span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        <TabsContent value="labs">
          <LabsTab summary={summary} />
        </TabsContent>
        <TabsContent value="vitals">
          <VitalsTab summary={summary} />
        </TabsContent>
        <TabsContent value="conditions">
          <ConditionsTab summary={summary} />
        </TabsContent>
        <TabsContent value="medications">
          <MedicationsTab summary={summary} />
        </TabsContent>
        <TabsContent value="immunizations">
          <ImmunizationsTab summary={summary} />
        </TabsContent>
        <TabsContent value="allergies">
          <AllergiesTab summary={summary} />
        </TabsContent>
        <TabsContent value="procedures">
          <ProceduresTab summary={summary} />
        </TabsContent>
      </Tabs>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full bg-surface-0">
      <div className="max-w-6xl mx-auto px-4 md:px-6 py-6">{children}</div>
    </div>
  );
}

function RecordsHeader({
  person,
  summary,
  sourceFilename,
}: {
  person: HealthPerson | null;
  summary?: ClinicalSummary | null;
  sourceFilename?: string | null;
}) {
  const { setActiveView } = useAppContext();
  return (
    <div className="mb-6">
      <div className="flex items-center gap-3 mb-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setActiveView('health')}
          className="gap-1.5"
        >
          <ArrowLeft className="w-4 h-4" />
          Health
        </Button>
        <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
          <ClipboardList className="w-5 h-5 text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-2xl italic text-surface-950 leading-tight">
            Clinical Records
          </h1>
          <p className="text-[11.5px] text-surface-600">
            Labs, vitals, conditions, medications, immunizations, allergies, and procedures —
            sourced from FHIR data your providers share with Apple Health.
          </p>
        </div>
        {person && (
          <div className="flex items-center gap-2 text-sm text-surface-700">
            <User className="w-4 h-4 text-surface-500" />
            <span className="font-medium">{person.name}</span>
          </div>
        )}
      </div>
      {summary && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-surface-600">
          <span>
            <span className="font-semibold uppercase tracking-[0.12em] text-surface-500 mr-1.5">
              Records
            </span>
            <span className="font-mono tabular-nums text-surface-800">{summary.recordCount}</span>
          </span>
          <span className="opacity-40">·</span>
          <span>
            <span className="font-semibold uppercase tracking-[0.12em] text-surface-500 mr-1.5">
              Range
            </span>
            <span className="font-mono tabular-nums text-surface-800">
              {summary.dateRange.start ?? '—'} → {summary.dateRange.end ?? '—'}
            </span>
          </span>
          {sourceFilename && (
            <>
              <span className="opacity-40">·</span>
              <span>
                <span className="font-semibold uppercase tracking-[0.12em] text-surface-500 mr-1.5">
                  Source
                </span>
                <span className="font-mono text-surface-800">{sourceFilename}</span>
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function PersonGate({ people, onPick }: { people: HealthPerson[]; onPick: (id: string) => void }) {
  const { setActiveView } = useAppContext();
  return (
    <Shell>
      <div className="mb-6 flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setActiveView('health')}
          className="gap-1.5"
        >
          <ArrowLeft className="w-4 h-4" />
          Health
        </Button>
        <h1 className="font-display text-2xl italic text-surface-950">Clinical Records</h1>
      </div>
      <Card className="p-10 text-center">
        <Heart className="w-10 h-10 text-surface-400 mx-auto mb-3" />
        <h2 className="font-medium text-surface-950 mb-1">Pick a person first</h2>
        <p className="text-sm text-surface-600 mb-4">
          Clinical records are per-person. Select whose data you want to see.
        </p>
        {people.length === 0 ? (
          <Button onClick={() => setActiveView('health')}>Add a person</Button>
        ) : (
          <div className="flex flex-wrap justify-center gap-2">
            {people.map((p) => (
              <Button key={p.id} variant="outline" onClick={() => onPick(p.id)} className="gap-1.5">
                <User className="w-3.5 h-3.5" />
                {p.name}
              </Button>
            ))}
          </div>
        )}
      </Card>
    </Shell>
  );
}

function PersonNotFoundCard({ onClear }: { onClear: () => void }) {
  const { setActiveView } = useAppContext();
  return (
    <Shell>
      <div className="mb-6 flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setActiveView('health')}
          className="gap-1.5"
        >
          <ArrowLeft className="w-4 h-4" />
          Health
        </Button>
      </div>
      <Card className="p-6 border-danger-500/30 bg-danger-500/5">
        <div className="flex items-start gap-2.5 text-danger-400 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-medium">Person not found</div>
            <div className="text-xs mt-0.5">
              The selected person no longer exists. Pick someone else.
            </div>
            <Button variant="outline" size="sm" className="mt-3" onClick={onClear}>
              Clear selection
            </Button>
          </div>
        </div>
      </Card>
    </Shell>
  );
}
