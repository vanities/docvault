// DNA traits view — parsed AncestryDNA / 23andMe readings for the selected
// Health person. Designed as a field-notebook: observations are numbered,
// category accents act like lab tags, and anxiety-adjacent data (health
// markers, experimental) is progressively disclosed.
//
// Behavioural principles intentionally applied:
//   - Progressive Disclosure (#24): health + experimental sections
//     collapsed by default — curiosity gap becomes the hook, not a wall.
//   - Curiosity Gap (#103): polygenic scores tease the interpretation,
//     details live behind an expand toggle.
//   - Ambiguity Aversion (#90): every probabilistic finding is paired with
//     plain-English "what this does / doesn't mean" copy.
//   - Pratfall Effect (#89): up-front honest caveat about chip coverage
//     builds credibility — we say "~0.02% of variants" rather than hiding it.
//   - Competence Signalling (#95): gene + rsid + chromosome stamps beside
//     every reading — the user sees the precision behind the interpretation.
//   - Affect Heuristic (#116): warm fuchsia/amber/emerald accents rather
//     than clinical blue/grey. Serif display, mono technical detail.
//   - Peak-End Rule (#117): the page ends with a grounding "context note"
//     rather than another data card.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Dna,
  Upload,
  AlertCircle,
  Loader2,
  RefreshCw,
  Trash2,
  ChevronDown,
  Eye,
  Utensils,
  Zap,
  Brain,
  Palette,
  Sparkles,
  Wind,
  AlertTriangle,
  User,
  Lock,
  FileText,
  Leaf,
  TrendingUp,
  Wine,
  Pill,
  Flame,
  Dumbbell,
  HeartPulse,
  Shield,
  Activity,
  Bone,
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
// Category accent tokens — each trait category gets its own color + icon.
// Used consistently across the sidebar stamp, the observation card, and
// the collapsible section tab. Gestalt similarity (#7): same visual
// vocabulary across nested contexts ties the whole view together.
// ---------------------------------------------------------------------------

// Category accent tokens — keyed by the EXACT category strings emitted by
// server/parsers/dna-traits.ts. The palette clusters related categories
// into the same hue family (Gestalt Similarity #7) so the eye reads
// "this Skin Conditions card and this Taste & Smell card are both
// sensory" without having to name it. Hues chosen for affective fit:
//
//   fuchsia  → appearance (visually observed, bright primary)
//   rose     → outer body (skin, taste/smell, cardio, cancer — kept
//               muted via /10 bg + /30 border so health-risk doesn't
//               shout)
//   orange   → activity-adjacent (inflammation, sports, digestion)
//   amber    → substances + metabolism (alcohol, drug response, fuel)
//   emerald  → positive-health (nutrients, longevity)
//   cyan     → defenses (immunity, eye health, respiratory)
//   sky      → clinical/pharmacogenomic
//   indigo   → endocrine / physiology
//   violet   → brain/mind (neurology, cognition, psychiatric)
//   slate    → intentionally muted: low-confidence categories where the
//               color itself signals "treat lightly" (#2 Visual Salience
//               used in reverse — low salience communicates low weight)
const CATEGORY_ACCENTS: Record<
  string,
  { text: string; bg: string; border: string; icon: LucideIcon }
