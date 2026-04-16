// DNA traits view — displays parsed AncestryDNA/23andMe results for the
// currently-selected Health person.
//
// Flow:
//   1. Person not selected → prompt to pick one from Overview.
//   2. Person selected, status unknown → fetch /api/health/:id/dna/status.
//   3. No DNA uploaded → show upload area (drag + drop / file picker).
//   4. DNA present → fetch /api/health/:id/dna, render grouped readings.
//
// Server encrypts everything at rest with DOCVAULT_MASTER_KEY — the browser
// receives plaintext JSON on fetch, and we render it. No password prompt.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Dna,
  Upload,
  AlertCircle,
  Loader2,
  RefreshCw,
  Trash2,
  Activity as ActivityIcon,
  Sparkles,
  AlertTriangle,
  User,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { API_BASE } from '../../constants';
import { useAppContext } from '../../contexts/AppContext';
import type { HealthPerson } from '../../hooks/useFileSystemServer';

// ---------------------------------------------------------------------------
// Types — kept in sync with server/parsers/dna-traits.ts DNAParseResult.
// ---------------------------------------------------------------------------

interface TraitReading {
  rsid: string;
  gene: string;
  trait: string;
  category: string;
  genotype: string;
  interpretation: string;
}

interface PolygenicReading {
  name: string;
  description: string;
  snpsFound: number;
  snpsTotal: number;
  score: number;
  max: number;
  interpretation: string;
}

interface DNAParseResult {
  snpsLoaded: number;
  chipCoverageEstimate: number;
  traits: TraitReading[];
  health: TraitReading[];
  experimental: TraitReading[];
  polygenic: PolygenicReading[];
  apoe: string | null;
  missing: { traits: number; health: number; experimental: number };
}

interface DNAMetadata {
  uploadedAt: string;
  filename: string | null;
  snpsLoaded: number;
  traitsFound: number;
  healthFound: number;
  experimentalFound: number;
  apoeGenotyped: boolean;
}

interface StatusResponse {
  exists: boolean;
  metadata: DNAMetadata | null;
}

interface ResultsResponse {
  results: DNAParseResult;
  metadata: DNAMetadata | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HealthDNAView() {
  const { selectedHealthPersonId } = useAppContext();
  const [people, setPeople] = useState<HealthPerson[]>([]);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [results, setResults] = useState<DNAParseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the person list once so we can show a display name
  useEffect(() => {
    fetch(`${API_BASE}/health/people`)
      .then((r) => r.json())
      .then((d: { people: HealthPerson[] }) => setPeople(d.people ?? []))
      .catch(() => {
        /* non-fatal */
      });
  }, []);

  const person = useMemo(
    () => people.find((p) => p.id === selectedHealthPersonId) ?? null,
    [people, selectedHealthPersonId]
  );

  const loadStatus = useCallback(async () => {
    if (!selectedHealthPersonId) return;
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/health/${selectedHealthPersonId}/dna/status`);
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const s = (await res.json()) as StatusResponse;
      setStatus(s);
      if (!s.exists) setResults(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load DNA status');
    }
  }, [selectedHealthPersonId]);

  const loadResults = useCallback(async () => {
    if (!selectedHealthPersonId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/health/${selectedHealthPersonId}/dna`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as ResultsResponse;
      setResults(data.results);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load DNA results');
    } finally {
      setLoading(false);
    }
  }, [selectedHealthPersonId]);

  // Refresh status + (if present) results whenever the selected person changes
  useEffect(() => {
    setStatus(null);
    setResults(null);
    setError(null);
    if (selectedHealthPersonId) void loadStatus();
  }, [selectedHealthPersonId, loadStatus]);

  useEffect(() => {
    if (status?.exists && !results) void loadResults();
  }, [status?.exists, results, loadResults]);

  const handleUpload = useCallback(
    async (file: File) => {
      if (!selectedHealthPersonId) return;
      setUploading(true);
      setError(null);
      try {
        const body = await file.arrayBuffer();
        const url = `${API_BASE}/health/${selectedHealthPersonId}/dna/upload?filename=${encodeURIComponent(file.name)}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body,
        });
        if (!res.ok) {
          const b = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(b.error ?? `Upload failed: HTTP ${res.status}`);
        }
        await loadStatus();
        await loadResults();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Upload failed');
      } finally {
        setUploading(false);
      }
    },
    [selectedHealthPersonId, loadStatus, loadResults]
  );

  const handleDelete = useCallback(async () => {
    if (!selectedHealthPersonId) return;
    if (!window.confirm('Delete DNA data for this person? This is permanent.')) return;
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/health/${selectedHealthPersonId}/dna`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(`Delete failed: HTTP ${res.status}`);
      setStatus({ exists: false, metadata: null });
      setResults(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  }, [selectedHealthPersonId]);

  // Empty state: no person
  if (!selectedHealthPersonId) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <Card className="p-12 text-center">
          <User className="w-12 h-12 mx-auto mb-4 text-surface-600" />
          <h2 className="text-xl font-semibold text-surface-950 mb-2">No person selected</h2>
          <p className="text-surface-700">
            Pick a person from <strong>Health → Overview</strong> first, then come back to DNA.
          </p>
        </Card>
      </div>
    );
  }

