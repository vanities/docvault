import { useCallback, useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import { Card } from '@/components/ui/card';
import { Brain, Terminal, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { API_BASE } from '../../constants';

interface StrategySignals {
  btcPrice?: number;
  btcRisk?: number | null;
  btcDrawdown?: number;
  fearGreed?: number;
  sahmRule?: number | null;
  recessionProb?: number | null;
  tenYearReal?: number;
  yieldCurveRegime?: string;
  nfci?: number | null;
  fedStance?: string;
  sp500Risk?: number | null;
  hashRibbonRegime?: string;
  [key: string]: unknown;
}

interface StrategyEntry {
  id: string;
  createdAt: string;
  title: string;
  body: string;
  signals: StrategySignals;
  portfolio?: Record<string, unknown>;
  author: string;
}

/** Human-readable labels and formatting for known signal keys. */
const SIGNAL_META: Record<string, { label: string; fmt?: (v: unknown) => string; color?: string }> =
  {
    btcPrice: {
      label: 'BTC',
      fmt: (v) => `$${Number(v).toLocaleString()}`,
      color: 'text-amber-400',
    },
    btcRisk: { label: 'Risk', fmt: (v) => Number(v).toFixed(3), color: 'text-cyan-400' },
    btcSigma: { label: 'Sigma', fmt: (v) => `${Number(v).toFixed(2)}σ` },
    btcDrawdown: {
      label: 'Drawdown',
      fmt: (v) => `${(Number(v) * 100).toFixed(1)}%`,
      color: 'text-rose-400',
    },
    fearGreed: { label: 'F&G', fmt: (v) => String(v), color: 'text-emerald-400' },
    fearGreed30d: { label: 'F&G 30d' },
    fearGreed90d: { label: 'F&G 90d' },
    hashRibbonRegime: { label: 'Hash Ribbons' },
    sahmRule: { label: 'Sahm', fmt: (v) => Number(v).toFixed(2) },
    recessionProb: {
      label: 'Recession',
      fmt: (v) => `${(Number(v) * 100).toFixed(0)}%`,
      color: 'text-orange-400',
    },
    tenYearReal: { label: '10Y Real', fmt: (v) => `${Number(v).toFixed(2)}%` },
    tenYearRealPct: { label: '10Y Pct', fmt: (v) => `${v}th` },
    nfci: { label: 'NFCI', fmt: (v) => Number(v).toFixed(2) },
    fedRate: { label: 'Fed Rate' },
    fedStance: { label: 'Fed Stance' },
    vix: { label: 'VIX', fmt: (v) => Number(v).toFixed(1) },
    goldYoy: {
      label: 'Gold YoY',
      fmt: (v) => `+${Number(v).toFixed(1)}%`,
      color: 'text-yellow-400',
    },
    sp500Risk: { label: 'SPX Risk', fmt: (v) => Number(v).toFixed(3) },
  };

function SignalGrid({ signals }: { signals: StrategySignals }) {
  const entries = Object.entries(signals).filter(([, v]) => v != null);
  if (entries.length === 0) return null;
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 mt-3">
      {entries.map(([key, val]) => {
        const meta = SIGNAL_META[key];
        const label = meta?.label ?? key;
        const formatted = meta?.fmt ? meta.fmt(val) : String(val);
        const color = meta?.color ?? 'text-surface-950';
        return (
          <div
            key={key}
            className="px-2 py-1.5 rounded-lg bg-surface-100/30 border border-border/20"
          >
            <div className="text-[9px] text-surface-700 uppercase tracking-wider font-medium">
              {label}
            </div>
            <div className={`text-[12px] font-bold font-mono leading-tight ${color}`}>
              {formatted}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StrategyCard({
  entry,
  onDelete,
  defaultExpanded = false,
}: {
  entry: StrategyEntry;
  onDelete: (id: string) => void;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const date = new Date(entry.createdAt);
  const dateStr = date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const timeStr = date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <Card variant="glass" className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-mono text-surface-700">
              {dateStr} {timeStr}
            </span>
            <span className="text-[10px] text-surface-700">by {entry.author}</span>
          </div>
          <h4 className="text-[14px] font-semibold text-surface-950 leading-snug">{entry.title}</h4>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            type="button"
            onClick={() => onDelete(entry.id)}
            className="p-1.5 rounded-lg text-surface-700 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
            title="Delete"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="p-1.5 rounded-lg text-surface-700 hover:text-cyan-400 hover:bg-cyan-500/10 transition-colors"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Signal grid */}
      <SignalGrid signals={entry.signals} />

      {/* Expanded markdown body */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-border/30">
          <div className="prose prose-sm prose-invert max-w-none text-[13px] leading-relaxed [&_h2]:text-[15px] [&_h2]:font-bold [&_h2]:text-surface-950 [&_h2]:mt-4 [&_h2]:mb-2 [&_h3]:text-[14px] [&_h3]:font-semibold [&_h3]:text-surface-950 [&_h3]:mt-3 [&_h3]:mb-1 [&_p]:text-surface-800 [&_p]:mb-2 [&_ul]:text-surface-800 [&_ul]:mb-2 [&_li]:mb-1 [&_strong]:text-surface-950 [&_code]:text-cyan-400 [&_code]:bg-surface-100/40 [&_code]:px-1 [&_code]:rounded">
            <Markdown>{entry.body}</Markdown>
          </div>
        </div>
      )}
    </Card>
  );
}

/** Strategy History — displays AI-generated investment strategy analyses.
 *  Entries are created via Claude Code's /strategy skill which fetches
 *  portfolio + quant signals and pushes a recommendation to the API. */
export function StrategyView() {
  const [entries, setEntries] = useState<StrategyEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEntries = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/strategy`);
      const json = (await res.json()) as { entries?: StrategyEntry[] };
      setEntries(json.entries ?? []);
    } catch {
      // Silently fail — empty list
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchEntries();
  }, [fetchEntries]);

  const handleDelete = async (id: string) => {
    try {
      await fetch(`${API_BASE}/strategy/${id}`, { method: 'DELETE' });
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch {
      // ignore
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 md:px-6 py-8">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-surface-950 flex items-center gap-2">
          <Brain className="w-6 h-6 text-purple-400" />
          Strategy
        </h2>
        <p className="text-[13px] text-surface-800 mt-1 leading-relaxed">
          AI-generated investment strategy analyses that combine your portfolio data with live quant
          signals. Each entry is a snapshot of the reasoning at a point in time.
        </p>
      </div>

      {/* How-to banner */}
      <Card variant="glass" className="p-4 mb-6">
        <div className="flex items-start gap-3">
          <Terminal className="w-5 h-5 text-cyan-400 flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-[13px] font-semibold text-surface-950 mb-1">
              Generate a new strategy
            </div>
            <p className="text-[12px] text-surface-800 leading-relaxed">
              Open <span className="font-mono text-cyan-400">Claude Code</span> in the docvault
              project and use the{' '}
              <span className="font-mono text-cyan-400 font-semibold">/strategy</span> skill. Claude
              will fetch your portfolio + all quant signals, analyze the current regime, and propose
              a strategy. When you agree on one, it gets saved here automatically.
            </p>
          </div>
        </div>
      </Card>

      {loading && (
        <div className="h-40 flex items-center justify-center text-surface-700 text-[13px]">
          Loading strategy history...
        </div>
      )}

      {!loading && entries.length === 0 && (
        <Card variant="glass" className="p-8">
          <div className="flex flex-col items-center text-center gap-2">
            <Brain className="w-10 h-10 text-surface-700 opacity-40" />
            <h3 className="text-lg font-semibold text-surface-950">No strategies yet</h3>
            <p className="text-[13px] text-surface-800 max-w-md">
              Run <span className="font-mono text-cyan-400">/strategy</span> in Claude Code to
              generate your first analysis. It&apos;ll pull your portfolio data and current market
              signals to build a personalized recommendation.
            </p>
          </div>
        </Card>
      )}

      {!loading && entries.length > 0 && (
        <div className="space-y-4">
          {entries.map((e, i) => (
            <StrategyCard key={e.id} entry={e} onDelete={handleDelete} defaultExpanded={i === 0} />
          ))}
        </div>
      )}
    </div>
  );
}