> = {
  // — Visible / sensory / outer-body —
  Appearance: {
    text: 'text-fuchsia-400',
    bg: 'bg-fuchsia-500/10',
    border: 'border-fuchsia-500/30',
    icon: Eye,
  },
  'Skin Conditions': {
    text: 'text-rose-400',
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/30',
    icon: Palette,
  },
  'Taste & Smell': {
    text: 'text-rose-400',
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/30',
    icon: Utensils,
  },

  // — Diet & metabolism —
  'Nutrients & Vitamins': {
    text: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    icon: Leaf,
  },
  'Digestive & Metabolic': {
    text: 'text-orange-400',
    bg: 'bg-orange-500/10',
    border: 'border-orange-500/30',
    icon: Utensils,
  },
  Metabolic: {
    text: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    icon: Zap,
  },
  Longevity: {
    text: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    icon: TrendingUp,
  },

  // — Substances / exercise —
  Alcohol: {
    text: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    icon: Wine,
  },
  'Substance Response': {
    text: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    icon: Pill,
  },
  'Inflammation & Autoimmune': {
    text: 'text-orange-400',
    bg: 'bg-orange-500/10',
    border: 'border-orange-500/30',
    icon: Flame,
  },
  'Sports & Injury': {
    text: 'text-orange-400',
    bg: 'bg-orange-500/10',
    border: 'border-orange-500/30',
    icon: Dumbbell,
  },

  // — Cardio / cancer — kept muted on purpose (rose at /10 bg) —
  Cardiovascular: {
    text: 'text-rose-400',
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/30',
    icon: HeartPulse,
  },
  'Cancer Markers': {
    text: 'text-rose-400',
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/30',
    icon: Shield,
  },

  // — Clinical / immune / vision / respiration —
  Pharmacogenomics: {
    text: 'text-sky-400',
    bg: 'bg-sky-500/10',
    border: 'border-sky-500/30',
    icon: Pill,
  },
  Respiratory: {
    text: 'text-sky-400',
    bg: 'bg-sky-500/10',
    border: 'border-sky-500/30',
    icon: Wind,
  },
  'Immunity & Resistance': {
    text: 'text-cyan-400',
    bg: 'bg-cyan-500/10',
    border: 'border-cyan-500/30',
    icon: Shield,
  },
  'Eye Health': {
    text: 'text-cyan-400',
    bg: 'bg-cyan-500/10',
    border: 'border-cyan-500/30',
    icon: Eye,
  },

  // — Body / endocrine —
  'Body & Physiology': {
    text: 'text-indigo-400',
    bg: 'bg-indigo-500/10',
    border: 'border-indigo-500/30',
    icon: Activity,
  },
  Thyroid: {
    text: 'text-indigo-400',
    bg: 'bg-indigo-500/10',
    border: 'border-indigo-500/30',
    icon: Zap,
  },

  // — Brain / mind —
  Neurological: {
    text: 'text-violet-400',
    bg: 'bg-violet-500/10',
    border: 'border-violet-500/30',
    icon: Brain,
  },
  'Personality & Cognition': {
    text: 'text-violet-400',
    bg: 'bg-violet-500/10',
    border: 'border-violet-500/30',
    icon: Sparkles,
  },
  'Psychiatric (Polygenic)': {
    text: 'text-violet-400',
    bg: 'bg-violet-500/10',
    border: 'border-violet-500/30',
    icon: Brain,
  },

  // — Intentionally muted (slate) — low-confidence signals less weight —
  'Bone & Aging': {
    text: 'text-slate-400',
    bg: 'bg-slate-500/10',
    border: 'border-slate-500/30',
    icon: Bone,
  },
  'Rare Mendelian (Low Chip Coverage)': {
    text: 'text-slate-400',
    bg: 'bg-slate-500/10',
    border: 'border-slate-500/30',
    icon: AlertCircle,
  },
};

const DEFAULT_ACCENT = {
  text: 'text-surface-700',
  bg: 'bg-surface-200/50',
  border: 'border-surface-400/30',
  icon: Palette,
};

