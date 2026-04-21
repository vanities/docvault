// Ancestry section — ethnicity report upload, parsed regions + journeys
// display. Self-contained so HealthDNAView can render it in both the
// "no DNA uploaded yet" empty state and the main populated view.
//
// Design continuity with HealthDNAView:
//   - Same "Part N — Title" editorial masthead pattern
//   - Same mono/serif type stack
//   - Same encrypted-at-rest messaging
//   - Uses globe/earth accent (emerald) to differentiate from the fuchsia
//     DNA accent without introducing a new visual vocabulary
//
// Data flow:
//   GET   /api/health/:personId/ancestry/status        — on mount / person change
//   POST  /api/health/:personId/ancestry/upload        — on file select
//   GET   /api/health/:personId/ancestry               — once status.exists
//   DELETE /api/health/:personId/ancestry              — on delete

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Globe2,
  Upload,
  Loader2,
  AlertCircle,
  Trash2,
  RefreshCw,
  MapPin,
  FileText,
  Lock,
  Sparkles,
  Compass,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { API_BASE } from '../../constants';

// ---------------------------------------------------------------------------
// Types — kept in sync with server/parsers/ancestry-report.ts AncestryReport
// ---------------------------------------------------------------------------

interface AncestryRegion {
  group: string;
  name: string;
  percentage: number;
}
interface AncestryJourney {
  name: string;
  subregions: string[];
}
interface AncestryReport {
  source: 'ancestry' | '23andme' | 'myheritage' | 'unknown';
  subjectName: string | null;
  regions: AncestryRegion[];
  journeys: AncestryJourney[];
}
interface AncestryMetadata {
  uploadedAt: string;
  filename: string | null;
  mimeType: string;
  source: AncestryReport['source'];
  regionCount: number;
  journeyCount: number;
}
interface StatusResponse {
  exists: boolean;
  metadata: AncestryMetadata | null;
}
interface ResultsResponse {
  results: AncestryReport;
  metadata: AncestryMetadata | null;
}

// ---------------------------------------------------------------------------
// Group coloring — each cluster heading gets a consistent hue. Gestalt
// similarity (#7): reading "all these blue bars share a parent group"
// does more work than any label would. Colors chosen to evoke regional
// feel without being literal flags.
// ---------------------------------------------------------------------------