  // Empty state: person selected, no DNA yet
  if (status && !status.exists) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <Header personName={person?.name ?? 'This person'} metadata={null} />
        <Card className="p-10 text-center">
          <Dna className="w-14 h-14 mx-auto mb-4 text-surface-600" />
          <h2 className="text-xl font-semibold text-surface-950 mb-2">
            Upload AncestryDNA / 23andMe raw data
          </h2>
          <p className="text-surface-700 mb-6 max-w-lg mx-auto">
            Pick the raw <code>.txt</code> file from your AncestryDNA or 23andMe download. The
            server encrypts both the raw file and the parsed interpretations at rest. Nothing leaves
            this NAS.
          </p>
          <UploadArea onFile={handleUpload} uploading={uploading} />
          {error && (
            <p className="text-red-500 mt-4 text-sm">
              <AlertCircle className="w-4 h-4 inline mr-1" />
              {error}
            </p>
          )}
        </Card>
      </div>
    );
  }

  // Loading
  if (loading || !status || (status.exists && !results)) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <Header personName={person?.name ?? 'This person'} metadata={status?.metadata ?? null} />
        <Card className="p-10 text-center">
          <Loader2 className="w-6 h-6 mx-auto animate-spin text-surface-600 mb-2" />
          <p className="text-surface-700">Loading DNA results…</p>
        </Card>
      </div>
    );
  }

  // Error at top-level
  if (error && !results) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <Header personName={person?.name ?? 'This person'} metadata={status.metadata} />
        <Card className="p-8 border-red-500/30 bg-red-500/5">
          <AlertCircle className="w-6 h-6 text-red-500 mb-2" />
          <p className="text-red-500 mb-4">{error}</p>
          <Button onClick={() => void loadResults()} variant="outline">
            <RefreshCw className="w-4 h-4 mr-2" />
            Retry
          </Button>
        </Card>
      </div>
    );
  }

  if (!results) return null;

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <Header
        personName={person?.name ?? 'This person'}
        metadata={status.metadata}
        onReanalyze={() => void loadResults()}
        onDelete={() => void handleDelete()}
      />

      <SummaryCard results={results} />

      {results.apoe && <APOECard text={results.apoe} />}

      <CategorizedSection
        title="Appearance, Metabolism, & Traits"
        icon={Sparkles}
        accent="text-fuchsia-400"
        readings={results.traits}
        missing={results.missing.traits}
      />

      <CategorizedSection
        title="Health Markers"
        icon={ActivityIcon}
        accent="text-rose-400"
        readings={results.health}
        missing={results.missing.health}
        disclaimer="Not medical advice. Consumer chips miss most variants; a 'negative' here does not mean clear. For anything concerning, talk to a genetic counselor."
      />

      {results.polygenic.length > 0 && <PolygenicSection scores={results.polygenic} />}

      {results.experimental.length > 0 && (
        <CategorizedSection
          title="Experimental / Low Confidence"
          icon={AlertTriangle}
          accent="text-amber-400"
          readings={results.experimental}
          missing={results.missing.experimental}
          disclaimer="These SNPs have tiny individual effects (~1.05–1.1×). Included for completeness — don't draw conclusions from any one of them."
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function Header({
  personName,
  metadata,
  onReanalyze,
  onDelete,
}: {
  personName: string;
  metadata: DNAMetadata | null;
  onReanalyze?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h1 className="text-2xl font-semibold text-surface-950 flex items-center gap-2 mb-1">
          <Dna className="w-6 h-6 text-fuchsia-400" />
          DNA — {personName}
        </h1>
        {metadata && (
          <p className="text-sm text-surface-600">
            Uploaded {new Date(metadata.uploadedAt).toLocaleDateString()}
            {metadata.filename && ` — ${metadata.filename}`}
          </p>
        )}
      </div>
      {(onReanalyze || onDelete) && (
        <div className="flex gap-2">
          {onReanalyze && (
            <Button variant="outline" size="sm" onClick={onReanalyze}>
              <RefreshCw className="w-4 h-4 mr-1" />
              Refresh
            </Button>
          )}
          {onDelete && (
            <Button variant="outline" size="sm" onClick={onDelete}>
              <Trash2 className="w-4 h-4 mr-1 text-red-500" />
              Delete
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function UploadArea({ onFile, uploading }: { onFile: (f: File) => void; uploading: boolean }) {
  return (
    <label className="inline-block cursor-pointer">
      <input
        type="file"
        accept=".txt,text/plain"
        disabled={uploading}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
        className="hidden"
      />
      <span
        className={`inline-flex items-center gap-2 px-5 py-3 rounded-lg font-medium transition-colors ${
          uploading
            ? 'bg-surface-300 text-surface-600 cursor-wait'
            : 'bg-fuchsia-500 text-white hover:bg-fuchsia-600'
        }`}
      >
        {uploading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Parsing…
          </>
        ) : (
          <>
            <Upload className="w-4 h-4" />
            Choose raw DNA file
          </>
        )}
      </span>
    </label>
  );
}

function SummaryCard({ results }: { results: DNAParseResult }) {
  const items = [
    { label: 'SNPs loaded', value: results.snpsLoaded.toLocaleString() },
    { label: 'Chip coverage', value: `${results.chipCoverageEstimate}% of ~4.5M common variants` },
    { label: 'Appearance + traits', value: String(results.traits.length) },
    { label: 'Health markers', value: String(results.health.length) },
    { label: 'Polygenic scores', value: String(results.polygenic.length) },
  ];
  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-surface-700 mb-3">
        Summary
      </h2>
      <dl className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {items.map((it) => (
          <div key={it.label}>
            <dt className="text-xs text-surface-600 uppercase tracking-wide mb-1">{it.label}</dt>
            <dd className="text-lg font-semibold text-surface-950">{it.value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function APOECard({ text }: { text: string }) {
  // Strip the leading "  >>> " noise from the CLI-era interpret output.
  const clean = text.replace(/^\s*>>>\s*/, '').trim();
  return (
    <Card className="p-5 border-amber-500/30 bg-amber-500/5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-amber-600 mb-2 flex items-center gap-2">
        <AlertTriangle className="w-4 h-4" />
        APOE Combined Readout
      </h2>
      <p className="text-surface-900 leading-relaxed">{clean}</p>
    </Card>
  );
}

function groupByCategory(readings: TraitReading[]): Map<string, TraitReading[]> {
  const grouped = new Map<string, TraitReading[]>();
  for (const r of readings) {
    const list = grouped.get(r.category) ?? [];
    list.push(r);
    grouped.set(r.category, list);
  }
  return grouped;
}

function CategorizedSection({
  title,
  icon: Icon,
  accent,
  readings,
  missing,
  disclaimer,
}: {
  title: string;
  icon: LucideIcon;
  accent: string;
  readings: TraitReading[];
  missing: number;
  disclaimer?: string;
}) {
  const grouped = useMemo(() => groupByCategory(readings), [readings]);
  if (readings.length === 0) {
    return (
      <Card className="p-5">
        <h2 className="text-lg font-semibold text-surface-950 flex items-center gap-2 mb-2">
          <Icon className={`w-5 h-5 ${accent}`} />
          {title}
        </h2>
        <p className="text-surface-700 text-sm">
          None of these SNPs are on your chip ({missing} total in this table).
        </p>
      </Card>
    );
  }
  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold text-surface-950 flex items-center gap-2 mb-2">
        <Icon className={`w-5 h-5 ${accent}`} />
        {title}
        <span className="text-sm font-normal text-surface-600 ml-auto">
          {readings.length} found · {missing} not on chip
        </span>
      </h2>
      {disclaimer && (
        <p className="text-xs text-surface-600 italic mb-4 border-l-2 border-surface-400 pl-3">
          {disclaimer}
        </p>
      )}
      <div className="space-y-6">
        {[...grouped.entries()].map(([category, items]) => (
          <div key={category}>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-surface-700 mb-2">
              {category}
            </h3>
            <div className="space-y-3">
              {items.map((r) => (
                <TraitRow key={r.rsid} reading={r} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function TraitRow({ reading }: { reading: TraitReading }) {
  return (
    <div className="border-l-2 border-fuchsia-500/30 pl-3 py-1">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="font-medium text-surface-950">{reading.trait}</span>
        <span className="text-xs text-surface-600 font-mono">
          {reading.gene} · {reading.rsid}
        </span>
        <span className="text-xs bg-surface-200 text-surface-800 px-1.5 py-0.5 rounded font-mono">
          {reading.genotype}
        </span>
      </div>
      <p className="text-surface-800 text-sm mt-1">{reading.interpretation}</p>
    </div>
  );
}

function PolygenicSection({ scores }: { scores: PolygenicReading[] }) {
  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold text-surface-950 flex items-center gap-2 mb-2">
        <Sparkles className="w-5 h-5 text-indigo-400" />
        Polygenic Scores
        <span className="text-sm font-normal text-surface-600 ml-auto">
          {scores.length} predictions
        </span>
      </h2>
      <p className="text-xs text-surface-600 italic mb-4 border-l-2 border-surface-400 pl-3">
        Multiple SNPs combined give a better signal than any single SNP alone. Still simplified vs.
        clinical polygenic risk scores.
      </p>
      <div className="space-y-4">
        {scores.map((s) => {
          const pct = s.max > 0 ? (s.score / s.max) * 100 : 0;
          return (
            <div key={s.name} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2 flex-wrap">
                <span className="font-medium text-surface-950">{s.name}</span>
                <span className="text-xs text-surface-600 font-mono">
                  {s.score} / {s.max} ({s.snpsFound}/{s.snpsTotal} SNPs)
                </span>
              </div>
              <p className="text-xs text-surface-700">{s.description}</p>
              <div className="w-full h-2 bg-surface-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-400 transition-all"
                  style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                />
              </div>
              <p className="text-sm text-surface-900 mt-1">{s.interpretation}</p>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