function accentFor(category: string) {
  return CATEGORY_ACCENTS[category] ?? DEFAULT_ACCENT;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function HealthDNAView() {
  const { selectedHealthPersonId } = useAppContext();
  const [people, setPeople] = useState<HealthPerson[]>([]);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [results, setResults] = useState<DNAParseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/health/people`)
      .then((r) => r.json())
      .then((d: { people: HealthPerson[] }) => setPeople(d.people ?? []))
      .catch(() => {});
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

  // -------------------------------------------------------------------------
  // Render states
  // -------------------------------------------------------------------------

  if (!selectedHealthPersonId) {
    return (
      <div className="min-h-dvh">
        <HelixBackdrop />
        <div className="relative p-8 max-w-3xl mx-auto">
          <Card className="p-12 text-center border-dashed">
            <User className="w-10 h-10 mx-auto mb-4 text-surface-500" />
            <h2 className="font-serif text-2xl text-surface-950 mb-2">No subject selected</h2>
            <p className="text-surface-700 max-w-md mx-auto">
              Pick a person from <span className="font-medium">Health → Overview</span> first. DNA
              is per-person — each subject has their own encrypted profile.
            </p>
          </Card>
        </div>
      </div>
    );
  }

  if (status && !status.exists) {
    return (
      <div className="min-h-dvh">
        <HelixBackdrop />
        <div className="relative p-8 max-w-3xl mx-auto">
          <PageHeader
            personName={person?.name ?? 'This subject'}
            metadata={null}
            onRefresh={undefined}
            onDelete={undefined}
          />
          <UploadIntro
            person={person?.name ?? 'this subject'}
            onFile={handleUpload}
            uploading={uploading}
          />
          {error && (
            <p className="text-rose-400 mt-4 text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              {error}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (loading || !status || (status.exists && !results)) {
    return (
      <div className="min-h-dvh">
        <HelixBackdrop />
        <div className="relative p-8 max-w-3xl mx-auto">
          <PageHeader
            personName={person?.name ?? 'This subject'}
            metadata={status?.metadata ?? null}
          />
          <Card className="p-10 text-center">
            <Loader2 className="w-6 h-6 mx-auto animate-spin text-fuchsia-400 mb-3" />
            <p className="font-serif text-lg text-surface-900">Interpreting SNPs…</p>
            <p className="text-xs text-surface-600 mt-2 uppercase tracking-[0.2em]">
              decrypting · parsing · cross-referencing tables
            </p>
          </Card>
        </div>
      </div>
    );
  }

  if (error && !results) {
    return (
      <div className="min-h-dvh">
        <HelixBackdrop />
        <div className="relative p-8 max-w-3xl mx-auto">
          <PageHeader personName={person?.name ?? 'This subject'} metadata={status.metadata} />
          <Card className="p-8 border-rose-500/30 bg-rose-500/5">
            <AlertCircle className="w-6 h-6 text-rose-400 mb-2" />
            <p className="text-rose-400 mb-4">{error}</p>
            <Button onClick={() => void loadResults()} variant="outline" size="sm">
              <RefreshCw className="w-4 h-4 mr-2" />
              Retry
            </Button>
          </Card>
        </div>
      </div>
    );
  }

  if (!results) return null;

  return (
    <div className="min-h-dvh">
      <HelixBackdrop />
      <div className="relative p-6 md:p-10 max-w-5xl mx-auto space-y-8">
        <PageHeader
          personName={person?.name ?? 'This subject'}
          metadata={status.metadata}
          onRefresh={() => void loadResults()}
          onDelete={() => void handleDelete()}
        />

        <OverviewStrip results={results} metadata={status.metadata} />

        <CaveatBlock results={results} />

        {results.apoe && <APOEFeature text={results.apoe} />}

        <ObservationSection
          index="I"
          title="Appearance & Traits"
          subtitle="Eye color, hair, skin, taste, features shaped by a handful of well-studied SNPs."
          readings={results.traits}
          missing={results.missing.traits}
          defaultOpen
        />

        <ObservationSection
          index="II"
          title="Health Markers"
          subtitle="Probabilistic risk modifiers — not diagnoses. Consumer chips see a small fraction of known variants."
          readings={results.health}
          missing={results.missing.health}
          defaultOpen={false}
          gatedCopy="Reveal health markers"
          gatedCaveat="Most of these raise or lower baseline risk by a fraction — exercise, sleep, and cardiovascular health modify nearly all of them. A 'negative' reading here does not mean clear. Talk to a genetic counselor for anything that surprises you."
        />

        {results.polygenic.length > 0 && <PolygenicStack scores={results.polygenic} />}

        {results.experimental.length > 0 && (
          <ObservationSection
            index="III"
            title="Experimental / Low Confidence"
            subtitle="GWAS hits with tiny individual effects (~1.05–1.1×). Listed for completeness; don't draw conclusions."
            readings={results.experimental}
            missing={results.missing.experimental}
            defaultOpen={false}
            gatedCopy="Show experimental SNPs"
            gatedCaveat="Each of these SNPs individually tells you almost nothing. Rare-disease chips miss most variants. Do not self-diagnose from any single reading."
            accentCategory="experimental"
          />
        )}

        <ClosingNote />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header — editorial-style masthead with decorative index + lock glyph
// ---------------------------------------------------------------------------

function PageHeader({
  personName,
  metadata,
  onRefresh,
  onDelete,
}: {
  personName: string;
  metadata: DNAMetadata | null;
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
    <header className="mb-6">
      <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.3em] text-surface-600 mb-3">
        <Dna className="w-3.5 h-3.5 text-fuchsia-400" />
        <span>File № 01 — Genetic Observations</span>
        <span className="flex-1 h-px bg-gradient-to-r from-surface-300 to-transparent" />
        <Lock className="w-3 h-3" />
        <span>encrypted at rest</span>
      </div>
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-serif text-4xl md:text-5xl text-surface-950 leading-none">
            {personName}
          </h1>
          {uploaded && (
            <p className="text-xs text-surface-600 mt-2 font-mono uppercase tracking-wider">
              Specimen received {uploaded}
              {metadata?.filename && (
                <span className="ml-2 inline-flex items-center gap-1">
                  <FileText className="w-3 h-3" />
                  {metadata.filename}
                </span>
              )}
            </p>
          )}
        </div>
        {(onRefresh || onDelete) && (
          <div className="flex gap-2">
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
        )}
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Overview strip — numbers anchored against familiar baselines
// ---------------------------------------------------------------------------

function OverviewStrip({
  results,
  metadata,
}: {
  results: DNAParseResult;
  metadata: DNAMetadata | null;
}) {
  const stats: Array<{ label: string; value: string; hint: string; accent: string }> = [
    {
      label: 'SNPs loaded',
      value: results.snpsLoaded.toLocaleString(),
      hint: 'positions your chip reported',
      accent: 'text-fuchsia-400',
    },
    {
      label: 'Chip coverage',
      value: `${results.chipCoverageEstimate}%`,
      hint: 'of ~4.5M common human variants',
      accent: 'text-amber-400',
    },
    {
      label: 'Traits found',
      value: String(results.traits.length),
      hint: 'interpreted appearance / metabolism',
      accent: 'text-emerald-400',
    },
    {
      label: 'Health markers',
      value: String(results.health.length),
      hint: 'probabilistic modifiers — see below',
      accent: 'text-rose-400',
    },
    {
      label: 'Polygenic scores',
      value: String(results.polygenic.length),
      hint: 'multi-SNP aggregates',
      accent: 'text-indigo-400',
    },
  ];
  return (
    <Card className="p-5 md:p-6 border-surface-400/30">
      <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-surface-600 mb-4">
        Overview — Part One
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
        {stats.map((s) => (
          <div key={s.label}>
            <dt className="text-[10px] text-surface-600 uppercase tracking-wider mb-1 font-mono">
              {s.label}
            </dt>
            <dd className={`font-serif text-3xl ${s.accent} leading-none`}>{s.value}</dd>
            <p className="text-[11px] text-surface-600 mt-1.5 italic">{s.hint}</p>
          </div>
        ))}
      </div>
      {metadata && (
        <p className="text-[11px] text-surface-500 mt-5 pt-4 border-t border-surface-300/30 font-mono uppercase tracking-wider flex items-center gap-2">
          <span>Chip version</span>
          <span className="text-surface-700">—</span>
          <span className="text-surface-700">
            {results.snpsLoaded > 600_000
              ? 'Illumina OmniExpress-class (standard)'
              : 'Compact chip — coverage below average'}
          </span>
        </p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Caveat block — Pratfall Effect up front (honest limitation = more credible)
// ---------------------------------------------------------------------------

function CaveatBlock({ results }: { results: DNAParseResult }) {
  const totalMissing =
    results.missing.traits + results.missing.health + results.missing.experimental;
  return (
    <div className="relative p-5 pl-7 md:pl-9 border-l-2 border-surface-400/50 ml-2">
      <Sparkles className="absolute left-[-9px] top-5 w-4 h-4 bg-surface-0 text-surface-600 p-[1px]" />
      <p className="text-sm text-surface-800 leading-relaxed max-w-2xl">
        These are <em className="text-surface-950 not-italic font-medium">risk modifiers</em>, not
        diagnoses. This analysis looked at ~{(results.snpsLoaded + totalMissing).toLocaleString()}{' '}
        SNPs — of which your chip sequenced {results.snpsLoaded.toLocaleString()}. That's a
        postcard-view of your genome. One reading is rarely destiny. Most traits are{' '}
        <em className="text-surface-950 not-italic font-medium">polygenic</em> — hundreds of SNPs
        acting in concert — and almost every genetic risk factor below is modifiable by sleep,
        exercise, diet, and social connection.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// APOE featured callout — visual salience + Von Restorff effect
// ---------------------------------------------------------------------------

function APOEFeature({ text }: { text: string }) {
  const clean = text.replace(/^\s*>>>\s*/, '').trim();
  // Extract the e-type at the start for a big glyph, e.g., "APOE type: e3/e4"
  const typeMatch = clean.match(/APOE type:\s*(e\d\/e\d)/);
  const etype = typeMatch?.[1] ?? null;
  const rest = typeMatch ? clean.slice(typeMatch[0].length).replace(/^\s*—\s*/, '') : clean;
  return (
    <Card className="overflow-hidden border-amber-500/30">
      <div className="bg-gradient-to-br from-amber-500/10 via-amber-500/[0.02] to-transparent p-6 md:p-7">
        <div className="flex items-start gap-5">
          {etype && (
            <div className="flex flex-col items-center justify-center border-r-2 border-amber-500/30 pr-5 shrink-0">
              <span className="font-mono text-[9px] uppercase tracking-[0.3em] text-amber-400 mb-1">
                genotype
              </span>
              <span className="font-serif text-4xl md:text-5xl text-amber-400 leading-none">
                {etype}
              </span>
            </div>
          )}
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <h3 className="font-serif text-xl text-surface-950">APOE — combined readout</h3>
            </div>
            <p className="text-sm text-surface-800 leading-relaxed">{rest}</p>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Upload intro — notebook-style onboarding, not a bare button in a card
// ---------------------------------------------------------------------------

function UploadIntro({
  person,
  onFile,
  uploading,
}: {
  person: string;
  onFile: (f: File) => void;
  uploading: boolean;
}) {
  return (
    <Card className="p-8 md:p-10 text-center relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-fuchsia-500/5 via-transparent to-amber-500/5 pointer-events-none" />
      <div className="relative">
        <div className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.3em] text-surface-600 mb-6">
          <span className="w-6 h-px bg-surface-400" />
          <span>Specimen intake</span>
          <span className="w-6 h-px bg-surface-400" />
        </div>
        <Dna className="w-12 h-12 mx-auto mb-4 text-fuchsia-400" />
        <h2 className="font-serif text-3xl text-surface-950 mb-3">
          Begin with {person}'s raw file
        </h2>
        <p className="text-surface-700 mb-7 max-w-md mx-auto leading-relaxed">
          Drop in the{' '}
          <code className="font-mono text-xs bg-surface-200 px-1.5 py-0.5 rounded">.txt</code> from
          your AncestryDNA or 23andMe download. The server parses locally, encrypts both the raw
          genotype file and the interpretation with the master key, then discards the plaintext.
          Nothing leaves this NAS.
        </p>
        <UploadButton onFile={onFile} uploading={uploading} />
        <div className="mt-6 flex items-center justify-center gap-4 text-[10px] font-mono uppercase tracking-wider text-surface-500">
          <span className="flex items-center gap-1">
            <Lock className="w-3 h-3" />
            AES-256-GCM
          </span>
          <span>·</span>
          <span>No network calls</span>
          <span>·</span>
          <span>No LLM</span>
        </div>
      </div>
    </Card>
  );
}

function UploadButton({ onFile, uploading }: { onFile: (f: File) => void; uploading: boolean }) {
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
        className={`inline-flex items-center gap-2 px-6 py-3 rounded-lg font-medium transition-all ${
          uploading
            ? 'bg-surface-300 text-surface-600 cursor-wait'
            : 'bg-fuchsia-500 text-white hover:bg-fuchsia-600 hover:scale-[1.02] active:scale-100 shadow-lg shadow-fuchsia-500/20'
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
            Choose raw DNA file
          </>
        )}
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Observation section — progressive disclosure, numbered like a field journal
// ---------------------------------------------------------------------------

function ObservationSection({
  index,
  title,
  subtitle,
  readings,
  missing,
  defaultOpen,
  gatedCopy,
  gatedCaveat,
  accentCategory,
}: {
  index: string;
  title: string;
  subtitle: string;
  readings: TraitReading[];
  missing: number;
  defaultOpen: boolean;
  gatedCopy?: string;
  gatedCaveat?: string;
  accentCategory?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const grouped = useMemo(() => {
    const g = new Map<string, TraitReading[]>();
    for (const r of readings) {
      const list = g.get(r.category) ?? [];
      list.push(r);
      g.set(r.category, list);
    }
    return g;
  }, [readings]);

  if (readings.length === 0) {
    return (
      <section>
        <SectionHeader
          index={index}
          title={title}
          subtitle={subtitle}
          count={0}
          missing={missing}
          open={open}
          onToggle={() => setOpen((v) => !v)}
          hasGate={!!gatedCopy}
        />
        {open && (
          <Card className="p-5">
            <p className="text-sm text-surface-700 italic">
              None of these SNPs are on your chip ({missing} in this table).
            </p>
          </Card>
        )}
      </section>
    );
  }

  return (
    <section>
      <SectionHeader
        index={index}
        title={title}
        subtitle={subtitle}
        count={readings.length}
        missing={missing}
        open={open}
        onToggle={() => setOpen((v) => !v)}
        gatedCopy={gatedCopy}
        hasGate={!!gatedCopy}
      />
      {open && (
        <div className="space-y-6">
          {gatedCaveat && (
            <div className="text-[13px] text-surface-700 leading-relaxed border-l-2 border-amber-500/30 bg-amber-500/5 pl-4 py-3 pr-4 rounded-r">
              <span className="font-mono text-[9px] uppercase tracking-[0.25em] text-amber-500 block mb-1">
                Read this first
              </span>
              {gatedCaveat}
            </div>
          )}
          {[...grouped.entries()].map(([category, items]) => {
            const a = accentCategory === 'experimental' ? DEFAULT_ACCENT : accentFor(category);
            const Icon = a.icon;
            return (
              <div key={category}>
                <div className="flex items-center gap-2 mb-3">
                  <Icon className={`w-4 h-4 ${a.text}`} />
                  <h4 className={`text-xs font-mono uppercase tracking-[0.2em] ${a.text}`}>
                    {category}
                  </h4>
                  <span className="text-[10px] font-mono text-surface-500 ml-1">
                    {items.length}
                  </span>
                  <span className="flex-1 h-px bg-surface-300/50" />
                </div>
                <div className="grid md:grid-cols-2 gap-3">
                  {items.map((r, i) => (
                    <ObservationCard key={r.rsid} reading={r} ordinal={i + 1} accent={a} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function SectionHeader({
  index,
  title,
  subtitle,
  count,
  missing,
  open,
  onToggle,
  gatedCopy,
  hasGate,
}: {
  index: string;
  title: string;
  subtitle: string;
  count: number;
  missing: number;
  open: boolean;
  onToggle: () => void;
  gatedCopy?: string;
  hasGate: boolean;
}) {
  return (
    <button onClick={onToggle} className="w-full text-left mb-4 group" aria-expanded={open}>
      <div className="flex items-baseline gap-3 mb-1">
        <span className="font-serif text-4xl text-surface-400 leading-none shrink-0">{index}</span>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-serif text-2xl text-surface-950 leading-none">{title}</h3>
            <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-surface-600 mt-1">
              {count} found · {missing} not on chip
            </span>
          </div>
          <p className="text-sm text-surface-700 mt-1.5 leading-snug">{subtitle}</p>
        </div>
        <span
          className={`font-mono text-[11px] uppercase tracking-[0.25em] shrink-0 transition-colors ${
            hasGate && !open
              ? 'text-fuchsia-400 group-hover:text-fuchsia-300'
              : 'text-surface-600 group-hover:text-surface-800'
          } flex items-center gap-1.5`}
        >
          {hasGate && !open ? gatedCopy : open ? 'Collapse' : 'Expand'}
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Observation card — the unit reading. Genotype rendered as a centered
// "ladder strip", rsid + gene as technical stamp (competence signalling).
// ---------------------------------------------------------------------------

function ObservationCard({
  reading,
  ordinal,
  accent,
}: {
  reading: TraitReading;
  ordinal: number;
  accent: { text: string; bg: string; border: string; icon: LucideIcon };
}) {
  return (
    <div
      className={`relative rounded-lg border ${accent.border} ${accent.bg} p-4 pt-9 hover:bg-surface-100/20 transition-colors`}
    >
      <div
        className={`absolute top-2 right-3 text-[10px] font-mono uppercase tracking-[0.2em] ${accent.text} opacity-60`}
      >
        № {String(ordinal).padStart(2, '0')}
      </div>
      <div className="flex items-center justify-between gap-3 mb-2">
        <h5 className="font-serif text-lg text-surface-950 leading-tight">{reading.trait}</h5>
        <Genotype letters={reading.genotype} accent={accent} />
      </div>
      <p className="text-[13px] text-surface-800 leading-relaxed mb-3">{reading.interpretation}</p>
      <div className="flex items-center gap-2 text-[10px] font-mono text-surface-500 uppercase tracking-wider">
        <span>{reading.gene}</span>
        <span>·</span>
        <span>{reading.rsid}</span>
      </div>
    </div>
  );
}

function Genotype({
  letters,
  accent,
}: {
  letters: string;
  accent: { text: string; bg: string; border: string };
}) {
  const [a, b] = letters.split('/');
  return (
    <div
      className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border ${accent.border} ${accent.bg}`}
    >
      <span className={`font-mono font-bold text-sm ${accent.text}`}>{a ?? '?'}</span>
      <span className="text-surface-500 text-xs">/</span>
      <span className={`font-mono font-bold text-sm ${accent.text}`}>{b ?? '?'}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Polygenic stack — meters with curiosity gap; descriptions teased,
// interpretation available without click, source SNPs expandable later.
// ---------------------------------------------------------------------------

function PolygenicStack({ scores }: { scores: PolygenicReading[] }) {
  return (
    <section>
      <div className="flex items-baseline gap-3 mb-1">
        <span className="font-serif text-4xl text-surface-400 leading-none">Σ</span>
        <div className="flex-1">
          <h3 className="font-serif text-2xl text-surface-950 leading-none">Polygenic Scores</h3>
          <p className="text-sm text-surface-700 mt-1.5 leading-snug">
            Multiple SNPs combined. Still simplified vs. clinical polygenic risk scores — individual
            scores matter less than trends across categories.
          </p>
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-3 mt-5">
        {scores.map((s) => (
          <PolygenicCard key={s.name} score={s} />
        ))}
      </div>
    </section>
  );
}

function PolygenicCard({ score }: { score: PolygenicReading }) {
  const pct = score.max > 0 ? (score.score / score.max) * 100 : 0;
  const hasEnoughSNPs = score.snpsFound >= Math.max(2, Math.ceil(score.snpsTotal * 0.4));
  // Muted indigo with amber accent if the score looks "elevated"
  const high = pct >= 60;
  const color = !hasEnoughSNPs ? 'bg-surface-500' : high ? 'bg-amber-400' : 'bg-indigo-400';
  return (
    <Card className="p-4 hover:bg-surface-100/20 transition-colors">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <h5 className="font-serif text-base text-surface-950 leading-tight">{score.name}</h5>
        <span className="text-[10px] font-mono text-surface-500 uppercase tracking-wider shrink-0">
          {score.snpsFound}/{score.snpsTotal} SNPs
        </span>
      </div>
      <p className="text-[11px] text-surface-600 italic mb-3">{score.description}</p>
      <div className="relative h-1.5 bg-surface-200 rounded-full overflow-hidden mb-3">
        <div
          className={`absolute inset-y-0 left-0 ${color} transition-all`}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
      {hasEnoughSNPs ? (
        <p className="text-[13px] text-surface-800 leading-relaxed">{score.interpretation}</p>
      ) : (
        <p className="text-[12px] text-surface-600 italic">
          Not enough SNPs on your chip to score this one meaningfully ({score.snpsFound}/
          {score.snpsTotal} present).
        </p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Closing note — peak-end rule: end on a grounding, not on another data card.
// ---------------------------------------------------------------------------

function ClosingNote() {
  return (
    <div className="pt-4 mt-10 border-t border-surface-300/40 text-center">
      <p className="font-serif text-base text-surface-800 italic max-w-xl mx-auto leading-relaxed">
        "One SNP ≠ destiny. Most of what appears above can be moved by sleep, movement, diet, and
        the people around you. For anything that concerns you — genetic counselor, not a web page."
      </p>
      <div className="flex items-center justify-center gap-3 mt-4 text-[10px] font-mono uppercase tracking-[0.3em] text-surface-500">
        <span className="w-10 h-px bg-surface-400" />
        <span>End of file № 01</span>
        <span className="w-10 h-px bg-surface-400" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Decorative helix backdrop — fixed, gentle, ignorable; gives the page a
// signature visual identity without getting in the way of the data.
// ---------------------------------------------------------------------------

function HelixBackdrop() {
  return (
    <div
      aria-hidden
      className="fixed inset-0 pointer-events-none opacity-[0.03] z-0"
      style={{
        backgroundImage:
          'radial-gradient(circle at 10% 20%, rgba(217,70,239,0.6) 0, transparent 40%), radial-gradient(circle at 85% 80%, rgba(245,158,11,0.5) 0, transparent 35%)',
      }}
    />
  );
}