const GROUP_ACCENTS: Record<string, { bar: string; text: string; bg: string }> = {
  England: { bar: 'bg-emerald-500', text: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  'Celtic & Gaelic': { bar: 'bg-orange-500', text: 'text-orange-400', bg: 'bg-orange-500/10' },
  'Central & Eastern Europe': {
    bar: 'bg-sky-500',
    text: 'text-sky-400',
    bg: 'bg-sky-500/10',
  },
  'Western Europe': { bar: 'bg-amber-500', text: 'text-amber-400', bg: 'bg-amber-500/10' },
  Nordic: { bar: 'bg-cyan-500', text: 'text-cyan-400', bg: 'bg-cyan-500/10' },
  Jewish: { bar: 'bg-rose-500', text: 'text-rose-400', bg: 'bg-rose-500/10' },
  Iberian: { bar: 'bg-red-500', text: 'text-red-400', bg: 'bg-red-500/10' },
  Italian: { bar: 'bg-red-500', text: 'text-red-400', bg: 'bg-red-500/10' },
  African: { bar: 'bg-amber-600', text: 'text-amber-500', bg: 'bg-amber-500/10' },
  'East Asian': { bar: 'bg-rose-500', text: 'text-rose-400', bg: 'bg-rose-500/10' },
  'South Asian': { bar: 'bg-orange-500', text: 'text-orange-400', bg: 'bg-orange-500/10' },
  Indigenous: { bar: 'bg-violet-500', text: 'text-violet-400', bg: 'bg-violet-500/10' },
  'Middle East': { bar: 'bg-yellow-500', text: 'text-yellow-400', bg: 'bg-yellow-500/10' },
};
const DEFAULT_GROUP_ACCENT = {
  bar: 'bg-surface-500',
  text: 'text-surface-700',
  bg: 'bg-surface-200/50',
};

function accentForGroup(group: string) {
  if (GROUP_ACCENTS[group]) return GROUP_ACCENTS[group];
  // Fuzzy match for new group headings we haven't hard-coded
  for (const [k, v] of Object.entries(GROUP_ACCENTS)) {
    if (group.toLowerCase().includes(k.toLowerCase())) return v;
  }
  return DEFAULT_GROUP_ACCENT;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function HealthAncestrySection({ personId }: { personId: string }) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [results, setResults] = useState<AncestryReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/health/${personId}/ancestry/status`);
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const s = (await res.json()) as StatusResponse;
      setStatus(s);
      if (!s.exists) setResults(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load ancestry status');
    }
  }, [personId]);

  const loadResults = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/health/${personId}/ancestry`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as ResultsResponse;
      setResults(data.results);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load ancestry results');
    } finally {
      setLoading(false);
    }
  }, [personId]);

  useEffect(() => {
    setStatus(null);
    setResults(null);
    setError(null);
    void loadStatus();
  }, [personId, loadStatus]);

  useEffect(() => {
    if (status?.exists && !results) void loadResults();
  }, [status?.exists, results, loadResults]);

  const handleUpload = useCallback(
    async (file: File) => {
      setUploading(true);
      setError(null);
      try {
        const body = await file.arrayBuffer();
        const url = `${API_BASE}/health/${personId}/ancestry/upload?filename=${encodeURIComponent(file.name)}`;
        const res = await fetch(url, {
          method: 'POST',
          // Let the browser set Content-Type from the Blob — file.type is
          // already populated for typical uploads (image/png, application/pdf).
          headers: file.type ? { 'Content-Type': file.type } : {},
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
    [personId, loadStatus, loadResults]
  );

  const handleDelete = useCallback(async () => {
    if (!window.confirm('Delete ancestry report for this person? This is permanent.')) return;
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/health/${personId}/ancestry`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(`Delete failed: HTTP ${res.status}`);
      setStatus({ exists: false, metadata: null });
      setResults(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  }, [personId]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  // Empty state — upload CTA
  if (status && !status.exists) {
    return (
      <section>
        <AncestryHeader metadata={null} />
        <AncestryUploadIntro onFile={handleUpload} uploading={uploading} />
        {error && (
          <p className="text-rose-400 mt-4 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            {error}
          </p>
        )}
      </section>
    );
  }

  // Loading — either initial status fetch or decrypting results
  if (!status || (status.exists && !results && loading)) {
    return (
      <section>
        <AncestryHeader metadata={status?.metadata ?? null} />
        <Card className="p-10 text-center">
          <Loader2 className="w-6 h-6 mx-auto animate-spin text-emerald-400 mb-3" />
          <p className="font-serif text-lg text-surface-900">Decrypting origins…</p>
          <p className="text-xs text-surface-600 mt-2 uppercase tracking-[0.2em]">
            reading regions · mapping journeys
          </p>
        </Card>
      </section>
    );
  }

  if (!results) return null;

  return (
    <section>
      <AncestryHeader
        metadata={status.metadata}
        onRefresh={() => void loadResults()}
        onDelete={() => void handleDelete()}
      />
      <RegionsByGroup regions={results.regions} />
      {results.journeys.length > 0 && <Journeys journeys={results.journeys} />}
      <SourceImageLink personId={personId} metadata={status.metadata} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Header — matches the DNA view's editorial "File № XX" masthead pattern
// but scoped down (smaller, no full-width treatment) since this is a
// section inside the DNA page, not a page of its own.
// ---------------------------------------------------------------------------

function AncestryHeader({
  metadata,
  onRefresh,
  onDelete,
}: {
  metadata: AncestryMetadata | null;
  onRefresh?: () => void;
  onDelete?: () => void;
}) {
  const uploaded = metadata
    ? new Date(metadata.uploadedAt).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;
  return (
    <header className="mb-4 mt-4">
      <div className="flex items-baseline gap-3 mb-1">
        <span className="font-serif text-4xl text-surface-400 leading-none shrink-0">Ω</span>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-serif text-2xl text-surface-950 leading-none">Ancestral Origins</h3>
            <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-surface-600 mt-1">
              {metadata
                ? `${metadata.regionCount} regions · ${metadata.journeyCount} journeys`
                : 'not uploaded'}
            </span>
          </div>
          <p className="text-sm text-surface-700 mt-1.5 leading-snug">
            Regional ancestry percentages and community-level migration traces. Read this as context
            for the SNP-level data below — where the ancestors were tells us which selection
            pressures shaped the genome.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {onRefresh && (
            <Button variant="outline" size="sm" onClick={onRefresh}>
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              Refresh
            </Button>
          )}
          {onDelete && (
            <Button variant="outline" size="sm" onClick={onDelete}>
              <Trash2 className="w-3.5 h-3.5 mr-1.5 text-rose-400" />
              Delete
            </Button>
          )}
        </div>
      </div>
      {uploaded && (
        <p className="text-[11px] text-surface-600 mt-2 font-mono uppercase tracking-wider pl-[52px]">
          Specimen received {uploaded}
          {metadata?.filename && (
            <span className="ml-2 inline-flex items-center gap-1">
              <FileText className="w-3 h-3" />
              {metadata.filename}
            </span>
          )}
          {metadata?.source && metadata.source !== 'unknown' && (
            <span className="ml-2">· via {metadata.source}</span>
          )}
        </p>
      )}
    </header>
  );
}

// ---------------------------------------------------------------------------
// Upload intro
// ---------------------------------------------------------------------------

function AncestryUploadIntro({
  onFile,
  uploading,
}: {
  onFile: (f: File) => void;
  uploading: boolean;
}) {
  return (
    <Card className="p-7 md:p-8 text-center relative overflow-hidden mt-3">
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-sky-500/5 pointer-events-none" />
      <div className="relative">
        <Globe2 className="w-10 h-10 mx-auto mb-3 text-emerald-400" />
        <h4 className="font-serif text-2xl text-surface-950 mb-2">Upload an ethnicity report</h4>
        <p className="text-surface-700 mb-5 max-w-md mx-auto leading-relaxed text-sm">
          Drop in a PNG, JPG, or PDF of your AncestryDNA, 23andMe, or MyHeritage ethnicity page.
          Vision AI extracts the regions and journeys, then everything gets encrypted at rest with
          the server master key.
        </p>
        <label className="inline-block cursor-pointer">
          <input
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/gif,image/webp,application/pdf"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = '';
            }}
            className="hidden"
          />
          <span
            className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium transition-all ${
              uploading
                ? 'bg-surface-300 text-surface-600 cursor-wait'
                : 'bg-emerald-500 text-white hover:bg-emerald-600 hover:scale-[1.02] active:scale-100 shadow-lg shadow-emerald-500/20'
            }`}
          >
            {uploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Parsing & encrypting…
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                Choose ethnicity file
              </>
            )}
          </span>
        </label>
        <div className="mt-5 flex items-center justify-center gap-3 text-[10px] font-mono uppercase tracking-wider text-surface-500">
          <span className="flex items-center gap-1">
            <Lock className="w-3 h-3" />
            AES-256-GCM at rest
          </span>
          <span>·</span>
          <span className="flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            Vision AI parse
          </span>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Regions view — grouped by parent heading, with percentage bars
// ---------------------------------------------------------------------------

function RegionsByGroup({ regions }: { regions: AncestryRegion[] }) {
  const grouped = useMemo(() => {
    const g = new Map<string, AncestryRegion[]>();
    for (const r of regions) {
      const list = g.get(r.group) ?? [];
      list.push(r);
      g.set(r.group, list);
    }
    return [...g.entries()].sort((a, b) => {
      const sumA = a[1].reduce((acc, r) => acc + r.percentage, 0);
      const sumB = b[1].reduce((acc, r) => acc + r.percentage, 0);
      return sumB - sumA;
    });
  }, [regions]);

  const total = regions.reduce((acc, r) => acc + r.percentage, 0);

  return (
    <div className="space-y-5 mt-2">
      {/* Total bar — shows how well the parse adds up. Most Ancestry reports
          sum to exactly 100; if we see 98–102 that's normal display rounding. */}
      <div className="flex items-center gap-3 text-[10px] font-mono uppercase tracking-[0.2em] text-surface-600">
        <span>Sum of reported regions</span>
        <span className="flex-1 h-px bg-surface-300/50" />
        <span className={Math.abs(total - 100) <= 3 ? 'text-emerald-400' : 'text-amber-400'}>
          {total}%
        </span>
      </div>

      {grouped.map(([group, items]) => {
        const accent = accentForGroup(group);
        const groupTotal = items.reduce((acc, r) => acc + r.percentage, 0);
        return (
          <div key={group}>
            <div className="flex items-center gap-2 mb-2.5">
              <MapPin className={`w-3.5 h-3.5 ${accent.text}`} />
              <h4 className={`text-xs font-mono uppercase tracking-[0.2em] ${accent.text}`}>
                {group}
              </h4>
              <span className="flex-1 h-px bg-surface-300/50" />
              <span className={`text-xs font-mono ${accent.text}`}>{groupTotal}%</span>
            </div>
            <div className="space-y-2">
              {items.map((r) => (
                <RegionBar key={`${group}-${r.name}`} region={r} accent={accent} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RegionBar({
  region,
  accent,
}: {
  region: AncestryRegion;
  accent: { bar: string; text: string; bg: string };
}) {
  // Width is the region's percentage clamped to 100 for bar display.
  // At 1% we show a minimum of 2% so the bar is visible even for trace regions.
  const width = Math.max(2, Math.min(100, region.percentage));
  return (
    <div className={`relative rounded-md p-3 pr-5 ${accent.bg}`}>
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <span className="text-sm text-surface-950 leading-tight">{region.name}</span>
        <span className={`font-serif text-lg ${accent.text} shrink-0`}>{region.percentage}%</span>
      </div>
      <div className="relative h-1 bg-surface-200/60 rounded-full overflow-hidden">
        <div
          className={`absolute inset-y-0 left-0 ${accent.bar} transition-all`}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Journeys — named migration groups + sub-communities
// ---------------------------------------------------------------------------

function Journeys({ journeys }: { journeys: AncestryJourney[] }) {
  return (
    <div className="mt-8">
      <div className="flex items-center gap-2 mb-3">
        <Compass className="w-3.5 h-3.5 text-indigo-400" />
        <h4 className="text-xs font-mono uppercase tracking-[0.2em] text-indigo-400">
          Ancestral Journeys
        </h4>
        <span className="text-[10px] font-mono text-surface-500 ml-1">{journeys.length}</span>
        <span className="flex-1 h-px bg-surface-300/50" />
      </div>
      <p className="text-[13px] text-surface-700 leading-relaxed mb-4 max-w-2xl">
        These are documented migration groups your DNA shares segments with — often more specific
        than the top-level percentages. They're communities, not regions.
      </p>
      <div className="grid md:grid-cols-2 gap-3">
        {journeys.map((j) => (
          <Card key={j.name} className="p-4 border-indigo-500/20 bg-indigo-500/5">
            <h5 className="font-serif text-base text-surface-950 leading-tight mb-2">{j.name}</h5>
            {j.subregions.length > 0 && (
              <ul className="text-[13px] text-surface-800 space-y-1 pl-3 border-l border-indigo-500/30">
                {j.subregions.map((s, i) => (
                  <li key={`${j.name}-${i}`} className="leading-snug">
                    {s}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Source image link — lets the user view the original screenshot
// ---------------------------------------------------------------------------

function SourceImageLink({
  personId,
  metadata,
}: {
  personId: string;
  metadata: AncestryMetadata | null;
}) {
  if (!metadata) return null;
  const isImage = metadata.mimeType.startsWith('image/');
  const label = isImage ? 'View original screenshot' : 'View original PDF';
  return (
    <div className="mt-6 pt-4 border-t border-surface-300/40">
      <a
        href={`${API_BASE}/health/${personId}/ancestry/image`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-surface-600 hover:text-emerald-400 transition-colors"
      >
        <FileText className="w-3 h-3" />
        {label}
        <Lock className="w-3 h-3 ml-1" />
        <span className="opacity-60">served from encrypted store</span>
      </a>
    </div>
  );
}
