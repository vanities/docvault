import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FileWarning,
  Landmark,
  Loader2,
  RadioTower,
  RefreshCw,
  TrendingUp,
  Vote,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { ResearchPanel } from '../Quant/ResearchPanel';
import { summarizePoliticsData, type CheckTheVotePoliticsPayload } from './politicsData';

function CheckTheVoteDashboard() {
  const [payload, setPayload] = useState<CheckTheVotePoliticsPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/check-the-vote/politics')
      .then((res) => res.json())
      .then((data: CheckTheVotePoliticsPayload) => {
        if (!cancelled) setPayload(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setPayload({
            configured: true,
            ok: false,
            baseUrl: 'unknown',
            checkedAt: new Date().toISOString(),
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const summary = useMemo(() => (payload ? summarizePoliticsData(payload) : null), [payload]);
  const ok = summary?.configured === true && summary.ok;
  const Icon = loading ? Loader2 : ok ? CheckCircle2 : AlertCircle;
  const iconClass = loading
    ? 'text-surface-500 animate-spin'
    : ok
      ? 'text-emerald-400'
      : 'text-amber-400';

  return (
    <section className="space-y-4" aria-label="Check the Vote dashboard">
      <Card variant="glass" className="p-4 border-border/50">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex items-start gap-3">
            <div className="mt-0.5">
              <Icon className={`w-5 h-5 ${iconClass}`} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <RadioTower className="w-3.5 h-3.5 text-surface-600" />
                <h2 className="text-sm font-semibold text-surface-950">Check the Vote feed</h2>
              </div>
              {loading ? (
                <p className="text-xs text-surface-600 mt-1">Loading Pi politics data…</p>
              ) : !summary?.configured ? (
                <p className="text-xs text-surface-700 mt-1">
                  Not configured yet. Set <code>CHECKTHEVOTE_BASE_URL</code> and{' '}
                  <code>CHECKTHEVOTE_API_KEY</code> on the Doc Vault server.
                </p>
              ) : ok ? (
                <p className="text-xs text-surface-700 mt-1">
                  Connected to <span className="font-mono">{summary.baseUrl}</span>
                  {summary.service ? ` (${summary.service})` : ''}.
                </p>
              ) : (
                <p className="text-xs text-amber-300 mt-1">
                  Configured but needs attention: {summary?.errorLabel ?? 'unknown error'}
                </p>
              )}
            </div>
          </div>
          {summary?.checkedAt && (
            <div className="text-xs text-surface-600 flex items-center gap-1">
              <RefreshCw className="w-3.5 h-3.5" />
              Checked {new Date(summary.checkedAt).toLocaleString()}
            </div>
          )}
        </div>
      </Card>

      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard icon={Landmark} label="Sync events" value={summary?.syncJobCount ?? 0} />
        <MetricCard
          icon={FileWarning}
          label="Warnings"
          value={summary?.syncWarningCount ?? 0}
          tone={(summary?.syncWarningCount ?? 0) > 0 ? 'warn' : 'ok'}
        />
        <MetricCard icon={Vote} label="Recent votes" value={summary?.recentVoteCount ?? 0} />
        <MetricCard
          icon={TrendingUp}
          label="Recent trades"
          value={summary?.recentTradeCount ?? 0}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <FeedCard
          title="Recent votes"
          icon={Vote}
          empty="No recent votes loaded yet."
          items={summary?.recentVoteLabels ?? []}
        />
        <FeedCard
          title="Recent trades"
          icon={TrendingUp}
          empty="No recent trades loaded yet."
          items={summary?.recentTradeLabels ?? []}
        />
        <FeedCard
          title="Filings needing attention"
          icon={FileWarning}
          empty="No filing warnings in the recent feed."
          items={summary?.attentionLabels ?? []}
          badge={
            summary
              ? `${summary.filingsNeedingAttentionCount}/${summary.recentFilingCount}`
              : undefined
          }
        />
      </div>
    </section>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  tone = 'neutral',
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  tone?: 'neutral' | 'ok' | 'warn';
}) {
  const toneClass =
    tone === 'warn' ? 'text-amber-300' : tone === 'ok' ? 'text-emerald-400' : 'text-surface-950';
  return (
    <Card variant="glass" className="p-4 border-border/50">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-surface-600">{label}</p>
          <p className={`text-2xl font-semibold mt-1 ${toneClass}`}>{value.toLocaleString()}</p>
        </div>
        <Icon className="w-5 h-5 text-surface-600" />
      </div>
    </Card>
  );
}

function FeedCard({
  title,
  icon: Icon,
  items,
  empty,
  badge,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  items: string[];
  empty: string;
  badge?: string;
}) {
  return (
    <Card variant="glass" className="p-4 border-border/50 min-h-48">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-surface-600" />
          <h3 className="text-sm font-semibold text-surface-950">{title}</h3>
        </div>
        {badge && <span className="text-xs text-surface-600 font-mono">{badge}</span>}
      </div>
      {items.length > 0 ? (
        <ul className="space-y-2">
          {items.map((item, index) => (
            <li
              key={`${item}-${index}`}
              className="text-xs text-surface-700 leading-relaxed border-l border-border/60 pl-3"
            >
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-surface-600">{empty}</p>
      )}
    </Card>
  );
}

export function PoliticsView() {
  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-surface-600 font-semibold">
          Politics
        </p>
        <h1 className="font-display text-3xl text-surface-950 italic mt-1">
          Political intelligence
        </h1>
        <p className="text-sm text-surface-700 mt-2 max-w-3xl">
          Monitor Check the Vote sync health, recent votes, politician trades, filings that need
          attention, and local commentary/source notes from a single politics workspace.
        </p>
      </div>

      <CheckTheVoteDashboard />

      <ResearchPanel
        domain="politics"
        title="Political research inbox"
        description="Upload disclosure PDFs, paste commentator transcripts/articles, or fetch YouTube captions into a politics-only research partition."
        pdfHint="Political disclosure PDFs, policy reports, and raw source documents. Text is extracted automatically — no AI parsing."
      />
    </div>
  );
}
